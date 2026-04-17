require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = 'postgresql://neondb_owner:npg_h36kyvFHKwLM@ep-divine-dust-amp634t6-pooler.c-5.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require';

const sql = neon(DATABASE_URL);

async function fix() {
  const email = 'erickusuario@tuamaeaquelaursa.com';
  const user = await sql`SELECT * FROM users WHERE email = ${email}`;
  if (user.length === 0) { console.log('User not found'); return; }
  const u = user[0];
  
  console.log('User ID:', u.id);
  
  // Update subscription to 2 proxies
  await sql`UPDATE subscriptions SET proxy_count = 2 WHERE user_id = ${u.id} AND status = 'active'`;
  console.log('Updated proxy_count to 2');
  
  // Get subscription ID
  const subs = await sql`SELECT id FROM subscriptions WHERE user_id = ${u.id} AND status = 'active' ORDER BY created_at DESC LIMIT 1`;
  if (subs.length === 0) { console.log('No active subscription'); return; }
  const subId = subs[0].id;
  
  // Create 2nd proxy (without proxy_type column)
  await sql`INSERT INTO proxies (user_id, subscription_id, ip, port, username, password, is_active, created_at) VALUES (${u.id}, ${subId}, '177.54.146.90', 11371, 'fastproxy123', 'fast123', true, NOW())`;
  console.log('Created 2nd proxy');
  
  // Verify
  const proxies = await sql`SELECT * FROM proxies WHERE user_id = ${u.id}`;
  console.log('\nTotal proxies:', proxies.length);
  proxies.forEach(p => console.log('  ', p.ip, ':', p.port));
}

fix().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });