console.log('=== LOADING STRIPE LIB ===');

const IS_TEST_MODE = process.env.STRIPE_TEST_MODE === 'true' || process.env.STRIPE_SECRET_KEY?.startsWith('sk_test');

console.log('Stripe Mode:', IS_TEST_MODE ? '🧪 TESTE' : '🚀 PRODUÇÃO');
console.log('Using key:', process.env.STRIPE_SECRET_KEY ? 'sk_...' + process.env.STRIPE_SECRET_KEY.slice(-4) : 'NOT SET');

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const PRICING = {
    ipv6: { sellPrice: 29.90, minQty: 10 },
    ipv4: { sellPrice: 39.90, minQty: 1 },
    isp: { sellPrice: 49.90, minQty: 1 },
    mobile: { sellPrice: 79.90, minQty: 1 }
};

const PERIODS = {
    '1w': { months: 0.25, discount: 0 },
    '2w': { months: 0.5, discount: 0 },
    '1m': { months: 1, discount: 0 },
    '2m': { months: 2, discount: 0.10 },
    '3m': { months: 3, discount: 0.15 },
    '6m': { months: 6, discount: 0.25 },
    '12m': { months: 12, discount: 0.35 }
};

module.exports = {
    stripe,
    IS_TEST_MODE,
    PRICING,
    PERIODS,

    calculatePrice(type, periodId, proxyCount, couponDiscount = 0) {
        const priceData = PRICING[type];
        if (!priceData) return null;
        
        const periodData = PERIODS[periodId];
        if (!periodData) return null;
        
        const basePrice = priceData.sellPrice;
        const periodMonths = periodData.months;
        const periodDiscount = periodData.discount;
        
        const subtotal = basePrice * periodMonths * proxyCount;
        const periodDiscountAmount = subtotal * periodDiscount;
        const afterPeriodDiscount = subtotal - periodDiscountAmount;
        const couponDiscountAmount = afterPeriodDiscount * couponDiscount;
        const total = afterPeriodDiscount - couponDiscountAmount;
        
        const unitPrice = total / proxyCount;
        
        return {
            unitAmount: Math.round(unitPrice * 100),
            total: Math.round(total * 100),
            currency: 'brl',
            name: `${proxyCount}x Proxy ${type.toUpperCase()} (${periodId})`,
            proxyCount,
            period: periodId,
            type,
            periodMonths,
            periodDiscount,
            couponDiscount,
            basePrice,
            unitPrice,
            total,
            testMode: IS_TEST_MODE
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
            type,
            period,
            quantity,
            successUrl,
            cancelUrl,
            couponDiscount = 0
        } = params;
        
        const priceData = PRICING[type];
        if (!priceData) {
            throw new Error('Tipo de proxy inválido');
        }
        
        const periodData = PERIODS[period];
        if (!periodData) {
            throw new Error('Período inválido');
        }
        
        const calculation = this.calculatePrice(type, period, quantity, couponDiscount);
        
        const appUrl = process.env.APP_URL || 'http://localhost:3000';
        
        console.log('Creating Stripe checkout:', {
            mode: IS_TEST_MODE ? 'TEST' : 'PROD',
            email,
            type,
            period,
            quantity,
            total: calculation.total / 100
        });
        
        const periodNames = {
            '1w': '1 Semana',
            '2w': '2 Semanas',
            '1m': '1 Mês',
            '2m': '2 Meses',
            '3m': '3 Meses',
            '6m': '6 Meses',
            '12m': '12 Meses'
        };
        
        const typeNames = {
            ipv6: 'IPv6',
            ipv4: 'IPv4',
            isp: 'ISP',
            mobile: 'Mobile 4G/5G'
        };
        
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            customer_email: email,
            line_items: [
                {
                    price_data: {
                        currency: 'brl',
                        product_data: {
                            name: `${quantity}x Proxy ${typeNames[type] || type} - ${periodNames[period] || period}`,
                            description: `${quantity} proxies ${typeNames[type] || type}${calculation.periodDiscount > 0 ? ` - ${Math.round(calculation.periodDiscount * 100)}% desconto período` : ''}${calculation.couponDiscount > 0 ? ` - ${Math.round(calculation.couponDiscount * 100)}% cupom` : ''}${IS_TEST_MODE ? ' [TESTE]' : ''}`
                        },
                        unit_amount: calculation.unitAmount
                    },
                    quantity: quantity
                }
            ],
            mode: 'payment',
            success_url: `${appUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${appUrl}/cancel.html`,
            metadata: {
                type: type,
                period: period,
                quantity: quantity.toString(),
                proxy_count: quantity.toString(),   // alias — process-payment reads this
                period_months: calculation.periodMonths.toString(),
                period_discount: calculation.periodDiscount.toString(),
                coupon_discount: couponDiscount.toString(),
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
