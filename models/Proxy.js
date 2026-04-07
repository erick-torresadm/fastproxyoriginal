const mongoose = require('mongoose');

const proxySchema = new mongoose.Schema({
  ip: { type: String, required: true },
  port: { type: Number, required: true },
  username: { type: String, required: true },
  password: { type: String, required: true },
  tier: { type: String, enum: ['shared', 'dedicated', 'premium'], default: 'shared' },
  status: { type: String, enum: ['available', 'active', 'expired'], default: 'available' },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  expiresAt: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('Proxy', proxySchema);