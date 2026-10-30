/*
 * Member email (docs/MEMBER-NOTIFICATIONS-PLAN.md §2–§9): separate from the admin
 * router; it shares only the Gmail sender and the rolling budget.
 *
 *   state change ─ same D1 batch ─▶ member_outbox row (memberEmailStmt; no body)
 *   cron (tick.js) ─▶ lease due rows by priority ─▶ re-check ─▶ budget ─▶ prefs ─▶ Gmail
 *
 * Recipient: the account's own email, only when verified and the account active.
 * Switches: MEMBER_EMAIL (everything here), and accounts_mode. The codes (OTP) are not
 * here: they go at once (account/mail.js). No email ever holds a password.
 *
 * STAGING ONLY: an @staging.invalid address sends nothing; the row is marked 'test inbox'.
 */

import { retry, cairoText } from '../lib/db.js';
import { randomId } from '../lib/hash.js';
import { activityStmt } from '../lib/activity.js';
import { gmailConfigured, sendMail, GmailError } from './gmail.js';
import { allowed, budget, quotaOf, hourKey, countStmt } from './email.js';
import { backoffMs, MAX_ATTEMPTS } from './claim.js';
import { securityEmail } from './templates.js';
import { isTestInbox } from '../account/mail.js';

const HOUR = 3600000;
const DAY = 24 * HOUR;
export const SEND_BATCH = 10;
export const LEASE_MS = 10 * 60000;
const MAX_RECEIPTS_PER_DAY = 10;

/*
 * What a member may mute (§8). Tier 0–1 can't be turned off; Tier 2 is on by default;
 * Tier 3 is opt-in. The groups' kinds arrive with their batches (bookings 3, results and store 4).
 */
export const GROUPS = {
  bookings: { tier: 2, label: 'إيصالات وتذكيرات الحجز' },
  results: { tier: 2, label: 'النتايج والنقط' },
  store: { tier: 2, label: 'إيصالات طلبات المتجر' },
  security: { tier: 3, label: 'دخول حسابك من جهاز جديد' }
};
export const ALWAYS_ON = ['رسايل أمان الحساب', 'تأكيد الحجوزات والمدفوعات وتغييرها', 'حالة طلبات المتجر'];

/* kind → tier, class, how long it may wait, its group, whether it still tells the truth, its email (§4.1, §9) */
export const KINDS = {
  'acct.new': { tier: 0, cls: 'member_tx', ttl: 72 * HOUR, notice: 'account_created' },
  'acct.pw': { tier: 0, cls: 'member_tx', ttl: 72 * HOUR, notice: 'password_reset_support', fresh: (p, row) => p.pw_version === row.entity_version },
  'acct.rec1': { tier: 0, cls: 'member_tx', ttl: 72 * HOUR, notice: 'recovery_used' },
  'acct.dev': { tier: 3, cls: 'member_tx', ttl: 72 * HOUR, group: 'security', notice: 'new_signin' }
};

/* the outbox row: goes in the SAME batch as the state change it reports (§3). A replay changes nothing. */
export function memberEmailStmt(db, { kind, participantId, entityType = null, entityId = null, entityVersion = null, dedupeKey, now = Date.now() }) {
  const k = KINDS[kind];
  if (!k) throw new Error('unknown member email: ' + kind);
  return db.prepare(`INSERT OR IGNORE INTO member_outbox (id, participant_id, kind, entity_type, entity_id, entity_version, tier, class, dedupe_key, status, next_ms, expires_ms, created_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`)
    .bind(randomId('mo-', 8), participantId, kind, entityType, entityId, entityVersion, k.tier, k.cls, dedupeKey, now, now + k.ttl, now);
}

async function memberSettings(db) {
  const { results } = await retry(() => db.prepare("SELECT key, value FROM settings WHERE key LIKE 'MAIL_%' OR key IN ('MEMBER_EMAIL', 'accounts_mode', 'GMAIL_HEALTH')").all());
  return Object.fromEntries(results.map(r => [r.key, r.value]));
}

const gmailOk = (env, s) => {
  if (!gmailConfigured(env)) return false;
  try { return !s.GMAIL_HEALTH || JSON.parse(s.GMAIL_HEALTH).ok !== false; } catch { return true; }
};

