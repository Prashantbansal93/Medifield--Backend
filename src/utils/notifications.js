const Notification = require('../models/Notification');
const { emitNotification } = require('../realtime');

const ORDER_EVENT_MAP = {
  PLACED: { type: 'ORDER_PLACED', title: 'Order placed', roles: ['RETAILER'] },
  WAITING_WHOLESALER: { type: 'ORDER_WAITING', title: 'New order request', roles: ['WHOLESALER'] },
  ACCEPTED: { type: 'ORDER_ACCEPTED', title: 'Order accepted', roles: ['RETAILER', 'DELIVERY'] },
  PACKED: { type: 'ORDER_PACKED', title: 'Order packed', roles: ['RETAILER', 'DELIVERY'] },
  PICKED: { type: 'ORDER_PICKED', title: 'Order picked up', roles: ['RETAILER'] },
  OUT_FOR_DELIVERY: { type: 'ORDER_OUT_FOR_DELIVERY', title: 'Out for delivery', roles: ['RETAILER', 'ADMIN'] },
  DELIVERED: { type: 'ORDER_DELIVERED', title: 'Order delivered', roles: ['RETAILER', 'WHOLESALER', 'ADMIN'] },
  REJECTED: { type: 'ORDER_REJECTED', title: 'Order rejected', roles: ['RETAILER'] },
  FAILED: { type: 'ORDER_FAILED', title: 'Order failed', roles: ['RETAILER'] },
  CANCELLED: { type: 'ORDER_CANCELLED', title: 'Order cancelled', roles: ['WHOLESALER', 'DELIVERY', 'ADMIN', 'RETAILER'] },
  CANCEL_REQUESTED: { type: 'ORDER_CANCEL_REQUESTED', title: 'Cancel request', roles: ['WHOLESALER'] },
  REDIRECTED: { type: 'ORDER_REDIRECTED', title: 'Order redirected', roles: ['WHOLESALER', 'RETAILER'] },
};

async function createNotification({ userId, type, title, message, orderId }) {
  const notification = await Notification.create({
    user: userId,
    type,
    title,
    message,
    order: orderId || undefined,
  });
  emitNotification(userId, notification);
  return notification;
}

async function notifyUsers(userIds, payload) {
  const unique = [...new Set(userIds.filter(Boolean).map(String))];
  return Promise.all(unique.map((userId) => createNotification({ userId, ...payload })));
}

async function notifyOrderEvent(order, eventKey, customMessage) {
  const config = ORDER_EVENT_MAP[eventKey];
  if (!config) return [];

  const retailerId = order.retailer?._id || order.retailer;
  const deliveryId = order.deliveryPartner?._id || order.deliveryPartner;
  const wholesalerUserId = order.wholesaler?.user?._id || order.wholesaler?.user;

  const roleToUser = {
    RETAILER: retailerId,
    DELIVERY: deliveryId,
    WHOLESALER: wholesalerUserId,
    ADMIN: null,
  };

  const recipients = [];
  for (const role of config.roles) {
    if (role === 'ADMIN') {
      const User = require('../models/User');
      const admins = await User.find({ role: 'ADMIN', verificationStatus: 'APPROVED' }).select('_id');
      recipients.push(...admins.map((a) => String(a._id)));
    } else if (roleToUser[role]) {
      recipients.push(String(roleToUser[role]));
    }
  }

  const billRef = order.billNumber || `#${String(order._id || '').slice(-6).toUpperCase()}`;
  const message = customMessage || `${config.title}: ${billRef} is now ${eventKey.replace(/_/g, ' ').toLowerCase()}.`;

  return notifyUsers(recipients, {
    type: config.type,
    title: config.title,
    message,
    orderId: order._id,
  });
}

module.exports = {
  ORDER_EVENT_MAP,
  createNotification,
  notifyUsers,
  notifyOrderEvent,
};
