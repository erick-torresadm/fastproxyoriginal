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
        swaps_included INTEGER DEFAULT 0,
        swaps_used INTEGER DEFAULT 0,
        plan_type VARCHAR(50) DEFAULT 'standard',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('✅ Subscriptions table created/verified');
    
    // Migrations for Subscriptions table
    try {
      await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255)`;
      console.log('✅ Subscriptions column migration (stripe_subscription_id) applied');
    } catch(e) { /* column may already exist */ }

    try {
      await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS swaps_included INTEGER DEFAULT 0`;
      console.log('✅ Subscriptions column migration (swaps_included) applied');
    } catch(e) { /* column may already exist */ }

    try {
      await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS swaps_used INTEGER DEFAULT 0`;
      console.log('✅ Subscriptions column migration (swaps_used) applied');
    } catch(e) { /* column may already exist */ }

    try {
      await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS plan_type VARCHAR(50) DEFAULT 'standard'`;
      console.log('✅ Subscriptions column migration (plan_type) applied');
    } catch(e) { /* column may already exist */ }

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
        buyer_name VARCHAR(255),
        buyer_document VARCHAR(50),
        buyer_whatsapp VARCHAR(50),
        buyer_address VARCHAR(255),
        buyer_email VARCHAR(255),
        terms_accepted BOOLEAN DEFAULT false,
        terms_accepted_at TIMESTAMP,
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
        max_uses_per_user INTEGER DEFAULT 1,
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

    // Add max_uses_per_user if table already exists (migration-safe)
    try {
      await sql`ALTER TABLE coupons ADD COLUMN IF NOT EXISTS max_uses_per_user INTEGER DEFAULT 1`;
      console.log('✅ Coupons column migration (max_uses_per_user) applied');
    } catch(e) { /* column may already exist */ }

    // scope: 'all' = qualquer compra | 'first_only' = só primeira compra do cliente
    try {
      await sql`ALTER TABLE coupons ADD COLUMN IF NOT EXISTS scope VARCHAR(20) DEFAULT 'all'`;
      console.log('✅ Coupons column migration (scope) applied');
    } catch(e) { /* column may already exist */ }

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

    // Access logs (Marco Civil compliance - Lei 12.965/2014)
    await sql`
      CREATE TABLE IF NOT EXISTS access_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        proxy_id INTEGER REFERENCES proxyseller_proxies(id),
        client_ip VARCHAR(100),
        target_host VARCHAR(500),
        target_port INTEGER,
        request_method VARCHAR(20),
        request_path TEXT,
        request_headers TEXT,
        response_status INTEGER,
        bytes_sent BIGINT DEFAULT 0,
        bytes_received BIGINT DEFAULT 0,
        connection_duration INTEGER,
        connected_at TIMESTAMP NOT NULL,
        disconnected_at TIMESTAMP,
        session_id VARCHAR(100),
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('✅ Access logs table created/verified');

    // Create index for faster queries (required by Marco Civil - 6 months retention)
    await sql`CREATE INDEX IF NOT EXISTS idx_access_logs_user_id ON access_logs(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_access_logs_proxy_id ON access_logs(proxy_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_access_logs_connected_at ON access_logs(connected_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_access_logs_client_ip ON access_logs(client_ip)`;
    console.log('✅ Access logs indexes created/verified');

    // User consent (LGPD compliance)
    await sql`
      CREATE TABLE IF NOT EXISTS user_consents (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        consent_type VARCHAR(50) NOT NULL,
        consent_version VARCHAR(20),
        granted BOOLEAN NOT NULL,
        ip_address VARCHAR(100),
        user_agent TEXT,
        granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        revoked_at TIMESTAMP
      )
    `;
    console.log('✅ User consents table created/verified');

    // Attribution Logs - Marco Civil Compliance (Lei 12.965/2014)
    // Registers WHO had WHICH proxy IP at WHICH time
    await sql`
      CREATE TABLE IF NOT EXISTS attribution_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        proxy_order_id INTEGER REFERENCES proxy_orders(id),
        proxyseller_proxy_id INTEGER REFERENCES proxyseller_proxies(id),
        user_name VARCHAR(255),
        user_email VARCHAR(255),
        user_document VARCHAR(50),
        user_whatsapp VARCHAR(50),
        proxy_ip VARCHAR(100),
        proxy_port INTEGER,
        proxy_username VARCHAR(100),
        proxy_password VARCHAR(100),
        client_ip VARCHAR(100),
        user_agent TEXT,
        action VARCHAR(50),
        action_reason VARCHAR(255),
        expires_at TIMESTAMP,
        purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        delivered_at TIMESTAMP,
        returned_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('✅ Attribution logs table created/verified');

    // Terms of Service acceptance
    await sql`
      CREATE TABLE IF NOT EXISTS terms_acceptance (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        terms_version VARCHAR(20) NOT NULL,
        ip_address VARCHAR(100),
        user_agent TEXT,
        accepted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('✅ Terms of service acceptance table created/verified');

    // Create indexes for attribution logs (1 year retention)
    await sql`CREATE INDEX IF NOT EXISTS idx_attribution_user_id ON attribution_logs(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_attribution_proxy_ip ON attribution_logs(proxy_ip)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_attribution_purchased_at ON attribution_logs(purchased_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_attribution_client_ip ON attribution_logs(client_ip)`;
    console.log('✅ Attribution logs indexes created/verified');

    // Rewards/Points system
    await sql`
      CREATE TABLE IF NOT EXISTS reward_points (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        total_points INTEGER DEFAULT 0,
        available_points INTEGER DEFAULT 0,
        lifetime_points INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('✅ Reward points table created/verified');

    // Reward transactions (earn/redeem history)
    await sql`
      CREATE TABLE IF NOT EXISTS reward_transactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        order_id INTEGER REFERENCES proxy_orders(id),
        type VARCHAR(20) NOT NULL,
        points INTEGER NOT NULL,
        description VARCHAR(255),
        coupon_id INTEGER REFERENCES coupons(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('✅ Reward transactions table created/verified');

    // Create indexes
    await sql`CREATE INDEX IF NOT EXISTS idx_reward_user_id ON reward_points(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_reward_trans_user ON reward_transactions(user_id)`;
    console.log('✅ Reward indexes created/verified');

    // User transactions table - full purchase history
    await sql`
      CREATE TABLE IF NOT EXISTS user_transactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        type VARCHAR(50) NOT NULL,
        amount DECIMAL(10,2) DEFAULT 0,
        description VARCHAR(255),
        proxy_count INTEGER DEFAULT 0,
        proxy_details JSONB,
        payment_method VARCHAR(50),
        stripe_session_id VARCHAR(255),
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('✅ User transactions table created/verified');
    
    // User messages table - notifications and promotions
    await sql`
      CREATE TABLE IF NOT EXISTS user_messages (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        type VARCHAR(50) NOT NULL,
        title VARCHAR(255),
        message TEXT,
        is_read BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('✅ User messages table created/verified');
    
    await sql`CREATE INDEX IF NOT EXISTS idx_user_transactions_user ON user_transactions(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_user_messages_user ON user_messages(user_id)`;
    console.log('✅ User transactions/messages indexes created/verified');

  } catch (err) {
    console.error('❌ Error creating tables:', err.message);
  }
}

// Initialize on load
initDatabase();

module.exports = { sql };
