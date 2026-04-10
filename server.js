require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');

console.log('=== LOADING SERVER ===');
console.log('STRIPE_SECRET_KEY:', process.env.STRIPE_SECRET_KEY ? 'set' : 'missing');

// MongoDB Connection with longer timeout
const MONGODB_URI = process.env.MONGODB_URI;
if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 30000, // 30 seconds
    socketTimeoutMS: 45000,
    maxPoolSize: 10,
    retryWrites: true,
    w: 'majority'
  })
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err.message));
} else {
  console.warn('⚠️ MONGODB_URI not set - Auth features will not work');
}

const app = express();

app.use(cors());
app.use(express.json());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
let stripeRoutes, authRoutes, testRoutes;
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

app.get('/test', (req, res) => {
  res.json({ 
    message: 'Server is working', 
    stripeMode: process.env.STRIPE_TEST_MODE === 'true' ? 'TEST' : 'PRODUCTION',
    mongodb: MONGODB_URI ? 'configured' : 'NOT CONFIGURED'
  });
});

app.get('/debug/env', (req, res) => {
  res.json({
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ? 'set' : 'missing',
    STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY ? 'set' : 'missing',
    STRIPE_TEST_MODE: process.env.STRIPE_TEST_MODE,
    APP_URL: process.env.APP_URL,
    MONGODB_URI: MONGODB_URI ? 'set' : 'missing',
    NODE_ENV: process.env.NODE_ENV
  });
});

app.get('/debug/routes', (req, res) => {
  const routes = [];
  if (app._router) {
    app._router.stack.forEach(middleware => {
      if (middleware.route) {
        routes.push({ path: middleware.route.path, methods: middleware.route.methods });
      } else if (middleware.name === 'router') {
        middleware.handle.stack.forEach(handler => {
          if (handler.route) {
            routes.push({ path: handler.route.path, methods: handler.route.methods });
          }
        });
      }
    });
  }
  res.json({ routes, stackLength: app._router ? app._router.stack.length : 0 });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve index.html for all other routes (SPA support)
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
