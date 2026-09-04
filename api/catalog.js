// api/catalog.js — Public storefront catalog (no auth)
import { products } from './_products.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const id = req.query?.id;
  if (id) {
    const product = await products.get(id);
    if (!product || !product.active) return res.status(404).json({ error: 'Produk tidak ditemukan.' });
    const stock = await products.getStock(id);
    return res.status(200).json({
      success: true,
      product: {
        id: product.id, name: product.name, description: product.description,
        price: product.price, type: product.type, image: product.image,
        category: product.category, stock, active: product.active,
      },
    });
  }
  const all = await products.listActive();
  const cleaned = all.map(p => ({
    id: p.id, name: p.name, description: p.description, price: p.price,
    type: p.type, image: p.image, category: p.category,
    stock: p.type === 'akun' ? p.items.filter(i => !i.sold).length : 999999,
  }));
  return res.status(200).json({ success: true, products: cleaned });
}
