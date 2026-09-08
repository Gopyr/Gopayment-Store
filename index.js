import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  
  if (url.pathname === '/' || url.pathname === '/store') {
    const filePath = path.join(__dirname, 'public', 'store.html');
    try {
      const html = fs.readFileSync(filePath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Internal Server Error: Gagal membaca file store.html (${err.message})`);
      return;
    }
  }

  // Jika mengakes halaman admin
  if (url.pathname === '/admin-products') {
    const filePath = path.join(__dirname, 'public', 'admin-products.html');
    try {
      const html = fs.readFileSync(filePath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Internal Server Error: Gagal membaca file admin-products.html (${err.message})`);
      return;
    }
  }

  // Fallback default
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: "Not found", path: url.pathname }));
}
