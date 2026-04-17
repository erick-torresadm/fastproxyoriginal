require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = 'postgresql://neondb_owner:npg_h36kyvFHKwLM@ep-divine-dust-amp634t6-pooler.c-5.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require';

const sql = neon(DATABASE_URL);

async function check() {
  const user = await sql`SELECT id, email, role FROM users WHERE email = 'ericktorresadm@hotmail.com'`;
  console.log('Admin user:', user.length > 0 ? 'found' : 'NOT found');
  if (user[0]) {
    console.log('  role:', user[0].role);
  }
}

check().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });