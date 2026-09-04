// api/admin.js — Storefront admin auth (login/logout only; no transaction dashboard here)
// Sets the same `gpayment_admin` cookie used by admin-products.js via _admin_auth.js.
import { randomUUID } from 'node:crypto';
import { adminStore } from './_store.js';
import { requireAdmin, setAdminCookie, clearAdminCookie } from './_admin_auth.js';

async function handleLogin(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { password } = req.body || {};
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  if (!ADMIN_PASSWORD) return res.status(500).json({ error: 'Konfigurasi server belum lengkap.' });
  const fingerprint = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const isLocked = await adminStore.isLocked(fingerprint);
  if (isLocked) return res.status(429).json({ error: 'Akses dikunci karena terlalu banyak percobaan salah.' });
  if (password !== ADMIN_PASSWORD) {
    const attempts = await adminStore.incrementAttempts(fingerprint);
    if (attempts >= 5) {
      await adminStore.lock(fingerprint);
      return res.status(429).json({ error: 'Terlalu banyak percobaan. Akses dikunci.' });
    }
    return res.status(401).json({ error: `Password salah. Sisa percobaan: ${5 - attempts}` });
  }
  await adminStore.unlock(fingerprint);
  const sessionToken = randomUUID();
  await adminStore.createSession(sessionToken, { admin: true });
  setAdminCookie(res, sessionToken);
  return res.status(200).json({ success: true });
}

async function handleLogout(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const token = getAdminTokenFromReq(req);
  if (token) await adminStore.deleteSession(token);
  clearAdminCookie(res);
  return res.status(200).json({ success: true });
}

function getAdminTokenFromReq(req) {
  const m = /gpayment_admin=([^;]+)/.exec(req.headers?.cookie || '');
  return m ? decodeURIComponent(m[1]) : null;
}

export default async function handler(req, res) {
  const action = req.query?.action;
  if (action === 'login') return handleLogin(req, res);
  if (action === 'logout') return handleLogout(req, res);
  if (action === 'verify') {
    if (!await requireAdmin(req, res)) return;
    return res.status(200).json({ success: true, ok: true });
  }
  return res.status(404).json({ error: 'Action not found' });
}
