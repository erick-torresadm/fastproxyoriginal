const axios = require('axios');

const CAKTO_BASE_URL = process.env.CAKTO_BASE_URL || 'https://api.cakto.com.br';
const CAKTO_CLIENT_ID = process.env.CAKTO_CLIENT_ID || 'demo';
const CAKTO_CLIENT_SECRET = process.env.CAKTO_CLIENT_SECRET || 'demo';

let accessToken = null;
let tokenExpiry = null;

async function getAccessToken() {
  if (accessToken && tokenExpiry && Date.now() < tokenExpiry) {
    return accessToken;
  }

  try {
    const res = await axios.post(`${CAKTO_BASE_URL}/oauth/token`, {
      grant_type: 'client_credentials',
      client_id: CAKTO_CLIENT_ID,
      client_secret: CAKTO_CLIENT_SECRET,
    }, {
      headers: { 'Content-Type': 'application/json' }
    });

    accessToken = res.data.access_token;
    tokenExpiry = Date.now() - (res.data.expires_in * 1000) + (5 * 60 * 1000);
    return accessToken;
  } catch (err) {
    console.error('Cakto auth error:', err.response?.data || err.message);
    throw err;
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

  const res = await axios(config);
  return res.data;
}

const Cakto = {
  async getOrders(filters = {}) {
    const params = new URLSearchParams(filters).toString();
    return caktoRequest('GET', `/api/orders/${params ? '?' + params : ''}`);
  },

  async getOrder(orderId) {
    return caktoRequest('GET', `/api/orders/${orderId}/`);
  },

  async getProducts(filters = {}) {
    const params = new URLSearchParams(filters).toString();
    return caktoRequest('GET', `/api/products/${params ? '?' + params : ''}`);
  },

  async getProduct(productId) {
    return caktoRequest('GET', `/api/products/${productId}/`);
  },

  async createProduct(productData) {
    return caktoRequest('POST', '/api/products/', productData);
  },

  async updateProduct(productId, productData) {
    return caktoRequest('PATCH', `/api/products/${productId}/`, productData);
  },

  async getOffers(productId, filters = {}) {
    const params = new URLSearchParams(filters).toString();
    return caktoRequest('GET', `/api/offers/${params ? '?' + params : ''}`);
  },

  async createOffer(offerData) {
    return caktoRequest('POST', '/api/offers/', offerData);
  },

  async updateOffer(offerId, offerData) {
    return caktoRequest('PATCH', `/api/offers/${offerId}/`, offerData);
  },

  async deleteOffer(offerId) {
    return caktoRequest('DELETE', `/api/offers/${offerId}/`);
  },

  async refundOrder(orderId) {
    return caktoRequest('POST', `/api/orders/${orderId}/refund/`);
  },

  async createWebhook(webhookData) {
    return caktoRequest('POST', '/api/webhooks/', webhookData);
  },

  async listWebhooks() {
    return caktoRequest('GET', '/api/webhooks/');
  },

  async deleteWebhook(webhookId) {
    return caktoRequest('DELETE', `/api/webhooks/${webhookId}/`);
  },

  getBaseUrl: () => CAKTO_BASE_URL
};

module.exports = Cakto;