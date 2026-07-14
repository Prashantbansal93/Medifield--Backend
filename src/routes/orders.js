const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Wholesaler = require('../models/Wholesaler');
const User = require('../models/User');
const Medicine = require('../models/Medicine');
const { auth, requireRole, requireVerified } = require('../middleware/auth');
const { canTransitionStatus } = require('../utils/validation');
const { emitOrderEvent } = require('../realtime');
const { withTransaction } = require('../utils/transactions');
const { notifyOrderEvent, createNotification } = require('../utils/notifications');
const { resolveDeliverySlot } = require('../utils/deliverySlots');
const { challanUpload, publicUploadPath } = require('../middleware/upload');
const {
  randomOtp,
  generateBillNumber,
  hydrateOrder,
  attachEta,
  findAssignableDeliveryPartner,
  routeToWholesaler,
  deductInventory,
  restoreInventory,
  redirectOrRejectOrder,
} = require('../utils/orderHelpers');

const waitMinutes = Number(process.env.WHOLESALER_WAIT_MINUTES) || 5;

/** Free cancel only before wholesaler accepts */
const FREE_CANCEL_STATUSES = ['PLACED', 'WAITING_WHOLESALER'];
/** After accept, retailer may only request cancel (until picked up) */
const CANCEL_REQUEST_STATUSES = ['ACCEPTED', 'PACKED'];
const STOCK_RESTORE_STATUSES = ['ACCEPTED', 'PACKED'];

function serializeOrder(order, isRetailer) {
  const obj = attachEta(order);
  if (isRetailer) obj.wholesaler = undefined;
  return obj;
}

router.get('/delivery-slot', auth, requireRole('RETAILER'), requireVerified, (req, res) => {
  return res.json({ success: true, deliverySlot: resolveDeliverySlot() });
});

router.post('/create', auth, requireRole('RETAILER'), requireVerified, async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ success: false, message: 'Order must include at least one item' });
    }

    const deliverySlot = resolveDeliverySlot();
    const slot = deliverySlot.slot;

    const medicineIds = items.map((i) => i.medicineId);
    const medicines = await Medicine.find({ _id: { $in: medicineIds } });
    const medicineMap = new Map(medicines.map((m) => [String(m._id), m]));

    const normalizedItems = [];
    for (const item of items) {
      const med = medicineMap.get(String(item.medicineId));
      if (!med) {
        return res.status(404).json({ success: false, message: `Medicine not found: ${item.medicineId}` });
      }
      const quantity = Math.max(1, Number(item.quantity || 1));
      if (med.requiresPrescription && !item.prescriptionUrl) {
        return res.status(400).json({
          success: false,
          message: `Prescription required for ${med.name}. Provide prescriptionUrl.`,
        });
      }
      normalizedItems.push({
        medicine: med._id,
        medicineName: med.name,
        quantity,
        price: med.mrp,
        prescriptionUrl: item.prescriptionUrl || null,
      });
    }

    const order = await Order.create({
      retailer: req.user.id,
      status: 'WAITING_WHOLESALER',
      slot,
      slotWindowLabel: deliverySlot.windowLabel,
      deliveryDateLabel: deliverySlot.deliveryDateLabel,
      wholesalerResponseDeadline: new Date(Date.now() + waitMinutes * 60 * 1000),
      totalAmount: normalizedItems.reduce((acc, item) => acc + item.price * item.quantity, 0),
      items: normalizedItems,
      cancelRequest: { status: 'NONE' },
    });

    const selectedWholesaler = await routeToWholesaler(order);
    if (!selectedWholesaler) {
      await Order.findByIdAndUpdate(order._id, { status: 'FAILED' });
      return res.status(404).json({ success: false, message: 'No wholesaler found with required stock' });
    }

    await Order.findByIdAndUpdate(order._id, {
      wholesaler: selectedWholesaler._id,
      $push: { attemptedWholesalers: selectedWholesaler._id },
    });

    const updatedOrder = await hydrateOrder(order._id);
    const serialized = serializeOrder(updatedOrder, true);
    emitOrderEvent('order:created', serialized);
    await notifyOrderEvent(updatedOrder, 'WAITING_WHOLESALER');
    return res.json({
      success: true,
      message: 'Order routed to nearest wholesaler. Waiting for accept/reject.',
      order: serialized,
      deliverySlot,
      waitWindowMinutes: waitMinutes,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Order creation failed' });
  }
});

router.post('/respond', auth, requireRole('WHOLESALER'), requireVerified, async (req, res) => {
  try {
    const { orderId, action } = req.body;
    const userWholesaler = await Wholesaler.findOne({ user: req.user.id });
    if (!userWholesaler) {
      return res.status(404).json({ success: false, message: 'Wholesaler profile not found' });
    }

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.status !== 'WAITING_WHOLESALER') {
      return res.status(400).json({ success: false, message: 'Order is no longer awaiting wholesaler response' });
    }
    if (!order.wholesaler || String(order.wholesaler) !== String(userWholesaler._id)) {
      return res.status(403).json({ success: false, message: 'Order is not assigned to you' });
    }

    if (action === 'accept') {
      try {
        await withTransaction(async (session) => {
          await deductInventory(userWholesaler._id, order.items, session);

          const deliveryPartner = await findAssignableDeliveryPartner(userWholesaler.city);
          const retailer = await User.findById(order.retailer);
          const wholesalerLat = Number(userWholesaler.location?.coordinates?.[1]) || 26.91;
          const wholesalerLng = Number(userWholesaler.location?.coordinates?.[0]) || 75.78;
          const retailerLat = Number(retailer?.profile?.lat) || 26.915;
          const retailerLng = Number(retailer?.profile?.lng) || 75.81;

          const updates = {
            status: 'ACCEPTED',
            acceptedAt: new Date(),
            stockDeducted: true,
            deliveryOtp: randomOtp(),
            billNumber: generateBillNumber(),
            deliveryTracking: {
              wholesalerLat,
              wholesalerLng,
              retailerLat,
              retailerLng,
              currentLat: wholesalerLat,
              currentLng: wholesalerLng,
            },
          };
          if (deliveryPartner) updates.deliveryPartner = deliveryPartner._id;

          await Order.findByIdAndUpdate(orderId, updates, { session });
        });
      } catch (err) {
        if (err.code === 'INSUFFICIENT_STOCK') {
          const result = await redirectOrRejectOrder(order, waitMinutes);
          await notifyOrderEvent(order, 'REDIRECTED', 'Stock taken by another order — redirected to next wholesaler.');
          return res.status(409).json({
            success: false,
            message: 'Stock no longer available. Order redirected to next wholesaler.',
            ...result,
          });
        }
        throw err;
      }

      const live = await hydrateOrder(orderId);
      const serialized = serializeOrder(live, false);
      emitOrderEvent('order:updated', serialized);
      await notifyOrderEvent(live, 'ACCEPTED');
      return res.json({ success: true, message: 'Order accepted. Stock deducted and delivery assigned.', order: serialized });
    }

    if (action === 'reject') {
      const result = await redirectOrRejectOrder(order, waitMinutes);
      await notifyOrderEvent(order, 'REDIRECTED', 'Wholesaler rejected — order redirected.');
      return res.json({ success: true, message: result.message });
    }

    return res.status(400).json({ success: false, message: 'Invalid action. Use accept or reject.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Order response failed' });
  }
});

