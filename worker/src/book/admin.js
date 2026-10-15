/*
 * Admin booking routes (docs/EVENTS.md §4, §5, §7.2, §9, §11, §13;
 * worker/BOOKING-API.md). Every write:
 *   - checks with the pure model first (nice errors, warnings, overrides);
 *   - then ONE D1 batch whose first statement is guarded by the booking's
 *     `version` (and, where places are taken, by a capacity recount inside
 *     the same statement). Later statements of the batch only act when the
 *     guarded one landed (EXISTS on the new version), so a lost race writes
 *     nothing at all;
 *   - payments are append-only with UNIQUE idem_key (replays are no-ops);
 *   - the audit row is part of the same batch.
 * Money is never "optimistic": the reply is the booking as now stored.
 */

import { ApiError } from '../lib/http.js';
import { retry, cairoText } from '../lib/db.js';
import { activityStmt } from '../lib/activity.js';
import { randomId } from '../lib/hash.js';
import { begin, finishStmt, abandon, idempotencyKey } from '../lib/idempotency.js';
import { loadEvent, eventById, seatsTaken, rowToEvent } from './event.js';
import { forgetModule, bookingOn } from './public.js';
import {
  checkCounts, normPhone, cleanText, quote, seats, people, deriveFromPaid, derive, paidOf, amountDueOf,
  confirmPaymentOk, newRef, summary, stampMs, msStamp, isLive, LIMITS, STATUSES
} from './model.js';

const KEY = /^[A-Za-z0-9_.:-]{8,100}$/;
const PROOF_LIFE_MS = 60 * 24 * 3600 * 1000;
const RECEIVED_SKEW_MS = 5 * 60 * 1000;

const invalid = field => new ApiError('invalid', field, { field });

/* ---------- reading ---------- */

async function bookingRow(env, id) {
  if (!/^bkg-[a-z0-9]{6,}$/.test(String(id || ''))) throw new ApiError('not_found', 'id');
  const b = await retry(() => env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(id).first());
  if (!b) throw new ApiError('not_found', 'booking');
  return b;
}

async function paymentsOf(env, bookingId) {
  return (await retry(() => env.DB.prepare('SELECT * FROM payments WHERE booking_id = ? ORDER BY recorded_ms, id').bind(bookingId).all())).results;
}

function servantName(event, id) {
  const s = event.booking && event.booking.servants.find(x => x.id === id);
  return s ? s.name : '';
}

/* the list/queue row (BOOKING-API BookingRow) */
function listRow(b, event, paid, flags, now) {
  const counts = JSON.parse(b.actual || b.requested || '{}');
  const d = deriveFromPaid(b, paid, event.booking && event.booking.payment, now);
  return {
    id: b.id, ref: b.ref, eventId: b.event_id, status: b.status, source: b.source, name: b.name, phone: b.phone,
    servantId: b.servant_id, servantName: servantName(event, b.servant_id), method: b.method,
    people: people(event.booking && event.booking.pricing, counts), seats: b.status === 'confirmed' ? b.seats_actual : b.seats_requested,
    quotedTotal: b.quoted_total, amountDue: amountDueOf(b), ...d,
    createdAt: b.created_at, confirmedAt: b.confirmed_at || null, flags, version: b.version
  };
}

async function flagsFor(env, b, event) {
  const [dup, twice] = await env.DB.batch([
    env.DB.prepare('SELECT COUNT(*) AS n FROM proofs p WHERE p.booking_id = ? AND p.deleted_at IS NULL AND EXISTS (SELECT 1 FROM proofs q WHERE q.sha256 = p.sha256 AND q.booking_id IS NOT NULL AND q.booking_id <> p.booking_id)').bind(b.id),
    env.DB.prepare("SELECT COUNT(*) AS n FROM bookings WHERE event_id = ? AND phone = ? AND status IN ('pending', 'confirmed')").bind(b.event_id, b.phone)
  ]);
  return { dupProof: dup.results[0].n > 0, phoneTwice: twice.results[0].n >= 2, priceChanged: b.price_rev !== event.priceRev };
}

export async function detail(ctx, id) {
  const env = ctx.env;
  const b = await bookingRow(env, id);
  const event = await eventById(ctx, b.event_id);
  const [pays, proofs, flags, taken] = await Promise.all([
    paymentsOf(env, b.id),
    retry(() => env.DB.prepare('SELECT p.id, p.purpose, p.payment_id, p.by, p.at, p.bytes, p.width, p.height, (SELECT COUNT(*) FROM proofs q WHERE q.sha256 = p.sha256 AND q.booking_id IS NOT NULL AND q.booking_id <> p.booking_id) AS dups FROM proofs p WHERE p.booking_id = ? AND p.deleted_at IS NULL ORDER BY p.at_ms').bind(b.id).all()),
    flagsFor(env, b, event),
    seatsTaken(env, event.id)
  ]);
  const now = Date.now();
  const bk = event.booking || {};
  return {
    booking: {
      ...listRow(b, event, paidOf(pays), flags, now),
      requested: JSON.parse(b.requested), actual: b.actual ? JSON.parse(b.actual) : null, names: b.names ? JSON.parse(b.names) : null,
      visitorNote: b.visitor_note, adminNote: b.admin_note, rejectReason: b.reject_reason, cancelReason: b.cancel_reason,
      capOverride: b.cap_override ? JSON.parse(b.cap_override) : null, payOverride: b.pay_override ? JSON.parse(b.pay_override) : null,
      dueHistory: JSON.parse(b.due_history || '[]'), priceRev: b.price_rev, closedAt: b.closed_at, closedBy: b.closed_by
    },
    payments: pays.map(p => ({
      id: p.id, kind: p.kind, amount: p.amount, servantId: p.servant_id, servantName: p.servant_name, method: p.method,
      receivedAt: p.received_at, recordedAt: p.recorded_at, recordedBy: p.recorded_by, recordedName: p.recorded_name,
      proofIds: p.proof_ids ? JSON.parse(p.proof_ids) : [], note: p.note, voidsId: p.voids_id, voidedBy: p.voided_by
    })),
    proofs: proofs.results.map(p => ({ id: p.id, purpose: p.purpose, paymentId: p.payment_id, by: p.by, at: p.at, bytes: p.bytes, width: p.width, height: p.height, dup: p.dups > 0 })),
    derived: derive(b, pays, bk.payment, now),
    event: {
      id: event.id, slug: event.slug, title: event.title, startAt: event.startAt, endAt: event.endAt,
      capacity: bk.capacity == null ? null : bk.capacity, taken, left: bk.capacity == null ? null : bk.capacity - taken,
      perBookingMax: bk.perBookingMax, collectNames: !!bk.collectNames, pricing: bk.pricing, payment: bk.payment,
      methods: bk.methods || [], servants: (bk.servants || []).map(s => ({ id: s.id, name: s.name, methods: s.methods }))
    }
  };
}

/* ---------- payment input (§5.2) ---------- */

/*
 * One PayInput → { row, warnings }. `paid` is the money already in before
 * this one (it moves forward as a list is checked), `due` the amount due
 * after the action (null while pending).
 */
async function checkPay(ctx, input, { event, booking, paid, due, existing, now }) {
  if (!input || typeof input !== 'object') throw invalid('payments');
  const bk = event.booking || {};
  const kind = input.kind === 'refund' ? 'refund' : input.kind === 'payment' ? 'payment' : null;
  if (!kind) throw invalid('kind');
  const amount = Number(input.amount);
  if (!Number.isInteger(amount) || amount <= 0 || amount > LIMITS.amount) throw invalid('amount');
  const servant = (bk.servants || []).find(s => s.id === input.servantId);
  if (!servant) throw invalid('servantId');
  const method = (bk.methods || []).find(m => m.key === input.method);
  if (!method) throw invalid('method');
  const receivedMs = stampMs(String(input.receivedAt || '').replace(' ', 'T'));
  if (!receivedMs || receivedMs > now + RECEIVED_SKEW_MS || receivedMs < booking.created_ms - RECEIVED_SKEW_MS) throw invalid('receivedAt');
  if (!KEY.test(String(input.idemKey || ''))) throw invalid('idemKey');
  if (kind === 'refund' && paid <= 0) throw invalid('amount');
  const note = cleanText(input.note, LIMITS.note) || null;
  const proofIds = Array.isArray(input.proofIds) ? [...new Set(input.proofIds.map(String))] : [];
  if (proofIds.length > LIMITS.proofs) throw invalid('proofIds');
  if (proofIds.length) {
    const found = await ctx.env.DB.prepare(`SELECT id FROM proofs WHERE id IN (${proofIds.map(() => '?').join(',')}) AND booking_id = ? AND deleted_at IS NULL`).bind(...proofIds, booking.id).all();
    if (found.results.length !== proofIds.length) throw invalid('proofIds');
  }

  const warnings = [];
  if (!servant.methods.includes(method.key)) warnings.push({ code: 'method', message: 'الطريقة دي مش من طرق الخادم ده في الفعالية دي.' });
  const day = msStamp(receivedMs).slice(0, 10);
  if (existing.some(p => isLive(p) && p.kind === kind && p.amount === amount && p.servant_id === servant.id && String(p.received_at).slice(0, 10) === day)) {
    warnings.push({ code: 'duplicate', message: 'في دفعة بنفس المبلغ ونفس الخادم في نفس اليوم.' });
  }
  if (kind === 'refund' && due != null && amount > Math.max(0, paid - due)) warnings.push({ code: 'refund', message: 'المرتجع أكبر من المستحق للمشترك.' });
  if (kind === 'payment' && due != null && paid + amount > due) warnings.push({ code: 'overpaid', message: 'الدفعة دي هتخلي المدفوع أكتر من المطلوب.' });

  return {
    warnings: input.force === true ? [] : warnings,
    row: {
      id: randomId('pay-', 6), kind, amount, servantId: servant.id, servantName: servant.name, method: method.key,
      receivedAt: msStamp(receivedMs).replace('T', ' '), receivedMs, note, proofIds, idemKey: input.idemKey
    },
    delta: kind === 'payment' ? amount : -amount
  };
}

async function checkPays(ctx, list, base) {
  const out = [];
  let paid = base.paid;
  const warnings = [];
  for (const input of (Array.isArray(list) ? list : [])) {
    const r = await checkPay(ctx, input, { ...base, paid });
    r.warnings.forEach(w => warnings.push(w));
    paid += r.delta;
    out.push(r.row);
  }
  if (out.length > 5) throw invalid('payments');
  const keys = new Set(out.map(r => r.idemKey));
  if (keys.size !== out.length) throw invalid('idemKey');
  return { rows: out, paid, warnings };
}

/* the payment rows of a write, each landing only when `guard` holds */
function paymentStmts(db, rows, booking, actor, now, guard, guardArgs) {
  const stmts = [];
  for (const r of rows) {
    stmts.push(db.prepare(`INSERT INTO payments (id, booking_id, event_id, kind, amount, servant_id, servant_name, method, received_at, received_ms,
        recorded_at, recorded_ms, recorded_by, recorded_name, proof_ids, note, idem_key)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard}
      ON CONFLICT(idem_key) DO NOTHING`).bind(
      r.id, booking.id, booking.event_id, r.kind, r.amount, r.servantId, r.servantName, r.method, r.receivedAt, r.receivedMs,
      cairoText(now), now, actor.email, actor.name || null, r.proofIds.length ? JSON.stringify(r.proofIds) : null, r.note, r.idemKey, ...guardArgs));
    if (r.proofIds.length) {
      stmts.push(db.prepare(`UPDATE proofs SET payment_id = ?, purpose = 'payment' WHERE id IN (${r.proofIds.map(() => '?').join(',')}) AND booking_id = ? AND payment_id IS NULL AND EXISTS (SELECT 1 FROM payments WHERE id = ?)`)
        .bind(r.id, ...r.proofIds, booking.id, r.id));
    }
  }
  return stmts;
}

function audit(db, ctx, action, b, summaryText, changes) {
  return activityStmt(db, { actor: ctx.actor.email, actorName: ctx.actor.name, action, entityType: 'booking', entityId: b.id, entityTitle: b.ref, summary: summaryText, changes });
}

