require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = 'postgresql://neondb_owner:npg_h36kyvFHKwLM@ep-divine-dust-amp634t6-pooler.c-5.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require';

const sql = neon(DATABASE_URL);

async function fix() {
  const userId = 32;
  
  console.log('=== Fixing subscription dates ===\n');
  
  // Get the subscription
  const subs = await sql`
    SELECT * FROM subscriptions WHERE user_id = ${userId} AND status = 'active' ORDER BY created_at DESC LIMIT 1
  `;
  
  if (subs.length === 0) {
    console.log('No active subscription found');
    return;
  }
  
  const sub = subs[0];
  console.log('Current subscription:', sub);
  
  // Calculate correct end date (1 month from now)
  const startDate = new Date();
  const endDate = new Date();
  endDate.setMonth(endDate.getMonth() + 1);
  
  console.log('\nNew start_date:', startDate.toISOString());
  console.log('New end_date:', endDate.toISOString());
  
  // Update subscription
  await sql`
    UPDATE subscriptions 
    SET start_date = ${startDate}, end_date = ${endDate}, status = 'active'
    WHERE id = ${sub.id}
  `;
  
  // Also update user table
  await sql`
    UPDATE users 
    SET subscription_status = 'active', 
        subscription_start_date = ${startDate},
        subscription_end_date = ${endDate},
        subscription_period = '1m',
        subscription_proxy_count = ${sub.proxy_count}
    WHERE id = ${userId}
  `;
  
  console.log('\n✅ Fixed subscription and user dates!');
  
  // Verify
  const updatedSub = await sql`SELECT * FROM subscriptions WHERE id = ${sub.id}`;
  console.table(updatedSub);
  
  const updatedUser = await sql`SELECT id, email, subscription_status, subscription_start_date, subscription_end_date FROM users WHERE id = ${userId}`;
  console.table(updatedUser);
}

fix().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });