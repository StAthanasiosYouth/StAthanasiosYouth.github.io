/*
 * Paying a remaining balance through the existing booking (Phase 1.5 step 11,
 * BOOKING-PHASE1-COMPLETION-PLAN §4.10).
 *
 * The participant (status view `#b/<token>`) sends a payment REQUEST: the amount
 * they say they sent, the servant + method (an approved online destination) and
 * 1–3 transfer screenshots. It is never a payment: an admin accepts it through
 * the usual «إضافة دفعة» (POST …/payments with `claimId`: the payment row is
 * written and the request marked accepted in one batch), or rejects it with a
 * reason the participant sees. At most one open request per booking (a UNIQUE
 * partial index); a request key makes a resend harmless.
 */

import { ApiError } from '../lib/http.js';
import { retry, cairoText } from '../lib/db.js';
import { limit, clientIp } from '../lib/ratelimit.js';
import { randomId } from '../lib/hash.js';
import { readStatusToken, checkProofClaim } from './token.js';
import { bookMailStmts } from './account.js';
import { checkTurnstile } from './turnstile.js';
import { payDestRequired, payDest } from './pay.js';
import { bookingOn } from './public.js';
import { derive, methodOnline, cleanText, LIMITS } from './model.js';

const KEY = /^[A-Za-z0-9_.:-]{8,100}$/;
const PROOF = /^prf-[a-z2-7]{8}$/;
const PROOF_KEEP_MS = 60 * 24 * 3600 * 1000;    // like the booking's own proofs: event end + 60 days

const invalid = field => new ApiError('invalid', field, { field });

let switchCache = { at: 0, on: false };

/* is «ادفع الباقي» on? (settings PAY_REQUESTS = '1'; missing or '0' = off, cached 10 s).
   Off: no new request, no card or upload by the status token; open requests can still
   be withdrawn by the participant and decided by an admin. */
export async function payRequestsOn(env, now = Date.now()) {
  if (now - switchCache.at < 10_000) return switchCache.on;
  const row = await retry(() => env.DB.prepare("SELECT value FROM settings WHERE key = 'PAY_REQUESTS'").first());
  switchCache = { at: now, on: !!row && row.value === '1' };
  return switchCache.on;
}
export function forgetPayRequests() { switchCache = { at: 0, on: false }; }

/*
 * The booking a status token names, with its event and money now:
 * { b, event (parsed booking config), ev (row), balance, paid }.
 */
export async function bookingForToken(ctx, token) {
  const id = await readStatusToken(ctx.env, token);
  const db = ctx.env.DB;
  const b = await retry(() => db.prepare('SELECT * FROM bookings WHERE id = ?').bind(id).first());
  if (!b) throw new ApiError('expired', 'gone');
  const ev = await retry(() => db.prepare('SELECT * FROM event_cfg WHERE id = ?').bind(b.event_id).first());
  const booking = ev && ev.booking ? JSON.parse(ev.booking) : null;
  const pays = (await retry(() => db.prepare('SELECT kind, amount, voided_by FROM payments WHERE booking_id = ?').bind(b.id).all())).results;
  const d = derive(b, pays, booking ? booking.payment : null, Date.now());
  return { b, ev, booking, balance: d.balance, paid: d.paid, on: await payRequestsOn(ctx.env) };
}

/* may this booking take a balance payment now? → '' or why not */
export function payableWhy(x) {
  if (!x.on || !x.booking) return 'disabled';
  if (x.b.status !== 'confirmed') return 'status';
  if (!(x.balance > 0)) return 'paid';
  return '';
}

/* the request a participant sees on the status view: the open one, else the last decided one */
export async function claimForStatus(env, bookingId) {
  const r = await retry(() => env.DB.prepare(`SELECT status, amount, reason, created_at, decided_at FROM payment_claims WHERE booking_id = ?
    ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_ms DESC LIMIT 1`).bind(bookingId).first());
  if (!r || r.status === 'withdrawn') return null;
  return { status: r.status, amount: r.amount, reason: r.status === 'rejected' ? r.reason || '' : '', at: r.decided_at || r.created_at };
}

/* every request of a booking, for the admin sheet (newest first) */
export async function claimsOf(env, bookingId) {
  const r = await retry(() => env.DB.prepare('SELECT * FROM payment_claims WHERE booking_id = ? ORDER BY created_ms DESC').bind(bookingId).all());
  return r.results.map(c => ({
    id: c.id, status: c.status, amount: c.amount, servantId: c.servant_id, method: c.method, proofIds: JSON.parse(c.proof_ids || '[]'),
    paymentId: c.payment_id, reason: c.reason, createdAt: c.created_at, decidedAt: c.decided_at, decidedBy: c.decided_by
  }));
}

