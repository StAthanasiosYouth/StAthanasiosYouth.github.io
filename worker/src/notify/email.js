/*
 * Email delivery (Phase 1.5 step 6, BOOKING-PHASE1-COMPLETION-PLAN §4.4):
 * the router's email rows → Gmail (gmail.js), with the daily budget, the
 * reserves, the daily summary and the token health.
 *
 * - When: the minute cron (tick.js) leases due rows (10 min) and hands them
 *   to a queue job ('notify.email', jobs.js); without a queue, it sends them
 *   itself. A row is idempotent: only a leased, unsent row is sent.
 * - Budget over a ROLLING 24 hours, like Gmail's own limit (notify_quota keeps
 *   one row per UTC hour, 'h:YYYY-MM-DDTHH'; the window is the last 24 rows):
 *   target MAIL_DAILY_TARGET (~400, within Gmail's real limit), shared with
 *   member email. Reservations in priority order, not caps (allowed() below;
 *   docs/MEMBER-NOTIFICATIONS-PLAN.md §5).
 *   Short: routine, then important, go into the summary; critical uses the
 *   reserve, then waits as deferred_quota (retried each window, never
 *   expires; it also went by push).
 * - Retries: backoff, dead after 5 → a critical «notify.failed» (push only).
 * - Content: templates.js (Arabic RTL, HTML + plain text, who / what / when,
 *   one visible panel link, why the reader gets it). No visitor name, phone,
 *   payment number or amount. The outbox keeps no body.
 */

import { retry, cairoText } from '../lib/db.js';
import { activityStmt } from '../lib/activity.js';
import { readSettings, nextSummaryMs } from './router.js';
import { sources, messageFor, deadStmts, backoffMs, MAX_ATTEMPTS } from './claim.js';
import { gmailConfigured, sendMail, accessToken, GmailError } from './gmail.js';
import { alertEmail, summaryEmail } from './templates.js';

export const SEND_BATCH = 10;
export const LEASE_MS = 10 * 60000;
const HOUR = 3600000;

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);

export function budget(s) {
  return {
    target: num(s.MAIL_DAILY_TARGET, 400),
    admin: num(s.MAIL_ADMIN_BUDGET, 120),
    critical: num(s.MAIL_RESERVE_CRITICAL, 50),
    otp: num(s.MAIL_RESERVE_OTP, 100),
    member: num(s.MAIL_RESERVE_MEMBER, 100),
    bulkPerHour: num(s.MAIL_BULK_PER_HOUR, 30)
  };
}

/* the classes that hold room, highest first; member_bulk and admin routine share what is left */
const RESERVED = [['otp', 'otp', 'otp'], ['critical', 'critical', 'critical'], ['member_tx', 'member_tx', 'member'], ['important', 'admin', 'admin']];

/*
 * May one more email of this class go? (§5, owner D4.) Allowed while the total stays under the
 * target minus the UNUSED reservations of every class above it. A reservation protects room;
 * it never caps its class while room is free. OTP looks only at the target.
 */
export function allowed(level, q, b) {
  if (level === 'otp') return q.total < b.target;
  let held = 0;
  for (const [cls, counter, reserve] of RESERVED) {
    if (cls === level) break;
    held += Math.max(0, b[reserve] - (q[counter] || 0));
  }
  return q.total < b.target - held;
}

/* the email of one outbox row: { subject, text, html } (templates.js) */
export function render(m, { summary = false, level = 'important', kind = '', day = '' } = {}) {
  return summary ? summaryEmail(m, day) : alertEmail(m, { level, kind });
}

/* the hour bucket of a moment (UTC): 'h:2026-10-20T08' */
export const hourKey = ms => 'h:' + new Date(ms).toISOString().slice(0, 13);

