const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true },
  status: { type: String, enum: ['pending', 'approved', 'active', 'rejected', 'expired'], default: 'pending' },
  expiresAt: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);