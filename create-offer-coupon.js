require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function createCoupon() {
  try {
    const code = 'IPV6R5';
    // Each proxy is R$29.90, we want R$5 → discount_amount = 24.90
    const discount_amount = 24.90;
    const max_uses = 10;
    const max_uses_per_user = 1;
    const proxy_types = 'ipv6';
    const valid_until = new Date();
    valid_until.setDate(valid_until.getDate() + 30);

    const [coupon] = await sql`
      INSERT INTO coupons (
        code, discount_percent, discount_amount, min_order_value,
        max_uses, max_uses_per_user, valid_until, proxy_types, is_active
      ) VALUES (
        ${code},
        NULL,
        ${discount_amount},
        0,
        ${max_uses},
        ${max_uses_per_user},
        ${valid_until},
        ${proxy_types},
        true
      )
      RETURNING *
    `;

    console.log('✅ Coupon created:');
    console.log(`   Code: ${coupon.code}`);
    console.log(`   Discount: R$ ${coupon.discount_amount}`);
    console.log(`   Max uses: ${coupon.max_uses} (total), ${coupon.max_uses_per_user} per user`);
    console.log(`   Proxy type: ${coupon.proxy_types}`);
    console.log(`   Valid until: ${coupon.valid_until}`);
    console.log('');
    console.log('👉 Share this code with customers, it will give R$ 24,90 off per proxy (R$ 5 each)');
  } catch (err) {
    if (err.message && err.message.includes('duplicate')) {
      console.log('⚠️ Coupon IPV6R5 already exists');
    } else {
      console.error('Error:', err.message);
    }
  }
}

createCoupon();