/* emails sent in the rolling 24 hours ending now (this hour + the 23 before it), per class */
export async function quotaOf(db, now = Date.now()) {
  const r = await retry(() => db.prepare("SELECT COALESCE(SUM(total), 0) AS total, COALESCE(SUM(critical), 0) AS critical, COALESCE(SUM(otp), 0) AS otp, COALESCE(SUM(admin), 0) AS admin, COALESCE(SUM(member_tx), 0) AS member_tx, COALESCE(SUM(member_bulk), 0) AS member_bulk FROM notify_quota WHERE day LIKE 'h:%' AND day >= ?")
    .bind(hourKey(now - 23 * HOUR)).first());
  return r || { total: 0, critical: 0, otp: 0, admin: 0, member_tx: 0, member_bulk: 0 };
}
/* the next moment the window frees room: the oldest hour leaves it */
const nextWindowMs = now => (Math.floor(now / HOUR) + 1) * HOUR + 60000;
const COUNTER = { critical: 'critical', otp: 'otp', important: 'admin', member_tx: 'member_tx', member_bulk: 'member_bulk' };
export const countStmt = (db, day, level) => {
  const col = COUNTER[level];
  return col
    ? db.prepare(`INSERT INTO notify_quota (day, total, ${col}) VALUES (?, 1, 1) ON CONFLICT(day) DO UPDATE SET total = total + 1, ${col} = ${col} + 1`).bind(day)
    : db.prepare('INSERT INTO notify_quota (day, total) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET total = total + 1').bind(day);
};

/* the next Cairo midnight after `now` (a new budget) */
function nextDayMs(now) {
  let t = now + 60000;
  const today = cairoText(now).slice(0, 10);
  while (cairoText(t).slice(0, 10) === today) t += 15 * 60000;
  return t;
}

/* tick: lease the due email rows → [ids] (they go to the queue, or are sent here) */
export async function leaseDue(env, now = Date.now()) {
  const db = env.DB;
  const s = await retry(() => readSettings(db));
  if (s.NOTIFY_EMAIL !== '1' || !gmailConfigured(env)) return [];
  const rows = (await retry(() => db.prepare(`SELECT id FROM notify_outbox WHERE channel = 'email' AND status IN ('queued', 'failed', 'deferred', 'deferred_quota') AND next_ms <= ?
    ORDER BY CASE level WHEN 'critical' THEN 0 WHEN 'important' THEN 1 ELSE 2 END, created_ms LIMIT ?`).bind(now, SEND_BATCH).all())).results;
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  await retry(() => db.prepare(`UPDATE notify_outbox SET next_ms = ? WHERE id IN (${ids.map(() => '?').join(',')})`).bind(now + LEASE_MS, ...ids).run());
  return ids;
}

/* one recipient's due summary rows (and quota-deferred ones) → one email */
async function sendSummary(env, row, now, s) {
  const db = env.DB;
  const peers = (await retry(() => db.prepare("SELECT id, activity_ids, level, kind FROM notify_outbox WHERE channel = 'email' AND recipient = ? AND status = 'deferred' AND next_ms <= ?").bind(row.recipient, now + LEASE_MS).all())).results;
  const all = peers.some(p => p.id === row.id) ? peers : [row, ...peers];
  const ids = all.flatMap(p => { try { return JSON.parse(p.activity_ids) || []; } catch { return []; } });
  const src = await sources(db, ids);
  const m = messageFor({ ...row, activity_ids: JSON.stringify(ids) }, src);
  if (!m) {
    await retry(() => db.prepare(`UPDATE notify_outbox SET status = 'dismissed', error = 'activity gone' WHERE id IN (${all.map(() => '?').join(',')})`).bind(...all.map(p => p.id)).run());
    return 'dismissed';
  }
  if (!allowed('important', await quotaOf(db, now), budget(s))) {
    // even the summary waits for tomorrow's budget
    await retry(() => db.prepare(`UPDATE notify_outbox SET next_ms = ? WHERE id IN (${all.map(() => '?').join(',')})`).bind(nextSummaryMs(s.NOTIFY_SUMMARY_TIME, nextDayMs(now)), ...all.map(p => p.id)).run());
    return 'deferred';
  }
  await sendMail(env, { to: row.recipient, ...render(m, { summary: true, day: cairoText(now).slice(0, 10) }) });
  await retry(() => db.batch([
    db.prepare(`UPDATE notify_outbox SET status = 'sent', sent_ms = ?, error = NULL WHERE id IN (${all.map(() => '?').join(',')})`).bind(now, ...all.map(p => p.id)),
    countStmt(db, hourKey(now), 'important')
  ]));
  return 'sent';
}

