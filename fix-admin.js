require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const bcrypt = require('bcryptjs');

const DATABASE_URL = 'postgresql://neondb_owner:npg_h36kyvFHKwLM@ep-divine-dust-amp634t6-pooler.c-5.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require';

const sql = neon(DATABASE_URL);

async function fixAdmin() {
  const email = 'ericktorresadm@hotmail.com';
  const newPassword = '@Fastproxy10';
  
  const hashedPassword = await bcrypt.hash(newPassword, 10);
  
  await sql`UPDATE users SET password = ${hashedPassword}, updated_at = NOW() WHERE email = ${email}`;
  
  console.log('Admin password updated for:', email);
}

fixAdmin().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });