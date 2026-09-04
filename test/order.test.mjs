// Set env BEFORE importing modules (module-level consts read process.env at load)
process.env.GOPAYMENT_APP_URL = 'https://fake-gopayment.vercel.app';
process.env.GATEWAY_API_KEY = 'test-gw-key';
process.env.ADMIN_PASSWORD = 'x';

// stub fetch to simulate the remote gateway
global.fetch = async (url, opts = {}) => {
  if (String(url).includes('/api/gateway/create')) {
    return { ok: true, status: 200, json: async () => ({ success: true, sessionId: 'GW123ABC', paymentUrl: 'https://fake-gopayment.vercel.app/pay/GW123ABC', totalBayar: 25123 }) };
  }
  if (String(url).includes('/api/gateway/status')) {
    return { ok: true, status: 200, json: async () => ({ success: true, confirmed: false, status: 'pending' }) };
  }
  return { ok: false, status: 404, json: async () => ({ error: 'no route' }) };
};

const { default: orderHandler } = await import('../api/order.js');
const { default: catalogHandler } = await import('../api/catalog.js');
const { products } = await import('../api/_products.js');

function makeReq(query, method, body) {
  return { query, method, headers: { host: 'store.vercel.app', 'x-forwarded-proto': 'https' }, body, socket: { remoteAddress: '127.0.0.1' } };
}
function makeRes() {
  const res = { _status: 200, _json: null, headers: {} };
  res.status = function (c) { this._status = c; return this; };
  res.setHeader = function (k, v) { this.headers[k] = v; return this; };
  res.json = function (o) { this._json = o; return this; };
  return res;
}

const run = async () => {
  const p = await products.create({ name: 'FF', price: 25000, type: 'akun' });
  await products.addAccountsBulk(p.id, ['a:1', 'b:2', 'c:3']);

  let res = makeRes();
  await catalogHandler(makeReq({}, 'GET'), res);
  console.log('catalog stock:', res._json.products[0].stock, '(should be 3)');
  if (res._json.products[0].stock !== 3) throw new Error('catalog stock mismatch');

  res = makeRes();
  await orderHandler(makeReq({ action: 'create' }, 'POST', { productId: p.id, buyerName: 'Gopyr' }), res);
  console.log('create ->', res._status, 'orderId:', res._json.orderId, 'gwSession:', res._json.gatewaySessionId, 'payUrl:', res._json.paymentUrl, 'ERR:', res._json.error || '');
  if (res._status !== 200 || !res._json.orderId) throw new Error('create failed');
  if (res._json.paymentUrl !== 'https://fake-gopayment.vercel.app/pay/GW123ABC') throw new Error('paymentUrl not from gateway');
  if (res._json.gatewaySessionId !== 'GW123ABC') throw new Error('gatewaySessionId mismatch');
  const orderId = res._json.orderId;

  res = makeRes();
  await catalogHandler(makeReq({}, 'GET'), res);
  console.log('stock after order (still 3):', res._json.products[0].stock);
  if (res._json.products[0].stock !== 3) throw new Error('stock should remain 3 before payment');

  // gateway callback (payhook)
  res = makeRes();
  await orderHandler(makeReq({ action: 'payhook' }, 'POST', { sessionId: 'GW123ABC', txId: 'TID', paidAt: new Date().toISOString() }), res);
  console.log('payhook ->', res._status, res._json.status);

  res = makeRes();
  await orderHandler(makeReq({ action: 'status', orderId }, 'GET'), res);
  console.log('status after pay ->', res._json.order.status, '| has account:', Boolean(res._json.order.account));
  if (res._json.order.status !== 'success' || !res._json.order.account) throw new Error('should be success with account');

  res = makeRes();
  await catalogHandler(makeReq({}, 'GET'), res);
  console.log('stock after sale (2):', res._json.products[0].stock);
  if (res._json.products[0].stock !== 2) throw new Error('stock should be 2');

  res = makeRes();
  await orderHandler(makeReq({ action: 'resolve', sessionId: 'GW123ABC' }, 'GET'), res);
  console.log('resolve -> orderId:', res._json.orderId, '(should match', orderId + ')');
  if (res._json.orderId !== orderId) throw new Error('resolve mismatch');

  console.log('\n✅ STOREFRONT ORDER FLOW TEST PASSED');
};
run().catch(e => { console.error('❌ FAIL:', e.message); process.exit(1); });
