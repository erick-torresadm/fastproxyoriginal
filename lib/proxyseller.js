const PROXYSELLER_API = 'https://proxy-seller.com/personal/api/v1';
const API_KEY = process.env.PROXYSELLER_API_KEY;

const DOLLAR_RATE = 5.5;

const PROXY_TYPES = {
  ipv6: {
    name: 'IPv6',
    description: 'Datacenter IPv6 - Ideal para scraping e automação',
    minQuantity: 10,
    countryId: 20554,
    customTargetName: 'Proxy for Web surfing',
    protocols: ['HTTPS', 'SOCKS5']
  },
  ipv4: {
    name: 'IPv4',
    description: 'Datacenter IPv4 individual - Alta compatibilidade',
    minQuantity: 1,
    countryId: 1279,
    customTargetName: 'Proxy for Web surfing',
    protocols: ['HTTPS', 'SOCKS5']
  },
  isp: {
    name: 'ISP',
    description: 'IP de provedor dedicado - Mistura datacenter + residencial',
    minQuantity: 1,
    countryId: 5236,
    customTargetName: 'Proxy for Web surfing',
    protocols: ['HTTPS', 'SOCKS5']
  },
  mobile: {
    name: 'Mobile 4G/5G',
    description: 'IP de operadoras móveis - Para redes sociais e apps',
    minQuantity: 1,
    countryId: 6594,
    mobileOperatorId: 'brazil_tim',
    protocols: ['HTTPS', 'SOCKS5']
  }
};

const PERIODS = {
  '1w': { name: '1 Semana', days: 7, months: 0.25, discount: 0 },
  '2w': { name: '2 Semanas', days: 14, months: 0.5, discount: 0 },
  '1m': { name: '1 Mês', days: 30, months: 1, discount: 0 },
  '2m': { name: '2 Meses', days: 60, months: 2, discount: 0.1 },
  '3m': { name: '3 Meses', days: 90, months: 3, discount: 0.15 },
  '6m': { name: '6 Meses', days: 180, months: 6, discount: 0.25 },
  '12m': { name: '12 Meses', days: 365, months: 12, discount: 0.35 }
};

const PRICING = {
  ipv6: {
    monthlyUSD: 0.16,
    sellPrice: 29.90
  },
  ipv4: {
    monthlyUSD: 1.80,
    sellPrice: 39.90
  },
  isp: {
    monthlyUSD: 1.80,
    sellPrice: 49.90
  },
  mobile: {
    monthlyUSD: 3.50,
    sellPrice: 79.90
  }
};

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

    try {
      const response = await fetch(url, options);
      const data = await response.json();
      
      if (data.status === 'error') {
        throw new Error(data.errors?.[0]?.message || 'ProxySeller API Error');
      }

      return data;
    } catch (err) {
      console.error('ProxySeller API Error:', err.message);
      throw err;
    }
  }

  async getReference(type = 'ipv6') {
    return this.request(`reference/list/${type}`);
  }

  async getAllReferences() {
    return this.request('reference/list');
  }

  async calculateOrder({ type, countryId, periodId, quantity, protocol = 'HTTPS', customTargetName }) {
    const proxyTypeConfig = PROXY_TYPES[type];
    if (!proxyTypeConfig && !customTargetName) {
      throw new Error(`Proxy type ${type} not configured. Provide customTargetName.`);
    }
    const body = {
      type,
      countryId: countryId || proxyTypeConfig?.countryId,
      periodId,
      quantity,
      protocol,
      customTargetName: customTargetName || proxyTypeConfig?.customTargetName
    };
    return this.request('order/calc', 'POST', body);
  }

  async makeOrder({ type, countryId, periodId, quantity, protocol = 'HTTPS', customTargetName }) {
    const proxyTypeConfig = PROXY_TYPES[type];
    if (!proxyTypeConfig && !customTargetName) {
      throw new Error(`Proxy type ${type} not configured. Provide customTargetName.`);
    }
    const body = {
      type,
      countryId: countryId || proxyTypeConfig?.countryId,
      periodId,
      quantity,
      protocol,
      paymentId: 1,
      customTargetName: customTargetName || proxyTypeConfig?.customTargetName
    };
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
    return PERIODS[periodId]?.days || 30;
  }

  getPricing(type, periodId, quantity) {
    const proxyType = PROXY_TYPES[type];
    const period = PERIODS[periodId];
    
    if (!proxyType || !period) {
      throw new Error('Tipo ou período inválido');
    }

    const minQty = proxyType.minQuantity || 1;
    const actualQty = Math.max(minQty, quantity || minQty);
    const basePrice = PRICING[type]?.monthlyUSD || 1;
    const sellPrice = PRICING[type]?.sellPrice || 29.90;
    
    const periodMonths = period.months || 1;
    const discount = period.discount || 0;
    
    const costUSD = basePrice * actualQty * periodMonths;
    const subtotalBRL = sellPrice * actualQty * periodMonths;
    const discountAmount = subtotalBRL * discount;
    const totalBRL = subtotalBRL - discountAmount;
    const pricePerUnit = totalBRL / actualQty;

    return {
      type,
      typeName: proxyType.name,
      description: proxyType.description,
      quantity: actualQty,
      minQuantity: minQty,
      periodId,
      periodName: period.name,
      periodDays: period.days,
      periodMonths,
      discount: discount * 100,
      discountAmount,
      costUSD,
      costBRL: costUSD * DOLLAR_RATE,
      sellPrice,
      subtotalBRL,
      pricePerUnit,
      totalBRL,
      currency: 'BRL'
    };
  }
}

module.exports = new ProxySeller();
module.exports.PROXY_TYPES = PROXY_TYPES;
module.exports.PERIODS = PERIODS;
module.exports.PRICING = PRICING;
