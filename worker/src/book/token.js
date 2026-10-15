/*
 * Visitor tokens (EVENTS.md §6), HMAC-SHA256 with BOOK_SECRET:
 *   status link  bk1.<b64url {b, e}>.<sig>     b = booking id, e = expiry ms
 *   proof claim  <b64url sig over "claim.<proofId>"> — proves the uploader
 * Compared in constant time. The status token travels only in a URL fragment.
 */

import { ApiError } from '../lib/http.js';

const enc = new TextEncoder();
const keys = new Map();

function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(text) {
  const s = text.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s + '='.repeat((4 - (s.length % 4)) % 4)), c => c.charCodeAt(0));
}

async function key(env) {
  const secret = env.BOOK_SECRET;
  if (!secret || secret.length < 32) throw new ApiError('disabled', 'BOOK_SECRET not set');
  if (!keys.has(secret)) keys.set(secret, await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']));
  return keys.get(secret);
}

async function sign(env, text) {
  return b64url(await crypto.subtle.sign('HMAC', await key(env), enc.encode(text)));
}

function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function statusToken(env, bookingId, expMs) {
  const body = b64url(enc.encode(JSON.stringify({ b: bookingId, e: expMs })));
  return 'bk1.' + body + '.' + await sign(env, 'bk1.' + body);
}

/* → booking id, or throws expired (tampered, malformed or past its date) */
export async function readStatusToken(env, token, now = Date.now()) {
  const m = /^bk1\.([A-Za-z0-9_-]{8,200})\.([A-Za-z0-9_-]{20,100})$/.exec(String(token || ''));
  if (!m) throw new ApiError('expired', 'shape');
  if (!same(m[2], await sign(env, 'bk1.' + m[1]))) throw new ApiError('expired', 'signature');
  let data;
  try { data = JSON.parse(new TextDecoder().decode(fromB64url(m[1]))); } catch { throw new ApiError('expired', 'payload'); }
  if (!data || typeof data.b !== 'string' || !(data.e > now)) throw new ApiError('expired', 'expired');
  return data.b;
}

export async function proofClaim(env, proofId) {
  return (await sign(env, 'claim.' + proofId)).slice(0, 32);
}

export async function checkProofClaim(env, proofId, claim) {
  return typeof claim === 'string' && same(claim, await proofClaim(env, proofId));
}
