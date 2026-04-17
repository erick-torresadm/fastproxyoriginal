const express = require('express');
const router = express.Router();
const { sql } = require('../lib/database');

// Inline middleware — avoids circular require with subscription.js
const JWT_SECRET = process.env.JWT_SECRET || 'fastproxy_secret_key_2024';

function authenticate(req, res, next) {
  try {
    const jwt = require('jsonwebtoken');
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ success:false, message:'Token não fornecido' });
    req.user = jwt.verify(auth.split(' ')[1], JWT_SECRET);
    next();
  } catch(e) { return res.status(401).json({ success:false, message:'Token inválido' }); }
}

function isAdmin(req, res, next) {
  try {
    const jwt = require('jsonwebtoken');
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ success:false, message:'Token não fornecido' });
    const d = jwt.verify(auth.split(' ')[1], JWT_SECRET);
    if (d.role !== 'admin') return res.status(403).json({ success:false, message:'Acesso negado' });
    req.user = d;
    next();
  } catch(e) { return res.status(401).json({ success:false, message:'Token inválido' }); }
}

router.post('/validate', authenticate, async (req, res) => {
  try {
    const { code, orderValue } = req.body;

    const [coupon] = await sql`
      SELECT * FROM coupons 
      WHERE UPPER(code) = UPPER(${code}) AND is_active = true
    `;

    if (!coupon) {
      return res.json({ success: false, message: 'Cupom inválido' });
    }

    if (coupon.valid_until && new Date(coupon.valid_until) < new Date()) {
      return res.json({ success: false, message: 'Cupom expirado' });
    }

    if (coupon.valid_from && new Date(coupon.valid_from) > new Date()) {
      return res.json({ success: false, message: 'Cupom ainda não disponível' });
    }

    if (coupon.max_uses && coupon.used_count >= coupon.max_uses) {
      return res.json({ success: false, message: 'Cupom esgotado' });
    }

    // Check if already used by this user (max_uses_per_user = 1 by default)
    if (coupon.max_uses_per_user) {
      const userUses = await sql`
        SELECT COUNT(*) as cnt FROM coupon_usage
        WHERE coupon_id = ${coupon.id} AND user_id = ${req.user.id}
      `;
      if (userUses[0].cnt >= coupon.max_uses_per_user) {
        return res.json({ success: false, message: 'Limite de uso deste cupom atingido' });
      }
    }

    if (orderValue && coupon.min_order_value && orderValue < coupon.min_order_value) {
      return res.json({ 
        success: false, 
        message: `Valor mínimo do pedido: R$ ${coupon.min_order_value.toFixed(2)}` 
      });
    }

    let discount = 0;
    if (coupon.discount_percent) {
      discount = orderValue * (coupon.discount_percent / 100);
    } else if (coupon.discount_amount) {
      discount = Math.min(coupon.discount_amount, orderValue);
    }

    res.json({
      success: true,
      coupon: {
        code: coupon.code,
        discount_percent: coupon.discount_percent,
        discount_amount: coupon.discount_amount,
        discount
      },
      message: `Desconto de R$ ${discount.toFixed(2)} aplicado!`
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/apply', authenticate, async (req, res) => {
  try {
    const { code, orderId } = req.body;

    const [coupon] = await sql`
      SELECT * FROM coupons 
      WHERE UPPER(code) = UPPER(${code}) AND is_active = true
    `;

    if (!coupon) {
      return res.status(400).json({ success: false, message: 'Cupom inválido' });
    }

    const [order] = await sql`
      SELECT * FROM proxy_orders WHERE id = ${orderId} AND user_id = ${req.user.id}
    `;

    if (!order) {
      return res.status(404).json({ success: false, message: 'Pedido não encontrado' });
    }

    let discount = 0;
    if (coupon.discount_percent) {
      discount = order.price_sold_brl * (coupon.discount_percent / 100);
    } else if (coupon.discount_amount) {
      discount = Math.min(coupon.discount_amount, order.price_sold_brl);
    }

    const newPrice = Math.max(0, order.price_sold_brl - discount);

    await sql`
      UPDATE proxy_orders 
      SET price_sold_brl = ${newPrice}
      WHERE id = ${orderId}
    `;

    await sql`
      UPDATE coupons 
      SET used_count = used_count + 1
      WHERE id = ${coupon.id}
    `;

    await sql`
      INSERT INTO coupon_usage (coupon_id, user_id, order_id, discount_applied)
      VALUES (${coupon.id}, ${req.user.id}, ${orderId}, ${discount})
    `;

    res.json({
      success: true,
      message: `Cupom aplicado! Desconto de R$ ${discount.toFixed(2)}`,
      newPrice
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/admin/list', isAdmin, async (req, res) => {
  try {
    const coupons = await sql`
      SELECT c.*, u.email as created_by_email
      FROM coupons c
      LEFT JOIN users u ON c.created_by = u.id
      ORDER BY c.created_at DESC
    `;

    res.json({ success: true, coupons });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/admin/create', isAdmin, async (req, res) => {
  try {
    const {
      code,
      discount_percent,
      discount_amount,
      min_order_value = 0,
      max_uses,
      max_uses_per_user = 1,
      valid_days,
      proxy_types
    } = req.body;

    if (!code) {
      return res.status(400).json({ success: false, message: 'Código é obrigatório' });
    }

    if (!discount_percent && !discount_amount) {
      return res.status(400).json({ success: false, message: 'Informe desconto (%) ou valor (R$)' });
    }

    let valid_until = null;
    if (valid_days) {
      valid_until = new Date();
      valid_until.setDate(valid_until.getDate() + valid_days);
    }

    const [coupon] = await sql`
      INSERT INTO coupons (
        code, discount_percent, discount_amount, min_order_value,
        max_uses, max_uses_per_user, valid_until, proxy_types, created_by
      ) VALUES (
        ${code.toUpperCase()},
        ${discount_percent || null},
        ${discount_amount || null},
        ${min_order_value},
        ${max_uses || null},
        ${max_uses_per_user || null},
        ${valid_until},
        ${proxy_types || null},
        ${req.user.id}
      )
      RETURNING *
    `;

    res.json({ 
      success: true, 
      coupon,
      message: 'Cupom criado com sucesso!' 
    });
  } catch (err) {
    if (err.message.includes('duplicate')) {
      return res.status(400).json({ success: false, message: 'Código já existe' });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/admin/:id', isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active, max_uses } = req.body;

    const [coupon] = await sql`
      UPDATE coupons 
      SET is_active = COALESCE(${is_active}, is_active),
          max_uses = COALESCE(${max_uses}, max_uses)
      WHERE id = ${id}
      RETURNING *
    `;

    if (!coupon) {
      return res.status(404).json({ success: false, message: 'Cupom não encontrado' });
    }

    res.json({ success: true, coupon, message: 'Cupom atualizado!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/admin/:id', isAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    await sql`DELETE FROM coupons WHERE id = ${id}`;

    res.json({ success: true, message: 'Cupom deletado!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/admin/usage', isAdmin, async (req, res) => {
  try {
    const usage = await sql`
      SELECT cu.*, c.code, u.email, u.name, po.id as order_num
      FROM coupon_usage cu
      JOIN coupons c ON cu.coupon_id = c.id
      JOIN users u ON cu.user_id = u.id
      LEFT JOIN proxy_orders po ON cu.order_id = po.id
      ORDER BY cu.used_at DESC
      LIMIT 100
    `;

    res.json({ success: true, usage });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Quick coupon creator for simple offers ──────────────────────────────────
router.post('/admin/quick-create', isAdmin, async (req, res) => {
  try {
    const {
      discount_amount,
      discount_percent,
      proxy_type,
      max_uses,
      max_uses_per_user = 1,
      valid_days
    } = req.body;

    if (!discount_amount && !discount_percent) {
      return res.status(400).json({ success: false, message: 'Informe desconto (%) ou valor (R$)' });
    }

    const suffix = (proxy_type || 'ipv6').toUpperCase().substring(0,4);
    const code = `FAST${suffix}${Date.now().toString(36).toUpperCase()}`;

    let valid_until = null;
    if (valid_days) {
      valid_until = new Date();
      valid_until.setDate(valid_until.getDate() + valid_days);
    }

    const [coupon] = await sql`
      INSERT INTO coupons (
        code, discount_percent, discount_amount, min_order_value,
        max_uses, max_uses_per_user, valid_until, proxy_types, is_active, created_by
      ) VALUES (
        ${code},
        ${discount_percent || null},
        ${discount_amount || null},
        ${0},
        ${max_uses || null},
        ${max_uses_per_user || null},
        ${valid_until},
        ${proxy_type || null},
        true,
        ${req.user.id}
      )
      RETURNING *
    `;

    res.json({ success: true, coupon, message: `Cupom ${code} criado!` });
  } catch (err) {
    if (err.message && (err.message.includes('duplicate') || err.message.includes('unique'))) {
      return res.status(400).json({ success: false, message: 'Código já existe' });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});
