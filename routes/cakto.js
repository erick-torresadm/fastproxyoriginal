const express = require('express');
const router = express.Router();

console.log('=== LOADING CAKTO ROUTES ===');

const PRICES = {
  monthly: 29.90,
  annual: 299.00
};

const CHECKOUT_URLS = {
  monthly: 'https://pay.cakto.com.br/esevgrr_841175',
  annual: 'https://pay.cakto.com.br/33zyxkf_841177'
};

router.post('/create-checkout', express.json(), async (req, res) => {
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
    
    const baseUrl = CHECKOUT_URLS[period];
    if (!baseUrl) {
      return res.status(400).json({ error: 'Período inválido' });
    }
    
    const pricePerUnit = PRICES[period];
    const totalPrice = proxyCount * pricePerUnit;
    
    console.log('Price calculation:');
    console.log('  - Price per unit:', pricePerUnit);
    console.log('  - Quantity:', proxyCount);
    console.log('  - Total:', totalPrice);
    
    const checkoutUrl = `${baseUrl}?email=${encodeURIComponent(email)}&quantity=${proxyCount}&total=${totalPrice}`;
    
    console.log('Final checkout URL:', checkoutUrl);
    
    res.json({
      success: true,
      checkoutUrl: checkoutUrl,
      total: totalPrice,
      quantity: proxyCount,
      period: period,
      pricePerUnit: pricePerUnit,
      message: 'Checkout redirecionado com sucesso'
    });
  } catch (err) {
    console.error('Create checkout error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.get('/prices', async (req, res) => {
  res.json({
    success: true,
    prices: PRICES,
    checkoutUrls: CHECKOUT_URLS
  });
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
