/* Hashing helpers. Logs and counters never hold a raw IP or email. */

const enc = new TextEncoder();

export function hex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256(text) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

const keyCache = new Map();

async function hmacKey(secret) {
  let key = keyCache.get(secret);
  if (!key) {
    key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    keyCache.set(secret, key);
  }
  return key;
}

/* Salted, truncated: stable per salt, useless without it. */
export async function pseudonym(env, value) {
  if (!value) return '';
  const secret = env.LOG_SALT || 'unsalted-dev';
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(String(value).toLowerCase()));
  return hex(sig).slice(0, 16);
}

/* HMAC-SHA256 as hex (the account credentials, account/secret.js) */
export async function hmacHex(secret, value) {
  return hex(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(String(value))));
}

export async function sha256Bytes(bytes) {
  return hex(await crypto.subtle.digest('SHA-256', bytes));
}

/* prefix + n lowercase base32 chars (EVENTS.md §1 id format) */
export function base32Id(prefix, n = 8) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  const b = crypto.getRandomValues(new Uint8Array(n));
  let out = '';
  for (let i = 0; i < n; i++) out += alphabet[b[i] & 31];
  return prefix + out;
}

export function randomId(prefix, bytes = 6) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return prefix + hex(b);
}
