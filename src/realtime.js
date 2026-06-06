const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

let ioRef = null;

function initRealtime(httpServer, corsOrigin) {
  const io = new Server(httpServer, {
    cors: {
      origin: corsOrigin || process.env.CORS_ORIGIN || 'http://localhost:3000',
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Missing token'));
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = payload;
      return next();
    } catch (err) {
      return next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.user;
    socket.join(`user:${user.id}`);
    socket.join(`role:${user.role}`);
    socket.emit('connected', { userId: user.id, role: user.role });
  });

  ioRef = io;
  return io;
}

function emitOrderEvent(event, order) {
  if (!ioRef || !order) return;

  const retailerId = order.retailer?._id || order.retailer;
  const deliveryId = order.deliveryPartner?._id || order.deliveryPartner;
  const wholesalerUserId = order.wholesaler?.user?._id || order.wholesaler?.user;

  ioRef.to('role:ADMIN').emit(event, order);
  if (retailerId) ioRef.to(`user:${retailerId}`).emit(event, order);
  if (deliveryId) ioRef.to(`user:${deliveryId}`).emit(event, order);
  if (wholesalerUserId) ioRef.to(`user:${wholesalerUserId}`).emit(event, order);
}

module.exports = { initRealtime, emitOrderEvent };
