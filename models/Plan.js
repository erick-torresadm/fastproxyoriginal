const mongoose = require('mongoose');

const planSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  proxyCount: { type: Number, required: true },
  tier: { type: String, enum: ['basic', 'premium', 'master'], default: 'basic' },
  period: { type: String, enum: ['monthly', 'semiannual', 'annual'], default: 'monthly' },
  replacements: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  isFeatured: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('Plan', planSchema);