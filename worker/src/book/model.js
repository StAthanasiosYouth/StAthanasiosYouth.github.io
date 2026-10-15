/*
 * BOOKING: THE PURE MODEL (docs/EVENTS.md §3, §4, §5, §9, §13).
 * No I/O. Pricing and people match apps-script/BookModel.gs (bookQuote_,
 * bookSeats_, bookPeople_) — test/book-model.test.mjs checks them against
 * that file — plus what the engine adds: request checks, the derived payment
 * figures, the confirm rules, the window, the summary.
 */

export const STATUSES = ['pending', 'confirmed', 'rejected', 'withdrawn', 'cancelled'];
export const CLOSED = ['rejected', 'withdrawn', 'cancelled'];
export const LIMITS = {
  pendingPerPhone: 2, proofs: 3, name: 60, note: 300, adminNote: 500, reason: 200,
  amount: 1000000, names: 60, refundAfterDays: 60
};

/* ---------- Cairo wall clock ⇄ epoch ---------- */

const CAIRO = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});

function wallParts(ms) {
  const p = Object.fromEntries(CAIRO.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute };
}

/* 'YYYY-MM-DDTHH:MM' or 'YYYY-MM-DD HH:MM' (Cairo) → epoch ms, or null */
export function stampMs(stamp) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(String(stamp || ''));
  if (!m) return null;
  const want = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let guess = want - 2 * 3600e3;
  for (let i = 0; i < 3; i++) {
    const w = wallParts(guess);
    const seen = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi);
    if (seen === want) return guess;
    guess += want - seen;
  }
  return guess;
}

/* epoch ms → 'YYYY-MM-DDTHH:MM' Cairo */
export function msStamp(ms) {
  const w = wallParts(ms);
  const p = n => String(n).padStart(2, '0');
  return `${w.y}-${p(w.m)}-${p(w.d)}T${p(w.h)}:${p(w.mi)}`;
}

/* ---------- pricing (as BookModel.gs) ---------- */

export function quote(pricing, counts) {
  return ((pricing && pricing.categories) || []).reduce((sum, c) => sum + (Number(counts && counts[c.key]) || 0) * c.price, 0);
}

export function seats(pricing, counts) {
  return ((pricing && pricing.categories) || []).reduce((sum, c) => sum + (c.seat ? Number(counts && counts[c.key]) || 0 : 0), 0);
}

export function people(pricing, counts) {
  const out = { adult: 0, child: 0, companion: 0, total: 0 };
  ((pricing && pricing.categories) || []).forEach(c => {
    const n = Number(counts && counts[c.key]) || 0;
    out[c.group] += n;
    out.total += n;
  });
  return out;
}

