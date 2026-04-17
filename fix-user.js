require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = 'postgresql://neondb_owner:npg_h36kyvFHKwLM@ep-divine-dust-amp634t6-pooler.c-5.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require';

const sql = neon(DATABASE_URL);

async function fix() {
  const userEmail = 'erickusuario@tuamaeaquelaursa.com';
  const user = await sql`SELECT * FROM users WHERE email = ${userEmail}`;
  if (user.length === 0) return;
  const u = user[0];
  
  console.log('Fixando usuário:', u.email);
  
  // 1. Atualizar subscription_status na tabela users
  await sql`UPDATE users SET subscription_status = 'active', updated_at = NOW() WHERE id = ${u.id}`;
  console.log('✓ subscription_status atualizado para active');
  
  // 2. Criar mais 1 proxy (ter 2 no total)
  const sub = await sql`SELECT id FROM subscriptions WHERE user_id = ${u.id} AND status = 'active' ORDER BY created_at DESC LIMIT 1`;
  if (sub.length > 0) {
    await sql`INSERT INTO proxies (user_id, subscription_id, ip, port, username, password, is_active, created_at) VALUES (${u.id}, ${sub[0].id}, '177.54.146.90', 11372, 'fastproxy123', 'fast123', true, NOW())`;
    console.log('✓ Proxy adicional criado (porta 11372)');
  }
  
  // 3. Verificar
  const proxies = await sql`SELECT ip, port FROM proxies WHERE user_id = ${u.id} AND is_active = true`;
  console.log('\nProxies agora:', proxies.length);
  proxies.forEach(p => console.log('  -', p.ip + ':' + p.port));
}

fix().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });