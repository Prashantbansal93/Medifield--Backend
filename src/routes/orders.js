const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Wholesaler = require('../models/Wholesaler');
const User = require('../models/User');
const Medicine = require('../models/Medicine');
const { auth, requireRole, requireVerified } = require('../middleware/auth');
const { canTransitionStatus } = require('../utils/validation');
const { emitOrderEvent } = require('../realtime');
const {
  randomOtp,
  generateBillNumber,
  hydrateOrder,
  findAssignableDeliveryPartner,
  routeToWholesaler,
  deductInventory,
  redirectOrRejectOrder,
} = require('../utils/orderHelpers');

const waitMinutes = Number(process.env.WHOLESALER_WAIT_MINUTES) || 5;

router.post('/create', auth, requireRole('RETAILER'), requireVerified, async (req, res) => {
  try {
    const { items, slot = 'Afternoon' } = req.body;
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ success: false, message: 'Order must include at least one item' });
    }
    if (!['Afternoon', 'Evening'].includes(slot)) {
      return res.status(400).json({ success: false, message: 'Slot must be Afternoon or Evening' });
    }

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
      wholesalerResponseDeadline: new Date(Date.now() + waitMinutes * 60 * 1000),
      totalAmount: normalizedItems.reduce((acc, item) => acc + item.price * item.quantity, 0),
      items: normalizedItems,
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
    emitOrderEvent('order:created', updatedOrder);
    return res.json({
      success: true,
      message: 'Order routed to priority wholesaler. Waiting for accept/reject.',
      order: updatedOrder,
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
      await deductInventory(userWholesaler._id, order.items);

      const deliveryPartner = await findAssignableDeliveryPartner(userWholesaler.city);
      const retailer = await User.findById(order.retailer);
      const wholesalerLat = Number(userWholesaler.location?.coordinates?.[1]) || 26.91;
      const wholesalerLng = Number(userWholesaler.location?.coordinates?.[0]) || 75.78;
      const retailerLat = Number(retailer?.profile?.lat) || 26.915;
      const retailerLng = Number(retailer?.profile?.lng) || 75.81;

      const updates = {
        status: 'ACCEPTED',
        acceptedAt: new Date(),
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

      await Order.findByIdAndUpdate(orderId, updates);
      const live = await hydrateOrder(orderId);
      emitOrderEvent('order:updated', live);
      return res.json({ success: true, message: 'Order accepted. Stock deducted and delivery assigned.', order: live });
    }

    if (action === 'reject') {
      const result = await redirectOrRejectOrder(order, waitMinutes);
      return res.json({ success: true, message: result.message });
    }

    return res.status(400).json({ success: false, message: 'Invalid action. Use accept or reject.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Order response failed' });
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
    emitOrderEvent('order:updated', live);
    return res.json({ success: true, message: 'Order marked as packed', order: live });
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
    emitOrderEvent('order:updated', live);
    return res.json({ success: true, message: 'Order status updated', order: live });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Status update failed' });
  }
});

router.get('/', auth, requireVerified, async (req, res) => {
  try {
    const query = {};
    if (req.user.role === 'RETAILER') query.retailer = req.user.id;
    if (req.user.role === 'WHOLESALER') {
      const wholesaler = await Wholesaler.findOne({ user: req.user.id });
      if (!wholesaler) return res.json({ success: true, orders: [] });
      query.wholesaler = wholesaler._id;
    }
    if (req.user.role === 'DELIVERY') query.deliveryPartner = req.user.id;

    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .populate('retailer', 'name phone')
      .populate({
        path: 'wholesaler',
        populate: { path: 'user', select: 'name phone profile.shopAddress' },
      })
      .populate('deliveryPartner', 'name phone')
      .populate('items.medicine', 'name company');

    const isRetailer = req.user.role === 'RETAILER';
    const safeOrders = orders.map((order) => {
      const obj = order.toObject();
      if (isRetailer) obj.wholesaler = undefined;
      return obj;
    });
    return res.json({ success: true, orders: safeOrders });
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

    const obj = order.toObject();
    if (req.user.role === 'RETAILER') obj.wholesaler = undefined;
    return res.json({ success: true, order: obj });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