function requireVersion(body) {
  const v = Number(body.version);
  if (!Number.isInteger(v) || v < 1) throw invalid('version');
  return v;
}

function ended(event, now) {
  return now > event.endMs;
}

/* a guarded write did not land: say why */
async function explainMiss(ctx, id, version, wantStatus) {
  const b = await bookingRow(ctx.env, id);
  if (b.version !== version) throw new ApiError('conflict', 'version', { version: b.version });
  if (wantStatus && !wantStatus.includes(b.status)) throw new ApiError('final', b.status);
  return b;
}

/* ---------- module + events ---------- */

export async function adminModule(ctx) {
  return { on: await bookingOn(ctx.env), env: ctx.env.ENVIRONMENT || '' };
}

/* POST /v1/admin/book/module { on } — the primary admin only (staging: any admin) */
export async function adminModuleSet(ctx) {
  if (ctx.env.ENVIRONMENT !== 'staging' && ctx.actor.role !== 'primary') throw new ApiError('denied', 'primary only');
  const on = ctx.body.on === true;
  const now = Date.now();
  await retry(() => ctx.env.DB.batch([
    ctx.env.DB.prepare("INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('BOOKING_MODULE', ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by")
      .bind(on ? '1' : '0', now, ctx.actor.email),
    activityStmt(ctx.env.DB, { actor: ctx.actor.email, actorName: ctx.actor.name, action: 'modules.book', entityType: 'settings', entityId: 'BOOKING_MODULE', summary: on ? 'الحجز اشتغل' : 'الحجز اتقفل' })
  ]));
  forgetModule();
  return { on, env: ctx.env.ENVIRONMENT || '' };
}

export async function adminEvents(ctx) {
  const env = ctx.env;
  const [evs, counts] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM event_cfg WHERE withdrawn = 0 ORDER BY start_at DESC'),
    env.DB.prepare("SELECT event_id, status, COUNT(*) AS n, SUM(CASE WHEN status = 'confirmed' THEN seats_actual ELSE 0 END) AS seats FROM bookings GROUP BY event_id, status")
  ]);
  return {
    events: evs.results.map(row => {
      const e = rowToEvent(row);
      const c = Object.fromEntries(STATUSES.map(s => [s, 0]));
      let taken = 0;
      counts.results.filter(x => x.event_id === e.id).forEach(x => { c[x.status] = x.n; taken += x.seats || 0; });
      const cap = e.booking && e.booking.capacity != null ? e.booking.capacity : null;
      return { id: e.id, slug: e.slug, title: e.title, startAt: e.startAt, endAt: e.endAt, capacity: cap, taken, left: cap == null ? null : cap - taken, online: e.online, counts: c, refreshedAt: e.fetchedAt };
    })
  };
}

/* POST /v1/admin/book/events/:slug/refresh — re-read the published event.json now */
export async function adminEventRefresh(ctx) {
  const e = await loadEvent(ctx, ctx.params.slug, { force: true });
  const taken = await seatsTaken(ctx.env, e.id);
  const cap = e.booking && e.booking.capacity != null ? e.booking.capacity : null;
  return { event: { id: e.id, slug: e.slug, title: e.title, startAt: e.startAt, endAt: e.endAt, capacity: cap, taken, left: cap == null ? null : cap - taken, online: e.online, refreshedAt: e.fetchedAt } };
}

/* ---------- queue ---------- */

export async function adminBookings(ctx) {
  const q = ctx.url.searchParams;
  const event = await eventById(ctx, q.get('eventId'));
  const env = ctx.env;
  const [bs, paid, dups] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM bookings WHERE event_id = ? ORDER BY created_ms DESC, id').bind(event.id),
    env.DB.prepare("SELECT booking_id, SUM(CASE kind WHEN 'payment' THEN amount WHEN 'refund' THEN -amount ELSE 0 END) AS paid FROM payments WHERE event_id = ? AND voided_by IS NULL AND kind <> 'void' GROUP BY booking_id").bind(event.id),
    env.DB.prepare('SELECT DISTINCT p.booking_id FROM proofs p JOIN bookings b ON b.id = p.booking_id WHERE b.event_id = ? AND p.deleted_at IS NULL AND EXISTS (SELECT 1 FROM proofs q WHERE q.sha256 = p.sha256 AND q.booking_id IS NOT NULL AND q.booking_id <> p.booking_id)').bind(event.id)
  ]);
  const paidBy = new Map(paid.results.map(r => [r.booking_id, r.paid]));
  const dupSet = new Set(dups.results.map(r => r.booking_id));
  const phones = new Map();
  bs.results.forEach(b => { if (b.status === 'pending' || b.status === 'confirmed') phones.set(b.phone, (phones.get(b.phone) || 0) + 1); });
  const now = Date.now();
  let rows = bs.results.map(b => listRow(b, event, paidBy.get(b.id) || 0, { dupProof: dupSet.has(b.id), phoneTwice: (phones.get(b.phone) || 0) >= 2, priceChanged: b.price_rev !== event.priceRev }, now));

  const counts = { byStatus: Object.fromEntries(STATUSES.map(s => [s, 0])), overdue: 0, refunds: 0 };
  rows.forEach(r => { counts.byStatus[r.status]++; if (r.overdue) counts.overdue++; if (r.refundOwed > 0) counts.refunds++; });

  const status = q.get('status') || 'all';
  if (status !== 'all') {
    if (!STATUSES.includes(status)) throw invalid('status');
    rows = rows.filter(r => r.status === status);
  }
  if (q.get('overdue') === '1') rows = rows.filter(r => r.overdue);
  if (q.get('refunds') === '1') rows = rows.filter(r => r.refundOwed > 0);
  const text = cleanText(q.get('q'), 60).toLowerCase();
  if (text) {
    const digits = text.replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660)).replace(/\D/g, '');
    rows = rows.filter(r => r.ref.toLowerCase().includes(text) || r.name.toLowerCase().includes(text) || (digits.length >= 3 && r.phone.replace(/\D/g, '').includes(digits.replace(/^0/, ''))));
  }
  const lim = Math.max(1, Math.min(100, Number(q.get('limit')) || 50));
  const start = Math.max(0, Number(q.get('cursor')) || 0);
  return { rows: rows.slice(start, start + lim), counts, next: start + lim < rows.length ? String(start + lim) : null };
}

