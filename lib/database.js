const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not set');
}

const sql = neon(DATABASE_URL);

// Create tables if they don't exist
async function initDatabase() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        whatsapp VARCHAR(50),
        role VARCHAR(20) DEFAULT 'user',
        is_active BOOLEAN DEFAULT true,
        subscription_period VARCHAR(20) DEFAULT 'monthly',
        subscription_proxy_count INTEGER DEFAULT 1,
        subscription_status VARCHAR(20) DEFAULT 'pending',
        subscription_start_date TIMESTAMP,
        subscription_end_date TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('✅ Users table created/verified');
  } catch (err) {
    console.error('❌ Error creating tables:', err.message);
  }
}

// Initialize on load
initDatabase();

module.exports = { sql };
