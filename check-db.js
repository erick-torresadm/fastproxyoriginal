require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = 'postgresql://neondb_owner:npg_h36kyvFHKwLM@ep-divine-dust-amp634t6-pooler.c-5.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require';

const sql = neon(DATABASE_URL);

async function fix() {
  const email = 'fdfdf@tuamaeaquelaursa.com';
  
  console.log('=== Fixing:', email, '===\n');
  
  // Get user
  const user = await sql`SELECT * FROM users WHERE email = ${email}`;
  if (user.length === 0) { console.log('User not found!'); return; }
  const u = user[0];
  console.log('User ID:', u.id);
  
  // Fix subscription dates
  const startDate = new Date();
  const endDate = new Date();
  endDate.setMonth(endDate.getMonth() + 1);
  
  console.log('Start:', startDate.toISOString());
  console.log('End:', endDate.toISOString());
  
  // Update subscription
  await sql`
    UPDATE subscriptions 
    SET status = 'active', start_date = ${startDate.toISOString()}, end_date = ${endDate.toISOString()}
    WHERE user_id = ${u.id}
  `;
  console.log('✅ Subscription fixed');
  
  // Update user table
  await sql`
    UPDATE users 
    SET subscription_status = 'active', 
        subscription_start_date = ${startDate.toISOString()}, 
        subscription_end_date = ${endDate.toISOString()},
        subscription_period = '1m',
        subscription_proxy_count = 1
    WHERE id = ${u.id}
  `;
  console.log('✅ User fixed');
  
  // Show result
  const updated = await sql`SELECT * FROM users WHERE email = ${email}`;
  console.log('\n=== Result ===');
  console.log('subscription_status:', updated[0].subscription_status);
  console.log('subscription_period:', updated[0].subscription_period);
  console.log('subscription_proxy_count:', updated[0].subscription_proxy_count);
  console.log('subscription_start_date:', updated[0].subscription_start_date);
  console.log('subscription_end_date:', updated[0].subscription_end_date);
}

fix().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });