const express = require('express');
const router = express.Router();
const Cakto = require('../lib/cakto');
const User = require('../models/User');
const Proxy = require('../models/Proxy');
const Order = require('../models/Order');

router.post('/webhook', express.json(), async (req, res) => {
  try {
    console.log('=== CAKTO WEBHOOK RECEIVED ===');
    console.log('CAKTO_CLIENT_ID:', process.env.CAKTO_CLIENT_ID ? 'SET' : 'MISSING');
    console.log('CAKTO_CLIENT_SECRET:', process.env.CAKTO_CLIENT_SECRET ? 'SET' : 'MISSING');
    
    if (!process.env.CAKTO_CLIENT_ID || !process.env.CAKTO_CLIENT_SECRET) {
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

router.get('/test', async (req, res) => {
  try {
    console.log('GET /test called');
    res.json({ success: true, message: 'Test route works' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/test', express.json(), async (req, res) => {
  try {
    const { orderId, email, productName, amount } = req.body;
    
    const mockEvent = {
      event: 'order.completed',
      order_id: orderId,
      order: {
        id: orderId,
        customer: { email: email || 'test@example.com', phone: '11999999999' },
        items: [{ product: { name: productName || '5 proxies' } }],
        total: amount || 100
      }
    };
    
    console.log('=== TEST WEBHOOK ===');
    console.log('Mock event:', JSON.stringify(mockEvent, null, 2));
    
    await handleSuccessfulPayment(orderId, mockEvent);
    
    res.json({ success: true, message: 'Test webhook processed' });
  } catch (err) {
    console.error('Test webhook error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/create-checkout', express.json(), async (req, res) => {
  try {
    const { proxyCount, email, whatsapp } = req.body;
    
    if (!proxyCount || proxyCount < 1) {
      return res.status(400).json({ error: 'Quantidade de proxies inválida' });
    }

    const pricePerProxy = 59.90;
    const totalPrice = pricePerProxy * proxyCount;
    const productName = `${proxyCount} proxy${proxyCount > 1 ? 's' : ''} HTTP Premium`;

    console.log('=== CRIANDO CHECKOUT ===');
    console.log('Proxy count:', proxyCount);
    console.log('Total price:', totalPrice);

    const checkoutData = {
      items: [{
        name: productName,
        quantity: 1,
        price: totalPrice,
        is_variable: false
      }],
      customer: {
        email: email || '',
        phone: whatsapp || ''
      },
      configs: {
        redirect_after_payment: true,
        redirect_url: `${process.env.APP_URL}/portal.html`,
        notification_url: `${process.env.APP_URL}/api/cakto/webhook`
      }
    };

    const checkout = await Cakto.createCheckout(checkoutData);
    
    console.log('Checkout criado:', checkout.id);
    
    res.json({ 
      success: true, 
      checkoutUrl: checkout.url,
      checkoutId: checkout.id 
    });
  } catch (err) {
    console.error('Create checkout error:', err.response?.data || err.message);
    res.status(500).json({ error: err.message, details: err.response?.data });
  }
});

module.exports = router;