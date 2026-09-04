// api/_orders.js — Order Store + random account allocation
import { sessions } from './_store.js';
import { products } from './_products.js';

const PREFIX = 'ORDER:';

function generateId() {
  return 'ORD_' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
}

export const orders = {
  async get(idRaw) {
    return await sessions.get(PREFIX + String(idRaw).toUpperCase());
  },

  async save(order) {
    await sessions.set(PREFIX + order.id, order);
  },

  async list() {
    const all = await sessions.getAllSessions();
    const result = [];
    for (const key of Object.keys(all)) {
      if (!key.startsWith(PREFIX)) continue;
      const d = all[key];
      if (d && typeof d === 'object') result.push(d);
    }
    return result.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  },

  async create({ productId, buyer, paymentSessionId, gatewayPaymentUrl }) {
    const product = await products.get(productId);
    if (!product) throw new Error('Product tidak ditemukan.');
    if (product.type === 'akun') {
      const stock = await products.getStock(product.id);
      if (stock <= 0) throw new Error('Stok habis.');
    }
    const id = generateId();
    const order = {
      id,
      productId: product.id.toUpperCase(),
      productName: product.name,
      price: product.price,
      type: product.type,
      buyer: buyer || { name: '', email: '' },
      paymentSessionId: paymentSessionId ? String(paymentSessionId).toUpperCase() : null,
      gatewayPaymentUrl: gatewayPaymentUrl || null,
      status: 'pending', // pending | processing | success | failed | timeout
      account: null,      // allocated account content (akun type)
      link: null,         // delivered link (link type)
      fileUrl: null,      // delivered file url (file type)
      createdAt: new Date().toISOString(),
      paidAt: null,
    };
    await orders.save(order);
    return order;
  },

  async markTimeout(orderId) {
    const order = await orders.get(orderId);
    if (!order || order.status !== 'pending') return order;
    order.status = 'timeout';
    order.error = 'Sesi pembayaran telah berakhir.';
    await orders.save(order);
    return order;
  },

  // Called by the payment-confirmation path after QRIS confirmed.
  // Allocates a RANDOM available account for 'akun' type (one-time, removes from pool).
  async fulfill(orderId, paymentInfo = {}) {
    const order = await orders.get(orderId);
    if (!order) return null;
    // idempotency — already fulfilled?
    if (order.status === 'success') return order;

    const product = await products.get(order.productId);

    if (product.type === 'akun') {
      const available = await products.getAvailableAccounts(order.productId);
      if (!available || available.length === 0) {
        order.status = 'failed';
        order.error = 'Stok habis saat pemrosesan.';
        await orders.save(order);
        return order;
      }
      // random pick
      const pick = available[Math.floor(Math.random() * available.length)];
      // mark sold
      const itemId = pick.id;
      const idx = product.items.findIndex(i => i.id === itemId);
      if (idx !== -1) {
        product.items[idx].sold = true;
        product.items[idx].soldAt = new Date().toISOString();
        product.items[idx].orderId = order.id;
        await sessions.set('PRODUCT:' + order.productId, product);
      }
      order.account = pick.content;
    } else if (product.type === 'link') {
      order.link = product.link || null;
    } else if (product.type === 'file') {
      order.fileUrl = product.fileUrl || null;
      order.fileName = product.fileName && product.fileName;
    }

    order.status = 'success';
    order.paidAt = paymentInfo.paidAt || new Date().toISOString();
    order.txId = paymentInfo.txId || null;
    await orders.save(order);
    return order;
  },

  // rollback: return a sold-but-not-really-paid account back to pool
  async rollbackAccount(orderId) {
    const order = await orders.get(orderId);
    if (!order || order.type !== 'akun' || !order.productId) return;
    const product = await products.get(order.productId);
    if (!product) return;
    const idx = product.items.findIndex(i => i.sold && i.orderId === order.id);
    if (idx !== -1) {
      product.items[idx].sold = false;
      product.items[idx].soldAt = null;
      product.items[idx].orderId = null;
      await sessions.set('PRODUCT:' + order.productId, product);
    }
  },
};
