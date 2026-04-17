const express = require('express');
const router = express.Router();

console.log('=== LOADING STRIPE ROUTES ===');

let Stripe;
try {
  Stripe = require('../lib/stripe');
  console.log('✅ Stripe lib loaded');
} catch (err) {
  console.error('❌ Error loading Stripe lib:', err.message);
  Stripe = null;
}

router.post('/create-checkout', express.json(), async (req, res) => {
  try {
    console.log('=== CREATE CHECKOUT REQUEST (STRIPE) ===');
    
    if (!Stripe || !Stripe.stripe) {
      console.error('Stripe lib not loaded');
      return res.status(500).json({ 
        success: false, 
        error: 'Stripe não configurado. Verifique as variáveis de ambiente.' 
      });
    }
    
    const { email, whatsapp, period, type, proxyCount, couponDiscount } = req.body;
    const quantity = proxyCount || 1;
    
    console.log('email:', email);
    console.log('whatsapp:', whatsapp);
    console.log('type:', type);
    console.log('period:', period);
    console.log('quantity:', quantity);
    
    if (!email) {
      return res.status(400).json({ error: 'Email é obrigatório' });
    }
    
    if (!type) {
      return res.status(400).json({ error: 'Tipo de proxy é obrigatório' });
    }
    
    if (!period) {
      return res.status(400).json({ error: 'Período é obrigatório' });
    }
    
    if (!quantity || quantity < 1 || quantity > 100) {
      return res.status(400).json({ error: 'Quantidade de proxies inválida (1-100)' });
    }
    
    const priceCalculation = Stripe.calculatePrice(type, period, quantity, couponDiscount || 0);
    
    if (!priceCalculation) {
      return res.status(400).json({ error: 'Tipo ou período inválido' });
    }
    
    console.log('Price calculation:');
    console.log('  - Type:', type);
    console.log('  - Period:', period);
    console.log('  - Quantity:', quantity);
    console.log('  - Unit price:', priceCalculation.unitAmount / 100);
    console.log('  - Total:', priceCalculation.total / 100);
    
    const appUrl = process.env.APP_URL || 'https://fastproxyoriginal.vercel.app';
    
    const session = await Stripe.createCheckoutSession({
      email: email,
      type: type,
      period: period,
      quantity: quantity,
      couponDiscount: couponDiscount || 0,
      successUrl: `${appUrl}/login.html`,
      cancelUrl: `${appUrl}/planos.html?payment=cancelled`
    });
    
    console.log('Checkout session created:', session.id);
    console.log('Checkout URL:', session.url);
    
    res.json({
      success: true,
      checkoutUrl: session.url,
      sessionId: session.id,
      total: priceCalculation.total / 100,
      currency: 'BRL',
      quantity: quantity,
      period: period,
      type: type,
      pricePerUnit: priceCalculation.unitAmount / 100,
      message: 'Checkout Stripe criado com sucesso'
    });
  } catch (err) {
    console.error('Create checkout error:', err.message);
    console.error('Stack:', err.stack);
    
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.get('/verify/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    if (!Stripe) {
      return res.status(500).json({ error: 'Stripe não configurado' });
    }
    
    const session = await Stripe.retrieveSession(sessionId);
    
    res.json({
      success: true,
      paymentStatus: session.payment_status,
      customerEmail: session.customer_email,
      amountTotal: session.amount_total / 100,
      metadata: session.metadata
    });
  } catch (err) {
    console.error('Verify session error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Process payment - creates user, subscription and proxies automatically
router.post('/process-payment/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { email, password, name, whatsapp } = req.body;
    
    console.log('=== PROCESS PAYMENT ===');
    console.log('Session:', sessionId);
    console.log('User:', email);
    
    if (!Stripe || !Stripe.stripe) {
      return res.status(500).json({ success: false, error: 'Stripe não configurado' });
    }
    
    // 1. Verify payment with Stripe
    const session = await Stripe.retrieveSession(sessionId);
    
    if (session.payment_status !== 'paid') {
      return res.status(400).json({ success: false, error: 'Pagamento não confirmado' });
    }
    
    const customerEmail = session.customer_email || email;
    const proxyCount = parseInt(session.metadata?.quantity) || parseInt(req.body.proxyCount) || 1;
    const period = session.metadata?.period || req.body.period || 'monthly';
    const pricePaid = session.amount_total / 100;
    
    // 2. Check if this session was already processed
    const { sql } = require('../lib/database');
    const bcrypt = require('bcryptjs');
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'fastproxy_secret_key_2024';
    
    const existingSession = await sql`
      SELECT id, user_id FROM subscriptions WHERE stripe_session_id = ${sessionId}
    `;
    
    if (existingSession.length > 0) {
      // Already processed - return existing data
      const user = await sql`SELECT * FROM users WHERE id = ${existingSession[0].user_id}`;
      const subscriptions = await sql`SELECT * FROM subscriptions WHERE stripe_session_id = ${sessionId}`;
      const proxies = await sql`SELECT * FROM proxies WHERE subscription_id = ${subscriptions[0].id}`;
      
      const token = jwt.sign({ id: user[0].id, email: user[0].email }, JWT_SECRET, { expiresIn: '7d' });
      
      return res.json({
        success: true,
        alreadyProcessed: true,
        token,
        user: { id: user[0].id, email: user[0].email, name: user[0].name },
        subscription: {
          id: subscriptions[0].id,
          period: subscriptions[0].period,
          proxyCount: subscriptions[0].proxy_count,
          status: subscriptions[0].status
        },
        proxies: proxies.map(p => ({
          id: p.id,
          ip: p.ip,
          port: p.port,
          username: p.username,
          password: p.password,
          line: `${p.username}:${p.password}@${p.ip}:${p.port}`
        }))
      });
    }
    
    // 3. Find or create user by EMAIL (the most important thing!)
    let user;
    let isNewUser = false;
    
    const existingUsers = await sql`
      SELECT * FROM users WHERE email = ${customerEmail.toLowerCase()}
    `;
    
    if (existingUsers.length > 0) {
      // User exists - update info if provided
      user = existingUsers[0];
      
      if (whatsapp && !user.whatsapp) {
        await sql`UPDATE users SET whatsapp = ${whatsapp}, updated_at = NOW() WHERE id = ${user.id}`;
        user.whatsapp = whatsapp;
      }
      if (name && !user.name) {
        await sql`UPDATE users SET name = ${name}, updated_at = NOW() WHERE id = ${user.id}`;
        user.name = name;
      }
    } else {
      // Create new user - password is REQUIRED for login
      if (!password) {
        return res.status(400).json({ success: false, error: 'Senha é obrigatória para novo usuário' });
      }
      
      const hashedPassword = await bcrypt.hash(password, 10);
      const newUsers = await sql`
        INSERT INTO users (email, password, name, whatsapp)
        VALUES (${customerEmail.toLowerCase()}, ${hashedPassword}, ${name || null}, ${whatsapp || null})
        RETURNING *
      `;
      user = newUsers[0];
      isNewUser = true;
    }
    
    // 4. Calculate end date
    const endDate = new Date();
    if (period === 'monthly') {
      endDate.setMonth(endDate.getMonth() + 1);
    } else if (period === 'annual') {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }
    
    // 5. Create subscription
    const subscriptions = await sql`
      INSERT INTO subscriptions (user_id, stripe_session_id, stripe_customer_id, period, proxy_count, price_paid, status, start_date, end_date, auto_renew)
      VALUES (${user.id}, ${sessionId}, ${session.customer_id || null}, ${period}, ${proxyCount}, ${pricePaid}, 'active', NOW(), ${endDate}, true)
      RETURNING *
    `;
    const subscription = subscriptions[0];
    
    // 6. Allocate proxies from available stock
    // First, check for available proxies (user_id is NULL - not allocated yet)
    const availableProxies = await sql`
      SELECT * FROM proxies 
      WHERE user_id IS NULL AND subscription_id IS NULL AND is_active = true
      ORDER BY id LIMIT ${proxyCount}
    `;
    
    const proxies = [];
    
    if (availableProxies.length >= proxyCount) {
      // Use available proxies from stock
      for (let i = 0; i < proxyCount; i++) {
        const p = availableProxies[i];
        await sql`
          UPDATE proxies 
          SET user_id = ${user.id}, subscription_id = ${subscription.id}, updated_at = NOW()
          WHERE id = ${p.id}
        `;
        proxies.push({
          id: p.id,
          ip: p.ip,
          port: p.port,
          username: p.username,
          password: p.password
        });
      }
      console.log(`✅ Allocated ${proxyCount} proxies from stock`);
    } else if (availableProxies.length > 0) {
      // Partially available - use what's available and create remaining
      for (const p of availableProxies) {
        await sql`
          UPDATE proxies 
          SET user_id = ${user.id}, subscription_id = ${subscription.id}, updated_at = NOW()
          WHERE id = ${p.id}
        `;
        proxies.push({
          id: p.id,
          ip: p.ip,
          port: p.port,
          username: p.username,
          password: p.password
        });
      }
      console.log(`⚠️ Only ${availableProxies.length} proxies available, need to create more`);
      
      // Create remaining proxies
      const IP_BASE = process.env.PROXY_IP || '177.54.146.90';
      const remaining = proxyCount - availableProxies.length;
      
      for (let i = 0; i < remaining; i++) {
        const username = 'fp' + Math.floor(Math.random() * 90000 + 10000);
        const pwd = Math.random().toString(36).slice(2, 10);
        const port = PORT_START + proxies.length + i;
        
        const newProxies = await sql`
          INSERT INTO proxies (user_id, subscription_id, ip, port, username, password)
          VALUES (${user.id}, ${subscription.id}, ${IP_BASE}, ${port}, ${username}, ${pwd})
          RETURNING *
        `;
        proxies.push(newProxies[0]);
      }
    } else {
      // No proxies in stock - create new ones
      console.log('📦 No proxies in stock, creating new ones...');
      const IP_BASE = process.env.PROXY_IP || '177.54.146.90';
      const PORT_START = parseInt(process.env.PROXY_PORT_START || '11331');
      
      for (let i = 0; i < proxyCount; i++) {
        const username = 'fp' + Math.floor(Math.random() * 90000 + 10000);
        const pwd = Math.random().toString(36).slice(2, 10);
        const port = PORT_START + i;
        
        const newProxies = await sql`
          INSERT INTO proxies (user_id, subscription_id, ip, port, username, password)
          VALUES (${user.id}, ${subscription.id}, ${IP_BASE}, ${port}, ${username}, ${pwd})
          RETURNING *
        `;
        proxies.push(newProxies[0]);
      }
    }
    
    // 7. Generate JWT
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    
    // 8. Send welcome email (async)
    const { sendWelcomeEmail } = require('../lib/email');
    const proxiesData = proxies.map(p => ({
      ip: p.ip,
      port: p.port,
      username: p.username,
      password: p.password,
      line: `${p.username}:${p.password}@${p.ip}:${p.port}`
    }));
    
    sendWelcomeEmail(user.email, user.name, proxiesData).catch(err => {
      console.error('Failed to send welcome email:', err);
    });
    
    console.log('✅ Payment processed successfully!');
    console.log('User:', user.email);
    console.log('Proxies created:', proxies.length);
    
    res.json({
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
    console.error('Process payment error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const sig = req.headers['stripe-signature'];
    
    console.log('=== STRIPE WEBHOOK RECEIVED ===');
    console.log('Signature present:', !!sig);
    
    let event;
    
    if (sig && process.env.STRIPE_WEBHOOK_SECRET) {
      event = await Stripe.createWebhookEvent(req.body, sig);
    } else {
      event = req.body;
    }
    
    console.log('Event type:', event.type);
    console.log('Event data:', JSON.stringify(event.data?.object, null, 2));
    
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      console.log('Payment completed for:', session.customer_email);
      console.log('Amount:', session.amount_total / 100);
      console.log('Metadata:', session.metadata);
    }
    
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/prices', async (req, res) => {
  if (!Stripe) {
    return res.status(500).json({ error: 'Stripe não configurado' });
  }
  
  res.json({
    success: true,
    prices: {
      monthly: Stripe.PRICES.monthly.amount / 100,
      annual: Stripe.PRICES.annual.amount / 100
    }
  });
});

// Create swap checkout
router.post('/create-swap-checkout', express.json(), async (req, res) => {
  try {
    const { proxyId, reason, email } = req.body;
    
    if (!proxyId) {
      return res.status(400).json({ success: false, message: 'ID do proxy é obrigatório' });
    }
    
    if (!Stripe || !Stripe.stripe) {
      return res.status(500).json({ 
        success: false, 
        message: 'Stripe não configurado' 
      });
    }
    
    const { sql } = require('../lib/database');
    const jwt = require('jsonwebtoken');
    
    // Get auth token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Token não fornecido' });
    }
    
    const token = authHeader.split(' ')[1];
    const JWT_SECRET = process.env.JWT_SECRET || 'fastproxy_secret_key_2024';
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Get proxy and subscription info AND verify subscription is active
    const proxies = await sql`
      SELECT p.*, s.start_date, s.end_date, s.status as sub_status, s.user_id 
      FROM proxies p
      JOIN subscriptions s ON p.subscription_id = s.id
      WHERE p.id = ${proxyId} AND s.user_id = ${decoded.id}
    `;
    
    if (proxies.length === 0) {
      return res.status(404).json({ success: false, message: 'Proxy não encontrado' });
    }
    
    const proxy = proxies[0];
    
    // Verify subscription is active and not expired
    if (proxy.sub_status !== 'active' || new Date(proxy.end_date) <= new Date()) {
      return res.status(403).json({ success: false, message: 'Assinatura expirada. Renove para continuar.' });
    }
    
    const startDate = new Date(proxy.start_date);
    const now = new Date();
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    
    // Calculate price based on days
    let price;
    if (daysSinceStart <= 3) {
      price = 1.99;
    } else if (daysSinceStart <= 7) {
      price = 5.99;
    } else {
      price = 11.99;
    }
    
    const appUrl = process.env.APP_URL || 'https://fastproxyoriginal.vercel.app';
    
    // Create Stripe checkout session for swap
    const session = await Stripe.stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: email || decoded.email,
      line_items: [
        {
          price_data: {
            currency: 'brl',
            product_data: {
              name: 'Troca de Proxy',
              description: `Troca de proxy - Motivo: ${reason || 'Não informado'}`
            },
            unit_amount: Math.round(price * 100),
          },
          quantity: 1,
        }
      ],
      metadata: {
        type: 'swap',
        proxyId: proxyId.toString(),
        userId: decoded.id.toString(),
        reason: reason || 'Não informado'
      },
      success_url: `${appUrl}/portal.html?swap=success&proxyId=${proxyId}`,
      cancel_url: `${appUrl}/portal.html`
    });
    
    res.json({
      success: true,
      url: session.url,
      sessionId: session.id,
      price: price
    });
    
  } catch (err) {
    console.error('Swap checkout error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;