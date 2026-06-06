function requireEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return String(value).trim();
}

function loadEnv() {
  requireEnv('MONGO_URI');
  requireEnv('JWT_SECRET');

  if (String(process.env.JWT_SECRET).length < 32) {
    console.warn('⚠️  JWT_SECRET should be at least 32 characters for production security.');
  }

  return {
    port: Number(process.env.PORT) || 5000,
    mongoUri: process.env.MONGO_URI,
    jwtSecret: process.env.JWT_SECRET,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
    adminCode: process.env.ADMIN_CODE || 'MEDI-ADMIN-2026',
    corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    wholesalerWaitMinutes: Number(process.env.WHOLESALER_WAIT_MINUTES) || 5,
    nodeEnv: process.env.NODE_ENV || 'development',
  };
}

module.exports = { loadEnv, requireEnv };
