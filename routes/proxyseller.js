const express = require('express');
const router = express.Router();
const { sql } = require('../lib/database');
const proxyseller = require('../lib/proxyseller');
const { authenticate, isAdmin } = require('./subscription');

router.post('/calculate', authenticate, async (req, res) => {
  try {
    const { type = 'ipv6', period = '1m', quantity = 1 } = req.body;

    const qty = type === 'ipv6' ? Math.max(10, quantity) : quantity;

    const result = await proxyseller.calculateOrder({
      type,
      countryId: 20554,
      periodId: period,
      quantity: qty,
      protocol: 'HTTPS',
      targetSectionId: 8,
      targetId: 1768
    });

    const priceBRL = result.data.total * 5.5;
    const pricePerProxy = priceBRL / qty;

    res.json({
      success: true,
      pricing: {
        type,
        quantity: qty,
        costUSD: result.data.total,
        costBRL: priceBRL,
        pricePerProxy: pricePerProxy,
        currency: 'BRL'
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/buy', authenticate, async (req, res) => {
  try {
    const { period = '1m', quantity = 1 } = req.body;
    const type = 'ipv6';
    const qty = Math.max(10, quantity);

    const calcResult = await proxyseller.calculateOrder({
      type,
      countryId: 20554,
      periodId: period,
      quantity: qty,
      protocol: 'HTTPS',
      targetSectionId: 8,
      targetId: 1768
    });

    if (calcResult.data.balance < calcResult.data.total) {
      return res.status(400).json({ 
        success: false, 
        message: 'Saldo insuficiente no ProxySeller' 
      });
    }

    const orderResult = await proxyseller.buyIPv6(20554, period, qty);

    const periodDays = proxyseller.getPeriodDays(period);
    const priceBRL = calcResult.data.total * 5.5;
    const expiraEm = new Date();
    expiraEm.setDate(expiraEm.getDate() + periodDays);

    const [order] = await sql`
      INSERT INTO proxy_orders (
        user_id, proxyseller_order_id, proxyseller_order_number,
        proxy_type, country, country_id, quantity, period, period_days,
        cost_usd, cost_brl, price_sold_brl, profit_margin,
        status, payment_status, expira_em
      ) VALUES (
        ${req.user.id}, ${orderResult.data.orderId}, ${orderResult.data.listBaseOrderNumbers[0]},
        ${type}, 'Brazil', 20554, ${qty}, ${period}, ${periodDays},
        ${calcResult.data.total}, ${priceBRL}, ${priceBRL}, ${0},
        'active', 'paid', ${expiraEm}
      )
      RETURNING *
    `;

    res.json({
      success: true,
      order,
      message: 'Pedido criado com sucesso!'
    });
  } catch (err) {
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
      SELECT pp.*, po.expira_em 
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
      SET is_blocked = true, blocked_at = NOW(), blocked_reason = 'Inadimplente'
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

router.get('/admin/orders', isAdmin, async (req, res) => {
  try {
    const orders = await sql`
      SELECT po.*, u.email, u.name, u.whatsapp
      FROM proxy_orders po
      JOIN users u ON po.user_id = u.id
      ORDER BY po.created_at DESC
      LIMIT 100
    `;

    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/admin/proxies', isAdmin, async (req, res) => {
  try {
    const proxies = await sql`
      SELECT pp.*, u.email, u.name, po.proxyseller_order_number
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

    const proxyList = await proxyseller.getProxyList('ipv6', { orderId: orderNumber });
    
    if (proxyList.data?.ipv6?.length > 0) {
      for (const p of proxyList.data.ipv6) {
        const existing = await sql`
          SELECT id FROM proxyseller_proxies WHERE proxyseller_proxy_id = ${p.id}
        `;

        if (existing.length === 0) {
          const order = await sql`
            SELECT id FROM proxy_orders WHERE proxyseller_order_number = ${p.order_number} LIMIT 1
          `;

          if (order.length > 0) {
            await sql`
              INSERT INTO proxyseller_proxies (
                proxy_order_id, proxyseller_proxy_id, ip, port, 
                protocol, username, password, expires_at
              ) VALUES (
                ${order[0].id}, ${p.id}, ${p.ip_only}, ${p.port_http},
                ${p.protocol}, ${p.login}, ${p.password}, 
                ${p.date_end ? new Date(p.date_end.split('.').reverse().join('-')) : null}
              )
            `;
          }
        }
      }
    }

    res.json({ success: true, message: 'Proxies atualizados' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
