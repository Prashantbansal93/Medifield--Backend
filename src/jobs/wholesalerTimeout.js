const Order = require('../models/Order');
const { redirectOrRejectOrder } = require('../utils/orderHelpers');
const { notifyOrderEvent } = require('../utils/notifications');
const { logger } = require('../utils/logger');

function startWholesalerTimeoutJob(waitMinutes = 5) {
  const intervalMs = 30 * 1000;

  const tick = async () => {
    try {
      const expiredOrders = await Order.find({
        status: 'WAITING_WHOLESALER',
        wholesalerResponseDeadline: { $lte: new Date() },
      });

      for (const order of expiredOrders) {
        const result = await redirectOrRejectOrder(order, waitMinutes);
        if (result.status === 'WAITING_WHOLESALER') {
          await notifyOrderEvent(order, 'REDIRECTED', 'Wholesaler timed out — order redirected.');
        } else if (result.status === 'REJECTED') {
          await notifyOrderEvent(order, 'REJECTED', 'No wholesaler accepted in time.');
        }
        logger.info({ orderId: order._id, result: result.status }, 'Wholesaler timeout processed');
      }
    } catch (err) {
      logger.error({ err }, 'Wholesaler timeout job error');
    }
  };

  const timer = setInterval(tick, intervalMs);
  tick();
  logger.info({ intervalMs, waitMinutes }, 'Wholesaler timeout job started');
  return timer;
}

module.exports = { startWholesalerTimeoutJob };
