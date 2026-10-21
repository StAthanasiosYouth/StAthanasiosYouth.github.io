/*
 * «خليك داخل» on the installed admin app, on the Worker (Phase 3 P3-4,
 * docs/ADMIN-PLATFORM-PLAN.md). A port of apps-script/AdminDevice.gs with the
 * same rules; the device secret moves from Script Properties into D1,
 * AES-GCM encrypted with the Worker secret DEVICE_KEY.
 *
 *  1. trust: right after a real Google sign-in (a Google ID token, never a
 *     session or device token) → { deviceId, secret, until }. The page keeps
 *     the secret only as a non-extractable WebCrypto key (admin/device.js).
 *     Hard end DEVICE_TRUST_MS after THIS sign-in; never extended by use.
 *  2. sign-in (public): HMAC(secret, "<id>.<ts>.<nonce>") → a short device
 *     token (wk1 with v = 'device' and d = the device id). Checked: the device
 *     exists, not past its end, the time within SKEW_MS, the nonce unused,
 *     the signature (constant time), the account still active. Too many bad
 *     signatures end the device. `start` opens the panel's session in the
 *     same round trip (the same device takes its own session over).
 *  3. ends: forget («خروج»), its end date, the admin removed (accounts.js),
 *     DEVICE_FAIL_MAX bad signatures. Every token that names the device stops
 *     at once (lib/auth.js checks the device on every call).
 */

import { ApiError } from '../lib/http.js';
import { retry } from '../lib/db.js';
import { hex } from '../lib/hash.js';
import { limit, clientIp } from '../lib/ratelimit.js';
import { mintPanelToken } from '../lib/auth.js';
import { cleanLabel, sessionStart, platformOn } from './session.js';

async function requireOn(env) {
  if (!(await platformOn(env))) throw new ApiError('off', 'ADMIN_PLATFORM');
}

export const DEVICE_TRUST_MS = 30 * 86400 * 1000;
export const DEVICE_PER_ADMIN = 5;
export const DEVICE_MAX = 50;
export const SKEW_MS = 10 * 60 * 1000;
export const DEVICE_FAIL_MAX = 10;

const enc = new TextEncoder();
const ID_RE = /^[0-9a-f]{24}$/;

async function aesKey(env) {
  if (!env.DEVICE_KEY || String(env.DEVICE_KEY).length < 32) throw new ApiError('disabled', 'DEVICE_KEY not set');
  const raw = await crypto.subtle.digest('SHA-256', enc.encode('admin-devices.' + env.DEVICE_KEY));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

const b64 = bytes => btoa(String.fromCharCode(...bytes));
const unb64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));

async function sealSecret(env, id, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  // the device id is the additional data: a sealed secret never fits another row
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(id) }, await aesKey(env), enc.encode(secret)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv); out.set(ct, iv.length);
  return b64(out);
}

async function openSecret(env, id, sealed) {
  const all = unb64(sealed);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12), additionalData: enc.encode(id) }, await aesKey(env), all.slice(12));
  return new TextDecoder().decode(pt);
}

async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}

function sameHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !a.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const randomHex = n => hex(crypto.getRandomValues(new Uint8Array(n)));

/* POST /v1/admin/devices/trust { label, previous } (a Google ID token) → { deviceId, secret, until } */
export async function deviceTrust(ctx, now = Date.now()) {
  await requireOn(ctx.env);
  if (ctx.actor.via !== 'google-id') throw new ApiError('google', 'google id token needed');
  await limit(ctx, 'device.trust', ctx.actor.email, 10, 3600);
  const db = ctx.env.DB;
  const email = ctx.actor.email;
  const b = ctx.body || {};
  const previous = typeof b.previous === 'string' && ID_RE.test(b.previous) ? b.previous : '';
  const mine = (await retry(() => db.prepare('SELECT id, until_ms, created_ms, last_ms FROM admin_devices WHERE email = ?').bind(email).all())).results;
  const drop = new Set();
  if (previous && mine.some(d => d.id === previous)) drop.add(previous);
  for (const d of mine) if (!(d.until_ms > now)) drop.add(d.id);
  const left = mine.filter(d => !drop.has(d.id)).sort((x, y) => (x.last_ms || x.created_ms) - (y.last_ms || y.created_ms));
  while (left.length >= DEVICE_PER_ADMIN) drop.add(left.shift().id);
  const total = await retry(() => db.prepare('SELECT COUNT(*) AS n FROM admin_devices WHERE until_ms > ?').bind(now).first('n'));
  if (total - [...drop].filter(id => mine.some(d => d.id === id && d.until_ms > now)).length >= DEVICE_MAX) {
    throw new ApiError('protected', 'device max', { reason: 'devices' });
  }
  const id = randomHex(12);
  const secret = randomHex(32);
  const until = now + DEVICE_TRUST_MS;
  const stmts = [...drop].map(d => db.prepare('DELETE FROM admin_devices WHERE id = ? AND email = ?').bind(d, email));
  stmts.push(db.prepare('INSERT INTO admin_devices (id, email, secret_enc, label, created_ms, until_ms, last_ms, fails) VALUES (?, ?, ?, ?, ?, ?, ?, 0)')
    .bind(id, email, await sealSecret(ctx.env, id, secret), cleanLabel(b.label, 40), now, until, now));
  // the panel's open session (signed in with Google on this phone) now belongs to this device:
  // the app swiped away and opened again takes it over without «another device»
  if (typeof b.sid === 'string' && /^[\w-]{16,64}$/.test(b.sid)) {
    stmts.push(db.prepare('UPDATE admin_sessions SET device_id = ? WHERE email = ? AND sid = ?').bind(id, email, b.sid));
  }
  await retry(() => db.batch(stmts));
  return { deviceId: id, secret, until };
}

