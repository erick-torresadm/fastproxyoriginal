const mongoose = require('mongoose');

const proxySchema = new mongoose.Schema({
  ip: { type: String, required: true },
  port: { type: Number, required: true },
  username: { type: String, required: true },
  password: { type: String, required: true },
  tier: { type: String, enum: ['basic', 'premium', 'master'], default: 'basic' },
  status: { type: String, enum: ['available', 'active', 'expired'], default: 'available' },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  expiresAt: { type: Date },
  basePort: { type: Number },
  assignedAt: { type: Date }
}, { timestamps: true });

proxySchema.virtual('format').get(function() {
  return `${this.username}:${this.password}@${this.ip}:${this.port}`;
});

proxySchema.set('toJSON', { virtuals: true });
proxySchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Proxy', proxySchema);