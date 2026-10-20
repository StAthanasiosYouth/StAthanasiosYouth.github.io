/*
 * «إعدادات الإشعارات», «تنبيهاتي», «حالة النظام» (Phase 1.5 step 7,
 * BOOKING-PHASE1-COMPLETION-PLAN §4.4). The router (router.js) reads what
 * these write; nothing here sends anything.
 *
 *   GET  /v1/admin/notify/settings   notifications.view    every type with its settings, the switches, the budget
 *   POST /v1/admin/notify/settings   notifications.manage  (Primary by default) — a critical, audited change
 *   GET  /v1/admin/notify/me         any admin             the types I can receive, with my own choices
 *   POST /v1/admin/notify/me         any admin             my choices (never on a locked type)
 *   GET  /v1/admin/notify/status     notifications.view    delivery per day, last success, Gmail, quota, critical waiting
 *   POST /v1/admin/notify/outbox/:id/dismiss  notifications.manage  a waiting critical row, explicitly given up
 *
 * Turning the router on removes NOTIFY_SINCE: its next tick marks the
 * waiting backlog instead of sending it (no flood).
 */

import { ApiError } from '../lib/http.js';
import { retry, cairoText } from '../lib/db.js';
import { activityStmt } from '../lib/activity.js';
import { heldScope } from '../lib/perms.js';
import { allTypes, defaultsOf } from './catalog.js';
import { readSettings } from './router.js';
import { budget, quotaOf } from './email.js';
import { gmailConfigured } from './gmail.js';
import { sources, messageFor } from './claim.js';

const EMAIL_MODES = ['off', 'immediate', 'summary'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const BUDGET_KEYS = { target: 'MAIL_DAILY_TARGET', admin: 'MAIL_ADMIN_BUDGET', critical: 'MAIL_RESERVE_CRITICAL', otp: 'MAIL_RESERVE_OTP' };
const invalid = field => new ApiError('invalid', field, { field });
const DAY = 864e5;

async function typeSettings(db) {
  const rows = (await retry(() => db.prepare('SELECT type, email_mode, push, recipients, locked FROM notify_settings').all())).results;
  const out = new Map();
  for (const r of rows) {
    let rec = {};
    try { rec = JSON.parse(r.recipients || '{}') || {}; } catch { rec = {}; }
    out.set(r.type, { email: r.email_mode, push: !!r.push, mode: rec.mode === 'named' ? 'named' : 'all', include: rec.include || [], exclude: rec.exclude || [], locked: !!r.locked });
  }
  return out;
}

function effective(t, saved) {
  const d = defaultsOf(t.level);
  const s = saved.get(t.key);
  return {
    key: t.key, level: t.level, perm: t.perm, module: t.module,
    push: s ? s.push : d.push, email: s ? s.email : d.email,
    mode: s ? s.mode : 'all', include: s ? s.include : [], exclude: s ? s.exclude : [], locked: s ? s.locked : false, custom: !!s
  };
}

async function admins(db) {
  return (await retry(() => db.prepare('SELECT email, name, role FROM admins WHERE active = 1 ORDER BY role = \'primary\' DESC, email').all())).results
    .map(a => ({ email: a.email, name: a.name || a.email.split('@')[0], primary: a.role === 'primary' }));
}

export async function notifySettingsGet(ctx) {
  const db = ctx.env.DB;
  const s = await retry(() => readSettings(db));
  const saved = await typeSettings(db);
  return {
    canManage: (await heldScope(ctx, 'notifications.manage')) === 'all',
    router: s.NOTIFY_ROUTER === '1', email: s.NOTIFY_EMAIL === '1', gmail: gmailConfigured(ctx.env),
    summaryTime: s.NOTIFY_SUMMARY_TIME || '21:00', budget: budget(s),
    admins: await admins(db),
    types: allTypes().map(t => effective(t, saved))
  };
}

export async function notifySettingsSave(ctx) {
  const db = ctx.env.DB;
  const body = ctx.body || {};
  const known = new Map(allTypes().map(t => [t.key, t]));
  const emails = new Set((await admins(db)).map(a => a.email));
  const now = Date.now();
  const stmts = [];
  const changed = [];
  const setting = (key, value) => {
    stmts.push(db.prepare('INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by').bind(key, value, now, ctx.actor.email));
    changed.push(key);
  };

  if (body.types !== undefined) {
    if (!body.types || typeof body.types !== 'object' || Array.isArray(body.types)) throw invalid('types');
    for (const [key, v] of Object.entries(body.types)) {
      if (!known.has(key) || !v || typeof v !== 'object') throw invalid('types');
      if (v.reset === true) {
        stmts.push(db.prepare('DELETE FROM notify_settings WHERE type = ?').bind(key));
        changed.push(key);
        continue;
      }
      if (!EMAIL_MODES.includes(v.email) || typeof v.push !== 'boolean' || typeof v.locked !== 'boolean') throw invalid('types');
      const list = x => (Array.isArray(x) ? [...new Set(x.map(e => String(e).toLowerCase()))] : []);
      const include = list(v.include), exclude = list(v.exclude);
      if ([...include, ...exclude].some(e => !emails.has(e))) throw invalid('recipients');
      const recipients = JSON.stringify({ mode: v.mode === 'named' ? 'named' : 'all', include, exclude });
      stmts.push(db.prepare(`INSERT INTO notify_settings (type, email_mode, push, recipients, locked, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(type) DO UPDATE SET email_mode = excluded.email_mode, push = excluded.push, recipients = excluded.recipients, locked = excluded.locked,
          updated_at = excluded.updated_at, updated_by = excluded.updated_by`).bind(key, v.email, v.push ? 1 : 0, recipients, v.locked ? 1 : 0, now, ctx.actor.email));
      changed.push(key);
    }
  }
  if (body.router !== undefined) {
    if (typeof body.router !== 'boolean') throw invalid('router');
    setting('NOTIFY_ROUTER', body.router ? '1' : '0');
    // switched on: the next tick marks the waiting backlog (no flood)
    if (body.router) stmts.push(db.prepare("DELETE FROM settings WHERE key = 'NOTIFY_SINCE'"));
  }
  if (body.email !== undefined) {
    if (typeof body.email !== 'boolean') throw invalid('email');
    setting('NOTIFY_EMAIL', body.email ? '1' : '0');
  }
  if (body.summaryTime !== undefined) {
    if (!TIME_RE.test(String(body.summaryTime))) throw invalid('summaryTime');
    setting('NOTIFY_SUMMARY_TIME', String(body.summaryTime));
  }
  if (body.budget !== undefined) {
    const b = body.budget || {};
    for (const [k, key] of Object.entries(BUDGET_KEYS)) {
      if (b[k] === undefined) continue;
      const n = Number(b[k]);
      if (!Number.isInteger(n) || n < 0 || n > 2000) throw invalid('budget.' + k);
      setting(key, String(n));
    }
    const all = budget({ ...(await readSettings(db)), ...Object.fromEntries(Object.entries(BUDGET_KEYS).filter(([k]) => b[k] !== undefined).map(([k, key]) => [key, String(b[k])])) });
    // Gmail's own limit is ~500 a day; the reserves must fit inside the target
    if (all.target > 450 || all.critical + all.otp > all.target || all.admin > all.target) throw invalid('budget');
  }
  if (!changed.length) return notifySettingsGet(ctx);
  stmts.push(activityStmt(db, {
    actor: ctx.actor.email, actorName: ctx.actor.name, action: 'notify.settings', entityType: 'settings', entityId: 'notifications',
    summary: 'غيّر إعدادات الإشعارات', changes: { fields: changed.slice(0, 20) }, severity: 'critical'
  }));
  await retry(() => db.batch(stmts));
  return notifySettingsGet(ctx);
}

/* the types this admin can receive (holds the permission; the Primary every critical) */
async function receivable(ctx) {
  const db = ctx.env.DB;
  const saved = await typeSettings(db);
  const primary = ctx.actor.role === 'primary';
  const out = [];
  for (const t of allTypes()) {
    if (!primary && (await heldScope(ctx, t.perm)) === '') continue;
    out.push(effective(t, saved));
  }
  return out;
}

export async function notifyMeGet(ctx) {
  const db = ctx.env.DB;
  const s = await retry(() => readSettings(db));
  const prefs = (await retry(() => db.prepare('SELECT type, channel, mode FROM notify_prefs WHERE email = ?').bind(ctx.actor.email).all())).results;
  const mine = {};
  for (const p of prefs) (mine[p.type] = mine[p.type] || {})[p.channel] = p.mode;
  const forced = ctx.actor.role === 'primary';
  return {
    email: s.NOTIFY_EMAIL === '1', router: s.NOTIFY_ROUTER === '1',
    types: (await receivable(ctx)).map(t => ({
      key: t.key, level: t.level, module: t.module, locked: t.locked || (forced && t.level === 'critical'),
      push: t.push ? ((mine[t.key] && mine[t.key].push) || 'immediate') : 'off', pushAllowed: t.push,
      emailMode: (mine[t.key] && mine[t.key].email) || t.email, emailDefault: t.email
    }))
  };
}

export async function notifyMeSave(ctx) {
  const db = ctx.env.DB;
  const prefs = ctx.body && ctx.body.prefs;
  if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) throw invalid('prefs');
  const types = new Map((await receivable(ctx)).map(t => [t.key, t]));
  const forced = ctx.actor.role === 'primary';
  const now = Date.now();
  const stmts = [];
  for (const [key, v] of Object.entries(prefs)) {
    const t = types.get(key);
    if (!t || !v || typeof v !== 'object') throw invalid('prefs');
    if (t.locked || (forced && t.level === 'critical')) continue;   // mandatory: their choice doesn't count
    for (const channel of ['push', 'email']) {
      if (v[channel] === undefined) continue;
      const mode = String(v[channel]);
      if (!(channel === 'push' ? ['off', 'immediate'] : EMAIL_MODES).includes(mode)) throw invalid('prefs');
      stmts.push(db.prepare(`INSERT INTO notify_prefs (email, type, channel, mode, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(email, type, channel) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at`).bind(ctx.actor.email, key, channel, mode, now));
    }
  }
  if (stmts.length) await retry(() => db.batch(stmts));
  return notifyMeGet(ctx);
}

