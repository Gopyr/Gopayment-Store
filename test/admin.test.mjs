import adminProductsHandler from '../api/admin-products.js';
import { adminStore } from '../api/_store.js';
import { products } from '../api/_products.js';

function makeReq(query, method, body, cookie) {
  return { query, method, headers: cookie ? { cookie } : {}, body, socket: { remoteAddress: '127.0.0.1' } };
}
function makeRes() {
  const res = { _status: 200, _json: null, headers: {} };
  res.status = function (c) { this._status = c; return this; };
  res.setHeader = function (k, v) { this.headers[k] = v; return this; };
  res.json = function (o) { this._json = o; return this; };
  return res;
}

const run = async () => {
  // create a valid admin session token
  const token = 'admintokentest123';
  await adminStore.createSession(token, { admin: true });
  const cookie = 'gpayment_admin=' + encodeURIComponent(token);

  // list (before): empty
  let res = makeRes();
  await adminProductsHandler(makeReq({ action: 'list' }, 'GET', null, cookie), res);
  console.log('list ->', res._status, 'count:', res._json.products.length);

  // create akun product
  res = makeRes();
  await adminProductsHandler(makeReq({ action: 'create' }, 'POST', { name: 'FF', price: 20000, type: 'akun', description: 'ff' }, cookie), res);
  console.log('create ->', res._status, res._json.product.id);
  const pid = res._json.product.id;
  if (!pid) throw new Error('create failed');

  // add accounts
  res = makeRes();
  await adminProductsHandler(makeReq({ action: 'add-accounts' }, 'POST', { productId: pid, accounts: ['u1:p1','u2:p2','u3:p3'] }, cookie), res);
  console.log('add-accounts ->', res._status, 'added:', res._json.added);
  if (res._json.added !== 3) throw new Error('should add 3');

  // get single
  res = makeRes();
  await adminProductsHandler(makeReq({ action: 'get', id: pid }, 'GET', null, cookie), res);
  console.log('get ->', res._status, 'stock:', res._json.product._stock);
  if (res._json.product._stock !== 3) throw new Error('stock should be 3');

  // update price + rename
  res = makeRes();
  await adminProductsHandler(makeReq({ action: 'update' }, 'POST', { id: pid, name: 'FF Premium', price: 30000 }, cookie), res);
  console.log('update ->', res._status, res._json.product.name, res._json.product.price);
  if (res._json.product.price !== 30000) throw new Error('price not updated');

  // remove one account
  const prod = await products.get(pid);
  console.log('prod resolved:', Boolean(prod), 'items:', prod ? prod.items.length : 'n/a');
  if (!prod) throw new Error('products.get returned null for ' + pid);
  const someItem = prod.items[0].id;
  res = makeRes();
  await adminProductsHandler(makeReq({ action: 'remove-account' }, 'POST', { productId: pid, itemId: someItem }, cookie), res);
  console.log('remove-account ->', res._status);

  res = makeRes();
  await adminProductsHandler(makeReq({ action: 'get', id: pid }, 'GET', null, cookie), res);
  console.log('stock after remove (2):', res._json.product._stock);
  if (res._json.product._stock !== 2) throw new Error('stock should be 2 after remove');

  // delete
  res = makeRes();
  await adminProductsHandler(makeReq({ action: 'delete' }, 'POST', { id: pid }, cookie), res);
  console.log('delete ->', res._status);

  // list now empty again
  const { sessions } = await import('../api/_store.js');
  // recreate clean-check via a fresh list
  res = makeRes();
  await adminProductsHandler(makeReq({ action: 'list' }, 'GET', null, cookie), res);
  console.log('list after delete -> count:', res._json.products.length);

  // auth check: no cookie -> 401
  res = makeRes();
  await adminProductsHandler(makeReq({ action: 'list' }, 'GET', null), res);
  console.log('no-auth ->', res._status);
  if (res._status !== 401) throw new Error('should 401 without cookie');

  console.log('\n✅ ADMIN TEST PASSED');
};
run().catch(e => { console.error('❌ FAIL:', e.message); process.exit(1); });
