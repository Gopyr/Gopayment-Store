import { createHash, timingSafeEqual } from 'node:crypto';
import { adminStore } from './_store.js';

export const ADMIN_SESSION_COOKIE = 'gpayment_admin';
export const ADMIN_SESSION_TTL = 8 * 60 * 60;
export const ADMIN_LOCK_SECONDS = 5 * 60 * 60;

export function getClientIp(req) {
  const forwarded = req.headers?.['x-forwarded-for'];
  const candidate = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  return (candidate || req.socket?.remoteAddress || 'unknown').trim().slice(0, 128);
}

export function getIpFingerprint(ip) {
  const salt = process.env.ADMIN_PASSWORD || 'gpayment-admin';
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 48);
}

export function maskIp(ip) {
  if (!ip || ip === 'unknown') return 'unknown';
  if (ip.includes(':')) return `${ip.slice(0, 8)}…`;
  const parts = ip.split('.');
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.***.***` : `${ip.slice(0, 8)}…`;
}

export function secretsMatch(input, expected) {
  if (typeof input !== 'string' || typeof expected !== 'string' || input.length !== expected.length) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  return timingSafeEqual(a, b);
}

function parseCookies(header = '') {
  return header.split(';').reduce((cookies, part) => {
    const index = part.indexOf('=');
    if (index <= 0) return cookies;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try { cookies[key] = decodeURIComponent(value); } catch { cookies[key] = value; }
    return cookies;
  }, {});
}

export function getAdminToken(req) {
  return parseCookies(req.headers?.cookie || '')[ADMIN_SESSION_COOKIE] || null;
}

export function setAdminCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${ADMIN_SESSION_TTL}`
  );
}

export function clearAdminCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
  );
}

export async function requireAdmin(req, res) {
  const token = getAdminToken(req);
  if (!token) {
    res.status(401).json({ error: 'Sesi admin tidak ditemukan.' });
    return null;
  }

  const session = await adminStore.getSession(token);
  if (!session) {
    clearAdminCookie(res);
    res.status(401).json({ error: 'Sesi admin telah berakhir. Silakan login kembali.' });
    return null;
  }

  return { token, ...session };
}
