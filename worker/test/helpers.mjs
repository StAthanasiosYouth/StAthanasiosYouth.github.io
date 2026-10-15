// Test helpers: a fake Google (RSA key + JWKS), signed ID tokens, and a
// harness that calls the Worker's handle() with a real-SQLite DB.
import { handle } from '../src/index.js';
import { resetAuthCaches, GOOGLE_JWKS_URL } from '../src/lib/auth.js';
import { migratedDb } from './d1-sqlite.mjs';

export const CLIENT_ID = 'test-client.apps.googleusercontent.com';
export const ORIGIN = 'https://stathanasiosyouth.github.io';

const enc = new TextEncoder();
const b64url = buf => Buffer.from(buf).toString('base64url');

export async function fakeGoogle() {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const kid = 'kid-1';
  let jwksCalls = 0;
  return {
    kid,
    get jwksCalls() { return jwksCalls; },
    async sign(claims, { kid: useKid = kid, key = pair.privateKey, alg = 'RS256' } = {}) {
      const head = b64url(enc.encode(JSON.stringify({ alg, kid: useKid, typ: 'JWT' }))) + '.' + b64url(enc.encode(JSON.stringify(claims)));
      const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(head));
      return head + '.' + b64url(sig);
    },
    claims(over = {}) {
      const now = Math.floor(Date.now() / 1000);
      return { iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: '1001', email: 'admin@example.com', email_verified: true, name: 'Admin', iat: now - 10, exp: now + 3600, ...over };
    },
    fetch: async url => {
      if (url !== GOOGLE_JWKS_URL) throw new Error('unexpected fetch ' + url);
      jwksCalls++;
      return new Response(JSON.stringify({ keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }] }), { headers: { 'cache-control': 'public, max-age=20000' } });
    }
  };
}

export function harness({ env: extra = {} } = {}) {
  resetAuthCaches();
  const db = migratedDb();
  const sent = [];
  const env = {
    ENVIRONMENT: 'test', ALLOWED_ORIGINS: ORIGIN, GOOGLE_CLIENT_ID: CLIENT_ID, LOG_SALT: 'salt', ADMIN_EMAILS: 'admin@example.com',
    DB: db, JOBS: { send: async m => { sent.push(m); } }, ...extra
  };
  const waits = [];
  return {
    db, env, sent,
    async call(path, { method = 'GET', body, headers = {}, fetch: f } = {}) {
      const init = { method, headers: { origin: ORIGIN, ...headers } };
      if (body !== undefined) { init.body = typeof body === 'string' ? body : JSON.stringify(body); init.headers['content-type'] = 'application/json'; }
      const res = await handle(new Request('https://api.test' + path, init), env, { waitUntil: p => waits.push(p) }, { fetch: f });
      await Promise.all(waits.splice(0));
      const text = await res.text();
      return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
    }
  };
}
