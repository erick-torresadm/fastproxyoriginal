const PROXYSELLER_API = 'https://proxy-seller.com/personal/api/v1';
const API_KEY = process.env.PROXYSELLER_API_KEY;

class ProxySeller {
  constructor(apiKey = API_KEY) {
    this.apiKey = apiKey;
  }

  async request(endpoint, method = 'GET', body = null) {
    const url = `${PROXYSELLER_API}/${this.apiKey}/${endpoint}`;
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    
    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const data = await response.json();
    
    if (data.status === 'error') {
      throw new Error(data.errors?.[0]?.message || 'ProxySeller API Error');
    }

    return data;
  }

  async getReference(type = 'ipv6') {
    return this.request(`reference/list/${type}`);
  }

  async getAllReferences() {
    return this.request('reference/list');
  }

  async calculateOrder({ type, countryId, periodId, quantity, protocol = 'HTTPS', targetSectionId, targetId, paymentId = 1 }) {
    const body = {
      type,
      countryId,
      periodId,
      quantity,
      protocol,
      paymentId
    };

    if (targetSectionId) body.targetSectionId = targetSectionId;
    if (targetId) body.targetId = targetId;

    return this.request('order/calc', 'POST', body);
  }

  async makeOrder({ type, countryId, periodId, quantity, protocol = 'HTTPS', targetSectionId, targetId, paymentId = 1 }) {
    const body = {
      type,
      countryId,
      periodId,
      quantity,
      protocol,
      paymentId
    };

    if (targetSectionId) body.targetSectionId = targetSectionId;
    if (targetId) body.targetId = targetId;

    return this.request('order/make', 'POST', body);
  }

  async getProxyList(type = 'ipv6', params = {}) {
    let endpoint = `proxy/list/${type}`;
    const queryString = new URLSearchParams(params).toString();
    if (queryString) endpoint += `?${queryString}`;
    return this.request(endpoint);
  }

  async getProxyListAll() {
    return this.request('proxy/list');
  }

  async extendProxy(orderNumber, periodId = '1m') {
    return this.request('proxy/extend', 'POST', { orderNumber, periodId });
  }

  async getBalance() {
    return this.request('balance');
  }

  async createAuth(orderNumber, generateAuth = 'Y') {
    return this.request('auth/add', 'POST', { orderNumber, generateAuth });
  }

  async createAuthByIp(orderNumber, ip) {
    return this.request('auth/add/ip', 'POST', { orderNumber, ip });
  }

  async listAuths(orderNumber) {
    return this.request('auth/list');
  }

  async changeAuth(authId, active) {
    return this.request('auth/change', 'POST', { id: authId, active });
  }

  async deleteAuth(authId) {
    return this.request('auth/delete', 'DELETE', { id: authId });
  }

  getPeriodDays(periodId) {
    const periods = {
      '1w': 7,
      '2w': 14,
      '1m': 30,
      '2m': 60,
      '3m': 90,
      '6m': 180,
      '9m': 270,
      '12m': 365
    };
    return periods[periodId] || 30;
  }

  async getIPv6Price(countryId = 20554, periodId = '1m', quantity = 10) {
    return this.calculateOrder({
      type: 'ipv6',
      countryId,
      periodId,
      quantity,
      protocol: 'HTTPS',
      targetSectionId: 8,
      targetId: 1768
    });
  }

  async buyIPv6(countryId = 20554, periodId = '1m', quantity = 10) {
    return this.makeOrder({
      type: 'ipv6',
      countryId,
      periodId,
      quantity,
      protocol: 'HTTPS',
      targetSectionId: 8,
      targetId: 1768
    });
  }
}

module.exports = new ProxySeller();
