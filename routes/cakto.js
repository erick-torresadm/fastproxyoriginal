const express = require('express');
const router = express.Router();
const Cakto = require('../lib/cakto');
const User = require('../models/User');
const Proxy = require('../models/Proxy');
const Order = require('../models/Order');

router.post('/webhook', express.json(), async (req, res) => {
  try {
    if (!process.env.CAKTO_CLIENT_ID || !process.env.CAKTO_CLIENT_SECRET || process.env.CAKTO_CLIENT_ID === 'demo') {
      console.log('Cakto not configured, skipping webhook');
      return res.json({ received: true, status: 'skipped' });
    }

    const event = req.body;
    console.log('Cakto webhook received:', event);

    const eventType = event.event;
    const orderId = event.order_id || event.order?.id;

    if (!orderId) {
      console.log('No order_id in webhook');
      return res.json({ received: true });
    }

    if (eventType === 'order.completed' || eventType === 'payment.approved') {
      await handleSuccessfulPayment(orderId, event);
    } else if (eventType === 'order.refunded') {
      await handleRefund(orderId, event);
    } else if (eventType === 'order.canceled' || eventType === 'payment.refused') {
      await handleCanceledPayment(orderId, event);
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: 'Webhook processing error' });
  }
});

async function handleSuccessfulPayment(orderId, event) {
  const orderData = await Cakto.getOrder(orderId);
  const customerEmail = orderData.customer?.email;
  const customerWhatsApp = orderData.customer?.phone;
  const productName = orderData.items?.[0]?.product?.name || '';
  const paymentAmount = orderData.total;

  console.log(`Processing payment for order ${orderId}, email: ${customerEmail}, amount: ${paymentAmount}`);

  const user = await User.findOne({ email: customerEmail });
  
  if (!user) {
    console.log(`User not found for email: ${customerEmail}`);
    await createPendingUser(orderId, customerEmail, customerWhatsApp, productName, paymentAmount);
    return;
  }

  const quantityMatch = productName.match(/(\d+)\s*proxy/i);
  const proxyCount = quantityMatch ? parseInt(quantityMatch[1]) : 1;

  for (let i = 0; i < proxyCount; i++) {
    const availableProxy = await Proxy.findOne({ status: 'available' }).sort({ port: 1 });
    
    if (availableProxy) {
      availableProxy.status = 'active';
      availableProxy.userId = user._id;
      availableProxy.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await availableProxy.save();
      
      await User.findByIdAndUpdate(user._id, { $inc: { proxyCount: 1 } });
    }
  }

  await Order.findOneAndUpdate(
    { caktoOrderId: orderId },
    { 
      status: 'approved',
      downloadUrl: `${process.env.APP_URL}/portal.html`
    }
  );

  console.log(`Activated ${proxyCount} proxies for user ${user.email}`);
}

async function handleRefund(orderId, event) {
  const user = await User.findOne({ caktoOrderId: orderId });
  
  if (user) {
    await Proxy.updateMany(
      { userId: user._id, orderId: orderId },
      { status: 'expired' }
    );
    
    await User.findByIdAndUpdate(user._id, { proxyCount: 0 });
  }

  await Order.findOneAndUpdate(
    { caktoOrderId: orderId },
    { status: 'refunded' }
  );

  console.log(`Order ${orderId} refunded, proxies expired`);
}

async function handleCanceledPayment(orderId, event) {
  await Order.findOneAndUpdate(
    { caktoOrderId: orderId },
    { status: 'canceled' }
  );

  console.log(`Order ${orderId} canceled`);
}

async function createPendingUser(orderId, email, whatsapp, productName, amount) {
  const user = await User.findOne({ email });
  
  if (!user) {
    await User.create({
      name: email.split('@')[0],
      email,
      whatsapp,
      role: 'user',
      isActive: false,
      proxyCount: 0
    });
  }

  await Order.create({
    userId: user?._id,
    planId: null,
    caktoOrderId: orderId,
    status: 'pending',
    totalAmount: amount
  });

  console.log(`Created pending user/order for email: ${email}`);
}

router.get('/create-webhook', async (req, res) => {
  try {
    const token = await Cakto.getAccessToken();
    res.json({ success: true, token: token.substring(0, 20) + '...' });
  } catch (err) {
    console.error('Cakto error:', err.response?.data || err.message);
    res.status(500).json({ error: err.message, details: err.response?.data });
  }
});

module.exports = router;