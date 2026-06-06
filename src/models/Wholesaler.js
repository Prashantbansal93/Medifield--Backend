const mongoose = require('mongoose');
const locationSchema = require('./Location');

const WholesalerSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  shopName: { type: String, required: true },
  address: { type: String, required: true },
  city: { type: String, default: '' },
  priorityRank: { type: Number, default: 100 },
  location: { type: locationSchema, required: true },
  inventory: [{
    medicine: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine', required: true },
    quantity: { type: Number, default: 0, min: 0 },
    price: { type: Number, required: true, min: 1 },
  }],
});

WholesalerSchema.index({ priorityRank: 1, createdAt: 1 });
WholesalerSchema.index({ city: 1 });
WholesalerSchema.index({ user: 1 }, { unique: true });

module.exports = mongoose.model('Wholesaler', WholesalerSchema);