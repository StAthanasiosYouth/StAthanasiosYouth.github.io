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

/* In-memory R2 bucket (the subset the Worker uses). */
export function fakeR2() {
  const objects = new Map();
  return {
    objects,
    async put(key, value, opts = {}) {
      const bytes = new Uint8Array(value instanceof ArrayBuffer ? value : value.buffer ? value.slice().buffer : value);
      objects.set(key, { bytes, httpMetadata: opts.httpMetadata || {}, customMetadata: opts.customMetadata || {}, uploaded: opts.__uploaded || new Date() });
      return { key };
    },
    async get(key) {
      const o = objects.get(key);
      return o ? { body: new Blob([o.bytes]).stream(), size: o.bytes.length, httpMetadata: o.httpMetadata } : null;
    },
    async head(key) { const o = objects.get(key); return o ? { key, size: o.bytes.length } : null; },
    async delete(keys) { for (const k of [].concat(keys)) objects.delete(k); },
    async list({ prefix = '', limit = 1000 } = {}) {
      return { objects: [...objects.entries()].filter(([k]) => k.startsWith(prefix)).slice(0, limit).map(([key, o]) => ({ key, size: o.bytes.length, uploaded: o.uploaded })), truncated: false };
    }
  };
}

/* Minimal valid headers: a JPEG (SOF0) and a WebP (VP8X) of the given size. */
export function jpegBytes(w = 800, h = 600, pad = 200) {
  const head = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
  const b = new Uint8Array(head.length + pad + 2);
  b.set(head); for (let i = head.length; i < b.length - 2; i++) b[i] = (i * 7) & 255; b[b.length - 2] = 0xff; b[b.length - 1] = 0xd9;
  return b;
}
export function webpBytes(w = 640, h = 480, pad = 100) {
  const b = new Uint8Array(30 + pad);
  b.set([...'RIFF'].map(c => c.charCodeAt(0)), 0); b.set([...'WEBP'].map(c => c.charCodeAt(0)), 8); b.set([...'VP8X'].map(c => c.charCodeAt(0)), 12);
  b[16] = 10; const W = w - 1, H = h - 1;
  b[24] = W & 255; b[25] = (W >> 8) & 255; b[26] = (W >> 16) & 255; b[27] = H & 255; b[28] = (H >> 8) & 255; b[29] = (H >> 16) & 255;
  for (let i = 30; i < b.length; i++) b[i] = (i * 13) & 255;
  return b;
}

export function harness({ env: extra = {} } = {}) {
  resetAuthCaches();
  const db = migratedDb();
  const sent = [];
  const env = {
    ENVIRONMENT: 'test', ALLOWED_ORIGINS: ORIGIN, GOOGLE_CLIENT_ID: CLIENT_ID, LOG_SALT: 'salt', ADMIN_EMAILS: 'admin@example.com',
    DB: db, JOBS: { send: async m => { sent.push(m); } }, PROOFS: fakeR2(), SYNC_SECRET: 'sync-test-secret', ...extra
  };
  const waits = [];
  return {
    db, env, sent,
    async call(path, { method = 'GET', body, headers = {}, fetch: f } = {}) {
      const init = { method, headers: { origin: ORIGIN, ...headers } };
      if (body instanceof Uint8Array) { init.body = body; init.headers['content-type'] = init.headers['content-type'] || 'image/jpeg'; }
      else if (body !== undefined) { init.body = typeof body === 'string' ? body : JSON.stringify(body); init.headers['content-type'] = init.headers['content-type'] || 'application/json'; }
      const res = await handle(new Request('https://api.test' + path, init), env, { waitUntil: p => waits.push(p) }, { fetch: f });
      await Promise.all(waits.splice(0));
      const isJson = (res.headers.get('content-type') || '').startsWith('application/json');
      if (!isJson) return { status: res.status, headers: res.headers, bytes: new Uint8Array(await res.arrayBuffer()) };
      const text = await res.text();
      return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
    }
  };
}
