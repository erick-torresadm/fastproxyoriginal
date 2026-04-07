const axios = require('axios');

const CAKTO_BASE_URL = process.env.CAKTO_BASE_URL || 'https://api.cakto.com.br';
const CAKTO_CLIENT_ID = process.env.CAKTO_CLIENT_ID;
const CAKTO_CLIENT_SECRET = process.env.CAKTO_CLIENT_SECRET;

let accessToken = null;
let tokenExpiry = null;

async function getAccessToken() {
  if (!CAKTO_CLIENT_ID || !CAKTO_CLIENT_SECRET) {
    throw new Error('Cakto credentials not configured');
  }
  
  if (accessToken && tokenExpiry && Date.now() < tokenExpiry) {
    return accessToken;
  }

  try {
    const querystring = require('querystring');
    const res = await axios.post(`${CAKTO_BASE_URL}/public_api/token/`, 
      querystring.stringify({
        client_id: CAKTO_CLIENT_ID,
        client_secret: CAKTO_CLIENT_SECRET,
      }), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    accessToken = res.data.access_token;
    tokenExpiry = Date.now() - (res.data.expires_in * 1000) + (5 * 60 * 1000);
    return accessToken;
  } catch (err) {
    console.error('Cakto auth error:', err.response?.data || err.message);
    throw new Error('Failed to authenticate with Cakto: ' + (err.response?.data?.message || err.message));
  }
}

async function caktoRequest(method, endpoint, data = null) {
  const token = await getAccessToken();
  
  const config = {
    method,
    url: `${CAKTO_BASE_URL}${endpoint}`,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };

  if (data) config.data = data;

  try {
    const res = await axios(config);
    return res.data;
  } catch (err) {
    console.error('Cakto request error:', err.response?.data || err.message);
    throw err;
  }
}

const Cakto = {
  async getOrders(filters = {}) {
    const params = new URLSearchParams(filters).toString();
    return caktoRequest('GET', `/public_api/orders/${params ? '?' + params : ''}`);
  },

  async getOrder(orderId) {
    return caktoRequest('GET', `/public_api/orders/${orderId}/`);
  },

  async getProducts(filters = {}) {
    const params = new URLSearchParams(filters).toString();
    return caktoRequest('GET', `/public_api/products/${params ? '?' + params : ''}`);
  },

  async getProduct(productId) {
    return caktoRequest('GET', `/public_api/products/${productId}/`);
  },

  async createProduct(productData) {
    return caktoRequest('POST', '/public_api/products/', productData);
  },

  async updateProduct(productId, productData) {
    return caktoRequest('PATCH', `/public_api/products/${productId}/`, productData);
  },

  async getOffers(productId, filters = {}) {
    const params = new URLSearchParams(filters).toString();
    return caktoRequest('GET', `/public_api/offers/${params ? '?' + params : ''}`);
  },

  async getAllOffers(filters = {}) {
    return caktoRequest('GET', `/public_api/offers/`);
  },

  async createOffer(offerData) {
    return caktoRequest('POST', '/public_api/offers/', offerData);
  },

  async updateOffer(offerId, offerData) {
    return caktoRequest('PATCH', `/public_api/offers/${offerId}/`, offerData);
  },

  async deleteOffer(offerId) {
    return caktoRequest('DELETE', `/public_api/offers/${offerId}/`);
  },

  async refundOrder(orderId) {
    return caktoRequest('POST', `/public_api/orders/${orderId}/refund/`);
  },

  async createCheckout(checkoutData) {
    return caktoRequest('POST', '/public_api/checkouts/', checkoutData);
  },

  async getCheckout(checkoutId) {
    return caktoRequest('GET', `/public_api/checkouts/${checkoutId}/`);
  },

  async createWebhook(webhookData) {
    return caktoRequest('POST', '/public_api/webhooks/', webhookData);
  },

  async listWebhooks() {
    return caktoRequest('GET', '/public_api/webhooks/');
  },

  async deleteWebhook(webhookId) {
    return caktoRequest('DELETE', `/public_api/webhooks/${webhookId}/`);
  },

  getBaseUrl: () => CAKTO_BASE_URL
};

module.exports = Cakto;