export async function notifyStatus(ctx) {
  const db = ctx.env.DB;
  const now = Date.now();
  const s = await retry(() => readSettings(db));
  const since = now - 7 * DAY;
  const quotaNow = await quotaOf(db, now);
  const [perDay, last, waiting, health] = await retry(() => db.batch([
    db.prepare("SELECT strftime('%Y-%m-%d', created_ms / 1000, 'unixepoch') AS day, channel, status, COUNT(*) AS n FROM notify_outbox WHERE created_ms >= ? GROUP BY day, channel, status ORDER BY day DESC").bind(since),
    db.prepare("SELECT channel, MAX(sent_ms) AS at FROM notify_outbox WHERE status = 'sent' GROUP BY channel"),
    db.prepare("SELECT id, recipient, channel, kind, status, attempts, error, created_ms, activity_ids, level FROM notify_outbox WHERE level = 'critical' AND status IN ('queued', 'failed', 'deferred_quota', 'dead') ORDER BY created_ms DESC LIMIT 30"),
    db.prepare("SELECT value FROM settings WHERE key = 'GMAIL_HEALTH'")
  ]));
  const days = {};
  for (const r of perDay.results) {
    const d = (days[r.day] = days[r.day] || { day: r.day, push: {}, email: {} });
    d[r.channel][r.status] = r.n;
  }
  const src = await sources(db, waiting.results.flatMap(r => { try { return JSON.parse(r.activity_ids) || []; } catch { return []; } }));
  let gmail = { ok: false, configured: gmailConfigured(ctx.env) };
  try { if (health.results[0]) gmail = { ...JSON.parse(health.results[0].value), configured: gmailConfigured(ctx.env) }; } catch { /* keep */ }
  return {
    canManage: (await heldScope(ctx, 'notifications.manage')) === 'all',
    router: s.NOTIFY_ROUTER === '1', email: s.NOTIFY_EMAIL === '1',
    days: Object.values(days),
    lastSuccess: Object.fromEntries(last.results.map(r => [r.channel, r.at])),
    gmail,
    // the last 24 hours (rolling, like Gmail's own limit)
    quota: { ...quotaNow, ...budget(s), window: 'rolling-24h' },
    critical: waiting.results.map(r => {
      const m = messageFor(r, src);
      return { id: r.id, recipient: r.recipient, channel: r.channel, status: r.status, attempts: r.attempts, error: r.error || '', at: r.created_ms, title: m ? m.title : r.kind };
    })
  };
}

export async function notifyDismiss(ctx) {
  const db = ctx.env.DB;
  const id = String(ctx.params.id || '');
  if (!/^ntf-[0-9a-f]{6,}$/.test(id)) throw new ApiError('not_found', 'id');
  const r = await retry(() => db.batch([
    db.prepare("UPDATE notify_outbox SET status = 'dismissed', error = ? WHERE id = ? AND status IN ('queued', 'failed', 'deferred', 'deferred_quota', 'dead')").bind('dismissed by ' + ctx.actor.email, id),
    activityStmt(db, { actor: ctx.actor.email, actorName: ctx.actor.name, action: 'notify.dismiss', entityType: 'notify', entityId: id, summary: 'شال تنبيه مستني من القايمة' })
  ]));
  if (!r[0].meta.changes) throw new ApiError('not_found', 'id');
  return notifyStatus(ctx);
}