/* FNV-1a of the canonical pricing: a booking keeps the price it was quoted (§3) */
export function priceRev(pricing) {
  const canon = JSON.stringify(((pricing && pricing.categories) || []).map(c => [c.key, c.price, !!c.seat, c.group, c.min, c.max]));
  let h = 0x811c9dc5;
  for (let i = 0; i < canon.length; i++) {
    h ^= canon.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/*
 * The visitor's (or admin's) counts → { counts, problem? }. Every category
 * within its min/max, unknown keys refused, seats ≤ perBookingMax, someone
 * coming. `single` events take only the applicant.
 */
export function checkCounts(booking, input) {
  const cats = (booking && booking.pricing && booking.pricing.categories) || [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { problem: 'counts' };
  const known = new Set(cats.map(c => c.key));
  if (Object.keys(input).some(k => !known.has(k))) return { problem: 'counts' };
  const counts = {};
  for (const c of cats) {
    const raw = input[c.key] === undefined ? (c.min || 0) : input[c.key];
    const n = Number(raw);
    if (!Number.isInteger(n) || n < (c.min || 0) || n > (c.max === undefined ? 30 : c.max)) return { problem: 'counts' };
    if (booking.pricing.mode === 'single' && c.key !== 'applicant' && n > 0) return { problem: 'counts' };
    counts[c.key] = n;
  }
  const s = seats(booking.pricing, counts);
  if (s > (booking.perBookingMax || 10)) return { problem: 'counts', tooMany: true };
  if (people(booking.pricing, counts).total < 1) return { problem: 'counts' };
  return { counts };
}

/* Egyptian mobile → '+201XXXXXXXXX' or '' (as compNormPhoneEg_) */
export function normPhone(value) {
  const text = String(value == null ? '' : value)
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[‎‏؜‪-‮⁦-⁩﻿]/g, '')
    .replace(/[\s \-‐-―.()/]/g, '');
  const plus = text.charAt(0) === '+';
  let digits = plus ? text.slice(1) : text;
  if (!/^\d+$/.test(digits)) return '';
  if (plus) {
    if (digits.indexOf('20') !== 0) return '';
    digits = digits.slice(2);
  } else if (digits.indexOf('0020') === 0) digits = digits.slice(4);
  else if (digits.indexOf('20') === 0 && digits.length >= 11) digits = digits.slice(2);
  if (digits.charAt(0) === '0') digits = digits.slice(1);
  return /^1[0125]\d{8}$/.test(digits) ? '+20' + digits : '';
}

/* one line of plain text: trimmed, control characters and markup brackets gone, clipped */
export function cleanText(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/* ---------- the booking window (§6 bookState) ---------- */

/* { open, reason?, opensAt, closesAt } — closesAt '' = until the event starts */
export function windowState(event, now) {
  const b = event.booking;
  if (!b || !event.online) return { open: false, reason: 'disabled', opensAt: '', closesAt: '' };
  const opens = b.opensAt ? stampMs(b.opensAt) : null;
  const closes = b.closesAt ? stampMs(b.closesAt) : stampMs(event.startAt);
  if (opens && now < opens) return { open: false, reason: 'not_open', opensAt: b.opensAt, closesAt: b.closesAt || '' };
  if (closes && now >= closes) return { open: false, reason: 'closed', opensAt: b.opensAt || '', closesAt: b.closesAt || '' };
  return { open: true, opensAt: b.opensAt || '', closesAt: b.closesAt || '' };
}

/* the public `left` (§6): null when unlimited, or hidden above showLeftBelow */
export function publicLeft(booking, taken) {
  if (!booking || booking.capacity == null) return null;
  const left = Math.max(0, booking.capacity - taken);
  if (left <= 0) return 0;
  if (booking.showLeft === false) return null;
  return left <= (booking.showLeftBelow == null ? 20 : booking.showLeftBelow) ? left : null;
}

/* ---------- money (§4, §5) ---------- */

export function isLive(p) {
  return !p.voided_by && p.kind !== 'void';
}

export function paidOf(payments) {
  return payments.reduce((sum, p) => (isLive(p) ? sum + (p.kind === 'payment' ? p.amount : p.kind === 'refund' ? -p.amount : 0) : sum), 0);
}

/* amount due by status: pending → null; rejected/withdrawn → 0; confirmed/cancelled → the stored figure */
export function amountDueOf(b) {
  if (b.status === 'pending') return null;
  if (b.status === 'rejected' || b.status === 'withdrawn') return 0;
  return b.amount_due == null ? 0 : b.amount_due;
}

/* { paid, balance, paymentStatus, overdue, refundOwed } */
export function derive(b, payments, payment, now) {
  const paid = paidOf(payments);
  const due = amountDueOf(b);
  if (due == null) return { paid, balance: null, paymentStatus: null, overdue: false, refundOwed: Math.max(0, paid) };
  const balance = due - paid;
  const paymentStatus = due === 0 && paid === 0 ? 'free' : paid === 0 && due > 0 ? 'unpaid' : paid < due ? 'partial' : paid === due ? 'paid' : 'overpaid';
  const finalDue = payment && payment.mode === 'installments' && payment.finalDueAt ? stampMs(payment.finalDueAt) : null;
  const overdue = !!(b.status === 'confirmed' && finalDue && now > finalDue && balance > 0);
  return { paid, balance, paymentStatus, overdue, refundOwed: Math.max(0, paid - due) };
}

/*
 * §5.1 — may this booking be confirmed with `paid` money in hand?
 * full: paid ≥ amountDue; installments: paid ≥ min(minFirst, amountDue).
 */
export function confirmPaymentOk(payment, amountDue, paid) {
  if (amountDue <= 0) return true;
  if (payment && payment.mode === 'installments') return paid >= Math.min(payment.minFirst || 0, amountDue);
  return paid >= amountDue;
}

/* ---------- references ---------- */

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';   // no I L O U
export function newRef() {
  const b = crypto.getRandomValues(new Uint8Array(5));
  let out = 'B-';
  for (let i = 0; i < 5; i++) out += CROCKFORD[b[i] & 31];
  return out;
}

/* ---------- summary (§13) ---------- */

export function summary(event, bookings, payments, servants, { from = null, to = null } = {}, now = Date.now()) {
  const booking = event.booking || {};
  const inRange = p => (from == null || p.received_ms >= from) && (to == null || p.received_ms <= to);
  const byBooking = new Map();
  payments.forEach(p => { if (!byBooking.has(p.booking_id)) byBooking.set(p.booking_id, []); byBooking.get(p.booking_id).push(p); });

  const counts = Object.fromEntries(STATUSES.map(s => [s, 0]));
  const ppl = { adult: 0, child: 0, companion: 0, total: 0 };
  const payStatus = { free: 0, unpaid: 0, partial: 0, paid: 0, overpaid: 0, overdue: 0 };
  let taken = 0, due = 0, balance = 0, refundsOwed = 0, pendingQuoted = 0;

  for (const b of bookings) {
    counts[b.status]++;
    const pays = byBooking.get(b.id) || [];
    const d = derive(b, pays, booking.payment, now);
    if (b.status === 'pending') { pendingQuoted += b.quoted_total; continue; }
    if (b.status === 'confirmed') {
      taken += b.seats_actual;
      const pp = people(booking.pricing, JSON.parse(b.actual || '{}'));
      ['adult', 'child', 'companion', 'total'].forEach(k => { ppl[k] += pp[k]; });
    }
    due += amountDueOf(b);
    balance += Math.max(0, d.balance || 0);
    refundsOwed += d.refundOwed;
    if (d.paymentStatus) payStatus[d.paymentStatus]++;
    if (d.overdue) payStatus.overdue++;
  }

  const money = { due, received: 0, refunded: 0, net: 0, balance, refundsOwed, byMethod: {} };
  const perServant = new Map((servants || []).map(s => [s.id, { id: s.id, name: s.name, active: s.active !== false, payments: 0, received: 0, refunded: 0, net: 0, byMethod: {}, bookingIds: new Set(), chosenBy: 0 }]));
  const servantRow = (id, name) => {
    if (!perServant.has(id)) perServant.set(id, { id, name: name || id, active: false, payments: 0, received: 0, refunded: 0, net: 0, byMethod: {}, bookingIds: new Set(), chosenBy: 0 });
    return perServant.get(id);
  };

  for (const p of payments) {
    if (!isLive(p) || !inRange(p)) continue;
    const sign = p.kind === 'payment' ? 1 : -1;
    const m = money.byMethod[p.method || ''] || (money.byMethod[p.method || ''] = { received: 0, refunded: 0, net: 0 });
    if (sign > 0) { money.received += p.amount; m.received += p.amount; } else { money.refunded += p.amount; m.refunded += p.amount; }
    m.net += sign * p.amount;
    const s = servantRow(p.servant_id || '', p.servant_name);
    s.payments++;
    if (sign > 0) s.received += p.amount; else s.refunded += p.amount;
    s.net += sign * p.amount;
    s.byMethod[p.method || ''] = (s.byMethod[p.method || ''] || 0) + sign * p.amount;
    s.bookingIds.add(p.booking_id);
  }
  money.net = money.received - money.refunded;
  for (const b of bookings) {
    if ((b.status === 'pending' || b.status === 'confirmed') && b.servant_id) servantRow(b.servant_id).chosenBy++;
  }

  const capacity = booking.capacity == null ? null : booking.capacity;
  return {
    overall: {
      bookings: counts,
      seats: { capacity, taken, left: capacity == null ? null : capacity - taken },
      people: ppl,
      money,
      payStatus,
      pending: { count: counts.pending, quoted: pendingQuoted }
    },
    servants: [...perServant.values()].map(s => ({ id: s.id, name: s.name, active: s.active, payments: s.payments, received: s.received, refunded: s.refunded, net: s.net, byMethod: s.byMethod, bookings: s.bookingIds.size, chosenBy: s.chosenBy }))
  };
}
