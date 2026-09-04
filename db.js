// db.js — SQLite store using Node's built-in node:sqlite (DatabaseSync)
// Zero external dependency. File DB at DATA_DIR/store.db (persistent on VPS/hosting).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DATA_DIR = process.env.DATA_DIR || './data';
mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(`${DATA_DIR}/store.db`);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// ── Schema ───────────────────────────────────────────────────────────────────
db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  description TEXT DEFAULT '',
  price      INTEGER NOT NULL,
  type       TEXT NOT NULL,              -- 'akun' | 'link' | 'file'
  image      TEXT DEFAULT '',
  category   TEXT DEFAULT '',
  link       TEXT DEFAULT '',            -- type=link
  file_url   TEXT DEFAULT '',            -- type=file
  file_name  TEXT DEFAULT '',            -- type=file
  active     INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS account_items (
  id         TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  content    TEXT NOT NULL,
  sold       INTEGER DEFAULT 0,
  sold_at    TEXT,
  order_id   TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_acc_product ON account_items(product_id, sold);

CREATE TABLE IF NOT EXISTS orders (
  id           TEXT PRIMARY KEY,
  product_id   TEXT NOT NULL,
  product_name TEXT,
  price        INTEGER,
  type         TEXT,
  buyer_name   TEXT DEFAULT '',
  buyer_email  TEXT DEFAULT '',
  payment_session_id TEXT,
  status       TEXT DEFAULT 'pending',   -- pending|success|failed|timeout
  account      TEXT,                     -- delivered akun content
  link         TEXT,
  file_url     TEXT,
  file_name    TEXT,
  error        TEXT,
  tx_id        TEXT,
  created_at   TEXT DEFAULT (datetime('now')),
  paid_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_pay ON orders(payment_session_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS payment_sessions (
  id           TEXT PRIMARY KEY,
  nama         TEXT,
  tentang      TEXT,
  nominal      INTEGER,
  surcharge    INTEGER,
  total_bayar  INTEGER,
  status       TEXT DEFAULT 'pending',  -- pending|success|timeout
  tx_id        TEXT,
  waktu        TEXT,
  order_id     TEXT,                    -- linked storefront order
  created_at   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pay_status ON payment_sessions(status);
`);

// helper: map row -> camelCase object
function rowToObj(row) {
  if (!row) return null;
  const o = {};
  for (const [k, v] of Object.entries(row)) {
    o[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = v;
  }
  return o;
}

export const store = {
  db,
  rowToObj,

  // ---- products ----
  listProducts() {
    return db.prepare('SELECT * FROM products ORDER BY datetime(created_at) DESC').all().map(rowToObj);
  },
  listProductsActive() {
    return db.prepare('SELECT * FROM products WHERE active=1 ORDER BY datetime(created_at) DESC').all().map(rowToObj);
  },
  getProduct(id) {
    return rowToObj(db.prepare('SELECT * FROM products WHERE id=?').get(id));
  },
  insertProduct(p) {
    db.prepare(`INSERT INTO products (id,name,description,price,type,image,category,link,file_url,file_name,active,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(p.id, p.name, p.description, p.price, p.type, p.image, p.category,
           p.link || '', p.fileUrl || '', p.fileName || '', p.active ? 1 : 0, p.createdAt);
  },
  updateProduct(p) {
    db.prepare(`UPDATE products SET name=?,description=?,price=?,type=?,image=?,category=?,link=?,file_url=?,file_name=?,active=? WHERE id=?`)
      .run(p.name, p.description, p.price, p.type, p.image, p.category,
           p.link || '', p.fileUrl || '', p.fileName || '', p.active ? 1 : 0, p.id);
  },
  deleteProduct(id) {
    db.prepare('DELETE FROM account_items WHERE product_id=?').run(id);
    db.prepare('DELETE FROM products WHERE id=?').run(id);
  },

  // ---- account items ----
  listAccountItems(productId) {
    return db.prepare('SELECT * FROM account_items WHERE product_id=? ORDER BY datetime(created_at)').all(productId).map(rowToObj);
  },
  countAvailableAccounts(productId) {
    return db.prepare('SELECT COUNT(*) AS c FROM account_items WHERE product_id=? AND sold=0').get(productId).c;
  },
  insertAccountItem(id, productId, content) {
    db.prepare('INSERT INTO account_items (id, product_id, content, sold) VALUES (?,?,?,0)').run(id, productId, content);
  },
  deleteAccountItem(id) {
    db.prepare('DELETE FROM account_items WHERE id=?').run(id);
  },
  // mark one available account sold (used by fulfill); returns the sold account row
  sellOneAccount(productId, orderId) {
    const row = db.prepare('SELECT * FROM account_items WHERE product_id=? AND sold=0 ORDER BY RANDOM() LIMIT 1').get(productId);
    if (!row) return null;
    db.prepare('UPDATE account_items SET sold=1, sold_at=datetime(\'now\'), order_id=? WHERE id=?').run(orderId, row.id);
    return rowToObj(row);
  },
  sellAccountById(itemId, orderId) {
    const row = db.prepare('SELECT * FROM account_items WHERE id=?').get(itemId);
    if (!row) return null;
    db.prepare('UPDATE account_items SET sold=1, sold_at=datetime(\'now\'), order_id=? WHERE id=?').run(orderId, itemId);
    return rowToObj(row);
  },
  // rollback a sold account (if payment fails) — back to available
  unsellAccountByOrder(orderId) {
    db.prepare('UPDATE account_items SET sold=0, sold_at=NULL, order_id=NULL WHERE order_id=?').run(orderId);
  },

  // ---- orders ----
  getOrder(id) {
    return rowToObj(db.prepare('SELECT * FROM orders WHERE id=?').get(id));
  },
  getOrderByPaymentSession(sessionId) {
    return rowToObj(db.prepare('SELECT * FROM orders WHERE payment_session_id=?').get(sessionId));
  },
  insertOrder(o) {
    db.prepare(`INSERT INTO orders (id,product_id,product_name,price,type,buyer_name,buyer_email,payment_session_id,status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(o.id, o.productId, o.productName, o.price, o.type, o.buyerName, o.buyerEmail, o.paymentSessionId, o.status, o.createdAt);
  },
  updateOrderFulfilled(o) {
    db.prepare(`UPDATE orders SET status=?, account=?, link=?, file_url=?, file_name=?, tx_id=?, paid_at=?, error=? WHERE id=?`)
      .run(o.status, o.account, o.link, o.fileUrl, o.fileName, o.txId, o.paidAt, o.error, o.id);
  },
  updateOrderStatus(id, status, error) {
    db.prepare('UPDATE orders SET status=?, error=? WHERE id=?').run(status, error || null, id);
  },

  // ---- payment sessions ----
  insertPaymentSession(s) {
    db.prepare(`INSERT INTO payment_sessions (id,nama,tentang,nominal,surcharge,total_bayar,status,order_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(s.id, s.nama, s.tentang, s.nominal, s.surcharge, s.totalBayar, s.status, s.orderId, s.createdAt);
  },
  getPaymentSession(id) {
    return rowToObj(db.prepare('SELECT * FROM payment_sessions WHERE id=?').get(id));
  },
  setPaymentSessionOrder(id, orderId) {
    db.prepare('UPDATE payment_sessions SET order_id=? WHERE id=?').run(orderId, id);
  },
  confirmPaymentSession(id, txId, waktu) {
    db.prepare(`UPDATE payment_sessions SET status='success', tx_id=?, waktu=? WHERE id=?`).run(txId, waktu, id);
  },
  timeoutPaymentSession(id) {
    db.prepare(`UPDATE payment_sessions SET status='timeout' WHERE id=? AND status='pending'`).run(id);
  }
};

// slick id generator
export function genId(prefix) {
  return prefix + '_' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 7).toUpperCase();
}
