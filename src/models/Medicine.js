const mongoose = require('mongoose');

const MedicineSchema = new mongoose.Schema({
  name: { type: String, required: true, index: true },
  company: { type: String, required: true },
  category: { type: String, default: 'General' },
  mrp: { type: Number, required: true, min: 1 },
  composition: { type: String, default: '' },
  imageUrl: { type: String, default: '' },
  requiresPrescription: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Medicine', MedicineSchema);
