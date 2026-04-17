require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const bcrypt = require('bcryptjs');

const DATABASE_URL = 'postgresql://neondb_owner:npg_h36kyvFHKwLM@ep-divine-dust-amp634t6-pooler.c-5.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require';

const sql = neon(DATABASE_URL);

async function createAdmin() {
  const email = 'ericktorresadm@gmail.com';
  const password = '@Fastproxy10';
  const hashedPassword = await bcrypt.hash(password, 10);
  
  // Check if user exists
  const existing = await sql`SELECT id FROM users WHERE email = ${email}`;
  
  if (existing.length === 0) {
    await sql`
      INSERT INTO users (email, password, name, role, is_active, created_at)
      VALUES (${email}, ${hashedPassword}, 'Erick Admin', 'admin', true, NOW())
    `;
    console.log('✅ Admin created: ' + email + ' / ' + password);
  } else {
    await sql`UPDATE users SET password = ${hashedPassword}, role = 'admin' WHERE email = ${email}`;
    console.log('✅ Admin updated: ' + email + ' / ' + password);
  }
}

createAdmin().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });