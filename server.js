require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');

console.log('=== LOADING SERVER ===');
console.log('STRIPE_SECRET_KEY:', process.env.STRIPE_SECRET_KEY ? 'set' : 'missing');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'set' : 'missing');
console.log('STRIPE_TEST_MODE:', process.env.STRIPE_TEST_MODE || 'false');
console.log('PROXYSELLER_API_KEY:', process.env.PROXYSELLER_API_KEY ? 'set' : 'missing');

const app = express();

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://cdnjs.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "https://checkout.stripe.com", "https://api.stripe.com"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// Trust proxy for rate limiting behind Vercel/CDN
app.set('trust proxy', 1);

app.use(cors({
  origin: function (origin, callback) {
    const allowed = [
      process.env.APP_URL || '*',
      'https://fastproxyoriginal.vercel.app',
      'https://fastproxyv3.vercel.app',
      'https://fastproxy.com.br',
      'http://localhost:3000',
    ].filter(Boolean);
    if (!origin || allowed.some(u => u.replace(/\/+$/, '') === origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
app.use(express.json({ limit: '10kb' }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// API Routes
let stripeRoutes, authRoutes, testRoutes, subscriptionRoutes;
try {
  stripeRoutes = require('./routes/stripe');
  app.use('/api/stripe', stripeRoutes);
  console.log('✅ Stripe routes registered');
} catch (err) {
  console.error('❌ Error loading Stripe routes:', err.message);
}

try {
  authRoutes = require('./routes/auth');
  app.use('/api/auth', authRoutes);
  console.log('✅ Auth routes registered');
} catch (err) {
  console.error('❌ Error loading Auth routes:', err.message);
}

try {
  testRoutes = require('./routes/test');
  app.use('/api/test', testRoutes);
  console.log('✅ Test routes registered');
} catch (err) {
  console.error('❌ Error loading Test routes:', err.message);
}

try {
  subscriptionRoutes = require('./routes/subscription');
  app.use('/api/subscription', subscriptionRoutes);
  console.log('✅ Subscription routes registered');
} catch (err) {
  console.error('❌ Error loading Subscription routes:', err.message);
}

try {
  const proxyRoutes = require('./routes/proxyseller');
  app.use('/api/proxyseller', proxyRoutes);
  console.log('✅ ProxySeller routes registered');
} catch (err) {
  console.error('❌ Error loading ProxySeller routes:', err.message);
}

try {
  const couponRoutes = require('./routes/coupons');
  app.use('/api/coupons', couponRoutes);
  console.log('✅ Coupons routes registered');
} catch (err) {
  console.error('❌ Error loading Coupons routes:', err.message);
}

try {
  const testPricesRoutes = require('./routes/test-prices');
  app.use('/api/test-prices', testPricesRoutes);
  console.log('✅ Test Prices routes registered');
} catch (err) {
  console.error('❌ Error loading Test Prices routes:', err.message);
}

try {
  const checkoutRoutes = require('./routes/checkout');
  app.use('/api/checkout', checkoutRoutes);
  console.log('✅ Checkout routes registered');
} catch (err) {
  console.error('❌ Error loading Checkout routes:', err.message);
}

try {
  const accessLogsRoutes = require('./routes/accesslogs');
  app.use('/api/accesslogs', accessLogsRoutes);
  console.log('✅ Access Logs routes registered');
} catch (err) {
  console.error('❌ Error loading Access Logs routes:', err.message);
}

try {
  const rewardsRoutes = require('./routes/rewards');
  app.use('/api/rewards', rewardsRoutes);
  console.log('✅ Rewards routes registered');
} catch (err) {
  console.error('❌ Error loading Rewards routes:', err.message);
}

app.get('/test', (req, res) => {
  res.json({ 
    message: 'FastProxy API running', 
    stripeMode: process.env.STRIPE_TEST_MODE === 'true' ? 'TEST' : 'PRODUCTION',
    database: process.env.DATABASE_URL ? 'Neon Postgres ✅' : 'NOT CONFIGURED ❌'
  });
});

app.get('/debug/env', (req, res) => {
  res.json({
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ? 'set' : 'missing',
    STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY ? 'set' : 'missing',
    STRIPE_TEST_MODE: process.env.STRIPE_TEST_MODE,
    DATABASE_URL: process.env.DATABASE_URL ? 'set' : 'missing',
    APP_URL: process.env.APP_URL,
    RESEND_API_KEY: process.env.RESEND_API_KEY ? `set (${process.env.RESEND_API_KEY.substring(0, 10)}...)` : 'missing'
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err.message);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err.message);
});