router.post('/cancel', auth, requireRole('RETAILER'), requireVerified, async (req, res) => {
  try {
    const { orderId, reason } = req.body;
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (String(order.retailer) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: 'You can only cancel your own orders' });
    }

    if (FREE_CANCEL_STATUSES.includes(order.status)) {
      await Order.findByIdAndUpdate(orderId, {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        deliveryPartner: null,
        cancelRequest: { status: 'NONE' },
      });

      const live = await hydrateOrder(orderId);
      const serialized = serializeOrder(live, true);
      emitOrderEvent('order:updated', serialized);
      await notifyOrderEvent(live, 'CANCELLED', 'Retailer cancelled the order before wholesaler acceptance.');
      return res.json({
        success: true,
        mode: 'cancelled',
        message: 'Order cancelled successfully',
        order: serialized,
      });
    }

    if (!CANCEL_REQUEST_STATUSES.includes(order.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel order in ${order.status} status.`,
      });
    }

    if (order.cancelRequest?.status === 'PENDING') {
      return res.status(400).json({
        success: false,
        message: 'A cancel request is already pending wholesaler approval.',
        order: serializeOrder(await hydrateOrder(orderId), true),
      });
    }

    await Order.findByIdAndUpdate(orderId, {
      cancelRequest: {
        status: 'PENDING',
        requestedAt: new Date(),
        reason: reason ? String(reason).slice(0, 300) : 'Retailer requested cancellation',
      },
    });

    const live = await hydrateOrder(orderId);
    const serialized = serializeOrder(live, true);
    emitOrderEvent('order:updated', serialized);
    await notifyOrderEvent(live, 'CANCEL_REQUESTED', 'Retailer requested order cancellation.');
    return res.json({
      success: true,
      mode: 'request',
      message: 'Cancel request sent. Waiting for wholesaler approval.',
      order: serialized,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Cancellation failed' });
  }
});

router.post('/cancel-respond', auth, requireRole('WHOLESALER'), requireVerified, async (req, res) => {
  try {
    const { orderId, action } = req.body;
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, message: 'action must be approve or reject' });
    }

    const userWholesaler = await Wholesaler.findOne({ user: req.user.id });
    if (!userWholesaler) {
      return res.status(404).json({ success: false, message: 'Wholesaler profile not found' });
    }

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (!order.wholesaler || String(order.wholesaler) !== String(userWholesaler._id)) {
      return res.status(403).json({ success: false, message: 'Order is not assigned to you' });
    }
    if (order.cancelRequest?.status !== 'PENDING') {
      return res.status(400).json({ success: false, message: 'No pending cancel request on this order' });
    }

    if (action === 'reject') {
      await Order.findByIdAndUpdate(orderId, {
        cancelRequest: {
          status: 'REJECTED',
          requestedAt: order.cancelRequest.requestedAt,
          resolvedAt: new Date(),
          reason: order.cancelRequest.reason,
        },
      });
      const live = await hydrateOrder(orderId);
      const serialized = serializeOrder(live, false);
      emitOrderEvent('order:updated', serialized);
      await createNotification({
        userId: order.retailer,
        type: 'ORDER_CANCEL_REJECTED',
        title: 'Cancel request declined',
        message: 'Wholesaler declined your cancellation request. The order continues.',
        orderId: order._id,
      });
      return res.json({ success: true, message: 'Cancel request rejected', order: serialized });
    }

    const shouldRestore = order.stockDeducted || STOCK_RESTORE_STATUSES.includes(order.status);
    await withTransaction(async (session) => {
      if (shouldRestore && order.wholesaler) {
        await restoreInventory(order.wholesaler, order.items, session);
      }
      await Order.findByIdAndUpdate(
        orderId,
        {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          deliveryPartner: null,
          cancelRequest: {
            status: 'APPROVED',
            requestedAt: order.cancelRequest.requestedAt,
            resolvedAt: new Date(),
            reason: order.cancelRequest.reason,
          },
        },
        { session }
      );
    });

    const live = await hydrateOrder(orderId);
    const serialized = serializeOrder(live, false);
    emitOrderEvent('order:updated', serialized);
    await notifyOrderEvent(live, 'CANCELLED', 'Wholesaler approved cancel request.');
    await createNotification({
      userId: order.retailer,
      type: 'ORDER_CANCEL_APPROVED',
      title: 'Order cancelled',
      message: 'Your cancel request was approved. See cancel bill in past orders.',
      orderId: order._id,
    });
    return res.json({
      success: true,
      message: 'Cancel request approved. Order cancelled and stock restored.',
      order: serialized,
      cancelBill: {
        billNumber: live.billNumber,
        totalAmount: live.totalAmount,
        cancelledAt: live.cancelledAt,
        status: 'CANCELLED',
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Cancel response failed' });
  }
});

router.post('/upload-challan', auth, requireRole('WHOLESALER'), requireVerified, (req, res, next) => {
  challanUpload.single('challanImage')(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message || 'Upload failed' });
    return next();
  });
}, async (req, res) => {
  try {
    const orderId = req.body.orderId;
    if (!orderId) return res.status(400).json({ success: false, message: 'orderId is required' });
    if (!req.file) return res.status(400).json({ success: false, message: 'challanImage file is required' });

    const userWholesaler = await Wholesaler.findOne({ user: req.user.id });
    if (!userWholesaler) {
      return res.status(404).json({ success: false, message: 'Wholesaler profile not found' });
    }

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (String(order.wholesaler) !== String(userWholesaler._id)) {
      return res.status(403).json({ success: false, message: 'Order is not assigned to you' });
    }

    const url = publicUploadPath(req.file.path);
    await Order.findByIdAndUpdate(orderId, { offlineChallanImageUrl: url });
    const live = await hydrateOrder(orderId);
    const serialized = serializeOrder(live, false);
    emitOrderEvent('order:updated', serialized);
    return res.json({
      success: true,
      message: 'Offline challan uploaded',
      order: serialized,
      offlineChallanImageUrl: url,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Challan upload failed' });
  }
});

router.post('/pack', auth, requireRole('WHOLESALER'), requireVerified, async (req, res) => {
  try {
    const { orderId } = req.body;
    const userWholesaler = await Wholesaler.findOne({ user: req.user.id });
    if (!userWholesaler) {
      return res.status(404).json({ success: false, message: 'Wholesaler profile not found' });
    }

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (String(order.wholesaler) !== String(userWholesaler._id)) {
      return res.status(403).json({ success: false, message: 'Order is not assigned to you' });
    }
    if (order.status !== 'ACCEPTED') {
      return res.status(400).json({ success: false, message: 'Only accepted orders can be marked packed' });
    }

    await Order.findByIdAndUpdate(orderId, { status: 'PACKED', packedAt: new Date() });
    const live = await hydrateOrder(orderId);
    const serialized = serializeOrder(live, false);
    emitOrderEvent('order:updated', serialized);
    await notifyOrderEvent(live, 'PACKED');
    return res.json({ success: true, message: 'Order marked as packed', order: serialized });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/update-status', auth, requireVerified, async (req, res) => {
  try {
    const { orderId, status, lat, lng, otp } = req.body;
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    if (req.user.role === 'DELIVERY') {
      if (String(order.deliveryPartner) !== String(req.user.id)) {
        return res.status(403).json({ success: false, message: 'Order is not assigned to you' });
      }
    } else if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, message: 'Only delivery partners can update delivery status' });
    }

    if (status && !canTransitionStatus(order.status, status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status transition from ${order.status} to ${status}`,
      });
    }

    const updates = {};
    if (status) updates.status = status;
    if (status === 'PICKED') updates.pickedAt = new Date();
    if (status === 'OUT_FOR_DELIVERY') updates.pickedAt = order.pickedAt || new Date();
    if (status === 'DELIVERED') {
      if (!otp || otp !== order.deliveryOtp) {
        return res.status(400).json({ success: false, message: 'Invalid OTP. Delivery cannot be closed.' });
      }
      updates.deliveredAt = new Date();
    }
    if (typeof lat === 'number' && typeof lng === 'number') {
      updates.deliveryTracking = {
        ...(order.deliveryTracking || {}),
        currentLat: lat,
        currentLng: lng,
      };
    }

    await Order.findByIdAndUpdate(orderId, updates);
    const live = await hydrateOrder(orderId);
    const serialized = serializeOrder(live, req.user.role === 'RETAILER');
    emitOrderEvent('order:updated', serialized);
    if (status) await notifyOrderEvent(live, status);
    return res.json({ success: true, message: 'Order status updated', order: serialized });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Status update failed' });
  }
});

