const mongoose = require('mongoose');

const planSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  proxyCount: { type: Number, required: true },
  tier: { type: String, enum: ['starter', 'business', 'enterprise'], default: 'starter' },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Plan', planSchema);