/* sends leased rows by id (the queue job, or the tick) → { sent, deferred, failed, dead } */
export async function sendRows(env, ids, now = Date.now()) {
  const db = env.DB;
  const out = { sent: 0, deferred: 0, failed: 0, dead: 0, dismissed: 0 };
  if (!ids.length) return out;
  const s = await retry(() => readSettings(db));
  const b = budget(s);
  const rows = (await retry(() => db.prepare(`SELECT * FROM notify_outbox WHERE id IN (${ids.map(() => '?').join(',')}) AND channel = 'email' AND status IN ('queued', 'failed', 'deferred', 'deferred_quota')`).bind(...ids).all())).results;
  const summarized = new Set();
  for (const row of rows) {
    try {
      if (row.status === 'deferred') {
        // one summary per recipient: it takes all their due rows at once
        if (summarized.has(row.recipient)) continue;
        summarized.add(row.recipient);
        out[await sendSummary(env, row, now, s)]++;
        continue;
      }
      const level = row.level || 'routine';
      if (!allowed(level, await quotaOf(db, now), b)) {
        if (level === 'critical') {
          await retry(() => db.prepare("UPDATE notify_outbox SET status = 'deferred_quota', next_ms = ?, error = 'quota' WHERE id = ?").bind(nextWindowMs(now), row.id).run());
        } else {
          // into the recipient's summary (routine first, then important: the budget order)
          await retry(() => db.prepare("UPDATE notify_outbox SET status = 'deferred', next_ms = ?, error = 'quota → summary' WHERE id = ?").bind(nextSummaryMs(s.NOTIFY_SUMMARY_TIME, now), row.id).run());
        }
        out.deferred++;
        continue;
      }
      const src = await sources(db, (() => { try { return JSON.parse(row.activity_ids) || []; } catch { return []; } })());
      const m = messageFor(row, src);
      if (!m) {
        await retry(() => db.prepare("UPDATE notify_outbox SET status = 'dismissed', error = 'activity gone' WHERE id = ?").bind(row.id).run());
        out.dismissed++;
        continue;
      }
      await sendMail(env, { to: row.recipient, ...render(m, { level, kind: row.kind }) });
      await retry(() => db.batch([
        db.prepare("UPDATE notify_outbox SET status = 'sent', sent_ms = ?, attempts = attempts + 1, error = NULL WHERE id = ?").bind(now, row.id),
        countStmt(db, hourKey(now), level)
      ]));
      out.sent++;
    } catch (err) {
      const kind = err instanceof GmailError ? err.kind : 'transient';
      const attempts = row.attempts + 1;
      if (kind === 'quota') {
        // Google's own limit: critical waits for the next window; the rest goes into the summary
        const critical = row.level === 'critical';
        await retry(() => db.prepare('UPDATE notify_outbox SET status = ?, next_ms = ?, error = ? WHERE id = ?')
          .bind(critical ? 'deferred_quota' : 'deferred', critical ? now + HOUR : nextSummaryMs(s.NOTIFY_SUMMARY_TIME, nextDayMs(now)), 'gmail quota', row.id).run());
        out.deferred++;
      } else if (attempts >= MAX_ATTEMPTS || kind === 'rejected') {
        await retry(() => db.batch(deadStmts(db, row, kind + ': ' + err.message, now)));
        out.dead++;
      } else {
        await retry(() => db.prepare("UPDATE notify_outbox SET status = 'failed', attempts = ?, next_ms = ?, error = ? WHERE id = ?")
          .bind(attempts, now + backoffMs(attempts), (kind + ': ' + err.message).slice(0, 200), row.id).run());
        out.failed++;
      }
    }
  }
  return out;
}

/*
 * Hourly: can the token still be refreshed? → settings GMAIL_HEALTH. Going
 * from fine to broken writes ONE critical «gmail.token» row (push only).
 */
export async function tokenHealth(env, now = Date.now()) {
  const db = env.DB;
  let state;
  if (!gmailConfigured(env)) state = { ok: false, configured: false, at: now };
  else {
    try {
      await accessToken(env, { force: true, now });
      state = { ok: true, configured: true, at: now };
    } catch (err) {
      state = { ok: false, configured: true, at: now, error: String(err.message).slice(0, 120) };
    }
  }
  const before = await retry(() => db.prepare("SELECT value FROM settings WHERE key = 'GMAIL_HEALTH'").first('value'));
  let wasOk = true;
  try { wasOk = before ? JSON.parse(before).ok !== false : true; } catch { wasOk = true; }
  const stmts = [db.prepare("INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('GMAIL_HEALTH', ?, ?, 'cron') ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(JSON.stringify(state), now)];
  if (state.configured && !state.ok && wasOk) {
    stmts.push(activityStmt(db, { at: now, actor: 'system', action: 'gmail.token', entityType: 'notify', severity: 'critical', summary: 'صلاحية جيميل محتاجة تتجدد', changes: { error: state.error } }));
  }
  await retry(() => db.batch(stmts));
  return state;
}
