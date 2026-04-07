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
    const offerList = offers?.results || offers || [];
    console.log('Offers found:', offerList.length);
    console.log('Offers data:', JSON.stringify(offers));
    
    res.json({
      success: true,
      message: 'Cakto API connection successful',
      offersCount: offerList.length,
      offers: offerList.slice(0, 5)
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
      return res.json({ 
        success: true, 
        checkoutUrl: `https://pay.cakto.com.br/checkout/test?email=${encodeURIComponent(email)}&amount=${proxyCount * 29.90}&proxies=${proxyCount}&period=${period}`,
        message: 'Checkout de teste',
        testMode: true
      });
    }

    const isAnnual = period === 'annual';
    const targetPrice = isAnnual ? 299.00 : 29.90;
    const totalPrice = proxyCount * targetPrice;
    
    try {
      const offers = await getCachedOffers();
      const offerList = offers?.results || offers || [];
      console.log('Looking for offer with price:', targetPrice);
      
      let selectedOffer = null;
      
      if (offerList.length > 0) {
        for (const offer of offerList) {
          const offerPrice = parseFloat(offer.price || 0);
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
          checkoutUrl: `https://pay.cakto.com.br/checkout/test?email=${encodeURIComponent(email)}&amount=${totalPrice}&proxies=${proxyCount}&period=${period}`,
          message: 'Checkout de teste - oferta não encontrada na Cakto',
          testMode: true,
          total: totalPrice
        });
      }
      
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
      
      const checkout = await Cakto.createCheckout(checkoutData);
      console.log('Checkout created:', JSON.stringify(checkout, null, 2));
      
      const checkoutUrl = checkout.payment_url || checkout.url || `https://pay.cakto.com.br/checkout/${checkout.id}`;
      
      return res.json({ 
        success: true, 
        checkoutUrl: checkoutUrl,
        checkoutId: checkout.id,
        message: 'Checkout criado com sucesso'
      });
    } catch (caktoErr) {
      console.error('Cakto error:', caktoErr.message);
      
      return res.json({ 
        success: true, 
        checkoutUrl: `https://pay.cakto.com.br/checkout/test?email=${encodeURIComponent(email)}&amount=${totalPrice}&proxies=${proxyCount}&period=${period}`,
        message: 'Fallback para checkout de teste',
        testMode: true,
        error: caktoErr.message
      });
    }
  } catch (err) {
    console.error('Create checkout error:', err);
    res.json({ 
      success: true, 
      checkoutUrl: `https://pay.cakto.com.br/checkout/test?email=${encodeURIComponent(req.body.email || 'test@test.com')}&amount=${(req.body.proxyCount || 1) * 29.90}&proxies=${req.body.proxyCount || 1}&period=${req.body.period || 'monthly'}`,
      message: 'Checkout de emergência',
      testMode: true
    });
  }
});

router.post('/create-offer', express.json(), async (req, res) => {
  try {
    const { name, price, productId } = req.body;
    
    console.log('=== CREATING OFFER ===');
    console.log('Name:', name, 'Price:', price, 'Product:', productId);
    
    if (!name || !price) {
      return res.status(400).json({ error: 'Nome e preço são obrigatórios' });
    }
    
    const offerData = {
      name: name,
      price: parseFloat(price),
      currency: 'BRL',
      product: productId,
      type: 'recurring',
      intervalType: 'month',
      interval: 1,
      status: 'active'
    };
    
    console.log('Creating offer with data:', JSON.stringify(offerData, null, 2));
    
    const offer = await Cakto.createOffer(offerData);
    console.log('Offer created:', JSON.stringify(offer, null, 2));
    
    res.json({
      success: true,
      offer: offer
    });
  } catch (err) {
    console.error('Create offer error:', err.response?.data || err.message);
    res.status(500).json({ 
      error: err.message,
      details: err.response?.data
    });
  }
});

router.post('/create-product', express.json(), async (req, res) => {
  try {
    const { name, description, price } = req.body;
    
    console.log('=== CREATING PRODUCT ===');
    
    const productData = {
      name: name || 'Proxy IPv6 FastProxy',
      description: description || 'Proxy IPv6 de alta performance',
      price: parseFloat(price) || 29.90,
      currency: 'BRL',
      status: 'active'
    };
    
    const product = await Cakto.createProduct(productData);
    console.log('Product created:', JSON.stringify(product, null, 2));
    
    res.json({
      success: true,
      product: product
    });
  } catch (err) {
    console.error('Create product error:', err.response?.data || err.message);
    res.status(500).json({ 
      error: err.message,
      details: err.response?.data
    });
  }
});

router.post('/create-default-offers', async (req, res) => {
  try {
    console.log('=== CREATING DEFAULT OFFERS ===');
    
    const products = await Cakto.getProducts();
    const productId = products?.results?.[0]?.id;
    
    if (!productId) {
      return res.status(400).json({ error: 'Nenhum produto encontrado na Cakto' });
    }
    
    console.log('Using product:', productId);
    
    const offerConfigs = [
      { name: 'Proxy Mensal - FastProxy', price: 29.90 },
      { name: 'Proxy Anual - FastProxy', price: 299.00 }
    ];
    
    const createdOffers = [];
    
    for (const config of offerConfigs) {
      const offerData = {
        name: config.name,
        price: config.price,
        currency: 'BRL',
        product: productId,
        type: 'unique',
        intervalType: 'lifetime',
        interval: 1,
        units: 1,
        default: true,
        status: 'active',
        trial_days: 0,
        max_retries: 3,
        retry_interval: 1,
        quantity_recurrences: -1,
        recurrence_period: 30
      };
      
      try {
        const offer = await Cakto.createOffer(offerData);
        createdOffers.push(offer);
        console.log('Created offer:', offer.name, offer.price);
      } catch (offerErr) {
        console.error('Error creating offer:', offerErr.response?.data || offerErr.message);
        createdOffers.push({ error: offerErr.response?.data?.message || offerErr.message, config: config });
      }
    }
    
    cachedOffers = null;
    offersCacheTime = 0;
    
    res.json({
      success: true,
      message: 'Ofertas criadas',
      offers: createdOffers
    });
  } catch (err) {
    console.error('Create default offers error:', err.message);
    res.status(500).json({ error: err.message, details: err.response?.data });
  }
});
      productId = product.id;
      console.log('Created new product:', JSON.stringify(product, null, 2));
    }
    
    const createdOffers = [];
    
    const offerConfigs = [
      { name: 'Proxy Mensal - FastProxy', price: 29.90 },
      { name: 'Proxy Anual - FastProxy', price: 299.00 }
    ];
    
    for (const config of offerConfigs) {
      try {
        console.log(`Creating offer: ${config.name} - R$ ${config.price}`);
        
        const offerData = {
          name: config.name,
          price: config.price,
          currency: 'BRL',
          product: productId,
          type: 'unique',
          intervalType: 'lifetime',
          interval: 1,
          units: 1,
          default: true,
          status: 'active',
          trial_days: 0,
          max_retries: 3,
          retry_interval: 1,
          quantity_recurrences: -1,
          recurrence_period: 30
        };
        
        console.log('Offer data:', JSON.stringify(offerData, null, 2));
        
        const offer = await Cakto.createOffer(offerData);
        createdOffers.push(offer);
        console.log('Created offer:', JSON.stringify(offer, null, 2));
      } catch (offerErr) {
        console.error('Error creating offer:', offerErr.response?.data || offerErr.message);
        createdOffers.push({ error: offerErr.response?.data || offerErr.message, config: config });
      }
    }
    }
    
    cachedOffers = null;
    offersCacheTime = 0;
    
    res.json({
      success: true,
      message: 'Ofertas criadas com sucesso',
      offers: createdOffers
    });
  } catch (err) {
    console.error('Create default offers error:', err.response?.data || err.message);
    res.status(500).json({ 
      error: err.message,
      details: err.response?.data
    });
  }
});

module.exports = router;