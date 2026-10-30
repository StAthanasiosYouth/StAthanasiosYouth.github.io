/*
 * Bookings and youth accounts (docs/YOUTH-ACCOUNTS-PLAN.md §18.1, docs/EVENTS.md §7.4,
 * docs/MEMBER-NOTIFICATIONS-PLAN.md §4.2). Without an account nothing changes: the public form keeps
 * collecting no email, and only a linked booking ever produces a member email.
 */

import { ApiError } from '../lib/http.js';
import { retry, cairoText } from '../lib/db.js';
import { randomId } from '../lib/hash.js';
import { activityStmt } from '../lib/activity.js';
import { limit, clientIp } from '../lib/ratelimit.js';
import { begin, finishStmt, abandon } from '../lib/idempotency.js';
import { memberEmailStmt } from '../notify/member.js';
import { requireAccount } from '../account/session.js';
import { readStatusToken } from './token.js';
import { paidOf, amountDueOf, stampMs } from './model.js';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const KEYS_SQL = "('accounts_mode', 'session_days_device', 'session_hours_shared')";
const CHANGE_FIELDS = { date: 'التاريخ', time: 'الميعاد', place: 'المكان' };

const configured = env => !!(env.PW_PEPPER && env.PW_KEY && env.OTP_PEPPER);

async function accountSettings(env) {
  const { results } = await retry(() => env.DB.prepare(`SELECT key, value FROM settings WHERE key IN ${KEYS_SQL}`).all());
  return Object.fromEntries(results.map(r => [r.key, r.value]));
}

export async function accountsOn(env) {
  return configured(env) && (await accountSettings(env)).accounts_mode === 'on';
}

/* §18.1 #5: on by default for an event with a booker age range; off otherwise; the event may say either */
export const needsAccount = booking => (booking.requireAccount === null || booking.requireAccount === undefined ? !!booking.bookerAge : booking.requireAccount === true);

/*
 * The booker at submit: the signed-in account, or null. A bearer token that no longer works is refused
 * (`session`), never silently treated as anonymous. Refused too when the event needs an account.
 */
export async function bookerAccount(ctx, booking) {
  const hasToken = /^Bearer as1\./.test(ctx.request.headers.get('authorization') || '');
  const on = await accountsOn(ctx.env);
  if (!on) return null;
  if (hasToken) return (await requireAccount(ctx, await accountSettings(ctx.env))).account;
  if (needsAccount(booking)) throw new ApiError('account_required', 'requireAccount');
  return null;
}

/* a booking's email, in the same batch as the change it reports; only when the booking has an account */
export function bookMailStmts(db, b, kind, { guard, guardBinds, dedupe, now = Date.now(), entityVersion = null, entityType = 'booking', entityId = b.id, expires = null }) {
  if (!b.participant_id) return [];
  return [memberEmailStmt(db, { kind, participantId: b.participant_id, entityType, entityId, entityVersion, dedupeKey: dedupe, now, guard, guardBinds, expires })];
}

/* GET /v1/account/bookings: «حجوزاتي» of the signed-in account */
export async function accountBookings(ctx, account) {
  const db = ctx.env.DB;
  const rows = (await retry(() => db.prepare(`SELECT b.*, e.title, e.start_at, e.booking AS cfg FROM bookings b LEFT JOIN event_cfg e ON e.id = b.event_id
    WHERE b.participant_id = ? ORDER BY b.created_ms DESC LIMIT 50`).bind(account.id).all())).results;
  if (!rows.length) return { bookings: [] };
  const pays = (await retry(() => db.prepare(`SELECT * FROM payments WHERE booking_id IN (${rows.map(() => '?').join(',')})`).bind(...rows.map(r => r.id)).all())).results;
  return {
    bookings: rows.map(b => {
      const paid = paidOf(pays.filter(p => p.booking_id === b.id));
      const total = amountDueOf(b);
      let due = '';
      try { const cfg = b.cfg ? JSON.parse(b.cfg) : null; due = cfg && cfg.payment && cfg.payment.mode === 'installments' ? cfg.payment.finalDueAt || '' : ''; } catch { due = ''; }
      return {
        ref: b.ref, status: b.status, event: b.title || '', startAt: b.start_at || '', total, paid, left: Math.max(0, total - paid), dueAt: due,
        reason: b.status === 'rejected' ? b.reject_reason || '' : b.status === 'cancelled' ? b.cancel_reason || '' : ''
      };
    })
  };
}

const dobsDiffer = (booking, account) => !!(booking.booker_dob && booking.booker_dob !== account.birth_date);

/*
 * POST /v1/account/bookings/link { token }: a self-declared booking joins the account by its status link
 * (possession, §18.1 #6), never by phone. It keeps its own snapshot; different dates of birth raise a flag.
 */
export async function accountBookingLink(ctx, account) {
  await limit(ctx, 'book.link', clientIp(ctx.request), 30, 3600);
  const db = ctx.env.DB;
  const id = await readStatusToken(ctx.env, (ctx.body || {}).token);
  const b = await retry(() => db.prepare('SELECT id, ref, participant_id, booker_dob FROM bookings WHERE id = ?').bind(id).first());
  if (!b) throw new ApiError('expired', 'gone');
  if (b.participant_id === account.id) return { linked: true, ref: b.ref, already: true };
  if (b.participant_id) throw new ApiError('final', 'linked to another account');
  const now = Date.now();
  await retry(() => db.batch([
    db.prepare('UPDATE bookings SET participant_id = ?, dob_mismatch = ?, updated_ms = ?, version = version + 1 WHERE id = ? AND participant_id IS NULL').bind(account.id, dobsDiffer(b, account) ? 1 : 0, now, b.id),
    activityStmt(db, { at: now, actor: 'account', action: 'booking.link', entityType: 'booking', entityId: b.id, entityTitle: b.ref, summary: 'الحجز اتربط بحساب من رابط الحالة' })
  ]));
  return { linked: true, ref: b.ref, already: false };
}

/* POST /v1/admin/book/bookings/:id/link { participantId } (bookings.manage), or null to unlink */
export async function adminBookingLink(ctx) {
  const db = ctx.env.DB;
  const pid = (ctx.body || {}).participantId;
  const b = await retry(() => db.prepare('SELECT id, ref, booker_dob FROM bookings WHERE id = ?').bind(ctx.params.id).first());
  if (!b) throw new ApiError('not_found', 'booking');
  const now = Date.now();
  let mismatch = 0;
  if (pid !== null) {
    const p = await retry(() => db.prepare("SELECT id, birth_date FROM participants WHERE id = ? AND status <> 'deleted'").bind(String(pid)).first());
    if (!p) throw new ApiError('not_found', 'participant');
    mismatch = dobsDiffer(b, p) ? 1 : 0;
  }
  await retry(() => db.batch([
    db.prepare('UPDATE bookings SET participant_id = ?, dob_mismatch = ?, updated_ms = ?, version = version + 1 WHERE id = ?').bind(pid, mismatch, now, b.id),
    activityStmt(db, { at: now, actor: ctx.actor.email, actorName: ctx.actor.name, action: 'booking.link', entityType: 'booking', entityId: b.id, entityTitle: b.ref, summary: pid === null ? 'فك ربط الحجز من الحساب' : 'ربط الحجز بحساب' })
  ]));
  return { linked: pid !== null, mismatch: !!mismatch };
}

/*
 * POST /v1/admin/book/events/:id/notify { changes: [{ field, from, to }], idemKey } (bookings.manage): «بلّغ الحاجزين».
 * Only on this explicit press (§4.2): pending + confirmed bookers of this event with an account.
 */
