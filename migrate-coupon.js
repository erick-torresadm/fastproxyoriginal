require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function run() {
  console.log('Running coupons table migration...\n');

  // 1. Add column
  try {
    await sql`ALTER TABLE coupons ADD COLUMN max_uses_per_user INTEGER DEFAULT 1`;
    console.log('✅ Added max_uses_per_user column');
  } catch (err) {
    console.log('⚠️ max_uses_per_user column may already exist:', err.message);
  }

  // 2. Now create the IPv6 R$5 coupon
  try {
    // Each proxy is R$29.90, we want ~R$5 each → discount_amount = 24.90
    const valid_until = new Date();
    valid_until.setDate(valid_until.getDate() + 30);

    const [coupon] = await sql`
      INSERT INTO coupons (
        code, discount_percent, discount_amount, min_order_value,
        max_uses, max_uses_per_user, valid_until, proxy_types, is_active
      ) VALUES (
        'IPV6R5',
        NULL,
        24.90,
        0,
        10,
        1,
        ${valid_until},
        'ipv6',
        true
      )
      RETURNING *
    `;

    console.log('\n✅ Coupon IPV6R5 created:');
    console.log(`   Discount: R$ 24.90 (makes proxy cost R$ 5.00 instead of R$ 29.90)`);
    console.log(`   Max uses: 10 (1 per person)`);
    console.log(`   Type: ipv6 only`);
    console.log(`   Valid until: ${coupon.valid_until}`);
  } catch (err) {
    console.log('⚠️ Coupon already exists:', err.message);
    const [existing] = await sql`SELECT * FROM coupons WHERE code = 'IPV6R5'`;
    if (existing) {
      console.log(`   Code: ${existing.code}`);
      console.log(`   Used: ${existing.used_count} / ${existing.max_uses}`);
      console.log(`   Active: ${existing.is_active}`);
    }
  }

  console.log('\n--- All active coupons ---');
  const all = await sql`SELECT code, discount_amount, discount_percent, max_uses, max_uses_per_user, used_count, proxy_types FROM coupons WHERE is_active = true ORDER BY created_at DESC`;
  for (const c of all) {
    console.log(`  ${c.code}: R$${c.discount_amount || 0} / ${c.discount_percent || 0}% | ${c.used_count}/${c.max_uses} | per_user:${c.max_uses_per_user} | type:${c.proxy_types}`);
  }
}

run();