export async function adminBooking(ctx) {
  return detail(ctx, ctx.params.id);
}

/* ---------- create (source admin) ---------- */

export async function adminCreate(ctx) {
  const body = ctx.body;
  if (!KEY.test(String(body.requestKey || ''))) throw invalid('requestKey');
  const twin = await retry(() => ctx.env.DB.prepare('SELECT id FROM bookings WHERE request_key = ?').bind(body.requestKey).first());
  if (twin) return detail(ctx, twin.id);

  const event = await eventById(ctx, body.eventId);
  const b = event.booking;
  if (!b) throw new ApiError('disabled', 'no booking');
  const now = Date.now();
  if (ended(event, now)) throw new ApiError('final', 'event ended');
  const name = cleanText(body.name, LIMITS.name);
  if (name.length < 2) throw invalid('name');
  const phone = normPhone(body.phone);
  if (!phone) throw invalid('phone');
  const checked = checkCounts(b, body.counts);
  if (checked.problem) throw invalid('counts');
  const counts = checked.counts;
  const total = quote(b.pricing, counts);
  let servantId = null, method = null;
  if (body.servantId) {
    const s = b.servants.find(x => x.id === body.servantId);
    if (!s) throw invalid('servantId');
    servantId = s.id;
    if (body.method) {
      if (!b.methods.some(m => m.key === body.method)) throw invalid('method');
      method = body.method;
    }
  }
  const names = b.collectNames && Array.isArray(body.names) ? body.names.map(n => cleanText(n, LIMITS.names)).filter(Boolean) : null;
  const id = randomId('bkg-', 6);
  const db = ctx.env.DB;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ref = newRef();
    try {
      await retry(() => db.batch([
        db.prepare(`INSERT INTO bookings (id, ref, event_id, source, status, name, phone, servant_id, method, requested, seats_requested, names,
            quoted_total, price_rev, admin_note, request_key, created_at, created_ms, updated_ms)
          VALUES (?, ?, ?, 'admin', 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(request_key) DO NOTHING`).bind(
          id, ref, event.id, name, phone, servantId, method, JSON.stringify(counts), seats(b.pricing, counts), names ? JSON.stringify(names) : null,
          total, event.priceRev, cleanText(body.note, LIMITS.adminNote) || null, body.requestKey, cairoText(now), now, now),
        activityStmt(db, { actor: ctx.actor.email, actorName: ctx.actor.name, action: 'booking.create', entityType: 'booking', entityId: id, entityTitle: ref, summary: event.title.slice(0, 80) })
      ]));
      break;
    } catch (err) {
      if (/UNIQUE constraint failed: bookings\.event_id, bookings\.ref/i.test(String(err && err.message)) && attempt < 2) continue;
      throw err;
    }
  }
  const made = await ctx.env.DB.prepare('SELECT id, version FROM bookings WHERE request_key = ?').bind(body.requestKey).first();
  if (body.confirm && typeof body.confirm === 'object') {
    ctx.params = { id: made.id };
    ctx.body = { ...body.confirm, version: made.version };
    return adminConfirm(ctx);
  }
  return detail(ctx, made.id);
}

/* ---------- confirm (§4, §5.1, §5.3, §9) ---------- */

