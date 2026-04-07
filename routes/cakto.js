const express = require('express');
const router = express.Router();
const Cakto = require('../lib/cakto');

let cachedOffers = null;
let offersCacheTime = 0;
const OFFERS_CACHE_DURATION = 5 * 60 * 1000;

async function getCachedOffers() {
  if (cachedOffers && Date.now() - offersCacheTime < OFFERS_CACHE_DURATION) {
    return cachedOffers;
  }
  
  try {
    const offers = await Cakto.getAllOffers();
    cachedOffers = offers;
    offersCacheTime = Date.now();
    return offers;
  } catch (err) {
    console.error('Error fetching offers:', err.message);
    return cachedOffers || [];
  }
}

router.post('/webhook', express.json(), async (req, res) => {
  try {
    console.log('=== CAKTO WEBHOOK RECEIVED ===');
    
    if (!process.env.CAKTO_CLIENT_ID || !process.env.CAKTO_CLIENT_SECRET) {
      console.log('Cakto not configured, skipping webhook');
      return res.json({ received: true, status: 'skipped' });
    }

    const event = req.body;
    console.log('Cakto webhook received:', JSON.stringify(event, null, 2));

    const eventType = event.event;
    const orderId = event.order_id || event.order?.id;

    if (!orderId) {
      console.log('No order_id in webhook');
      return res.json({ received: true });
    }

    if (eventType === 'order.completed' || eventType === 'payment.approved') {
      console.log(`Order ${orderId} completed, need to process manually`);
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: 'Webhook processing error' });
  }
});

router.get('/setup', async (req, res) => {
  try {
    console.log('=== CAKTO SETUP ===');
    
    if (!process.env.CAKTO_CLIENT_ID) {
      return res.status(500).json({ error: 'Cakto not configured' });
    }

    const offers = await Cakto.getAllOffers();
    console.log('Available offers:', JSON.stringify(offers, null, 2));
    
    res.json({
      success: true,
      message: 'Cakto integration ready',
      offers: offers
    });
  } catch (err) {
    console.error('Setup error:', err.response?.data || err.message);
    res.status(500).json({ 
      error: err.message,
      details: err.response?.data
    });
  }
});

router.get('/test-api', async (req, res) => {
  try {
    console.log('=== TESTING CAKTO API ===');
    
    const offers = await getCachedOffers();
    console.log('Offers found:', offers.length);
    
    res.json({
      success: true,
      message: 'Cakto API connection successful',
      offersCount: offers.length,
      offers: offers.slice(0, 5)
    });
  } catch (err) {
    console.error('Test API error:', err.response?.data || err.message);
    res.status(500).json({ 
      error: err.message, 
      details: err.response?.data,
      status: err.response?.status 
    });
  }
});

router.post('/create-checkout', express.json(), async (req, res) => {
  try {
    const { proxyCount, email, whatsapp, period } = req.body;
    
    console.log('=== CREATE CHECKOUT REQUEST ===');
    console.log('Body:', req.body);
    
    if (!email) {
      return res.status(400).json({ error: 'Email é obrigatório' });
    }
    
    if (!proxyCount || proxyCount < 1) {
      return res.status(400).json({ error: 'Quantidade de proxies inválida' });
    }

    if (!process.env.CAKTO_CLIENT_ID) {
      return res.status(500).json({ 
        error: 'Cakto não configurado',
        message: 'Configure as credenciais da Cakto no ambiente'
      });
    }

    const isAnnual = period === 'annual';
    const targetPrice = isAnnual ? 299.00 : 29.90;
    
    const offers = await getCachedOffers();
    console.log('Looking for offer with price:', targetPrice);
    console.log('Available offers:', JSON.stringify(offers, null, 2));
    
    let selectedOffer = null;
    
    if (offers && offers.results) {
      const offerList = offers.results;
      
      for (const offer of offerList) {
        const offerPrice = parseFloat(offer.price || 0);
        console.log(`Checking offer ${offer.id}: ${offer.name} - R$ ${offerPrice}`);
        
        if (Math.abs(offerPrice - targetPrice) < 0.01) {
          selectedOffer = offer;
          console.log(`Found matching offer: ${offer.id}`);
          break;
        }
      }
    }
    
    if (!selectedOffer) {
      console.log('No matching offer found, returning test URL');
      return res.json({ 
        success: true, 
        checkoutUrl: `https://pay.cakto.com.br/checkout/test?email=${encodeURIComponent(email)}&amount=${targetPrice}&proxies=${proxyCount}&period=${period}`,
        message: 'Checkout de teste - oferta não encontrada na Cakto',
        testMode: true,
        note: 'Configure uma oferta na Cakto com o preço de R$ ' + targetPrice.toFixed(2)
      });
    }
    
    const webhookUrl = `${process.env.APP_URL || 'https://fastproxyoriginal-3yul.vercel.app'}/api/cakto/webhook`;
    
    const checkoutData = {
      offer: selectedOffer.id,
      email: email,
      customer_data: {
        email: email,
        phone: whatsapp || ''
      },
      quantity: proxyCount,
      extra_data: {
        proxy_count: proxyCount,
        period: period,
        whatsapp: whatsapp || ''
      }
    };
    
    console.log('Creating checkout with data:', JSON.stringify(checkoutData, null, 2));
    
    try {
      const checkout = await Cakto.createCheckout(checkoutData);
      console.log('Checkout created:', JSON.stringify(checkout, null, 2));
      
      if (checkout.payment_url || checkout.url) {
        return res.json({ 
          success: true, 
          checkoutUrl: checkout.payment_url || checkout.url,
          checkoutId: checkout.id
        });
      }
      
      return res.json({
        success: true,
        checkoutUrl: `https://pay.cakto.com.br/checkout/${checkout.id}`,
        checkoutId: checkout.id,
        message: 'Checkout criado com sucesso'
      });
    } catch (caktoErr) {
      console.error('Cakto checkout error:', caktoErr.response?.data || caktoErr.message);
      
      return res.json({ 
        success: true, 
        checkoutUrl: `https://pay.cakto.com.br/checkout/test?email=${encodeURIComponent(email)}&amount=${targetPrice}&proxies=${proxyCount}&period=${period}`,
        message: 'Fallback para checkout de teste',
        testMode: true,
        error: caktoErr.message
      });
    }
  } catch (err) {
    console.error('Create checkout error:', err);
    res.status(500).json({ error: err.message, details: err.response?.data });
  }
});

module.exports = router;