export async function adminEventNotify(ctx, event) {
  const db = ctx.env.DB;
  const body = ctx.body || {};
  const changes = Array.isArray(body.changes) ? body.changes : [];
  if (!changes.length || changes.length > 3) throw new ApiError('invalid', 'changes', { field: 'changes', message: 'اكتب اللي اتغير.' });
  const clean = changes.map(c => ({ field: String(c && c.field), from: String((c && c.from) || '').trim().slice(0, 80), to: String((c && c.to) || '').trim().slice(0, 80) }));
  if (clean.some(c => !CHANGE_FIELDS[c.field] || !c.to)) throw new ApiError('invalid', 'changes', { field: 'changes', message: 'اكتب اللي اتغير.' });
  const key = String(body.idemKey || '');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(key)) throw new ApiError('bad', 'idemKey');
  const started = await begin(db, 'book.notify:' + event.id, key, { changes: clean });
  if (started.replay) return { __replay: started.replay };
  try {
    const now = Date.now();
    const id = randomId('ntc-', 6);
    const rows = (await retry(() => db.prepare("SELECT id, participant_id FROM bookings WHERE event_id = ? AND status IN ('pending', 'confirmed') AND participant_id IS NOT NULL").bind(event.id).all())).results;
    await retry(() => db.batch([
      db.prepare('INSERT INTO event_notices (id, event_id, changes, actor, created_ms) VALUES (?, ?, ?, ?, ?)').bind(id, event.id, JSON.stringify(clean), ctx.actor.email, now),
      ...rows.map(b => memberEmailStmt(db, { kind: 'book.eventChange', participantId: b.participant_id, entityType: 'notice', entityId: id + ':' + b.id, dedupeKey: `evt:${event.id}:${id}:${b.id}`, now })),
      activityStmt(db, { at: now, actor: ctx.actor.email, actorName: ctx.actor.name, action: 'event.notify', entityType: 'event', entityId: event.id, entityTitle: event.title.slice(0, 80), summary: 'بلّغ الحاجزين: ' + rows.length, changes: { notified: rows.length, fields: clean.map(c => c.field) } }),
      finishStmt(db, started.claim, 200, { ok: true, notified: rows.length })
    ]));
    return { notified: rows.length };
  } catch (err) {
    await abandon(db, started.claim).catch(() => {});
    throw err;
  }
}

/*
 * Deadline reminders (§4.2, once a day): per-event switch, finalDueAt − 3 days and on the day. Confirmed with a
 * balance; skipped while a payment request is open or within 20 h of a WhatsApp reminder.
 */
export async function bookingReminders(env, now = Date.now()) {
  const db = env.DB;
  const s = await retry(() => db.prepare("SELECT key, value FROM settings WHERE key IN ('MEMBER_EMAIL', 'accounts_mode')").all());
  const set = Object.fromEntries(s.results.map(r => [r.key, r.value]));
  if (set.MEMBER_EMAIL !== '1' || set.accounts_mode !== 'on') return 0;
  const events = (await retry(() => db.prepare('SELECT id, booking FROM event_cfg WHERE withdrawn = 0 AND end_ms > ?').bind(now).all())).results;
  const today = cairoText(now).slice(0, 10);
  let made = 0;
  for (const e of events) {
    let b = null;
    try { b = e.booking ? JSON.parse(e.booking) : null; } catch { b = null; }
    if (!b || b.mailReminders !== true || !b.payment || b.payment.mode !== 'installments' || !b.payment.finalDueAt) continue;
    const dueMs = stampMs(b.payment.finalDueAt);
    if (!dueMs) continue;
    const dueDay = String(b.payment.finalDueAt).slice(0, 10);
    const stage = dueDay === today ? 'd0' : cairoText(dueMs - 3 * DAY).slice(0, 10) === today ? 'd3' : '';
    if (!stage) continue;
    const rows = (await retry(() => db.prepare(`SELECT b.* FROM bookings b WHERE b.event_id = ? AND b.status = 'confirmed' AND b.participant_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM payment_claims c WHERE c.booking_id = b.id AND c.status = 'pending')
      AND NOT EXISTS (SELECT 1 FROM reminders r WHERE r.booking_id = b.id AND r.sent_ms > ?)`).bind(e.id, now - 20 * HOUR).all())).results;
    const stmts = [];
    for (const row of rows) {
      const pays = (await retry(() => db.prepare('SELECT * FROM payments WHERE booking_id = ?').bind(row.id).all())).results;
      if (amountDueOf(row) - paidOf(pays) <= 0) continue;
      stmts.push(memberEmailStmt(db, { kind: 'book.reminder', participantId: row.participant_id, entityType: 'booking', entityId: row.id, dedupeKey: `rem:${row.id}:${stage}`, now, expires: dueMs + DAY }));
    }
    if (stmts.length) {
      await retry(() => db.batch(stmts));
      made += stmts.length;
    }
  }
  return made;
}
