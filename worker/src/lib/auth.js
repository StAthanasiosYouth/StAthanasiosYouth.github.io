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
    admin = { email, name: row.name || claims.name || '', role: row.role };
    if (!row.google_sub) {
      ctx.defer(ctx.env.DB.prepare('UPDATE admins SET google_sub = ?, last_seen = ? WHERE email = ? AND google_sub IS NULL').bind(claims.sub, Date.now(), email).run());
    }
  } else if (bootstrapList(ctx.env).includes(email)) {
    admin = { email, name: claims.name || '', role: 'admin' };
    // first sign-in of a bootstrap admin: create the row and bind sub
    ctx.defer(ctx.env.DB.prepare('INSERT INTO admins (email, google_sub, name, role, active, created_at, last_seen) VALUES (?, ?, ?, \'admin\', 1, ?, ?) ON CONFLICT(email) DO NOTHING')
      .bind(email, claims.sub, claims.name || '', Date.now(), Date.now()).run());
  }
  if (!admin) throw new ApiError('denied', 'not on allowlist');
  ctx.actor = admin;
  return admin;
}
