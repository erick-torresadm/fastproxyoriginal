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
    
    const customerEmail = (session.customer_email || email || '').toLowerCase().trim();
    // Resolve proxy count from metadata (proxy_count or quantity alias) or body fallback
    const proxyCount = parseInt(session.metadata?.proxy_count)
                    || parseInt(session.metadata?.quantity)
                    || parseInt(req.body.proxyCount)
                    || 1;
    const period    = session.metadata?.period || req.body.period || '1m';
    const proxyType = session.metadata?.type   || req.body.type   || 'ipv6';
    const pricePaid = session.amount_total / 100;

    console.log(`proxyCount: ${proxyCount}, period: ${period}, type: ${proxyType}, email: ${customerEmail}`);
    
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
    
    // 4. Calculate end date — supports both legacy ('monthly'/'annual') and new ('1m','6m','12m') formats
    const endDate = new Date();
    const PERIOD_MONTHS_MAP = {
      'monthly': 1, 'annual': 12,          // legacy
      '1w': 0.25, '2w': 0.5,               // weeks
      '1m': 1, '2m': 2, '3m': 3,
      '6m': 6, '12m': 12
    };
    const monthsToAdd = PERIOD_MONTHS_MAP[period] || 1;
    if (monthsToAdd < 1) {
      endDate.setDate(endDate.getDate() + Math.round(monthsToAdd * 30));
    } else {
      endDate.setMonth(endDate.getMonth() + monthsToAdd);
    }
    
    // 5. Create subscription
    const subscriptions = await sql`
      INSERT INTO subscriptions (user_id, stripe_session_id, stripe_customer_id, period, proxy_count, price_paid, status, start_date, end_date, auto_renew)
      VALUES (${user.id}, ${sessionId}, ${session.customer_id || null}, ${period}, ${proxyCount}, ${pricePaid}, 'active', NOW(), ${endDate}, true)
      RETURNING *
    `;
    const subscription = subscriptions[0];
    
    // 6. Provision proxies — IPv6 uses stock; IPv4/ISP/Mobile use ProxySeller API
    const proxies = [];

    if (proxyType === 'ipv6') {
      // ── Stock proxies ──────────────────────────────────────────────────────
      const availableProxies = await sql`
        SELECT * FROM proxies
        WHERE user_id IS NULL AND subscription_id IS NULL AND is_active = true
        ORDER BY id LIMIT ${proxyCount}
      `;

      if (availableProxies.length >= proxyCount) {
        for (let i = 0; i < proxyCount; i++) {
          const p = availableProxies[i];
          await sql`UPDATE proxies SET user_id=${user.id}, subscription_id=${subscription.id}, updated_at=NOW() WHERE id=${p.id}`;
          proxies.push({ id: p.id, ip: p.ip, port: p.port, username: p.username, password: p.password });
        }
        console.log(`✅ Allocated ${proxyCount} IPv6 proxies from stock`);
      } else {
        // Use what's available + generate the rest
        for (const p of availableProxies) {
          await sql`UPDATE proxies SET user_id=${user.id}, subscription_id=${subscription.id}, updated_at=NOW() WHERE id=${p.id}`;
          proxies.push({ id: p.id, ip: p.ip, port: p.port, username: p.username, password: p.password });
        }

        const IP_BASE = process.env.PROXY_IP || '177.54.146.90';
        const PORT_START = parseInt(process.env.PROXY_PORT_START || '11331');
        const maxPortRes = await sql`SELECT COALESCE(MAX(port),${PORT_START - 1}) as mp FROM proxies`;
        let nextPort = (maxPortRes[0]?.mp || PORT_START - 1) + 1;

        const remaining = proxyCount - availableProxies.length;
        for (let i = 0; i < remaining; i++) {
          const username = 'fp' + Math.floor(Math.random() * 90000 + 10000);
          const pwd = Math.random().toString(36).slice(2, 10);
          const port = nextPort + i;
          const np = await sql`
            INSERT INTO proxies (user_id, subscription_id, ip, port, username, password)
            VALUES (${user.id}, ${subscription.id}, ${IP_BASE}, ${port}, ${username}, ${pwd})
            RETURNING *
          `;
          proxies.push(np[0]);
        }
        console.log(`⚠️ Stock short — allocated ${availableProxies.length} from stock, generated ${remaining}`);
      }

    } else {
      // ── ProxySeller API proxies (IPv4, ISP, Mobile) ───────────────────────
      console.log(`🌐 Ordering ${proxyCount}x ${proxyType} proxies via ProxySeller API...`);

      const proxyseller = require('../lib/proxyseller');
      const { PROXY_TYPES } = require('../lib/proxyseller');
      const proxyTypeConfig = PROXY_TYPES[proxyType];

      if (!proxyTypeConfig) {
        throw new Error(`ProxySeller config not found for type: ${proxyType}`);
      }

      const PSE_PERIOD_MAP = { '1w':'1w','2w':'2w','1m':'1m','2m':'2m','3m':'3m','6m':'6m','12m':'12m','monthly':'1m','annual':'12m' };
      const psePeriodId = PSE_PERIOD_MAP[period] || '1m';

      try {
        // Calculate first to check balance
        const calcResult = await proxyseller.calculateOrder({
          type:     proxyType,
          countryId: proxyTypeConfig.countryId,
          periodId:  psePeriodId,
          quantity:  proxyCount,
          protocol:  'HTTPS'
        });
        console.log('ProxySeller calc result:', JSON.stringify(calcResult?.data));

        // Make the order
        const orderResult = await proxyseller.makeOrder({
          type:     proxyType,
          countryId: proxyTypeConfig.countryId,
          periodId:  psePeriodId,
          quantity:  proxyCount,
          protocol:  'HTTPS'
        });

        const orderId       = orderResult.data?.orderId || orderResult.data?.id;
        const orderNumber   = orderResult.data?.listBaseOrderNumbers?.[0] || orderId;
        console.log(`✅ ProxySeller order created: orderId=${orderId}, orderNumber=${orderNumber}`);

        // Save proxy_order record
        const periodDays = PERIOD_DAYS_MAP[period] || 30;
        try {
          await sql`
            INSERT INTO proxy_orders (
              user_id, proxyseller_order_id, proxyseller_order_number,
              proxy_type, country, country_id, quantity, period, period_days,
              cost_usd, cost_brl, price_sold_brl, profit_margin,
              status, payment_status, expira_em
            ) VALUES (
              ${user.id}, ${String(orderId)}, ${String(orderNumber)},
              ${proxyType}, 'Brazil', ${proxyTypeConfig.countryId},
              ${proxyCount}, ${period}, ${periodDays},
              ${calcResult.data?.total || 0}, ${(calcResult.data?.total || 0) * 5.5},
              ${pricePaid}, ${pricePaid - (calcResult.data?.total || 0) * 5.5},
              'active', 'paid', ${endDate}
            )
          `;
        } catch (dbErr) {
          console.warn('proxy_orders insert failed (table may not exist):', dbErr.message);
        }

        // Create auth credentials for the order
        const authResult = await proxyseller.createAuth(String(orderNumber));
        const authLogin    = authResult.data?.login    || authResult.data?.username;
        const authPassword = authResult.data?.password;
        const authId       = authResult.data?.id;
        console.log(`✅ ProxySeller auth created: id=${authId}, login=${authLogin}`);

        // Wait briefly for proxy provisioning, then fetch the list
        await new Promise(r => setTimeout(r, 3000));
        const proxyListResult = await proxyseller.getProxyList(proxyType, { orderId: String(orderNumber) });
        const psProxies = proxyListResult.data || [];

        if (psProxies.length === 0) {
          console.warn('⚠️ ProxySeller returned 0 proxies — order may be pending provisioning');
          // Store a placeholder so the user knows it's being provisioned
          const placeholderPort = 10000 + Math.floor(Math.random() * 10000);
          const np = await sql`
            INSERT INTO proxies (user_id, subscription_id, ip, port, username, password, is_active)
            VALUES (${user.id}, ${subscription.id}, ${'pending.proxyseller.com'}, ${placeholderPort}, ${authLogin || 'pending'}, ${authPassword || 'pending'}, true)
            RETURNING *
          `;
          proxies.push({ ...np[0], pending: true });
        }

        for (const p of psProxies) {
          const proxyIp   = p.host || p.ip || p.address;
          const proxyPort = p.port;

          if (!proxyIp || !proxyPort) continue;

          // Store in proxyseller_proxies (ignore errors if table doesn't exist)
          try {
            await sql`
              INSERT INTO proxyseller_proxies (user_id, proxyseller_proxy_id, ip, port, username, password, proxyseller_auth_id, is_active)
              VALUES (${user.id}, ${String(p.id || p.proxy_id)}, ${proxyIp}, ${proxyPort}, ${authLogin}, ${authPassword}, ${String(authId)}, true)
            `;
          } catch (e) { /* table may not exist or has different schema */ }

          // Also store in main proxies table (used by /me endpoint)
          const np = await sql`
            INSERT INTO proxies (user_id, subscription_id, ip, port, username, password, is_active)
            VALUES (${user.id}, ${subscription.id}, ${proxyIp}, ${proxyPort}, ${authLogin}, ${authPassword}, true)
            RETURNING *
          `;
          proxies.push(np[0]);
        }
        console.log(`✅ ProxySeller: stored ${proxies.length} proxies for user ${user.id}`);

      } catch (pseErr) {
        console.error('❌ ProxySeller API failed:', pseErr.message);
        // Fallback: log the error and store a "pending" proxy entry so user knows to contact support
        const fallbackPort = 20000 + Math.floor(Math.random() * 10000);
        const np = await sql`
          INSERT INTO proxies (user_id, subscription_id, ip, port, username, password, is_active)
          VALUES (${user.id}, ${subscription.id}, ${'api.pending'}, ${fallbackPort}, ${'pending_' + proxyType}, ${'contact_support'}, true)
          RETURNING *
        `;
        proxies.push({ ...np[0], error: `ProxySeller API error: ${pseErr.message}` });
        console.warn(`⚠️ Stored fallback proxy entry — user ${user.email} should contact support`);
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

    // Notify via Telegram (async, non-blocking)
    try {
      const notifier = require('../lib/notifier');
      notifier.notifyPurchase({
        user: { email: user.email, whatsapp: user.whatsapp },
        order: { type: proxyType, period, quantity: proxyCount, pricePaid },
        proxies: proxiesData
      }).catch(err => console.error('Notifier error:', err));
    } catch (e) { /* notifier not configured */ }
    
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