// A stand-in for the Worker's booking routes (worker/BOOKING-API.md), for the
// admin e2e (tests/book-admin.e2e.mjs): in memory, the documented shapes,
// codes and rules the admin reacts to — version (conflict), warn (force),
// needs_override (overridePay / overrideCap + reason), Idempotency-Key
// replays, proofs as raw bytes. Not the real engine: only what the screens
// need, so the admin's own behaviour can be checked against the contract.

import { normPhone } from '../../admin/book-kit.js';

export const WORKER_URL = 'https://athanasios-api.menazak-lab.workers.dev';

const clone = value => JSON.parse(JSON.stringify(value));

const MESSAGES = {
  conflict: 'حد عدّل الحجز ده قبلك.',
  warn: 'في ملاحظات قبل التسجيل.',
  needs_override: 'الحجز مينفعش يتأكد كده.',
  busy: 'في طلب زي ده شغال دلوقتي. جرّب كمان ثانية.',
  invalid: 'في بيانات محتاجة تتصلح.',
  final: 'الحجز ده مينفعش يتغير كده دلوقتي.',
  not_found: 'مش لاقيين الفعالية أو الحجز ده.',
  auth: 'لازم تدخل بحساب جوجل تاني.',
  denied: 'مش مسموح لك تستخدم لوحة التحكم.',
  locked: 'أدمن تاني بيعدّل الحجز ده دلوقتي.'
};
const STATUS = { conflict: 409, warn: 409, needs_override: 409, busy: 409, invalid: 400, final: 409, not_found: 404, auth: 401, denied: 403, error: 500, locked: 409 };

class Fail extends Error {
  constructor(code, extra = {}) {
    super(code);
    this.code = code;
    this.extra = extra;
  }
}

