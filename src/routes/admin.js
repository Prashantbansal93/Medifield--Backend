const express = require('express');
const User = require('../models/User');
const Order = require('../models/Order');
const Wholesaler = require('../models/Wholesaler');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(auth, requireRole('ADMIN'));

router.get('/overview', async (req, res) => {
  try {
    const [retailers, wholesalers, deliveries, totalOrders, activeDeliveries, pendingVerifications, recentOrders] =
      await Promise.all([
        User.countDocuments({ role: 'RETAILER' }),
        User.countDocuments({ role: 'WHOLESALER' }),
        User.countDocuments({ role: 'DELIVERY' }),
        Order.countDocuments(),
        Order.countDocuments({ status: { $in: ['ACCEPTED', 'PACKED', 'PICKED', 'OUT_FOR_DELIVERY'] } }),
        User.countDocuments({ verificationStatus: 'PENDING' }),
        Order.find()
          .sort({ createdAt: -1 })
          .limit(10)
          .populate('retailer', 'name')
          .populate('deliveryPartner', 'name'),
      ]);

    res.json({
      success: true,
      metrics: {
        retailers,
        wholesalers,
        deliveries,
        totalOrders,
        activeDeliveries,
        pendingVerifications,
      },
      recentOrders,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Could not fetch admin overview' });
  }
});

router.get('/users', async (req, res) => {
  try {
    const { role, verificationStatus } = req.query;
    const filter = {};
    if (role) filter.role = role;
    if (verificationStatus) filter.verificationStatus = verificationStatus;

    const users = await User.find(filter)
      .select('-password')
      .sort({ createdAt: -1 })
      .limit(200);

    return res.json({ success: true, users });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.patch('/users/:id/verify', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['APPROVED', 'REJECTED', 'PENDING'].includes(status)) {
      return res.status(400).json({ success: false, message: 'status must be APPROVED, REJECTED, or PENDING' });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.role === 'ADMIN') {
      return res.status(400).json({ success: false, message: 'Cannot change admin verification status' });
    }

    user.verificationStatus = status;
    await user.save();

    return res.json({
      success: true,
      message: `User verification updated to ${status}`,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        verificationStatus: user.verificationStatus,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.patch('/wholesalers/:id/priority', async (req, res) => {
  try {
    const { priorityRank } = req.body;
    if (!Number.isFinite(Number(priorityRank)) || Number(priorityRank) < 1) {
      return res.status(400).json({ success: false, message: 'priorityRank must be a positive number' });
    }

    const wholesaler = await Wholesaler.findByIdAndUpdate(
      req.params.id,
      { priorityRank: Number(priorityRank) },
      { new: true }
    );
    if (!wholesaler) return res.status(404).json({ success: false, message: 'Wholesaler not found' });

    return res.json({ success: true, message: 'Priority updated', wholesaler });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
