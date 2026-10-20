/*
 * Gmail API sender (Phase 1.5 step 6, BOOKING-PHASE1-COMPLETION-PLAN §4.4):
 * the existing account athanasius.youth.safaga@gmail.com, OAuth through the
 * Worker with the gmail.send scope only. Secrets (never in the repo, the
 * browser or D1): GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN —
 * put there by the owner's one-time consent (scripts/gmail-consent.mjs).
 * The access token lives in this isolate's memory (~1 h).
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
export const SENDER = 'athanasius.youth.safaga@gmail.com';
export const SENDER_NAME = 'شباب أثناسيوس';

let fetchFn = (...args) => fetch(...args);
const cache = { token: null, exp: 0 };

/* tests: a fake Google */
export function setGmailFetch(fn) { fetchFn = fn || ((...args) => fetch(...args)); cache.token = null; cache.exp = 0; }

export class GmailError extends Error {
  constructor(kind, detail) {
    super(detail || kind);
    this.kind = kind;        // 'config' | 'token' | 'quota' | 'rejected' | 'transient'
  }
}

export function gmailConfigured(env) {
  return !!(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN);
}

export async function accessToken(env, { force = false, now = Date.now() } = {}) {
  if (!gmailConfigured(env)) throw new GmailError('config', 'gmail secrets missing');
  if (!force && cache.token && cache.exp - now > 60000) return cache.token;
  const res = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GMAIL_CLIENT_ID, client_secret: env.GMAIL_CLIENT_SECRET, refresh_token: env.GMAIL_REFRESH_TOKEN, grant_type: 'refresh_token' }).toString()
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    cache.token = null;
    // invalid_grant: revoked (a password change) or expired (a Testing-mode client): re-consent
    throw new GmailError(res.status >= 500 ? 'transient' : 'token', String(body.error || res.status));
  }
  cache.token = body.access_token;
  cache.exp = now + (Number(body.expires_in) || 3600) * 1000;
  return cache.token;
}

const b64 = text => {
  const bytes = typeof text === 'string' ? new TextEncoder().encode(text) : text;
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const b64url = text => b64(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const wrap = s => (s.match(/.{1,76}/g) || ['']).join('\r\n');
const clean = s => String(s || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
const ASCII = /^[\x20-\x7e]*$/;

/*
 * RFC 2047 encoded-words, each ≤ 75 characters (≤ 39 UTF-8 bytes of text: 64),
 * never splitting a character, folded onto continuation lines so no header
 * line passes 78 characters (RFC 5322 §2.1.1). Plain ASCII stays as it is.
 */
export function encodeWords(text) {
  const value = clean(text);
  if (ASCII.test(value)) return [value];
  const words = [];
  let chunk = '';
  for (const ch of value) {
    if (new TextEncoder().encode(chunk + ch).length > 39) { words.push(chunk); chunk = ''; }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map(w => '=?UTF-8?B?' + b64(w) + '?=');
}

/* "Name: word1\r\n word2…" — one encoded-word per line after the first */
const header = (name, words) => name + ': ' + words.join('\r\n ');

/* RFC 5322 date: "Tue, 20 Oct 2026 08:16:00 +0000" */
export const rfcDate = (now = Date.now()) => new Date(now).toUTCString().replace(/GMT$/, '+0000');

/*
 * { to, subject, text, html } → the RFC 5322 message, base64url (Gmail's `raw`).
 * multipart/alternative: the plain text first, the HTML last (the preferred
 * one). Auto-Submitted marks it as an automatic notification (RFC 3834: no
 * auto-replies loop back). Gmail adds its own Message-ID; the sender is the
 * real account, with no Reply-To elsewhere.
 */
export function mime({ to, subject, text, html, now = Date.now() }) {
  const boundary = 'b' + crypto.randomUUID().replace(/-/g, '');
  const lines = [
    header('From', [...encodeWords(SENDER_NAME), '<' + SENDER + '>']),
    'To: ' + clean(to),
    header('Subject', encodeWords(subject)),
    'Date: ' + rfcDate(now),
    'MIME-Version: 1.0',
    'Content-Language: ar',
    'Auto-Submitted: auto-generated',
    'Content-Type: multipart/alternative;',
    ' boundary="' + boundary + '"',
    '',
    '--' + boundary,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(b64(text)),
    '--' + boundary,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(b64(html)),
    '--' + boundary + '--',
    ''
  ];
  return b64url(lines.join('\r\n'));
}

/* sends one message → Gmail's message id; throws GmailError */
export async function sendMail(env, message) {
  const token = await accessToken(env);
  const res = await fetchFn(SEND_URL, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({ raw: mime(message) })
  });
  if (res.ok) return (await res.json().catch(() => ({}))).id || '';
  const body = await res.json().catch(() => ({}));
  const reason = String((body.error && (body.error.status || body.error.message)) || res.status);
  if (res.status === 401) { cache.token = null; throw new GmailError('token', reason); }
  if (res.status === 429 || /quota|rate|limit/i.test(reason)) throw new GmailError('quota', reason);
  if (res.status >= 500) throw new GmailError('transient', reason);
  throw new GmailError('rejected', reason);
}