export async function adminConfirm(ctx) {
  const env = ctx.env;
  const body = ctx.body;
  const version = requireVersion(body);
  const b = await bookingRow(env, ctx.params.id);
  const event = await eventById(ctx, b.event_id);
  const bk = event.booking;
  const now = Date.now();
  const pays = await paymentsOf(env, b.id);

  // a retried confirm whose first try landed: answer as it is
  if (b.status === 'confirmed' && b.confirmed_by === ctx.actor.email && (body.payments || []).every(p => pays.some(x => x.idem_key === p.idemKey))) return detail(ctx, b.id);
  if (b.version !== version) throw new ApiError('conflict', 'version', { version: b.version });
  if (b.status !== 'pending') throw new ApiError('final', b.status);
  if (ended(event, now)) throw new ApiError('final', 'event ended');

  const checked = checkCounts(bk, body.actual || JSON.parse(b.requested));
  if (checked.problem) throw invalid('actual');
  const actual = checked.counts;
  const seatCount = seats(bk.pricing, actual);
  const q = quote(bk.pricing, actual);
  const amountDue = body.amountDue === undefined || body.amountDue === null || body.amountDue === '' ? q : Number(body.amountDue);
  if (!Number.isInteger(amountDue) || amountDue < 0 || amountDue > LIMITS.amount) throw invalid('amountDue');
  const dueReason = cleanText(body.dueReason, LIMITS.reason);
  if (amountDue !== q && dueReason.length < 2) throw invalid('dueReason');
  const reason = cleanText(body.reason, LIMITS.reason);

  const paidBefore = paidOf(pays);
  const checkedPays = await checkPays(ctx, body.payments, { event, booking: b, paid: paidBefore, due: amountDue, existing: pays, now });
  if (checkedPays.warnings.length) throw new ApiError('warn', 'payments', { warnings: checkedPays.warnings });

  const blocks = [];
  const taken = await seatsTaken(env, event.id);
  const left = bk.capacity == null ? null : bk.capacity - taken;
  if (left != null && seatCount > left && body.overrideCap !== true) blocks.push({ code: 'capacity', message: left > 0 ? `فاضل ${left} مكان بس.` : 'العدد اكتمل.', left: Math.max(0, left) });
  if (!confirmPaymentOk(bk.payment, amountDue, checkedPays.paid) && body.overridePay !== true) {
    blocks.push({ code: 'payment', message: bk.payment.mode === 'installments' ? 'أول دفعة أقل من المطلوب للتأكيد.' : 'المدفوع أقل من المطلوب.' });
  }
  if (blocks.length) throw new ApiError('needs_override', 'confirm', { warnings: blocks, left: left == null ? undefined : Math.max(0, left) });
  if ((body.overrideCap === true || body.overridePay === true) && reason.length < 2) throw invalid('reason');

  const at = cairoText(now);
  const history = JSON.parse(b.due_history || '[]');
  if (amountDue !== q) history.push({ at, by: ctx.actor.email, from: q, to: amountDue, reason: dueReason });
  const capOverride = body.overrideCap === true && left != null && seatCount > left ? JSON.stringify({ by: ctx.actor.email, at, reason }) : null;
  const payOverride = body.overridePay === true ? JSON.stringify({ by: ctx.actor.email, at, reason }) : null;
  const names = bk.collectNames && Array.isArray(body.names) ? JSON.stringify(body.names.map(n => cleanText(n, LIMITS.names)).filter(Boolean)) : null;

  const db = env.DB;
  const guard = "EXISTS (SELECT 1 FROM bookings WHERE id = ? AND version = ? AND status = 'confirmed')";
  const stmts = [
    db.prepare(`UPDATE bookings SET status = 'confirmed', actual = ?, seats_actual = ?, names = COALESCE(?, names), amount_due = ?, due_history = ?,
        cap_override = ?, pay_override = ?, confirmed_at = ?, confirmed_by = ?, updated_ms = ?, version = version + 1
      WHERE id = ? AND status = 'pending' AND version = ?
        AND (? = 1 OR (SELECT capacity FROM event_cfg WHERE id = bookings.event_id) IS NULL
             OR (SELECT COALESCE(SUM(b2.seats_actual), 0) FROM bookings b2 WHERE b2.event_id = bookings.event_id AND b2.status = 'confirmed') + ?
                <= (SELECT capacity FROM event_cfg WHERE id = bookings.event_id))`).bind(
      JSON.stringify(actual), seatCount, names, amountDue, JSON.stringify(history), capOverride, payOverride, at, ctx.actor.email, now,
      b.id, version, body.overrideCap === true ? 1 : 0, seatCount),
    ...paymentStmts(db, checkedPays.rows, b, ctx.actor, now, guard, [b.id, version + 1]),
    db.prepare(`INSERT INTO activity (id, at, cairo, actor, actor_name, action, entity_type, entity_id, entity_title, summary, changes)
      SELECT ?, ?, ?, ?, ?, 'booking.confirm', 'booking', ?, ?, ?, ? WHERE ${guard}`).bind(
      randomId('act-'), now, at, ctx.actor.email, ctx.actor.name || null, b.id, b.ref,
      `${people(bk.pricing, actual).total} أفراد` + (capOverride || payOverride ? ' · ' + reason : ''),
      JSON.stringify({ payments: checkedPays.rows.length, overrideCap: !!capOverride, overridePay: !!payOverride }), b.id, version + 1)
  ];
  const r = await retry(() => db.batch(stmts));
  if (r[0].meta.changes !== 1) {
    await explainMiss(ctx, b.id, version, ['pending']);
    const nowLeft = bk.capacity == null ? null : bk.capacity - await seatsTaken(env, event.id);
    throw new ApiError('needs_override', 'capacity', { warnings: [{ code: 'capacity', message: 'العدد اكتمل قبل ما التأكيد يتسجل.', left: Math.max(0, nowLeft || 0) }], left: Math.max(0, nowLeft || 0) });
  }
  return detail(ctx, b.id);
}

/* ---------- reject / cancel / reopen / update ---------- */

export async function adminReject(ctx) {
  const env = ctx.env;
  const body = ctx.body;
  const version = requireVersion(body);
  const b = await bookingRow(env, ctx.params.id);
  const event = await eventById(ctx, b.event_id);
  const now = Date.now();
  const pays = await paymentsOf(env, b.id);
  if (b.status === 'rejected' && b.closed_by === ctx.actor.email && (body.payments || []).every(p => pays.some(x => x.idem_key === p.idemKey))) return detail(ctx, b.id);
  if (b.version !== version) throw new ApiError('conflict', 'version', { version: b.version });
  if (b.status !== 'pending') throw new ApiError('final', b.status);
  if (ended(event, now)) throw new ApiError('final', 'event ended');
  const reason = cleanText(body.reason, LIMITS.reason);
  if (reason.length < 2) throw invalid('reason');
  const checkedPays = await checkPays(ctx, body.payments, { event, booking: b, paid: paidOf(pays), due: 0, existing: pays, now });
  const real = checkedPays.warnings.filter(w => w.code !== 'overpaid');      // money in on a rejection is a refund owed, by design
  if (real.length) throw new ApiError('warn', 'payments', { warnings: real });
  const db = env.DB;
  const at = cairoText(now);
  const guard = "EXISTS (SELECT 1 FROM bookings WHERE id = ? AND version = ? AND status = 'rejected')";
  const r = await retry(() => db.batch([
    db.prepare("UPDATE bookings SET status = 'rejected', amount_due = 0, reject_reason = ?, closed_at = ?, closed_by = ?, updated_ms = ?, version = version + 1 WHERE id = ? AND status = 'pending' AND version = ?")
      .bind(reason, at, ctx.actor.email, now, b.id, version),
    ...paymentStmts(db, checkedPays.rows, b, ctx.actor, now, guard, [b.id, version + 1]),
    db.prepare(`INSERT INTO activity (id, at, cairo, actor, actor_name, action, entity_type, entity_id, entity_title, summary)
      SELECT ?, ?, ?, ?, ?, 'booking.reject', 'booking', ?, ?, ? WHERE ${guard}`).bind(randomId('act-'), now, at, ctx.actor.email, ctx.actor.name || null, b.id, b.ref, reason, b.id, version + 1)
  ]));
  if (r[0].meta.changes !== 1) await explainMiss(ctx, b.id, version, ['pending']);
  return detail(ctx, b.id);
}

