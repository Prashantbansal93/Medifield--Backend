const jwt = require('jsonwebtoken');
const User = require('../models/User');

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    return res.status(401).json({ success: false, message: 'Missing authentication token' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    return next();
  } catch (err) {
    const message = err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token';
    return res.status(401).json({ success: false, message });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }
    return next();
  };
}

async function requireVerified(req, res, next) {
  if (req.user.role === 'ADMIN') return next();

  try {
    const user = await User.findById(req.user.id).select('verificationStatus role');
    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }
    if (user.verificationStatus === 'REJECTED') {
      return res.status(403).json({ success: false, message: 'Account rejected by admin' });
    }
    if (user.verificationStatus !== 'APPROVED') {
      return res.status(403).json({
        success: false,
        message: 'Account pending admin verification',
        verificationStatus: user.verificationStatus,
      });
    }
    return next();
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Verification check failed' });
  }
}

module.exports = { auth, requireRole, requireVerified };
