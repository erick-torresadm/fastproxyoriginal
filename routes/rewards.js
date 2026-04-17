const express = require('express');
const router = express.Router();
const { sql } = require('../lib/database');
const { authenticate } = require('./subscription');

// Points: 1 point = R$ 0.10 (10 cents)
const POINTS_VALUE = 0.10;
const MIN_POINTS_REDEEM = 100; // 100 points = R$ 10,00

router.get('/balance', authenticate, async (req, res) => {
  try {
    const [reward] = await sql`
      SELECT * FROM reward_points WHERE user_id = ${req.user.id}
    `;

    if (!reward) {
      await sql`
        INSERT INTO reward_points (user_id, total_points, available_points, lifetime_points)
        VALUES (${req.user.id}, 0, 0, 0)
      `;
      return res.json({
        success: true,
        points: {
          total: 0,
          available: 0,
          lifetime: 0,
          valuePerPoint: POINTS_VALUE,
          minRedeem: MIN_POINTS_REDEEM
        }
      });
    }

    res.json({
      success: true,
      points: {
        total: reward.total_points,
        available: reward.available_points,
        lifetime: reward.lifetime_points,
        valuePerPoint: POINTS_VALUE,
        minRedeem: MIN_POINTS_REDEEM,
        valueAvailable: reward.available_points * POINTS_VALUE
      }
    });
  } catch (err) {
    console.error('Get balance error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/history', authenticate, async (req, res) => {
  try {
    const transactions = await sql`
      SELECT rt.*, po.id as order_id, po.proxy_type, po.price_sold_brl
      FROM reward_transactions rt
      LEFT JOIN proxy_orders po ON rt.order_id = po.id
      WHERE rt.user_id = ${req.user.id}
      ORDER BY rt.created_at DESC
      LIMIT 50
    `;

    res.json({
      success: true,
      transactions: transactions.map(t => ({
        id: t.id,
        type: t.type,
        points: Math.abs(t.points),
        description: t.description,
        createdAt: t.created_at,
        orderId: t.order_id,
        proxyType: t.proxy_type,
        orderValue: t.price_sold_brl
      }))
    });
  } catch (err) {
    console.error('Get history error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/redeem', authenticate, async (req, res) => {
  try {
    const { points } = req.body;

    if (!points || points < MIN_POINTS_REDEEM) {
      return res.status(400).json({ 
        success: false, 
        message: `Mínimo de ${MIN_POINTS_REDEEM} pontos para resgate (R$ ${(MIN_POINTS_REDEEM * POINTS_VALUE).toFixed(2)})` 
      });
    }

    const [reward] = await sql`
      SELECT * FROM reward_points WHERE user_id = ${req.user.id}
    `;

    if (!reward || reward.available_points < points) {
      return res.status(400).json({ 
        success: false, 
        message: 'Pontos insuficientes' 
      });
    }

    // Convert points to discount (1 point = R$ 0.10)
    const discountAmount = points * POINTS_VALUE;

    // Create coupon for the user
    const couponCode = 'PONTOS' + Math.random().toString(36).substring(2, 8).toUpperCase();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const [coupon] = await sql`
      INSERT INTO coupons (
        code, discount_amount, min_order_value, max_uses, is_active, created_by
      ) VALUES (
        ${couponCode}, ${discountAmount}, ${discountAmount}, 1, true, ${req.user.id}
      )
      RETURNING *
    `;

    // Update points
    await sql`
      UPDATE reward_points SET
        available_points = available_points - ${points},
        updated_at = NOW()
      WHERE user_id = ${req.user.id}
    `;

    // Record transaction
    await sql`
      INSERT INTO reward_transactions (
        user_id, type, points, description, coupon_id
      ) VALUES (
        ${req.user.id}, 'redeem', ${-points},
        ${`Cupom gerado: ${couponCode} (-R$ ${discountAmount.toFixed(2)})`},
        ${coupon.id}
      )
    `;

    res.json({
      success: true,
      message: `Cupom gerado com sucesso!`,
      coupon: {
        code: couponCode,
        discount: discountAmount,
        pointsUsed: points,
        expiresAt: expiresAt
      }
    });
  } catch (err) {
    console.error('Redeem error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

async function awardPointsForOrder(userId, orderId, orderValue) {
  try {
    // 1 point per R$ spent, each point = R$ 0.10
    // So if someone spends R$ 100, they get 100 points = R$ 10,00 credit
    const points = Math.floor(orderValue);

    if (points <= 0) return 0;

    // Get or create reward record
    let [reward] = await sql`
      SELECT * FROM reward_points WHERE user_id = ${userId}
    `;

    if (!reward) {
      await sql`
        INSERT INTO reward_points (user_id, total_points, available_points, lifetime_points)
        VALUES (${userId}, ${points}, ${points}, ${points})
      `;
    } else {
      await sql`
        UPDATE reward_points SET
          total_points = total_points + ${points},
          available_points = available_points + ${points},
          lifetime_points = lifetime_points + ${points},
          updated_at = NOW()
        WHERE user_id = ${userId}
      `;
    }

    // Record transaction
    await sql`
      INSERT INTO reward_transactions (
        user_id, order_id, type, points, description
      ) VALUES (
        ${userId}, ${orderId}, 'earn', ${points},
        ${`Pontos ganhos na compra - R$ ${orderValue.toFixed(2)} → ${points} pontos`}
      )
    `;

    console.log(`✅ Awarded ${points} points to user ${userId} (R$ ${(points * POINTS_VALUE).toFixed(2)} em crédito)`);
    return points;
  } catch (err) {
    console.error('Award points error:', err);
    return 0;
  }
}

// Get user transactions (purchase history)
router.get('/transactions', authenticate, async (req, res) => {
  try {
    const transactions = await sql`
      SELECT * FROM user_transactions 
      WHERE user_id = ${req.user.id}
      ORDER BY created_at DESC
      LIMIT 50
    `;

    res.json({
      success: true,
      transactions: transactions.map(t => ({
        id: t.id,
        type: t.type,
        amount: parseFloat(t.amount),
        description: t.description,
        proxyCount: t.proxy_count,
        status: t.status,
        createdAt: t.created_at
      }))
    });
  } catch (err) {
    console.error('Get transactions error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get user messages/notifications
router.get('/messages', authenticate, async (req, res) => {
  try {
    const messages = await sql`
      SELECT * FROM user_messages 
      WHERE user_id = ${req.user.id}
      ORDER BY created_at DESC
      LIMIT 20
    `;

    res.json({
      success: true,
      messages: messages.map(m => ({
        id: m.id,
        type: m.type,
        title: m.title,
        message: m.message,
        isRead: m.is_read,
        createdAt: m.created_at
      }))
    });
  } catch (err) {
    console.error('Get messages error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Mark message as read
router.put('/messages/:id/read', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    await sql`
      UPDATE user_messages 
      SET is_read = true 
      WHERE id = ${id} AND user_id = ${req.user.id}
    `;

    res.json({ success: true });
  } catch (err) {
    console.error('Mark read error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Create user transaction (called after payment)
async function createTransaction(userId, data) {
  try {
    await sql`
      INSERT INTO user_transactions (
        user_id, type, amount, description, proxy_count, 
        proxy_details, payment_method, stripe_session_id, status
      ) VALUES (
        ${userId}, ${data.type || 'purchase'}, ${data.amount || 0}, 
        ${data.description || ''}, ${data.proxyCount || 0},
        ${JSON.stringify(data.proxyDetails || [])}, 
        ${data.paymentMethod || 'stripe'}, ${data.stripeSessionId}, 'completed'
      )
    `;
    console.log('✅ Transaction created for user', userId);
  } catch (err) {
    console.error('Create transaction error:', err);
  }
}

// Create user message/notification
async function createMessage(userId, data) {
  try {
    await sql`
      INSERT INTO user_messages (
        user_id, type, title, message
      ) VALUES (
        ${userId}, ${data.type || 'promo'}, ${data.title || ''}, ${data.message || ''}
      )
    `;
    console.log('✅ Message created for user', userId);
  } catch (err) {
    console.error('Create message error:', err);
  }
}

module.exports = router;
module.exports.awardPointsForOrder = awardPointsForOrder;
module.exports.createTransaction = createTransaction;
module.exports.createMessage = createMessage;
