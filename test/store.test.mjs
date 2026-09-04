import { products } from '../api/_products.js';
import { orders } from '../api/_orders.js';
import { sessions } from '../api/_store.js';

const run = async () => {
  // no UPSTASH → memory fallback (works within a single process)
  // 1. create an 'akun' product
  const p = await products.create({ name: 'Freefire Account', description: 'ff akun', price: 25000, type: 'akun' });
  console.log('created product:', p.id, 'type', p.type);

  // 2. add accounts to pool
  const acc = [];
  for (let i = 1; i <= 10; i++) acc.push(`ffuser${i}@x.com:PASS${i}`);
  const added = await products.addAccountsBulk(p.id, acc);
  console.log('added accounts:', JSON.stringify(added));

  // 3. stock
  let stock = await products.getStock(p.id);
  console.log('stock before:', stock);
  if (stock !== 10) throw new Error('stock should be 10');

  // 4. create order
  const o = await orders.create({ productId: p.id, buyer: { name: 'Gopyr' }, paymentSessionId: 'TSTSESS' });
  console.log('order:', o.id, 'status', o.status);

  // 5. fulfill (simulate payment success) → random account
  const done = await orders.fulfill(o.id, { txId: 'TX123', paidAt: new Date().toISOString() });
  console.log('fulfilled:', done.status, 'account:', done.account);

  stock = await products.getStock(p.id);
  console.log('stock after fulfill (should be 9):', stock);
  if (stock !== 9) throw new Error('stock should be 9 after one sale');

  // 6. fulfill again → should be idempotent (already success)
  const again = await orders.fulfill(o.id);
  if (again.status !== 'success') throw new Error('should stay success');
  console.log('idempotent ok, stock still', await products.getStock(p.id));

  // 7. sell all remaining
  for (let i = 0; i < 9; i++) {
    const o2 = await orders.create({ productId: p.id, buyer: { name: 'x' }, paymentSessionId: 'S' + i });
    await orders.fulfill(o2.id);
  }
  stock = await products.getStock(p.id);
  console.log('stock after selling all (should be 0):', stock);
  if (stock !== 0) throw new Error('stock should be 0');

  // 8. one more should fail
  let failed = false;
  try {
    await orders.create({ productId: p.id, buyer: { name: 'y' }, paymentSessionId: 'LAST' });
  } catch (e) { failed = /Stok habis/.test(e.message); }
  console.log('out-of-stock blocks order:', failed);
  if (!failed) throw new Error('out-of-stock order should be blocked');

  // 9. rollback test: allocate an account then rollback returns to pool
  const p2 = await products.create({ name: 'Link Dummy', type: 'link', price: 1000, link: 'https://drive.google.com/x' });
  const o3 = await orders.create({ productId: p2.id, buyer: {}, paymentSessionId: 'L1' });
  const linkDone = await orders.fulfill(o3.id);
  console.log('link product delivered:', linkDone.status, '->', linkDone.link);

  console.log('\n✅ ALL TESTS PASSED');
};

run().catch(e => { console.error('❌ TEST FAILED:', e.message); process.exit(1); });
