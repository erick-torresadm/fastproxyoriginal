require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

console.log('=== LOADING SERVER ===');
console.log('CAKTO_CLIENT_ID:', process.env.CAKTO_CLIENT_ID ? 'set' : 'missing');
console.log('CAKTO_CLIENT_SECRET:', process.env.CAKTO_CLIENT_SECRET ? 'set' : 'missing');

const app = express();

app.use(cors());
app.use(express.json());

let caktoRoutes;
try {
  caktoRoutes = require('./routes/cakto');
  console.log('CaktoRoutes type:', typeof caktoRoutes);
  console.log('CaktoRoutes:', caktoRoutes);
  app.use('/api/cakto', caktoRoutes);
  console.log('✅ Cakto routes registered');
  console.log('Routes after:', app._router ? app._router.stack.length : 0);
} catch (err) {
  console.error('❌ Error loading Cakto routes:', err.message);
  console.error('Stack:', err.stack);
  console.error('Err:', err);
}

app.get('/test', (req, res) => {
  res.json({ message: 'Server is working' });
});

app.get('/debug/env', (req, res) => {
  res.json({
    CAKTO_CLIENT_ID: process.env.CAKTO_CLIENT_ID ? 'set' : 'missing',
    CAKTO_CLIENT_SECRET: process.env.CAKTO_CLIENT_SECRET ? 'set' : 'missing',
    CAKTO_BASE_URL: process.env.CAKTO_BASE_URL,
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
  res.json({ message: 'FastProxy API running', status: 'ok' });
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