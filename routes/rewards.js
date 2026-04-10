const express = require('express');
const router = express.Router();
const { sql } = require('../lib/database');
const { authenticate } = require('./subscription');

// Points per R$ spent
const POINTS_PER_REAL = 1;

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
          lifetime: 0
        }
      });
    }

    res.json({
      success: true,
      points: {
        total: reward.total_points,
        available: reward.available_points,
        lifetime: reward.lifetime_points
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
        points: t.points,
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

    if (!points || points < 100) {
      return res.status(400).json({ 
        success: false, 
        message: 'Mínimo de 100 pontos para resgate' 
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

    // Convert points to discount (100 points = R$ 1,00)
    const discountAmount = points / 100;

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
    const points = Math.floor(orderValue * POINTS_PER_REAL);

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
        ${`Pontos ganhos na compra - R$ ${orderValue.toFixed(2)}`}
      )
    `;

    console.log(`✅ Awarded ${points} points to user ${userId}`);
    return points;
  } catch (err) {
    console.error('Award points error:', err);
    return 0;
  }
}

module.exports = router;
module.exports.awardPointsForOrder = awardPointsForOrder;
