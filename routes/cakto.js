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

const PRODUCT_IDS = {
  monthly: 'ea93f8eb-c118-4579-8ad6-d12862addba7',
  annual: '9af84c23-f246-4ee6-825a-20851d67227d'
};

let cachedOffers = {};
let offerCacheTime = {};
const OFFER_CACHE_DURATION = 5 * 60 * 1000;

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
    console.log('Product ID:', productId);
    
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
    console.error('Error creating offer:', err.message);
    console.error('Response data:', err.response?.data);
    console.error('Status:', err.response?.status);
    
    const errorDetail = err.response?.data?.detail || err.response?.data?.message || err.message;
    throw new Error(`Erro ao criar oferta: ${errorDetail}`);
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
    console.error('Error creating checkout:', err.message);
    console.error('Response data:', err.response?.data);
    console.error('Status:', err.response?.status);
    
    const errorDetail = err.response?.data?.detail || err.response?.data?.message || err.message;
    throw new Error(`Erro ao criar checkout: ${errorDetail}`);
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
    
    const productId = PRODUCT_IDS[period];
    if (!productId) {
      return res.status(400).json({ error: 'Período inválido' });
    }
    
    const pricePerUnit = PRICES[period];
    const totalPrice = proxyCount * pricePerUnit;
    
    console.log('Price calculation:');
    console.log('  - Product ID:', productId);
    console.log('  - Price per unit:', pricePerUnit);
    console.log('  - Quantity:', proxyCount);
    console.log('  - Total:', totalPrice);
    
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
    console.log(`Final checkout URL: ${checkoutUrl}`);
    
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
    
    const proxyProducts = productList.filter(p => 
      p.name.toLowerCase().includes('proxy') || 
      p.name.toLowerCase().includes('1 mes') ||
      p.name.toLowerCase().includes('anual')
    );
    
    res.json({
      success: true,
      message: 'API connection OK',
      prices: PRICES,
      productIds: PRODUCT_IDS,
      products: proxyProducts.map(p => ({ id: p.id, name: p.name, price: p.price }))
    });
  } catch (err) {
    console.error('Test API error:', err.message);
    res.status(500).json({ 
      success: false,
      error: err.message 
    });
  }
});

router.get('/test-create-offer', async (req, res) => {
  try {
    const productId = PRODUCT_IDS.monthly;
    console.log('Testing offer creation...');
    console.log('Product ID:', productId);
    
    const testOffer = await Cakto.createOffer({
      name: 'TESTE - 1 Proxy (Debug)',
      price: 29.90,
      product: productId,
      type: 'unique',
      status: 'active',
      default: true
    });
    
    console.log('Test offer created:', testOffer);
    
    res.json({
      success: true,
      offer: testOffer
    });
  } catch (err) {
    console.error('Test offer error:', err.message);
    console.error('Response:', err.response?.data);
    console.error('Status:', err.response?.status);
    
    res.status(500).json({
      success: false,
      error: err.message,
      details: err.response?.data,
      status: err.response?.status
    });
  }
});

router.get('/test-create-checkout/:offerId', async (req, res) => {
  try {
    const { offerId } = req.params;
    console.log('Testing checkout creation for offer:', offerId);
    
    const checkoutData = {
      offer: offerId,
      email: 'test@test.com',
      customer_data: {
        email: 'test@test.com',
        phone: '11999999999'
      },
      extra_data: {
        test: true
      }
    };
    
    console.log('Checkout data:', JSON.stringify(checkoutData, null, 2));
    
    const checkout = await Cakto.createCheckout(checkoutData);
    
    console.log('Checkout created:', JSON.stringify(checkout, null, 2));
    
    res.json({
      success: true,
      checkout: checkout
    });
  } catch (err) {
    console.error('Test checkout error:', err.message);
    console.error('Response:', err.response?.data);
    console.error('Status:', err.response?.status);
    
    res.status(500).json({
      success: false,
      error: err.message,
      details: err.response?.data,
      status: err.response?.status
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
