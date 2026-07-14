const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const ACCESS_EXPIRES = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
const REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

function parseDurationMs(duration) {
  const match = String(duration).match(/^(\d+)([smhd])$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const n = Number(match[1]);
  const unit = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2]];
  return n * unit;
}

function signAccessToken(user) {
  return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: ACCESS_EXPIRES,
  });
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateRefreshToken() {
  return crypto.randomBytes(48).toString('hex');
}

async function issueTokenPair(user) {
  const accessToken = signAccessToken(user);
  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashToken(refreshToken);
  const refreshTokenExpiresAt = new Date(Date.now() + parseDurationMs(REFRESH_EXPIRES));

  user.refreshTokenHash = refreshTokenHash;
  user.refreshTokenExpiresAt = refreshTokenExpiresAt;
  await user.save();

  return { accessToken, refreshToken, expiresIn: ACCESS_EXPIRES };
}

async function rotateRefreshToken(user, presentedRefreshToken) {
  const presentedHash = hashToken(presentedRefreshToken);
  if (
    !user.refreshTokenHash ||
    user.refreshTokenHash !== presentedHash ||
    !user.refreshTokenExpiresAt ||
    user.refreshTokenExpiresAt < new Date()
  ) {
    return null;
  }
  return issueTokenPair(user);
}

module.exports = {
  ACCESS_EXPIRES,
  REFRESH_EXPIRES,
  signAccessToken,
  hashToken,
  generateRefreshToken,
  issueTokenPair,
  rotateRefreshToken,
};
