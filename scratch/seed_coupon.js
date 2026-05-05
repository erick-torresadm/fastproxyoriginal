const { sql } = require('../lib/database');

async function seedCoupon() {
    try {
        console.log('Seeding "perfis" coupon...');
        await sql`
            INSERT INTO coupons (code, discount_percent, is_active, scope, max_uses_per_user)
            VALUES ('PERFIS', 0, true, 'first_only', 1)
            ON CONFLICT (code) DO UPDATE SET is_active = true, scope = 'first_only';
        `;
        console.log('✅ Coupon "perfis" seeded successfully!');
        process.exit(0);
    } catch (err) {
        console.error('Error seeding coupon:', err);
        process.exit(1);
    }
}

seedCoupon();
