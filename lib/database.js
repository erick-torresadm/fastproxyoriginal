const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not set');
}

const sql = neon(DATABASE_URL);

// Create tables if they don't exist
async function initDatabase() {
  try {
    // Users table
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        whatsapp VARCHAR(50),
        role VARCHAR(20) DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('✅ Users table created/verified');

    // Subscriptions table
    await sql`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        stripe_session_id VARCHAR(255),
        stripe_customer_id VARCHAR(255),
        period VARCHAR(20) NOT NULL,
        proxy_count INTEGER NOT NULL,
        price_paid DECIMAL(10,2),
        status VARCHAR(20) DEFAULT 'active',
        start_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        end_date TIMESTAMP,
        auto_renew BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('✅ Subscriptions table created/verified');

    // Proxies table
    await sql`
      CREATE TABLE IF NOT EXISTS proxies (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        subscription_id INTEGER REFERENCES subscriptions(id),
        ip VARCHAR(45) NOT NULL,
        port INTEGER NOT NULL,
        username VARCHAR(50) NOT NULL,
        password VARCHAR(100) NOT NULL,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('✅ Proxies table created/verified');

    // Proxy replacements (history)
    await sql`
      CREATE TABLE IF NOT EXISTS proxy_replacements (
        id SERIAL PRIMARY KEY,
        proxy_id INTEGER REFERENCES proxies(id),
        old_ip VARCHAR(45),
        old_port INTEGER,
        new_ip VARCHAR(45),
        new_port INTEGER,
        price_charged DECIMAL(10,2),
        reason VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('✅ Proxy replacements table created/verified');

    // Discounts table
    await sql`
      CREATE TABLE IF NOT EXISTS discounts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        type VARCHAR(50) NOT NULL,
        discount_percent DECIMAL(5,2),
        valid_until TIMESTAMP,
        used BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('✅ Discounts table created/verified');

    // Tutorials table
    await sql`
      CREATE TABLE IF NOT EXISTS tutorials (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        slug VARCHAR(255) UNIQUE NOT NULL,
        excerpt TEXT,
        content TEXT,
        category VARCHAR(50) DEFAULT 'configuracao',
        icon VARCHAR(50) DEFAULT 'book',
        image_url VARCHAR(500),
        status VARCHAR(20) DEFAULT 'draft',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('✅ Tutorials table created/verified');

    // Blog posts table
    await sql`
      CREATE TABLE IF NOT EXISTS blog_posts (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        slug VARCHAR(255) UNIQUE NOT NULL,
        excerpt TEXT,
        content TEXT,
        category VARCHAR(50) DEFAULT 'geral',
        image_url VARCHAR(500),
        status VARCHAR(20) DEFAULT 'draft',
        meta_title VARCHAR(255),
        meta_description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('✅ Blog posts table created/verified');

    // ProxySeller Orders table
    await sql`
      CREATE TABLE IF NOT EXISTS proxy_orders (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        stripe_session_id VARCHAR(255),
        stripe_payment_intent VARCHAR(255),
        proxyseller_order_id VARCHAR(100),
        proxyseller_order_number VARCHAR(100),
        proxy_type VARCHAR(20) DEFAULT 'ipv6',
        country VARCHAR(50) DEFAULT 'Brazil',
        country_id INTEGER DEFAULT 20554,
        quantity INTEGER DEFAULT 10,
        period VARCHAR(20) DEFAULT '1m',
        period_days INTEGER DEFAULT 30,
        cost_usd DECIMAL(10,2),
        cost_brl DECIMAL(10,2),
        price_sold_brl DECIMAL(10,2),
        profit_margin DECIMAL(10,2),
        status VARCHAR(30) DEFAULT 'pending',
        payment_status VARCHAR(20) DEFAULT 'pending',
        expira_em TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('✅ ProxySeller orders table created/verified');

    // ProxySeller Proxies (individual proxy tracking)
    await sql`
      CREATE TABLE IF NOT EXISTS proxyseller_proxies (
        id SERIAL PRIMARY KEY,
        proxy_order_id INTEGER REFERENCES proxy_orders(id),
        user_id INTEGER REFERENCES users(id),
        proxyseller_proxy_id VARCHAR(100),
        proxyseller_auth_id VARCHAR(100),
        ip VARCHAR(100),
        port INTEGER,
        protocol VARCHAR(20) DEFAULT 'HTTP',
        username VARCHAR(100),
        password VARCHAR(100),
        is_assigned BOOLEAN DEFAULT false,
        is_active BOOLEAN DEFAULT true,
        is_blocked BOOLEAN DEFAULT false,
        blocked_reason VARCHAR(255),
        blocked_at TIMESTAMP,
        assigned_at TIMESTAMP,
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('✅ ProxySeller proxies table created/verified');

    // Coupons table
    await sql`
      CREATE TABLE IF NOT EXISTS coupons (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50) UNIQUE NOT NULL,
        discount_percent DECIMAL(5,2),
        discount_amount DECIMAL(10,2),
        min_order_value DECIMAL(10,2) DEFAULT 0,
        max_uses INTEGER,
        used_count INTEGER DEFAULT 0,
        valid_from TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        valid_until TIMESTAMP,
        is_active BOOLEAN DEFAULT true,
        proxy_types VARCHAR(255),
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('✅ Coupons table created/verified');

    // Coupon usage history
    await sql`
      CREATE TABLE IF NOT EXISTS coupon_usage (
        id SERIAL PRIMARY KEY,
        coupon_id INTEGER REFERENCES coupons(id),
        user_id INTEGER REFERENCES users(id),
        order_id INTEGER REFERENCES proxy_orders(id),
        discount_applied DECIMAL(10,2) NOT NULL,
        used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('✅ Coupon usage table created/verified');

  } catch (err) {
    console.error('❌ Error creating tables:', err.message);
  }
}

// Initialize on load
initDatabase();

module.exports = { sql };
