const express = require('express');
const router = express.Router();
const Proxy = require('../models/Proxy');
const { auth, admin } = require('../middleware/auth');

const IP_BASE = process.env.PROXY_IP || '177.54.146.90';
const PORT_START = parseInt(process.env.PROXY_PORT_START || '11331');
const PORT_END = parseInt(process.env.PROXY_PORT_END || '11368');

async function getNextPort() {
  const usedPorts = await Proxy.distinct('port', { status: 'active' });
  for (let port = PORT_START; port <= PORT_END; port++) {
    if (!usedPorts.includes(port)) return port;
  }
  return null;
}

function generateUsername() {
  return 'fastproxy' + Math.floor(Math.random() * 9000 + 1000);
}

function generatePassword() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let password = '';
  for (let i = 0; i < 6; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

router.get('/', admin, async (req, res) => {
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

router.get('/available', admin, async (req, res) => {
  try {
    const proxies = await Proxy.find({ status: 'available' }).sort({ port: 1 });
    res.json({ success: true, data: { proxies, count: proxies.length } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao buscar proxies', error: err.message });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const total = await Proxy.countDocuments();
    const available = await Proxy.countDocuments({ status: 'available' });
    const active = await Proxy.countDocuments({ status: 'active' });
    const basic = await Proxy.countDocuments({ tier: 'basic' });
    const premium = await Proxy.countDocuments({ tier: 'premium' });
    const master = await Proxy.countDocuments({ tier: 'master' });
    
    res.json({ success: true, data: { total, available, active, tier: { basic, premium, master } } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao buscar estatísticas', error: err.message });
  }
});

router.get('/my', auth, async (req, res) => {
  try {
    const proxies = await Proxy.find({ userId: req.user._id, status: 'active' }).sort({ createdAt: -1 });
    const proxyLines = proxies.map(p => `${p.username}:${p.password}@${p.ip}:${p.port}`);
    res.json({ success: true, data: { proxies, lines: proxyLines.join('\n'), count: proxies.length } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao buscar seus proxies', error: err.message });
  }
});

router.post('/allocate', auth, admin, async (req, res) => {
  try {
    const { userId, tier, count } = req.body;
    const quantity = count || 1;
    const allocated = [];
    
    for (let i = 0; i < quantity; i++) {
      const port = await getNextPort();
      if (!port) {
        return res.status(400).json({ success: false, message: 'Sem portas disponíveis' });
      }
      
      const username = generateUsername();
      const password = generatePassword();
      
      const proxy = await Proxy.create({
        ip: IP_BASE,
        port,
        username,
        password,
        tier: tier || 'basic',
        status: 'active',
        userId,
        assignedAt: new Date()
      });
      
      allocated.push(proxy);
    }
    
    res.status(201).json({ success: true, data: { proxies: allocated } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao alocar proxy', error: err.message });
  }
});

router.post('/', auth, admin, async (req, res) => {
  try {
    const { ip, port, username, password, tier } = req.body;

    const proxy = await Proxy.create({ 
      ip, 
      port, 
      username, 
      password, 
      tier: tier || 'basic' 
    });
    res.status(201).json({ success: true, data: { proxy } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao criar proxy', error: err.message });
  }
});

router.post('/bulk', auth, admin, async (req, res) => {
  try {
    const { proxies, tier } = req.body;
    const tierValue = tier || 'basic';
    
    const proxiesData = proxies.map(p => ({
      ip: p.ip || IP_BASE,
      port: p.port,
      username: p.username,
      password: p.password,
      tier: tierValue,
      status: 'available'
    }));

    const created = await Proxy.insertMany(proxiesData);
    res.status(201).json({ success: true, data: { count: created.length } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao criar proxies', error: err.message });
  }
});

router.put('/:id', auth, admin, async (req, res) => {
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

router.delete('/:id', auth, admin, async (req, res) => {
  try {
    await Proxy.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Proxy excluído' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao excluir proxy', error: err.message });
  }
});

module.exports = router;