/*
 * POST /v1/book/pay-request { token, requestKey, servantId, method, amount, proofs: [{ proofId, claim }], turnstile }
 * → { request: { status: 'pending', amount } }. Writes the request + an activity row; never a payment.
 */
export async function bookPayRequest(ctx) {
  if (!(await bookingOn(ctx.env))) throw new ApiError('disabled', 'module off');
  const body = ctx.body || {};
  const ip = clientIp(ctx.request);
  await limit(ctx, 'book.payreq', ip, 10, 600);
  if (!KEY.test(String(body.requestKey || ''))) throw invalid('requestKey');
  const x = await bookingForToken(ctx, body.token);
  if (!x.on) throw new ApiError('disabled', 'pay requests off');
  const db = ctx.env.DB;

  // the same request sent again (a retry after a lost answer): its answer, nothing new
  const twin = await retry(() => db.prepare('SELECT booking_id, status, amount FROM payment_claims WHERE request_key = ?').bind(body.requestKey).first());
  if (twin) {
    if (twin.booking_id !== x.b.id) throw new ApiError('conflict', 'requestKey reused');
    return { request: { status: twin.status, amount: twin.amount } };
  }
  await limit(ctx, 'book.payreq.booking', x.b.id, 5, 86400);

  const why = payableWhy(x);
  if (why) throw new ApiError('final', why);
  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount < 1 || amount > x.balance) throw invalid('amount');
  const servant = (x.booking.servants || []).find(s => s.id === body.servantId);
  if (!servant) throw invalid('servantId');
  const m = (x.booking.methods || []).find(k => k.key === body.method);
  if (!m || !servant.methods.includes(m.key) || !methodOnline(m)) throw invalid('method');
  if (await payDestRequired(ctx.env) && !(await payDest(ctx.env, servant.id, m.key))) throw invalid('method');
  const list = Array.isArray(body.proofs) ? body.proofs : [];
  if (list.length < 1 || list.length > LIMITS.proofs) throw invalid('proofs');
  for (const p of list) {
    if (!p || !PROOF.test(String(p.proofId)) || !(await checkProofClaim(ctx.env, p.proofId, p.claim))) throw new ApiError('proof', 'claim');
  }
  const proofs = [...new Set(list.map(p => p.proofId))];
  const found = await db.prepare(`SELECT id FROM proofs WHERE id IN (${proofs.map(() => '?').join(',')}) AND booking_id IS NULL AND deleted_at IS NULL`).bind(...proofs).all();
  if (found.results.length !== proofs.length) throw new ApiError('proof', 'missing or used');

  await checkTurnstile(ctx, body.turnstile, ip);

  const now = Date.now();
  const id = randomId('pcl-', 6);
  const at = cairoText(now);
  const made = 'EXISTS (SELECT 1 FROM payment_claims WHERE id = ?)';
  try {
    await retry(() => db.batch([
      db.prepare(`INSERT INTO payment_claims (id, booking_id, event_id, servant_id, method, amount, proof_ids, status, request_key, created_at, created_ms)
        SELECT ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ? WHERE EXISTS (SELECT 1 FROM bookings WHERE id = ? AND status = 'confirmed')`).bind(
        id, x.b.id, x.b.event_id, servant.id, m.key, amount, JSON.stringify(proofs), body.requestKey, at, now, x.b.id),
      // the screenshots join the booking (kept like its other proofs); still not a payment's
      db.prepare(`UPDATE proofs SET booking_id = ?, delete_after_ms = ? WHERE id IN (${proofs.map(() => '?').join(',')}) AND booking_id IS NULL AND ${made}`)
        .bind(x.b.id, (x.ev ? x.ev.end_ms : now) + PROOF_KEEP_MS, ...proofs, id),
      db.prepare(`INSERT INTO activity (id, at, cairo, actor, actor_name, action, entity_type, entity_id, entity_title, summary, changes, severity)
        SELECT ?, ?, ?, 'visitor', 'زائر', 'payment.request', 'booking', ?, ?, ?, ?, 'important' WHERE ${made}`).bind(
        randomId('act-'), now, at, x.b.id, x.b.ref, 'طلب دفع الباقي · ' + m.key + ' · ' + servant.name, JSON.stringify({ amount }), id),
      ...bookMailStmts(db, x.b, 'pay.request', { guard: made, guardBinds: [id], dedupe: 'pay:req:' + id, now, entityType: 'claim', entityId: id })
    ]));
  } catch (err) {
    // the UNIQUE partial index: another request is already open for this booking
    if (/UNIQUE constraint failed: payment_claims\.booking_id/i.test(String(err && err.message))) throw new ApiError('conflict', 'open request', { reason: 'open' });
    if (/UNIQUE constraint failed: payment_claims\.request_key/i.test(String(err && err.message))) return { request: { status: 'pending', amount } };
    throw err;
  }
  const stored = await retry(() => db.prepare('SELECT status FROM payment_claims WHERE id = ?').bind(id).first());
  if (!stored) throw new ApiError('final', 'status');
  return { request: { status: 'pending', amount } };
}

