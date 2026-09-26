// Shared helpers: HTTP handling, storage (Upstash Redis), encryption, validation.
import crypto from 'node:crypto';
import { Redis } from '@upstash/redis';

/* ---------------- HTTP ---------------- */

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function reply(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}

export function route(methods, fn) {
  return async (req, res) => {
    if (!methods.includes(req.method)) return reply(res, 405, { error: 'Method not allowed.' });
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof HttpError) return reply(res, err.status, { error: err.message });
      console.error(err);
      return reply(res, 500, { error: 'Something went wrong on our side. Try again in a minute.' });
    }
  };
}

export function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { throw new HttpError(400, 'Invalid request.'); }
  }
  return req.body;
}

/* ---------------- Storage ---------------- */

let redis;
export function __setDb(r) { redis = r; } // tests only
export function db() {
  if (redis) return redis;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Database not configured: add an Upstash Redis store in Vercel (see README).');
  redis = new Redis({ url, token });
  return redis;
}

const sendKey = (id) => `send:${id}`;

export async function getSend(id) {
  if (!id || typeof id !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) return null;
  return (await db().get(sendKey(id))) || null;
}

export async function saveSend(record) {
  await db().set(sendKey(record.id), record);
}

export async function deleteSend(id) {
  await db().del(sendKey(id));
  await db().srem('sends:open', id);
}

export async function markOpen(id) { await db().sadd('sends:open', id); }
export async function markClosed(id) { await db().srem('sends:open', id); }
export async function openIds() { return (await db().smembers('sends:open')) || []; }

// A short lock so two requests can't move the same escrow at the same time.
export async function withLock(id, fn) {
  const key = `lock:${id}`;
  const got = await db().set(key, '1', { nx: true, ex: 120 });
  if (!got) throw new HttpError(409, 'This send is being processed right now. Try again in a moment.');
  try { return await fn(); } finally { await db().del(key); }
}

/* ---------------- Crypto ---------------- */

function masterKey() {
  const raw = process.env.ESCROW_ENCRYPTION_KEY;
  if (!raw) throw new Error('ESCROW_ENCRYPTION_KEY is not set (see README).');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('ESCROW_ENCRYPTION_KEY must be 32 bytes, base64-encoded.');
  return key;
}

export function encryptSecret(bytes) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(bytes)), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

export function decryptSecret(payload) {
  const [iv, tag, enc] = payload.split('.').map((s) => Buffer.from(s, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), iv);
  decipher.setAuthTag(tag);
  return new Uint8Array(Buffer.concat([decipher.update(enc), decipher.final()]));
}

export function hashCode(id, code) {
  return crypto.createHmac('sha256', masterKey()).update(`${id}:${code}`).digest('base64');
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export const randomId = () => crypto.randomBytes(18).toString('base64url');
export const randomCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

/* ---------------- Validation ---------------- */

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function cleanText(value, max) {
  return String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);
}

// "1.25" with 9 decimals -> 1250000000n. Throws on bad input.
export function toBaseUnits(str, decimals) {
  const s = String(str ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new HttpError(400, 'Enter the amount as a number, like 0.5.');
  const [whole, frac = ''] = s.split('.');
  if (frac.length > decimals) throw new HttpError(400, `That coin only goes to ${decimals} decimal places.`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
}

export function fromBaseUnits(units, decimals) {
  const n = BigInt(units);
  const d = 10n ** BigInt(decimals);
  const frac = (n % d).toString().padStart(decimals, '0').replace(/0+$/, '');
  return frac ? `${n / d}.${frac}` : `${n / d}`;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function shortKey(pk) {
  const s = String(pk);
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}
