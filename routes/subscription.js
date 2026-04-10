const express = require('express');
const router = express.Router();
const { sql } = require('../lib/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sendWelcomeEmail, sendProxyCredentials } = require('../lib/email');

const JWT_SECRET = process.env.JWT_SECRET || 'fastproxy_secret_key_2024';
const JWT_EXPIRE = process.env.JWT_EXPIRE || '7d';

const IP_BASE = process.env.PROXY_IP || '177.54.146.90';
const PORT_START = parseInt(process.env.PROXY_PORT_START || '11331');
const PORT_END = parseInt(process.env.PROXY_PORT_END || '11368');

// Alocated ports tracking (in production, this would be in Redis or DB)
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

function calculateEndDate(period) {
  const now = new Date();
  if (period === 'monthly') {
    now.setMonth(now.getMonth() + 1);
  } else if (period === 'annual') {
    now.setFullYear(now.getFullYear() + 1);
  }
  return now;
}

// Check if user exists
router.get('/check-email/:email', async (req, res) => {
  try {
    const { email } = req.params;
    const users = await sql`
      SELECT id FROM users WHERE email = ${email.toLowerCase()}
    `;
    res.json({ exists: users.length > 0, email: email.toLowerCase() });
  } catch (err) {
    console.error('Check email error:', err);
    res.status(500).json({ exists: false, error: err.message });
  }
});

// Register user after payment
router.post('/register-after-payment', async (req, res) => {
  try {
    const { email, password, name, whatsapp, proxyCount, period, stripeSessionId } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email e senha são obrigatórios' });
    }

    // Check if user already exists
    const existingUsers = await sql`
      SELECT id FROM users WHERE email = ${email.toLowerCase()}
    `;

    let user;
    let isNewUser = true;

    if (existingUsers.length > 0) {
      user = existingUsers[0];
      isNewUser = false;
    } else {
      const hashedPassword = await bcrypt.hash(password, 10);
      const newUsers = await sql`
        INSERT INTO users (email, password, name, whatsapp)
        VALUES (${email.toLowerCase()}, ${hashedPassword}, ${name || null}, ${whatsapp || null})
        RETURNING id, email, name, whatsapp
      `;
      user = newUsers[0];
    }

    // Calculate end date based on period
    const endDate = calculateEndDate(period);

    // Create subscription
    const subscriptions = await sql`
      INSERT INTO subscriptions (user_id, stripe_session_id, period, proxy_count, status, end_date, auto_renew)
      VALUES (${user.id}, ${stripeSessionId || null}, ${period}, ${proxyCount}, 'active', ${endDate}, true)
      RETURNING *
    `;
    const subscription = subscriptions[0];

    // Generate proxies
    const proxies = [];
    for (let i = 0; i < proxyCount; i++) {
      const port = getNextPort();
      if (!port) break;

      allocatedPorts.add(port);

      const username = generateUsername();
      const pwd = generatePassword();

      const newProxies = await sql`
        INSERT INTO proxies (user_id, subscription_id, ip, port, username, password)
        VALUES (${user.id}, ${subscription.id}, ${IP_BASE}, ${port}, ${username}, ${pwd})
        RETURNING *
      `;
      proxies.push(newProxies[0]);
    }

    // Generate JWT token
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRE });

    // Send welcome email (async - don't wait)
    const proxiesData = proxies.map(p => ({
      id: p.id,
      ip: p.ip,
      port: p.port,
      username: p.username,
      password: p.password,
      line: `${p.username}:${p.password}@${p.ip}:${p.port}`
    }));

    sendWelcomeEmail(user.email, user.name, proxiesData).catch(err => {
      console.error('Failed to send welcome email:', err);
    });

    res.status(201).json({
      success: true,
      isNewUser,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        whatsapp: user.whatsapp
      },
      subscription: {
        id: subscription.id,
        period: subscription.period,
        proxyCount: subscription.proxy_count,
        status: subscription.status,
        startDate: subscription.start_date,
        endDate: subscription.end_date
      },
      proxies: proxiesData
    });

  } catch (err) {
    console.error('Register after payment error:', err);
    res.status(500).json({ success: false, message: 'Erro ao criar conta', error: err.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email e senha são obrigatórios' });
    }

    const users = await sql`
      SELECT * FROM users WHERE email = ${email.toLowerCase()}
    `;

    if (users.length === 0) {
      return res.status(400).json({ success: false, message: 'Credenciais inválidas' });
    }

    const user = users[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Credenciais inválidas' });
    }

    // Get active subscription
    const subscriptions = await sql`
      SELECT * FROM subscriptions 
      WHERE user_id = ${user.id} AND status = 'active'
      ORDER BY created_at DESC LIMIT 1
    `;

    // Get proxies
    const proxies = await sql`
      SELECT * FROM proxies 
      WHERE user_id = ${user.id} AND is_active = true
    `;

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRE });

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        whatsapp: user.whatsapp
      },
      subscription: subscriptions.length > 0 ? {
        id: subscriptions[0].id,
        period: subscriptions[0].period,
        proxyCount: subscriptions[0].proxy_count,
        status: subscriptions[0].status,
        startDate: subscriptions[0].start_date,
        endDate: subscriptions[0].end_date,
        autoRenew: subscriptions[0].auto_renew
      } : null,
      proxies: proxies.map(p => ({
        id: p.id,
        ip: p.ip,
        port: p.port,
        username: p.username,
        password: p.password,
        line: `${p.username}:${p.password}@${p.ip}:${p.port}`
      }))
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Erro no login', error: err.message });
  }
});

// Get user data (with auth)
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Token não fornecido' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const users = await sql`
      SELECT id, email, name, whatsapp, created_at FROM users WHERE id = ${decoded.id}
    `;

    if (users.length === 0) {
      return res.status(404).json({ success: false, message: 'Usuário não encontrado' });
    }

    const user = users[0];

    // Get subscriptions
    const subscriptions = await sql`
      SELECT * FROM subscriptions 
      WHERE user_id = ${user.id}
      ORDER BY created_at DESC
    `;

    // Get proxies
    const proxies = await sql`
      SELECT p.*, pr.id as replacement_id, pr.reason, pr.created_at as replaced_at
      FROM proxies p
      LEFT JOIN proxy_replacements pr ON p.id = pr.proxy_id AND pr.created_at = (
        SELECT MAX(created_at) FROM proxy_replacements WHERE proxy_id = p.id
      )
      WHERE p.user_id = ${user.id}
      ORDER BY p.created_at DESC
    `;

    // Get available discounts
    const discounts = await sql`
      SELECT * FROM discounts 
      WHERE user_id = ${user.id} AND used = false AND (valid_until IS NULL OR valid_until > NOW())
    `;

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        whatsapp: user.whatsapp,
        createdAt: user.created_at
      },
      subscriptions: subscriptions.map(s => ({
        id: s.id,
        period: s.period,
        proxyCount: s.proxy_count,
        pricePaid: s.price_paid,
        status: s.status,
        startDate: s.start_date,
        endDate: s.end_date,
        autoRenew: s.auto_renew
      })),
      proxies: proxies.map(p => ({
        id: p.id,
        ip: p.ip,
        port: p.port,
        username: p.username,
        password: p.password,
        isActive: p.is_active,
        createdAt: p.created_at,
        lastReplacedAt: p.replaced_at,
        replacementReason: p.reason
      })),
      discounts: discounts.map(d => ({
        id: d.id,
        type: d.type,
        discountPercent: parseFloat(d.discount_percent),
        validUntil: d.valid_until
      }))
    });

  } catch (err) {
    console.error('Auth check error:', err.message);
    res.status(401).json({ success: false, message: 'Token inválido ou expirado' });
  }
});

// Get proxy replacement price based on subscription age
router.get('/replacement-price/:subscriptionId', async (req, res) => {
  try {
    const { subscriptionId } = req.params;

    const subscriptions = await sql`
      SELECT * FROM subscriptions WHERE id = ${subscriptionId} AND status = 'active'
    `;

    if (subscriptions.length === 0) {
      return res.status(404).json({ success: false, message: 'Assinatura não encontrada' });
    }

    const subscription = subscriptions[0];
    const startDate = new Date(subscription.start_date);
    const now = new Date();
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));

    let price;
    if (daysSinceStart <= 3) {
      price = 1.99;
    } else if (daysSinceStart <= 7) {
      price = 5.99;
    } else {
      price = 11.99;
    }

    res.json({
      success: true,
      daysSinceStart,
      price,
      message: `Troca disponível por R$ ${price.toFixed(2).replace('.', ',')}`
    });

  } catch (err) {
    console.error('Replacement price error:', err);
    res.status(500).json({ success: false, message: 'Erro ao calcular preço' });
  }
});

// Replace proxy
router.post('/replace-proxy', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Token não fornecido' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const { proxyId, reason } = req.body;

    if (!proxyId) {
      return res.status(400).json({ success: false, message: 'ID do proxy é obrigatório' });
    }

    // Get current proxy with user info
    const proxies = await sql`
      SELECT p.*, s.start_date, s.id as sub_id, u.email as user_email, u.name as user_name
      FROM proxies p
      JOIN subscriptions s ON p.subscription_id = s.id
      JOIN users u ON p.user_id = u.id
      WHERE p.id = ${proxyId} AND p.user_id = ${decoded.id}
    `;

    if (proxies.length === 0) {
      return res.status(404).json({ success: false, message: 'Proxy não encontrado' });
    }

    const oldProxy = proxies[0];
    const startDate = new Date(oldProxy.start_date);
    const now = new Date();
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));

    let price;
    if (daysSinceStart <= 3) {
      price = 1.99;
    } else if (daysSinceStart <= 7) {
      price = 5.99;
    } else {
      price = 11.99;
    }

    // Generate new proxy credentials
    const newPort = getNextPort();
    if (!newPort) {
      return res.status(400).json({ success: false, message: 'Não há portas disponíveis para troca' });
    }

    allocatedPorts.add(newPort);
    allocatedPorts.delete(oldProxy.port);

    const newUsername = generateUsername();
    const newPassword = generatePassword();

    // Update proxy
    const updated = await sql`
      UPDATE proxies 
      SET ip = ${IP_BASE}, port = ${newPort}, username = ${newUsername}, password = ${newPassword}, updated_at = NOW()
      WHERE id = ${proxyId}
      RETURNING *
    `;

    // Record replacement
    await sql`
      INSERT INTO proxy_replacements (proxy_id, old_ip, old_port, new_ip, new_port, price_charged, reason)
      VALUES (${proxyId}, ${oldProxy.ip}, ${oldProxy.port}, ${IP_BASE}, ${newPort}, ${price}, ${reason || 'Troca solicitada pelo cliente'})
    `;

    const newProxy = updated[0];

    // Send email about proxy change
    const newProxyData = [{
      ip: newProxy.ip,
      port: newProxy.port,
      username: newProxy.username,
      password: newProxy.password,
      line: `${newProxy.username}:${newProxy.password}@${newProxy.ip}:${newProxy.port}`
    }];

    sendProxyCredentials(oldProxy.user_email, oldProxy.user_name, newProxyData, `Seu proxy foi trocado. Preço cobrado: R$ ${price.toFixed(2).replace('.', ',')}`).catch(err => {
      console.error('Failed to send proxy replacement email:', err);
    });

    res.json({
      success: true,
      message: `Proxy trocado com sucesso! Preço: R$ ${price.toFixed(2).replace('.', ',')}`,
      oldProxy: {
        ip: oldProxy.ip,
        port: oldProxy.port
      },
      newProxy: {
        ip: newProxy.ip,
        port: newProxy.port,
        username: newProxy.username,
        password: newProxy.password,
        line: `${newProxy.username}:${newProxy.password}@${newProxy.ip}:${newProxy.port}`
      },
      price
    });

  } catch (err) {
    console.error('Replace proxy error:', err);
    res.status(500).json({ success: false, message: 'Erro ao trocar proxy' });
  }
});

// Add more proxies to existing subscription
router.post('/add-proxies', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Token não fornecido' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const { additionalCount } = req.body;

    if (!additionalCount || additionalCount < 1) {
      return res.status(400).json({ success: false, message: 'Quantidade inválida' });
    }

    // Get active subscription
    const subscriptions = await sql`
      SELECT * FROM subscriptions 
      WHERE user_id = ${decoded.id} AND status = 'active'
      ORDER BY created_at DESC LIMIT 1
    `;

    if (subscriptions.length === 0) {
      return res.status(400).json({ success: false, message: 'Nenhuma assinatura ativa encontrada' });
    }

    const subscription = subscriptions[0];
    const newProxyCount = subscription.proxy_count + additionalCount;

    // Update subscription proxy count
    await sql`
      UPDATE subscriptions SET proxy_count = ${newProxyCount}, updated_at = NOW()
      WHERE id = ${subscription.id}
    `;

    // Generate new proxies
    const newProxies = [];
    for (let i = 0; i < additionalCount; i++) {
      const port = getNextPort();
      if (!port) break;

      allocatedPorts.add(port);

      const username = generateUsername();
      const pwd = generatePassword();

      const created = await sql`
        INSERT INTO proxies (user_id, subscription_id, ip, port, username, password)
        VALUES (${decoded.id}, ${subscription.id}, ${IP_BASE}, ${port}, ${username}, ${pwd})
        RETURNING *
      `;
      newProxies.push(created[0]);
    }

    res.json({
      success: true,
      message: `${newProxies.length} proxies adicionados!`,
      newProxyCount,
      addedCount: newProxies.length,
      proxies: newProxies.map(p => ({
        id: p.id,
        ip: p.ip,
        port: p.port,
        username: p.username,
        password: p.password,
        line: `${p.username}:${p.password}@${p.ip}:${p.port}`
      }))
    });

  } catch (err) {
    console.error('Add proxies error:', err);
    res.status(500).json({ success: false, message: 'Erro ao adicionar proxies' });
  }
});

// Create 50% discount for renewal after payment failure
router.post('/create-renewal-discount', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Token não fornecido' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    // Check if user already has a valid discount
    const existingDiscounts = await sql`
      SELECT * FROM discounts 
      WHERE user_id = ${decoded.id} AND type = 'renewal_50' AND used = false AND valid_until > NOW()
    `;

    if (existingDiscounts.length > 0) {
      return res.json({
        success: true,
        discount: existingDiscounts[0],
        message: 'Você já tem um cupom de 50% de desconto disponível!'
      });
    }

    // Create 50% discount valid for 7 days
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + 7);

    const discounts = await sql`
      INSERT INTO discounts (user_id, type, discount_percent, valid_until)
      VALUES (${decoded.id}, 'renewal_50', 50, ${validUntil})
      RETURNING *
    `;

    res.json({
      success: true,
      discount: {
        id: discounts[0].id,
        type: discounts[0].type,
        discountPercent: parseFloat(discounts[0].discount_percent),
        validUntil: discounts[0].valid_until
      },
      message: 'Cupom de 50% de desconto criado! Válido por 7 dias.'
    });

  } catch (err) {
    console.error('Create renewal discount error:', err);
    res.status(500).json({ success: false, message: 'Erro ao criar desconto' });
  }
});

// Check and handle expired subscriptions
router.get('/check-expiration', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Token não fornecido' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const subscriptions = await sql`
      SELECT * FROM subscriptions 
      WHERE user_id = ${decoded.id} AND status = 'active'
      ORDER BY created_at DESC LIMIT 1
    `;

    if (subscriptions.length === 0) {
      return res.json({ success: true, expired: false, message: 'Nenhuma assinatura ativa' });
    }

    const subscription = subscriptions[0];
    const endDate = new Date(subscription.end_date);
    const now = new Date();
    const isExpired = now > endDate;
    const daysUntilExpiration = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));

    if (isExpired) {
      // Deactivate proxies
      await sql`
        UPDATE proxies SET is_active = false, updated_at = NOW()
        WHERE user_id = ${decoded.id} AND subscription_id = ${subscription.id}
      `;

      // Update subscription status
      await sql`
        UPDATE subscriptions SET status = 'expired', auto_renew = false, updated_at = NOW()
        WHERE id = ${subscription.id}
      `;

      // Create 50% discount for renewal
      const validUntil = new Date();
      validUntil.setDate(validUntil.getDate() + 7);

      await sql`
        INSERT INTO discounts (user_id, type, discount_percent, valid_until)
        VALUES (${decoded.id}, 'renewal_50', 50, ${validUntil})
      `;

      return res.json({
        success: true,
        expired: true,
        message: 'Sua assinatura expirou. Use o cupom de 50% para renovar!',
        hasDiscount: true,
        discountPercent: 50
      });
    }

    res.json({
      success: true,
      expired: false,
      daysUntilExpiration,
      endDate: subscription.end_date
    });

  } catch (err) {
    console.error('Check expiration error:', err);
    res.status(500).json({ success: false, message: 'Erro ao verificar expiração' });
  }
});

// ============ ADMIN ROUTES ============

// Admin login
router.post('/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email e senha são obrigatórios' });
    }

    const users = await sql`
      SELECT * FROM users WHERE email = ${email.toLowerCase()} AND role = 'admin'
    `;

    if (users.length === 0) {
      return res.status(400).json({ success: false, message: 'Credenciais inválidas' });
    }

    const user = users[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Credenciais inválidas' });
    }

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '24h' });

    res.json({
      success: true,
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role }
    });

  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ success: false, message: 'Erro no login', error: err.message });
  }
});

// Admin: Get all proxies
router.get('/admin/proxies', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Token não fornecido' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    
    if (decoded.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Acesso negado' });
    }

    const { status, search } = req.query;
    let query = sql`SELECT p.*, u.email as user_email FROM proxies p LEFT JOIN users u ON p.user_id = u.id`;
    
    let proxies;
    if (search) {
      proxies = await sql`
        SELECT p.*, u.email as user_email 
        FROM proxies p 
        LEFT JOIN users u ON p.user_id = u.id
        WHERE p.username ILIKE ${'%' + search + '%'} 
           OR p.ip::text ILIKE ${'%' + search + '%'}
        ORDER BY p.created_at DESC
      `;
    } else {
      proxies = await sql`
        SELECT p.*, u.email as user_email 
        FROM proxies p 
        LEFT JOIN users u ON p.user_id = u.id
        ORDER BY p.created_at DESC
      `;
    }

    res.json({ success: true, data: { proxies } });

  } catch (err) {
    console.error('Admin get proxies error:', err);
    res.status(500).json({ success: false, message: 'Erro ao buscar proxies' });
  }
});

// Admin: Create single proxy (with custom data)
router.post('/admin/proxies', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Token não fornecido' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    
    if (decoded.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Acesso negado' });
    }

    const { ip, port, username, password } = req.body;

    if (!ip || !port || !username || !password) {
      return res.status(400).json({ success: false, message: 'Todos os campos são obrigatórios' });
    }

    // Check if port is already in use
    const existing = await sql`SELECT id FROM proxies WHERE port = ${port}`;
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: 'Porta já está em uso' });
    }

    allocatedPorts.add(port);

    const newProxies = await sql`
      INSERT INTO proxies (ip, port, username, password, is_active)
      VALUES (${ip}, ${port}, ${username}, ${password}, true)
      RETURNING *
    `;

    res.status(201).json({ success: true, data: { proxy: newProxies[0] } });

  } catch (err) {
    console.error('Admin create proxy error:', err);
    res.status(500).json({ success: false, message: 'Erro ao criar proxy', error: err.message });
  }
});

// Admin: Create bulk proxies
router.post('/admin/proxies/bulk', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Token não fornecido' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    
    if (decoded.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Acesso negado' });
    }

    const { proxies } = req.body;

    if (!proxies || !Array.isArray(proxies)) {
      return res.status(400).json({ success: false, message: 'Lista de proxies inválida' });
    }

    let created = 0;
    for (const p of proxies) {
      const existing = await sql`SELECT id FROM proxies WHERE port = ${p.port}`;
      if (existing.length === 0) {
        await sql`
          INSERT INTO proxies (ip, port, username, password, is_active)
          VALUES (${p.ip}, ${p.port}, ${p.username}, ${p.password}, true)
        `;
        allocatedPorts.add(p.port);
        created++;
      }
    }

    res.status(201).json({ success: true, data: { count: created } });

  } catch (err) {
    console.error('Admin bulk create proxies error:', err);
    res.status(500).json({ success: false, message: 'Erro ao criar proxies', error: err.message });
  }
});

// Admin: Allocate proxy to user
router.post('/admin/proxies/allocate', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Token não fornecido' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    
    if (decoded.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Acesso negado' });
    }

    const { proxyId, userId } = req.body;

    await sql`
      UPDATE proxies SET user_id = ${userId}, updated_at = NOW()
      WHERE id = ${proxyId}
    `;

    res.json({ success: true, message: 'Proxy alocado com sucesso' });

  } catch (err) {
    console.error('Admin allocate proxy error:', err);
    res.status(500).json({ success: false, message: 'Erro ao alocar proxy' });
  }
});

// Admin: Delete proxy
router.delete('/admin/proxies/:id', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Token não fornecido' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    
    if (decoded.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Acesso negado' });
    }

    const { id } = req.params;

    const proxies = await sql`SELECT port FROM proxies WHERE id = ${id}`;
    if (proxies.length > 0) {
      allocatedPorts.delete(proxies[0].port);
    }

    await sql`DELETE FROM proxies WHERE id = ${id}`;

    res.json({ success: true, message: 'Proxy excluído' });

  } catch (err) {
    console.error('Admin delete proxy error:', err);
    res.status(500).json({ success: false, message: 'Erro ao excluir proxy' });
  }
});

// Admin: Get all users
router.get('/admin/users', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Token não fornecido' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    
    if (decoded.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Acesso negado' });
    }

    const users = await sql`
      SELECT u.*, 
        (SELECT COUNT(*) FROM proxies p WHERE p.user_id = u.id AND p.is_active = true) as proxy_count
      FROM users u
      ORDER BY u.created_at DESC
    `;

    res.json({ success: true, data: { users } });

  } catch (err) {
    console.error('Admin get users error:', err);
    res.status(500).json({ success: false, message: 'Erro ao buscar usuários' });
  }
});

// Admin: Create admin user
router.post('/admin/create', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email e senha são obrigatórios' });
    }

    const existing = await sql`SELECT id FROM users WHERE email = ${email.toLowerCase()}`;
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: 'Email já existe' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUsers = await sql`
      INSERT INTO users (email, password, name, role)
      VALUES (${email.toLowerCase()}, ${hashedPassword}, ${name || 'Admin'}, 'admin')
      RETURNING id, email, name, role
    `;

    res.status(201).json({ success: true, data: { user: newUsers[0] } });

  } catch (err) {
    console.error('Admin create error:', err);
    res.status(500).json({ success: false, message: 'Erro ao criar admin', error: err.message });
  }
});

module.exports = router;
