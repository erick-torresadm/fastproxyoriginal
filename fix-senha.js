require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const bcrypt = require('bcryptjs');

const DATABASE_URL = 'postgresql://neondb_owner:npg_h36kyvFHKwLM@ep-divine-dust-amp634t6-pooler.c-5.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require';

const sql = neon(DATABASE_URL);

async function fix() {
  const users = [
    { email: 'erickusuario@tuamaeaquelaursa.com', password: 'erick123' },
    { email: 'lis-lago@tuamaeaquelaursa.com', password: 'lis123' },
    { email: 'ericktorresadm@hotmail.com', password: '@Fastproxy10' }
  ];
  
  for (const u of users) {
    const hashedPassword = await bcrypt.hash(u.password, 10);
    await sql`UPDATE users SET password = ${hashedPassword} WHERE email = ${u.email}`;
    console.log('✓ ' + u.email + ' = ' + u.password);
  }
}

fix().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });