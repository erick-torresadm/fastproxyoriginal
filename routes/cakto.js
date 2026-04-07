const express = require('express');
const router = express.Router();

console.log('=== LOADING CAKTO ROUTES ===');

let Cakto;
try {
  Cakto = require('../lib/cakto');
  console.log('✅ Cakto lib loaded');
} catch (err) {
  console.error('❌ Error loading Cakto lib:', err.message);
  Cakto = null;
}

const PRICES = {
  monthly: 29.90,
  annual: 299.00
};

let cachedProductId = null;
let cachedOffers = {};
let offerCacheTime = {};
const OFFER_CACHE_DURATION = 5 * 60 * 1000;

async function ensureProduct() {
  if (cachedProductId) {
    return cachedProductId;
  }
  
  try {
    console.log('Checking for existing products...');
    const products = await Cakto.getProducts();
    const productList = products?.results || [];
    
    if (productList.length > 0) {
      cachedProductId = productList[0].id;
      console.log('Using existing product:', cachedProductId);
      return cachedProductId;
    }
    
    console.log('No products found, creating new product...');
    const product = await Cakto.createProduct({
      name: 'Proxy IPv6 FastProxy',
      description: 'Proxy IPv6 de alta performance para redes sociais',
      price: 29.90,
      status: 'active'
    });
    
    cachedProductId = product.id;
    console.log('Created product:', cachedProductId);
    return cachedProductId;
  } catch (err) {
    console.error('Error ensuring product:', err.message);
    throw err;
  }
}

async function getOrCreateOffer(productId, period, quantity, pricePerUnit) {
  const totalPrice = quantity * pricePerUnit;
  const cacheKey = `${period}_${quantity}`;
  
  if (cachedOffers[cacheKey] && offerCacheTime[cacheKey] && (Date.now() - offerCacheTime[cacheKey]) < OFFER_CACHE_DURATION) {
    console.log('Using cached offer:', cacheKey);
    return cachedOffers[cacheKey];
  }
  
  try {
    const offerName = `${quantity}x Proxy IPv6 - FastProxy (${period === 'annual' ? 'Anual' : 'Mensal'})`;
    
    console.log(`Creating offer: ${offerName} - R$ ${totalPrice.toFixed(2)}`);
    
    const offerData = {
      name: offerName,
      price: totalPrice,
      product: productId,
      type: 'unique',
      status: 'active',
      default: true
    };
    
    console.log('Offer data:', JSON.stringify(offerData, null, 2));
    
    const offer = await Cakto.createOffer(offerData);
    
    cachedOffers[cacheKey] = offer;
    offerCacheTime[cacheKey] = Date.now();
    
    console.log('Created offer:', offer.id, offer.name, offer.price);
    return offer;
  } catch (err) {
    console.error('Error creating offer:', err.response?.data || err.message);
    throw err;
  }
}

async function createCheckoutForOffer(offerId, email, whatsapp, extraData) {
  try {
    console.log(`Creating checkout for offer ${offerId}...`);
    
    const checkoutData = {
      offer: offerId,
      email: email,
      customer_data: {
        email: email,
        phone: whatsapp || ''
      },
      extra_data: extraData
    };
    
    console.log('Checkout data:', JSON.stringify(checkoutData, null, 2));
    
    const checkout = await Cakto.createCheckout(checkoutData);
    
    console.log('Checkout created:', JSON.stringify(checkout, null, 2));
    
    let checkoutUrl = checkout.payment_url || checkout.url;
    if (!checkoutUrl && checkout.id) {
      checkoutUrl = `https://pay.cakto.com.br/checkout/${checkout.id}`;
    }
    
    return { checkout, checkoutUrl };
  } catch (err) {
    console.error('Error creating checkout:', err.response?.data || err.message);
    throw err;
  }
}

router.post('/create-checkout', express.json(), async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { proxyCount, email, whatsapp, period } = req.body;
    
    console.log('=== CREATE CHECKOUT REQUEST ===');
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
    
    if (!Cakto) {
      return res.json({ 
        success: false, 
        error: 'Cakto não configurado'
      });
    }
    
    const pricePerUnit = PRICES[period] || PRICES.monthly;
    const totalPrice = proxyCount * pricePerUnit;
    
    console.log('Price calculation:');
    console.log('  - Price per unit:', pricePerUnit);
    console.log('  - Quantity:', proxyCount);
    console.log('  - Total:', totalPrice);
    
    const productId = await ensureProduct();
    const offer = await getOrCreateOffer(productId, period, proxyCount, pricePerUnit);
    const { checkout, checkoutUrl } = await createCheckoutForOffer(
      offer.id, 
      email, 
      whatsapp,
      {
        proxy_count: proxyCount,
        period: period,
        price_per_unit: pricePerUnit,
        total_price: totalPrice,
        whatsapp: whatsapp || ''
      }
    );
    
    const duration = Date.now() - startTime;
    console.log(`Checkout created in ${duration}ms`);
    
    res.json({
      success: true,
      checkoutUrl: checkoutUrl,
      checkoutId: checkout.id,
      total: totalPrice,
      quantity: proxyCount,
      period: period,
      message: 'Checkout criado com sucesso'
    });
  } catch (err) {
    const duration = Date.now() - startTime;
    console.error('Create checkout error:', err.message);
    console.error(`Failed after ${duration}ms`);
    
    res.status(500).json({
      success: false,
      error: err.message,
      details: err.response?.data
    });
  }
});

router.get('/test-api', async (req, res) => {
  try {
    console.log('=== TEST API ===');
    
    const products = await Cakto.getProducts();
    const productList = products?.results || [];
    console.log('Products found:', productList.length);
    
    const offers = await Cakto.getAllOffers();
    const offerList = offers?.results || [];
    console.log('Offers found:', offerList.length);
    
    res.json({
      success: true,
      message: 'API connection OK',
      products: productList.map(p => ({ id: p.id, name: p.name })),
      offersCount: offerList.length,
      prices: PRICES
    });
  } catch (err) {
    console.error('Test API error:', err.message);
    res.status(500).json({ 
      success: false,
      error: err.message 
    });
  }
});

router.post('/webhook', express.json(), async (req, res) => {
  try {
    console.log('=== WEBHOOK RECEIVED ===');
    console.log(JSON.stringify(req.body, null, 2));
    
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err.message);
    res.status(500).json({ error: 'Webhook error' });
  }
});

module.exports = router;