export async function adminCancel(ctx) {
  const env = ctx.env;
  const body = ctx.body;
  const version = requireVersion(body);
  const b = await bookingRow(env, ctx.params.id);
  if (b.version !== version) throw new ApiError('conflict', 'version', { version: b.version });
  if (b.status !== 'confirmed') throw new ApiError('final', b.status);
  const reason = cleanText(body.reason, LIMITS.reason);
  if (reason.length < 2) throw invalid('reason');
  const paid = paidOf(await paymentsOf(env, b.id));
  const retain = body.retain === undefined || body.retain === '' ? 0 : Number(body.retain);
  if (!Number.isInteger(retain) || retain < 0 || retain > Math.max(0, paid)) throw invalid('retain');
  const now = Date.now();
  const at = cairoText(now);
  const r = await retry(() => env.DB.batch([
    env.DB.prepare("UPDATE bookings SET status = 'cancelled', amount_due = ?, cancel_reason = ?, closed_at = ?, closed_by = ?, updated_ms = ?, version = version + 1 WHERE id = ? AND status = 'confirmed' AND version = ?")
      .bind(retain, reason, at, ctx.actor.email, now, b.id, version),
    env.DB.prepare(`INSERT INTO activity (id, at, cairo, actor, actor_name, action, entity_type, entity_id, entity_title, summary)
      SELECT ?, ?, ?, ?, ?, 'booking.cancel', 'booking', ?, ?, ? WHERE changes() = 1`).bind(randomId('act-'), now, at, ctx.actor.email, ctx.actor.name || null, b.id, b.ref, reason)
  ]));
  if (r[0].meta.changes !== 1) await explainMiss(ctx, b.id, version, ['confirmed']);
  return detail(ctx, b.id);
}

export async function adminReopen(ctx) {
  const env = ctx.env;
  const version = requireVersion(ctx.body);
  const b = await bookingRow(env, ctx.params.id);
  const event = await eventById(ctx, b.event_id);
  if (b.version !== version) throw new ApiError('conflict', 'version', { version: b.version });
  if (b.status !== 'rejected') throw new ApiError('final', b.status);
  const now = Date.now();
  if (ended(event, now)) throw new ApiError('final', 'event ended');
  const r = await retry(() => env.DB.batch([
    env.DB.prepare("UPDATE bookings SET status = 'pending', amount_due = NULL, reject_reason = NULL, closed_at = NULL, closed_by = NULL, updated_ms = ?, version = version + 1 WHERE id = ? AND status = 'rejected' AND version = ?")
      .bind(now, b.id, version),
    env.DB.prepare(`INSERT INTO activity (id, at, cairo, actor, actor_name, action, entity_type, entity_id, entity_title, summary)
      SELECT ?, ?, ?, ?, ?, 'booking.reopen', 'booking', ?, ?, 'رجع للمراجعة' WHERE changes() = 1`).bind(randomId('act-'), now, cairoText(now), ctx.actor.email, ctx.actor.name || null, b.id, b.ref)
  ]));
  if (r[0].meta.changes !== 1) await explainMiss(ctx, b.id, version, ['rejected']);
  return detail(ctx, b.id);
}

/* actual (confirmed: places re-checked), amountDue (+reason → dueHistory), adminNote, names */
export async function adminUpdate(ctx) {
  const env = ctx.env;
  const body = ctx.body;
  const version = requireVersion(body);
  const b = await bookingRow(env, ctx.params.id);
  const event = await eventById(ctx, b.event_id);
  const bk = event.booking;
  if (b.version !== version) throw new ApiError('conflict', 'version', { version: b.version });
  const now = Date.now();
  const at = cairoText(now);
  const reason = cleanText(body.reason, LIMITS.reason);

  let actual = b.actual ? JSON.parse(b.actual) : null;
  let seatCount = b.seats_actual;
  let amountDue = b.amount_due;
  const history = JSON.parse(b.due_history || '[]');
  const changed = [];

  if (body.actual !== undefined) {
    if (b.status !== 'confirmed') throw new ApiError('final', b.status);
    const checked = checkCounts(bk, body.actual);
    if (checked.problem) throw invalid('actual');
    actual = checked.counts;
    seatCount = seats(bk.pricing, actual);
    changed.push('actual');
  }
  if (body.amountDue !== undefined) {
    if (b.status !== 'confirmed') throw new ApiError('final', b.status);
    const due = Number(body.amountDue);
    if (!Number.isInteger(due) || due < 0 || due > LIMITS.amount) throw invalid('amountDue');
    if (due !== b.amount_due) {
      if (reason.length < 2) throw invalid('reason');
      history.push({ at, by: ctx.actor.email, from: b.amount_due, to: due, reason });
      amountDue = due;
      changed.push('amountDue');
    }
  }
  const adminNote = body.adminNote !== undefined ? (cleanText(body.adminNote, LIMITS.adminNote) || null) : b.admin_note;
  if (body.adminNote !== undefined) changed.push('adminNote');
  const names = body.names !== undefined && bk.collectNames && Array.isArray(body.names) ? JSON.stringify(body.names.map(n => cleanText(n, LIMITS.names)).filter(Boolean)) : b.names;
  if (body.names !== undefined) changed.push('names');
  if (!changed.length) return detail(ctx, b.id);

  const grow = b.status === 'confirmed' && seatCount > b.seats_actual;
  if (grow && bk.capacity != null && body.overrideCap !== true) {
    const left = bk.capacity - await seatsTaken(env, event.id);
    if (seatCount - b.seats_actual > left) throw new ApiError('needs_override', 'capacity', { warnings: [{ code: 'capacity', message: left > 0 ? `فاضل ${left} مكان بس.` : 'العدد اكتمل.', left: Math.max(0, left) }], left: Math.max(0, left) });
  }
  if (grow && body.overrideCap === true && reason.length < 2) throw invalid('reason');
  const capOverride = grow && body.overrideCap === true ? JSON.stringify({ by: ctx.actor.email, at, reason }) : b.cap_override;

  const r = await retry(() => env.DB.batch([
    env.DB.prepare(`UPDATE bookings SET actual = ?, seats_actual = ?, amount_due = ?, due_history = ?, admin_note = ?, names = ?, cap_override = ?, updated_ms = ?, version = version + 1
      WHERE id = ? AND version = ?
        AND (? = 0 OR ? = 1 OR (SELECT capacity FROM event_cfg WHERE id = bookings.event_id) IS NULL
             OR (SELECT COALESCE(SUM(b2.seats_actual), 0) FROM bookings b2 WHERE b2.event_id = bookings.event_id AND b2.status = 'confirmed') - bookings.seats_actual + ?
                <= (SELECT capacity FROM event_cfg WHERE id = bookings.event_id))`).bind(
      actual ? JSON.stringify(actual) : null, b.status === 'confirmed' ? seatCount : b.seats_actual, amountDue, JSON.stringify(history), adminNote, names, capOverride, now,
      b.id, version, grow ? 1 : 0, body.overrideCap === true ? 1 : 0, seatCount),
    env.DB.prepare(`INSERT INTO activity (id, at, cairo, actor, actor_name, action, entity_type, entity_id, entity_title, summary, changes)
      SELECT ?, ?, ?, ?, ?, 'booking.update', 'booking', ?, ?, ?, ? WHERE changes() = 1`).bind(randomId('act-'), now, at, ctx.actor.email, ctx.actor.name || null, b.id, b.ref, changed.join('، '), JSON.stringify({ fields: changed }))
  ]));
  if (r[0].meta.changes !== 1) {
    await explainMiss(ctx, b.id, version, null);
    throw new ApiError('needs_override', 'capacity', { warnings: [{ code: 'capacity', message: 'العدد اكتمل.' }] });
  }
  return detail(ctx, b.id);
}