export function createBookWorker({ event, origin, proofBytes, now = () => '2026-10-15T12:00' }) {

  const state = {
    module: { on: true, env: 'production' },
    moduleReply: null,                 // { status, body } to answer GET /module with instead
    event: clone(event),
    bookings: [],
    payments: [],
    proofs: [],
    seq: 0,
    idem: new Map(),
    calls: [],
    inject: [],                        // [{ match(method, path), code, extra, times }]
    lockHolder: null,                  // { name, since }: another admin's page holds every booking (edit locks)
    lockRenew: 30000,                  // what POST …/lock says about renewing
    sessions: new Set()                // the x-edit-session values seen
  };

  const id = prefix => `${prefix}-${String(++state.seq).padStart(4, '0')}`;
  const ev = () => state.event;
  const cats = () => ev().pricing.categories;
  const quote = counts => cats().reduce((s, c) => s + (Number(counts[c.key]) || 0) * c.price, 0);
  const seats = counts => cats().reduce((s, c) => s + (c.seat !== false ? Number(counts[c.key]) || 0 : 0), 0);
  const people = counts => {
    const out = { adult: 0, child: 0, companion: 0, total: 0 };
    cats().forEach(c => { const n = Number(counts[c.key]) || 0; out[c.group] += n; out.total += n; });
    return out;
  };
  const live = p => !p.voidedBy && p.kind !== 'void';
  const paysOf = b => state.payments.filter(p => p.bookingId === b.id);
  const paidOf = b => paysOf(b).reduce((s, p) => (live(p) ? s + (p.kind === 'payment' ? p.amount : p.kind === 'refund' ? -p.amount : 0) : s), 0);
  const dueOf = b => (b.status === 'pending' ? null : b.status === 'rejected' || b.status === 'withdrawn' ? 0 : b.amountDue || 0);
  const taken = () => state.bookings.filter(b => b.status === 'confirmed').reduce((s, b) => s + seats(b.actual), 0);
  const left = () => (ev().capacity == null ? null : ev().capacity - taken());

  function derived(b) {
    const paid = paidOf(b);
    const due = dueOf(b);
    if (due === null) return { paid, balance: null, paymentStatus: null, overdue: false, refundOwed: Math.max(0, paid) };
    const balance = due - paid;
    const paymentStatus = due === 0 && paid === 0 ? 'free' : paid === 0 && due > 0 ? 'unpaid' : paid < due ? 'partial' : paid === due ? 'paid' : 'overpaid';
    return { paid, balance, paymentStatus, overdue: !!b.overdue && b.status === 'confirmed' && balance > 0, refundOwed: Math.max(0, paid - due) };
  }

  function row(b) {
    const counts = b.status === 'confirmed' || b.status === 'cancelled' ? b.actual : b.requested;
    const servant = ev().servants.find(s => s.id === b.servantId);
    return {
      id: b.id, ref: b.ref, eventId: ev().id, status: b.status, source: b.source, name: b.name, phone: b.phone,
      servantId: b.servantId, servantName: servant ? servant.name : '', method: b.method, people: people(counts), seats: seats(counts),
      quotedTotal: b.quotedTotal, amountDue: dueOf(b), ...derived(b), createdAt: b.createdAt, confirmedAt: b.confirmedAt || '',
      flags: { ...b.flags }, version: b.version
    };
  }

  function eventRow() {
    const counts = { pending: 0, confirmed: 0, rejected: 0, withdrawn: 0, cancelled: 0 };
    state.bookings.forEach(b => { counts[b.status]++; });
    return { id: ev().id, slug: ev().slug, title: ev().title, startAt: ev().startAt, endAt: ev().endAt, capacity: ev().capacity, taken: taken(), left: left(),
      online: true, counts, refreshedAt: '2026-10-15T09:00' };
  }

  function detail(b) {
    return {
      booking: { ...row(b), requested: b.requested, actual: b.actual, names: b.names || [], visitorNote: b.visitorNote || '', adminNote: b.adminNote || '',
        rejectReason: b.rejectReason || '', cancelReason: b.cancelReason || '', capOverride: b.capOverride || null, dueHistory: b.dueHistory || [], priceRev: 'abcd1234', closedAt: '', closedBy: '' },
      payments: clone(paysOf(b)),
      lock: state.lockHolder ? { mine: false, holder: clone(state.lockHolder) } : { mine: true, holder: { name: 'Me', since: 0 } },
      proofs: clone(state.proofs.filter(p => p.bookingId === b.id)),
      derived: derived(b),
      event: { ...clone(ev()), taken: taken(), left: left() }
    };
  }

  /* a booking as a visitor leaves it (seeded by the tests) */
  function seed(input) {
    const b = {
      id: id('bk'), ref: input.ref, status: 'pending', source: input.source || 'site', name: input.name, phone: input.phone,
      servantId: input.servantId || '', method: input.method || '', requested: input.counts, actual: input.counts, names: input.names || [],
      visitorNote: input.note || '', quotedTotal: quote(input.counts), amountDue: null, createdAt: input.createdAt || '2026-10-10T09:00',
      flags: { dupProof: false, phoneTwice: false, priceChanged: false, ...(input.flags || {}) }, version: 1, dueHistory: [], overdue: !!input.overdue
    };
    state.bookings.push(b);
    (input.proofs || 0) && Array.from({ length: input.proofs }).forEach(() => {
      state.proofs.push({ id: id('prf'), purpose: 'visitor', paymentId: '', by: 'visitor', at: b.createdAt, bytes: proofBytes.length, width: 40, height: 60, dup: !!(input.flags && input.flags.dupProof), bookingId: b.id });
    });
    if (input.status && input.status !== 'pending') {
      b.status = input.status;
      b.amountDue = input.amountDue === undefined ? b.quotedTotal : input.amountDue;
      if (input.status === 'confirmed') b.confirmedAt = '2026-10-11T10:00';
      if (input.status === 'rejected') b.rejectReason = input.reason || 'بيانات ناقصة';
    }
    (input.paid || []).forEach(p => {
      state.payments.push({ id: id('pay'), bookingId: b.id, kind: p.kind || 'payment', amount: p.amount, servantId: p.servantId || 'srv-mina', servantName: '', method: p.method || 'cash',
        receivedAt: p.receivedAt || '2026-10-11T10:00', recordedAt: '2026-10-11T10:00', recordedBy: 'menazakmena@gmail.com', recordedName: 'مينا زكريا', proofIds: [], note: p.note || '', voidsId: '', voidedBy: '' });
    });
    state.payments.forEach(p => { const s = ev().servants.find(x => x.id === p.servantId); if (s) p.servantName = s.name; });
    return b;
  }

  /* ---------- writes ---------- */

  function find(bid) {
    const b = state.bookings.find(x => x.id === bid);
    if (!b) throw new Fail('not_found');
    return b;
  }

  function guard(b, body) {
    if (Number(body.version) !== b.version) throw new Fail('conflict');
  }

  function bump(b) {
    b.version++;
  }

  function payWarnings(b, input, extraPaid = 0) {
    const out = [];
    const servant = ev().servants.find(s => s.id === input.servantId);
    if (servant && servant.methods.indexOf(input.method) === -1) out.push({ code: 'method', message: 'الخادم ده مش بيقبل الطريقة دي في الفعالية دي.' });
    const paid = paidOf(b) + extraPaid;
    if (input.kind === 'refund' && input.amount > Math.max(0, paid - (dueOf(b) || 0))) out.push({ code: 'refund_over', message: 'المرتجع أكتر من المرتجع المطلوب.' });
    if (input.kind === 'payment' && dueOf(b) !== null && paid + input.amount > dueOf(b)) out.push({ code: 'overpaid', message: 'الدفعة دي هتخلي المدفوع أكتر من المطلوب.' });
    return out;
  }

  function addPayment(b, input, { warn = true } = {}) {
    if (!Number.isInteger(input.amount) || input.amount <= 0 || input.amount > 1000000) throw new Fail('invalid', { field: 'amount', message: 'المبلغ لازم يبقى رقم صحيح أكبر من صفر.' });
    if (!input.servantId) throw new Fail('invalid', { field: 'servantId', message: 'اختار الخادم.' });
    if (!input.method) throw new Fail('invalid', { field: 'method', message: 'اختار الطريقة.' });
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input.receivedAt || '')) throw new Fail('invalid', { field: 'receivedAt', message: 'وقت الاستلام مش مفهوم.' });
    if (input.kind === 'refund' && paidOf(b) <= 0) throw new Fail('invalid', { field: 'amount', message: 'مفيش فلوس مدفوعة علشان ترجّعها.' });
    if (!input.idemKey) throw new Fail('invalid', { field: 'amount', message: 'idemKey' });
    if (warn && !input.force) {
      const warnings = payWarnings(b, input);
      if (warnings.length) throw new Fail('warn', { warnings });
    }
    const servant = ev().servants.find(s => s.id === input.servantId);
    const p = { id: id('pay'), bookingId: b.id, kind: input.kind, amount: input.amount, servantId: input.servantId, servantName: servant ? servant.name : '', method: input.method,
      receivedAt: input.receivedAt, recordedAt: now(), recordedBy: 'menazakmena@gmail.com', recordedName: 'مينا زكريا', proofIds: input.proofIds || [], note: input.note || '', voidsId: '', voidedBy: '' };
    state.payments.push(p);
    (input.proofIds || []).forEach(pid => { const proof = state.proofs.find(x => x.id === pid); if (proof) proof.paymentId = p.id; });
    return p;
  }

  function confirm(b, body) {
    if (b.status !== 'pending') throw new Fail('final');
    const due = Number(body.amountDue);
    if (!Number.isInteger(due) || due < 0) throw new Fail('invalid', { field: 'amountDue', message: 'المطلوب رقم صحيح.' });
    if (due !== quote(body.actual) && !String(body.dueReason || '').trim()) throw new Fail('invalid', { field: 'dueReason', message: 'اكتب السبب.' });
    const incoming = (body.payments || []).reduce((s, p) => s + (p.kind === 'refund' ? -p.amount : p.amount), 0);
    const warnings = [];
    if (paidOf(b) + incoming < due && !body.overridePay) warnings.push({ code: 'pay_short', message: 'الدفع كامل: المدفوع أقل من المطلوب.' });
    if (left() !== null && seats(body.actual) > left() && !body.overrideCap) warnings.push({ code: 'cap_full', message: 'مفيش أماكن كفاية.' });
    if (warnings.length) throw new Fail('needs_override', { warnings, left: left() });
    if ((body.overridePay || body.overrideCap) && !String(body.reason || '').trim()) throw new Fail('invalid', { field: 'reason', message: 'اكتب السبب.' });
    (body.payments || []).forEach(p => {
      if (!p.force) {
        const w = payWarnings(b, p);
        if (w.length) throw new Fail('warn', { warnings: w });
      }
    });
    (body.payments || []).forEach(p => addPayment(b, p, { warn: false }));
    b.status = 'confirmed';
    b.actual = body.actual;
    b.amountDue = due;
    b.confirmedAt = now();
    if (body.overrideCap) b.capOverride = { reason: body.reason };
    b.confirmReason = body.reason || '';
  }

  const routes = [
    ['GET', /^\/v1\/admin\/book\/module$/, () => state.module],
    ['GET', /^\/v1\/admin\/book\/events$/, () => ({ events: [eventRow()] })],
    ['POST', /^\/v1\/admin\/book\/events\/([a-z0-9-]+)\/refresh$/, m => {
      if (m[1] !== ev().slug) throw new Fail('not_found');
      return { event: eventRow() };
    }],
    ['POST', /^\/v1\/admin\/book\/events\/(evt-[a-z0-9]+)\/cancel-all$/, (m, body) => {
      if (!String(body.reason || '').trim()) throw new Fail('invalid', { field: 'reason', message: 'السبب مطلوب.' });
      let n = 0;
      state.bookings.forEach(b => {
        if (b.status === 'pending' || b.status === 'confirmed') { b.status = 'cancelled'; b.amountDue = 0; b.cancelReason = body.reason; bump(b); n++; }
      });
      return { cancelled: n };
    }],
    ['GET', /^\/v1\/admin\/book\/bookings$/, (m, body, query) => {
      const status = query.get('status') || 'all';
      const q = (query.get('q') || '').trim();
      let rows = state.bookings.map(row);
      if (status !== 'all') rows = rows.filter(r => r.status === status);
      if (query.get('overdue') === '1') rows = rows.filter(r => r.overdue);
      if (query.get('refunds') === '1') rows = rows.filter(r => r.refundOwed > 0);
      if (q) {
        const digits = q.replace(/\D/g, '').replace(/^0/, '');
        rows = rows.filter(r => r.ref === q.toUpperCase() || r.name.includes(q) || (digits.length >= 3 && r.phone.includes(digits)));
      }
      rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      const counts = { byStatus: eventRow().counts, overdue: state.bookings.map(row).filter(r => r.overdue).length, refunds: state.bookings.map(row).filter(r => r.refundOwed > 0).length };
      return { rows, counts, next: '' };
    }],
    ['GET', /^\/v1\/admin\/book\/bookings\/(bk-\d+)$/, m => detail(find(m[1]))],
    ['POST', /^\/v1\/admin\/book\/bookings\/(bk-\d+)\/lock$/, m => {
      find(m[1]);
      return state.lockHolder ? { granted: false, holder: clone(state.lockHolder), ttl: 90000, renew: state.lockRenew } : { granted: true, ttl: 90000, renew: state.lockRenew };
    }],
    ['DELETE', /^\/v1\/admin\/book\/bookings\/(bk-\d+)\/lock$/, () => ({ released: !state.lockHolder })],
    ['POST', /^\/v1\/admin\/book\/bookings$/, (m, body) => {
      if (!body.requestKey) throw new Fail('invalid', { field: 'name', message: 'requestKey' });
      const phone = normPhone(body.phone);
      if (!phone) throw new Fail('invalid', { field: 'phone', message: 'رقم الموبايل مش صحيح.' });
      const b = seed({ ref: 'B-ADM' + String(state.seq + 1).padStart(2, '0'), name: body.name, phone, counts: body.counts, servantId: body.servantId, method: body.method, note: body.note, source: 'admin', createdAt: now() });
      if (body.confirm) {
        try { confirm(b, { ...body.confirm, version: b.version }); }
        catch (error) { state.bookings.splice(state.bookings.indexOf(b), 1); throw error; }
      }
      bump(b);
      return detail(b);
    }],
    ['POST', /^\/v1\/admin\/book\/bookings\/(bk-\d+)\/confirm$/, (m, body) => {
      const b = find(m[1]);
      guard(b, body);
      confirm(b, body);
      bump(b);
      return detail(b);
    }],
    ['POST', /^\/v1\/admin\/book\/bookings\/(bk-\d+)\/reject$/, (m, body) => {
      const b = find(m[1]);
      guard(b, body);
      if (b.status !== 'pending') throw new Fail('final');
      if (!String(body.reason || '').trim()) throw new Fail('invalid', { field: 'reason', message: 'السبب مطلوب.' });
      (body.payments || []).forEach(p => addPayment(b, p, { warn: false }));
      b.status = 'rejected';
      b.rejectReason = body.reason;
      bump(b);
      return detail(b);
    }],
    ['POST', /^\/v1\/admin\/book\/bookings\/(bk-\d+)\/cancel$/, (m, body) => {
      const b = find(m[1]);
      guard(b, body);
      if (b.status !== 'confirmed') throw new Fail('final');
      if (!Number.isInteger(body.retain) || body.retain < 0 || body.retain > paidOf(b)) throw new Fail('invalid', { field: 'retain', message: 'مينفعش يبقى أكتر من المدفوع.' });
      b.status = 'cancelled';
      b.amountDue = body.retain;
      b.cancelReason = body.reason;
      bump(b);
      return detail(b);
    }],
    ['POST', /^\/v1\/admin\/book\/bookings\/(bk-\d+)\/reopen$/, (m, body) => {
      const b = find(m[1]);
      guard(b, body);
      if (b.status !== 'rejected') throw new Fail('final');
      b.status = 'pending';
      b.amountDue = null;
      bump(b);
      return detail(b);
    }],
    ['POST', /^\/v1\/admin\/book\/bookings\/(bk-\d+)\/update$/, (m, body) => {
      const b = find(m[1]);
      guard(b, body);
      if (b.status !== 'confirmed') throw new Fail('final');
      if (body.actual) {
        if (left() !== null && seats(body.actual) - seats(b.actual) > left() && !body.overrideCap) throw new Fail('needs_override', { warnings: [{ code: 'cap_full', message: 'مفيش أماكن كفاية.' }], left: left() });
        b.actual = body.actual;
      }
      if (body.amountDue !== undefined) {
        if (!String(body.reason || '').trim()) throw new Fail('invalid', { field: 'reason', message: 'السبب مطلوب.' });
        b.dueHistory.push({ at: now(), by: 'menazakmena@gmail.com', from: b.amountDue, to: body.amountDue, reason: body.reason });
        b.amountDue = body.amountDue;
      }
      if (body.adminNote !== undefined) b.adminNote = body.adminNote;
      bump(b);
      return detail(b);
    }],
    ['POST', /^\/v1\/admin\/book\/bookings\/(bk-\d+)\/payments$/, (m, body) => {
      const b = find(m[1]);
      if (b.status === 'pending') throw new Fail('final');
      addPayment(b, body);
      bump(b);
      return detail(b);
    }],
    ['POST', /^\/v1\/admin\/book\/payments\/(pay-\d+)\/void$/, (m, body) => {
      const p = state.payments.find(x => x.id === m[1]);
      if (!p) throw new Fail('not_found');
      if (!String(body.reason || '').trim()) throw new Fail('invalid', { field: 'reason', message: 'السبب مطلوب.' });
      if (p.voidedBy || p.kind === 'void') throw new Fail('final');
      const v = { id: id('pay'), bookingId: p.bookingId, kind: 'void', amount: p.amount, servantId: p.servantId, servantName: p.servantName, method: p.method, receivedAt: now(), recordedAt: now(),
        recordedBy: 'menazakmena@gmail.com', recordedName: 'مينا زكريا', proofIds: [], note: body.reason, voidsId: p.id, voidedBy: '' };
      state.payments.push(v);
      p.voidedBy = v.id;
      const b = find(p.bookingId);
      bump(b);
      return detail(b);
    }],
    ['POST', /^\/v1\/admin\/proofs$/, (m, body, query, raw, headers) => {
      if (query.get('purpose') !== 'payment' || !query.get('bookingId')) throw new Fail('invalid', { field: 'proofs', message: 'purpose' });
      if (!/^image\/(webp|jpeg)$/.test(headers['content-type'] || '')) throw new Fail('invalid', { field: 'proofs', message: 'type ' + headers['content-type'] });
      const proof = { id: id('prf'), purpose: 'payment', paymentId: '', by: 'menazakmena@gmail.com', at: now(), bytes: raw.length, width: 40, height: 60, dup: false, bookingId: query.get('bookingId') };
      state.proofs.push(proof);
      return { proof };
    }],
    ['GET', /^\/v1\/admin\/book\/summary$/, () => summary()],
    ['GET', /^\/v1\/admin\/book\/export$/, () => ({
      event: clone(ev()),
      bookings: state.bookings.map(b => detail(b).booking),
      payments: clone(state.payments).map(p => ({ ...p, bookingRef: find(p.bookingId).ref })),
      servants: clone(ev().servants),
      summary: summary()
    })]
  ];

  function summary() {
    const counts = eventRow().counts;
    const money = { due: 0, received: 0, refunded: 0, net: 0, balance: 0, refundsOwed: 0, byMethod: {} };
    const servants = ev().servants.map(s => ({ id: s.id, name: s.name, active: true, payments: 0, received: 0, refunded: 0, net: 0, byMethod: {}, bookings: 0, chosenBy: 0 }));
    state.payments.filter(live).forEach(p => {
      const sign = p.kind === 'payment' ? 1 : -1;
      const m = money.byMethod[p.method] || (money.byMethod[p.method] = { received: 0, refunded: 0, net: 0 });
      if (sign > 0) { money.received += p.amount; m.received += p.amount; } else { money.refunded += p.amount; m.refunded += p.amount; }
      m.net += sign * p.amount;
      const s = servants.find(x => x.id === p.servantId);
      if (s) { s.payments++; s[sign > 0 ? 'received' : 'refunded'] += p.amount; s.net += sign * p.amount; s.byMethod[p.method] = (s.byMethod[p.method] || 0) + sign * p.amount; }
    });
    money.net = money.received - money.refunded;
    servants.forEach(s => {
      s.bookings = new Set(state.payments.filter(p => live(p) && p.servantId === s.id).map(p => p.bookingId)).size;
      s.chosenBy = state.bookings.filter(b => (b.status === 'pending' || b.status === 'confirmed') && b.servantId === s.id).length;
    });
    const payStatus = { free: 0, unpaid: 0, partial: 0, paid: 0, overpaid: 0, overdue: 0 };
    state.bookings.forEach(b => {
      if (b.status === 'pending') return;
      const d = derived(b);
      money.due += dueOf(b);
      money.balance += Math.max(0, d.balance || 0);
      money.refundsOwed += d.refundOwed;
      payStatus[d.paymentStatus]++;
    });
    const confirmed = state.bookings.filter(b => b.status === 'confirmed').map(b => people(b.actual));
    return {
      overall: {
        bookings: counts, seats: { capacity: ev().capacity, taken: taken(), left: left() },
        people: confirmed.reduce((s, p) => ({ adult: s.adult + p.adult, child: s.child + p.child, companion: s.companion + p.companion, total: s.total + p.total }), { adult: 0, child: 0, companion: 0, total: 0 }),
        money, payStatus, pending: { count: counts.pending, quoted: state.bookings.filter(b => b.status === 'pending').reduce((s, b) => s + b.quotedTotal, 0) }
      },
      servants
    };
  }

  const cors = { 'access-control-allow-origin': origin, 'access-control-expose-headers': 'x-request-id, idempotency-replayed' };
  const json = (status, body) => ({ status, headers: { ...cors, 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });

  /* one browser request → a puppeteer respond() object (or null: not the Worker) */
  async function handle(request) {
    const url = new URL(request.url());
    if (url.origin !== WORKER_URL) return null;
    const method = request.method();
    if (method === 'OPTIONS') {
      return { status: 204, headers: { ...cors, 'access-control-allow-methods': 'GET, POST, DELETE', 'access-control-allow-headers': 'authorization, content-type, idempotency-key, accept, x-edit-session', 'access-control-max-age': '600' }, body: '' };
    }
    const headers = request.headers();
    const raw = request.hasPostData() ? (request.postData() ?? await request.fetchPostData()) ?? '' : '';
    const rawBytes = typeof raw === 'string' ? Buffer.from(raw, 'binary') : Buffer.from(raw);
    let body = null;
    if (/json/.test(headers['content-type'] || '')) {
      try { body = JSON.parse(raw); } catch { body = null; }
    }
    const key = headers['idempotency-key'] || '';
    const call = { method, path: url.pathname, query: url.search, body, key, auth: headers.authorization || '', contentType: headers['content-type'] || '', session: headers['x-edit-session'] || '' };
    state.calls.push(call);
    if (call.session) state.sessions.add(call.session);

    try {
      if (!/^Bearer \S+/.test(call.auth)) throw new Fail('auth');

      if (url.pathname === '/v1/admin/book/module' && state.moduleReply) return { ...state.moduleReply, headers: { ...cors, 'content-type': 'application/json' } };

      const injected = state.inject.find(i => i.times > 0 && i.method === method && i.path.test(url.pathname));
      if (injected) {
        injected.times--;
        if (injected.before) injected.before();
        throw new Fail(injected.code, injected.extra || {});
      }

      // another admin's page holds the booking: every move on it is refused (worker/src/book/locks.js)
      if (state.lockHolder && method === 'POST' && /^\/v1\/admin\/book\/(bookings\/[^/]+\/(confirm|reject|cancel|reopen|update|payments)|payments\/[^/]+\/void)$/.test(url.pathname)) {
        throw new Fail('locked', { holder: clone(state.lockHolder) });
      }

      if (method === 'GET' && /^\/v1\/admin\/proofs\/(prf-\d+)$/.test(url.pathname)) {
        return { status: 200, headers: { ...cors, 'content-type': 'image/png' }, body: proofBytes };
      }

      // a write with a key seen before: the same body → the same answer; another body → conflict
      if (method === 'POST' && key && state.idem.has(key)) {
        const seen = state.idem.get(key);
        if (seen.text !== (body ? JSON.stringify(body) : String(rawBytes.length))) throw new Fail('conflict');
        call.replayed = true;
        return json(200, seen.reply);
      }

      for (const [verb, pattern, fn] of routes) {
        const m = verb === method && pattern.exec(url.pathname);
        if (!m) continue;
        const result = fn(m, body || {}, url.searchParams, rawBytes, headers);
        const reply = { ok: true, ...clone(result) };
        if (method === 'POST' && key) state.idem.set(key, { text: body ? JSON.stringify(body) : String(rawBytes.length), reply });
        return json(200, reply);
      }
      throw new Fail('not_found');
    }
    catch (error) {
      if (!(error instanceof Fail)) throw error;
      const extra = { ...error.extra };
      const message = extra.message || MESSAGES[error.code] || error.code;
      delete extra.message;
      return json(STATUS[error.code] || 400, { ok: false, code: error.code, message, ...extra, requestId: 'req-test' });
    }
  }

  return {
    state,
    handle,
    seed,
    row,
    /* the next matching call answers with this code (times: how many) */
    inject(method, path, code, extra = {}, times = 1, before = null) {
      state.inject.push({ method, path, code, extra, times, before });
    },
    writes: () => state.calls.filter(c => c.method === 'POST'),
    find: ref => state.bookings.find(b => b.ref === ref)
  };

}
