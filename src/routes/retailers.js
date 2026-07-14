const express = require('express');
const User = require('../models/User');
const Order = require('../models/Order');
const { auth, requireRole, requireVerified } = require('../middleware/auth');
const { phoneDigits, isValidIndianMobile, isValidUrl } = require('../utils/validation');
const { formatOrderBill } = require('../utils/orderBill');

const router = express.Router();

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

router.get('/profile', auth, requireRole('RETAILER'), requireVerified, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    return res.json({ success: true, user: publicUser(user) });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/profile', auth, requireRole('RETAILER'), requireVerified, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const { name, phone, profile = {} } = req.body;
    const errors = [];

    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (!trimmed) errors.push('Name cannot be empty');
      else user.name = trimmed;
    }

    if (phone !== undefined) {
      const localPhone = phoneDigits(phone);
      if (!isValidIndianMobile(localPhone)) {
        errors.push('Phone must be a valid 10-digit Indian mobile number');
      } else {
        const phoneTaken = await User.findOne({ phone: localPhone, _id: { $ne: user._id } });
        if (phoneTaken) errors.push('Phone number already in use');
        else user.phone = localPhone;
      }
    }

    const allowedProfileFields = [
      'shopAddress', 'city', 'pinCode', 'lat', 'lng', 'gstNumber', 'profileImageUrl',
    ];
    for (const field of allowedProfileFields) {
      if (profile[field] !== undefined) {
        user.profile[field] = profile[field];
      }
    }

    if (profile.lat !== undefined || profile.lng !== undefined) {
      const lat = Number(profile.lat ?? user.profile?.lat);
      const lng = Number(profile.lng ?? user.profile?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        errors.push('Valid latitude and longitude are required');
      } else {
        user.profile.lat = lat;
        user.profile.lng = lng;
      }
    }

    if (profile.profileImageUrl !== undefined && profile.profileImageUrl) {
      if (!isValidUrl(profile.profileImageUrl)) {
        errors.push('Profile image URL must be a valid http/https link');
      }
    }

    const restrictedFields = ['aadhaarNumber', 'licenseNumber', 'documentUrls', 'aadhaarImageUrl', 'shopLicenseImageUrl'];
    const attemptedRestricted = restrictedFields.filter((f) => profile[f] !== undefined);
    if (attemptedRestricted.length) {
      errors.push(
        `${attemptedRestricted.join(', ')} cannot be changed here. Contact admin for document updates.`
      );
    }

    if (errors.length) {
      return res.status(400).json({ success: false, message: errors.join('. ') });
    }

    await user.save();
    return res.json({
      success: true,
      message: 'Profile updated successfully',
      user: publicUser(user),
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/orders/history', auth, requireRole('RETAILER'), requireVerified, async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    const status = String(req.query.status || 'DELIVERED').toUpperCase();

    const allowedStatuses = ['DELIVERED', 'REJECTED', 'FAILED', 'CANCELLED', 'ALL'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'status must be DELIVERED, REJECTED, FAILED, CANCELLED, or ALL',
      });
    }

    const filter = { retailer: req.user.id };
    if (status !== 'ALL') filter.status = status;

    const [total, orders] = await Promise.all([
      Order.countDocuments(filter),
      Order.find(filter)
        .sort({ deliveredAt: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('deliveryPartner', 'name phone')
        .populate('items.medicine', 'name company'),
    ]);

    const history = orders.map(formatOrderBill);

    return res.json({
      success: true,
      history,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/orders/history/:orderId', auth, requireRole('RETAILER'), requireVerified, async (req, res) => {
  try {
    const order = await Order.findOne({
      _id: req.params.orderId,
      retailer: req.user.id,
      status: { $in: ['DELIVERED', 'CANCELLED'] },
    })
      .populate('deliveryPartner', 'name phone')
      .populate('items.medicine', 'name company');

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order bill not found' });
    }

    return res.json({ success: true, bill: formatOrderBill(order) });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