/* ---------- payments (§5.2) ---------- */

export async function adminPaymentAdd(ctx) {
  const env = ctx.env;
  const b = await bookingRow(env, ctx.params.id);
  const pays = await paymentsOf(env, b.id);
  const twin = pays.find(p => p.idem_key === ctx.body.idemKey);
  if (twin) return detail(ctx, b.id);
  const other = KEY.test(String(ctx.body.idemKey || '')) ? await env.DB.prepare('SELECT booking_id FROM payments WHERE idem_key = ?').bind(ctx.body.idemKey).first() : null;
  if (other) throw new ApiError('conflict', 'idemKey used');
  if (b.status === 'pending') throw new ApiError('final', 'pending: use confirm or reject');
  const event = await eventById(ctx, b.event_id);
  const now = Date.now();
  const due = amountDueOf(b);
  const { row, warnings } = await checkPay(ctx, ctx.body, { event, booking: b, paid: paidOf(pays), due, existing: pays, now });
  if (warnings.length) throw new ApiError('warn', 'payment', { warnings });
  const db = env.DB;
  const guard = "EXISTS (SELECT 1 FROM bookings WHERE id = ? AND status <> 'pending')";
  await retry(() => db.batch([
    ...paymentStmts(db, [row], b, ctx.actor, now, guard, [b.id]),
    db.prepare('UPDATE bookings SET version = version + 1, updated_ms = ? WHERE id = ? AND EXISTS (SELECT 1 FROM payments WHERE id = ?)').bind(now, b.id, row.id),
    db.prepare(`INSERT INTO activity (id, at, cairo, actor, actor_name, action, entity_type, entity_id, entity_title, summary)
      SELECT ?, ?, ?, ?, ?, ?, 'booking', ?, ?, ? WHERE EXISTS (SELECT 1 FROM payments WHERE id = ?)`).bind(
      randomId('act-'), now, cairoText(now), ctx.actor.email, ctx.actor.name || null, row.kind === 'refund' ? 'payment.refund' : 'payment.add', b.id, b.ref, row.method + ' · ' + row.servantName, row.id)
  ]));
  return detail(ctx, b.id);
}

/* POST /v1/admin/book/payments/:id/void { reason, idemKey } — once per row, never a void */
export async function adminPaymentVoid(ctx) {
  const env = ctx.env;
  const body = ctx.body;
  if (!/^pay-[a-z0-9]{6,}$/.test(String(ctx.params.id))) throw new ApiError('not_found', 'payment');
  const target = await retry(() => env.DB.prepare('SELECT * FROM payments WHERE id = ?').bind(ctx.params.id).first());
  if (!target) throw new ApiError('not_found', 'payment');
  if (!KEY.test(String(body.idemKey || ''))) throw invalid('idemKey');
  const twin = await env.DB.prepare('SELECT voids_id FROM payments WHERE idem_key = ?').bind(body.idemKey).first();
  if (twin) {
    if (twin.voids_id === target.id) return detail(ctx, target.booking_id);
    throw new ApiError('conflict', 'idemKey used');
  }
  if (target.kind === 'void' || target.voided_by) throw new ApiError('final', 'already voided');
  const reason = cleanText(body.reason, LIMITS.reason);
  if (reason.length < 2) throw invalid('reason');
  const now = Date.now();
  const at = cairoText(now);
  const voidId = randomId('pay-', 6);
  const r = await retry(() => env.DB.batch([
    env.DB.prepare(`INSERT INTO payments (id, booking_id, event_id, kind, amount, servant_id, servant_name, method, received_at, received_ms, recorded_at, recorded_ms, recorded_by, recorded_name, note, voids_id, idem_key)
      SELECT ?, t.booking_id, t.event_id, 'void', t.amount, t.servant_id, t.servant_name, t.method, t.received_at, t.received_ms, ?, ?, ?, ?, ?, t.id, ?
      FROM payments t WHERE t.id = ? AND t.voided_by IS NULL AND t.kind <> 'void'
      ON CONFLICT(idem_key) DO NOTHING`).bind(voidId, at, now, ctx.actor.email, ctx.actor.name || null, reason, body.idemKey, target.id),
    env.DB.prepare('UPDATE payments SET voided_by = ? WHERE id = ? AND voided_by IS NULL AND EXISTS (SELECT 1 FROM payments WHERE id = ?)').bind(voidId, target.id, voidId),
    env.DB.prepare('UPDATE bookings SET version = version + 1, updated_ms = ? WHERE id = ? AND EXISTS (SELECT 1 FROM payments WHERE id = ?)').bind(now, target.booking_id, voidId),
    env.DB.prepare(`INSERT INTO activity (id, at, cairo, actor, actor_name, action, entity_type, entity_id, entity_title, summary)
      SELECT ?, ?, ?, ?, ?, 'payment.void', 'booking', ?, (SELECT ref FROM bookings WHERE id = ?), ? WHERE EXISTS (SELECT 1 FROM payments WHERE id = ?)`).bind(
      randomId('act-'), now, at, ctx.actor.email, ctx.actor.name || null, target.booking_id, target.booking_id, reason, voidId)
  ]));
  if (r[0].meta.changes !== 1) throw new ApiError('final', 'already voided');
  return detail(ctx, target.booking_id);
}

