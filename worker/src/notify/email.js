/*
 * Email delivery (Phase 1.5 step 6, BOOKING-PHASE1-COMPLETION-PLAN §4.4):
 * the router's email rows → Gmail (gmail.js), with the daily budget, the
 * reserves, the daily summary and the token health.
 *
 * - When: the minute cron (tick.js) leases due rows (10 min) and hands them
 *   to a queue job ('notify.email', jobs.js); without a queue, it sends them
 *   itself. A row is idempotent: only a leased, unsent row is sent.
 * - Budget per Cairo day (notify_quota): target MAIL_DAILY_TARGET (~400,
 *   within Gmail's real limit), MAIL_RESERVE_OTP kept for verification codes
 *   (Phase 5A), MAIL_RESERVE_CRITICAL kept for critical rows; admin mail that
 *   isn't critical stays within MAIL_ADMIN_BUDGET − the critical reserve.
 *   Short: routine, then important, go into the summary; critical uses the
 *   reserve, then waits as deferred_quota (retried each window, never
 *   expires; it also went by push).
 * - Retries: backoff, dead after 5 → a critical «notify.failed» (push only).
 * - Content: Arabic RTL, short HTML + plain text: who, what, when (Cairo),
 *   changed field NAMES, one link to the panel (no token in it). No visitor
 *   name, phone, payment number or amount. The outbox keeps no body.
 */

import { retry, cairoText } from '../lib/db.js';
import { activityStmt } from '../lib/activity.js';
import { readSettings, nextSummaryMs } from './router.js';
import { sources, messageFor, deadStmts, backoffMs, MAX_ATTEMPTS } from './claim.js';
import { gmailConfigured, sendMail, accessToken, GmailError } from './gmail.js';

export const SEND_BATCH = 10;
export const LEASE_MS = 10 * 60000;
const PANEL = 'https://stathanasiosyouth.github.io';
const HOUR = 3600000;

const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);

export function budget(s) {
  return {
    target: num(s.MAIL_DAILY_TARGET, 400),
    admin: num(s.MAIL_ADMIN_BUDGET, 150),
    critical: num(s.MAIL_RESERVE_CRITICAL, 50),
    otp: num(s.MAIL_RESERVE_OTP, 50)
  };
}

/* may one more email of `level` go today? q = { total, critical, otp } */
export function allowed(level, q, b) {
  if (level === 'otp') return q.total < b.target;
  if (level === 'critical') return q.total < b.target - b.otp;
  const adminNonCritical = q.total - q.critical - q.otp;
  return adminNonCritical < Math.max(0, b.admin - b.critical) && q.total < b.target - b.otp - b.critical;
}

/* the email of one outbox row: { subject, text, html } */
export function render(m, { summary = false } = {}) {
  const link = PANEL + m.url;
  const lines = summary ? m.lines : m.lines.slice(-5);
  const subject = summary ? 'ملخص النهارده في لوحة التحكم (' + m.lines.length + ')' : 'لوحة التحكم: ' + m.title;
  const text = [
    summary ? 'ملخص النشاط في لوحة تحكم الأسرة:' : m.title,
    summary ? '' : m.body,
    '',
    ...lines.map(l => '• ' + l.text + (l.cairo ? ' — ' + l.cairo : '')),
    '',
    'افتح لوحة التحكم: ' + link,
    '',
    'إيميل تلقائي من لوحة تحكم شباب أثناسيوس. تقدر تغيّر اللي يوصلك من «تنبيهاتي».'
  ].join('\n');
  const html = '<!doctype html><html lang="ar" dir="rtl"><body style="margin:0;padding:16px;background:#f6f4ef;font-family:Tahoma,Arial,sans-serif;color:#1d2433;direction:rtl;text-align:right">' +
    '<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:20px;border:1px solid #e6e1d6">' +
    '<p style="margin:0 0 6px;font-size:13px;color:#8a6d1f">لوحة تحكم شباب أثناسيوس</p>' +
    '<h1 style="margin:0 0 8px;font-size:18px;line-height:1.5">' + esc(summary ? 'ملخص النشاط' : m.title) + '</h1>' +
    (summary ? '' : '<p style="margin:0 0 12px;font-size:14px;color:#4a5263">' + esc(m.body) + '</p>') +
    '<ul style="margin:0 0 16px;padding:0 18px 0 0;font-size:14px;line-height:1.8">' +
    lines.map(l => '<li>' + esc(l.text) + (l.cairo ? ' <span style="color:#8a8f99">— ' + esc(l.cairo) + '</span>' : '') + '</li>').join('') + '</ul>' +
    '<a href="' + esc(link) + '" style="display:inline-block;background:#c9a24a;color:#1d2433;text-decoration:none;font-weight:bold;padding:10px 18px;border-radius:10px">افتح لوحة التحكم</a>' +
    '<p style="margin:16px 0 0;font-size:12px;color:#8a8f99">إيميل تلقائي. تقدر تغيّر اللي يوصلك من «تنبيهاتي».</p>' +
    '</div></body></html>';
  return { subject, text, html };
}

async function quotaOf(db, day) {
  return (await retry(() => db.prepare('SELECT total, critical, otp FROM notify_quota WHERE day = ?').bind(day).first())) || { total: 0, critical: 0, otp: 0 };
}
const countStmt = (db, day, level) => db.prepare(`INSERT INTO notify_quota (day, total, critical, otp) VALUES (?, 1, ?, 0)
  ON CONFLICT(day) DO UPDATE SET total = total + 1, critical = critical + excluded.critical`).bind(day, level === 'critical' ? 1 : 0);

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
  const day = cairoText(now).slice(0, 10);
  if (!allowed('important', await quotaOf(db, day), budget(s))) {
    // even the summary waits for tomorrow's budget
    await retry(() => db.prepare(`UPDATE notify_outbox SET next_ms = ? WHERE id IN (${all.map(() => '?').join(',')})`).bind(nextSummaryMs(s.NOTIFY_SUMMARY_TIME, nextDayMs(now)), ...all.map(p => p.id)).run());
    return 'deferred';
  }
  await sendMail(env, { to: row.recipient, ...render(m, { summary: true }) });
  await retry(() => db.batch([
    db.prepare(`UPDATE notify_outbox SET status = 'sent', sent_ms = ?, error = NULL WHERE id IN (${all.map(() => '?').join(',')})`).bind(now, ...all.map(p => p.id)),
    countStmt(db, day, 'important')
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
    const day = cairoText(now).slice(0, 10);
    try {
      if (row.status === 'deferred') {
        // one summary per recipient: it takes all their due rows at once
        if (summarized.has(row.recipient)) continue;
        summarized.add(row.recipient);
        out[await sendSummary(env, row, now, s)]++;
        continue;
      }
      const level = row.level || 'routine';
      if (!allowed(level, await quotaOf(db, day), b)) {
        if (level === 'critical') {
          await retry(() => db.prepare("UPDATE notify_outbox SET status = 'deferred_quota', next_ms = ?, error = 'quota' WHERE id = ?").bind(nextDayMs(now), row.id).run());
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
      await sendMail(env, { to: row.recipient, ...render(m) });
      await retry(() => db.batch([
        db.prepare("UPDATE notify_outbox SET status = 'sent', sent_ms = ?, attempts = attempts + 1, error = NULL WHERE id = ?").bind(now, row.id),
        countStmt(db, day, level)
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
