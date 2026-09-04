// api/order.js — Storefront order endpoints
// Payment is delegated to the REMOTE Gopayment gateway (private repo).
// This file does NOT generate QRIS itself — it calls the gateway's
// /api/gateway/create and receives a paymentUrl to redirect the buyer to.
import { products } from './_products.js';
import { orders } from './_orders.js';
import { sessions } from './_store.js';

const GATEWAY_URL = process.env.GOPAYMENT_APP_URL; // e.g. https://gopayment.vercel.app
const GATEWAY_KEY = process.env.GATEWAY_API_KEY;   // shared secret issued by Gopayment

function requireGatewayConfig() {
  if (!GATEWAY_URL || !GATEWAY_KEY) {
    throw new Error('GOPAYMENT_APP_URL / GATEWAY_API_KEY belum dikonfigurasi.');
  }
}

async function handleCreate(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { productId, buyerName, buyerEmail } = req.body || {};
  if (!productId) return res.status(400).json({ error: 'productId wajib.' });

  let product;
  try { product = await products.get(productId); } catch { /* ignore */ }
  if (!product) return res.status(404).json({ error: 'Produk tidak ditemukan.' });
  if (!product.active) return res.status(410).json({ error: 'Produk tidak aktif.' });

  const stock = await products.getStock(product.id);
  if (stock <= 0) return res.status(410).json({ error: 'Stok habis.' });

  // our own payhook URL (to fulfill the order when gateway confirms)
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const callbackUrl = `${proto}://${host}/api/order?action=payhook`;

  // call the remote Gopayment gateway to create a QRIS session
  let payment;
  try {
    requireGatewayConfig();
    const res2 = await fetch(`${GATEWAY_URL}/api/gateway/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': GATEWAY_KEY,
      },
      body: JSON.stringify({
        nama: buyerName || product.name,
        tentang: `${product.name} — Order`,
        nominal: product.price,
        callbackUrl,
      }),
    });
    if (!res2.ok) {
      const j = await res2.json().catch(() => ({}));
      throw new Error(j.error || `Gateway error ${res2.status}`);
    }
    payment = await res2.json();
  } catch (e) {
    return res.status(502).json({ error: 'Gagal menghubungi payment gateway: ' + e.message });
  }

  let order;
  try {
    order = await orders.create({
      productId: product.id,
      buyer: { name: buyerName || '', email: buyerEmail || '' },
      paymentSessionId: payment.sessionId,
      gatewayPaymentUrl: payment.paymentUrl,
    });
    // stash orderId on the gateway session via our own store so payhook knows which order
    const local = { orderId: order.id, gatewaySessionId: payment.sessionId };
    await sessions.set('PAY:' + payment.sessionId, local);
  } catch (e) {
    return res.status(500).json({ error: 'Gagal membuat order: ' + e.message });
  }

  return res.status(200).json({
    success: true,
    orderId: order.id,
    gatewaySessionId: payment.sessionId,
    paymentUrl: payment.paymentUrl,
    message: 'Scan QRIS untuk membayar. Akun akan dialokasikan otomatis setelah pembayaran terkonfirmasi.',
  });
}

async function handleStatus(req, res) {
  const orderId = String(req.query?.orderId || req.body?.orderId || '').toUpperCase();
  if (!orderId) return res.status(400).json({ error: 'orderId wajib.' });
  let order = await orders.get(orderId);
  if (!order) return res.status(404).json({ error: 'Order tidak ditemukan.' });

  // if still pending, check the gateway's own status (it pulls merchant history live)
  if (order.status === 'pending' && order.paymentSessionId) {
    try {
      requireGatewayConfig();
      const r = await fetch(`${GATEWAY_URL}/api/gateway/status?sessionId=${encodeURIComponent(order.paymentSessionId)}`, {
        headers: { 'x-api-key': GATEWAY_KEY },
      });
      const j = await r.json().catch(() => ({}));
      if (j.confirmed || j.status === 'success') {
        order = await orders.fulfill(order.id, { txId: j.txId, paidAt: j.paidAt });
      } else if (j.status === 'timeout') {
        order = await orders.markTimeout(order.id);
      }
    } catch { /* gateway temporarily unreachable; leave pending */ }
  }

  return res.status(200).json({ success: true, order: sanitize(order) });
}

// what the buyer is allowed to see at each stage
function sanitize(order) {
  const base = {
    id: order.id,
    productName: order.productName,
    type: order.type,
    status: order.status,
    createdAt: order.createdAt,
    paidAt: order.paidAt,
    price: order.price,
    error: order.error || null,
    paymentUrl: order.gatewayPaymentUrl || null,
  };
  // only reveal the goods on success
  if (order.status === 'success') {
    if (order.type === 'akun') base.account = order.account;
    if (order.type === 'link') base.link = order.link;
    if (order.type === 'file') base.fileUrl = order.fileUrl;
    if (order.fileName) base.fileName = order.fileName;
    if (order.txId) base.txId = order.txId;
  }
  return base;
}

// Called by the Gopayment gateway via sendGatewayCallback when a QRIS is confirmed.
// Signature header should be verified with GATEWAY_API_KEY-shared secret in production.
async function handlePayhook(req, res) {
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const sessionId = String(body.sessionId || '').toUpperCase();
  if (!sessionId) return res.status(400).json({ error: 'sessionId wajib.' });
  const link = await sessions.get('PAY:' + sessionId);
  if (!link || !link.orderId) return res.status(200).json({ ok: true, note: 'No local order linked.' });
  const fulfilled = await orders.fulfill(link.orderId, { txId: body.txId, paidAt: body.paidAt });
  return res.status(200).json({ success: true, orderId: link.orderId, status: fulfilled?.status });
}

async function handleResolve(req, res) {
  const sessionId = String(req.query?.sessionId || '').toUpperCase();
  if (!sessionId) return res.status(400).json({ error: 'sessionId wajib.' });
  const link = await sessions.get('PAY:' + sessionId);
  return res.status(200).json({ success: true, orderId: link?.orderId || null });
}

export default async function handler(req, res) {
  const action = req.query?.action;
  if (action === 'create') return handleCreate(req, res);
  if (action === 'status') return handleStatus(req, res);
  if (action === 'payhook') return handlePayhook(req, res);
  if (action === 'resolve') return handleResolve(req, res);
  return res.status(404).json({ error: 'Action not found' });
}
