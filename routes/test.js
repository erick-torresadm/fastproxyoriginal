const express = require('express');
const router = express.Router();
const Proxy = require('../models/Proxy');
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const IP_BASE = process.env.PROXY_IP || '177.54.146.90';
const PORT_START = parseInt(process.env.PROXY_PORT_START || '11331');
const PORT_END = parseInt(process.env.PROXY_PORT_END || '11368');
const JWT_SECRET = process.env.JWT_SECRET || 'fastproxy_secret_key_2024';

async function getNextPort() {
  const usedPorts = await Proxy.distinct('port', { status: 'active' });
  for (let port = PORT_START; port <= PORT_END; port++) {
    if (!usedPorts.includes(port)) return port;
  }
  return null;
}

function generateUsername() {
  return 'fp' + Math.floor(Math.random() * 90000 + 10000);
}

function generatePassword() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let password = '';
  for (let i = 0; i < 8; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

async function allocateProxies(userId, count, period) {
  const allocated = [];
  
  for (let i = 0; i < count; i++) {
    const port = await getNextPort();
    if (!port) break;
    
    const username = generateUsername();
    const password = generatePassword();
    
    const proxy = await Proxy.create({
      ip: IP_BASE,
      port,
      username,
      password,
      tier: 'premium',
      status: 'active',
      userId,
      assignedAt: new Date()
    });
    
    allocated.push(proxy);
  }
  
  return allocated;
}

router.post('/test-purchase', async (req, res) => {
  try {
    const { email, proxyCount, period } = req.body;
    
    console.log('=== TEST PURCHASE ===');
    console.log('Email:', email);
    console.log('Proxy Count:', proxyCount);
    console.log('Period:', period);
    
    if (!email) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email é obrigatório' 
      });
    }
    
    const quantity = parseInt(proxyCount) || 1;
    const testPeriod = period || 'monthly';
    
    // 1. Criar usuário de teste
    let user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      const hashedPassword = await bcrypt.hash('test123456', 10);
      user = await User.create({
        email: email.toLowerCase(),
        password: hashedPassword,
        subscription: {
          period: testPeriod,
          proxyCount: quantity,
          status: 'active',
          startDate: new Date()
        }
      });
      console.log('Usuário criado:', user.email);
    } else {
      // Atualizar subscription
      user.subscription = {
        period: testPeriod,
        proxyCount: quantity,
        status: 'active',
        startDate: new Date()
      };
      await user.save();
      console.log('Usuário atualizado:', user.email);
    }
    
    // 2. Alocar proxies
    const proxies = await allocateProxies(user._id, quantity, testPeriod);
    console.log('Proxies alocados:', proxies.length);
    
    // 3. Gerar token
    const token = jwt.sign(
      { id: user._id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    // 4. Preparar resposta
    const proxyLines = proxies.map(p => `${p.username}:${p.password}@${p.ip}:${p.port}`);
    
    res.json({
      success: true,
      message: 'Teste de compra concluído com sucesso!',
      data: {
        user: {
          email: user.email,
          id: user._id
        },
        subscription: {
          period: testPeriod,
          proxyCount: quantity,
          status: 'active'
        },
        proxies: proxies.map(p => ({
          ip: p.ip,
          port: p.port,
          username: p.username,
          password: p.password,
          line: `${p.username}:${p.password}@${p.ip}:${p.port}`
        })),
        allLines: proxyLines.join('\n'),
        count: proxies.length
      },
      credentials: {
        email: email,
        password: 'test123456',
        token: token,
        portalUrl: '/portal.html'
      },
      testNote: 'Este é um teste. Para usar proxies reais, faça uma compra via Stripe.'
    });
    
  } catch (err) {
    console.error('Test purchase error:', err);
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

router.post('/test-login', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email é obrigatório' 
      });
    }
    
    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        error: 'Usuário não encontrado. Use /api/test/test-purchase primeiro.' 
      });
    }
    
    const token = jwt.sign(
      { id: user._id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    const proxies = await Proxy.find({ userId: user._id, status: 'active' });
    const proxyLines = proxies.map(p => `${p.username}:${p.password}@${p.ip}:${p.port}`);
    
    res.json({
      success: true,
      data: {
        user: {
          email: user.email,
          subscription: user.subscription
        },
        proxies: proxies.map(p => ({
          ip: p.ip,
          port: p.port,
          username: p.username,
          password: p.password,
          line: `${p.username}:${p.password}@${p.ip}:${p.port}`
        })),
        allLines: proxyLines.join('\n'),
        count: proxies.length
      },
      credentials: {
        email: email,
        password: 'test123456',
        token: token
      }
    });
    
  } catch (err) {
    console.error('Test login error:', err);
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

router.delete('/test-cleanup', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email é obrigatório' 
      });
    }
    
    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        error: 'Usuário não encontrado' 
      });
    }
    
    // Remover proxies
    const deletedProxies = await Proxy.deleteMany({ userId: user._id });
    
    // Remover usuário
    await User.findByIdAndDelete(user._id);
    
    res.json({
      success: true,
      message: 'Teste limpo com sucesso',
      data: {
        proxiesDeleted: deletedProxies.deletedCount,
        userDeleted: true
      }
    });
    
  } catch (err) {
    console.error('Test cleanup error:', err);
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

module.exports = router;
