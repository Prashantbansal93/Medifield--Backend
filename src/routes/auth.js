const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Wholesaler = require('../models/Wholesaler');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { issueTokenPair, rotateRefreshToken, hashToken } = require('../utils/tokens');
const { setOtp, verifyOtp } = require('../utils/otp');
const { documentUpload, publicUploadPath } = require('../middleware/upload');
const {
  VALID_ROLES,
  phoneDigits,
  escapeRegex,
  passwordMeetsPolicy,
  isValidIndianMobile,
  isValidEmail,
  validateRoleProfile,
  normalizeVerificationDocuments,
} = require('../utils/validation');

const CITY_COORDS = {
  Jaipur: [75.7873, 26.9124],
  Delhi: [77.209, 28.6139],
  Mumbai: [72.8777, 19.076],
  Ahmedabad: [72.5714, 23.0225],
  Pune: [73.8567, 18.5204],
  Bengaluru: [77.5946, 12.9716],
  Hyderabad: [78.4867, 17.385],
  Lucknow: [80.9462, 26.8467],
};

function publicUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone,
    verificationStatus: user.verificationStatus,
    phoneVerifiedAt: user.phoneVerifiedAt || null,
    profile: user.profile || {},
  };
}

function parseProfileBody(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return {};
  }
}

function attachUploadUrls(req, profile) {
  const next = { ...profile };
  if (req.files?.aadhaarImage?.[0]) {
    next.aadhaarImageUrl = publicUploadPath(req.files.aadhaarImage[0].path);
  }
  if (req.files?.shopLicenseImage?.[0]) {
    next.shopLicenseImageUrl = publicUploadPath(req.files.shopLicenseImage[0].path);
  }
  return normalizeVerificationDocuments(next);
}

async function createWholesalerForUser(user, profile) {
  const lat = Number(profile.lat);
  const lng = Number(profile.lng);
  const cityFallback = CITY_COORDS[String(profile.city || '').trim()] || CITY_COORDS.Jaipur;
  const coordinates =
    Number.isFinite(lat) && Number.isFinite(lng) ? [lng, lat] : cityFallback;

  await Wholesaler.create({
    user: user._id,
    shopName: String(profile.shopName).trim(),
    address: String(profile.shopAddress).trim(),
    city: String(profile.city).trim(),
    priorityRank: 100,
    location: { type: 'Point', coordinates },
    inventory: [],
  });
}

