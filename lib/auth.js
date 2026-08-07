// Session/auth plumbing — deliberately separate from lib/users.js
// (DB business logic) and lib/handlers.js (campaigns/brands): this
// file only knows about cookies, signed tokens, and password hashing.
//
// Sessions are a self-contained signed cookie (HMAC-SHA256 over a
// JSON payload), not a DB-backed session table — no server-side
// session store needed, which keeps this simple across both the
// local dev server and Vercel's stateless serverless functions.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const COOKIE_NAME = 'session';
// This is an *idle* timeout, not a fixed session lifetime: the token
// itself just expires 10 minutes after it was minted (same mechanism
// as always — buildSessionCookie(user) below), but the admin pages'
// client-side watchdog re-mints it (via POST /api/auth/refresh) every
// ~30s as long as there's been real activity in the UI, and stops
// doing that once idle — see startSessionWatchdog() in index.html/
// edit.html/users.html/brands.html. So in practice: active use keeps
// the session alive indefinitely; 10 minutes of no activity logs out.
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes of inactivity
const BCRYPT_ROUNDS = 10;

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET environment variable is required.');
  }
  return secret;
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signToken(payload) {
  const body = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', getSecret()).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', getSecret()).update(body).digest('base64url');
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function buildSessionCookie(user) {
  const token = signToken({
    uid: user.id,
    username: user.username,
    role: user.role,
    exp: Date.now() + SESSION_TTL_MS,
  });
  const maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000);
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`;
}

function buildLogoutCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`;
}

// Works against both a raw Node http.IncomingMessage (server.js) and
// a Vercel request object — both expose `.headers.cookie`.
function getUserFromRequest(req) {
  const cookies = parseCookies(req.headers && req.headers.cookie);
  const payload = verifyToken(cookies[COOKIE_NAME]);
  if (!payload) return null;
  return { id: payload.uid, username: payload.username, role: payload.role };
}

function requireAuth(req) {
  const user = getUserFromRequest(req);
  if (!user) throw httpError(401, 'נדרשת התחברות');
  return user;
}

function requireAdmin(req) {
  const user = requireAuth(req);
  if (user.role !== 'admin') throw httpError(403, 'נדרשת הרשאת מנהל');
  return user;
}

async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

module.exports = {
  buildSessionCookie,
  buildLogoutCookie,
  getUserFromRequest,
  requireAuth,
  requireAdmin,
  hashPassword,
  verifyPassword,
  httpError,
};