/* the minute cron: expired rows are marked, due rows leased by priority → [ids] */
export async function memberLease(env, now = Date.now()) {
  const db = env.DB;
  await retry(() => db.prepare("UPDATE member_outbox SET status = 'expired', error = NULL WHERE status IN ('queued', 'failed', 'deferred') AND expires_ms < ?").bind(now).run());
  const s = await memberSettings(db);
  if (s.MEMBER_EMAIL !== '1' || s.accounts_mode !== 'on') return [];
  const rows = (await retry(() => db.prepare(`SELECT id FROM member_outbox WHERE class <> 'otp' AND status IN ('queued', 'failed', 'deferred') AND next_ms <= ?
    ORDER BY CASE class WHEN 'member_tx' THEN 0 ELSE 1 END, tier, created_ms LIMIT ?`).bind(now, SEND_BATCH).all())).results;
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  await retry(() => db.prepare(`UPDATE member_outbox SET next_ms = ? WHERE id IN (${ids.map(() => '?').join(',')})`).bind(now + LEASE_MS, ...ids).run());
  return ids;
}

/* the email of one row, read at send time (§3) */
async function render(db, row) {
  const k = KINDS[row.kind];
  let device = '';
  if (row.entity_type === 'session' && row.entity_id) {
    device = await retry(() => db.prepare('SELECT device FROM account_sessions WHERE id = ?').bind(row.entity_id).first('device')) || '';
  }
  return securityEmail({ kind: k.notice, cairo: cairoText(row.created_ms), device, prefs: k.tier >= 2 });
}

const setStatus = (db, id, status, error, next = null) => retry(() => db.prepare('UPDATE member_outbox SET status = ?, error = ?, next_ms = COALESCE(?, next_ms) WHERE id = ?').bind(status, error, next, id).run());

/* a dead row: one routine alert an hour at most, never per row (§9) */
const deadAlertStmt = (db, now) => activityStmt(db, {
  id: 'act-md' + Math.floor(now / HOUR), orIgnore: true, at: now, actor: 'system', action: 'member.mail.dead', entityType: 'notify',
  summary: 'إيميل لعضو مقدرش يتبعت بعد كل المحاولات'
});

