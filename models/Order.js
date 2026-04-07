const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan' },
  caktoOrderId: { type: String },
  status: { type: String, enum: ['pending', 'approved', 'active', 'rejected', 'expired', 'canceled', 'refunded'], default: 'pending' },
  expiresAt: { type: Date },
  downloadUrl: { type: String },
  totalAmount: { type: Number }
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);