/* POST /v1/admin/devices/forget { deviceId } — a device token forgets its own device; else one of mine */
export async function deviceForget(ctx) {
  const id = ctx.deviceId || (typeof (ctx.body || {}).deviceId === 'string' && ID_RE.test(ctx.body.deviceId) ? ctx.body.deviceId : '');
  if (!id) return { forgotten: false };
  const db = ctx.env.DB;
  const email = ctx.actor.email;
  // «خروج» on the app: the device's panel session ends with it (its tokens name the device, so they stop anyway)
  const r = await retry(() => db.batch([
    db.prepare('DELETE FROM admin_devices WHERE id = ? AND email = ?').bind(id, email),
    db.prepare("DELETE FROM edit_locks WHERE kind <> 'booking' AND sid IN (SELECT sid FROM admin_sessions WHERE email = ? AND device_id = ?)").bind(email, id),
    db.prepare('DELETE FROM admin_sessions WHERE email = ? AND device_id = ?').bind(email, id)
  ]));
  return { forgotten: r[0].meta.changes === 1 };
}

/*
 * POST /v1/public/device/sign-in { deviceId, ts, nonce, sig, start? }
 * → { token, exp, email, via: 'device', session? } | error device / expired / denied / bad.
 * Never says which check failed.
 */
export async function deviceSignIn(ctx, now = Date.now()) {
  await requireOn(ctx.env);
  await limit(ctx, 'device.signin', clientIp(ctx.request), 30, 600);
  const b = ctx.body || {};
  const id = typeof b.deviceId === 'string' && ID_RE.test(b.deviceId) ? b.deviceId : '';
  const ts = Number(b.ts);
  const nonce = String(b.nonce || '');
  const sig = String(b.sig || '');
  if (!id || !Number.isFinite(ts) || !/^[0-9a-f]{32}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(sig)) throw new ApiError('bad', 'device request');

  const db = ctx.env.DB;
  const row = await retry(() => db.prepare('SELECT d.*, a.active, a.name, a.role FROM admin_devices d LEFT JOIN admins a ON a.email = d.email WHERE d.id = ?').bind(id).first());
  if (!row || row.fails >= DEVICE_FAIL_MAX) throw new ApiError('device', 'unknown');
  if (!(row.until_ms > now)) {
    await retry(() => db.prepare('DELETE FROM admin_devices WHERE id = ?').bind(id).run());
    throw new ApiError('expired', 'device');
  }

  let good = Math.abs(now - ts) <= SKEW_MS;
  if (good) {
    let secret = '';
    try { secret = await openSecret(ctx.env, id, row.secret_enc); } catch (err) { if (err instanceof ApiError) throw err; secret = ''; }
    good = !!secret && sameHex(await hmacHex(secret, id + '.' + ts + '.' + nonce), sig);
  }
  if (good) {
    // the nonce once only (kept past the skew window)
    const used = await retry(() => db.prepare('INSERT OR IGNORE INTO admin_device_nonces (nonce, exp_ms) VALUES (?, ?)').bind(nonce, now + 2 * SKEW_MS).run());
    good = used.meta.changes === 1;
  }
  if (!good) {
    await retry(() => db.batch([
      db.prepare('UPDATE admin_devices SET fails = fails + 1 WHERE id = ?').bind(id),
      db.prepare('DELETE FROM admin_devices WHERE id = ? AND fails >= ?').bind(id, DEVICE_FAIL_MAX)
    ]));
    throw new ApiError('device', 'signature');
  }

  // still an admin? (else the device goes too)
  if (!row.active) {
    await retry(() => db.prepare('DELETE FROM admin_devices WHERE id = ?').bind(id).run());
    throw new ApiError('denied', 'device admin');
  }

  await retry(() => db.prepare('UPDATE admin_devices SET last_ms = ?, fails = 0 WHERE id = ?').bind(now, id).run());
  const t = await mintPanelToken(ctx.env, { email: row.email, sid: '', via: 'device', deviceId: id }, now);
  const out = { token: t.token, exp: t.exp, email: row.email, via: 'device' };

  // the app's launch: the panel's session too, in the SAME round trip
  if (b.start && typeof b.start === 'object') {
    ctx.actor = { email: row.email, name: row.name || '', role: row.role, via: 'device' };
    ctx.deviceId = id;
    const body = ctx.body;
    ctx.body = { device: b.start.device, tab: b.start.tab, force: b.start.force === true };
    try { out.session = await sessionStart(ctx, now); }
    catch (err) { out.session = { error: true, code: err instanceof ApiError ? err.code : 'error' }; }
    finally { ctx.body = body; }
  }
  return out;
}
