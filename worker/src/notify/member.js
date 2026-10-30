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
import { people, paidOf, amountDueOf } from '../book/model.js';
import { randomId } from '../lib/hash.js';
import { activityStmt } from '../lib/activity.js';
import { gmailConfigured, sendMail, GmailError } from './gmail.js';
import { allowed, budget, quotaOf, hourKey, countStmt } from './email.js';
import { backoffMs, MAX_ATTEMPTS } from './claim.js';
import { securityEmail, bookingEmail, pointsEmail, resultEmail, storeEmail, ageOutEmail, dayText, whenText, SITE } from './templates.js';
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
  'acct.email': { tier: 0, cls: 'member_tx', ttl: 72 * HOUR, notice: 'email_changed' },
  'acct.dev': { tier: 3, cls: 'member_tx', ttl: 72 * HOUR, group: 'security', notice: 'new_signin' },

  // bookings and payments, only for a booking linked to the account (§4.2; book/account.js)
  'book.received': { tier: 2, cls: 'member_tx', ttl: 72 * HOUR, group: 'bookings', book: 'pending', still: ['pending'] },
  'book.confirmed': { tier: 1, cls: 'member_tx', ttl: 72 * HOUR, book: 'confirmed', still: ['confirmed'] },
  'book.rejected': { tier: 1, cls: 'member_tx', ttl: 72 * HOUR, book: 'rejected', still: ['rejected'] },
  'book.cancelled': { tier: 1, cls: 'member_tx', ttl: 72 * HOUR, book: 'cancelled', still: ['cancelled'] },
  'book.eventCancelled': { tier: 1, cls: 'member_tx', ttl: 72 * HOUR, book: 'event_cancelled', still: ['cancelled'] },
  'book.due': { tier: 1, cls: 'member_tx', ttl: 72 * HOUR, book: 'due_changed', still: ['confirmed'] },
  'book.eventChange': { tier: 1, cls: 'member_tx', ttl: 72 * HOUR, book: 'event_change', still: ['pending', 'confirmed'] },
  'book.reminder': { tier: 2, cls: 'member_tx', ttl: 7 * DAY, group: 'bookings', book: 'balance', still: ['confirmed'], owing: true },
  'pay.recorded': { tier: 1, cls: 'member_tx', ttl: 72 * HOUR, book: 'payment_recorded' },
  'pay.voided': { tier: 1, cls: 'member_tx', ttl: 72 * HOUR, book: 'payment_voided' },
  'pay.request': { tier: 2, cls: 'member_tx', ttl: 72 * HOUR, group: 'bookings', book: 'request_received' },
  'pay.requestRejected': { tier: 1, cls: 'member_tx', ttl: 72 * HOUR, book: 'request_rejected' },

  'pts.deduct': { tier: 1, cls: 'member_tx', ttl: 72 * HOUR, points: true },

  // results and points (§4.3, COMPETITIONS §20.3): gradual; only after the release moment
  'res.result': { tier: 2, cls: 'member_bulk', ttl: 7 * DAY, group: 'results', res: 'result' },
  'res.done': { tier: 2, cls: 'member_bulk', ttl: 7 * DAY, group: 'results', res: 'done' },
  'res.points': { tier: 2, cls: 'member_bulk', ttl: 7 * DAY, group: 'results', res: 'points' },
  'res.correction': { tier: 2, cls: 'member_tx', ttl: 7 * DAY, group: 'results', res: 'correction' },

  // the store (§4.4)
  'store.requested': { tier: 2, cls: 'member_tx', ttl: 72 * HOUR, group: 'store', store: 'requested' },
  'store.approved': { tier: 1, cls: 'member_tx', ttl: 72 * HOUR, store: 'approved', stillStore: ['approved'] },
  'store.cancelled': { tier: 1, cls: 'member_tx', ttl: 72 * HOUR, store: 'cancelled', stillStore: ['cancelled'] },

  // about to leave the age range: once, while the points can still be used (§4.1)
  'acct.age': { tier: 2, cls: 'member_bulk', ttl: 60 * DAY, group: 'results', age: true }
};

