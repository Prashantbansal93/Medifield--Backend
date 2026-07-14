const crypto = require('crypto');
const Order = require('../models/Order');
const Wholesaler = require('../models/Wholesaler');
const User = require('../models/User');
const { emitOrderEvent } = require('../realtime');
const { hasValidCoords, computeDeliveryEta } = require('./geo');

function randomOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function generateBillNumber() {
  return `BILL-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function attachEta(orderDoc) {
  const obj = orderDoc?.toObject ? orderDoc.toObject() : { ...orderDoc };
  const eta = computeDeliveryEta(obj.deliveryTracking);
  if (eta) {
    obj.eta = eta;
  }
  return obj;
}

async function hydrateOrder(orderId) {
  const order = await Order.findById(orderId)
    .populate('retailer', 'name phone profile.city profile.lat profile.lng')
    .populate({
      path: 'wholesaler',
      populate: { path: 'user', select: 'name phone profile.shopAddress' },
    })
    .populate('deliveryPartner', 'name phone profile.city')
    .populate('items.medicine', 'name company requiresPrescription imageUrl');
  return order;
}

function wholesalerHasStock(wholesaler, inventoryCheck) {
  return Object.entries(inventoryCheck).every(([medicineId, qty]) => {
    const stock = wholesaler.inventory?.find(
      (inv) => inv.medicine && String(inv.medicine._id || inv.medicine) === medicineId
    );
    return stock && stock.quantity >= qty;
  });
}

function buildInventoryCheck(order) {
  const inventoryCheck = {};
  for (const item of order.items) {
    inventoryCheck[item.medicine.toString()] = item.quantity;
  }
  return inventoryCheck;
}

async function findNearestWholesalerByGeo(order, retailerLat, retailerLng) {
  const inventoryCheck = buildInventoryCheck(order);
  const attempted = (order.attemptedWholesalers || []).map(String);

  const stockConditions = Object.entries(inventoryCheck).map(([medicineId, qty]) => ({
    inventory: {
      $elemMatch: {
        medicine: medicineId,
        quantity: { $gte: qty },
      },
    },
  }));

  const pipeline = [
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [retailerLng, retailerLat] },
        distanceField: 'distanceMeters',
        spherical: true,
        query: {
          _id: { $nin: order.attemptedWholesalers || [] },
          ...(stockConditions.length ? { $and: stockConditions } : {}),
        },
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'user',
        foreignField: '_id',
        as: 'userDoc',
      },
    },
    { $unwind: '$userDoc' },
    { $match: { 'userDoc.verificationStatus': 'APPROVED' } },
    { $limit: 20 },
  ];

  const candidates = await Wholesaler.aggregate(pipeline);
  for (const doc of candidates) {
    if (attempted.includes(String(doc._id))) continue;
    const wholesaler = await Wholesaler.findById(doc._id).populate('inventory.medicine');
    if (wholesaler && wholesalerHasStock(wholesaler, inventoryCheck)) {
      wholesaler.distanceMeters = doc.distanceMeters;
      return wholesaler;
    }
  }
  return null;
}

async function findWholesalerByPriority(order) {
  const inventoryCheck = buildInventoryCheck(order);

  const wholesalers = await Wholesaler.find({
    _id: { $nin: order.attemptedWholesalers || [] },
  })
    .populate({ path: 'user', match: { verificationStatus: 'APPROVED' } })
    .populate('inventory.medicine')
    .sort({ priorityRank: 1, createdAt: 1 });

  const candidate = wholesalers.find((w) => {
    if (!w.user) return false;
    return wholesalerHasStock(w, inventoryCheck);
  });

  return candidate || null;
}

async function routeToWholesaler(order) {
  const retailer = await User.findById(order.retailer).select('profile.lat profile.lng');
  const retailerLat = Number(retailer?.profile?.lat);
  const retailerLng = Number(retailer?.profile?.lng);

  if (hasValidCoords(retailerLat, retailerLng)) {
    const geoMatch = await findNearestWholesalerByGeo(order, retailerLat, retailerLng);
    if (geoMatch) return geoMatch;
  }

  return findWholesalerByPriority(order);
}

async function deductInventory(wholesalerId, items, session = null) {
  const opts = session ? { session } : {};

  for (const item of items) {
    const medicineId = item.medicine?._id || item.medicine;
    const result = await Wholesaler.findOneAndUpdate(
      {
        _id: wholesalerId,
        inventory: {
          $elemMatch: {
            medicine: medicineId,
            quantity: { $gte: item.quantity },
          },
        },
      },
      { $inc: { 'inventory.$.quantity': -item.quantity } },
      { new: true, ...opts }
    );

    if (!result) {
      const err = new Error(`Insufficient stock for medicine ${item.medicineName || medicineId}`);
      err.code = 'INSUFFICIENT_STOCK';
      throw err;
    }
  }

  if (session) {
    return Wholesaler.findById(wholesalerId).session(session);
  }
  return Wholesaler.findById(wholesalerId);
}

async function restoreInventory(wholesalerId, items, session = null) {
  const findQuery = Wholesaler.findById(wholesalerId);
  const wholesaler = session ? await findQuery.session(session) : await findQuery;
  if (!wholesaler) throw new Error('Wholesaler not found');

  for (const item of items) {
    const medicineId = item.medicine?._id || item.medicine;
    const existing = wholesaler.inventory.find((inv) => String(inv.medicine) === String(medicineId));
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      wholesaler.inventory.push({
        medicine: medicineId,
        quantity: item.quantity,
        price: item.price || 1,
      });
    }
  }

  await wholesaler.save(session ? { session } : undefined);
  return wholesaler;
}

async function findAssignableDeliveryPartner(city) {
  return User.findOne({
    role: 'DELIVERY',
    verificationStatus: 'APPROVED',
    'profile.city': new RegExp(`^${String(city).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
  }).sort({ createdAt: 1 });
}

async function redirectOrRejectOrder(order, waitMinutes) {
  const next = await routeToWholesaler(order);
  if (!next) {
    await Order.findByIdAndUpdate(order._id, { status: 'REJECTED', wholesaler: null });
    const live = await hydrateOrder(order._id);
    emitOrderEvent('order:updated', attachEta(live));
    return { status: 'REJECTED', message: 'No alternative wholesaler found.' };
  }

  await Order.findByIdAndUpdate(order._id, {
    status: 'WAITING_WHOLESALER',
    wholesaler: next._id,
    wholesalerResponseDeadline: new Date(Date.now() + waitMinutes * 60 * 1000),
    $push: { attemptedWholesalers: next._id },
  });
  const live = await hydrateOrder(order._id);
  emitOrderEvent('order:updated', attachEta(live));
  return { status: 'WAITING_WHOLESALER', message: 'Order redirected to next nearest wholesaler.' };
}

module.exports = {
  randomOtp,
  generateBillNumber,
  hydrateOrder,
  attachEta,
  findAssignableDeliveryPartner,
  routeToWholesaler,
  findNearestWholesalerByGeo,
  findWholesalerByPriority,
  deductInventory,
  restoreInventory,
  redirectOrRejectOrder,
  wholesalerHasStock,
  buildInventoryCheck,
};
