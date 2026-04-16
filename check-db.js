require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = 'postgresql://neondb_owner:npg_h36kyvFHKwLM@ep-divine-dust-amp634t6-pooler.c-5.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require';

const sql = neon(DATABASE_URL);

async function fix() {
  const userId = 34;
  
  console.log('=== Fixing user', userId, '===');
  
  // Get subscription
  const subs = await sql`SELECT * FROM subscriptions WHERE user_id = ${userId} AND status = 'active'`;
  
  if (subs.length === 0) {
    console.log('No active subscription');
    return;
  }
  
  const sub = subs[0];
  console.log('Current:', sub);
  
  const periodMonths = sub.period === '12m' ? 12 : sub.period === '6m' ? 6 : 1;
  
  const startDate = new Date(sub.start_date);
  const endDate = new Date(startDate);
  endDate.setMonth(endDate.getMonth() + periodMonths);
  
  // Handle overflow
  if (endDate.getMonth() !== (startDate.getMonth() + periodMonths) % 12) {
    endDate.setDate(0);
  }
  
  console.log('\nNew end_date:', endDate.toISOString());
  
  // Update
  await sql`UPDATE subscriptions SET end_date = ${endDate.toISOString()} WHERE id = ${sub.id}`;
  await sql`UPDATE users SET subscription_status = 'active', subscription_start_date = ${startDate.toISOString()}, subscription_end_date = ${endDate.toISOString()}, subscription_period = ${sub.period} WHERE id = ${userId}`;
  
  console.log('✅ Fixed!');
}

fix().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });