// server.js — Gopayment Storefront (standalone, self-hosted, non-serverless)
// One Node HTTP server: store + own QRIS payment gateway + SQLite DB.
// Mirrors Gopayment's architecture but fully independent (own DB, own gateway).
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import crypto from 'node:crypto';
import { store, genId } from './db.js';
import { buildDynamicQris, qrisToDataUrl, validateQrisString } from './qris.js';
import GoPayMerchant from './gobiz.js';

const PORT = process.env.PORT || 8787;
const PUB_DIR = process.env.PUB_DIR || './public';
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

// ── Payment helpers ─────────────────────────────────────────────────────────
function qrisSurcharge() { return Math.floor(Math.random() * 100) + 1; }

async function createPaymentSession({ nama, tentang, nominal, orderId }) {
  const qrisStr = process.env.QRIS_STRING;
  if (!qrisStr) throw new Error('QRIS_STRING belum dikonfigurasi.');
  const amount = parseInt(nominal, 10);
  if (!(amount > 0)) throw new Error('Nominal tidak valid.');
  const surcharge = qrisSurcharge();
  const totalBayar = amount + surcharge;
  const dynamic = buildDynamicQris(qrisStr, totalBayar);
  const qrisDataUrl = await qrisToDataUrl(dynamic);
  const id = genId('SES').toUpperCase();
  store.insertPaymentSession({
    id, nama, tentang, nominal: amount, surcharge, totalBayar, status: 'pending', orderId, createdAt: new Date().toISOString(),
  });
  return { sessionId: id, qrisDataUrl, nominal: amount, surcharge, totalBayar };
}

// poll gobiz and confirm any pending sessions whose total_bayar matches a tx
async function pollAndConfirm() {
  if (!process.env.GOPAY_EMAIL || !process.env.GOPAY_PASSWORD || !process.env.QRIS_STRING) {
    return; // not configured — skip (development mode)
  }
  const merchant = new GoPayMerchant();
  try {
    const txs = await merchant.getSuccessfulTransactions({ days: 1, size: 60 });
    const pending = store.db.prepare(`SELECT * FROM payment_sessions WHERE status='pending'`).all()
      .filter(r => (Date.now() - Date.parse(r.created_at || 0)) < 10 * 60 * 1000);
    for (const tx of txs) {
      for (const s of pending) {
        if (tx.amount === s.total_bayar) {
          store.confirmPaymentSession(s.id, tx.txId, tx.waktu);
          fulfillOrderForSession(s.id, { txId: tx.txId, waktu: tx.waktu });
        }
      }
    }
    // timeout old pending
    store.db.prepare(`UPDATE payment_sessions SET status='timeout' WHERE status='pending' AND datetime('now') > datetime(created_at, '+10 minutes')`).run();
  } catch (e) {
    console.error('[Poll] error:', e.message);
  }
}

function fulfillOrderForSession(sessionId, payInfo) {
  const order = store.getOrderByPaymentSession(sessionId);
  if (!order || order.status === 'success') return;
  const product = store.getProduct(order.productId);
  // idempotent + rollback safety
  const fulfill = (order, product) => {
    if (product.type === 'akun') {
      const sold = store.sellOneAccount(product.id, order.id);
      if (!sold) { store.updateOrderStatus(order.id, 'failed', 'Stok habis saat pemrosesan.'); return; }
      // update order with account
      store.updateOrderFulfilled({ ...order, status: 'success', account: sold.content, txId: payInfo.txId, paidAt: payInfo.waktu || new Date().toISOString(), error: null, link: null, fileUrl: null, fileName: null });
    } else if (product.type === 'link') {
      store.updateOrderFulfilled({ ...order, status: 'success', link: product.link, account: null, fileUrl: null, fileName: null, txId: payInfo.txId, paidAt: payInfo.waktu || new Date().toISOString(), error: null });
    } else if (product.type === 'file') {
      store.updateOrderFulfilled({ ...order, status: 'success', fileUrl: product.file_url, fileName: product.file_name, account: null, link: null, txId: payInfo.txId, paidAt: payInfo.waktu || new Date().toISOString(), error: null });
    } else {
      store.updateOrderStatus(order.id, 'success', null);
    }
  };
  fulfill(Object.assign({}, order), product);
}