/* ---------- event cancel-all (§7.2) ---------- */

export async function adminCancelAll(ctx) {
  const env = ctx.env;
  const event = await eventById(ctx, ctx.params.id);
  const reason = cleanText(ctx.body.reason, LIMITS.reason);
  if (reason.length < 2) throw invalid('reason');
  const key = String(ctx.body.idemKey || '');
  if (!KEY.test(key)) throw invalid('idemKey');
  const started = await begin(env.DB, 'book.cancelAll:' + event.id, key, { reason });
  if (started.replay) return { __replay: started.replay };
  try {
    const now = Date.now();
    const at = cairoText(now);
    const n = (await env.DB.prepare("SELECT COUNT(*) AS n FROM bookings WHERE event_id = ? AND status IN ('pending', 'confirmed')").bind(event.id).first()).n;
    await retry(() => env.DB.batch([
      env.DB.prepare("UPDATE bookings SET status = 'cancelled', amount_due = 0, cancel_reason = ?, closed_at = ?, closed_by = ?, updated_ms = ?, version = version + 1 WHERE event_id = ? AND status IN ('pending', 'confirmed')")
        .bind(reason, at, ctx.actor.email, now, event.id),
      activityStmt(env.DB, { actor: ctx.actor.email, actorName: ctx.actor.name, action: 'event.cancelAll', entityType: 'event', entityId: event.id, entityTitle: event.title.slice(0, 80), summary: n + ' حجز اتلغى · ' + reason, changes: { cancelled: n } }),
      finishStmt(env.DB, started.claim, 200, { ok: true, cancelled: n })
    ]));
    return { cancelled: n };
  } catch (err) {
    await abandon(env.DB, started.claim).catch(() => {});
    throw err;
  }
}

/* ---------- reports (§13) ---------- */

function rangeOf(q) {
  const from = q.get('from') ? stampMs(q.get('from').length === 10 ? q.get('from') + 'T00:00' : q.get('from')) : null;
  const to = q.get('to') ? stampMs(q.get('to').length === 10 ? q.get('to') + 'T23:59' : q.get('to')) : null;
  return { from, to };
}

async function eventRows(env, eventId) {
  const [bs, ps] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM bookings WHERE event_id = ? ORDER BY created_ms').bind(eventId),
    env.DB.prepare('SELECT * FROM payments WHERE event_id = ? ORDER BY received_ms, recorded_ms').bind(eventId)
  ]);
  return { bookings: bs.results, payments: ps.results };
}

export async function adminSummary(ctx) {
  const event = await eventById(ctx, ctx.url.searchParams.get('eventId'));
  const { bookings, payments } = await eventRows(ctx.env, event.id);
  return summary(event, bookings, payments, (event.booking && event.booking.servants) || [], rangeOf(ctx.url.searchParams));
}

export async function adminExport(ctx) {
  const event = await eventById(ctx, ctx.url.searchParams.get('eventId'));
  const range = rangeOf(ctx.url.searchParams);
  const { bookings, payments } = await eventRows(ctx.env, event.id);
  const now = Date.now();
  const bk = event.booking || {};
  const byBooking = new Map();
  payments.forEach(p => { if (!byBooking.has(p.booking_id)) byBooking.set(p.booking_id, []); byBooking.get(p.booking_id).push(p); });
  const proofs = (await ctx.env.DB.prepare('SELECT DISTINCT payment_id FROM proofs p JOIN payments x ON x.id = p.payment_id WHERE x.event_id = ? AND p.deleted_at IS NULL').bind(event.id).all()).results;
  const withProof = new Set(proofs.map(p => p.payment_id));
  const refs = new Map(bookings.map(b => [b.id, b]));
  return {
    event: { id: event.id, slug: event.slug, title: event.title, startAt: event.startAt, endAt: event.endAt, capacity: bk.capacity == null ? null : bk.capacity, methods: bk.methods || [], pricing: bk.pricing },
    bookings: bookings.map(b => ({
      ...listRow(b, event, paidOf(byBooking.get(b.id) || []), {}, now),
      requested: JSON.parse(b.requested), actual: b.actual ? JSON.parse(b.actual) : null, names: b.names ? JSON.parse(b.names) : [],
      visitorNote: b.visitor_note, adminNote: b.admin_note, rejectReason: b.reject_reason, cancelReason: b.cancel_reason
    })),
    payments: payments.filter(p => (range.from == null || p.received_ms >= range.from) && (range.to == null || p.received_ms <= range.to)).map(p => ({
      id: p.id, bookingId: p.booking_id, ref: refs.get(p.booking_id) ? refs.get(p.booking_id).ref : '', name: refs.get(p.booking_id) ? refs.get(p.booking_id).name : '',
      kind: p.kind, amount: p.amount, method: p.method, servantId: p.servant_id, servantName: p.servant_name, receivedAt: p.received_at,
      recordedAt: p.recorded_at, recordedBy: p.recorded_name || p.recorded_by, voided: !!p.voided_by || p.kind === 'void',
      voidReason: p.kind === 'void' ? p.note : (p.voided_by ? (payments.find(v => v.id === p.voided_by) || {}).note || '' : ''), hasProof: withProof.has(p.id)
    })),
    servants: (bk.servants || []).map(s => ({ id: s.id, name: s.name, methods: s.methods })),
    summary: summary(event, bookings, payments, bk.servants || [], range, now)
  };
}

/* ---------- admin proof upload for a booking (purpose booking | payment) ---------- */

export async function proofTarget(ctx, bookingId) {
  const b = await bookingRow(ctx.env, bookingId);
  const event = await eventById(ctx, b.event_id);
  return { bookingId: b.id, deleteAfterMs: event.endMs + PROOF_LIFE_MS };
}
