const crypto = require('crypto');
const { logger } = require('./logger');

const OTP_TTL_MS = 10 * 60 * 1000;
const store = new Map();

function otpKey(channel, destination, purpose) {
  return `${purpose}:${channel}:${destination}`;
}

function generateOtp() {
  return String(crypto.randomInt(100000, 999999));
}

function hashOtp(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function setOtp({ channel, destination, purpose }) {
  const code = generateOtp();
  const key = otpKey(channel, destination, purpose);
  store.set(key, {
    codeHash: hashOtp(code),
    expiresAt: Date.now() + OTP_TTL_MS,
    attempts: 0,
  });

  const isDev = process.env.NODE_ENV !== 'production';
  logger.info(
    { channel, destination: String(destination).slice(-4), purpose, ...(isDev ? { code } : {}) },
    'OTP issued'
  );

  return {
    expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
    ...(isDev ? { devOtp: code } : {}),
  };
}

function verifyOtp({ channel, destination, purpose, code }) {
  const key = otpKey(channel, destination, purpose);
  const entry = store.get(key);
  if (!entry) {
    return { ok: false, message: 'OTP expired or not requested. Request a new code.' };
  }
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return { ok: false, message: 'OTP expired. Request a new code.' };
  }
  entry.attempts += 1;
  if (entry.attempts > 5) {
    store.delete(key);
    return { ok: false, message: 'Too many invalid attempts. Request a new code.' };
  }
  if (entry.codeHash !== hashOtp(code)) {
    return { ok: false, message: 'Invalid OTP' };
  }
  store.delete(key);
  return { ok: true };
}

module.exports = {
  setOtp,
  verifyOtp,
  OTP_TTL_MS,
};
