/*
 * The devices that get push (docs/PHASE6-PLAN.md Step 4a, BACKEND-MIGRATION §22.2.4). One table, one register call
 * shape for web and native tokens; visitors' and admins' rows never mix.
 *
 * Visitors (no account needed; Push.gs pushSubscribe_ / pushUnsubscribe_):
 *   POST /v1/push/subscribe   { token, previous?, os?, platform?, appVersion?, topics? } → { ok } | { ok: false, code }
 *   POST /v1/push/unsubscribe { token }
 *   Narrow on purpose: one token in or out, nothing read back.
 * Admins (AdminNotify.gs, the same names and answers): /v1/admin/push/{subscribe,unsubscribe,devices,remove}.
 *   The email on a row is always the session's, never what the page says.
 * The move (pushImportTick, from the minute cron; settings.PUSH_IMPORT = 'dry' | 'apply'): Apps Script's rows come
 * over, a row already here stays as it is, so it can run again for what arrived in between. The token never reaches a log or a report.
 */

import { ApiError } from '../lib/http.js';
import { retry } from '../lib/db.js';
import { sha256 } from '../lib/hash.js';
import { logLine } from '../lib/log.js';
import { limit, clientIp } from '../lib/ratelimit.js';
import { askAppsScript } from '../content/comps.js';
import { settingStmt } from '../content/compdrafts.js';
import { requireAccount } from '../account/session.js';
import { gate } from '../account/routes.js';

// an FCM registration token, or (Phase 6 Step 4d, the new web API register()) a Firebase Installation ID: 22 characters
const TOKEN = /^(?:[\w:-]{100,400}|[\w-]{22})$/;
const OS = ['android', 'ios', 'desktop', 'other'];
const PLATFORMS = ['web', 'android', 'ios'];
export const TOPICS = ['announcements', 'events', 'competitions', 'reminders'];
const VERSION = /^[\w.+-]{1,20}$/;
const REMOVE_ID = /^h[0-9a-f]{15}$/;
export const PUBLIC_MAX = 20000;
export const PER_ADMIN = 5;
export const ADMIN_MAX = 100;
const SEEN_MS = 6 * 3600000;
const IMPORT_BATCH = 90;

export const pushHash = async token => 'h' + (await sha256(token)).slice(0, 40);
const validToken = value => (typeof value === 'string' && TOKEN.test(value) ? value : '');

function fieldsOf(body) {
  return {
    os: OS.includes(body.os || body.platform) ? (body.os || body.platform) : 'other',
    // the old pages send their OS as `platform`: a web device either way until an app says otherwise
    platform: body.app === true && PLATFORMS.includes(body.platform) ? body.platform : 'web',
    appVersion: VERSION.test(String(body.appVersion || '')) ? String(body.appVersion) : null
  };
}

const topicsOf = list => {
  const chosen = Array.isArray(list) ? TOPICS.filter(t => list.includes(t)) : TOPICS;
  return JSON.stringify(chosen);
};

/* ---------- visitors ---------- */

export async function pushSubscribe(ctx) {
  const body = ctx.body || {};
  const token = validToken(body.token);
  const previous = body.previous ? validToken(body.previous) : '';
  if (!token || (body.previous && !previous)) return { ok: false, code: 'invalid' };
  await limit(ctx, 'push.public', clientIp(ctx.request), 30, 60);
  await limit(ctx, 'push.public.day', 'all', 5000, 86400);
  const db = ctx.env.DB;
  const id = await pushHash(token);
  const now = Date.now();
  const f = fieldsOf(body);
  const oldId = previous && previous !== token ? await pushHash(previous) : '';
  const r = await retry(() => db.batch([
    // the same device again soon (a refresh, a second tab) writes nothing; an admin's row is never taken over
    db.prepare(`INSERT INTO push_devices (id, token, audience, platform, os, app_version, topics, created_ms, last_ms)
      SELECT ?, ?, 'public', ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM push_devices WHERE audience = 'public') < ? OR EXISTS (SELECT 1 FROM push_devices WHERE id = ?)
      ON CONFLICT(id) DO UPDATE SET platform = excluded.platform, os = excluded.os, app_version = excluded.app_version, last_ms = excluded.last_ms, fails = 0
      WHERE push_devices.audience = 'public' AND push_devices.last_ms < ?`)
      .bind(id, token, f.platform, f.os, f.appVersion, topicsOf(body.topics), now, now, PUBLIC_MAX, id, now - SEEN_MS),
    ...(oldId ? [db.prepare("DELETE FROM push_devices WHERE id = ? AND audience = 'public'").bind(oldId)] : []),
    db.prepare('SELECT audience FROM push_devices WHERE id = ?').bind(id)
  ]));
  const row = r[r.length - 1].results[0];
  if (!row) return { ok: false, code: 'full' };
  if (row.audience !== 'public') return { ok: false, code: 'invalid' };
  await linkAccount(ctx, id);
  return { ok: true };
}

