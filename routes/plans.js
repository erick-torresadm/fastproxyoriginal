const express = require('express');
const router = express.Router();
const Plan = require('../models/Plan');
const { auth, admin } = require('../middleware/auth');

router.get('/', async (req, res) => {
  try {
    const plans = await Plan.find({ isActive: true }).sort({ price: 1 });
    res.json({ success: true, data: { plans } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao buscar planos', error: err.message });
  }
});

router.post('/', admin, async (req, res) => {
  try {
    const { name, price, proxyCount, tier, period, replacements, isFeatured } = req.body;
    const plan = await Plan.create({ name, price, proxyCount, tier, period, replacements, isFeatured });
    res.status(201).json({ success: true, data: { plan } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao criar plano', error: err.message });
  }
});

router.put('/:id', admin, async (req, res) => {
  try {
    const { name, price, proxyCount, tier, isActive } = req.body;
    const plan = await Plan.findByIdAndUpdate(
      req.params.id,
      { name, price, proxyCount, tier, isActive },
      { new: true }
    );
    res.json({ success: true, data: { plan } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao atualizar plano', error: err.message });
  }
});

router.delete('/:id', admin, async (req, res) => {
  try {
    await Plan.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Plano excluído' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao excluir plano', error: err.message });
  }
});

module.exports = router;