router.get('/', auth, requireVerified, async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const query = {};
    if (req.user.role === 'RETAILER') query.retailer = req.user.id;
    if (req.user.role === 'WHOLESALER') {
      const wholesaler = await Wholesaler.findOne({ user: req.user.id });
      if (!wholesaler) {
        return res.json({
          success: true,
          orders: [],
          pagination: { page, limit, total: 0, pages: 0 },
        });
      }
      query.wholesaler = wholesaler._id;
    }
    if (req.user.role === 'DELIVERY') query.deliveryPartner = req.user.id;

    const [orders, total] = await Promise.all([
      Order.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('retailer', 'name phone')
        .populate({
          path: 'wholesaler',
          populate: { path: 'user', select: 'name phone profile.shopAddress' },
        })
        .populate('deliveryPartner', 'name phone')
        .populate('items.medicine', 'name company imageUrl'),
      Order.countDocuments(query),
    ]);

    const isRetailer = req.user.role === 'RETAILER';
    const safeOrders = orders.map((order) => serializeOrder(order, isRetailer));
    return res.json({
      success: true,
      orders: safeOrders,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Could not fetch orders' });
  }
});

router.get('/:id', auth, requireVerified, async (req, res) => {
  try {
    const order = await hydrateOrder(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const allowed =
      req.user.role === 'ADMIN' ||
      String(order.retailer?._id || order.retailer) === String(req.user.id) ||
      (req.user.role === 'DELIVERY' && String(order.deliveryPartner?._id || order.deliveryPartner) === String(req.user.id)) ||
      (req.user.role === 'WHOLESALER' && order.wholesaler?.user && String(order.wholesaler.user._id) === String(req.user.id));

    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    return res.json({
      success: true,
      order: serializeOrder(order, req.user.role === 'RETAILER'),
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