/*
 * Phase 6 Step 4c: with the account's own token beside it, the device is that account's (a booker's reminder goes
 * there, decision 3). Without one, or a token that no longer opens a session, the device keeps what it had: signing
 * out never unlinks a phone by itself, and a visitor's row never needs an account.
 */
async function linkAccount(ctx, id) {
  if (!/^Bearer\s/i.test(ctx.request.headers.get('authorization') || '')) return;
  let account = null;
  try {
    // the account's own settings: a session is never stretched past what they allow
    ({ account } = await requireAccount(ctx, await gate(ctx)));
  } catch {
    return;
  }
  await retry(() => ctx.env.DB.prepare("UPDATE push_devices SET account_id = ? WHERE id = ? AND audience = 'public' AND account_id IS NOT ?").bind(account.id, id, account.id).run());
}

export async function pushUnsubscribe(ctx) {
  const token = validToken((ctx.body || {}).token);
  if (!token) return { ok: false, code: 'invalid' };
  await limit(ctx, 'push.public', clientIp(ctx.request), 30, 60);
  const id = await pushHash(token);
  await retry(() => ctx.env.DB.prepare("DELETE FROM push_devices WHERE id = ? AND audience = 'public'").bind(id).run());
  return { ok: true };
}

/* ---------- admins ---------- */

const deviceOut = (row, current) => ({ id: row.id.slice(0, 16), device: row.device || 'جهاز', platform: row.os, createdAt: row.created_ms, lastSeen: row.last_ms, current: row.id === current });

async function devicesOf(db, email, current) {
  const { results } = await retry(() => db.prepare("SELECT * FROM push_devices WHERE audience = 'admin' AND email = ? ORDER BY last_ms DESC").bind(email).all());
  return results.map(r => deviceOut(r, current));
}

const senderReady = env => !!env.FCM_SERVICE_ACCOUNT;
const refuse = (message, hint) => new ApiError('invalid', 'push', { message, hint });

/* POST /v1/admin/push/subscribe { token, previous?, os?, device? } → this device on, { devices } */
export async function adminPushSubscribe(ctx) {
  const db = ctx.env.DB;
  const body = ctx.body || {};
  const me = ctx.actor.email;
  const token = validToken(body.token);
  if (!token) throw refuse('رمز الإشعارات بتاع الجهاز ده مش مفهوم.', 'جرّب تقفل الإشعارات وتفتحها تاني.');
  const previous = body.previous ? validToken(body.previous) : '';
  const id = await pushHash(token);
  const now = Date.now();
  const f = fieldsOf(body);
  const device = String(body.device == null ? '' : body.device).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 40) || 'جهاز';
  const [same, mine, all] = await retry(() => db.batch([
    db.prepare('SELECT audience FROM push_devices WHERE id = ?').bind(id),
    db.prepare("SELECT id FROM push_devices WHERE audience = 'admin' AND email = ? ORDER BY last_ms").bind(me),
    db.prepare("SELECT COUNT(*) AS n FROM push_devices WHERE audience = 'admin'")
  ]));
  const existing = same.results[0];
  if (existing && existing.audience === 'public') throw refuse('الجهاز ده مسجل لإشعارات الموقع بنفس الرمز.', 'افتح لوحة التحكم من التطبيق بتاعها (مش من الموقع) وفعّل الإشعارات تاني.');
  const remove = [];
  if (previous && previous !== token) {
    const old = await pushHash(previous);
    if (mine.results.some(r => r.id === old)) remove.push(old);
  }
  if (!existing) {
    // a full set: the device not seen for the longest makes room
    const others = mine.results.map(r => r.id).filter(x => !remove.includes(x));
    while (others.length >= PER_ADMIN) remove.push(others.shift());
    if (all.results[0].n - remove.length >= ADMIN_MAX) throw refuse('وصلنا لأقصى عدد أجهزة لإشعارات لوحة التحكم.', 'شيل جهاز مش مستخدم من «أجهزتي».');
  }
  await retry(() => db.batch([
    // the same device may have changed hands: it is the signed-in admin's now
    db.prepare(`INSERT INTO push_devices (id, token, audience, email, platform, os, app_version, device, created_ms, last_ms) VALUES (?, ?, 'admin', ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET email = excluded.email, platform = excluded.platform, os = excluded.os, app_version = excluded.app_version, device = excluded.device, last_ms = excluded.last_ms, fails = 0
      WHERE push_devices.audience = 'admin'`).bind(id, token, me, f.platform, f.os, f.appVersion, device, now, now),
    ...remove.map(x => db.prepare("DELETE FROM push_devices WHERE id = ? AND audience = 'admin'").bind(x))
  ]));
  return { on: true, devices: await devicesOf(db, me, id), configured: senderReady(ctx.env) };
}

