console.log('=== LOADING STRIPE LIB ===');

// Detectar modo de teste
const IS_TEST_MODE = process.env.STRIPE_TEST_MODE === 'true' || process.env.STRIPE_SECRET_KEY?.startsWith('sk_test');

console.log('Stripe Mode:', IS_TEST_MODE ? '🧪 TESTE' : '🚀 PRODUÇÃO');
console.log('Using key:', process.env.STRIPE_SECRET_KEY ? 'sk_...' + process.env.STRIPE_SECRET_KEY.slice(-4) : 'NOT SET');

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const STRIPE_PRICES = {
  monthly: {
    priceId: process.env.STRIPE_PRICE_MONTHLY || null,
    amount: 2990, // R$ 29,90
    name: 'Proxy IPv6 Mensal'
  },
  annual: {
    priceId: process.env.STRIPE_PRICE_ANNUAL || null,
    amount: 29900, // R$ 299,00
    name: 'Proxy IPv6 Anual'
  }
};

// Remover onepurchase que não usamos mais

module.exports = {
  stripe,
  IS_TEST_MODE,
  
  PRICES: STRIPE_PRICES,
  
  calculatePrice(period, proxyCount) {
    const priceData = STRIPE_PRICES[period];
    if (!priceData) return null;
    
    const discount = this.getDiscount(proxyCount);
    const discountedAmount = Math.round(priceData.amount * (1 - discount));
    const total = discountedAmount * proxyCount;
    
    return {
      unitAmount: discountedAmount,
      total: total,
      currency: 'brl',
      name: `${proxyCount}x ${priceData.name}`,
      discount: discount
    };
  },
  
  getDiscount(proxyCount) {
    if (proxyCount >= 50) return 0.20;
    if (proxyCount >= 20) return 0.15;
    if (proxyCount >= 10) return 0.10;
    if (proxyCount >= 5) return 0.05;
    return 0;
  },
  
  async createCheckoutSession(params) {
    const {
      email,
      proxyCount,
      period,
      successUrl,
      cancelUrl
    } = params;
    
    const priceData = STRIPE_PRICES[period];
    if (!priceData) {
      throw new Error('Período inválido');
    }
    
    const discount = this.getDiscount(proxyCount);
    const discountedAmount = Math.round(priceData.amount * (1 - discount));
    const total = discountedAmount * proxyCount;
    
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    
    console.log('Creating Stripe checkout:', {
      mode: IS_TEST_MODE ? 'TEST' : 'PROD',
      email,
      proxyCount,
      period,
      discount: discount * 100 + '%',
      total: total / 100
    });
    
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [
        {
          price_data: {
            currency: 'brl',
            product_data: {
              name: `${proxyCount}x Proxy IPv6 FastProxy (${period === 'annual' ? 'Anual' : 'Mensal'})`,
              description: `${proxyCount} proxies${discount > 0 ? ` - ${Math.round(discount * 100)}% desconto` : ''}${IS_TEST_MODE ? ' [TESTE]' : ''}`
            },
            unit_amount: discountedAmount
          },
          quantity: proxyCount
        }
      ],
      mode: 'payment',
      success_url: `${appUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/cancel.html`,
      metadata: {
        proxy_count: proxyCount.toString(),
        period: period,
        discount: discount.toString(),
        test_mode: IS_TEST_MODE ? 'true' : 'false'
      }
    });
    
    console.log('Stripe session created:', session.id, IS_TEST_MODE ? '(TEST MODE)' : '');
    
    return session;
  },
  
  async retrieveSession(sessionId) {
    return stripe.checkout.sessions.retrieve(sessionId);
  },
  
  async createWebhookEvent(payload, signature) {
    const webhookSecret = IS_TEST_MODE 
      ? process.env.STRIPE_WEBHOOK_SECRET_TEST 
      : process.env.STRIPE_WEBHOOK_SECRET;
      
    if (!webhookSecret) {
      throw new Error('Webhook secret not configured');
    }
    
    return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  }
};
