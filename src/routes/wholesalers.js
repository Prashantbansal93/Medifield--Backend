const express = require('express');
const Wholesaler = require('../models/Wholesaler');
const Medicine = require('../models/Medicine');
const { auth, requireRole, requireVerified } = require('../middleware/auth');

const router = express.Router();

async function getOwnWholesaler(userId) {
  return Wholesaler.findOne({ user: userId }).populate('inventory.medicine', 'name company mrp');
}

router.get('/profile', auth, requireRole('WHOLESALER'), requireVerified, async (req, res) => {
  try {
    const wholesaler = await getOwnWholesaler(req.user.id);
    if (!wholesaler) {
      return res.status(404).json({ success: false, message: 'Wholesaler profile not found' });
    }
    return res.json({ success: true, wholesaler });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/profile', auth, requireRole('WHOLESALER'), requireVerified, async (req, res) => {
  try {
    const { shopName, address, city, lat, lng } = req.body;
    const wholesaler = await Wholesaler.findOne({ user: req.user.id });
    if (!wholesaler) {
      return res.status(404).json({ success: false, message: 'Wholesaler profile not found' });
    }

    if (shopName) wholesaler.shopName = String(shopName).trim();
    if (address) wholesaler.address = String(address).trim();
    if (city) wholesaler.city = String(city).trim();
    if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
      wholesaler.location = { type: 'Point', coordinates: [Number(lng), Number(lat)] };
    }

    await wholesaler.save();
    return res.json({ success: true, message: 'Profile updated', wholesaler });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/inventory', auth, requireRole('WHOLESALER'), requireVerified, async (req, res) => {
  try {
    const wholesaler = await getOwnWholesaler(req.user.id);
    if (!wholesaler) {
      return res.status(404).json({ success: false, message: 'Wholesaler profile not found' });
    }
    return res.json({ success: true, inventory: wholesaler.inventory });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/inventory', auth, requireRole('WHOLESALER'), requireVerified, async (req, res) => {
  try {
    const { medicineId, quantity, price } = req.body;
    if (!medicineId) {
      return res.status(400).json({ success: false, message: 'medicineId is required' });
    }

    const medicine = await Medicine.findById(medicineId);
    if (!medicine) {
      return res.status(404).json({ success: false, message: 'Medicine not found' });
    }

    const qty = Math.max(0, Number(quantity));
    const unitPrice = Math.max(1, Number(price || medicine.mrp));

    const wholesaler = await Wholesaler.findOne({ user: req.user.id });
    if (!wholesaler) {
      return res.status(404).json({ success: false, message: 'Wholesaler profile not found' });
    }

    const existing = wholesaler.inventory.find((item) => String(item.medicine) === String(medicineId));
    if (existing) {
      existing.quantity = qty;
      existing.price = unitPrice;
    } else {
      wholesaler.inventory.push({ medicine: medicineId, quantity: qty, price: unitPrice });
    }

    await wholesaler.save();
    const updated = await getOwnWholesaler(req.user.id);
    return res.json({ success: true, message: 'Inventory updated', inventory: updated.inventory });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/inventory/:medicineId', auth, requireRole('WHOLESALER'), requireVerified, async (req, res) => {
  try {
    const wholesaler = await Wholesaler.findOne({ user: req.user.id });
    if (!wholesaler) {
      return res.status(404).json({ success: false, message: 'Wholesaler profile not found' });
    }

    wholesaler.inventory = wholesaler.inventory.filter(
      (item) => String(item.medicine) !== String(req.params.medicineId)
    );
    await wholesaler.save();
    return res.json({ success: true, message: 'Inventory item removed' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
