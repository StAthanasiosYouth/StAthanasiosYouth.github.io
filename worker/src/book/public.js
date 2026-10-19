/*
 * Public booking routes (docs/EVENTS.md §6, worker/BOOKING-API.md).
 * Order for a write: switch → budget → shape → event published & open
 * (server clock) → requestKey replay → validation → Turnstile → server price
 * → places → one atomic batch (per-phone limit inside the INSERT; the
 * grouped «new bookings» counter for the admin push) → reply.
 * Nothing here reveals a phone, a full name, a proof or a payment row.
 */

import { ApiError } from '../lib/http.js';
import { limit, clientIp } from '../lib/ratelimit.js';
import { retry, cairoText } from '../lib/db.js';
import { activityStmt } from '../lib/activity.js';
import { randomId } from '../lib/hash.js';
import { putProof } from '../lib/proofs.js';
import { loadEvent, seatsTaken } from './event.js';
import { statusToken, readStatusToken, proofClaim, checkProofClaim } from './token.js';
import { checkTurnstile, turnstileSiteKey } from './turnstile.js';
import { payDestRequired, payDest } from './pay.js';
import {
  checkCounts, normPhone, cleanText, quote, seats, people, windowState, publicLeft,
  derive, amountDueOf, newRef, LIMITS, stampMs, methodOnline, participantCounts
} from './model.js';

const KEY = /^[A-Za-z0-9_.:-]{8,100}$/;
const TOKEN_LIFE_MS = 60 * 24 * 3600 * 1000;      // §6: event end + 60 days
const UNCLAIMED_MS = 24 * 3600 * 1000;

let moduleCache = { at: 0, on: false };

export async function bookingOn(env, now = Date.now()) {
  if (now - moduleCache.at < 10_000) return moduleCache.on;
  const row = await retry(() => env.DB.prepare("SELECT value FROM settings WHERE key = 'BOOKING_MODULE'").first());
  moduleCache = { at: now, on: !!row && row.value === '1' };
  return moduleCache.on;
}
export function forgetModule() { moduleCache = { at: 0, on: false }; }

async function requireOn(ctx) {
  if (!(await bookingOn(ctx.env))) throw new ApiError('disabled', 'module off');
}

function invalid(field) {
  return new ApiError('invalid', field, { field });
}

function openOrThrow(event, now) {
  const w = windowState(event, now);
  if (w.open) return w;
  if (w.reason === 'not_open') throw new ApiError('not_open', 'window', { opensAt: w.opensAt });
  if (w.reason === 'closed') throw new ApiError('closed', 'window');
  throw new ApiError('disabled', 'not online');
}

/* GET /v1/book/state?slug= */
export async function bookState(ctx) {
  await requireOn(ctx);
  await limit(ctx, 'book.state', clientIp(ctx.request), 120, 60);
  const event = await loadEvent(ctx, ctx.url.searchParams.get('slug'));
  const w = windowState(event, Date.now());
  const base = { opensAt: w.opensAt, closesAt: w.closesAt, revision: event.revision, left: null, turnstile: turnstileSiteKey(ctx.env) };
  if (!w.open) return { __cache: 'public, max-age=15', open: false, reason: w.reason, ...base };
  const taken = await seatsTaken(ctx.env, event.id);
  if (event.booking.capacity != null && event.booking.capacity - taken <= 0) return { __cache: 'public, max-age=15', open: false, reason: 'full', ...base, left: 0 };
  return { __cache: 'public, max-age=15', open: true, ...base, left: publicLeft(event.booking, taken) };
}

/* POST /v1/book/proof?slug=  (raw image) → { proofId, claim } */
export async function bookProof(ctx) {
  await requireOn(ctx);
  await limit(ctx, 'book.proof', clientIp(ctx.request), 10, 600);
  const event = await loadEvent(ctx, ctx.url.searchParams.get('slug'));
  openOrThrow(event, Date.now());
  let out;
  try {
    out = await putProof(ctx.env, { bytes: ctx.raw, purpose: 'booking', by: 'visitor', deleteAfterMs: Date.now() + UNCLAIMED_MS });
  } catch (err) {
    if (err instanceof ApiError && (err.code === 'bad' || err.code === 'toolarge')) throw new ApiError('proof', err.message);
    throw err;
  }
  return { proofId: out.proof.id, claim: await proofClaim(ctx.env, out.proof.id) };
}

