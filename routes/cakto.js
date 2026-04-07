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
    const { proxyCount, email, whatsapp, period } = req.body;
    
    if (!proxyCount || proxyCount < 1) {
      return res.status(400).json({ error: 'Quantidade de proxies inválida' });
    }

    console.log('=== CRIANDO CHECKOUT ===');
    console.log('Proxy count:', proxyCount);
    console.log('Email:', email);
    console.log('Period:', period || 'monthly');

    // First, get or create product
    let products = await Cakto.getProducts({ name: 'Proxy IPv6' });
    let productId;
    
    if (products.results && products.results.length > 0) {
      productId = products.results[0].id;
      console.log('Product found:', productId);
    } else {
      // Create product
      const newProduct = await Cakto.createProduct({
        name: 'Proxy IPv6',
        description: 'Proxies IPv6 de alta performance para redes sociais',
        price: 29.90,
        type: 'subscription',
        paymentMethods: ['pix', 'credit_card', 'boleto']
      });
      productId = newProduct.id;
      console.log('Product created:', productId);
    }

    // Now get or create offer based on period
    const isAnnual = period === 'annual';
    const offerPrice = isAnnual ? 299.00 : 29.90;
    const offerName = isAnnual ? 'Proxy IPv6 Anual' : 'Proxy IPv6 Mensal';
    
    let offers = await Cakto.getOffers({ product: productId });
    let offer;
    
    if (offers.results && offers.results.length > 0) {
      // Use first active offer
      offer = offers.results.find(o => o.status === 'active') || offers.results[0];
    } else {
      // Create offer
      offer = await Cakto.createOffer({
        name: offerName,
        price: offerPrice,
        product: productId,
        units: 1,
        status: 'active',
        type: isAnnual ? 'subscription' : 'subscription',
        intervalType: isAnnual ? 'year' : 'month',
        interval: 1,
        recurrence_period: isAnnual ? 365 : 30,
        quantity_recurrences: -1
      });
      console.log('Offer created:', offer.id);
    }

    // Now create checkout with offer
    const checkoutData = {
      offer: offer.id,
      customer: {
        email: email || '',
        phone: whatsapp || ''
      },
      configs: {
        redirect_after_payment: true,
        redirect_url: `${process.env.APP_URL || 'https://fastproxyoriginal-3yul.vercel.app'}/portal.html`,
        notification_url: `${process.env.APP_URL || 'https://fastproxyoriginal-3yul.vercel.app'}/api/cakto/webhook`
      }
    };

    console.log('Checkout data:', JSON.stringify(checkoutData, null, 2));
    
    const checkout = await Cakto.createCheckout(checkoutData);
    
    console.log('Checkout created:', checkout.id, checkout.url);
    
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