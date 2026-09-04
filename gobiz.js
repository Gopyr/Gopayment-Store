// gobiz.js — GoBiz merchant payment poll (self-hosted, non-serverless).
// Mirrors Gopayment's _gobiz.js but WITHOUT moment-timezone (uses Intl)
// and WITHOUT the EventEmitter watcher (server does on-demand polling).
import crypto from 'node:crypto';

const BASE_URL = 'https://api.gobiz.co.id';
const CLIENT_ID = 'go-biz-web-new';

let _cachedToken = null;
let _cachedMerchantId = null;

function getAuthHeaders(uniqueId, accessToken) {
  return {
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'id',
    'Authentication-Type': 'go-id',
    'Authorization': accessToken ? `Bearer ${accessToken}` : 'Bearer',
    'Connection': 'keep-alive',
    'Content-Type': 'application/json',
    'Gojek-Country-Code': 'ID',
    'Gojek-Timezone': 'Asia/Jakarta',
    'Origin': 'https://portal.gofoodmerchant.co.id',
    'Referer': 'https://portal.gofoodmerchant.co.id/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    'X-AppVersion': 'platform-v3.107.0-94ce5d57',
    'X-Platform': 'Web',
    'X-User-Type': 'merchant',
    'X-User-Locale': 'en-US',
    'x-appId': 'go-biz-web-dashboard',
    'x-uniqueid': uniqueId,
  };
}

function wib(iso) {
  try { return new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(iso)); }
  catch { return iso; }
}

export default class GoPayMerchant {
  _initialized = false;

  constructor(opts = {}) {
    this.token = opts.token || _cachedToken || null;
    this.merchantId = opts.merchantId || _cachedMerchantId || null;
  }

  async _isTokenValid(token) {
    try {
      const res = await fetch(`${BASE_URL}/v1/merchants/search`, {
        method: 'POST',
        headers: getAuthHeaders(crypto.randomUUID(), token),
        body: JSON.stringify({ from: 0, to: 1, _source: ['id'] }),
      });
      return res.status !== 401;
    } catch { return false; }
  }

  async _doLogin() {
    const email = process.env.GOPAY_EMAIL;
    const password = process.env.GOPAY_PASSWORD;
    if (!email || !password) throw new Error('GOPAY_EMAIL/GOPAY_PASSWORD belum diisi.');
    const uid = crypto.randomUUID();
    const headers = getAuthHeaders(uid);
    await fetch(`${BASE_URL}/goid/login/request`, { method: 'POST', headers, body: JSON.stringify({ email, login_type: 'password', client_id: CLIENT_ID }) });
    const tokenRes = await fetch(`${BASE_URL}/goid/token`, {
      method: 'POST', headers,
      body: JSON.stringify({ client_id: CLIENT_ID, grant_type: 'password', data: { email, password } }),
    });
    const d = await tokenRes.json();
    if (d.errors?.length) throw new Error(`Login gagal: ${d.errors[0].message}`);
    this.token = d.access_token;
    _cachedToken = this.token;
  }

  async _resolveMerchant() {
    const res = await fetch(`${BASE_URL}/v1/merchants/search`, {
      method: 'POST',
      headers: getAuthHeaders(crypto.randomUUID(), this.token),
      body: JSON.stringify({ from: 0, to: 50, _source: ['id', 'merchant_name'] }),
    });
    const d = await res.json();
    let list = [];
    if (Array.isArray(d)) list = d;
    else if (d?.merchants && Array.isArray(d.merchants)) list = d.merchants;
    else if (d?.hits?.hits && Array.isArray(d.hits.hits)) list = d.hits.hits.map(h => h._source || h);
    else if (d?.data && Array.isArray(d.data)) list = d.data;
    if (!list.length) throw new Error('Tidak ada merchant terasosiasi.');
    this.merchantId = list[0].id || list[0].merchant_id;
    _cachedMerchantId = this.merchantId;
  }

  async init() {
    if (this._initialized) return;
    if (!this.token) this.token = _cachedToken;
    if (!this.token || !(await this._isTokenValid(this.token))) await this._doLogin();
    if (!this.merchantId) { this.merchantId = _cachedMerchantId; }
    if (!this.merchantId) await this._resolveMerchant();
    this._initialized = true;
  }

  // Pull recent successful QRIS transactions; returns array of {amountRupiah, txId, waktu, issuer}
  async getSuccessfulTransactions({ days = 1, size = 50 } = {}) {
    await this.init();
    const start = new Date(Date.now() - days * 86400000).toISOString();
    const end = new Date().toISOString();
    const url = new URL('https://api.gojekapi.com/merchant-analytics/v2/merchants/transactions');
    url.searchParams.append('from', '0');
    url.searchParams.append('size', String(size));
    url.searchParams.append('statuses', 'SETTLEMENT,CAPTURE');
    url.searchParams.append('payment_types', 'QRIS');
    url.searchParams.append('start_time', start);
    url.searchParams.append('end_time', end);
    url.searchParams.append('merchant_ids', this.merchantId);

    const doFetch = async (tok) => {
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          accept: 'application/json, text/plain, */*',
          'accept-language': 'id-ID,id;q=0.9',
          'authentication-type': 'go-id',
          authorization: `Bearer ${tok}`,
          'content-type': 'application/json',
        },
      });
      return res;
    };

    let response = await doFetch(this.token);
    if (response.status === 401) {
      this._initialized = false; this.token = null; _cachedToken = null;
      await this.init();
      response = await doFetch(this.token);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    const txs = Array.isArray(body.transactions) ? body.transactions : [];
    return txs.map(tx => ({
      amount: typeof tx.gross_amount === 'number' ? tx.gross_amount / 100 : 0,
      txId: tx.id ?? tx.order_id ?? null,
      waktu: wib(tx.transaction_time),
      issuer: tx.qris_provider_aspi_issuer || null,
      paymentType: tx.payment_type || 'QRIS',
    })).filter(t => t.amount > 0);
  }
}
