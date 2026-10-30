/*
 * Youth accounts: credentials (docs/YOUTH-ACCOUNTS-PLAN.md §6.1, §6.6, §12.3).
 * Secrets: PW_PEPPER, PW_KEY (base64, 32 bytes), OTP_PEPPER, kept outside D1
 * (scripts/account-secrets.mjs). Backups hold only hashes and ciphertext.
 */

import { hmacHex, sha256 } from '../lib/hash.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';   // no 0/O/1/I/L/U
const SYMBOLS = 12;
const toLatinDigits = text => String(text == null ? '' : text)
  .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
  .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0));

/* XXXX-XXXX-XXXX, ≈ 59 bits; rejection sampling keeps every symbol equally likely */
export function generatePassword() {
  let out = '';
  while (out.length < SYMBOLS) {
    for (const b of crypto.getRandomValues(new Uint8Array(24))) {
      if (b < 240 && out.length < SYMBOLS) out += ALPHABET[b % ALPHABET.length];
    }
  }
  return out.slice(0, 4) + '-' + out.slice(4, 8) + '-' + out.slice(8);
}

/* what was typed → what is hashed: case, dashes, spaces and Arabic digits don't matter */
export function normalizePassword(value) {
  return toLatinDigits(value).replace(/[\s\-_‐-―]/g, '').toUpperCase();
}

export const passwordHash = (env, password) => hmacHex(env.PW_PEPPER, normalizePassword(password));

const b64 = bytes => btoa(String.fromCharCode(...bytes));
const unb64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
const pwKey = env => crypto.subtle.importKey('raw', unb64(env.PW_KEY), 'AES-GCM', false, ['encrypt', 'decrypt']);

/* the copy only the Primary Admin can view: bound to the row and its version, so it can't be moved */
export async function passwordEncrypt(env, participantId, version, password) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(participantId + '|' + version) }, await pwKey(env), enc.encode(password));
  return b64(iv) + '.' + b64(new Uint8Array(ct));
}

export async function passwordDecrypt(env, participantId, version, stored) {
  const [iv, ct] = String(stored).split('.');
  const out = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: enc.encode(participantId + '|' + version) }, await pwKey(env), unb64(ct));
  return dec.decode(out);
}

/* 6 digits, rejection sampling (values ≥ 4 000 000 000 skipped) */
export function generateCode() {
  for (;;) {
    const [v] = crypto.getRandomValues(new Uint32Array(1));
    if (v < 4000000000) return String(v % 1000000).padStart(6, '0');
  }
}

export const cleanCode = value => toLatinDigits(value).replace(/\s/g, '');

export const codeHash = (env, purpose, id, code) => hmacHex(env.OTP_PEPPER, purpose + '|' + id + '|' + code);

/* compares two hex digests without stopping at the first difference */
export function sameHex(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* the session token: 256 random bits; D1 keeps only its SHA-256 */
export function generateToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return 'as1.' + b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const tokenHash = token => sha256(token);
