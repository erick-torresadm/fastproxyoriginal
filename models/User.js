const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String },
  whatsapp: { type: String },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  isActive: { type: Boolean, default: true },
  subscription: {
    period: { type: String, enum: ['monthly', 'annual'], default: 'monthly' },
    proxyCount: { type: Number, default: 1 },
    status: { type: String, enum: ['pending', 'active', 'cancelled', 'expired'], default: 'pending' },
    startDate: { type: Date },
    endDate: { type: Date }
  }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