async function replyFor(env, b, event, extra = {}) {
  return {
    ref: b.ref, status: b.status, quotedTotal: b.quoted_total,
    token: await statusToken(env, b.id, (event ? event.endMs : b.created_ms) + TOKEN_LIFE_MS),
    ...extra
  };
}

/* POST /v1/book/submit */
export async function bookSubmit(ctx) {
  await requireOn(ctx);
  const ip = clientIp(ctx.request);
  await limit(ctx, 'book.submit', ip, 10, 60);
  const body = ctx.body;
  if (body.hp) throw new ApiError('bad', 'honeypot');
  if (!KEY.test(String(body.requestKey || ''))) throw new ApiError('bad', 'requestKey');
  const event = await loadEvent(ctx, body.slug);
  await limit(ctx, 'book.submit.event', event.id, 20, 60);

  const existing = await retry(() => ctx.env.DB.prepare('SELECT * FROM bookings WHERE request_key = ?').bind(body.requestKey).first());
  if (existing) {
    if (existing.event_id !== event.id) throw new ApiError('conflict', 'requestKey reused');
    return replyFor(ctx.env, existing, event, { replay: true });
  }

  const now = Date.now();
  openOrThrow(event, now);
  const b = event.booking;

  const name = cleanText(body.name, LIMITS.name);
  if (name.length < 2) throw invalid('name');
  const phone = normPhone(body.phone);
  if (!phone) throw invalid('phone');
  // «كل فرد باسمه وسنه»: the counts come from the people list (each priced by age, server side)
  let party = null;
  if (b.participants) {
    party = participantCounts(b, body.participants);
    if (party.problem) throw invalid('participants');
  }
  const checked = checkCounts(b, party ? party.counts : body.counts);
  if (checked.problem) throw invalid(party ? 'participants' : 'counts');
  const counts = checked.counts;
  const ppl = people(b.pricing, counts);
  let names = null;
  if (party) names = party.list.map(p => p.name);
  else if (b.collectNames) {
    if (!Array.isArray(body.names) || body.names.length > ppl.total) throw invalid('names');
    names = body.names.map(n => cleanText(n, LIMITS.names)).filter(Boolean);
  }
  const note = cleanText(body.note, LIMITS.note) || null;
  const total = quote(b.pricing, counts);
  const seatCount = seats(b.pricing, counts);

  let servantId = null, method = null, proofs = [];
  if (total > 0) {
    const servant = b.servants.find(s => s.id === body.servantId);
    if (!servant) throw invalid('servantId');
    servantId = servant.id;
    if (!servant.methods.includes(body.method)) throw invalid('method');
    method = body.method;
    const m = b.methods.find(x => x.key === method) || {};
    // cash (any offline method) is servant-assisted: visitors can't book with it (Phase 1, B4)
    if (!methodOnline(m)) throw invalid('method');
    // InstaPay / wallet: only to a destination the primary admin approved (§4.7), once the set is synced
    if (await payDestRequired(ctx.env) && !(await payDest(ctx.env, servant.id, method))) throw invalid('method');
    const list = Array.isArray(body.proofs) ? body.proofs : [];
    if (list.length > LIMITS.proofs || (m.needsProof && list.length < 1)) throw invalid('proofs');
    for (const p of list) {
      if (!p || !/^prf-[a-z2-7]{8}$/.test(String(p.proofId)) || !(await checkProofClaim(ctx.env, p.proofId, p.claim))) throw new ApiError('proof', 'claim');
    }
    proofs = [...new Set(list.map(p => p.proofId))];
    if (proofs.length) {
      const found = await ctx.env.DB.prepare(`SELECT id FROM proofs WHERE id IN (${proofs.map(() => '?').join(',')}) AND purpose = 'booking' AND booking_id IS NULL AND deleted_at IS NULL`).bind(...proofs).all();
      if (found.results.length !== proofs.length) throw new ApiError('proof', 'missing or used');
    }
  }

  await checkTurnstile(ctx, body.turnstile, ip);

  if (b.capacity != null) {
    const left = b.capacity - await seatsTaken(ctx.env, event.id);
    if (seatCount > left) throw new ApiError('full', 'seats', { left: Math.max(0, left) });
  }

  const priceChanged = !!(body.revision && body.revision !== event.revision);
  const id = randomId('bkg-', 6);
  const createdAt = cairoText(now);

  for (let attempt = 0; attempt < 3; attempt++) {
    const ref = newRef();
    const db = ctx.env.DB;
    const stmts = [
      // at most 2 PENDING bookings per phone per event, decided inside the write
      db.prepare(`INSERT INTO bookings (id, ref, event_id, source, status, name, phone, servant_id, method, requested, seats_requested, names,
          quoted_total, price_rev, visitor_note, request_key, created_at, created_ms, updated_ms, participants)
        SELECT ?, ?, ?, 'site', 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE (SELECT COUNT(*) FROM bookings WHERE event_id = ? AND phone = ? AND status = 'pending') < ?
        ON CONFLICT(request_key) DO NOTHING`).bind(
        id, ref, event.id, name, phone, servantId, method, JSON.stringify(counts), seatCount, names ? JSON.stringify(names) : null,
        total, event.priceRev, note, body.requestKey, createdAt, now, now, party ? JSON.stringify(party.list) : null, event.id, phone, LIMITS.pendingPerPhone)
    ];
    if (proofs.length) {
      stmts.push(db.prepare(`UPDATE proofs SET booking_id = ?, delete_after_ms = ? WHERE id IN (${proofs.map(() => '?').join(',')}) AND booking_id IS NULL AND EXISTS (SELECT 1 FROM bookings WHERE id = ?)`)
        .bind(id, event.endMs + TOKEN_LIFE_MS, ...proofs, id));
    }
    stmts.push(db.prepare(`INSERT INTO activity (id, at, cairo, actor, actor_name, action, entity_type, entity_id, entity_title, summary)
        SELECT ?, ?, ?, 'visitor', 'زائر', 'booking.new', 'booking', ?, ?, ? WHERE EXISTS (SELECT 1 FROM bookings WHERE id = ?)`)
      .bind(randomId('act-'), now, createdAt, id, ref, event.title.slice(0, 80) + ' · ' + ppl.total + ' أفراد', id));
    // §7.3: one more booking for this event's next grouped admin push (POST /v1/sync/book-news)
    stmts.push(db.prepare(`INSERT INTO book_news (event_id, title, unsent, first_ms, last_ms)
        SELECT ?, ?, 1, ?, ? WHERE EXISTS (SELECT 1 FROM bookings WHERE id = ?)
        ON CONFLICT(event_id) DO UPDATE SET unsent = book_news.unsent + 1, title = excluded.title,
          first_ms = COALESCE(book_news.first_ms, excluded.first_ms), last_ms = excluded.last_ms`)
      .bind(event.id, event.title.slice(0, 120), now, now, id));
    try {
      const r = await retry(() => db.batch(stmts));
      if (r[0].meta.changes === 1) {
        const row = { id, ref, status: 'pending', quoted_total: total, created_ms: now };
        return replyFor(ctx.env, row, event, priceChanged ? { priceChanged: true } : {});
      }
      const twin = await db.prepare('SELECT * FROM bookings WHERE request_key = ?').bind(body.requestKey).first();
      if (twin) return replyFor(ctx.env, twin, event, { replay: true });
      throw new ApiError('limit', 'pending per phone');
    } catch (err) {
      if (/UNIQUE constraint failed: bookings\.event_id, bookings\.ref/i.test(String(err && err.message))) continue;   // ref clash: a new one
      if (/UNIQUE constraint failed: bookings\.id/i.test(String(err && err.message))) {
        const twin = await db.prepare('SELECT * FROM bookings WHERE request_key = ?').bind(body.requestKey).first();
        if (twin) return replyFor(ctx.env, twin, event, { replay: true });
      }
      throw err;
    }
  }
  throw new ApiError('busy', 'ref');
}

