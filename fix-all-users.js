require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = 'postgresql://neondb_owner:npg_h36kyvFHKwLM@ep-divine-dust-amp634t6-pooler.c-5.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require';

const sql = neon(DATABASE_URL);

async function fix() {
  const users = ['erickusuario@tuamaeaquelaursa.com', 'lis-lago@tuamaeaquelaursa.com'];
  
  for (const email of users) {
    const user = await sql`SELECT id, email FROM users WHERE email = ${email}`;
    if (user.length === 0) continue;
    const u = user[0];
    
    // Corrigir subscription
    const subs = await sql`SELECT id, end_date FROM subscriptions WHERE user_id = ${u.id} AND status = 'active'`;
    if (subs.length > 0) {
      const now = new Date();
      const endDate = new Date(now);
      endDate.setMonth(endDate.getMonth() + 1);
      
      await sql`UPDATE subscriptions SET start_date = NOW(), end_date = ${endDate.toISOString()} WHERE user_id = ${u.id}`;
      console.log(`✓ ${u.email} - subscription atualizada para ${endDate.toLocaleDateString('pt-BR')}`);
    }
  }
}

fix().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });