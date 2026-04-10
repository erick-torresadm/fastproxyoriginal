require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

console.log('=== LOADING SERVER ===');
console.log('STRIPE_SECRET_KEY:', process.env.STRIPE_SECRET_KEY ? 'set' : 'missing');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'set' : 'missing');
console.log('STRIPE_TEST_MODE:', process.env.STRIPE_TEST_MODE || 'false');

const app = express();

app.use(cors());
app.use(express.json());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

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
    APP_URL: process.env.APP_URL
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