async function bookingByToken(ctx, token) {
  const id = await readStatusToken(ctx.env, token);
  const b = await retry(() => ctx.env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(id).first());
  if (!b) throw new ApiError('expired', 'gone');
  const ev = await retry(() => ctx.env.DB.prepare('SELECT * FROM event_cfg WHERE id = ?').bind(b.event_id).first());
  return { b, ev };
}

/* POST /v1/book/status { token } */
export async function bookStatus(ctx) {
  await limit(ctx, 'book.status', clientIp(ctx.request), 60, 60);
  const { b, ev } = await bookingByToken(ctx, ctx.body.token);
  const booking = ev && ev.booking ? JSON.parse(ev.booking) : { pricing: { categories: [] } };
  const counts = JSON.parse(b.actual || b.requested || '{}');
  const out = {
    ref: b.ref,
    event: ev ? { slug: ev.slug, title: ev.title, startAt: ev.start_at } : null,
    status: b.status,
    firstName: String(b.name).split(' ')[0],
    people: people(booking.pricing, counts),
    quotedTotal: b.quoted_total,
    createdAt: b.created_at
  };
  if (b.status !== 'pending') {
    const pays = (await ctx.env.DB.prepare('SELECT kind, amount, voided_by FROM payments WHERE booking_id = ?').bind(b.id).all()).results;
    const d = derive(b, pays, booking.payment, Date.now());
    Object.assign(out, { amountDue: amountDueOf(b), paid: d.paid, balance: d.balance, paymentStatus: d.paymentStatus, overdue: d.overdue });
    if (booking.payment && booking.payment.mode === 'installments' && booking.payment.finalDueAt) out.finalDueAt = booking.payment.finalDueAt;
  }
  if (b.status === 'rejected' && b.reject_reason) out.reason = b.reject_reason;
  if (b.status === 'cancelled' && b.cancel_reason) out.reason = b.cancel_reason;
  return out;
}

