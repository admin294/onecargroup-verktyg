// Password gate + signed cookie. Staff actions require auth; /v/<id> is public.
// Cookie value = HMAC-SHA256(SESSION_SECRET, "ok"), verified constant-time.
import crypto from 'node:crypto';

export const COOKIE_NAME = 'rdm_session';

const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-insecure-session-secret';
const APP_PASSWORD = process.env.APP_PASSWORD || '';

function sign(payload) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
}

/** The cookie token a logged-in staff member carries. */
export function makeToken() {
  return sign('ok');
}

/** Constant-time compare of two hex strings of equal length. */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** True if the submitted password matches APP_PASSWORD (constant-time). */
export function checkPassword(password) {
  if (!APP_PASSWORD) return false;
  return safeEqual(password || '', APP_PASSWORD);
}

/** True if a cookie token is a valid session. */
export function isValidToken(token) {
  if (!token) return false;
  return safeEqual(token, makeToken());
}

/** Parse a Cookie header into a map. */
export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

/** Express middleware: 401 unless a valid session cookie is present. */
export function requireAuth(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  if (isValidToken(cookies[COOKIE_NAME])) return next();
  res.status(401).json({ error: 'unauthorized' });
}

/** Build the Set-Cookie header value for a fresh login. */
export function sessionCookie(token, { secure } = {}) {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${60 * 60 * 24 * 7}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** Clear-cookie header value for logout. */
export function clearCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

export function isConfigured() {
  return Boolean(APP_PASSWORD);
}
