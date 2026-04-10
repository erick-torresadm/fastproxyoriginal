const express = require('express');
const router = express.Router();
const { sql } = require('../lib/database');
const proxyseller = require('../lib/proxyseller');
const { PROXY_TYPES, PERIODS, PRICING } = require('../lib/proxyseller');
const { authenticate, isAdmin } = require('./subscription');

router.get('/types', (req, res) => {
  const types = Object.entries(PROXY_TYPES).map(([key, value]) => ({
    id: key,
    ...value
  }));
  res.json({ success: true, types });
});

router.get('/periods', (req, res) => {
  const periods = Object.entries(PERIODS).map(([key, value]) => ({
    id: key,
    ...value
  }));
  res.json({ success: true, periods });
});

router.get('/pricing', (req, res) => {
  res.json({ success: true, pricing: PRICING });
});

router.post('/calculate', authenticate, async (req, res) => {
  try {
    const { type = 'ipv6', period = '1m', quantity = 1, countryId } = req.body;

    const pricing = proxyseller.getPricing(type, period, quantity);

    res.json({
      success: true,
      pricing
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/buy', authenticate, async (req, res) => {
  try {
    const { type = 'ipv6', period = '1m', quantity = 1, protocol = 'HTTPS' } = req.body;

    const proxyType = PROXY_TYPES[type];
    if (!proxyType) {
      return res.status(400).json({ success: false, message: 'Tipo de proxy inválido' });
    }

    const qty = Math.max(proxyType.minQuantity || 1, quantity);
    const pricing = proxyseller.getPricing(type, period, quantity);

    const calcResult = await proxyseller.calculateOrder({
      type,
      countryId: proxyType.countryId,
      periodId: period,
      quantity: qty,
      protocol,
      targetSectionId: proxyType.targetSectionId,
      targetId: proxyType.targetId
    });

    if (calcResult.data.balance < calcResult.data.total) {
      return res.status(400).json({ 
        success: false, 
        message: 'Saldo insuficiente no ProxySeller. Faça uma recarga.' 
      });
    }

    const orderResult = await proxyseller.makeOrder({
      type,
      countryId: proxyType.countryId,
      periodId: period,
      quantity: qty,
      protocol,
      targetSectionId: proxyType.targetSectionId,
      targetId: proxyType.targetId
    });

    const periodDays = proxyseller.getPeriodDays(period);
    const expiraEm = new Date();
    expiraEm.setDate(expiraEm.getDate() + periodDays);

    const [order] = await sql`
      INSERT INTO proxy_orders (
        user_id, proxyseller_order_id, proxyseller_order_number,
        proxy_type, country, country_id, quantity, period, period_days,
        cost_usd, cost_brl, price_sold_brl, profit_margin,
        status, payment_status, expira_em
      ) VALUES (
        ${req.user.id}, 
        ${orderResult.data.orderId}, 
        ${orderResult.data.listBaseOrderNumbers?.[0] || orderResult.data.orderId},
        ${type}, 
        'Brazil', 
        ${proxyType.countryId}, 
        ${qty}, 
        ${period}, 
        ${periodDays},
        ${calcResult.data.total}, 
        ${pricing.costBRL}, 
        ${pricing.totalBRL}, 
        ${pricing.totalBRL - pricing.costBRL},
        'active', 
        'paid', 
        ${expiraEm}
      )
      RETURNING *
    `;

    res.json({
      success: true,
      order,
      message: `${qty} proxy(s) ${proxyType.name} comprado(s) com sucesso!`
    });
  } catch (err) {
    console.error('Buy proxy error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/my-orders', authenticate, async (req, res) => {
  try {
    const orders = await sql`
      SELECT * FROM proxy_orders 
      WHERE user_id = ${req.user.id}
      ORDER BY created_at DESC
    `;

    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/my-proxies', authenticate, async (req, res) => {
  try {
    const proxies = await sql`
      SELECT pp.*, po.expira_em, po.proxy_type
      FROM proxyseller_proxies pp
      JOIN proxy_orders po ON pp.proxy_order_id = po.id
      WHERE pp.user_id = ${req.user.id}
      ORDER BY pp.created_at DESC
    `;

    res.json({ success: true, proxies });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/block/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason = 'Inadimplente' } = req.body;

    const [proxy] = await sql`
      SELECT * FROM proxyseller_proxies WHERE id = ${id} AND user_id = ${req.user.id}
    `;

    if (!proxy) {
      return res.status(404).json({ success: false, message: 'Proxy não encontrado' });
    }

    if (proxy.proxyseller_auth_id) {
      await proxyseller.changeAuth(proxy.proxyseller_auth_id, false);
    }

    await sql`
      UPDATE proxyseller_proxies 
      SET is_blocked = true, blocked_at = NOW(), blocked_reason = ${reason}
      WHERE id = ${id}
    `;

    res.json({ success: true, message: 'Proxy bloqueado' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/unblock/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const [proxy] = await sql`
      SELECT * FROM proxyseller_proxies WHERE id = ${id} AND user_id = ${req.user.id}
    `;

    if (!proxy) {
      return res.status(404).json({ success: false, message: 'Proxy não encontrado' });
    }

    if (proxy.proxyseller_auth_id) {
      await proxyseller.changeAuth(proxy.proxyseller_auth_id, true);
    }

    await sql`
      UPDATE proxyseller_proxies 
      SET is_blocked = false, blocked_at = NULL, blocked_reason = NULL
      WHERE id = ${id}
    `;

    res.json({ success: true, message: 'Proxy desbloqueado' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/renew/:orderId', authenticate, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { period = '1m' } = req.body;

    const [order] = await sql`
      SELECT * FROM proxy_orders WHERE id = ${orderId} AND user_id = ${req.user.id}
    `;

    if (!order) {
      return res.status(404).json({ success: false, message: 'Pedido não encontrado' });
    }

    const proxyType = PROXY_TYPES[order.proxy_type];
    const periodDays = proxyseller.getPeriodDays(period);

    const extendResult = await proxyseller.extendProxy(order.proxyseller_order_number, period);

    const newExpiry = new Date(order.expira_em);
    newExpiry.setDate(newExpiry.getDate() + periodDays);

    await sql`
      UPDATE proxy_orders 
      SET period = ${period}, period_days = ${periodDays}, expira_em = ${newExpiry}
      WHERE id = ${orderId}
    `;

    res.json({ 
      success: true, 
      message: `Proxy renovado por mais ${periodDays} dias!`,
      newExpiry 
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/admin/orders', isAdmin, async (req, res) => {
  try {
    const { status, type } = req.query;
    
    let query = sql`
      SELECT po.*, u.email, u.name, u.whatsapp
      FROM proxy_orders po
      JOIN users u ON po.user_id = u.id
    `;

    if (status) {
      query = sql`
        SELECT po.*, u.email, u.name, u.whatsapp
        FROM proxy_orders po
        JOIN users u ON po.user_id = u.id
        WHERE po.payment_status = ${status}
        ORDER BY po.created_at DESC
        LIMIT 100
      `;
    } else if (type) {
      query = sql`
        SELECT po.*, u.email, u.name, u.whatsapp
        FROM proxy_orders po
        JOIN users u ON po.user_id = u.id
        WHERE po.proxy_type = ${type}
        ORDER BY po.created_at DESC
        LIMIT 100
      `;
    } else {
      query = sql`
        SELECT po.*, u.email, u.name, u.whatsapp
        FROM proxy_orders po
        JOIN users u ON po.user_id = u.id
        ORDER BY po.created_at DESC
        LIMIT 100
      `;
    }

    const orders = await query;
    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/admin/proxies', isAdmin, async (req, res) => {
  try {
    const proxies = await sql`
      SELECT pp.*, u.email, u.name, u.whatsapp, po.proxyseller_order_number, po.expira_em
      FROM proxyseller_proxies pp
      JOIN users u ON pp.user_id = u.id
      JOIN proxy_orders po ON pp.proxy_order_id = po.id
      ORDER BY pp.created_at DESC
      LIMIT 100
    `;

    res.json({ success: true, proxies });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/admin/balance', isAdmin, async (req, res) => {
  try {
    const balance = await proxyseller.getBalance();
    res.json({ success: true, balance });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/admin/refresh-proxies/:orderNumber', isAdmin, async (req, res) => {
  try {
    const { orderNumber } = req.params;
    const { type = 'ipv6' } = req.body;

    const proxyList = await proxyseller.getProxyList(type, { orderId: orderNumber });
    
    const proxyData = proxyList.data?.[type] || proxyList.data?.items || [];
    
    if (proxyData.length > 0) {
      for (const p of proxyData) {
        const existing = await sql`
          SELECT id FROM proxyseller_proxies WHERE proxyseller_proxy_id = ${p.id}
        `;

        if (existing.length === 0) {
          const order = await sql`
            SELECT id FROM proxy_orders WHERE proxyseller_order_number = ${p.order_number} LIMIT 1
          `;

          if (order.length > 0) {
            let expiresAt = null;
            if (p.date_end) {
              const parts = p.date_end.split('.');
              expiresAt = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
            }

            await sql`
              INSERT INTO proxyseller_proxies (
                proxy_order_id, proxyseller_proxy_id, ip, port, 
                protocol, username, password, expires_at
              ) VALUES (
                ${order[0].id}, ${p.id}, ${p.ip_only || p.ip}, ${p.port_http || p.port},
                ${p.protocol || 'HTTP'}, ${p.login || ''}, ${p.password || ''}, 
                ${expiresAt}
              )
            `;
          }
        }
      }
    }

    res.json({ success: true, message: 'Proxies atualizados', count: proxyData.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/admin/block-user/:userId', isAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason = 'Bloqueio administrativo' } = req.body;

    await sql`
      UPDATE proxyseller_proxies 
      SET is_blocked = true, blocked_at = NOW(), blocked_reason = ${reason}
      WHERE user_id = ${userId} AND is_blocked = false
    `;

    res.json({ success: true, message: 'Todos os proxies do usuário foram bloqueados' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/admin/unblock-user/:userId', isAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    await sql`
      UPDATE proxyseller_proxies 
      SET is_blocked = false, blocked_at = NULL, blocked_reason = NULL
      WHERE user_id = ${userId} AND is_blocked = true
    `;

    res.json({ success: true, message: 'Todos os proxies do usuário foram desbloqueados' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
