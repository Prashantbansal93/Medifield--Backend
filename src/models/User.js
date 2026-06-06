const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, select: false },
  name: { type: String, required: true, trim: true },
  role: {
    type: String,
    enum: ['ADMIN', 'RETAILER', 'WHOLESALER', 'DELIVERY'],
    required: true,
  },
  phone: { type: String, required: true },
  verificationStatus: {
    type: String,
    enum: ['PENDING', 'APPROVED', 'REJECTED'],
    default: 'PENDING',
  },
  profile: {
    aadhaarNumber: String,
    shopAddress: String,
    shopName: String,
    licenseNumber: String,
    gstNumber: String,
    profileImageUrl: String,
    documentUrls: [String],
    vehicleType: String,
    vehicleNumber: String,
    drivingLicenseNumber: String,
    city: String,
    pinCode: String,
    lat: Number,
    lng: Number,
    adminCode: String,
  },
  createdAt: { type: Date, default: Date.now },
});

UserSchema.index({ role: 1, verificationStatus: 1 });
UserSchema.index({ 'profile.city': 1, role: 1 });

module.exports = mongoose.model('User', UserSchema);
