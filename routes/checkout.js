const express = require('express');
const router = express.Router();
const { sql } = require('../lib/database');
const proxyseller = require('../lib/proxyseller');
const { authenticate, isAdmin } = require('./subscription');

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Pricing configuration - prices per proxy per month (SELL PRICE)
const SELL_PRICES = {
    ipv6: 29.90,
    ipv4: 39.90,
    isp: 49.90,
    mobile: 79.90
};

// Minimum quantity per proxy type
const MIN_QUANTITY = {
    ipv6: 10,
    ipv4: 1,
    isp: 1,
    mobile: 1
};

// Period discounts (maximum 8%)
const PERIOD_DISCOUNTS = {
    '1m': 0,
    '6m': 0.08,
    '12m': 0.08
};

// Period months mapping
const PERIOD_MONTHS = {
    '1m': 1,
    '6m': 6,
    '12m': 12
};

// Country mapping for ProxySeller
const COUNTRY_MAP = {
    'us': { id: 'US', name: 'Estados Unidos' },
    'de': { id: 'DE', name: 'Alemanha' },
    'uk': { id: 'GB', name: 'Reino Unido' },
    'fr': { id: 'FR', name: 'França' },
    'nl': { id: 'NL', name: 'Holanda' },
    'br': { id: 'BR', name: 'Brasil' }
};

// Proxy types that use automatic delivery via ProxySeller API
const AUTO_DELIVERY_TYPES = ['ipv4', 'isp', 'mobile'];

function calculateOrderPrice(type, period, quantity) {
    const basePrice = SELL_PRICES[type] || 29.90;
    const minQty = MIN_QUANTITY[type] || 1;
    const actualQty = Math.max(minQty, quantity);
    const months = PERIOD_MONTHS[period] || 1;
    const discount = PERIOD_DISCOUNTS[period] || 0;
    
    // Price = base price * months * quantity
    const subtotal = basePrice * months * actualQty;
    const discountAmount = subtotal * discount;
    const total = subtotal - discountAmount;
    
    return {
        basePrice,
        months,
        quantity: actualQty,
        discount,
        discountAmount,
        subtotal,
        total,
        period
    };
}

router.post('/create-checkout-session', authenticate, async (req, res) => {
  try {
    const { 
      type = 'ipv6', 
      period = '1m', 
      quantity = 1, 
      couponCode,
      buyerName,
      buyerDocument,
      buyerWhatsapp,
      buyerAddress,
      termsAccepted,
      country,
      countryName
    } = req.body;

    // Validate type
    if (!SELL_PRICES[type]) {
      return res.status(400).json({ success: false, message: 'Tipo de proxy inválido' });
    }

    // Mobile 4G/5G temporarily unavailable
    if (type === 'mobile') {
      return res.status(400).json({ success: false, message: 'Mobile 4G/5G ainda não está disponível. Em breve!' });
    }

    if (!termsAccepted) {
      return res.status(400).json({ success: false, message: 'Você precisa aceitar os termos de uso' });
    }

    const qty = Math.max(MIN_QUANTITY[type] || 1, quantity);
    const pricing = calculateOrderPrice(type, period, qty);
    
    let couponDiscount = 0;
    let appliedCoupon = null;

    if (couponCode) {
      let validateFn;
      try { validateFn = require('./coupons').validateCouponLogic; } catch(e) {}

      if (validateFn) {
        const result = await validateFn({ code: couponCode, orderValue: pricing.total, userId: req.user.id });
        if (result.success) {
          couponDiscount = result.coupon.discount;
          // fetch full coupon for usage tracking
          const [coupon] = await sql`SELECT * FROM coupons WHERE UPPER(code) = UPPER(${couponCode}) LIMIT 1`;
          appliedCoupon = coupon || { code: result.coupon.code };
        }
      } else {
        // fallback
        const [coupon] = await sql`
          SELECT * FROM coupons
          WHERE UPPER(code) = UPPER(${couponCode}) AND is_active = true
        `;
        if (coupon && (!coupon.valid_until || new Date(coupon.valid_until) > new Date())) {
          appliedCoupon = coupon;
          if (coupon.discount_percent) {
            couponDiscount = pricing.total * (parseFloat(coupon.discount_percent) / 100);
          } else if (coupon.discount_amount) {
            couponDiscount = Math.min(parseFloat(coupon.discount_amount), pricing.total);
          }
        }
      }
    }

    const finalPrice = Math.max(0, pricing.total - couponDiscount);
    const periodDays = pricing.months * 30; // Approximate days per month
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + periodDays);

    // Determine country for proxy
    const isInternational = country && country !== 'br';
    const proxyType = proxyseller.PROXY_TYPES[type];
    const countryInfo = COUNTRY_MAP[country] || { id: proxyType?.countryId || 'BR', name: countryName || 'Brasil' };
    const displayCountryName = countryName || (isInternational ? countryInfo.name : 'Brasil');
    const countryId = countryInfo.id;

    // Save terms acceptance
    const termsVersion = '1.0';
    await sql`
      INSERT INTO terms_acceptance (user_id, terms_version, ip_address, accepted_at)
      VALUES (${req.user.id}, ${termsVersion}, ${req.ip || ''}, NOW())
    `;

    const [order] = await sql`
      INSERT INTO proxy_orders (
        user_id, proxy_type, country, country_id, quantity, period, period_days,
        cost_usd, cost_brl, price_sold_brl, profit_margin,
        status, payment_status, expira_em,
        buyer_name, buyer_document, buyer_whatsapp, buyer_address, buyer_email,
        terms_accepted, terms_accepted_at
      ) VALUES (
        ${req.user.id}, ${type}, ${displayCountryName}, ${countryId}, ${qty},
        ${period}, ${periodDays}, 
        ${0}, ${0},
        ${finalPrice}, ${finalPrice},
        'pending', 'pending', ${expiresAt},
        ${buyerName || null}, ${buyerDocument || null}, ${buyerWhatsapp || null}, ${buyerAddress || null}, ${req.user.email},
        true, NOW()
      )
      RETURNING *
    `;

    if (appliedCoupon && couponDiscount > 0) {
      await sql`
        UPDATE coupons SET used_count = used_count + 1 WHERE id = ${appliedCoupon.id}
      `;
      await sql`
        INSERT INTO coupon_usage (coupon_id, user_id, order_id, discount_applied)
        VALUES (${appliedCoupon.id}, ${req.user.id}, ${order.id}, ${couponDiscount})
      `;
    }

    const periodNames = {
      '1m': '1 Mês',
      '6m': '6 Meses',
      '12m': '12 Meses'
    };

    const typeNames = {
      'ipv6': 'IPv6',
      'ipv4': 'IPv4',
      'isp': 'ISP',
      'mobile': 'Mobile'
    };

    const countryFlag = {
      'Estados Unidos': '🇺🇸',
      'Alemanha': '🇩🇪',
      'Reino Unido': '🇬🇧',
      'França': '🇫🇷',
      'Holanda': '🇳🇱',
      'Brasil': '🇧🇷'
    };

    const flag = countryFlag[displayCountryName] || '🌍';
    const deliveryNote = type === 'ipv6' ? ' (Ativação manual em até 24h)' : ' (Entrega automática)';
    const productName = `${qty}x Proxy ${typeNames[type]} ${displayCountryName} - ${periodNames[period] || period}`;
    const productDescription = `
Proxy ${typeNames[type]} - ${displayCountryName} ${flag}
Quantidade: ${qty} proxy(s)
Período: ${periodNames[period] || period} (${pricing.months} meses)
Preço por proxy: R$ ${pricing.basePrice.toFixed(2)}/mês
${pricing.discount > 0 ? `Desconto período (${pricing.discount * 100}%): -R$ ${pricing.discountAmount.toFixed(2)}\n` : ''}${couponDiscount > 0 ? `Cupom aplicado: -R$ ${couponDiscount.toFixed(2)}\n` : ''}Subtotal: R$ ${pricing.subtotal.toFixed(2)}
Total: R$ ${finalPrice.toFixed(2)}${deliveryNote}
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
      success_url: `https://fastproxyoriginal.vercel.app/login.html`,
      cancel_url: `https://fastproxyoriginal.vercel.app/planos.html?payment=cancelled`,
      metadata: {
        orderId: order.id.toString(),
        userId: req.user.id.toString(),
        proxyType: type,
        quantity: qty.toString(),
        period: period,
        months: pricing.months.toString(),
        country: country || 'br',
        countryId: countryId,
        countryName: displayCountryName,
        isInternational: isInternational ? 'true' : 'false',
        autoDelivery: AUTO_DELIVERY_TYPES.includes(type) ? 'true' : 'false',
        buyerName: buyerName || '',
        buyerDocument: buyerDocument || '',
        buyerWhatsapp: buyerWhatsapp || '',
        buyerAddress: buyerAddress || ''
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
          const countryId = session.metadata?.countryId || order.country_id || proxyType?.countryId;
          const isInternational = session.metadata?.isInternational === 'true';
          const autoDelivery = session.metadata?.autoDelivery === 'true';
          
          // Calculate period months from order period
          const periodMonths = order.period === '12m' ? 12 : order.period === '6m' ? 6 : 1;
          
          // Update order status to paid
          await sql`
            UPDATE proxy_orders SET
              status = 'active',
              payment_status = 'paid'
            WHERE id = ${orderId}
          `;

          // Create subscription only AFTER payment confirmed
          const now = new Date();
          const startDate = now.toISOString();
          // Add months properly
          const endDate = new Date(now);
          endDate.setMonth(endDate.getMonth() + periodMonths);
          // Handle month overflow (e.g., Jan 31 + 1 month = Mar 3)
          if (endDate.getMonth() !== (now.getMonth() + periodMonths) % 12) {
            endDate.setDate(0); // Go to last day of previous month
          }
          const endDateStr = endDate.toISOString();

          await sql`
            INSERT INTO subscriptions (
              user_id, proxy_order_id, status, proxy_type, proxy_count,
              period, start_date, end_date, auto_renew, created_at
            ) VALUES (
              ${order.user_id}, ${orderId}, 'active', ${order.proxy_type}, ${order.quantity},
              ${order.period}, ${startDate}, ${endDateStr}, false, NOW()
            )
          `;

          // Update user subscription info (skip if columns don't exist)
          try {
            await sql`
              UPDATE users SET
                subscription_status = 'active',
                subscription_period = ${order.period},
                subscription_proxy_count = ${order.quantity},
                subscription_start_date = ${startDate},
                subscription_end_date = ${endDateStr}
              WHERE id = ${order.user_id}
            `;
          } catch(e) { /* users table may not have subscription_* columns */ }

          // Award reward points for this purchase
          try {
            const rewards = require('./rewards');
            await rewards.awardPointsForOrder(order.user_id, orderId, order.price_sold_brl);
            
            // Create transaction record
            await rewards.createTransaction(order.user_id, {
              type: 'purchase',
              amount: order.price_sold_brl,
              description: `${order.quantity} proxies - Plano ${order.period}`,
              proxyCount: order.quantity,
              proxyDetails: order.proxies || [],
              stripeSessionId: sessionId
            });
            
            // Welcome message - only first time
            const existingMsg = await sql`
              SELECT id FROM user_messages 
              WHERE user_id = ${order.user_id} AND type = 'welcome'
            `;
            if (existingMsg.length === 0) {
              await rewards.createMessage(order.user_id, {
                type: 'welcome',
                title: '🎉 Pagamento Confirmado!',
                message: 'Seus proxies estão prontos! Acesse o portal para ver suas credenciais.'
              });
            }
          } catch (err) {
            console.error('Error awarding points:', err);
          }

          // Only auto-deliver for non-IPv6 types
          if (autoDelivery && proxyType) {
            try {
              const calcResult = await proxyseller.calculateOrder({
                type: order.proxy_type,
                countryId: countryId,
                periodId: order.period,
                quantity: order.quantity,
                protocol: 'HTTPS'
              });

              if (calcResult.data.balance >= calcResult.data.total) {
                const orderResult = await proxyseller.makeOrder({
                  type: order.proxy_type,
                  countryId: countryId,
                  periodId: order.period,
                  quantity: order.quantity,
                  protocol: 'HTTPS'
                });

                await sql`
                  UPDATE proxy_orders SET
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

                        const [savedProxy] = await sql`
                          INSERT INTO proxyseller_proxies (
                            proxy_order_id, user_id, proxyseller_proxy_id, ip, port,
                            protocol, username, password, expires_at, is_assigned
                          ) VALUES (
                            ${orderId}, ${order.user_id}, ${p.id}, ${p.ip_only || p.ip},
                            ${p.port_http || p.port}, ${p.protocol || 'HTTP'},
                            ${p.login || ''}, ${p.password || ''}, ${expiresAt}, true
                          )
                          RETURNING *
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
                            ${order.user_id}, ${orderId}, ${savedProxy.id},
                            ${order.buyer_name || ''}, ${order.buyer_email || ''}, ${order.buyer_document || ''}, ${order.buyer_whatsapp || ''},
                            ${p.ip_only || p.ip}, ${p.port_http || p.port}, ${p.login || ''}, ${p.password || ''},
                            '', 'DELIVERED', 'Proxy entregue ao cliente', ${expiresAt},
                            ${order.created_at}, NOW()
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
            } catch (err) {
              console.error('Error in auto-delivery:', err);
            }
          } else {
            // IPv6 - manual delivery needed
            console.log('IPv6 order - manual delivery for order', orderId);
          }
          
          // Create proxy records in local proxies table
          for (let i = 0; i < order.quantity; i++) {
            const port = 11331 + i; // Sequential ports
            await sql`
              INSERT INTO proxies (
                user_id, subscription_id, proxy_type, ip, port,
                username, password, is_active, created_at
              ) VALUES (
                ${order.user_id}, 
                (SELECT id FROM subscriptions WHERE proxy_order_id = ${orderId} ORDER BY created_at DESC LIMIT 1),
                ${order.proxy_type}, '177.54.146.90', ${port},
                'fastproxy123', 'fast123', true, NOW()
              )
            `;
          }
          
          console.log('Created', order.quantity, 'proxies for user', order.user_id);
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
