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
  },
  onepurchase: {
    basic: { amount: 9900, name: '5 Proxies IPv6' },
    popular: { amount: 17900, name: '10 Proxies IPv6' },
    pro: { amount: 29900, name: '20 Proxies IPv6' }
  }
};

module.exports = {
  stripe,
  
  PRICES: STRIPE_PRICES,
  
  calculatePrice(period, proxyCount) {
    if (period === 'onepurchase') {
      const tiers = { 5: 9900, 10: 17900, 20: 29900 };
      const amount = tiers[proxyCount] || 9900;
      return {
        unitAmount: amount / proxyCount,
        total: amount,
        currency: 'brl',
        name: `${proxyCount}x Proxies IPv6`
      };
    }
    
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
    
    let lineItem, total;
    
    if (period === 'onepurchase') {
      const tiers = { 5: 9900, 10: 17900, 20: 29900 };
      total = tiers[proxyCount] || 9900;
      
      lineItem = {
        price_data: {
          currency: 'brl',
          product_data: {
            name: `${proxyCount}x Proxies IPv6 FastProxy`,
            description: 'Compra única - entrega imediata após confirmação'
          },
          unit_amount: total
        },
        quantity: 1
      };
    } else {
      const priceData = STRIPE_PRICES[period];
      if (!priceData) {
        throw new Error('Período inválido');
      }
      total = priceData.amount * proxyCount;
      
      lineItem = {
        price_data: {
          currency: 'brl',
          product_data: {
            name: `${proxyCount}x Proxy IPv6 FastProxy (${period === 'annual' ? 'Anual' : 'Mensal'})`,
            description: `${proxyCount} proxies - ${period === 'annual' ? 'Plano Anual' : 'Plano Mensal'}`
          },
          unit_amount: priceData.amount
        },
        quantity: proxyCount
      };
    }
    
    console.log('Creating Stripe checkout:', {
      email,
      proxyCount,
      period,
      total: total / 100
    });
    
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [lineItem],
      mode: 'payment',
      success_url: successUrl || `${process.env.APP_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${process.env.APP_URL}/cancel.html`,
      metadata: {
        proxy_count: proxyCount.toString(),
        period: period
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