/* POST /v1/book/withdraw { token, requestKey } — pending only */
export async function bookWithdraw(ctx) {
  await limit(ctx, 'book.status', clientIp(ctx.request), 60, 60);
  const { b } = await bookingByToken(ctx, ctx.body.token);
  if (b.status === 'withdrawn') return { status: 'withdrawn' };
  if (b.status !== 'pending') throw new ApiError('final', b.status);
  const now = Date.now();
  const r = await retry(() => ctx.env.DB.batch([
    ctx.env.DB.prepare("UPDATE bookings SET status = 'withdrawn', amount_due = 0, closed_at = ?, closed_by = 'visitor', updated_ms = ?, version = version + 1 WHERE id = ? AND status = 'pending'")
      .bind(cairoText(now), now, b.id),
    ctx.env.DB.prepare("INSERT INTO activity (id, at, cairo, actor, actor_name, action, entity_type, entity_id, entity_title, summary) SELECT ?, ?, ?, 'visitor', 'زائر', 'booking.withdraw', 'booking', ?, ?, 'الزائر لغى الطلب' WHERE changes() = 1")
      .bind(randomId('act-'), now, cairoText(now), b.id, b.ref)
  ]));
  if (r[0].meta.changes !== 1) {
    const again = await ctx.env.DB.prepare('SELECT status FROM bookings WHERE id = ?').bind(b.id).first();
    if (again && again.status === 'withdrawn') return { status: 'withdrawn' };
    throw new ApiError('final', 'moved');
  }
  return { status: 'withdrawn' };
}

export { stampMs };
