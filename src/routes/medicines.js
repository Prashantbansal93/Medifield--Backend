const express = require('express');
const Medicine = require('../models/Medicine');
const Wholesaler = require('../models/Wholesaler');
const { auth, requireRole, requireVerified } = require('../middleware/auth');

const router = express.Router();

router.get('/search', auth, requireVerified, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ success: true, medicines: [] });

    const medicines = await Medicine.find({
      $or: [
        { name: { $regex: q, $options: 'i' } },
        { company: { $regex: q, $options: 'i' } },
        { category: { $regex: q, $options: 'i' } },
        { composition: { $regex: q, $options: 'i' } },
      ],
    })
      .skip((Math.max(1, Number(req.query.page) || 1) - 1) * Math.min(100, Math.max(1, Number(req.query.limit) || 20)))
      .limit(Math.min(100, Math.max(1, Number(req.query.limit) || 20)));

    const total = await Medicine.countDocuments({
      $or: [
        { name: { $regex: q, $options: 'i' } },
        { company: { $regex: q, $options: 'i' } },
        { category: { $regex: q, $options: 'i' } },
        { composition: { $regex: q, $options: 'i' } },
      ],
    });

    const wholesalerMatches = await Wholesaler.find({
      'inventory.medicine': { $in: medicines.map((m) => m._id) },
      'inventory.quantity': { $gt: 0 },
    })
      .populate('inventory.medicine')
      .sort({ priorityRank: 1 });

    const stockByMedicine = new Map();
    for (const med of medicines) {
      const medId = String(med._id);
      const vendors = wholesalerMatches
        .map((w) => {
          const inv = w.inventory.find(
            (i) => i.medicine && String(i.medicine._id) === medId && i.quantity > 0
          );
          if (!inv) return null;
          return {
            wholesalerId: w._id,
            shopName: w.shopName,
            quantity: inv.quantity,
            price: inv.price,
            priorityRank: w.priorityRank,
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.priorityRank - b.priorityRank);
      stockByMedicine.set(medId, vendors);
    }

    const result = medicines.map((med) => {
      const vendors = stockByMedicine.get(String(med._id)) || [];
      return {
        id: med._id,
        name: med.name,
        company: med.company,
        category: med.category,
        composition: med.composition,
        imageUrl: med.imageUrl || '',
        requiresPrescription: med.requiresPrescription,
        price: vendors[0]?.price || med.mrp,
        available: vendors.length > 0,
        vendors,
      };
    });

    return res.json({
      success: true,
      medicines: result,
      pagination: {
        page: Math.max(1, Number(req.query.page) || 1),
        limit: Math.min(100, Math.max(1, Number(req.query.limit) || 20)),
        total,
        pages: Math.ceil(total / Math.min(100, Math.max(1, Number(req.query.limit) || 20))),
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Medicine search failed' });
  }
});

router.get('/', auth, requireRole('ADMIN'), async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const [medicines, total] = await Promise.all([
      Medicine.find().sort({ name: 1 }).skip(skip).limit(limit),
      Medicine.countDocuments(),
    ]);
    return res.json({
      success: true,
      medicines,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/', auth, requireRole('ADMIN'), async (req, res) => {
  try {
    const { name, company, category, mrp, composition, requiresPrescription, imageUrl } = req.body;
    if (!name || !company || !mrp) {
      return res.status(400).json({ success: false, message: 'name, company, and mrp are required' });
    }

    const medicine = await Medicine.create({
      name: String(name).trim(),
      company: String(company).trim(),
      category: category || 'General',
      mrp: Math.max(1, Number(mrp)),
      composition: composition || '',
      imageUrl: imageUrl ? String(imageUrl).trim() : '',
      requiresPrescription: Boolean(requiresPrescription),
    });

    return res.status(201).json({ success: true, message: 'Medicine created', medicine });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/:id', auth, requireRole('ADMIN'), async (req, res) => {
  try {
    const medicine = await Medicine.findById(req.params.id);
    if (!medicine) return res.status(404).json({ success: false, message: 'Medicine not found' });

    const { name, company, category, mrp, composition, requiresPrescription, imageUrl } = req.body;
    if (name) medicine.name = String(name).trim();
    if (company) medicine.company = String(company).trim();
    if (category) medicine.category = category;
    if (mrp) medicine.mrp = Math.max(1, Number(mrp));
    if (composition !== undefined) medicine.composition = composition;
    if (imageUrl !== undefined) medicine.imageUrl = String(imageUrl).trim();
    if (requiresPrescription !== undefined) medicine.requiresPrescription = Boolean(requiresPrescription);

    await medicine.save();
    return res.json({ success: true, message: 'Medicine updated', medicine });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:id', auth, requireRole('ADMIN'), async (req, res) => {
  try {
    const medicine = await Medicine.findByIdAndDelete(req.params.id);
    if (!medicine) return res.status(404).json({ success: false, message: 'Medicine not found' });
    return res.json({ success: true, message: 'Medicine deleted' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
