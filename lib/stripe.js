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
    
    console.log('Creating Stripe checkout:', {
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
              description: `${proxyCount} proxies${discount > 0 ? ` - ${Math.round(discount * 100)}% desconto` : ''}`
            },
            unit_amount: discountedAmount
          },
          quantity: proxyCount
        }
      ],
      mode: 'payment',
      success_url: successUrl || `${process.env.APP_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${process.env.APP_URL}/cancel.html`,
      metadata: {
        proxy_count: proxyCount.toString(),
        period: period,
        discount: discount.toString()
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