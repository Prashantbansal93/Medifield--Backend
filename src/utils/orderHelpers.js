const { v4: uuidv4 } = require('uuid');
const Order = require('../models/Order');
const Wholesaler = require('../models/Wholesaler');
const User = require('../models/User');
const { emitOrderEvent } = require('../realtime');

function randomOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function generateBillNumber() {
  return `BILL-${uuidv4().slice(0, 8).toUpperCase()}`;
}

async function hydrateOrder(orderId) {
  return Order.findById(orderId)
    .populate('retailer', 'name phone profile.city profile.lat profile.lng')
    .populate({
      path: 'wholesaler',
      populate: { path: 'user', select: 'name phone profile.shopAddress' },
    })
    .populate('deliveryPartner', 'name phone profile.city')
    .populate('items.medicine', 'name company requiresPrescription');
}

async function findAssignableDeliveryPartner(city) {
  return User.findOne({
    role: 'DELIVERY',
    verificationStatus: 'APPROVED',
    'profile.city': new RegExp(`^${String(city).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
  }).sort({ createdAt: 1 });
}

async function routeToWholesaler(order) {
  const inventoryCheck = {};
  for (const item of order.items) {
    inventoryCheck[item.medicine.toString()] = item.quantity;
  }

  const wholesalers = await Wholesaler.find({
    _id: { $nin: order.attemptedWholesalers || [] },
  })
    .populate({ path: 'user', match: { verificationStatus: 'APPROVED' } })
    .populate('inventory.medicine')
    .sort({ priorityRank: 1, createdAt: 1 });

  const candidate = wholesalers.find((w) => {
    if (!w.user) return false;
    return Object.entries(inventoryCheck).every(([medicineId, qty]) => {
      const stock = w.inventory.find(
        (inv) => inv.medicine && String(inv.medicine._id) === medicineId
      );
      return stock && stock.quantity >= qty;
    });
  });

  return candidate || null;
}

async function deductInventory(wholesalerId, items) {
  const wholesaler = await Wholesaler.findById(wholesalerId);
  if (!wholesaler) throw new Error('Wholesaler not found');

  for (const item of items) {
    const medicineId = String(item.medicine);
    const entry = wholesaler.inventory.find((inv) => String(inv.medicine) === medicineId);
    if (!entry || entry.quantity < item.quantity) {
      throw new Error(`Insufficient stock for medicine ${item.medicineName || medicineId}`);
    }
    entry.quantity -= item.quantity;
  }

  await wholesaler.save();
  return wholesaler;
}

async function redirectOrRejectOrder(order, waitMinutes) {
  const next = await routeToWholesaler(order);
  if (!next) {
    await Order.findByIdAndUpdate(order._id, { status: 'REJECTED', wholesaler: null });
    const live = await hydrateOrder(order._id);
    emitOrderEvent('order:updated', live);
    return { status: 'REJECTED', message: 'No alternative wholesaler found.' };
  }

  await Order.findByIdAndUpdate(order._id, {
    status: 'WAITING_WHOLESALER',
    wholesaler: next._id,
    wholesalerResponseDeadline: new Date(Date.now() + waitMinutes * 60 * 1000),
    $push: { attemptedWholesalers: next._id },
  });
  const live = await hydrateOrder(order._id);
  emitOrderEvent('order:updated', live);
  return { status: 'WAITING_WHOLESALER', message: 'Order redirected to next priority wholesaler.' };
}

module.exports = {
  randomOtp,
  generateBillNumber,
  hydrateOrder,
  findAssignableDeliveryPartner,
  routeToWholesaler,
  deductInventory,
  redirectOrRejectOrder,
};
