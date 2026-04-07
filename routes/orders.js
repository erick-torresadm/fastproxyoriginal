const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Plan = require('../models/Plan');
const Proxy = require('../models/Proxy');
const User = require('../models/User');
const { auth, admin } = require('../middleware/auth');

const IP_BASE = process.env.PROXY_IP || '177.54.146.90';
const PORT_START = parseInt(process.env.PROXY_PORT_START || '11331');
const PORT_END = parseInt(process.env.PROXY_PORT_END || '11368');

async function allocateProxies(userId, plan, orderId) {
  const count = plan.proxyCount || 1;
  const allocated = [];
  
  for (let i = 0; i < count; i++) {
    const lastProxy = await Proxy.findOne({ status: 'available' }).sort({ port: 1 });
    
    if (lastProxy) {
      lastProxy.status = 'active';
      lastProxy.userId = userId;
      lastProxy.orderId = orderId;
      lastProxy.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await lastProxy.save();
      allocated.push(lastProxy);
    }
  }
  
  return allocated;
}

router.get('/', admin, async (req, res) => {
  try {
    const orders = await Order.find()
      .populate('userId', 'name email')
      .populate('planId', 'name price proxyCount tier')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: { orders } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao buscar pedidos', error: err.message });
  }
});

router.get('/my', auth, async (req, res) => {
  try {
    const orders = await Order.find({ userId: req.user._id })
      .populate('planId', 'name price proxyCount tier')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: { orders } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao buscar pedidos', error: err.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { planId } = req.body;

    const plan = await Plan.findById(planId);
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Plano não encontrado' });
    }

    const order = await Order.create({
      userId: req.user._id,
      planId
    });

    await order.populate('planId', 'name price proxyCount tier');

    res.status(201).json({ success: true, data: { order } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao criar pedido', error: err.message });
  }
});

router.post('/:id/approve', admin, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate('planId');
    if (!order) {
      return res.status(404).json({ success: false, message: 'Pedido não encontrado' });
    }

    const proxies = await allocateProxies(order.userId, order.planId, order._id);
    
    const proxyLines = proxies.map(p => `${p.username}:${p.password}@${p.ip}:${p.port}`);
    const downloadUrl = proxyLines.join('\n');

    order.status = 'approved';
    order.downloadUrl = downloadUrl;
    order.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await order.save();

    await User.findByIdAndUpdate(order.userId, { $inc: { proxyCount: proxies.length } });

    res.json({ success: true, data: { order, proxies } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao aprovar pedido', error: err.message });
  }
});

router.post('/:id/deliver', admin, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate('planId');
    if (!order) {
      return res.status(404).json({ success: false, message: 'Pedido não encontrado' });
    }

    order.status = 'delivered';
    order.deliveredAt = new Date();
    await order.save();

    res.json({ success: true, data: { order } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao entregar pedido', error: err.message });
  }
});

router.post('/:id/reject', admin, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Pedido não encontrado' });
    }

    order.status = 'rejected';
    await order.save();

    res.json({ success: true, message: 'Pedido rejeitado' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao rejeitar pedido', error: err.message });
  }
});

router.delete('/:id', admin, async (req, res) => {
  try {
    await Order.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Pedido excluído' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao excluir pedido', error: err.message });
  }
});

module.exports = router;