// period poller (every 8s while server runs)
setInterval(() => pollAndConfirm().catch(() => {}), 8000);

// ── HTTP routing ────────────────────────────────────────────────────────────
async function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
  });
}

const json = (res, status, obj) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};

function mime(p) {
  return { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' }[extname(p)] || 'application/octet-stream';
}

function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? 'store.html' : pathname.replace(/^\//, '');
  let file = join(PUB_DIR, relative);
  if (!file.startsWith(normalize(PUB_DIR))) return json(res, 403, { error: 'Forbidden' });
  if (!existsSync(file) || statSync(file).isDirectory()) {
    if (!existsSync(file)) return json(res, 404, { error: 'Not found' });
    file = join(file, 'index.html');
    if (!existsSync(file)) return json(res, 404, { error: 'Not found' });
  }
  res.writeHead(200, { 'Content-Type': mime(file) });
  res.end(readFileSync(file));
}

// admin auth (cookie)
const ADMIN_COOKIE = 'gpayment_admin';
function getAdminToken(req) {
  const m = /gpayment_admin=([^;]+)/.exec(req.headers.cookie || '');
  return m ? decodeURIComponent(m[1]) : null;
}
const adminTokens = new Map(); // token -> {createdAt}
function isAdmin(req) {
  const t = getAdminToken(req);
  if (!t) return false;
  const rec = adminTokens.get(t);
  if (!rec) return false;
  if (Date.now() - rec.createdAt > 8 * 3600 * 1000) { adminTokens.delete(t); return false; }
  return true;
}

// ── Route handlers ──────────────────────────────────────────────────────────
const handlers = {
  'GET /api/catalog': async (req, res, u) => {
    const id = u.searchParams.get('id');
    if (id) {
      const p = store.getProduct(id);
      if (!p || !p.active) return json(res, 404, { error: 'Produk tidak ditemukan.' });
      const stock = p.type === 'akun' ? store.countAvailableAccounts(id) : 999999;
      return json(res, 200, { success: true, product: cleanProduct(p, stock) });
    }
    const list = store.listProductsActive().map(p => cleanProduct(p, p.type === 'akun' ? store.countAvailableAccounts(p.id) : 999999));
    return json(res, 200, { success: true, products: list });
  },

  'POST /api/order': async (req, res, u) => {
    const action = u.searchParams.get('action') || 'create';
    const body = await readBody(req);
    if (action === 'create') {
      const { productId, buyerName, buyerEmail } = body;
      const product = store.getProduct(String(productId || '').toUpperCase());
      if (!product) return json(res, 404, { error: 'Produk tidak ditemukan.' });
      if (!product.active) return json(res, 410, { error: 'Produk tidak aktif.' });
      if (product.type === 'akun' && store.countAvailableAccounts(product.id) <= 0) return json(res, 410, { error: 'Stok habis.' });
      let payment;
      try {
        payment = await createPaymentSession({ nama: buyerName || product.name, tentang: `${product.name} — Order`, nominal: product.price, orderId: null });
      } catch (e) { return json(res, 500, { error: e.message }); }
      const oid = genId('ORD').toUpperCase();
      store.insertOrder({
        id: oid, productId: product.id, productName: product.name, price: product.price, type: product.type,
        buyerName: buyerName || '', buyerEmail: buyerEmail || '', paymentSessionId: payment.sessionId, status: 'pending', createdAt: new Date().toISOString(),
      });
      store.setPaymentSessionOrder(payment.sessionId, oid);
      const payUrl = `${APP_URL}/pay/${payment.sessionId}`;
      return json(res, 200, { success: true, orderId: oid, sessionId: payment.sessionId, paymentUrl: payUrl, qrisDataUrl: payment.qrisDataUrl });
    }
    return json(res, 404, { error: 'Action not found' });
  },

  'GET /api/order': async (req, res, u) => {
    const action = u.searchParams.get('action');
    if (action === 'status') {
      const orderId = String(u.searchParams.get('orderId') || '').toUpperCase();
      const order = store.getOrder(orderId);
      if (!order) return json(res, 404, { error: 'Order tidak ditemukan.' });
      return json(res, 200, { success: true, order: sanitize(order) });
    }
    if (action === 'resolve') {
      const sid = String(u.searchParams.get('sessionId') || '').toUpperCase();
      const o = store.getOrderByPaymentSession(sid);
      return json(res, 200, { success: true, orderId: o?.id || null });
    }
    return json(res, 404, { error: 'Action not found' });
  },

  'GET /api/pay/:id': async (req, res, u, path) => {
    const sid = (path[1] || '').toUpperCase();
    const ps = store.getPaymentSession(sid);
    if (!ps) return json(res, 404, { error: 'Sesi tidak ditemukan.' });
    return json(res, 200, { sessionId: sid, nama: ps.nama, tentang: ps.tentang, nominal: ps.nominal, surcharge: ps.surcharge, totalBayar: ps.total_bayar, status: ps.status, orderId: ps.order_id, paidAt: ps.waktu || null });
  },

  'GET /api/admin': async (req, res, u) => {
    const action = u.searchParams.get('action') || 'verify';
    if (action === 'verify') return json(res, isAdmin(req) ? 200 : 401, { ok: isAdmin(req) });
    if (action === 'login') return json(res, 405, { error: 'Use POST' });
    if (action === 'logout') { if (getAdminToken(req)) adminTokens.delete(getAdminToken(req)); return json(res, 200, { success: true }); }
    return json(res, 404, { error: 'Action not found' });
  },
  'POST /api/admin': async (req, res, u) => {
    const action = u.searchParams.get('action') || 'login';
    const body = await readBody(req);
    if (action === 'login') {
      const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
      if (!ADMIN_PASSWORD) return json(res, 500, { error: 'ADMIN_PASSWORD belum dikonfigurasi.' });
      if (body.password !== ADMIN_PASSWORD) return json(res, 401, { error: 'Password salah.' });
      const token = crypto.randomUUID();
      adminTokens.set(token, { createdAt: Date.now() });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': `${ADMIN_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800` });
      res.end(JSON.stringify({ success: true }));
      return;
    }
    return json(res, 404, { error: 'Action not found' });
  },

  'GET /api/admin-products': async (req, res, u) => {
    if (!isAdmin(req)) return json(res, 401, { error: 'Sesi admin tidak ditemukan.' });
    const action = u.searchParams.get('action') || 'list';
    if (action === 'list') {
      const prods = store.listProducts().map(p => ({ ...p, stock: p.type === 'akun' ? store.countAvailableAccounts(p.id) : 999999 }));
      return json(res, 200, { success: true, products: prods });
    }
    if (action === 'get') {
      const p = store.getProduct(String(u.searchParams.get('id') || '').toUpperCase());
      if (!p) return json(res, 404, { error: 'Produk tidak ditemukan.' });
      return json(res, 200, { success: true, product: { ...p, _stock: p.type === 'akun' ? store.countAvailableAccounts(p.id) : 999999, _items: p.type === 'akun' ? store.listAccountItems(p.id) : [] } });
    }
    return json(res, 404, { error: 'Action not found' });
  },
  'POST /api/admin-products': async (req, res, u) => {
    if (!isAdmin(req)) return json(res, 401, { error: 'Sesi admin tidak ditemukan.' });
    const action = u.searchParams.get('action');
    const body = await readBody(req);
    if (action === 'create') {
      const { name, description, price, type, image, category, link, fileUrl, fileName } = body;
      if (!name || !price || !type) return json(res, 400, { error: 'name, price, type wajib.' });
      if (!['akun', 'link', 'file'].includes(type)) return json(res, 400, { error: 'type harus akun/link/file.' });
      const id = genId('P').toUpperCase();
      store.insertProduct({ id, name, description: description || '', price: parseInt(price, 10), type, image: image || '', category: category || '', link: type === 'link' ? link || '' : '', fileUrl: type === 'file' ? fileUrl || '' : '', fileName: type === 'file' ? fileName || '' : '', active: 1, createdAt: new Date().toISOString() });
      return json(res, 200, { success: true, product: store.getProduct(id) });
    }
    if (action === 'update') {
      const p = store.getProduct(String(body.id || '').toUpperCase());
      if (!p) return json(res, 404, { error: 'Produk tidak ditemukan.' });
      const upd = { ...p, name: body.name ?? p.name, description: body.description ?? p.description, price: body.price !== undefined ? parseInt(body.price, 10) : p.price, image: body.image ?? p.image, category: body.category ?? p.category, active: body.active !== undefined ? (body.active ? 1 : 0) : p.active };
      if (body.type && body.type !== p.type) { upd.type = body.type; upd.link = body.type === 'link' ? (body.link || '') : ''; upd.fileUrl = body.type === 'file' ? (body.fileUrl || '') : ''; upd.fileName = body.type === 'file' ? (body.fileName || '') : ''; }
      store.updateProduct(upd);
      return json(res, 200, { success: true, product: store.getProduct(p.id) });
    }
    if (action === 'delete') {
      store.deleteProduct(String(body.id || '').toUpperCase());
      return json(res, 200, { success: true });
    }
    if (action === 'add-accounts') {
      const pid = String(body.productId || '').toUpperCase();
      const p = store.getProduct(pid);
      if (!p || p.type !== 'akun') return json(res, 400, { error: 'product id tidak valid.' });
      let added = 0;
      for (const line of Array.isArray(body.accounts) ? body.accounts : []) {
        if (!line || !String(line).trim()) continue;
        store.insertAccountItem(genId('ACC').toUpperCase(), pid, String(line).trim());
        added++;
      }
      return json(res, 200, { success: true, added, total: store.listAccountItems(pid).length });
    }
    if (action === 'remove-account') {
      const pid = String(body.productId || '').toUpperCase();
      const p = store.getProduct(pid);
      if (!p) return json(res, 404, { error: 'Produk tidak ditemukan.' });
      const itemId = String(body.itemId || '').toUpperCase();
      const items = store.listAccountItems(pid);
      const it = items.find(i => i.id === itemId);
      if (!it) return json(res, 404, { error: 'Akun tidak ditemukan.' });
      if (it.sold) return json(res, 400, { error: 'Akun sudah terjual, tidak bisa dihapus.' });
      store.deleteAccountItem(itemId);
      return json(res, 200, { success: true });
    }
    return json(res, 404, { error: 'Action not found' });
  },
};

function cleanProduct(p, stock) {
  return { id: p.id, name: p.name, description: p.description, price: p.price, type: p.type, image: p.image, category: p.category, stock, active: Boolean(p.active) };
}

function sanitize(order) {
  const base = { id: order.id, productName: order.product_name, type: order.type, status: order.status, createdAt: order.created_at, paidAt: order.paid_at, price: order.price, error: order.error || null, paymentUrl: null };
  if (order.status === 'success') {
    if (order.type === 'akun') base.account = order.account;
    if (order.type === 'link') base.link = order.link;
    if (order.type === 'file') base.fileUrl = order.file_url;
    if (order.file_name) base.fileName = order.file_name;
    if (order.tx_id) base.txId = order.tx_id;
  }
  return base;
}

// ── Server ──────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, APP_URL);
  const path = u.pathname.split('/').filter(Boolean);
  try {
    // dynamic :id routes for /api/pay/:id
    if (path[0] === 'api' && path[1] === 'pay' && path[2] && req.method === 'GET') {
      return await handlers['GET /api/pay/:id'](req, res, u, path);
    }
    // api routes (no auth for catalog/order/pay; admin/admin-products require cookie)
    for (const key of Object.keys(handlers)) {
      const [m, route] = key.split(' ');
      const routePath = route.split('/').filter(Boolean);
      if (req.method === m && routePath.length === path.length && routePath.every((seg, i) => seg === path[i] || seg.startsWith(':'))) {
        return await handlers[key](req, res, u, path);
      }
    }
    // static
    serveStatic(req, res, u.pathname);
  } catch (e) {
    console.error('[Server] error:', e);
    if (!res.headersSent) json(res, 500, { error: 'Internal error: ' + e.message });
  }
});

server.listen(PORT, () => {
  console.log(`✅ Gopayment Store running at ${APP_URL} (port ${PORT})`);
  console.log(`   DB: ${process.env.DATA_DIR || './data'}/store.db`);
  console.log(`   Payment: ${process.env.GOPAY_EMAIL ? 'GoBiz configured' : 'NO GOPAY (development mode — QRIS not confirmed)'}`);
});
