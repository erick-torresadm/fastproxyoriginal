const express = require('express');
const router = express.Router();
const { sql } = require('../lib/database');
const proxyseller = require('../lib/proxyseller');
const { authenticate, isAdmin } = require('./subscription');

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

router.post('/create-checkout-session', authenticate, async (req, res) => {
  try {
    const { type = 'ipv6', period = '1m', quantity = 1, couponCode } = req.body;

    const proxyType = proxyseller.PROXY_TYPES[type];
    if (!proxyType) {
      return res.status(400).json({ success: false, message: 'Tipo de proxy inválido' });
    }

    const qty = Math.max(proxyType.minQuantity || 1, quantity);
    const pricing = proxyseller.getPricing(type, period, quantity);
    
    let discount = 0;
    if (couponCode) {
      const [coupon] = await sql`
        SELECT * FROM coupons 
        WHERE UPPER(code) = UPPER(${couponCode}) AND is_active = true
      `;
      
      if (coupon && (!coupon.valid_until || new Date(coupon.valid_until) > new Date())) {
        if (coupon.discount_percent) {
          discount = pricing.totalBRL * (coupon.discount_percent / 100);
        } else if (coupon.discount_amount) {
          discount = Math.min(coupon.discount_amount, pricing.totalBRL);
        }
      }
    }

    const finalPrice = Math.max(0, pricing.totalBRL - discount);
    const periodDays = proxyseller.getPeriodDays(period);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + periodDays);

    const [order] = await sql`
      INSERT INTO proxy_orders (
        user_id, proxy_type, country, country_id, quantity, period, period_days,
        cost_usd, cost_brl, price_sold_brl, profit_margin,
        status, payment_status, expira_em
      ) VALUES (
        ${req.user.id}, ${type}, 'Brazil', ${proxyType.countryId}, ${qty},
        ${period}, ${periodDays}, ${pricing.costUSD}, ${pricing.costBRL},
        ${finalPrice}, ${finalPrice - pricing.costBRL},
        'pending', 'pending', ${expiresAt}
      )
      RETURNING *
    `;

    if (couponCode && discount > 0) {
      const [coupon] = await sql`
        SELECT * FROM coupons WHERE UPPER(code) = UPPER(${couponCode})
      `;
      if (coupon) {
        await sql`
          UPDATE coupons SET used_count = used_count + 1 WHERE id = ${coupon.id}
        `;
        await sql`
          INSERT INTO coupon_usage (coupon_id, user_id, order_id, discount_applied)
          VALUES (${coupon.id}, ${req.user.id}, ${order.id}, ${discount})
        `;
      }
    }

    const productName = `${qty}x Proxy ${proxyType.name} Brasil - ${period} (${periodDays} dias)`;
    const productDescription = `
${proxyType.description}
País: Brasil 🇧🇷
Período: ${period} (${periodDays} dias)
Entrega imediata após confirmação de pagamento
    `.trim();

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'brl',
            product_data: {
              name: productName,
              description: productDescription,
            },
            unit_amount: Math.round(finalPrice * 100),
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${process.env.APP_URL}/portal.html?payment=success&order=${order.id}`,
      cancel_url: `${process.env.APP_URL}/planos.html?payment=cancelled`,
      metadata: {
        orderId: order.id.toString(),
        userId: req.user.id.toString(),
        proxyType: type,
        quantity: qty.toString()
      },
      customer_email: req.user.email
    });

    await sql`
      UPDATE proxy_orders 
      SET stripe_session_id = ${session.id}
      WHERE id = ${order.id}
    `;

    res.json({
      success: true,
      sessionId: session.id,
      url: session.url
    });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET_TEST
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const orderId = session.metadata?.orderId;

    if (orderId) {
      try {
        const [order] = await sql`
          SELECT * FROM proxy_orders WHERE id = ${orderId}
        `;

        if (order && order.payment_status !== 'paid') {
          const proxyType = proxyseller.PROXY_TYPES[order.proxy_type];
          
          const calcResult = await proxyseller.calculateOrder({
            type: order.proxy_type,
            countryId: order.country_id,
            periodId: order.period,
            quantity: order.quantity,
            protocol: 'HTTPS',
            targetSectionId: proxyType?.targetSectionId,
            targetId: proxyType?.targetId
          });

          if (calcResult.data.balance >= calcResult.data.total) {
            const orderResult = await proxyseller.makeOrder({
              type: order.proxy_type,
              countryId: order.country_id,
              periodId: order.period,
              quantity: order.quantity,
              protocol: 'HTTPS',
              targetSectionId: proxyType?.targetSectionId,
              targetId: proxyType?.targetId
            });

            await sql`
              UPDATE proxy_orders SET
                status = 'active',
                payment_status = 'paid',
                proxyseller_order_id = ${orderResult.data.orderId},
                proxyseller_order_number = ${orderResult.data.listBaseOrderNumbers?.[0] || orderResult.data.orderId}
              WHERE id = ${orderId}
            `;

            setTimeout(async () => {
              try {
                const proxyList = await proxyseller.getProxyList(order.proxy_type, { orderId: orderResult.data.orderId });
                const proxyData = proxyList.data?.[order.proxy_type] || proxyList.data?.items || [];
                
                if (proxyData.length > 0) {
                  for (const p of proxyData) {
                    let expiresAt = null;
                    if (p.date_end) {
                      const parts = p.date_end.split('.');
                      expiresAt = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
                    }

                    await sql`
                      INSERT INTO proxyseller_proxies (
                        proxy_order_id, user_id, proxyseller_proxy_id, ip, port,
                        protocol, username, password, expires_at, is_assigned
                      ) VALUES (
                        ${orderId}, ${order.user_id}, ${p.id}, ${p.ip_only || p.ip},
                        ${p.port_http || p.port}, ${p.protocol || 'HTTP'},
                        ${p.login || ''}, ${p.password || ''}, ${expiresAt}, false
                      )
                    `;

                    // Attribution log - Marco Civil Compliance
                    await sql`
                      INSERT INTO attribution_logs (
                        user_id, proxy_order_id, proxyseller_proxy_id,
                        user_name, user_email, user_document, user_whatsapp,
                        proxy_ip, proxy_port, proxy_username, proxy_password,
                        client_ip, action, action_reason, expires_at,
                        purchased_at, delivered_at
                      ) VALUES (
                        ${order.user_id}, ${orderId}, ${p.id},
                        ${order.user_name || ''}, ${order.user_email || ''}, '', ${order.user_whatsapp || ''},
                        ${p.ip_only || p.ip}, ${p.port_http || p.port}, ${p.login || ''}, ${p.password || ''},
                        '', 'DELIVERED', 'Proxy entregue ao cliente', ${expiresAt},
                        NOW(), NOW()
                      )
                    `;
                  }
                }
              } catch (err) {
                console.error('Error saving proxies:', err);
              }
            }, 5000);

          } else {
            console.error('Insufficient balance for proxy purchase');
          }
        }
      } catch (err) {
        console.error('Error processing payment:', err);
      }
    }
  }

  res.json({ received: true });
});

router.post('/confirm-payment', authenticate, async (req, res) => {
  try {
    const { sessionId } = req.body;

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status === 'paid') {
      const orderId = session.metadata?.orderId;
      
      if (orderId) {
        await sql`
          UPDATE proxy_orders 
          SET payment_status = 'paid', status = 'active'
          WHERE id = ${orderId} AND user_id = ${req.user.id}
        `;
      }

      res.json({ success: true, message: 'Pagamento confirmado!' });
    } else {
      res.json({ success: false, message: 'Pagamento pendente' });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
