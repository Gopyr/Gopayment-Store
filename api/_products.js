// api/_products.js — Product Store (Upstash Redis)
// Keys auto-uppercased by _store.js. Product keys prefix "PRODUCT:".
import { sessions } from './_store.js';

const PREFIX = 'PRODUCT:';

function generateId() {
  return 'P_' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
}

export const products = {
  async list() {
    const all = await sessions.getAllSessions();
    const result = [];
    for (const key of Object.keys(all)) {
      if (!key.startsWith(PREFIX)) continue;
      const data = all[key];
      if (data && typeof data === 'object') result.push(data);
    }
    return result.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  },

  async listActive() {
    const all = await products.list();
    return all.filter(p => p.active);
  },

  async get(idRaw) {
    const id = String(idRaw).toUpperCase();
    return await sessions.get(PREFIX + id);
  },

  async create(data) {
    const id = generateId();
    const product = {
      id,
      name: data.name,
      description: data.description || '',
      price: parseInt(data.price, 10),
      type: data.type, // 'akun' | 'link' | 'file'
      image: data.image || '',
      category: data.category || '',
      items: data.type === 'akun' ? (data.items || []) : [],
      link: data.type === 'link' ? (data.link || '') : '',
      fileUrl: data.type === 'file' ? (data.fileUrl || '') : '',
      fileName: data.type === 'file' ? (data.fileName || '') : '',
      active: data.active !== false,
      createdAt: new Date().toISOString(),
    };
    await sessions.set(PREFIX + id, product);
    return product;
  },

  async update(idRaw, data) {
    const id = String(idRaw).toUpperCase();
    const existing = await sessions.get(PREFIX + id);
    if (!existing) return null;
    const updated = { ...existing, ...data, id };
    if (data.price !== undefined) updated.price = parseInt(data.price, 10);
    if (data.type !== undefined && data.type !== existing.type) {
      // switching type — reset type-specific fields
      updated.items = data.type === 'akun' ? (Array.isArray(data.items) ? data.items : []) : [];
      updated.link = data.type === 'link' ? (data.link || '') : '';
      updated.fileUrl = data.type === 'file' ? (data.fileUrl || '') : '';
      updated.fileName = data.type === 'file' ? (data.fileName || '') : '';
      updated.type = data.type;
    }
    await sessions.set(PREFIX + id, updated);
    return updated;
  },

  async remove(idRaw) {
    const id = String(idRaw).toUpperCase();
    await sessions.del(PREFIX + id);
  },

  // --- Account (akun) type operations ---
  async addAccount(productId, content) {
    const product = await products.get(productId);
    if (!product || product.type !== 'akun') return null;
    const id = String(productId).toUpperCase();
    const itemId = 'ACC_' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
    const item = { id: itemId, content, sold: false, soldAt: null, orderId: null };
    product.items.push(item);
    await sessions.set(PREFIX + id, product);
    return item;
  },

  async addAccountsBulk(productId, accounts) {
    const product = await products.get(productId);
    if (!product || product.type !== 'akun') return { added: 0, total: 0 };
    const id = String(productId).toUpperCase();
    let added = 0;
    for (const content of accounts) {
      if (!content || !content.trim()) continue;
      const itemId = 'ACC_' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
      product.items.push({ id: itemId, content: content.trim(), sold: false, soldAt: null, orderId: null });
      added++;
    }
    await sessions.set(PREFIX + id, product);
    return { added, total: product.items.length };
  },

  async removeAccount(productId, itemId) {
    const product = await products.get(productId);
    if (!product || product.type !== 'akun') return false;
    const id = String(productId).toUpperCase();
    const idx = product.items.findIndex(i => i.id === itemId);
    if (idx === -1) return false;
    product.items.splice(idx, 1);
    await sessions.set(PREFIX + id, product);
    return true;
  },

  async getAvailableAccounts(productId) {
    const product = await products.get(productId);
    if (!product || product.type !== 'akun') return [];
    return product.items.filter(i => !i.sold);
  },

  async getStock(productId) {
    const product = await products.get(productId);
    if (!product) return 0;
    if (product.type === 'akun') return product.items.filter(i => !i.sold).length;
    return 999999; // link/file = unlimited
  },
};
