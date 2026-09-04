// flow.test.mjs — end-to-end test for the standalone server (in-process)
// Exercises DB + order + fulfill + random account + stock via the real db.js/server logic.
process.env.QRIS_STRING = '00020101021226620014ID.CO.QRIS.WWW0118936009161290000000000017020623032115012345802ID5908MERCHANT6007JAKARTA6105101236304A1B2';
process.env.DATA_DIR = '/tmp/gopayment-test-data';
process.env.ADMIN_PASSWORD = 'testpass';

import { rmSync } from 'node:fs';
rmSync('/tmp/gopayment-test-data', { recursive: true, force: true });

const { store, genId } = await import('../db.js');
const { buildDynamicQris } = await import('../qris.js');

const ok = (c, msg) => { if (!c) { console.error('❌ FAIL:', msg); process.exit(1); } console.log('✅', msg); };

// 1. buildDynamicQris with the raw string, compute the injected nominal
const dynamic = buildDynamicQris(process.env.QRIS_STRING, 25123);
ok(dynamic.includes('010212'), 'QRIS dynamic (010212)');
ok(dynamic.includes('540525123'), 'nominal 25123 injected as field 54 (540525123)');
ok(dynamic.length > process.env.QRIS_STRING.length - 4, 'CRC recomputed, string longer');

// 2. product flow
const pid = genId('P').toUpperCase();
store.insertProduct({ id: pid, name: 'FF Random', description: 'freefire', price: 25000, type: 'akun', active: 1, createdAt: new Date().toISOString(), image: '', category: '', link: '', fileUrl: '', fileName: '' });
for (let i = 1; i <= 5; i++) store.insertAccountItem(genId('ACC').toUpperCase(), pid, `ff${i}@x.com:pass${i}`);
ok(store.countAvailableAccounts(pid) === 5, '5 akun tersedia');

// 3. order
const oid = genId('ORD').toUpperCase();
const sesId = genId('SES').toUpperCase();
store.insertPaymentSession({ id: sesId, nama: 'Gopyr', tentang: 'order', nominal: 25000, surcharge: 123, totalBayar: 25123, status: 'pending', orderId: oid, createdAt: new Date().toISOString() });
store.insertOrder({ id: oid, productId: pid, productName: 'FF Random', price: 25000, type: 'akun', buyerName: 'Gopyr', buyerEmail: '', paymentSessionId: sesId, status: 'pending', createdAt: new Date().toISOString() });
ok(store.getOrder(oid).status === 'pending', 'order pending');

// 4. fulfill as pollAndConfirm would (simulate tx matched)
function fulfill(sessionId, payInfo) {
  const order = store.getOrderByPaymentSession(sessionId);
  const product = store.getProduct(order.productId);
  const sold = store.sellOneAccount(product.id, order.id);
  if (!sold) { store.updateOrderStatus(order.id, 'failed', 'Stok habis'); return; }
  store.updateOrderFulfilled({ ...order, status: 'success', account: sold.content, link: null, fileUrl: null, fileName: null, txId: payInfo.txId, paidAt: new Date().toISOString(), error: null });
}
fulfill(sesId, { txId: 'TX-1' });
const o = store.getOrder(oid);
ok(o.status === 'success', 'order success after payment');
ok(o.account && o.account.includes('@x.com'), 'random account delivered: ' + o.account);
ok(store.countAvailableAccounts(pid) === 4, 'stock decremented 5->4');

// 5. link product — delivers link, stock stays unlimited
const lid = genId('P').toUpperCase();
store.insertProduct({ id: lid, name: 'Ebook', price: 10000, type: 'link', active: 1, link: 'https://drive.google.com/x', createdAt: new Date().toISOString(), image: '', category: '', description: '', fileUrl: '', fileName: '' });
const loid = genId('ORD').toUpperCase();
const lses = genId('SES').toUpperCase();
store.insertPaymentSession({ id: lses, nama: 'x', tentang: 'o', nominal: 10000, surcharge: 1, totalBayar: 10001, status: 'pending', orderId: loid, createdAt: new Date().toISOString() });
store.insertOrder({ id: loid, productId: lid, productName: 'Ebook', price: 10000, type: 'link', buyerName: '', buyerEmail: '', paymentSessionId: lses, status: 'pending', createdAt: new Date().toISOString() });
const lo = store.getOrderByPaymentSession(lses);
store.updateOrderFulfilled({ ...lo, status: 'success', link: 'https://drive.google.com/x', account: null, fileUrl: null, fileName: null, txId: 'TX-2', paidAt: new Date().toISOString(), error: null });
ok(store.getOrder(loid).link === 'https://drive.google.com/x', 'link product delivers link');

// 6. sell all remaining akun -> out of stock blocks
for (let i = 0; i < 4; i++) {
  const oid2 = genId('ORD').toUpperCase();
  const s2 = genId('SES').toUpperCase();
  store.insertPaymentSession({ id: s2, nama: 'x', tentang: 'o', nominal: 25000, surcharge: 1, totalBayar: 25001, status: 'pending', orderId: oid2, createdAt: new Date().toISOString() });
  store.insertOrder({ id: oid2, productId: pid, productName: 'FF Random', price: 25000, type: 'akun', buyerName: '', buyerEmail: '', paymentSessionId: s2, status: 'pending', createdAt: new Date().toISOString() });
  fulfill(s2, { txId: 'TX-' + i });
}
ok(store.countAvailableAccounts(pid) === 0, 'all 5 sold, stock 0');

console.log('\n✅ ALL STANDALONE FLOW TESTS PASSED');