/* POST /v1/admin/push/unsubscribe { token }: this device off, only if it is the signed-in admin's */
export async function adminPushUnsubscribe(ctx) {
  const db = ctx.env.DB;
  const me = ctx.actor.email;
  const token = validToken((ctx.body || {}).token);
  if (token) await retry(async () => db.prepare("DELETE FROM push_devices WHERE id = ? AND audience = 'admin' AND email = ?").bind(await pushHash(token), me).run());
  return { on: false, devices: await devicesOf(db, me, '') };
}

/* POST /v1/admin/push/devices { token? }: a token never goes in a URL */
export async function adminPushDevices(ctx) {
  const db = ctx.env.DB;
  const token = validToken((ctx.body || {}).token);
  const current = token ? await pushHash(token) : '';
  const devices = await devicesOf(db, ctx.actor.email, current);
  return { devices, on: !!current && devices.some(d => d.current), configured: senderReady(ctx.env), max: PER_ADMIN };
}

/* POST /v1/admin/push/remove { id }: one of my devices off (the id the list gave) */
export async function adminPushRemove(ctx) {
  const db = ctx.env.DB;
  const id = String((ctx.body || {}).id || '');
  if (!REMOVE_ID.test(id)) throw refuse('الجهاز ده مش معروف.', 'اعمل Refresh للصفحة.');
  await retry(() => db.prepare("DELETE FROM push_devices WHERE audience = 'admin' AND email = ? AND substr(id, 1, 16) = ?").bind(ctx.actor.email, id).run());
  return { devices: await devicesOf(db, ctx.actor.email, ''), max: PER_ADMIN };
}

/* ---------- the move from Apps Script ---------- */

export async function importDevices(env, sent, { apply, now = Date.now() }) {
  const db = env.DB;
  const stamp = v => { const n = Number(v); return n > 0 ? Math.round(n) : now; };
  const clean = [];
  const problems = [];
  for (const [audience, rows] of [['public', sent.public], ['admin', sent.admin]]) {
    for (const row of Array.isArray(rows) ? rows : []) {
      const token = validToken(row.token);
      if (!token) { problems.push(audience + ': a token in the wrong shape'); continue; }
      const email = audience === 'admin' ? String(row.email || '').trim().toLowerCase() : null;
      if (audience === 'admin' && !email) { problems.push('admin: a device with no email'); continue; }
      clean.push({ id: await pushHash(token), token, audience, email, os: OS.includes(row.platform) ? row.platform : 'other', device: audience === 'admin' ? String(row.device || '').slice(0, 40) : null, created: stamp(row.createdAt), last: stamp(row.lastSeen), fails: Math.max(0, Number(row.fails) || 0) });
    }
  }
  const counts = audience => clean.filter(c => c.audience === audience).length;
  const report = { at: now, mode: apply ? 'apply' : 'dry', state: 'ok', public: counts('public'), admin: counts('admin'), added: 0, problems: problems.slice(0, 20), skipped: problems.length };
  if (!apply) return report;
  for (let i = 0; i < clean.length; i += IMPORT_BATCH) {
    const part = clean.slice(i, i + IMPORT_BATCH);
    const done = await retry(() => db.batch(part.map(c => db.prepare(`INSERT INTO push_devices (id, token, audience, email, os, device, created_ms, last_ms, fails) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
      .bind(c.id, c.token, c.audience, c.email, c.os, c.device, c.created, c.last, c.fails))));
    report.added += done.reduce((n, r) => n + r.meta.changes, 0);
  }
  report.state = 'applied';
  return report;
}

/* the minute cron: a copy someone asked for through the setting. One try per request */
export async function pushImportTick(env, doFetch = (...a) => fetch(...a), now = Date.now()) {
  const db = env.DB;
  const asked = await retry(() => db.prepare("SELECT value FROM settings WHERE key = 'PUSH_IMPORT'").first('value'));
  if (asked !== 'dry' && asked !== 'apply') return null;
  await retry(() => settingStmt(db, 'PUSH_IMPORT', '', now, 'worker').run());
  let report;
  try {
    const sent = await askAppsScript({ env, fetch: doFetch }, { call: 'pushExport' });
    report = await importDevices(env, sent, { apply: asked === 'apply', now });
  } catch (err) {
    report = { at: now, mode: asked, state: 'failed', problems: [String(err && err.message).slice(0, 300)] };
  }
  await retry(() => settingStmt(db, 'PUSH_IMPORT_REPORT', JSON.stringify(report), now, 'worker').run());
  logLine({ kind: 'cron', job: 'push.import', mode: asked, state: report.state });
  return report;
}

/* who keeps the devices (the panel follows it, like the competitions' writer) */
export async function pushWriter(db) {
  const row = await retry(() => db.prepare("SELECT value FROM settings WHERE key = 'PUSH_DEVICES'").first());
  return row && row.value === 'worker' ? 'worker' : 'apps-script';
}
