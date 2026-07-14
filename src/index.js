const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const http = require('http');
const pinoHttp = require('pino-http');
const { loadEnv } = require('./config/env');
const { logger } = require('./utils/logger');
const authRoutes = require('./routes/auth');
const orderRoutes = require('./routes/orders');
const medicineRoutes = require('./routes/medicines');
const adminRoutes = require('./routes/admin');
const wholesalerRoutes = require('./routes/wholesalers');
const retailerRoutes = require('./routes/retailers');
const notificationRoutes = require('./routes/notifications');
const { initRealtime } = require('./realtime');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { startWholesalerTimeoutJob } = require('./jobs/wholesalerTimeout');
const { UPLOAD_ROOT } = require('./middleware/upload');

dotenv.config();

let config;
try {
  config = loadEnv();
} catch (err) {
  logger.error({ err }, 'Environment validation failed');
  process.exit(1);
}

const app = express();
const server = http.createServer(app);

mongoose
  .connect(config.mongoUri)
  .then(() => logger.info('MongoDB connected'))
  .catch((err) => {
    logger.error({ err }, 'MongoDB connection failed');
    process.exit(1);
  });

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(
  cors({
    origin: config.corsOrigin,
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(
  pinoHttp({
    logger,
    autoLogging: { ignore: (req) => req.url === '/health' },
  })
);

app.use('/uploads', express.static(UPLOAD_ROOT));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { success: false, message: 'Too many auth attempts, please try again later.' },
});

app.use('/api/', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/otp/send', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password', authLimiter);

app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Medifield API is running',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get('/', (req, res) => {
  res.json({ success: true, message: 'Medifield API is running!' });
});

app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/medicines', medicineRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/wholesalers', wholesalerRoutes);
app.use('/api/retailers', retailerRoutes);
app.use('/api/notifications', notificationRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

initRealtime(server, config.corsOrigin).catch((err) => {
  logger.error({ err }, 'Socket.IO initialization failed');
});

startWholesalerTimeoutJob(config.wholesalerWaitMinutes);

server.listen(config.port, () => {
  logger.info({ port: config.port, corsOrigin: config.corsOrigin }, 'Medifield server started');
});

function shutdown(signal) {
  logger.info({ signal }, 'Shutting down gracefully');
  server.close(() => {
    mongoose.connection.close(false).then(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
