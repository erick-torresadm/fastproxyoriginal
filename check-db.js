require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = 'postgresql://neondb_owner:npg_h36kyvFHKwLM@ep-divine-dust-amp634t6-pooler.c-5.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require';

const sql = neon(DATABASE_URL);

async function check() {
  console.log('=== VERIFICAÇÃO COMPLETA DO USUÁRIO ===\n');
  
  const email = 'erickusuario@tuamaeaquelaursa.com';
  const user = await sql`SELECT * FROM users WHERE email = ${email}`;
  if (user.length === 0) { console.log('❌ Usuário não encontrado'); return; }
  const u = user[0];
  
  console.log('📧 Usuário:', u.email);
  console.log('🆔 ID:', u.id);
  console.log('📱 WhatsApp:', u.whatsapp || '(não cadastrado)');
  console.log('📊 Subscription status:', u.subscription_status || '(null)');
  
  // Subscriptions
  console.log('\n📋 ASSINATURAS:');
  const subs = await sql`SELECT * FROM subscriptions WHERE user_id = ${u.id} ORDER BY created_at DESC`;
  subs.forEach(s => {
    console.log('  ID:', s.id);
    console.log('  Status:', s.status);
    console.log('  Período:', s.period);
    console.log('  Qty proxies:', s.proxy_count);
    console.log('  Início:', new Date(s.start_date).toLocaleString('pt-BR'));
    console.log('  Fim:', new Date(s.end_date).toLocaleString('pt-BR'));
    console.log('  Ativa?', new Date(s.end_date) > new Date() ? '✅ SIM' : '❌ NÃO');
  });
  
  // Proxies
  console.log('\n🔗 PROXIES:');
  const proxies = await sql`SELECT * FROM proxies WHERE user_id = ${u.id} ORDER BY created_at DESC`;
  console.log('  Total:', proxies.length);
  proxies.forEach(p => {
    console.log('  -', p.ip + ':' + p.port, '| user_id:', p.user_id, '| sub_id:', p.subscription_id, '| ativo:', p.is_active);
  });
  
  // Reward points
  console.log('\n⭐ PONTOS:');
  const [reward] = await sql`SELECT * FROM reward_points WHERE user_id = ${u.id}`;
  if (reward) {
    console.log('  Total:', reward.total_points);
    console.log('  Disponível:', reward.available_points);
  } else {
    console.log('  Nenhum ponto');
  }
}

check().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });