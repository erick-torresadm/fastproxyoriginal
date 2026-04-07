const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Plan = require('../models/Plan');
const Proxy = require('../models/Proxy');
const User = require('../models/User');
const { auth, admin } = require('../middleware/auth');

router.get('/', admin, async (req, res) => {
  try {
    const orders = await Order.find()
      .populate('userId', 'name email')
      .populate('planId', 'name price proxyCount')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: { orders } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao buscar pedidos', error: err.message });
  }
});

router.get('/my', auth, async (req, res) => {
  try {
    const orders = await Order.find({ userId: req.user._id })
      .populate('planId', 'name price proxyCount')
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

    await order.populate('planId', 'name price proxyCount');

    res.status(201).json({ success: true, data: { order } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao criar pedido', error: err.message });
  }
});

router.post('/:id/approve', admin, async (req, res) => {
  try {
    const { proxyIds } = req.body;

    const order = await Order.findById(req.params.id).populate('planId');
    if (!order) {
      return res.status(404).json({ success: false, message: 'Pedido não encontrado' });
    }

    if (proxyIds && proxyIds.length > 0) {
      const proxyCount = order.planId.proxyCount || 1;
      
      await Proxy.updateMany(
        { _id: { $in: proxyIds.slice(0, proxyCount) } },
        {
          status: 'active',
          userId: order.userId,
          orderId: order._id,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
      );

      await User.findByIdAndUpdate(order.userId, { $inc: { proxyCount: proxyCount } });
    }

    order.status = 'approved';
    order.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await order.save();

    res.json({ success: true, data: { order } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao aprovar pedido', error: err.message });
  }
});

router.post('/:id/active', admin, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Pedido não encontrado' });
    }

    order.status = 'active';
    await order.save();

    res.json({ success: true, data: { order } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao ativar pedido', error: err.message });
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