/* sends leased rows by id (the queue job, or the tick) → counts per result */
export async function memberSend(env, ids, now = Date.now()) {
  const db = env.DB;
  const out = { sent: 0, deferred: 0, failed: 0, dead: 0, suppressed: 0, superseded: 0 };
  if (!ids.length) return out;
  const s = await memberSettings(db);
  if (s.MEMBER_EMAIL !== '1' || s.accounts_mode !== 'on') return out;
  const b = budget(s);
  const rows = (await retry(() => db.prepare(`SELECT * FROM member_outbox WHERE id IN (${ids.map(() => '?').join(',')}) AND class <> 'otp' AND status IN ('queued', 'failed', 'deferred')`).bind(...ids).all())).results;
  for (const row of rows) {
    const k = KINDS[row.kind];
    try {
      if (!k) throw new GmailError('rejected', 'unknown kind');
      const p = await retry(() => db.prepare('SELECT * FROM participants WHERE id = ?').bind(row.participant_id).first());
      if (!p || p.status !== 'active' || !p.email_verified_at) {
        await setStatus(db, row.id, 'suppressed', 'recipient');
        out.suppressed++;
        continue;
      }
      if (k.fresh && !k.fresh(p, row)) {
        await setStatus(db, row.id, 'superseded', null);
        out.superseded++;
        continue;
      }
      if (k.group) {
        const mode = await retry(() => db.prepare('SELECT mode FROM member_prefs WHERE participant_id = ? AND grp = ?').bind(p.id, k.group).first('mode'));
        const on = mode ? mode === 'on' : k.tier === 2;
        if (!on) {
          await setStatus(db, row.id, 'suppressed', 'prefs');
          out.suppressed++;
          continue;
        }
      }
      // receipts a member can trigger themselves stay bounded (§9)
      if (k.tier === 2 && k.cls === 'member_tx') {
        const n = await retry(() => db.prepare("SELECT COUNT(*) AS n FROM member_outbox WHERE participant_id = ? AND tier = 2 AND class = 'member_tx' AND status = 'sent' AND sent_ms >= ?").bind(p.id, now - DAY).first('n'));
        if (n >= MAX_RECEIPTS_PER_DAY) {
          await setStatus(db, row.id, 'suppressed', 'receipts');
          out.suppressed++;
          continue;
        }
      }
      if (isTestInbox(env, p.email)) {
        await retry(() => db.prepare("UPDATE member_outbox SET status = 'sent', sent_ms = ?, attempts = attempts + 1, error = 'test inbox' WHERE id = ?").bind(now, row.id).run());
        out.sent++;
        continue;
      }
      if (!gmailOk(env, s)) {
        await setStatus(db, row.id, 'deferred', 'gmail', now + 10 * 60000);
        out.deferred++;
        continue;
      }
      const q = await quotaOf(db, now);
      if (!allowed(k.cls, q, b)) {
        await setStatus(db, row.id, 'deferred', 'quota', (Math.floor(now / HOUR) + 1) * HOUR + 60000);
        out.deferred++;
        continue;
      }
      if (k.cls === 'member_bulk') {
        const hour = await retry(() => db.prepare('SELECT member_bulk FROM notify_quota WHERE day = ?').bind(hourKey(now)).first('member_bulk'));
        if ((hour || 0) >= b.bulkPerHour) {
          await setStatus(db, row.id, 'deferred', 'drip', (Math.floor(now / HOUR) + 1) * HOUR + 60000);
          out.deferred++;
          continue;
        }
      }
      await sendMail(env, { to: p.email, ...(await render(db, row)), now });
      await retry(() => db.batch([
        db.prepare("UPDATE member_outbox SET status = 'sent', sent_ms = ?, attempts = attempts + 1, error = NULL WHERE id = ?").bind(now, row.id),
        countStmt(db, hourKey(now), k.cls)
      ]));
      out.sent++;
    } catch (err) {
      const kind = err instanceof GmailError ? err.kind : 'transient';
      const attempts = row.attempts + 1;
      const reason = (kind + ': ' + String(err.message)).slice(0, 200);
      if (kind === 'quota') {
        await setStatus(db, row.id, 'deferred', 'gmail quota', now + HOUR);
        out.deferred++;
      } else if (attempts >= MAX_ATTEMPTS || kind === 'rejected') {
        await retry(() => db.batch([
          db.prepare("UPDATE member_outbox SET status = 'dead', attempts = ?, error = ? WHERE id = ?").bind(attempts, reason, row.id),
          deadAlertStmt(db, now)
        ]));
        out.dead++;
      } else {
        await retry(() => db.prepare("UPDATE member_outbox SET status = 'failed', attempts = ?, next_ms = ?, error = ? WHERE id = ?").bind(attempts, now + backoffMs(attempts), reason, row.id).run());
        out.failed++;
      }
    }
  }
  return out;
}

/* «حالة النظام»: the last 24 hours per class and status, the switches, the sign-in form's budget */
export async function memberStatus(env, now = Date.now()) {
  const db = env.DB;
  const day = Math.floor(now / 1000 / 86400) * 86400;
  const [perClass, last, sw, discovery, none, wide] = await retry(() => db.batch([
    db.prepare('SELECT class, status, COUNT(*) AS n FROM member_outbox WHERE created_ms >= ? GROUP BY class, status').bind(now - DAY),
    db.prepare("SELECT MAX(sent_ms) AS at FROM member_outbox WHERE status = 'sent'"),
    db.prepare("SELECT key, value FROM settings WHERE key IN ('MEMBER_EMAIL', 'OTP_EMAIL', 'accounts_mode', 'discovery_daily_cap')"),
    db.prepare("SELECT COALESCE(SUM(count), 0) AS n FROM rate_limits WHERE key LIKE 'acct.discover.all:%' AND window = ?").bind(day),
    db.prepare("SELECT COALESCE(SUM(count), 0) AS n FROM rate_limits WHERE key LIKE 'acct.discover.none:%' AND window = ?").bind(day),
    db.prepare("SELECT COUNT(*) AS n FROM rate_limits WHERE key LIKE 'acct.discover.day:%' AND window = ? AND count >= 30").bind(day)
  ]));
  const classes = {};
  for (const r of perClass.results) (classes[r.class] = classes[r.class] || {})[r.status] = r.n;
  const set = Object.fromEntries(sw.results.map(r => [r.key, r.value]));
  return {
    on: set.MEMBER_EMAIL === '1', codes: set.OTP_EMAIL === '1', accounts: set.accounts_mode === 'on',
    classes, lastSent: last.results[0] ? last.results[0].at : null,
    discovery: { today: discovery.results[0].n, cap: Number(set.discovery_daily_cap) || 400, noAccount: none.results[0].n, wideSources: wide.results[0].n }
  };
}
