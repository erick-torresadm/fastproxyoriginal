const express = require('express');
const router = express.Router();

console.log('=== LOADING STRIPE ROUTES ===');

let Stripe;
try {
  Stripe = require('../lib/stripe');
  console.log('✅ Stripe lib loaded');
} catch (err) {
  console.error('❌ Error loading Stripe lib:', err.message);
  Stripe = null;
}

router.post('/create-checkout', express.json(), async (req, res) => {
  try {
    console.log('=== CREATE CHECKOUT REQUEST (STRIPE) ===');
    
    if (!Stripe || !Stripe.stripe) {
      console.error('Stripe lib not loaded');
      return res.status(500).json({ 
        success: false, 
        error: 'Stripe não configurado. Verifique as variáveis de ambiente.' 
      });
    }
    
    const { proxyCount, email, whatsapp, period } = req.body;
    
    console.log('proxyCount:', proxyCount);
    console.log('email:', email);
    console.log('whatsapp:', whatsapp);
    console.log('period:', period);
    
    if (!email) {
      return res.status(400).json({ error: 'Email é obrigatório' });
    }
    
    if (!proxyCount || proxyCount < 1 || proxyCount > 100) {
      return res.status(400).json({ error: 'Quantidade de proxies inválida (1-100)' });
    }
    
    if (!Stripe) {
      return res.status(500).json({ 
        success: false, 
        error: 'Stripe não configurado' 
      });
    }
    
    const priceCalculation = Stripe.calculatePrice(period, proxyCount);
    
    if (!priceCalculation) {
      return res.status(400).json({ error: 'Período inválido' });
    }
    
    console.log('Price calculation:');
    console.log('  - Period:', period);
    console.log('  - Quantity:', proxyCount);
    console.log('  - Unit price:', priceCalculation.unitAmount / 100);
    console.log('  - Total:', priceCalculation.total / 100);
    
    const appUrl = process.env.APP_URL || 'https://fastproxyoriginal.vercel.app';
    
    const session = await Stripe.createCheckoutSession({
      email: email,
      proxyCount: proxyCount,
      period: period,
      successUrl: `${appUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${appUrl}/cancel.html`
    });
    
    console.log('Checkout session created:', session.id);
    console.log('Checkout URL:', session.url);
    
    res.json({
      success: true,
      checkoutUrl: session.url,
      sessionId: session.id,
      total: priceCalculation.total / 100,
      currency: 'BRL',
      quantity: proxyCount,
      period: period,
      pricePerUnit: priceCalculation.unitAmount / 100,
      message: 'Checkout Stripe criado com sucesso'
    });
  } catch (err) {
    console.error('Create checkout error:', err.message);
    console.error('Stack:', err.stack);
    
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.get('/verify/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    if (!Stripe) {
      return res.status(500).json({ error: 'Stripe não configurado' });
    }
    
    const session = await Stripe.retrieveSession(sessionId);
    
    res.json({
      success: true,
      paymentStatus: session.payment_status,
      customerEmail: session.customer_email,
      amountTotal: session.amount_total / 100,
      metadata: session.metadata
    });
  } catch (err) {
    console.error('Verify session error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const sig = req.headers['stripe-signature'];
    
    console.log('=== STRIPE WEBHOOK RECEIVED ===');
    console.log('Signature present:', !!sig);
    
    let event;
    
    if (sig && process.env.STRIPE_WEBHOOK_SECRET) {
      event = await Stripe.createWebhookEvent(req.body, sig);
    } else {
      event = req.body;
    }
    
    console.log('Event type:', event.type);
    console.log('Event data:', JSON.stringify(event.data?.object, null, 2));
    
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      console.log('Payment completed for:', session.customer_email);
      console.log('Amount:', session.amount_total / 100);
      console.log('Metadata:', session.metadata);
    }
    
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/prices', async (req, res) => {
  if (!Stripe) {
    return res.status(500).json({ error: 'Stripe não configurado' });
  }
  
  res.json({
    success: true,
    prices: {
      monthly: Stripe.PRICES.monthly.amount / 100,
      annual: Stripe.PRICES.annual.amount / 100
    }
  });
});

module.exports = router;