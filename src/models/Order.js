const mongoose = require('mongoose');

const OrderSchema = new mongoose.Schema({
  retailer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  wholesaler: { type: mongoose.Schema.Types.ObjectId, ref: 'Wholesaler' },
  deliveryPartner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status: {
    type: String,
    enum: ['PLACED', 'WAITING_WHOLESALER', 'ACCEPTED', 'PACKED', 'PICKED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'REJECTED', 'FAILED'],
    default: 'PLACED',
  },
  slot: { type: String, enum: ['Afternoon', 'Evening'], required: true },
  wholesalerResponseDeadline: Date,
  attemptedWholesalers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Wholesaler' }],
  acceptedAt: Date,
  packedAt: Date,
  pickedAt: Date,
  deliveredAt: Date,
  deliveryOtp: String,
  billNumber: String,
  deliveryTracking: {
    currentLat: Number,
    currentLng: Number,
    retailerLat: Number,
    retailerLng: Number,
    wholesalerLat: Number,
    wholesalerLng: Number,
  },
  totalAmount: { type: Number, required: true, min: 0 },
  items: [{
    medicine: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine', required: true },
    medicineName: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
    prescriptionUrl: { type: String, default: null },
  }],
  createdAt: { type: Date, default: Date.now },
});

OrderSchema.index({ status: 1, wholesalerResponseDeadline: 1 });
OrderSchema.index({ retailer: 1, createdAt: -1 });
OrderSchema.index({ wholesaler: 1, status: 1 });
OrderSchema.index({ deliveryPartner: 1, status: 1 });

module.exports = mongoose.model('Order', OrderSchema);
