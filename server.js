require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

console.log('=== LOADING SERVER ===');
console.log('CAKTO_CLIENT_ID:', process.env.CAKTO_CLIENT_ID ? 'set' : 'missing');
console.log('CAKTO_CLIENT_SECRET:', process.env.CAKTO_CLIENT_SECRET ? 'set' : 'missing');

const authRoutes = require('./routes/auth');
const proxyRoutes = require('./routes/proxies');
const orderRoutes = require('./routes/orders');
const planRoutes = require('./routes/plans');
const caktoRoutes = require('./routes/cakto');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/proxies', proxyRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/cakto', caktoRoutes);

app.get('/test-cakto', async (req, res) => {
  res.json({ message: 'Direct test works' });
});

app.get('/debug/env', (req, res) => {
  res.json({
    CAKTO_CLIENT_ID: process.env.CAKTO_CLIENT_ID ? 'set' : 'missing',
    CAKTO_CLIENT_SECRET: process.env.CAKTO_CLIENT_SECRET ? 'set' : 'missing',
    CAKTO_BASE_URL: process.env.CAKTO_BASE_URL,
    MONGODB_URI: process.env.MONGODB_URI ? 'set' : 'missing'
  });
});

app.get('/debug/routes', (req, res) => {
  const routes = [];
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
  res.json(routes);
});

app.get('/', (req, res) => {
  res.json({ message: 'FastProxy API running', status: 'ok' });
});

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ MongoDB connected');
    app.listen(process.env.PORT, () => {
      console.log(`🚀 Server running on port ${process.env.PORT}`);
    });
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });