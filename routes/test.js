const express = require('express');
const router = express.Router();
const { sql } = require('../lib/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sendEmail, sendWelcomeEmail, sendProxyCredentials } = require('../lib/email');

const IP_BASE = process.env.PROXY_IP || '177.54.146.90';
const PORT_START = parseInt(process.env.PROXY_PORT_START || '11331');
const PORT_END = parseInt(process.env.PROXY_PORT_END || '11368');
const JWT_SECRET = process.env.JWT_SECRET || 'fastproxy_secret_key_2024';

// Simple in-memory proxy tracking for testing
const allocatedPorts = new Set();

function getNextPort() {
  for (let port = PORT_START; port <= PORT_END; port++) {
    if (!allocatedPorts.has(port)) return port;
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

router.post('/test-purchase', async (req, res) => {
  try {
    const { email, proxyCount, period } = req.body;
    
    console.log('=== TEST PURCHASE ===');
    console.log('Email:', email);
    console.log('Proxy Count:', proxyCount);
    console.log('Period:', period);
    
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email é obrigatório' });
    }
    
    const quantity = parseInt(proxyCount) || 1;
    const testPeriod = period || 'monthly';
    
    // 1. Criar ou atualizar usuário
    const existingUsers = await sql`
      SELECT id FROM users WHERE email = ${email.toLowerCase()}
    `;
    
    let user;
    let token;
    
    if (existingUsers.length > 0) {
      // Atualizar subscription
      await sql`
        UPDATE users SET 
          subscription_period = ${testPeriod},
          subscription_proxy_count = ${quantity},
          subscription_status = 'active',
          subscription_start_date = CURRENT_TIMESTAMP
        WHERE email = ${email.toLowerCase()}
      `;
      
      const users = await sql`
        SELECT * FROM users WHERE email = ${email.toLowerCase()}
      `;
      user = users[0];
    } else {
      // Criar usuário
      const hashedPassword = await bcrypt.hash('test123456', 10);
      
      const newUsers = await sql`
        INSERT INTO users (email, password, subscription_period, subscription_proxy_count, subscription_status, subscription_start_date)
        VALUES (${email.toLowerCase()}, ${hashedPassword}, ${testPeriod}, ${quantity}, 'active', CURRENT_TIMESTAMP)
        RETURNING *
      `;
      user = newUsers[0];
    }
    
    console.log('User:', user.email);
    
    // 2. Gerar tokens de proxy (simulado)
    const proxies = [];
    for (let i = 0; i < quantity; i++) {
      const port = getNextPort();
      if (!port) break;
      
      allocatedPorts.add(port);
      
      proxies.push({
        ip: IP_BASE,
        port: port,
        username: generateUsername(),
        password: generatePassword()
      });
    }
    
    console.log('Proxies generated:', proxies.length);
    
    // 3. Gerar token
    token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    
    const proxyLines = proxies.map(p => `${p.username}:${p.password}@${p.ip}:${p.port}`);
    
    res.json({
      success: true,
      message: 'Teste de compra concluído!',
      data: {
        user: { email: user.email, id: user.id },
        subscription: {
          period: testPeriod,
          proxyCount: quantity,
          status: 'active'
        },
        proxies: proxies.map(p => ({
          ...p,
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
      note: '⚠️ Este é um teste. Para proxies reais, faça uma compra via Stripe.'
    });
    
  } catch (err) {
    console.error('Test purchase error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/test-login', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email é obrigatório' });
    }
    
    const users = await sql`
      SELECT * FROM users WHERE email = ${email.toLowerCase()}
    `;
    
    if (users.length === 0) {
      return res.status(404).json({ success: false, error: 'Usuário não encontrado. Use /api/test/test-purchase primeiro.' });
    }
    
    const user = users[0];
    
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    
    res.json({
      success: true,
      data: {
        user: { email: user.email, subscription: {
          period: user.subscription_period,
          proxyCount: user.subscription_proxy_count,
          status: user.subscription_status
        }},
        proxies: [],
        count: 0
      },
      credentials: { email: email, password: 'test123456', token: token }
    });
    
  } catch (err) {
    console.error('Test login error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/test-cleanup', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email é obrigatório' });
    }
    
    const result = await sql`
      DELETE FROM users WHERE email = ${email.toLowerCase()} AND role != 'admin'
    `;
    
    res.json({
      success: true,
      message: 'Usuário de teste removido',
      deleted: result.count > 0
    });
    
  } catch (err) {
    console.error('Test cleanup error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Test email configuration
router.post('/test-email', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email é obrigatório' });
    }
    
    console.log('=== TEST EMAIL ===');
    console.log('RESEND_API_KEY configured:', !!process.env.RESEND_API_KEY);
    console.log('Sending to:', email);
    
    // Test basic email
    const result = await sendEmail({
      to: email,
      subject: 'Teste - FastProxy Email',
      html: `
        <h1>Teste de Email</h1>
        <p>Este é um email de teste do FastProxy.</p>
        <p>Se você está lendo isso, o sistema de email está funcionando!</p>
      `
    });
    
    if (result.success) {
      res.json({
        success: true,
        message: 'Email de teste enviado! Verifique sua caixa de entrada.',
        data: result.data
      });
    } else {
      res.json({
        success: false,
        message: 'Erro ao enviar email',
        error: result.error,
        hint: 'Verifique se RESEND_API_KEY está configurado corretamente no .env'
      });
    }
    
  } catch (err) {
    console.error('Test email error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Test welcome email
router.post('/test-welcome-email', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email é obrigatório' });
    }
    
    const testProxies = [
      { ip: '177.54.146.90', port: 11331, username: 'fp12345', password: 'test1234', line: 'fp12345:test1234@177.54.146.90:11331' },
      { ip: '177.54.146.90', port: 11332, username: 'fp12346', password: 'test1235', line: 'fp12346:test1235@177.54.146.90:11332' }
    ];
    
    const result = await sendWelcomeEmail(email, 'Cliente Teste', testProxies);
    
    if (result.success) {
      res.json({
        success: true,
        message: 'Email de boas-vindas enviado!',
        proxies: testProxies
      });
    } else {
      res.json({
        success: false,
        message: 'Erro ao enviar email',
        error: result.error
      });
    }
    
  } catch (err) {
    console.error('Test welcome email error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
