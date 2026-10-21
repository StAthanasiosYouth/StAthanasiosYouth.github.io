/*
 * Admin sign-in: the same Google Identity Services ID token the admin already
 * gets, verified HERE (no call to Google's debug-only tokeninfo endpoint).
 *
 * Checks: RS256 signature against Google's published keys (JWKS, cached per
 * isolate by Cache-Control), iss, aud = our OAuth client ID, exp/iat with a
 * small skew, email_verified. Then the allowlist (admins table, plus the
 * ADMIN_EMAILS secret as the bootstrap list), and the Google `sub` binding.
 */

import { ApiError } from './http.js';
import { sha256 } from './hash.js';
import { retry } from './db.js';

export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const SKEW_S = 60;

const jwks = { keys: new Map(), expires: 0, lastFetch: 0 };
const verified = new Map();   // sha256(token) → claims, until exp

export function resetAuthCaches() {
  jwks.keys.clear(); jwks.expires = 0; jwks.lastFetch = 0; verified.clear(); stagingKey = null;
}

function b64urlBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

function b64urlJson(s) {
  return JSON.parse(new TextDecoder().decode(b64urlBytes(s)));
}

async function loadJwks(fetchImpl, now, force) {
  if (!force && jwks.keys.size && now < jwks.expires) return;
  // an unknown kid may force a refresh, but never more than once a minute
  if (force && now - jwks.lastFetch < 60_000) return;
  jwks.lastFetch = now;
  const res = await fetchImpl(GOOGLE_JWKS_URL);
  if (!res.ok) throw new ApiError('error', 'jwks ' + res.status);
  const maxAge = Number((/max-age=(\d+)/.exec(res.headers.get('cache-control') || '') || [])[1] || 3600);
  const body = await res.json();
  const keys = new Map();
  for (const jwk of body.keys || []) {
    if (jwk.kty !== 'RSA' || (jwk.alg && jwk.alg !== 'RS256')) continue;
    keys.set(jwk.kid, await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
  }
  jwks.keys = keys;
  jwks.expires = now + Math.min(maxAge, 24 * 3600) * 1000;
}

/*
 * STAGING ONLY: a test signing key (secret STAGING_TEST_JWK, public JWK) so
 * load tests can call admin routes without a Google login. Ignored unless
 * ENVIRONMENT is exactly 'staging' — production never loads it.
 */
let stagingKey = null;
async function stagingTestKey(env) {
  if (env.ENVIRONMENT !== 'staging' || !env.STAGING_TEST_JWK) return null;
  if (!stagingKey) {
    const jwk = JSON.parse(env.STAGING_TEST_JWK);
    stagingKey = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  }
  return stagingKey;
}

/* Returns the verified claims, or throws ApiError('auth'). */
export async function verifyGoogleIdToken(token, { clientId, fetchImpl = fetch, now = Date.now(), extraKeys = null } = {}) {
  if (!token || typeof token !== 'string' || token.length > 4096) throw new ApiError('auth', 'missing');
  if (!clientId) throw new ApiError('error', 'GOOGLE_CLIENT_ID not set');

  const tokenHash = await sha256(token);
  const hit = verified.get(tokenHash);
  if (hit && hit.exp * 1000 > now) return hit;

  const parts = token.split('.');
  if (parts.length !== 3) throw new ApiError('auth', 'shape');
  let header, claims;
  try {
    header = b64urlJson(parts[0]);
    claims = b64urlJson(parts[1]);
  } catch {
    throw new ApiError('auth', 'decode');
  }
  if (header.alg !== 'RS256' || !header.kid) throw new ApiError('auth', 'alg');

  let key = extraKeys && extraKeys.get(header.kid);
  if (!key) {
    await loadJwks(fetchImpl, now, false);
    if (!jwks.keys.has(header.kid)) await loadJwks(fetchImpl, now, true);
    key = jwks.keys.get(header.kid);
  }
  if (!key) throw new ApiError('auth', 'kid');

  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  if (!ok) throw new ApiError('auth', 'signature');

  const nowS = Math.floor(now / 1000);
  if (!ISSUERS.has(claims.iss)) throw new ApiError('auth', 'iss');
  if (claims.aud !== clientId) throw new ApiError('auth', 'aud');
  if (typeof claims.exp !== 'number' || claims.exp + SKEW_S < nowS) throw new ApiError('auth', 'exp');
  if (typeof claims.iat === 'number' && claims.iat - SKEW_S > nowS) throw new ApiError('auth', 'iat');
  if (claims.email_verified !== true && claims.email_verified !== 'true') throw new ApiError('auth', 'email_verified');
  if (!claims.email || !claims.sub) throw new ApiError('auth', 'email');

  if (verified.size > 500) verified.clear();
  verified.set(tokenHash, claims);
  return claims;
}

function bootstrapList(env) {
  return String(env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

/*
 * The signed-in admin, or throws auth / denied.
 * An admins row with a different bound `sub` is refused (recycled address).
 */
export async function requireAdmin(ctx) {
  const header = ctx.request.headers.get('authorization') || '';
  const token = /^Bearer\s+(.+)$/i.exec(header);
  if (!token) throw new ApiError('auth', 'no bearer');
  // the admin panel's own session (Apps Script apiWorkerToken): one sign-in for every section
  if (/^wk1\./.test(token[1].trim())) return requireAdminSession(ctx, token[1].trim());
  const testKey = await stagingTestKey(ctx.env);
  const claims = await verifyGoogleIdToken(token[1].trim(), {
    clientId: ctx.env.GOOGLE_CLIENT_ID,
    fetchImpl: ctx.fetch,
    extraKeys: testKey ? new Map([['staging-test', testKey]]) : null
  });
  const email = String(claims.email).toLowerCase();

  const row = await retry(() => ctx.env.DB.prepare('SELECT email, google_sub, name, role, active FROM admins WHERE email = ?').bind(email).first());
  let admin = null;
  if (row) {
    if (!row.active) throw new ApiError('denied', 'inactive');
    if (row.google_sub && row.google_sub !== claims.sub) throw new ApiError('denied', 'sub mismatch');
    admin = { email, name: row.name || claims.name || '', role: row.role, via: 'google-id' };
    if (!row.google_sub) {
      ctx.defer(ctx.env.DB.prepare('UPDATE admins SET google_sub = ?, last_seen = ? WHERE email = ? AND google_sub IS NULL').bind(claims.sub, Date.now(), email).run());
    }
  } else if (bootstrapList(ctx.env).includes(email)) {
    admin = { email, name: claims.name || '', role: 'admin', via: 'google-id' };
    // first sign-in of a bootstrap admin: create the row and bind sub
    ctx.defer(ctx.env.DB.prepare('INSERT INTO admins (email, google_sub, name, role, active, created_at, last_seen) VALUES (?, ?, ?, \'admin\', 1, ?, ?) ON CONFLICT(email) DO NOTHING')
      .bind(email, claims.sub, claims.name || '', Date.now(), Date.now()).run());
  }
  if (!admin) throw new ApiError('denied', 'not on allowlist');
  ctx.actor = admin;
  return admin;
}

/*
 * The admin panel's session token for the Worker (Phase 1): issued by Apps
 * Script (apps-script/WorkerSync.gs apiWorkerToken) to a signed-in panel —
 * via Google or via the installed app's trusted device — so «الحجوزات» never
 * asks for Google again while the panel's session is valid.
 *
 *   wk1.<b64url {"e": email, "x": exp (epoch s), "v": "google"|"device", "i": issued (s)}>.<hex HMAC-SHA256>
 *
 * HMAC key: SYNC_SECRET (the same secret as the signed sync), over
 * "wk1." + payload — a different message shape from the sync's "<ts>.<body>",
 * so neither can stand for the other. Short-lived (≤ WK_MAX_S); the admin must
 * still be ACTIVE in D1 (the synced allowlist) at every call. Nothing about
 * Google is inside; the email is the only identity.
 */
export const WK_MAX_S = 20 * 60;

async function wkHmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
  return Array.from(sig, b => b.toString(16).padStart(2, '0')).join('');
}

function sameHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function verifyWorkerToken(env, token, now = Date.now()) {
  if (!env.SYNC_SECRET) throw new ApiError('auth', 'wk disabled');
  const m = /^wk1\.([A-Za-z0-9_-]{10,600})\.([0-9a-f]{64})$/.exec(String(token || ''));
  if (!m) throw new ApiError('auth', 'wk shape');
  if (!sameHex(await wkHmac(env.SYNC_SECRET, 'wk1.' + m[1]), m[2])) throw new ApiError('auth', 'wk signature');
  let c;
  try { c = b64urlJson(m[1]); } catch { throw new ApiError('auth', 'wk payload'); }
  const s = Math.floor(now / 1000);
  const email = String(c.e || '').toLowerCase();
  if (!email || !(Number(c.x) > s - SKEW_S) || Number(c.x) - Number(c.i) > WK_MAX_S || Number(c.i) > s + SKEW_S) throw new ApiError('auth', 'wk expired');
  const sid = typeof c.s === 'string' && /^[\w-]{16,64}$/.test(c.s) ? c.s : '';
  return { email, via: c.v === 'google' ? 'google' : 'device', exp: Number(c.x), sid };
}

/*
 * Phase 3 (docs/ADMIN-PLATFORM-PLAN.md): the Worker mints the panel token
 * itself when it owns the sessions (admin/session.js) — the same wk1 shape,
 * plus `s`: the admin session id. A token with `s` is good only while that
 * sid is its account's live session (session_replaced / session_expired);
 * Apps Script checks it the same way (POST /v1/sync/session).
 */
export const PANEL_TOKEN_S = 15 * 60;

export async function mintPanelToken(env, { email, sid, via }, now = Date.now()) {
  if (!env.SYNC_SECRET) throw new ApiError('disabled', 'SYNC_SECRET not set');
  const i = Math.floor(now / 1000);
  const exp = i + PANEL_TOKEN_S;
  const json = JSON.stringify({ e: email, x: exp, v: via === 'device' ? 'device' : 'google', i, s: sid });
  const payload = btoa(String.fromCharCode(...new TextEncoder().encode(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { token: 'wk1.' + payload + '.' + await wkHmac(env.SYNC_SECRET, 'wk1.' + payload), exp };
}

async function requireAdminSession(ctx, token) {
  const claims = await verifyWorkerToken(ctx.env, token);
  const db = ctx.env.DB;
  const row = await retry(() => db.prepare(
    'SELECT a.email, a.name, a.role, a.active, s.sid, s.via AS s_via, s.parked_ms, s.seen_ms FROM admins a LEFT JOIN admin_sessions s ON s.email = a.email WHERE a.email = ?'
  ).bind(claims.email).first());
  if (!row || !row.active) throw new ApiError('denied', 'not on allowlist');
  ctx.actor = { email: claims.email, name: row.name || '', role: row.role, via: claims.via };
  ctx.tokenExp = claims.exp;
  if (claims.sid) {
    // a panel token: good only while its sid is the account's one live session (start/resume take any)
    if (row.sid === claims.sid) ctx.session = { email: claims.email, sid: row.sid, via: row.s_via, parked_ms: row.parked_ms, seen_ms: row.seen_ms };
    else if (!(ctx.route && ctx.route.anySession)) {
      const gone = await retry(() => db.prepare('SELECT 1 AS x FROM admin_sessions_gone WHERE sid = ?').bind(claims.sid).first());
      throw new ApiError(row.sid || gone ? 'session_replaced' : 'session_expired', 'panel session');
    }
  }
  if (!ctx.session && ctx.route && ctx.route.needSession) throw new ApiError('session_expired', 'no panel session');
  return ctx.actor;
}