/* POST /v1/book/pay-request/withdraw { token } — the participant takes back their open request */
export async function bookPayRequestWithdraw(ctx) {
  await limit(ctx, 'book.status', clientIp(ctx.request), 60, 60);
  const x = await bookingForToken(ctx, (ctx.body || {}).token);
  const now = Date.now();
  const r = await retry(() => ctx.env.DB.batch([
    ctx.env.DB.prepare("UPDATE payment_claims SET status = 'withdrawn', decided_at = ?, decided_ms = ?, decided_by = 'visitor' WHERE booking_id = ? AND status = 'pending'")
      .bind(cairoText(now), now, x.b.id),
    ctx.env.DB.prepare(`INSERT INTO activity (id, at, cairo, actor, actor_name, action, entity_type, entity_id, entity_title, summary)
      SELECT ?, ?, ?, 'visitor', 'زائر', 'payment.requestWithdraw', 'booking', ?, ?, 'الزائر سحب طلب الدفع' WHERE changes() = 1`).bind(randomId('act-'), now, cairoText(now), x.b.id, x.b.ref)
  ]));
  return { withdrawn: r[0].meta.changes === 1 };
}

/* POST /v1/admin/book/claims/:id/reject { reason } — the participant sees the reason */
export async function adminClaimReject(ctx) {
  const id = String(ctx.params.id || '');
  if (!/^pcl-[a-z0-9]{6,}$/.test(id)) throw new ApiError('not_found', 'id');
  const reason = cleanText((ctx.body || {}).reason, LIMITS.reason);
  if (reason.length < 2) throw invalid('reason');
  const db = ctx.env.DB;
  const c = await retry(() => db.prepare('SELECT c.*, b.ref, b.participant_id FROM payment_claims c JOIN bookings b ON b.id = c.booking_id WHERE c.id = ?').bind(id).first());
  if (!c) throw new ApiError('not_found', 'claim');
  if (c.status !== 'pending') throw new ApiError('final', c.status);
  const now = Date.now();
  const r = await retry(() => db.batch([
    db.prepare("UPDATE payment_claims SET status = 'rejected', reason = ?, decided_at = ?, decided_ms = ?, decided_by = ? WHERE id = ? AND status = 'pending'")
      .bind(reason, cairoText(now), now, ctx.actor.email, id),
    db.prepare(`INSERT INTO activity (id, at, cairo, actor, actor_name, action, entity_type, entity_id, entity_title, summary)
      SELECT ?, ?, ?, ?, ?, 'payment.requestReject', 'booking', ?, ?, ? WHERE changes() = 1`).bind(
      randomId('act-'), now, cairoText(now), ctx.actor.email, ctx.actor.name || null, c.booking_id, c.ref, ('رفض طلب الدفع: ' + reason).slice(0, 200)),
    ...bookMailStmts(db, c, 'pay.requestRejected', { guard: "EXISTS (SELECT 1 FROM payment_claims WHERE id = ? AND status = 'rejected')", guardBinds: [id], dedupe: 'pay:reqrej:' + id, now, entityType: 'claim', entityId: id })
  ]));
  if (r[0].meta.changes !== 1) throw new ApiError('final', 'moved');
  return { claim: { id, status: 'rejected', reason }, bookingId: c.booking_id };
}

/* a claim accepted with the payment that records it (adminPaymentAdd): its check and its statement */
export async function claimToAccept(env, claimId, bookingId) {
  if (!/^pcl-[a-z0-9]{6,}$/.test(String(claimId || ''))) throw invalid('claimId');
  const c = await retry(() => env.DB.prepare('SELECT * FROM payment_claims WHERE id = ? AND booking_id = ?').bind(claimId, bookingId).first());
  if (!c) throw invalid('claimId');
  if (c.status !== 'pending') throw new ApiError('final', 'claim ' + c.status);
  return { id: c.id, proofIds: JSON.parse(c.proof_ids || '[]'), amount: c.amount, servantId: c.servant_id, method: c.method };
}
export function claimAcceptStmt(db, claimId, paymentId, actor, now) {
  return db.prepare("UPDATE payment_claims SET status = 'accepted', payment_id = ?, decided_at = ?, decided_ms = ?, decided_by = ? WHERE id = ? AND status = 'pending' AND EXISTS (SELECT 1 FROM payments WHERE id = ?)")
    .bind(paymentId, cairoText(now), now, actor.email, claimId, paymentId);
}