/* the outbox row: goes in the SAME batch as the state change it reports (§3). A replay changes nothing. */
export function memberEmailStmt(db, { kind, participantId, entityType = null, entityId = null, entityVersion = null, dedupeKey, now = Date.now(), guard = '', guardBinds = [], toEmail = null, expires = null }) {
  const k = KINDS[kind];
  if (!k) throw new Error('unknown member email: ' + kind);
  return db.prepare(`INSERT OR IGNORE INTO member_outbox (id, participant_id, kind, entity_type, entity_id, entity_version, tier, class, dedupe_key, status, next_ms, expires_ms, created_ms, to_email)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?${guard ? ' WHERE ' + guard : ''}`)
    .bind(randomId('mo-', 8), participantId, kind, entityType, entityId, entityVersion, k.tier, k.cls, dedupeKey, now, expires || now + k.ttl, now, toEmail, ...guardBinds);
}

async function memberSettings(db) {
  const { results } = await retry(() => db.prepare("SELECT key, value FROM settings WHERE key LIKE 'MAIL_%' OR key IN ('MEMBER_EMAIL', 'accounts_mode', 'GMAIL_HEALTH', 'support_contact')").all());
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

const account = hash => SITE + '/account/#me/' + hash;
const plainStart = s => String(s || '').replace('T', ' ');

/* the booking a row speaks about, read at send time (§3): values and state as they are now */
async function bookingOf(db, row) {
  let bookingId = row.entity_id;
  let payment = null;
  let notice = null;
  if (row.entity_type === 'payment') {
    payment = await retry(() => db.prepare('SELECT * FROM payments WHERE id = ?').bind(row.entity_id).first());
    bookingId = payment ? payment.booking_id : '';
  } else if (row.entity_type === 'claim') {
    const claim = await retry(() => db.prepare('SELECT * FROM payment_claims WHERE id = ?').bind(row.entity_id).first());
    bookingId = claim ? claim.booking_id : '';
    payment = claim ? { amount: claim.amount, claim } : null;
  } else if (row.entity_type === 'notice') {
    const [noticeId, id] = String(row.entity_id).split(':');
    bookingId = id;
    notice = await retry(() => db.prepare('SELECT * FROM event_notices WHERE id = ?').bind(noticeId).first());
  }
  const b = bookingId ? await retry(() => db.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first()) : null;
  if (!b) return null;
  const [e, pays, claims] = await retry(() => db.batch([
    db.prepare('SELECT title, start_at, booking FROM event_cfg WHERE id = ?').bind(b.event_id),
    db.prepare('SELECT * FROM payments WHERE booking_id = ?').bind(b.id),
    db.prepare("SELECT COUNT(*) AS n FROM payment_claims WHERE booking_id = ? AND status = 'pending'").bind(b.id)
  ]));
  let cfg = null;
  try { cfg = e.results[0] && e.results[0].booking ? JSON.parse(e.results[0].booking) : null; } catch { cfg = null; }
  const total = amountDueOf(b);
  return { b, event: e.results[0] || {}, cfg, total, paid: paidOf(pays.results), payment, notice, openClaim: claims.results[0].n > 0 };
}

/* the email of one row, read at send time (§3) */
async function render(db, row, p, support, entity) {
  const k = KINDS[row.kind];
  const prefs = k.tier >= 2;
  if (k.notice) {
    let device = '';
    if (row.entity_type === 'session' && row.entity_id) {
      device = await retry(() => db.prepare('SELECT device FROM account_sessions WHERE id = ?').bind(row.entity_id).first('device')) || '';
    }
    return securityEmail({ kind: k.notice, cairo: cairoText(row.created_ms), device, prefs, support });
  }
  if (k.points) {
    const l = await retry(() => db.prepare('SELECT * FROM points_ledger WHERE id = ?').bind(row.entity_id).first());
    const balance = await retry(() => db.prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM points_ledger WHERE participant_id = ? AND season_id = ?').bind(p.id, l.season_id).first('n'));
    return pointsEmail({ amount: Math.abs(l.amount), balance, note: l.note_public ? l.note : '', url: account('points'), support });
  }
  if (k.res) {
    const s = entity;
    const def = s.def;
    const shows = what => def.scoring && (def.resultShow === what || def.resultShow === 'both');
    const pointsSum = await retry(() => db.prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM points_ledger WHERE ref = ?').bind('sub:' + s.row.id).first('n'));
    const season = await retry(() => db.prepare("SELECT id FROM seasons WHERE status = 'active'").first('id'));
    const balance = season ? await retry(() => db.prepare("SELECT COALESCE(SUM(l.amount), 0) AS n FROM points_ledger l WHERE l.participant_id = ? AND l.season_id = ? AND NOT EXISTS (SELECT 1 FROM submissions x WHERE 'sub:' || x.id = l.ref AND x.released_ms IS NULL)").bind(p.id, season).first('n')) : null;
    return resultEmail({
      kind: k.res, title: def.title, score: shows('score') ? s.row.score : null, max: shows('score') ? s.row.max_score : null,
      points: def.wallet && shows('points') ? pointsSum : null, noPoints: !!s.row.no_points, wallet: !!def.wallet, balance, pending: s.row.pending_count,
      url: account('results/' + def.slug), prefs, support
    });
  }
  if (k.store) {
    const r = entity;
    const season = r.season_id;
    const balance = await retry(() => db.prepare("SELECT COALESCE(SUM(l.amount), 0) AS n FROM points_ledger l WHERE l.participant_id = ? AND l.season_id = ? AND NOT EXISTS (SELECT 1 FROM submissions x WHERE 'sub:' || x.id = l.ref AND x.released_ms IS NULL)").bind(p.id, season).first('n'));
    return storeEmail({ kind: k.store, item: r.item_name, cost: r.cost, balance, note: k.store === 'cancelled' ? r.note : '', url: account('orders/' + r.id), prefs, support });
  }
  if (k.age) return ageOutEmail({ date: row.entity_id, url: account('points'), prefs, support });
  const x = entity;
  const counts = JSON.parse(x.b.actual || x.b.requested || '{}');
  return bookingEmail({
    status: k.book, name: p.name.split(/\s+/)[0], event: x.event.title || '', when: x.event.start_at ? whenText(plainStart(x.event.start_at)) : '', ref: x.b.ref,
    people: x.cfg ? people(x.cfg.pricing, counts).total : x.b.seats_requested, total: x.total, paid: x.paid,
    due: x.cfg && x.cfg.payment && x.cfg.payment.mode === 'installments' && x.cfg.payment.finalDueAt ? dayText(plainStart(x.cfg.payment.finalDueAt)) : '',
    reason: k.book === 'rejected' ? x.b.reject_reason : k.book === 'cancelled' || k.book === 'event_cancelled' ? x.b.cancel_reason : k.book === 'request_rejected' && x.payment && x.payment.claim ? x.payment.claim.reason : '',
    amount: x.payment ? x.payment.amount : null,
    refund: row.kind === 'pay.recorded' && x.payment && x.payment.kind === 'refund',
    changes: x.notice ? JSON.parse(x.notice.changes) : null,
    url: account('bookings/' + x.b.ref + (row.kind.startsWith('pay.') || k.book === 'balance' ? '/payments' : '')),
    prefs, support
  });
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
  let support = null;
  try { support = s.support_contact ? JSON.parse(s.support_contact) : null; } catch { support = null; }
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
      let entity = null;
      if (k.res) {
        const sub = await retry(() => db.prepare('SELECT * FROM submissions WHERE id = ?').bind(row.entity_id).first());
        const def = sub ? await retry(() => db.prepare('SELECT def FROM comp_versions WHERE comp_id = ? AND version = ?').bind(sub.comp_id, sub.version).first('def')) : null;
        if (!sub || !def || sub.status === 'void' || sub.participant_id !== p.id || !sub.released_ms) {
          await setStatus(db, row.id, 'superseded', null);
          out.superseded++;
          continue;
        }
        entity = { row: sub, def: JSON.parse(def) };
      }
      if (k.store) {
        entity = await retry(() => db.prepare('SELECT * FROM redemptions WHERE id = ?').bind(row.entity_id).first());
        if (!entity || entity.participant_id !== p.id || (k.stillStore && !k.stillStore.includes(entity.status))) {
          await setStatus(db, row.id, 'superseded', null);
          out.superseded++;
          continue;
        }
      }
      if (k.book) {
        entity = await bookingOf(db, row);
        const stale = !entity || entity.b.participant_id !== p.id
          || (k.still && !k.still.includes(entity.b.status))
          || (k.owing && (entity.total - entity.paid <= 0 || entity.openClaim));
        if (stale) {
          await setStatus(db, row.id, 'superseded', null);
          out.superseded++;
          continue;
        }
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
      const to = row.to_email || p.email;
      if (isTestInbox(env, to)) {
        await retry(() => db.prepare("UPDATE member_outbox SET status = 'sent', sent_ms = ?, attempts = attempts + 1, error = 'test inbox', to_email = NULL WHERE id = ?").bind(now, row.id).run());
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
      await sendMail(env, { to, ...(await render(db, row, p, support, entity)), now });
      await retry(() => db.batch([
        db.prepare("UPDATE member_outbox SET status = 'sent', sent_ms = ?, attempts = attempts + 1, error = NULL, to_email = NULL WHERE id = ?").bind(now, row.id),
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
