const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Wholesaler = require('../models/Wholesaler');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { issueTokenPair, rotateRefreshToken, hashToken } = require('../utils/tokens');
const {
  VALID_ROLES,
  phoneDigits,
  escapeRegex,
  passwordMeetsPolicy,
  isValidIndianMobile,
  isValidEmail,
  validateRoleProfile,
} = require('../utils/validation');

function publicUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone,
    verificationStatus: user.verificationStatus,
    profile: user.profile || {},
  };
}

router.post('/register', async (req, res) => {
  const { email, password, name, role, phone, profile = {} } = req.body;

  try {
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid account role' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email format' });
    }
    const localPhone = phoneDigits(phone);
    if (!isValidIndianMobile(localPhone)) {
      return res.status(400).json({ success: false, message: 'Phone must be a valid 10-digit Indian mobile number' });
    }
    if (!passwordMeetsPolicy(password)) {
      return res.status(400).json({
        success: false,
        message: 'Password must be 8+ characters with upper, lower, number, and special character',
      });
    }

    const profileErrors = validateRoleProfile(role, profile);
    if (profileErrors.length) {
      return res.status(400).json({ success: false, message: profileErrors.join('. ') });
    }

    if (role === 'ADMIN' && profile.adminCode !== (process.env.ADMIN_CODE || 'MEDI-ADMIN-2026')) {
      return res.status(403).json({ success: false, message: 'Invalid admin access code' });
    }

    const regEmail = String(email).trim();
    const existingUser = await User.findOne({
      email: new RegExp(`^${escapeRegex(regEmail)}$`, 'i'),
    });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    let user;
    try {
      user = await User.create({
        email: String(email).trim().toLowerCase(),
        password: hashedPassword,
        name: String(name).trim(),
        role,
        phone: localPhone,
        profile,
        verificationStatus: role === 'ADMIN' ? 'APPROVED' : 'PENDING',
      });

      if (role === 'WHOLESALER') {
        await Wholesaler.create({
          user: user._id,
          shopName: String(profile.shopName).trim(),
          address: String(profile.shopAddress).trim(),
          city: String(profile.city).trim(),
          priorityRank: 100,
          location: {
            type: 'Point',
            coordinates: [Number(profile.lng), Number(profile.lat)],
          },
          inventory: [],
        });
      }
    } catch (createErr) {
      if (user?._id) await User.findByIdAndDelete(user._id);
      throw createErr;
    }

    res.status(201).json({
      success: true,
      message: role === 'ADMIN'
        ? 'Admin account created. You can sign in now.'
        : 'Account created. Awaiting admin verification before full access.',
      user: publicUser(user),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Registration failed: ' + err.message });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email format' });
    }

    const trimmedEmail = String(email).trim();
    const user = await User.findOne({
      email: new RegExp(`^${escapeRegex(trimmedEmail)}$`, 'i'),
    }).select('+password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid password' });
    }

    if (user.verificationStatus === 'REJECTED') {
      return res.status(403).json({ success: false, message: 'Account rejected by admin' });
    }

    if (user.role === 'ADMIN' && user.profile?.adminCode !== (process.env.ADMIN_CODE || 'MEDI-ADMIN-2026')) {
      return res.status(403).json({ success: false, message: 'Admin profile is not authorized' });
    }

    const tokenPair = await issueTokenPair(user);

    res.json({
      success: true,
      token: tokenPair.accessToken,
      accessToken: tokenPair.accessToken,
      refreshToken: tokenPair.refreshToken,
      expiresIn: tokenPair.expiresIn,
      user: publicUser(user),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Login failed: ' + err.message });
  }
});

router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ success: false, message: 'refreshToken is required' });
  }

  try {
    const refreshTokenHash = hashToken(refreshToken);
    const user = await User.findOne({ refreshTokenHash }).select('+refreshTokenHash +refreshTokenExpiresAt');
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid refresh token' });
    }

    const tokenPair = await rotateRefreshToken(user, refreshToken);
    if (!tokenPair) {
      return res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
    }

    return res.json({
      success: true,
      token: tokenPair.accessToken,
      accessToken: tokenPair.accessToken,
      refreshToken: tokenPair.refreshToken,
      expiresIn: tokenPair.expiresIn,
      user: publicUser(user),
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Token refresh failed: ' + err.message });
  }
});

router.get('/me', async (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    return res.status(401).json({ success: false, message: 'Missing token' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    return res.json({ success: true, user: publicUser(user) });
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
});

module.exports = router;
