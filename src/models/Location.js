const mongoose = require('mongoose');
  
const locationSchema = new mongoose.Schema({
  type: { type: String, default: 'Point' },
  coordinates: { type: [Number], required: true } // [Longitude, Latitude]
});

// Create 2dsphere index for geospatial queries
locationSchema.index({ coordinates: '2dsphere' });

module.exports = locationSchema;