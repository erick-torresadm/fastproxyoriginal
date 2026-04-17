require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = 'postgresql://neondb_owner:npg_h36kyvFHKwLM@ep-divine-dust-amp634t6-pooler.c-5.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require';

const sql = neon(DATABASE_URL);

async function check() {
  const email = 'erickusuario@tuamaeaquelaursa.com';
  
  console.log('=== Checking:', email, '===');
  
  const user = await sql`SELECT * FROM users WHERE email = ${email}`;
  if (user.length === 0) { console.log('User not found'); return; }
  const u = user[0];
  console.log('User ID:', u.id);
  
  const orders = await sql`SELECT * FROM proxy_orders WHERE user_id = ${u.id} ORDER BY created_at DESC LIMIT 5`;
  console.log('\nProxy Orders:', orders.length);
  orders.forEach(o => console.log('  ID:', o.id, 'quantity:', o.quantity, 'period:', o.period, 'status:', o.payment_status));
  
  const subs = await sql`SELECT * FROM subscriptions WHERE user_id = ${u.id} ORDER BY created_at DESC LIMIT 5`;
  console.log('\nSubscriptions:', subs.length);
  subs.forEach(s => console.log('  ID:', s.id, 'proxy_count:', s.proxy_count, 'period:', s.period, 'status:', s.status));
  
  const proxies = await sql`SELECT * FROM proxies WHERE user_id = ${u.id}`;
  console.log('\nLocal Proxies:', proxies.length);
  proxies.forEach(p => console.log('  ', p.ip, ':', p.port));
}

check().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });