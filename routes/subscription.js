const express = require('express');
const router = express.Router();
const { sql } = require('../lib/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sendWelcomeEmail, sendProxyCredentials, sendCancellationEmail, sendPasswordResetEmail } = require('../lib/email');
const proxyseller = require('../lib/proxyseller');

// In-memory password reset tokens: email → { token, expires, name }
const resetTokens = new Map();

const JWT_SECRET = process.env.JWT_SECRET || 'fastproxy_secret_key_2024';
const JWT_EXPIRE = process.env.JWT_EXPIRE || '7d';

const IP_BASE = process.env.PROXY_IP || '177.54.146.90';
const PORT_START = parseInt(process.env.PROXY_PORT_START || '11331');
const PORT_END = parseInt(process.env.PROXY_PORT_END || '11368');

// Rate limiting for login attempts (in-memory, use Redis in production)
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_TIME = 15 * 60 * 1000; // 15 minutes

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

// Check if user exists (PUBLIC - no auth needed)
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

// Simple register (no payment, no proxies) (PUBLIC)
router.post('/register', async (req, res) => {
  try {
    const { email, password, name, whatsapp } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email e senha são obrigatórios' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: 'Email inválido' });
    }

    // Check password length
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Senha deve ter pelo menos 6 caracteres' });
    }

    // Check if user already exists
    const existingUsers = await sql`
      SELECT id FROM users WHERE email = ${email.toLowerCase()}
    `;

    if (existingUsers.length > 0) {
      return res.status(400).json({ success: false, message: 'Email já cadastrado' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUsers = await sql`
      INSERT INTO users (email, password, name, whatsapp)
      VALUES (${email.toLowerCase()}, ${hashedPassword}, ${name || null}, ${whatsapp || null})
      RETURNING id, email, name, whatsapp
    `;

    const user = newUsers[0];
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRE });

    res.status(201).json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        whatsapp: user.whatsapp
      },
      subscription: null,
      hasActiveSubscription: false,
      proxies: []
    });

  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ success: false, message: 'Erro ao criar conta', error: err.message });
  }
});

// THIS ENDPOINT IS NO LONGER USED - USE /api/stripe/process-payment INSTEAD
// Keeping for backwards compatibility but it requires a valid Stripe session
router.post('/register-after-payment', async (req, res) => {
  try {
    const { email, password, name, whatsapp, proxyCount, period, stripeSessionId } = req.body;

    // SECURITY: This endpoint ONLY works with a valid Stripe session
    // The process-payment endpoint in stripe.js handles the actual payment verification
    return res.status(403).json({ 
      success: false, 
      message: 'Use /api/stripe/process-payment instead' 
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
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';

    // Rate limiting check
    const now = Date.now();
    const userAttempts = loginAttempts.get(email.toLowerCase());
    
    if (userAttempts) {
      if (userAttempts.count >= MAX_LOGIN_ATTEMPTS) {
        if (now - userAttempts.lastAttempt < LOGIN_LOCKOUT_TIME) {
          const minutesLeft = Math.ceil((LOGIN_LOCKOUT_TIME - (now - userAttempts.lastAttempt)) / 60000);
          return res.status(429).json({ 
            success: false, 
            message: `Muitas tentativas. Tente novamente em ${minutesLeft} minutos.` 
          });
        } else {
          // Lockout expired, reset attempts
          loginAttempts.delete(email.toLowerCase());
        }
      }
    }

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email e senha são obrigatórios' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: 'Email inválido' });
    }

    const users = await sql`
      SELECT * FROM users WHERE email = ${email.toLowerCase()}
    `;

    if (users.length === 0) {
      // Record failed attempt
      const attempts = loginAttempts.get(email.toLowerCase()) || { count: 0, lastAttempt: 0 };
      loginAttempts.set(email.toLowerCase(), { 
        count: attempts.count + 1, 
        lastAttempt: now 
      });
      return res.status(400).json({ success: false, message: 'Credenciais inválidas' });
    }

    const user = users[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      // Record failed attempt
      const attempts = loginAttempts.get(email.toLowerCase()) || { count: 0, lastAttempt: 0 };
      loginAttempts.set(email.toLowerCase(), { 
        count: attempts.count + 1, 
        lastAttempt: now 
      });
      return res.status(400).json({ success: false, message: 'Credenciais inválidas' });
    }

    // Clear failed attempts on successful login
    loginAttempts.delete(email.toLowerCase());

    // Get active subscription (not expired)
    const subscriptions = await sql`
      SELECT * FROM subscriptions 
      WHERE user_id = ${user.id} AND status = 'active'
      ORDER BY created_at DESC LIMIT 1
    `;

    // Check if subscription is still valid (not expired)
    const activeSubscription = subscriptions.find(s => {
      const endDate = new Date(s.end_date);
      return endDate > new Date();
    });

    // Always get proxies if user has any active proxies (regardless of subscription status)
    let proxies = [];
    const allProxies = await sql`
      SELECT * FROM proxies 
      WHERE user_id = ${user.id} AND is_active = true
      ORDER BY created_at DESC
    `;
    
    // Get proxies if they exist
    if (allProxies.length > 0) {
      proxies = allProxies;
    }

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
      subscription: activeSubscription ? {
        id: activeSubscription.id,
        period: activeSubscription.period,
        proxyCount: activeSubscription.proxy_count,
        status: activeSubscription.status,
        startDate: activeSubscription.start_date,
        endDate: activeSubscription.end_date,
        autoRenew: activeSubscription.auto_renew
      } : subscriptions.length > 0 ? {
        id: subscriptions[0].id,
        period: subscriptions[0].period,
        proxyCount: subscriptions[0].proxy_count,
        status: subscriptions[0].status,
        startDate: subscriptions[0].start_date,
        endDate: subscriptions[0].end_date,
        autoRenew: subscriptions[0].auto_renew
      } : null,
      hasActiveSubscription: !!(activeSubscription || proxies.length > 0),
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

    // Check for ACTIVE subscription (not expired)
    const activeSubscription = subscriptions.find(s => {
      if (s.status !== 'active') return false;
      const endDate = new Date(s.end_date);
      return endDate > new Date();
    });

    let proxies = [];
    
    // Always return proxies if user has active proxies (regardless of subscription)
    const userProxies = await sql`
      SELECT p.*, pr.id as replacement_id, pr.reason, pr.created_at as replaced_at
      FROM proxies p
      LEFT JOIN proxy_replacements pr ON p.id = pr.proxy_id AND pr.created_at = (
        SELECT MAX(created_at) FROM proxy_replacements WHERE proxy_id = p.id
      )
      WHERE p.user_id = ${user.id} AND p.is_active = true
      ORDER BY p.created_at DESC
    `;
    
    if (userProxies.length > 0) {
      proxies = userProxies;
    }

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
        autoRenew: s.auto_renew,
        isActive: activeSubscription && s.id === activeSubscription.id
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
      hasActiveSubscription: !!(activeSubscription || proxies.length > 0),
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
// SECURITY: Requires auth AND must be the subscription owner
router.get('/replacement-price/:subscriptionId', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Token não fornecido' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    
    const { subscriptionId } = req.params;

    // SECURITY: Must verify the subscription belongs to this user
    const subscriptions = await sql`
      SELECT * FROM subscriptions WHERE id = ${subscriptionId} AND user_id = ${decoded.id} AND status = 'active'
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

    const { proxyId, reason, usePoints } = req.body;

    if (!proxyId) {
      return res.status(400).json({ success: false, message: 'ID do proxy é obrigatório' });
    }

    // Get current proxy with user info AND verify subscription is active
    const proxies = await sql`
      SELECT p.*, s.start_date, s.end_date, s.status as sub_status, s.id as sub_id, u.email as user_email, u.name as user_name
      FROM proxies p
      JOIN subscriptions s ON p.subscription_id = s.id
      JOIN users u ON p.user_id = u.id
      WHERE p.id = ${proxyId} AND p.user_id = ${decoded.id}
    `;

    if (proxies.length === 0) {
      return res.status(404).json({ success: false, message: 'Proxy não encontrado' });
    }

    const oldProxy = proxies[0];
    
    // Verify subscription is active and not expired
    if (oldProxy.sub_status !== 'active' || new Date(oldProxy.end_date) <= new Date()) {
      return res.status(403).json({ success: false, message: 'Assinatura expirada. Renove para continuar.' });
    }

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

    // Check if using points for free swap
    let finalPrice = price;
    if (usePoints) {
      // Deduct 100 points from user
      const [reward] = await sql`
        SELECT * FROM reward_points WHERE user_id = ${decoded.id}
      `;
      
      if (!reward || reward.available_points < 100) {
        return res.status(400).json({ success: false, message: 'Pontos insuficientes. Mínimo: 100 pontos' });
      }
      
      await sql`
        UPDATE reward_points 
        SET available_points = available_points - 100
        WHERE user_id = ${decoded.id}
      `;
      
      // Log the transaction
      await sql`
        INSERT INTO reward_transactions (user_id, type, points, description)
        VALUES (${decoded.id}, 'redeem', -100, 'Troca de proxy gratuita via pontos')
      `;
      
      finalPrice = 0;
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
      VALUES (${proxyId}, ${oldProxy.ip}, ${oldProxy.port}, ${IP_BASE}, ${newPort}, ${finalPrice}, ${reason || 'Troca solicitada pelo cliente'})
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
// SECURITY: Requires active subscription AND creates payment requirement
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

    // SECURITY: Must have ACTIVE and NOT EXPIRED subscription
    const subscriptions = await sql`
      SELECT * FROM subscriptions 
      WHERE user_id = ${decoded.id} AND status = 'active'
      ORDER BY created_at DESC LIMIT 1
    `;

    if (subscriptions.length === 0) {
      return res.status(403).json({ success: false, message: 'Nenhuma assinatura ativa. Compre proxies para adicionar mais.' });
    }

    const subscription = subscriptions[0];
    
    // SECURITY: Check if subscription is not expired
    if (new Date(subscription.end_date) <= new Date()) {
      return res.status(403).json({ success: false, message: 'Assinatura expirada. Renove para adicionar mais proxies.' });
    }

    // SECURITY: Return instructions to purchase more via Stripe
    // This endpoint no longer adds proxies directly - user must pay
    return res.status(403).json({ 
      success: false, 
      message: 'Para adicionar mais proxies, você precisa comprar novamente através do site.' 
    });

  } catch (err) {
    console.error('Add proxies error:', err);
    res.status(500).json({ success: false, message: 'Erro ao adicionar proxies' });
  }
});

// Get user's discount (read only) - discounts are created by admin or system only
router.get('/my-discounts', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Token não fornecido' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    // SECURITY: Only READ user's discounts - no creation allowed
    // Discounts can ONLY be created by admin or during expiration check
    const discounts = await sql`
      SELECT * FROM discounts 
      WHERE user_id = ${decoded.id} AND used = false AND (valid_until IS NULL OR valid_until > NOW())
    `;

    res.json({
      success: true,
      discounts: discounts.map(d => ({
        id: d.id,
        type: d.type,
        discountPercent: parseFloat(d.discount_percent),
        validUntil: d.valid_until
      }))
    });

  } catch (err) {
    console.error('Get discounts error:', err);
    res.status(500).json({ success: false, message: 'Erro ao buscar descontos' });
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

// ── Forgot password ─────────────────────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email é obrigatório' });

    const users = await sql`SELECT id, email, name FROM users WHERE email = ${email.toLowerCase()}`;

    // Always return success to prevent email enumeration attacks
    if (users.length === 0) {
      return res.json({ success: true, message: 'Se o email existir, você receberá as instruções.' });
    }

    const user = users[0];

    // Generate a 64-char hex token
    const crypto = require('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + 30 * 60 * 1000; // 30 min

    resetTokens.set(email.toLowerCase(), { token, expires, userId: user.id, name: user.name });

    // Clean up expired tokens opportunistically
    for (const [k, v] of resetTokens.entries()) {
      if (v.expires < Date.now()) resetTokens.delete(k);
    }

    // Send email async
    sendPasswordResetEmail(user.email, user.name, token).catch(err =>
      console.error('Failed to send reset email:', err)
    );

    console.log(`🔑 Password reset token generated for ${email} (expires in 30min)`);
    res.json({ success: true, message: 'Se o email existir, você receberá as instruções.' });

  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ success: false, message: 'Erro interno. Tente novamente.' });
  }
});

// ── Reset password ───────────────────────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ success: false, message: 'Token e nova senha são obrigatórios' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'A senha deve ter pelo menos 6 caracteres' });
    }

    // Find token in map
    let foundEntry = null;
    let foundEmail = null;
    for (const [email, entry] of resetTokens.entries()) {
      if (entry.token === token) {
        foundEntry = entry;
        foundEmail = email;
        break;
      }
    }

    if (!foundEntry) {
      return res.status(400).json({ success: false, message: 'Token inválido ou já utilizado' });
    }

    if (foundEntry.expires < Date.now()) {
      resetTokens.delete(foundEmail);
      return res.status(400).json({ success: false, message: 'Token expirado. Solicite um novo.' });
    }

    // Update password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await sql`UPDATE users SET password = ${hashedPassword}, updated_at = NOW() WHERE id = ${foundEntry.userId}`;

    // Invalidate token
    resetTokens.delete(foundEmail);

    console.log(`✅ Password reset successful for userId=${foundEntry.userId}`);
    res.json({ success: true, message: 'Senha alterada com sucesso! Faça login com sua nova senha.' });

  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ success: false, message: 'Erro interno. Tente novamente.' });
  }
});

// ── Transaction history ──────────────────────────────────────────────────────
router.get('/history', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Token não fornecido' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    // Get all subscriptions (purchases)
    const subscriptions = await sql`
      SELECT
        s.id,
        s.period,
        s.proxy_count,
        s.price_paid,
        s.status,
        s.start_date,
        s.end_date,
        s.created_at,
        s.stripe_session_id
      FROM subscriptions s
      WHERE s.user_id = ${decoded.id}
      ORDER BY s.created_at DESC
      LIMIT 50
    `;

    // Get proxy orders (ProxySeller purchases)
    let proxyOrders = [];
    try {
      proxyOrders = await sql`
        SELECT
          po.id,
          po.proxy_type,
          po.quantity,
          po.period,
          po.price_sold_brl as price_paid,
          po.status,
          po.created_at,
          po.expira_em as end_date,
          'proxy_order' as record_type
        FROM proxy_orders po
        WHERE po.user_id = ${decoded.id}
        ORDER BY po.created_at DESC
        LIMIT 20
      `;
    } catch (e) {
      // proxy_orders table may not exist
    }

    const PERIOD_NAMES = {
      '1m':'1 Mês','6m':'6 Meses','12m':'12 Meses',
      '1w':'1 Semana','2w':'2 Semanas','3m':'3 Meses',
      monthly:'Mensal', annual:'Anual'
    };

    const history = subscriptions.map(s => ({
      id:         s.id,
      type:       'subscription',
      description:`${s.proxy_count} proxy(s) — ${PERIOD_NAMES[s.period] || s.period}`,
      amount:     parseFloat(s.price_paid) || 0,
      status:     s.status,
      date:       s.created_at,
      endDate:    s.end_date,
      sessionId:  s.stripe_session_id
    })).concat(proxyOrders.map(o => ({
      id:         o.id,
      type:       'proxy_order',
      description:`${o.quantity} proxy(s) ${o.proxy_type?.toUpperCase() || ''} via API — ${PERIOD_NAMES[o.period] || o.period}`,
      amount:     parseFloat(o.price_paid) || 0,
      status:     o.status,
      date:       o.created_at,
      endDate:    o.end_date
    }))).sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({ success: true, history });

  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token inválido ou expirado' });
    }
    console.error('History error:', err);
    res.status(500).json({ success: false, message: 'Erro ao buscar histórico' });
  }
});

// ── Poll ProxySeller API for pending orders ──────────────────────────────────
router.post('/fetch-proxies', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Token não fornecido' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    // Find active proxy_orders for this user
    let proxyOrders = [];
    try {
      proxyOrders = await sql`
        SELECT * FROM proxy_orders
        WHERE user_id = ${decoded.id} AND status = 'active' AND payment_status = 'paid'
          AND (proxyseller_order_id IS NOT NULL OR proxyseller_order_number IS NOT NULL)
          AND proxy_type != 'ipv6'
        ORDER BY created_at DESC
        LIMIT 10
      `;
    } catch (e) {
      // proxy_orders table may not exist
      return res.json({ success: true, fetched: 0, message: 'No orders to check' });
    }

    if (proxyOrders.length === 0) {
      return res.json({ success: true, fetched: 0, message: 'No pending orders' });
    }

    let totalFetched = 0;
    let totalAuthsCreated = 0;

    for (const order of proxyOrders) {
      const orderNumber = order.proxyseller_order_number || order.proxyseller_order_id;
      if (!orderNumber) continue;

      console.log(`🔄 Polling ProxySeller for order ${orderNumber} (type: ${order.proxy_type})...`);

      // 1. Fetch proxies from ProxySeller API
      let proxyListResult;
      try {
        const pseType = order.proxy_type || 'ipv4';
        proxyListResult = await proxyseller.getProxyList(pseType, { orderId: String(orderNumber) });
      } catch (e) {
        console.warn(`⏳ Order ${orderNumber} still provisioning:`, e.message);
        continue;
      }

      const psProxies = proxyListResult.data || [];
      if (psProxies.length === 0) {
        console.log(`⏳ Order ${orderNumber} — no proxies ready yet`);
        continue;
      }

      console.log(`✅ Order ${orderNumber} — ${psProxies.length} proxies ready!`);

      // 2. Check if auths exist, create if needed
      let authLogin = null;
      let authPassword = null;
      let authId = null;

      try {
        const authsList = await proxyseller.listAuths(String(orderNumber));
        const authData = authsList.data || {};
        const auths = Array.isArray(authData) ? authData : Object.values(authData);
        if (auths.length > 0) {
          authLogin = auths[0].login || auths[0].username;
          authPassword = auths[0].password;
          authId = auths[0].id;
          console.log(`  Auth found: ${authLogin}`);
        }
      } catch (e) {
        console.log(`  No auths yet for order ${orderNumber}, creating...`);
        try {
          const authResult = await proxyseller.createAuth(String(orderNumber));
          authLogin = authResult.data?.login || authResult.data?.username;
          authPassword = authResult.data?.password;
          authId = authResult.data?.id;
          totalAuthsCreated++;
          console.log(`  Auth created: ${authLogin}`);
        } catch (authErr) {
          console.warn(`  Failed to create auth for ${orderNumber}:`, authErr.message);
          continue;
        }
      }

      // 3. Save each proxy to DB
      for (const p of psProxies) {
        const proxyIp = p.host || p.ip || p.address;
        const proxyPort = p.port;
        if (!proxyIp || !proxyPort) continue;

        // Check if already saved
        const existing = await sql`
          SELECT id FROM proxies WHERE user_id = ${decoded.id} AND ip = ${proxyIp} AND port = ${proxyPort}
        `;
        if (existing.length > 0) continue; // already in DB

        // Store in proxyseller_proxies
        try {
          await sql`
            INSERT INTO proxyseller_proxies (user_id, ip, port, username, password, proxyseller_auth_id, is_active)
            VALUES (${decoded.id}, ${proxyIp}, ${proxyPort}, ${authLogin}, ${authPassword}, ${String(authId)}, true)
          `;
        } catch (e) { /* table might not exist */ }

        // Store in main proxies table
        await sql`
          INSERT INTO proxies (user_id, ip, port, username, password, is_active)
          VALUES (${decoded.id}, ${proxyIp}, ${proxyPort}, ${authLogin}, ${authPassword}, true)
        `;

        totalFetched++;
        console.log(`  Saved proxy: ${proxyIp}:${proxyPort}`);
      }
    }

    const message = totalFetched > 0
      ? `${totalFetched} proxy(s) encontrados e salvos!${totalAuthsCreated > 0 ? ` (${totalAuthsCreated} auth(s) criados)` : ''}`
      : 'Proxies ainda provisionando. Tente novamente em 1-2 minutos.';

    res.json({ success: true, fetched: totalFetched, authsCreated: totalAuthsCreated, message });

  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token inválido ou expirado' });
    }
    console.error('Fetch proxies error:', err);
    res.status(500).json({ success: false, message: 'Erro ao consultar ProxySeller' });
  }
});

// Cancel subscription
router.post('/cancel', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Token não fornecido' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const { reason, subscriptionId } = req.body;

    // ── 1. Find the active subscription ──────────────────────────────────────
    let subscriptionQuery;
    if (subscriptionId) {
      subscriptionQuery = await sql`
        SELECT s.*, u.email as user_email, u.name as user_name
        FROM subscriptions s
        JOIN users u ON s.user_id = u.id
        WHERE s.id = ${subscriptionId} AND s.user_id = ${decoded.id} AND s.status = 'active'
      `;
    } else {
      subscriptionQuery = await sql`
        SELECT s.*, u.email as user_email, u.name as user_name
        FROM subscriptions s
        JOIN users u ON s.user_id = u.id
        WHERE s.user_id = ${decoded.id} AND s.status = 'active'
        ORDER BY s.created_at DESC
        LIMIT 1
      `;
    }

    if (subscriptionQuery.length === 0) {
      return res.status(404).json({ success: false, message: 'Nenhuma assinatura ativa encontrada' });
    }

    const subscription = subscriptionQuery[0];

    // ── 2. Mark subscription as cancelled in DB ───────────────────────────────
    await sql`
      UPDATE subscriptions
      SET status = 'cancelled', auto_renew = false, updated_at = NOW()
      WHERE id = ${subscription.id}
    `;

    // ── 3. Deactivate stock proxies — proxies remain usable until end_date ────
    // NOTE: proxies keep working until original end_date (user already paid)
    await sql`
      UPDATE proxies
      SET is_active = false, updated_at = NOW()
      WHERE user_id = ${decoded.id} AND subscription_id = ${subscription.id}
    `;

    // ── 4. Deactivate ProxySeller API proxies ─────────────────────────────────
    // Find any active proxy_orders linked to this user and deactivate their auths
    try {
      // Check if proxy_orders table exists and has records for this user
      const activeOrders = await sql`
        SELECT po.id, po.proxyseller_order_number, po.status
        FROM proxy_orders po
        WHERE po.user_id = ${decoded.id} AND po.status = 'active'
      `;

      if (activeOrders.length > 0) {
        console.log(`🔌 Deactivating ${activeOrders.length} ProxySeller order(s) for user ${decoded.id}`);

        for (const order of activeOrders) {
          try {
            // Get all active auths for this order
            const auths = await sql`
              SELECT pp.id, pp.proxyseller_auth_id
              FROM proxyseller_proxies pp
              WHERE pp.proxy_order_id = ${order.id} AND pp.is_active = true AND pp.proxyseller_auth_id IS NOT NULL
            `;

            // Deactivate each auth via ProxySeller API
            for (const auth of auths) {
              try {
                await proxyseller.changeAuth(auth.proxyseller_auth_id, false);
                console.log(`  ✓ Deactivated ProxySeller auth ${auth.proxyseller_auth_id}`);
              } catch (authErr) {
                console.error(`  ✗ Failed to deactivate auth ${auth.proxyseller_auth_id}:`, authErr.message);
              }
            }

            // Mark proxyseller_proxies as inactive in DB
            await sql`
              UPDATE proxyseller_proxies
              SET is_active = false, updated_at = NOW()
              WHERE proxy_order_id = ${order.id}
            `;

            // Mark proxy_order as cancelled
            await sql`
              UPDATE proxy_orders
              SET status = 'cancelled', updated_at = NOW()
              WHERE id = ${order.id}
            `;

          } catch (orderErr) {
            console.error(`Failed to process proxy_order ${order.id}:`, orderErr.message);
          }
        }
      }
    } catch (psErr) {
      // proxy_orders table may not exist or ProxySeller key not set — not fatal
      console.warn('ProxySeller cancellation skipped:', psErr.message);
    }

    // ── 5. Notify via Telegram (async, non-blocking) ────────────────────────
    try {
      const notifier = require('../lib/notifier');
      notifier.notifyCancellation({
        user: { email: subscription.user_email, name: subscription.user_name },
        subscription: { period: subscription.period, proxyCount: subscription.proxy_count },
        reason
      }).catch(err => console.error('Notifier error:', err));
    } catch (e) { /* notifier not configured */ }

    // ── 5. Send cancellation email (async, non-blocking) ─────────────────────
    sendCancellationEmail(subscription.user_email, subscription.user_name, {
      period:     subscription.period,
      proxyCount: subscription.proxy_count,
      endDate:    subscription.end_date,
      reason:     reason || 'Não informado'
    }).catch(err => console.error('Failed to send cancellation email:', err));

    console.log(`✅ Subscription ${subscription.id} cancelled by user ${decoded.id} — reason: ${reason || 'not provided'}`);

    res.json({
      success: true,
      message: 'Assinatura cancelada com sucesso.',
      subscription: {
        id:         subscription.id,
        status:     'cancelled',
        endDate:    subscription.end_date,
        period:     subscription.period,
        proxyCount: subscription.proxy_count
      }
    });

  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token inválido ou expirado' });
    }
    console.error('Cancel subscription error:', err);
    res.status(500).json({ success: false, message: 'Erro ao cancelar assinatura' });
  }
});

// ============ ADMIN ROUTES ============

// Admin login - simplified debug
router.post('/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    console.log('Admin login attempt:', email);

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email e senha são obrigatórios' });
    }

    // Check DATABASE_URL
    if (!process.env.DATABASE_URL) {
      console.error('DATABASE_URL not set!');
      return res.status(500).json({ success: false, message: 'Banco de dados não configurado' });
    }

    const users = await sql`
      SELECT * FROM users WHERE email = ${email.toLowerCase()} AND role = 'admin'
    `;

    if (users.length === 0) {
      console.log('Admin not found:', email);
      return res.status(400).json({ success: false, message: 'Credenciais inválidas' });
    }

    const user = users[0];
    console.log('User found:', user.email, user.role);
    
    const isMatch = await bcrypt.compare(password, user.password);
    console.log('Password match:', isMatch);

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
    res.status(500).json({ success: false, message: 'Erro no login: ' + err.message });
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
    
    let proxies;
    if (search) {
      // Sanitize search input - only allow alphanumeric, spaces, dots, colons, underscores
      const sanitizedSearch = search.replace(/[^a-zA-Z0-9\s._-]/g, '').substring(0, 100);
      const searchPattern = `%${sanitizedSearch}%`;
      
      proxies = await sql`
        SELECT p.*, u.email as user_email 
        FROM proxies p 
        LEFT JOIN users u ON p.user_id = u.id
        WHERE p.username ILIKE ${searchPattern} 
           OR p.ip::text ILIKE ${searchPattern}
           OR u.email ILIKE ${searchPattern}
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

    const { proxyId, userId, email } = req.body;

    // If email provided, find user
    let targetUserId = userId;
    if (email && !targetUserId) {
      const users = await sql`SELECT id FROM users WHERE email = ${email.toLowerCase()}`;
      if (users.length > 0) {
        targetUserId = users[0].id;
      }
    }
    
    if (!targetUserId) {
      return res.status(400).json({ success: false, message: 'Usuário não encontrado' });
    }

    await sql`
      UPDATE proxies SET user_id = ${targetUserId}, updated_at = NOW()
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

// Admin: Update proxy (return to stock)
router.put('/admin/proxies/:id', async (req, res) => {
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
    const { returnToStock } = req.body;

    if (returnToStock) {
      // Return proxy to stock - remove user and subscription association
      await sql`
        UPDATE proxies 
        SET user_id = NULL, subscription_id = NULL, is_active = true, updated_at = NOW()
        WHERE id = ${id}
      `;
      res.json({ success: true, message: 'Proxy devolvido ao estoque' });
    } else {
      res.json({ success: true, message: 'Proxy atualizado' });
    }

  } catch (err) {
    console.error('Admin update proxy error:', err);
    res.status(500).json({ success: false, message: 'Erro ao atualizar proxy', error: err.message });
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

// Admin: Get user by email
router.get('/admin/users/by-email/:email', async (req, res) => {
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

    const { email } = req.params;
    const users = await sql`
      SELECT u.*, 
        (SELECT COUNT(*) FROM proxies p WHERE p.user_id = u.id AND p.is_active = true) as proxy_count
      FROM users u
      WHERE u.email ILIKE ${'%' + email + '%'}
      ORDER BY u.created_at DESC
      LIMIT 10
    `;

    res.json({ success: true, data: { users } });

  } catch (err) {
    console.error('Admin get user by email error:', err);
    res.status(500).json({ success: false, message: 'Erro ao buscar usuário' });
  }
});

// Admin: Create admin user
// SECURITY: Requires admin auth
router.post('/admin/create', async (req, res) => {
  try {
    // SECURITY: Check admin auth
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Token não fornecido' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    
    if (decoded.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Acesso negado - Apenas admins' });
    }

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

// Admin: Cancel user subscription with optional 50% discount
router.post('/admin/users/:id/cancel', async (req, res) => {
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
    const { applyCoupon, discountPercent } = req.body;

    // Get user's active subscription
    const subscriptions = await sql`
      SELECT * FROM subscriptions 
      WHERE user_id = ${id} AND status = 'active'
      ORDER BY created_at DESC LIMIT 1
    `;

    if (subscriptions.length === 0) {
      return res.status(404).json({ success: false, message: 'Nenhuma assinatura ativa encontrada' });
    }

    const subscription = subscriptions[0];

    // Cancel the subscription
    await sql`
      UPDATE subscriptions 
      SET status = 'cancelled', auto_renew = false, updated_at = NOW()
      WHERE id = ${subscription.id}
    `;

    // Deactivate proxies
    await sql`
      UPDATE proxies SET is_active = false, updated_at = NOW()
      WHERE user_id = ${id} AND subscription_id = ${subscription.id}
    `;

    // If applying coupon, create discount
    if (applyCoupon && discountPercent) {
      const validUntil = new Date();
      validUntil.setDate(validUntil.getDate() + 7); // Valid for 7 days

      await sql`
        INSERT INTO discounts (user_id, type, discount_percent, valid_until)
        VALUES (${id}, 'cancellation_50', ${discountPercent}, ${validUntil})
      `;
    }

    res.json({ 
      success: true, 
      message: applyCoupon 
        ? `Assinatura cancelada. Cupom de ${discountPercent}% criado.` 
        : 'Assinatura cancelada sem cupom.' 
    });

  } catch (err) {
    console.error('Admin cancel subscription error:', err);
    res.status(500).json({ success: false, message: 'Erro ao cancelar assinatura', error: err.message });
  }
});

// Admin: Update user subscription (extend, add proxies, etc)
router.put('/admin/users/:id/subscription', async (req, res) => {
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
    const { action, days, proxyCount } = req.body;

    // Get user's active subscription
    const subscriptions = await sql`
      SELECT * FROM subscriptions 
      WHERE user_id = ${id} AND status = 'active'
      ORDER BY created_at DESC LIMIT 1
    `;

    if (subscriptions.length === 0) {
      return res.status(404).json({ success: false, message: 'Nenhuma assinatura ativa encontrada' });
    }

    const subscription = subscriptions[0];

    if (action === 'extend') {
      const newEndDate = new Date(subscription.end_date);
      newEndDate.setDate(newEndDate.getDate() + (days || 30));
      
      await sql`
        UPDATE subscriptions 
        SET end_date = ${newEndDate}, updated_at = NOW()
        WHERE id = ${subscription.id}
      `;

      res.json({ success: true, message: `Assinatura extendida por ${days || 30} dias.` });
    } else if (action === 'addProxies') {
      const newProxyCount = subscription.proxy_count + (proxyCount || 1);
      
      await sql`
        UPDATE subscriptions 
        SET proxy_count = ${newProxyCount}, updated_at = NOW()
        WHERE id = ${subscription.id}
      `;

      // Generate new proxies
      for (let i = 0; i < (proxyCount || 1); i++) {
        const port = getNextPort();
        if (!port) break;
        
        allocatedPorts.add(port);
        const username = generateUsername();
        const pwd = generatePassword();

        await sql`
          INSERT INTO proxies (user_id, subscription_id, ip, port, username, password)
          VALUES (${id}, ${subscription.id}, ${IP_BASE}, ${port}, ${username}, ${pwd})
        `;
      }

      res.json({ success: true, message: `${proxyCount || 1} proxies adicionados.` });
    } else {
      res.status(400).json({ success: false, message: 'Ação inválida. Use "extend" ou "addProxies".' });
    }

  } catch (err) {
    console.error('Admin update subscription error:', err);
    res.status(500).json({ success: false, message: 'Erro ao atualizar assinatura', error: err.message });
  }
});

// Admin: Add proxies to stock (available pool)
router.post('/admin/add-to-stock', async (req, res) => {
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

    const { count } = req.body;
    const quantity = parseInt(count) || 1;
    
    if (quantity < 1 || quantity > 100) {
      return res.status(400).json({ success: false, message: 'Quantidade inválida (1-100)' });
    }

    const IP_BASE = process.env.PROXY_IP || '177.54.146.90';
    const PORT_START = parseInt(process.env.PROXY_PORT_START || '11331');
    
    // Get highest port used
    const maxPortResult = await sql`SELECT MAX(port) as max_port FROM proxies`;
    let nextPort = PORT_START;
    if (maxPortResult[0]?.max_port) {
      nextPort = maxPortResult[0].max_port + 1;
    }

    const created = [];
    for (let i = 0; i < quantity; i++) {
      const port = nextPort + i;
      const username = 'fp' + Math.floor(Math.random() * 90000 + 10000);
      const password = Math.random().toString(36).slice(2, 10);
      
      await sql`
        INSERT INTO proxies (ip, port, username, password, is_active)
        VALUES (${IP_BASE}, ${port}, ${username}, ${password}, true)
      `;
      
      created.push({ ip: IP_BASE, port, username });
    }

    console.log(`✅ Added ${quantity} proxies to stock`);

    res.json({ 
      success: true, 
      message: `${quantity} proxies adicionados ao estoque!`,
      proxies: created
    });

  } catch (err) {
    console.error('Admin add to stock error:', err);
    res.status(500).json({ success: false, message: 'Erro ao adicionar ao estoque', error: err.message });
  }
});

// Admin: Get stock (available proxies)
router.get('/admin/stock', async (req, res) => {
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

    const stockProxies = await sql`
      SELECT id, ip, port, username, password, created_at
      FROM proxies 
      WHERE user_id IS NULL AND subscription_id IS NULL
      ORDER BY id
    `;

    const allocatedProxies = await sql`
      SELECT COUNT(*) as count FROM proxies WHERE user_id IS NOT NULL
    `;

    res.json({
      success: true,
      stock: stockProxies,
      stockCount: stockProxies.length,
      allocatedCount: allocatedProxies[0]?.count || 0,
      totalCount: stockProxies.length + (allocatedProxies[0]?.count || 0)
    });

  } catch (err) {
    console.error('Admin stock error:', err);
    res.status(500).json({ success: false, message: 'Erro ao buscar estoque', error: err.message });
  }
});

// Admin setup - creates admin user if not exists
// SECURITY: Requires admin auth OR can only be used if NO admin exists (for initial setup)
router.post('/admin/setup', async (req, res) => {
  try {
    // First check if any admin exists
    const adminCheck = await sql`SELECT id FROM users WHERE role = 'admin' LIMIT 1`;
    
    // If admin exists, this endpoint requires admin auth
    if (adminCheck.length > 0) {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Token não fornecido' });
      }

      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, JWT_SECRET);
      
      if (decoded.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Acesso negado - Apenas admins' });
      }
    }
    
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email e senha são obrigatórios' });
    }
    
    // Check if user exists
    const existingUsers = await sql`
      SELECT id, role FROM users WHERE email = ${email.toLowerCase()}
    `;
    
    if (existingUsers.length > 0) {
      // Update existing user to admin
      const hashedPassword = await bcrypt.hash(password, 10);
      await sql`
        UPDATE users 
        SET password = ${hashedPassword}, role = 'admin', updated_at = NOW()
        WHERE email = ${email.toLowerCase()}
      `;
      
      return res.json({ success: true, message: 'Admin atualizado com sucesso!' });
    }
    
    // Create new admin
    const hashedPassword = await bcrypt.hash(password, 10);
    await sql`
      INSERT INTO users (email, password, name, role)
      VALUES (${email.toLowerCase()}, ${hashedPassword}, 'Admin', 'admin')
    `;
    
    res.status(201).json({ success: true, message: 'Admin criado com sucesso!' });
    
  } catch (err) {
    console.error('Admin setup error:', err);
    res.status(500).json({ success: false, message: 'Erro ao criar admin', error: err.message });
  }
});

// Test Telegram notification (public — for setup verification)
router.get('/test-telegram', async (req, res) => {
  try {
    const { testNotification } = require('../lib/notifier');
    await testNotification();
    res.json({ success: true, message: 'Test notification sent! Check your Telegram.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Debug: check saved proxy_orders (requires auth)
router.get('/debug/orders', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Token não fornecido' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    try {
      const orders = await sql`
        SELECT id, user_id, proxy_type, country, quantity, period,
          proxyseller_order_id, proxyseller_order_number, status, payment_status
        FROM proxy_orders
        WHERE user_id = ${decoded.id}
        ORDER BY created_at DESC
      `;
      res.json({ success: true, orders: orders.length > 0 ? orders : [ { hint: 'No orders found in proxy_orders table for this user' } ] });
    } catch(e) {
      res.json({ success: true, error: 'proxy_orders table may not exist or missing columns', message: e.message });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Public: Get all tutorials
router.get('/tutorials', async (req, res) => {
  try {
    const tutorials = await sql`
      SELECT id, title, slug, excerpt, content, category, icon, image_url, created_at, updated_at
      FROM tutorials
      WHERE status = 'published'
      ORDER BY created_at DESC
    `;
    
    res.json({ success: true, tutorials });
  } catch (err) {
    console.error('Get tutorials error:', err);
    res.status(500).json({ success: false, message: 'Erro ao buscar tutoriais' });
  }
});

// Public: Get single tutorial by slug
router.get('/tutorials/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    
    const tutorials = await sql`
      SELECT * FROM tutorials WHERE slug = ${slug} AND status = 'published'
    `;
    
    if (tutorials.length === 0) {
      return res.status(404).json({ success: false, message: 'Tutorial não encontrado' });
    }
    
    res.json({ success: true, tutorial: tutorials[0] });
  } catch (err) {
    console.error('Get tutorial error:', err);
    res.status(500).json({ success: false, message: 'Erro ao buscar tutorial' });
  }
});

// Admin: CRUD Tutorials
router.get('/admin/tutorials', async (req, res) => {
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

    const tutorials = await sql`
      SELECT * FROM tutorials ORDER BY created_at DESC
    `;
    
    res.json({ success: true, tutorials });
  } catch (err) {
    console.error('Admin get tutorials error:', err);
    res.status(500).json({ success: false, message: 'Erro ao buscar tutoriais' });
  }
});

router.post('/admin/tutorials', async (req, res) => {
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

    const { title, slug, excerpt, content, category, icon, image_url, status } = req.body;
    
    if (!title || !slug) {
      return res.status(400).json({ success: false, message: 'Título e slug são obrigatórios' });
    }
    
    const tutorials = await sql`
      INSERT INTO tutorials (title, slug, excerpt, content, category, icon, image_url, status)
      VALUES (${title}, ${slug}, ${excerpt || null}, ${content || null}, ${category || 'configuracao'}, ${icon || 'book'}, ${image_url || null}, ${status || 'draft'})
      RETURNING *
    `;
    
    res.status(201).json({ success: true, tutorial: tutorials[0] });
  } catch (err) {
    console.error('Admin create tutorial error:', err);
    res.status(500).json({ success: false, message: 'Erro ao criar tutorial', error: err.message });
  }
});

router.put('/admin/tutorials/:id', async (req, res) => {
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
    const { title, slug, excerpt, content, category, icon, image_url, status } = req.body;
    
    const tutorials = await sql`
      UPDATE tutorials 
      SET title = COALESCE(${title}, title),
          slug = COALESCE(${slug}, slug),
          excerpt = ${excerpt},
          content = ${content},
          category = ${category},
          icon = ${icon},
          image_url = ${image_url},
          status = ${status},
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;
    
    if (tutorials.length === 0) {
      return res.status(404).json({ success: false, message: 'Tutorial não encontrado' });
    }
    
    res.json({ success: true, tutorial: tutorials[0] });
  } catch (err) {
    console.error('Admin update tutorial error:', err);
    res.status(500).json({ success: false, message: 'Erro ao atualizar tutorial' });
  }
});

router.delete('/admin/tutorials/:id', async (req, res) => {
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
    
    await sql`DELETE FROM tutorials WHERE id = ${id}`;
    
    res.json({ success: true, message: 'Tutorial excluído' });
  } catch (err) {
    console.error('Admin delete tutorial error:', err);
    res.status(500).json({ success: false, message: 'Erro ao excluir tutorial' });
  }
});

// Blog posts (similar structure)
router.get('/posts', async (req, res) => {
  try {
    const posts = await sql`
      SELECT id, title, slug, excerpt, content, category, image_url, created_at
      FROM blog_posts
      WHERE status = 'published'
      ORDER BY created_at DESC
    `;
    
    res.json({ success: true, posts });
  } catch (err) {
    console.error('Get posts error:', err);
    res.status(500).json({ success: false, message: 'Erro ao buscar posts' });
  }
});

router.get('/posts/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    
    const posts = await sql`
      SELECT * FROM blog_posts WHERE slug = ${slug} AND status = 'published'
    `;
    
    if (posts.length === 0) {
      return res.status(404).json({ success: false, message: 'Post não encontrado' });
    }
    
    res.json({ success: true, post: posts[0] });
  } catch (err) {
    console.error('Get post error:', err);
    res.status(500).json({ success: false, message: 'Erro ao buscar post' });
  }
});

router.get('/admin/posts', async (req, res) => {
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

    const posts = await sql`SELECT * FROM blog_posts ORDER BY created_at DESC`;
    res.json({ success: true, posts });
  } catch (err) {
    console.error('Admin get posts error:', err);
    res.status(500).json({ success: false, message: 'Erro ao buscar posts' });
  }
});

router.post('/admin/posts', async (req, res) => {
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

    const { title, slug, excerpt, content, category, image_url, status, meta_title, meta_description } = req.body;
    
    if (!title || !slug) {
      return res.status(400).json({ success: false, message: 'Título e slug são obrigatórios' });
    }
    
    const posts = await sql`
      INSERT INTO blog_posts (title, slug, excerpt, content, category, image_url, status, meta_title, meta_description)
      VALUES (${title}, ${slug}, ${excerpt || null}, ${content || null}, ${category || 'geral'}, ${image_url || null}, ${status || 'draft'}, ${meta_title || null}, ${meta_description || null})
      RETURNING *
    `;
    
    res.status(201).json({ success: true, post: posts[0] });
  } catch (err) {
    console.error('Admin create post error:', err);
    res.status(500).json({ success: false, message: 'Erro ao criar post', error: err.message });
  }
});

router.put('/admin/posts/:id', async (req, res) => {
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
    const { title, slug, excerpt, content, category, image_url, status, meta_title, meta_description } = req.body;
    
    const posts = await sql`
      UPDATE blog_posts 
      SET title = COALESCE(${title}, title),
          slug = COALESCE(${slug}, slug),
          excerpt = ${excerpt},
          content = ${content},
          category = ${category},
          image_url = ${image_url},
          status = ${status},
          meta_title = ${meta_title},
          meta_description = ${meta_description},
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;
    
    if (posts.length === 0) {
      return res.status(404).json({ success: false, message: 'Post não encontrado' });
    }
    
    res.json({ success: true, post: posts[0] });
  } catch (err) {
    console.error('Admin update post error:', err);
    res.status(500).json({ success: false, message: 'Erro ao atualizar post' });
  }
});

router.delete('/admin/posts/:id', async (req, res) => {
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
    
    await sql`DELETE FROM blog_posts WHERE id = ${id}`;
    
    res.json({ success: true, message: 'Post excluído' });
  } catch (err) {
    console.error('Admin delete post error:', err);
    res.status(500).json({ success: false, message: 'Erro ao excluir post' });
  }
});

module.exports = router;
