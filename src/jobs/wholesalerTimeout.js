const Order = require('../models/Order');
const { redirectOrRejectOrder } = require('../utils/orderHelpers');

function startWholesalerTimeoutJob(waitMinutes = 5) {
  const intervalMs = 30 * 1000;

  const tick = async () => {
    try {
      const expiredOrders = await Order.find({
        status: 'WAITING_WHOLESALER',
        wholesalerResponseDeadline: { $lte: new Date() },
      });

      for (const order of expiredOrders) {
        await redirectOrRejectOrder(order, waitMinutes);
      }
    } catch (err) {
      console.error('Wholesaler timeout job error:', err.message);
    }
  };

  const timer = setInterval(tick, intervalMs);
  tick();
  return timer;
}

module.exports = { startWholesalerTimeoutJob };
