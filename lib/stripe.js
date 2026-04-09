console.log('=== LOADING STRIPE LIB ===');

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

console.log('STRIPE_LIB loaded successfully');

const STRIPE_PRICES = {
  monthly: {
    priceId: null,
    amount: 2990,
    name: 'Proxy IPv6 Mensal'
  },
  annual: {
    priceId: null,
    amount: 29900,
    name: 'Proxy IPv6 Anual'
  }
};

module.exports = {
  stripe,
  
  PRICES: STRIPE_PRICES,
  
  calculatePrice(period, proxyCount) {
    const priceData = STRIPE_PRICES[period];
    if (!priceData) return null;
    
    return {
      unitAmount: priceData.amount,
      total: priceData.amount * proxyCount,
      currency: 'brl',
      name: `${proxyCount}x ${priceData.name}`
    };
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
    
    const total = priceData.amount * proxyCount;
    
    console.log('Creating Stripe checkout:', {
      email,
      proxyCount,
      period,
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
              description: `${proxyCount} proxies - ${period === 'annual' ? 'Plano Anual' : 'Plano Mensal'}`
            },
            unit_amount: priceData.amount
          },
          quantity: 1
        }
      ],
      mode: 'payment',
      success_url: successUrl || `${process.env.APP_URL || 'https://fastproxyv3.vercel.app'}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${process.env.APP_URL || 'https://fastproxyv3.vercel.app'}/cancel.html`,
      metadata: {
        proxy_count: proxyCount.toString(),
        period: period,
        price_per_unit: (priceData.amount / 100).toString()
      }
    });
    
    console.log('Stripe session created:', session.id);
    
    return session;
  },
  
  async retrieveSession(sessionId) {
    return stripe.checkout.sessions.retrieve(sessionId);
  },
  
  async createWebhookEvent(payload, signature) {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new Error('Webhook secret not configured');
    }
    
    return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  }
};