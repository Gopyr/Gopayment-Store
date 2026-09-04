// api/admin-products.js — Admin product CRUD + account pool management
import { products } from './_products.js';
import { requireAdmin } from './_admin_auth.js';

async function handleList(req, res) {
  const all = await products.list();
  return res.status(200).json({ success: true, products: all });
}

async function handleGet(req, res) {
  const id = req.query?.id;
  if (!id) return res.status(400).json({ error: 'id wajib.' });
  const product = await products.get(id);
  if (!product) return res.status(404).json({ error: 'Produk tidak ditemukan.' });
  const stock = await products.getStock(id);
  return res.status(200).json({ success: true, product: { ...product, _stock: stock } });
}

async function handleCreate(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { name, description, price, type, image, category, link, fileUrl, fileName } = req.body || {};
  if (!name || !price || !type) return res.status(400).json({ error: 'name, price, type wajib.' });
  if (!['akun', 'link', 'file'].includes(type)) return res.status(400).json({ error: 'type harus akun/link/file.' });
  const product = await products.create({ name, description, price, type, image, category, link, fileUrl, fileName });
  return res.status(200).json({ success: true, product });
}

async function handleUpdate(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const id = req.body?.id;
  if (!id) return res.status(400).json({ error: 'id wajib.' });
  const updated = await products.update(id, req.body);
  if (!updated) return res.status(404).json({ error: 'Produk tidak ditemukan.' });
  return res.status(200).json({ success: true, product: updated });
}

async function handleDelete(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const id = req.body?.id;
  if (!id) return res.status(400).json({ error: 'id wajib.' });
  await products.remove(id);
  return res.status(200).json({ success: true });
}

// ---- Account pool management (akun type only) ----
async function handleAddAccounts(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { productId, accounts } = req.body || {};
  if (!productId || !Array.isArray(accounts)) return res.status(400).json({ error: 'productId + accounts wajib.' });
  const result = await products.addAccountsBulk(productId, accounts);
  return res.status(200).json({ success: true, ...result });
}

async function handleRemoveAccount(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { productId, itemId } = req.body || {};
  if (!productId || !itemId) return res.status(400).json({ error: 'productId + itemId wajib.' });
  const ok = await products.removeAccount(productId, itemId);
  return res.status(ok ? 200 : 404).json({ success: ok });
}

export default async function handler(req, res) {
  if (!await requireAdmin(req, res)) return;
  const action = req.query?.action;
  if (action === 'list') return handleList(req, res);
  if (action === 'get') return handleGet(req, res);
  if (action === 'create') return handleCreate(req, res);
  if (action === 'update') return handleUpdate(req, res);
  if (action === 'delete') return handleDelete(req, res);
  if (action === 'add-accounts') return handleAddAccounts(req, res);
  if (action === 'remove-account') return handleRemoveAccount(req, res);
  return res.status(404).json({ error: 'Action not found' });
}
