const express = require('express');
const router = express.Router();
const Proxy = require('../models/Proxy');
const { auth, admin } = require('../middleware/auth');

router.get('/', async (req, res) => {
  try {
    const { tier, status, search } = req.query;
    const query = {};

    if (tier) query.tier = tier;
    if (status) query.status = status;
    if (search) {
      query.$or = [
        { ip: { $regex: search, $options: 'i' } },
        { username: { $regex: search, $options: 'i' } }
      ];
    }

    const proxies = await Proxy.find(query).populate('userId', 'name email').populate('orderId').sort({ createdAt: -1 });
    res.json({ success: true, data: { proxies } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao buscar proxies', error: err.message });
  }
});

router.get('/my', auth, async (req, res) => {
  try {
    const proxies = await Proxy.find({ userId: req.user._id, status: 'active' }).populate('planId', 'name');
    res.json({ success: true, data: { proxies } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao buscar seus proxies', error: err.message });
  }
});

router.post('/', admin, async (req, res) => {
  try {
    const { ip, port, username, password, tier } = req.body;

    const proxy = await Proxy.create({ ip, port, username, password, tier: tier || 'shared' });
    res.status(201).json({ success: true, data: { proxy } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao criar proxy', error: err.message });
  }
});

router.post('/bulk', admin, async (req, res) => {
  try {
    const { proxies } = req.body;
    const proxiesData = proxies.map(p => ({
      ip: p.ip,
      port: p.port,
      username: p.username,
      password: p.password,
      tier: p.tier || 'shared',
      status: 'available'
    }));

    const created = await Proxy.insertMany(proxiesData);
    res.status(201).json({ success: true, data: { count: created.length } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao criar proxies', error: err.message });
  }
});

router.put('/:id', admin, async (req, res) => {
  try {
    const { ip, port, username, password, tier, status } = req.body;
    const proxy = await Proxy.findByIdAndUpdate(
      req.params.id,
      { ip, port, username, password, tier, status },
      { new: true }
    );
    res.json({ success: true, data: { proxy } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao atualizar proxy', error: err.message });
  }
});

router.delete('/:id', admin, async (req, res) => {
  try {
    await Proxy.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Proxy excluído' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao excluir proxy', error: err.message });
  }
});

module.exports = router;