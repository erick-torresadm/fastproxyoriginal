require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = 'postgresql://neondb_owner:npg_h36kyvFHKwLM@ep-divine-dust-amp634t6-pooler.c-5.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require';

const sql = neon(DATABASE_URL);

async function checkLogin() {
  const email = 'lis-lago@tuamaeaquelaursa.com';
  
  const user = await sql`SELECT id, email, password, role FROM users WHERE email = ${email}`;
  if (user.length === 0) { console.log('❌ Usuário não existe'); return; }
  
  const u = user[0];
  console.log('Usuário:', u.email);
  console.log('ID:', u.id);
  console.log('Role:', u.role);
  
  // Verificar se senha precisa ser atualizada
  console.log('\n⚠️ Precisa definir senha para login');
  console.log('Para testar, use a função de reset ou cree nuevo usuario');
}

checkLogin().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });