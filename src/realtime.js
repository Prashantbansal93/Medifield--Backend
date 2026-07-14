const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

let ioRef = null;

async function initRealtime(httpServer, corsOrigin) {
  const io = new Server(httpServer, {
    cors: {
      origin: corsOrigin || process.env.CORS_ORIGIN || 'http://localhost:3000',
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    try {
      const { createAdapter } = require('@socket.io/redis-adapter');
      const { createClient } = require('redis');
      const pubClient = createClient({ url: redisUrl });
      const subClient = pubClient.duplicate();
      await Promise.all([pubClient.connect(), subClient.connect()]);
      io.adapter(createAdapter(pubClient, subClient));
      console.log('[socket.io] Redis adapter enabled for multi-instance scaling');
    } catch (err) {
      console.warn('[socket.io] Redis adapter failed — using in-memory mode:', err.message);
    }
  } else {
    console.log('[socket.io] REDIS_URL not set — using in-memory adapter (single instance)');
  }

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

function emitNotification(userId, notification) {
  if (!ioRef || !userId || !notification) return;
  ioRef.to(`user:${userId}`).emit('notification:new', notification);
}

module.exports = { initRealtime, emitOrderEvent, emitNotification };