router.post('/check-phone', async (req, res) => {
  try {
    const phone = phoneDigits(req.body.phone);
    if (!isValidIndianMobile(phone)) {
      return res.status(400).json({ success: false, message: 'Enter a valid 10-digit Indian mobile number' });
    }
    const user = await User.findOne({ phone });
    if (!user) {
      return res.json({ success: true, exists: false, next: 'register' });
    }
    return res.json({
      success: true,
      exists: true,
      next: 'login',
      role: user.role,
      name: user.name,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Phone check failed' });
  }
});

router.post('/otp/send', async (req, res) => {
  try {
    const { purpose = 'verify_phone', channel } = req.body;
    const allowed = ['verify_phone', 'register', 'reset_password'];
    if (!allowed.includes(purpose)) {
      return res.status(400).json({ success: false, message: 'Invalid OTP purpose' });
    }

    if (channel === 'email' || (req.body.email && !req.body.phone)) {
      const email = String(req.body.email || '').trim().toLowerCase();
      if (!isValidEmail(email)) {
        return res.status(400).json({ success: false, message: 'Invalid email' });
      }
      if (purpose === 'reset_password') {
        const user = await User.findOne({ email: new RegExp(`^${escapeRegex(email)}$`, 'i') });
        if (!user) {
          return res.json({
            success: true,
            message: 'If an account exists, an OTP has been sent.',
            channel: 'email',
            expiresInSeconds: 600,
          });
        }
      }
      const issued = setOtp({ channel: 'email', destination: email, purpose });
      return res.json({
        success: true,
        message: 'OTP sent to email (check inbox / server logs in development).',
        channel: 'email',
        ...issued,
      });
    }

    const phone = phoneDigits(req.body.phone);
    if (!isValidIndianMobile(phone)) {
      return res.status(400).json({ success: false, message: 'Enter a valid 10-digit Indian mobile number' });
    }

    if (purpose === 'reset_password') {
      const user = await User.findOne({ phone });
      if (!user) {
        return res.json({
          success: true,
          message: 'If an account exists, an OTP has been sent.',
          channel: 'phone',
          expiresInSeconds: 600,
        });
      }
    }

    if (purpose === 'register') {
      const existing = await User.findOne({ phone });
      if (existing) {
        return res.status(400).json({ success: false, message: 'Phone already registered. Please sign in.' });
      }
    }

    const issued = setOtp({ channel: 'phone', destination: phone, purpose });
    return res.json({
      success: true,
      message: 'OTP sent to your phone (shown in API response in development).',
      channel: 'phone',
      ...issued,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to send OTP' });
  }
});

router.post('/otp/verify', async (req, res) => {
  try {
    const { otp, purpose = 'verify_phone' } = req.body;
    if (!otp || String(otp).length < 4) {
      return res.status(400).json({ success: false, message: 'OTP is required' });
    }

    if (req.body.email && !req.body.phone) {
      const email = String(req.body.email).trim().toLowerCase();
      const result = verifyOtp({ channel: 'email', destination: email, purpose, code: otp });
      if (!result.ok) return res.status(400).json({ success: false, message: result.message });
      return res.json({ success: true, verified: true, channel: 'email' });
    }

    const phone = phoneDigits(req.body.phone);
    if (!isValidIndianMobile(phone)) {
      return res.status(400).json({ success: false, message: 'Invalid phone' });
    }
    const result = verifyOtp({ channel: 'phone', destination: phone, purpose, code: otp });
    if (!result.ok) return res.status(400).json({ success: false, message: result.message });

    await User.updateOne({ phone }, { $set: { phoneVerifiedAt: new Date() } });
    return res.json({ success: true, verified: true, channel: 'phone' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'OTP verification failed' });
  }
});

const registerUpload = documentUpload.fields([
  { name: 'aadhaarImage', maxCount: 1 },
  { name: 'shopLicenseImage', maxCount: 1 },
]);

router.post('/register', (req, res, next) => {
  registerUpload(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message || 'File upload failed' });
    }
    return next();
  });
}, async (req, res) => {
  const email = req.body.email;
  const password = req.body.password;
  const name = req.body.name;
  const role = req.body.role;
  const phone = req.body.phone;
  const otp = req.body.otp;
  let profile = parseProfileBody(req.body.profile);

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

    if (role === 'RETAILER' || role === 'WHOLESALER' || role === 'DELIVERY') {
      if (!otp) {
        return res.status(400).json({ success: false, message: 'Phone OTP is required to register' });
      }
      const otpResult = verifyOtp({
        channel: 'phone',
        destination: localPhone,
        purpose: 'register',
        code: otp,
      });
      if (!otpResult.ok) {
        return res.status(400).json({ success: false, message: otpResult.message });
      }
    }

    profile = attachUploadUrls(req, profile);
    const profileErrors = validateRoleProfile(role, profile);
    if (profileErrors.length) {
      return res.status(400).json({ success: false, message: profileErrors.join('. ') });
    }
    profile = normalizeVerificationDocuments(profile);

    if (role === 'ADMIN' && profile.adminCode !== (process.env.ADMIN_CODE || 'MEDI-ADMIN-2026')) {
      return res.status(403).json({ success: false, message: 'Invalid admin access code' });
    }

    const regEmail = String(email).trim();
    const existingUser = await User.findOne({
      $or: [
        { email: new RegExp(`^${escapeRegex(regEmail)}$`, 'i') },
        { phone: localPhone },
      ],
    });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'User already exists with this email or phone' });
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
        phoneVerifiedAt: role === 'ADMIN' ? null : new Date(),
        verificationStatus: role === 'ADMIN' ? 'APPROVED' : 'PENDING',
      });

      if (role === 'WHOLESALER') {
        await createWholesalerForUser(user, profile);
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
  const { email, phone, password } = req.body;

  try {
    if (!password) {
      return res.status(400).json({ success: false, message: 'Password is required' });
    }

    let user;
    if (phone) {
      const localPhone = phoneDigits(phone);
      if (!isValidIndianMobile(localPhone)) {
        return res.status(400).json({ success: false, message: 'Invalid phone number' });
      }
      user = await User.findOne({ phone: localPhone }).select('+password');
    } else if (email) {
      if (!isValidEmail(email)) {
        return res.status(400).json({ success: false, message: 'Invalid email format' });
      }
      const trimmedEmail = String(email).trim();
      user = await User.findOne({
        email: new RegExp(`^${escapeRegex(trimmedEmail)}$`, 'i'),
      }).select('+password');
    } else {
      return res.status(400).json({ success: false, message: 'Email or phone is required' });
    }

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

router.post('/forgot-password', async (req, res) => {
  try {
    const { channel = 'phone' } = req.body;
    if (channel === 'email') {
      const email = String(req.body.email || '').trim().toLowerCase();
      if (!isValidEmail(email)) {
        return res.status(400).json({ success: false, message: 'Invalid email' });
      }
      const user = await User.findOne({ email: new RegExp(`^${escapeRegex(email)}$`, 'i') });
      if (!user) {
        return res.json({
          success: true,
          message: 'If an account exists, an OTP has been sent.',
          channel: 'email',
          expiresInSeconds: 600,
        });
      }
      const issued = setOtp({ channel: 'email', destination: email, purpose: 'reset_password' });
      return res.json({
        success: true,
        message: 'Password reset OTP sent to email.',
        channel: 'email',
        ...issued,
      });
    }

    const phone = phoneDigits(req.body.phone);
    if (!isValidIndianMobile(phone)) {
      return res.status(400).json({ success: false, message: 'Invalid phone number' });
    }
    const user = await User.findOne({ phone });
    if (!user) {
      return res.json({
        success: true,
        message: 'If an account exists, an OTP has been sent.',
        channel: 'phone',
        expiresInSeconds: 600,
      });
    }
    const issued = setOtp({ channel: 'phone', destination: phone, purpose: 'reset_password' });
    return res.json({
      success: true,
      message: 'Password reset OTP sent to your phone.',
      channel: 'phone',
      ...issued,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Forgot password failed' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { otp, newPassword, channel = 'phone' } = req.body;
    if (!passwordMeetsPolicy(newPassword)) {
      return res.status(400).json({
        success: false,
        message: 'Password must be 8+ characters with upper, lower, number, and special character',
      });
    }
    if (!otp) {
      return res.status(400).json({ success: false, message: 'OTP is required' });
    }

    let user;
    if (channel === 'email') {
      const email = String(req.body.email || '').trim().toLowerCase();
      if (!isValidEmail(email)) {
        return res.status(400).json({ success: false, message: 'Invalid email' });
      }
      const result = verifyOtp({ channel: 'email', destination: email, purpose: 'reset_password', code: otp });
      if (!result.ok) return res.status(400).json({ success: false, message: result.message });
      user = await User.findOne({ email: new RegExp(`^${escapeRegex(email)}$`, 'i') }).select('+password');
    } else {
      const phone = phoneDigits(req.body.phone);
      if (!isValidIndianMobile(phone)) {
        return res.status(400).json({ success: false, message: 'Invalid phone number' });
      }
      const result = verifyOtp({ channel: 'phone', destination: phone, purpose: 'reset_password', code: otp });
      if (!result.ok) return res.status(400).json({ success: false, message: result.message });
      user = await User.findOne({ phone }).select('+password');
    }

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.refreshTokenHash = undefined;
    user.refreshTokenExpiresAt = undefined;
    await user.save();

    return res.json({ success: true, message: 'Password updated. You can sign in now.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Password reset failed' });
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
