/*
 * «الحجوزات» IN THE ADMIN: THE PURE PARTS (docs/EVENTS.md §3–§5, §7.2, §9,
 * §13; the transport: worker/BOOKING-API.md). No DOM, no network — the
 * screens (apps-script/AdminBook.html) load this module on demand with
 * import('./book-kit.js'); tests/book-kit.test.mjs runs it in Node.
 *
 *   STATUS / PAY_STATUS / FILTERS     words and chip kinds
 *   queuePaths(eventId, filter, q)    the list request(s) behind a chip
 *   quote / seats / people            prices and places, as the server counts them
 *   checkCounts / checkPay / checkConfirm / checkCancel / checkManual
 *                                     the server's own refusals, said before sending
 *   fieldLine(field, message)         a server error placed under its field
 *   keyKeeper()                       one write = one Idempotency-Key, again on a retry
 *   bookingBook(exported, options)    the §13 workbook (admin/xlsx.js writeXlsx)
 */

export const STATUS = {
  pending: { label: 'جديد', kind: 'gold' },
  confirmed: { label: 'مؤكد', kind: 'ok' },
  rejected: { label: 'مرفوض', kind: 'danger' },
  withdrawn: { label: 'الزائر لغاه', kind: 'off' },
  cancelled: { label: 'اتلغى', kind: 'off' }
};

export const PAY_STATUS = {
  free: { label: 'مجاني', kind: 'info' },
  unpaid: { label: 'لسه مدفعش', kind: 'danger' },
  partial: { label: 'دفع جزء', kind: 'gold' },
  paid: { label: 'دفع كله', kind: 'ok' },
  overpaid: { label: 'دافع زيادة', kind: 'danger' }
};

export const KIND = { payment: 'دفعة', refund: 'مرتجع', void: 'إلغاء دفعة' };

/* the queue's chips (§7.2): which list request(s) each one is */
export const FILTERS = [
  { key: 'pending', label: 'مستنية المراجعة', sources: [{ status: 'pending' }] },
  { key: 'confirmed', label: 'المؤكدة', sources: [{ status: 'confirmed' }] },
  { key: 'overdue', label: 'متأخر', sources: [{ status: 'all', overdue: '1' }] },
  { key: 'refunds', label: 'مرتجعات مطلوبة', sources: [{ status: 'all', refunds: '1' }] },
  // participants who sent a transfer for what is left (§4.10): waiting for review
  { key: 'claims', label: 'طلبات دفع', sources: [{ status: 'all', claims: '1' }] },
  // the API takes one status at a time: three lists, merged
  { key: 'closed', label: 'المرفوضة والملغية', sources: [{ status: 'rejected' }, { status: 'withdrawn' }, { status: 'cancelled' }] },
  { key: 'all', label: 'الكل', sources: [{ status: 'all' }] }
];

/* the number on a chip, from the list reply's counts { byStatus, overdue, refunds } */
export function filterCount(key, counts) {
  const by = (counts && counts.byStatus) || {};
  const n = k => Number(by[k]) || 0;
  switch (key) {
    case 'pending': return n('pending');
    case 'confirmed': return n('confirmed');
    case 'overdue': return Number(counts && counts.overdue) || 0;
    case 'refunds': return Number(counts && counts.refunds) || 0;
    case 'claims': return Number(counts && counts.claims) || 0;
    case 'closed': return n('rejected') + n('withdrawn') + n('cancelled');
    default: return n('pending') + n('confirmed') + n('rejected') + n('withdrawn') + n('cancelled');
  }
}

/* GET /v1/admin/book/bookings?… for each source of a chip (cursor: that source's `next`) */
export function queuePaths(eventId, filterKey, q, { limit = 50, cursors = null } = {}) {
  const filter = FILTERS.find(f => f.key === filterKey) || FILTERS[0];
  return filter.sources.map((source, i) => {
    const params = new URLSearchParams();
    params.set('eventId', String(eventId || ''));
    Object.keys(source).forEach(k => params.set(k, source[k]));
    const query = String(q || '').trim();
    if (query) params.set('q', query.slice(0, 80));
    params.set('limit', String(limit));
    if (cursors && cursors[i]) params.set('cursor', cursors[i]);
    return '/v1/admin/book/bookings?' + params.toString();
  });
}

/* several lists → one, newest request first, each booking once */
export function mergeRows(lists) {
  const seen = new Set();
  const rows = [];
  lists.forEach(list => (list || []).forEach(row => {
    if (!row || seen.has(row.id)) return;
    seen.add(row.id);
    rows.push(row);
  }));
  return rows.sort((a, b) => (String(a.createdAt) < String(b.createdAt) ? 1 : String(a.createdAt) > String(b.createdAt) ? -1 : 0));
}


/* ---------- prices and places (as BookModel.gs / the Worker count them) ---------- */

const cats = pricing => (pricing && Array.isArray(pricing.categories) ? pricing.categories : []);

export function quote(pricing, counts) {
  return cats(pricing).reduce((sum, c) => sum + (Number(counts && counts[c.key]) || 0) * (Number(c.price) || 0), 0);
}

export function seats(pricing, counts) {
  return cats(pricing).reduce((sum, c) => sum + (c.seat !== false ? Number(counts && counts[c.key]) || 0 : 0), 0);
}

export function people(pricing, counts) {
  const out = { adult: 0, child: 0, companion: 0, total: 0 };
  cats(pricing).forEach(c => {
    const n = Number(counts && counts[c.key]) || 0;
    out[out[c.group] === undefined ? 'adult' : c.group] += n;
    out.total += n;
  });
  return out;
}

export function isFree(pricing) {
  return cats(pricing).every(c => !(Number(c.price) > 0));
}

/* «٢ كبار، ١ طفل» */
export function peopleText(p) {
  if (!p) return '';
  const parts = [];
  if (p.adult) parts.push(ar(p.adult) + (p.adult === 1 ? ' كبير' : ' كبار'));
  if (p.child) parts.push(ar(p.child) + (p.child === 1 ? ' طفل' : ' أطفال'));
  if (p.companion) parts.push(ar(p.companion) + (p.companion === 1 ? ' مرافق' : ' مرافقين'));
  return parts.join('، ') || ar(p.total || 0) + ' فرد';
}

export function ar(n) {
  return String(n === null || n === undefined ? '' : n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
}

/* «١٬٥٠٠ ج» */
export function money(n) {
  if (n === null || n === undefined || n === '') return '—';
  const value = Math.round(Number(n) || 0);
  const text = Math.abs(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '٬');
  return (value < 0 ? '−' : '') + ar(text) + ' ج';
}

/* live = not voided, not a void row itself (§5.2) */
export function isLive(p) {
  return !!p && !p.voidedBy && p.kind !== 'void';
}

export function paidOf(payments) {
  return (payments || []).reduce((sum, p) => (isLive(p) ? sum + (p.kind === 'payment' ? p.amount : p.kind === 'refund' ? -p.amount : 0) : sum), 0);
}

/* the void row that cancelled this one (its note = the reason) */
export function voidOf(payment, payments) {
  if (!payment || !payment.voidedBy) return null;
  return (payments || []).find(p => p.id === payment.voidedBy || (p.kind === 'void' && p.voidsId === payment.id)) || null;
}

/* the methods a servant takes for this event (all the event's methods when the servant names none) */
export function servantMethods(event, servantId) {
  const methods = (event && event.methods) || [];
  const servant = ((event && event.servants) || []).find(s => s.id === servantId);
  if (!servant || !servant.methods || !servant.methods.length) return methods;
  return methods.filter(m => servant.methods.indexOf(m.key) !== -1);
}

export function methodLabel(event, key) {
  const m = ((event && event.methods) || []).find(x => x.key === key);
  return m ? m.label : String(key || '');
}


/* ---------- Cairo wall-clock stamps ('YYYY-MM-DDTHH:MM', §6 Stamp) ---------- */

const STAMP = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/;

/* 'YYYY-MM-DD HH:MM' (the admin's date inputs) → 'YYYY-MM-DDTHH:MM'; '' when not a time */
export function stamp(value) {
  const m = STAMP.exec(String(value || '').trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}` : '';
}

export function stampMinutes(value) {
  const m = STAMP.exec(String(value || '').trim());
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000 : null;
}


/* ---------- what the server refuses, said first (§3, §5.2, §5.3, §9) ---------- */

export const FIELD_LABELS = {
  name: 'الاسم',
  phone: 'الموبايل',
  counts: 'العدد',
  actual: 'العدد',
  servantId: 'الخادم',
  method: 'طريقة الدفع',
  proofs: 'صور الإثبات',
  names: 'الأسماء',
  note: 'ملاحظة',
  amount: 'المبلغ',
  receivedAt: 'وقت الاستلام',
  amountDue: 'المطلوب',
  dueReason: 'سبب تغيير المطلوب',
  reason: 'السبب',
  retain: 'المبلغ اللي هيتخصم',
  adminNote: 'ملاحظة الأدمن'
};

/* "<label>: <message>" — A.showFieldErrors puts it under the field with that label */
export function fieldLine(field, message) {
  const label = FIELD_LABELS[field];
  const text = String(message || '').trim();
  if (!label) return text;
  return text.indexOf(label) === 0 ? text : label + ': ' + text;
}

const MAX_AMOUNT = 1000000;

function amountProblem(value, { allowZero = false, max = MAX_AMOUNT } = {}) {
  const text = String(value === null || value === undefined ? '' : value).trim().replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660));
  if (text === '') return 'اكتب المبلغ';
  const n = Number(text);
  if (!/^\d+$/.test(text) || !Number.isInteger(n)) return 'رقم صحيح بالجنيه (من غير كسور)';
  if (!allowZero && n <= 0) return 'لازم يبقى أكبر من صفر';
  if (n > max) return 'أكبر من المسموح (' + money(max) + ')';
  return '';
}

/* a typed amount → an integer (Arabic digits too), or NaN */
export function amountOf(value) {
  const text = String(value === null || value === undefined ? '' : value).trim().replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660));
  return /^\d+$/.test(text) ? Number(text) : NaN;
}

/* counts within each category's min/max, unknown keys out, seats ≤ perBookingMax, someone coming */
export function checkCounts(pricing, perBookingMax, counts) {
  const list = cats(pricing);
  if (!counts || typeof counts !== 'object') return 'العدد مش مفهوم';
  const known = new Set(list.map(c => c.key));
  if (Object.keys(counts).some(k => !known.has(k))) return 'فيه فئة مش في أسعار الفعالية';
  for (const c of list) {
    const n = Number(counts[c.key] === undefined ? c.min || 0 : counts[c.key]);
    const max = c.max === undefined || c.max === null ? 30 : c.max;
    if (!Number.isInteger(n) || n < (c.min || 0) || n > max) return '«' + c.label + '» من ' + ar(c.min || 0) + ' لـ ' + ar(max);
    if (pricing.mode === 'single' && c.key !== 'applicant' && n > 0) return 'الفعالية دي للحاجز بس';
  }
  if (seats(pricing, counts) > (perBookingMax || 10)) return 'أكتر من ' + ar(perBookingMax || 10) + ' أماكن في الحجز الواحد';
  if (people(pricing, counts).total < 1) return 'مفيش حد في الحجز';
  return '';
}

/*
 * A payment or a refund (PayInput, §5.2) before it is sent → [{ field, message }].
 * ctx: { now, createdAt } ('YYYY-MM-DDTHH:MM' Cairo), paid (live money in hand).
 */
export function checkPay(input, ctx = {}) {
  const out = [];
  const add = (field, message) => out.push({ field, message });
  const problem = amountProblem(input.amount);
  if (problem) add('amount', problem);
  else if (input.kind === 'refund' && !((ctx.paid || 0) > 0)) add('amount', 'مفيش فلوس مدفوعة في الحجز ده علشان ترجّعها');
  if (!input.servantId) add('servantId', 'اختار الخادم');
  if (!input.method) add('method', 'اختار طريقة الدفع');
  const at = stampMinutes(input.receivedAt);
  if (at === null) add('receivedAt', 'اختار اليوم والساعة');
  else if (ctx.now && at > stampMinutes(ctx.now)) add('receivedAt', 'مينفعش يبقى في المستقبل');
  else if (ctx.createdAt && stampMinutes(ctx.createdAt) !== null && at < stampMinutes(ctx.createdAt)) add('receivedAt', 'مينفعش يبقى قبل وقت الحجز');
  if ((input.proofIds || []).length > 3) add('proofs', '٣ صور بالكتير');
  if (String(input.note || '').length > 300) add('note', '٣٠٠ حرف بالكتير');
  return out;
}

/* confirm / update: counts, the amount due and its reason when it isn't the quote (§5.3) */
export function checkConfirm({ pricing, perBookingMax, actual, amountDue, dueReason, quoted }) {
  const out = [];
  const counts = checkCounts(pricing, perBookingMax, actual);
  if (counts) out.push({ field: 'actual', message: counts });
  const problem = amountProblem(amountDue, { allowZero: true });
  if (problem) out.push({ field: 'amountDue', message: problem });
  else if (amountOf(amountDue) !== quoted && !String(dueReason || '').trim()) out.push({ field: 'dueReason', message: 'اكتب ليه المطلوب غير السعر (خصم، إعفاء…)' });
  return out;
}

/* cancel a confirmed booking: a reason, and the fee kept (0 … paid) */
export function checkCancel({ reason, retain, paid }) {
  const out = [];
  if (!String(reason || '').trim()) out.push({ field: 'reason', message: 'اكتب سبب الإلغاء' });
  const problem = amountProblem(retain, { allowZero: true });
  if (problem) out.push({ field: 'retain', message: problem });
  else if (amountOf(retain) > Math.max(0, paid || 0)) out.push({ field: 'retain', message: 'مينفعش يبقى أكتر من المدفوع (' + money(Math.max(0, paid || 0)) + ')' });
  return out;
}

/* Egyptian mobile → '+201XXXXXXXXX' or '' (the Worker's normPhone) */
export function normPhone(value) {
  const text = String(value === null || value === undefined ? '' : value)
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
  }
  else if (digits.indexOf('0020') === 0) digits = digits.slice(4);
  else if (digits.indexOf('20') === 0 && digits.length >= 11) digits = digits.slice(2);
  if (digits.charAt(0) === '0') digits = digits.slice(1);
  return /^1[0125]\d{8}$/.test(digits) ? '+20' + digits : '';
}

/* a manual booking (source admin): the visitor form's rules */
export function checkManual({ name, phone, counts, pricing, perBookingMax, note }) {
  const out = [];
  const n = String(name || '').trim();
  if (n.length < 2 || n.length > 60) out.push({ field: 'name', message: 'من حرفين لـ ٦٠ حرف' });
  if (!normPhone(phone)) out.push({ field: 'phone', message: 'رقم موبايل مصري صحيح (010 / 011 / 012 / 015…)' });
  const problem = checkCounts(pricing, perBookingMax, counts);
  if (problem) out.push({ field: 'counts', message: problem });
  if (String(note || '').length > 300) out.push({ field: 'note', message: '٣٠٠ حرف بالكتير' });
  return out;
}


/* ---------- idempotency keys ---------- */

export function newKey(prefix = 'adm') {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return prefix + '-' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/*
 * One write = one key: the same body sent again (a retry, a double tap)
 * keeps its key, so the server answers it once; a changed body (another
 * amount, «سجّل برضه» with force) is another write and gets a new key.
 */
export function keyKeeper(prefix) {
  let last = null;
  return {
    for(body) {
      const text = JSON.stringify(body === undefined ? null : body);
      if (!last || last.text !== text) last = { text, key: newKey(prefix) };
      return last.key;
    },
    reset() { last = null; }
  };
}


/* ---------- the §13 workbook ---------- */

export const BOOKING_HEADERS = ['الرقم', 'الحالة', 'الاسم', 'الموبايل', 'الخادم المختار', 'طريقة الدفع', 'كبار', 'أطفال', 'مرافقين', 'الإجمالي',
  'الأسماء', 'المطلوب', 'المدفوع', 'الباقي', 'حالة الدفع', 'متأخر', 'تاريخ الطلب', 'تاريخ التأكيد', 'ملاحظات'];

export const PAYMENT_HEADERS = ['رقم الدفعة', 'رقم الحجز', 'الاسم', 'النوع', 'المبلغ', 'الطريقة', 'الخادم', 'وقت الاستلام', 'وقت التسجيل', 'سجلها',
  'ملغية؟', 'سبب الإلغاء', 'فيه إثبات؟'];

export const SERVANT_ROW_HEADERS = ['رقم الدفعة', 'رقم الحجز', 'الاسم', 'النوع', 'المبلغ', 'الطريقة', 'وقت الاستلام', 'سجلها', 'ملاحظة'];

export const FIXED_SHEETS = ['ملخص', 'حسب الخادم', 'الحجوزات', 'الدفعات'];

const wall = value => String(value || '').replace('T', ' ');

/* '+201012345678' → '01012345678': the form people read and dial (kept as TEXT in the workbook, so the leading 0 stays) */
export function localPhone(value) {
  const m = /^\+20(1\d{9})$/.exec(String(value || ''));
  return m ? '0' + m[1] : String(value || '');
}

/* 'حجوزات-<slug>-<YYYY-MM-DD>.xlsx' */
export function bookingFilename(slug, today) {
  return 'حجوزات-' + String(slug || 'event').replace(/[^a-z0-9-]/gi, '') + '-' + String(today || '').slice(0, 10) + '.xlsx';
}

function sheetName(text, taken) {
  const base = (String(text || '').replace(/[[\]:*?/\\']/g, ' ').replace(/\s+/g, ' ').trim() || 'خادم').slice(0, 28);
  let name = base;
  for (let i = 2; taken.has(name); i++) name = base + ' ' + i;
  taken.add(name);
  return name;
}

function widths(rows) {
  const count = rows.reduce((max, r) => Math.max(max, r.length), 0);
  return Array.from({ length: count }, (_, i) => {
    const longest = rows.slice(0, 300).reduce((max, r) => Math.max(max, String(r[i] === undefined || r[i] === null ? '' : r[i]).length), 4);
    return Math.max(8, Math.min(44, Math.round(longest * 1.15) + 2));
  });
}

/*
 * exported = GET /v1/admin/book/export: { event, bookings, payments, servants, summary }.
 * options: { from, to } (the period, noted in «ملخص»; payment sheets keep only
 * rows received inside it, like the summary), today 'YYYY-MM-DD' (file name).
 * → { book: { sheets }, filename }
 */
export function bookingBook(exported, { from = '', to = '', today = '' } = {}) {
  const data = exported || {};
  const event = data.event || {};
  const bookings = Array.isArray(data.bookings) ? data.bookings : [];
  const allPayments = Array.isArray(data.payments) ? data.payments : [];
  const summary = data.summary || {};
  const overall = summary.overall || {};
  const byId = new Map(bookings.map(b => [b.id, b]));
  const fromMin = from ? stampMinutes(stamp(from) || from + 'T00:00') : null;
  const toMin = to ? stampMinutes(stamp(to) || to + 'T23:59') : null;
  const inRange = p => {
    const at = stampMinutes(p.receivedAt);
    return at === null || ((fromMin === null || at >= fromMin) && (toMin === null || at <= toMin));
  };
  const payments = allPayments.filter(inRange);
  const methodKeys = Array.from(new Set(((event.methods || []).map(m => m.key)).concat(
    ...(summary.servants || []).map(s => Object.keys(s.byMethod || {})),
    Object.keys((overall.money && overall.money.byMethod) || {})
  ))).filter(k => k !== undefined);
  const label = key => methodLabel(event, key) || 'من غير طريقة';
  const bookingOf = p => byId.get(p.bookingId) || {};
  const refOf = p => p.bookingRef || p.ref || bookingOf(p).ref || '';
  const nameOf = p => p.name || bookingOf(p).name || '';
  const reasonOf = p => {
    if (p.kind === 'void') return p.note || '';
    const v = voidOf(p, allPayments);
    return v ? v.note || '' : '';
  };

  /* «ملخص» */
  const b = overall.bookings || {};
  const s = overall.seats || {};
  const ppl = overall.people || {};
  const m = overall.money || {};
  const ps = overall.payStatus || {};
  const pend = overall.pending || {};
  const period = from || to ? 'من ' + (from || 'الأول') + ' لـ ' + (to || 'دلوقتي') + ' (الفلوس بس)' : 'كل الوقت';
  const summaryRows = [
    ['البند', 'القيمة'],
    ['الفعالية', event.title || ''],
    ['الرابط', event.slug || ''],
    ['بتبدأ', wall(event.startAt)],
    ['بتخلص', wall(event.endAt)],
    ['الفترة', period],
    ['العدد المتاح', s.capacity === null || s.capacity === undefined ? 'من غير حد' : s.capacity],
    ['الأماكن المؤكدة', s.taken || 0],
    ['الأماكن الفاضية', s.left === null || s.left === undefined ? 'من غير حد' : s.left],
    ['', ''],
    ['حجوزات جديدة', b.pending || 0],
    ['حجوزات مؤكدة', b.confirmed || 0],
    ['حجوزات مرفوضة', b.rejected || 0],
    ['الزائر لغاها', b.withdrawn || 0],
    ['حجوزات اتلغت', b.cancelled || 0],
    ['كبار (المؤكدين)', ppl.adult || 0],
    ['أطفال (المؤكدين)', ppl.child || 0],
    ['مرافقين (المؤكدين)', ppl.companion || 0],
    ['إجمالي الأفراد (المؤكدين)', ppl.total || 0],
    ['', ''],
    ['المطلوب', m.due || 0],
    ['المستلم', m.received || 0],
    ['المرتجع', m.refunded || 0],
    ['الصافي', m.net || 0],
    ['الباقي على الناس', m.balance || 0],
    ['مرتجعات مطلوبة', m.refundsOwed || 0]
  ].concat(methodKeys.filter(k => m.byMethod && m.byMethod[k]).map(k => ['صافي ' + label(k), m.byMethod[k].net || 0]), [
    ['', ''],
    ['مجاني', ps.free || 0],
    ['لسه مدفعش', ps.unpaid || 0],
    ['دفع جزء', ps.partial || 0],
    ['دفع كله', ps.paid || 0],
    ['دافع زيادة', ps.overpaid || 0],
    ['متأخر', ps.overdue || 0],
    ['', ''],
    ['طلبات لسه بتتراجع', pend.count || 0],
    ['قيمتها المتوقعة (مش فلوس)', pend.quoted || 0]
  ]);

  /* «حسب الخادم» */
  const servants = summary.servants || [];
  const byServantRows = [['الخادم', 'عدد الدفعات', 'المستلم', 'المرتجع', 'الصافي'].concat(methodKeys.map(k => 'صافي ' + label(k)), ['عدد الحجوزات', 'اختاروه'])]
    .concat(servants.map(sv => [sv.name || sv.id || '', sv.payments || 0, sv.received || 0, sv.refunded || 0, sv.net || 0]
      .concat(methodKeys.map(k => (sv.byMethod && sv.byMethod[k]) || 0), [sv.bookings || 0, sv.chosenBy || 0])));

  /* «الحجوزات» */
  const bookingRows = [BOOKING_HEADERS].concat(bookings.map(row => {
    const p = row.people || {};
    const notes = [row.visitorNote, row.adminNote, row.rejectReason && 'سبب الرفض: ' + row.rejectReason, row.cancelReason && 'سبب الإلغاء: ' + row.cancelReason]
      .filter(Boolean).join(' — ');
    return [
      row.ref || '', (STATUS[row.status] || { label: row.status }).label, row.name || '', localPhone(row.phone), row.servantName || '', row.method ? label(row.method) : '',
      p.adult || 0, p.child || 0, p.companion || 0, p.total || 0,
      (row.participants || []).length ? row.participants.map(x => x.name + ' (' + x.age + ')').join('، ') : (row.names || []).join('، '),
      row.amountDue === null || row.amountDue === undefined ? '' : row.amountDue, row.paid || 0,
      row.balance === null || row.balance === undefined ? '' : row.balance,
      row.paymentStatus ? (PAY_STATUS[row.paymentStatus] || { label: row.paymentStatus }).label : '',
      row.overdue ? 'نعم' : '', wall(row.createdAt), wall(row.confirmedAt), notes
    ];
  }));

  /* «الدفعات»: every row, voids included */
  const paymentRows = [PAYMENT_HEADERS].concat(payments.map(p => [
    p.id || '', refOf(p), nameOf(p), KIND[p.kind] || p.kind || '', p.amount || 0, label(p.method), p.servantName || p.servantId || '',
    wall(p.receivedAt), wall(p.recordedAt), p.recordedName || p.recordedBy || '',
    p.kind === 'void' ? '' : p.voidedBy ? 'نعم' : 'لا', reasonOf(p), (p.proofIds || []).length ? 'نعم' : 'لا'
  ]));

  const sheet = (name, rows, textColumns, extra) => Object.assign({ name, rows, rtl: true, header: true, filter: true, widths: widths(rows), textColumns }, extra || {});
  const taken = new Set(FIXED_SHEETS);
  const sheets = [
    sheet('ملخص', summaryRows, [0, 1], { filter: false }),
    sheet('حسب الخادم', byServantRows, [0]),
    // الرقم, الاسم, الموبايل, الأسماء, ملاحظات stay text (a phone keeps its + and its digits)
    sheet('الحجوزات', bookingRows, [0, 2, 3, 10, 18]),
    sheet('الدفعات', paymentRows, [0, 1, 2, 11])
  ];

  /* one sheet per servant: that servant's live rows, then the total */
  const ids = servants.map(sv => sv.id).concat(payments.filter(isLive).map(p => p.servantId)).filter((id, i, all) => id && all.indexOf(id) === i);
  ids.forEach(id => {
    const live = payments.filter(p => isLive(p) && p.servantId === id);
    if (!live.length) return;
    const info = servants.find(sv => sv.id === id) || {};
    const name = info.name || live[0].servantName || id;
    const signed = p => (p.kind === 'refund' ? -1 : 1) * (p.amount || 0);
    const rows = [SERVANT_ROW_HEADERS].concat(live.map(p => [
      p.id || '', refOf(p), nameOf(p), KIND[p.kind] || p.kind, signed(p), label(p.method), wall(p.receivedAt), p.recordedName || p.recordedBy || '', p.note || ''
    ]), [['الإجمالي', '', '', '', live.reduce((sum, p) => sum + signed(p), 0), '', '', '', '']]);
    sheets.push(sheet(sheetName(name, taken), rows, [0, 1, 2, 8]));
  });

  /*
   * «حسابات الخدام»: servant × payment method — verified (recorded payments),
   * in their custody (cash, or transfers to THEIR own number), pending
   * verification (expected, not money), owed by participants, handed over,
   * still to hand over. Every number from one ledger row once (the Worker's summary).
   */
  const acct = [ACCOUNT_HEADERS];
  for (const sv of servants) {
    for (const m of sv.methods || []) {
      acct.push([sv.name || sv.id, label(m.method), m.net || 0, m.held || 0, m.pendingCount || 0, m.pendingQuoted || 0, m.owed || 0, m.handedOver || 0, m.toHandOver || 0, m.unreconciled || 0]);
    }
    if ((sv.methods || []).length) acct.push([(sv.name || sv.id) + ' — الإجمالي', '', sv.net || 0, sv.held || 0, '', sv.pendingQuoted || 0, sv.owed || 0, sv.handedOver || 0, sv.toHandOver || 0, sv.unreconciled || 0]);
  }
  if (acct.length > 1) {
    const t = summary.handovers || {};
    acct.push(['', '', '', '', '', '', '', '', '', ''], ['الخدمة استلمت (تسليمات)', '', '', t.held || 0, '', '', '', t.total || 0, t.toHandOver || 0, (summary.overall && summary.overall.money && summary.overall.money.unreconciled) || 0]);
    sheets.splice(2, 0, sheet('حسابات الخدام', acct, [0, 1]));
  }

  /* «التسليمات»: every handover to the service, voids included (the audit trail) */
  const hands = Array.isArray(data.handovers) ? data.handovers : [];
  if (hands.length) {
    sheets.push(sheet('التسليمات', [HANDOVER_HEADERS].concat(hands.map(h => [
      h.id || '', h.kind === 'void' ? 'إلغاء' : 'تسليم', h.servantName || h.servantId || '', h.method ? label(h.method) : 'كل الطرق', h.amount || 0,
      wall(h.handedAt), h.receivedBy || '', h.recordedName || '', h.kind === 'void' ? '' : h.voidedBy ? 'نعم' : 'لا', h.note || ''
    ])), [0, 2, 6, 7, 9]));
  }

  return { book: { sheets }, filename: bookingFilename(event.slug, today) };
}

export const ACCOUNT_HEADERS = ['الخادم', 'الطريقة', 'متأكد (صافي)', 'في عهدته', 'طلبات مستنية التأكيد', 'قيمتها (متوقع)', 'لسه على الناس', 'سلّم للخدمة', 'لسه معاه', 'محتاج مراجعة (تحويل قديم)'];
export const HANDOVER_HEADERS = ['رقم التسليم', 'النوع', 'الخادم', 'الطريقة', 'المبلغ', 'وقت التسليم', 'استلمها', 'سجّلها', 'ملغي؟', 'ملاحظة'];

/*
 * «قايمة الأفراد»: a roster to SHARE (WhatsApp group, the bus list): the
 * booking reference and each person's name — confirmed bookings only by
 * default. No phones, no money, no links, no notes.
 */
export function rosterBook(exported, { statuses = ['confirmed'], today = '' } = {}) {
  const data = exported || {};
  const event = data.event || {};
  const rows = [['#', 'رقم الحجز', 'الاسم']];
  let n = 0;
  for (const b of (Array.isArray(data.bookings) ? data.bookings : []).filter(x => statuses.includes(x.status))) {
    const people = (b.participants || []).length ? b.participants.map(p => p.name) : (b.names || []).length ? b.names : [b.name];
    for (const name of people) rows.push([++n, b.ref || '', String(name || '')]);
  }
  const sheet = { name: 'قايمة الأفراد', rows, rtl: true, header: true, filter: true, widths: [6, 12, 34], textColumns: [1, 2] };
  return { book: { sheets: [sheet] }, filename: 'أفراد-' + String(event.slug || 'event').replace(/[^a-z0-9-]/gi, '') + '-' + String(today || '').slice(0, 10) + '.xlsx' };
}

/*
 * «التقرير المجمّع» (Phase 1.5 step 8): GET /v1/admin/book/report →
 * one workbook over several events, filtered on the server. The server already
 * removed what this admin may not see (report.access: money / pii), so the
 * money sheets and columns appear only with money, and masked phones stay
 * masked. Every user text cell stays inlineStr (the xlsx.js injection guard).
 *   ملخص عام · حسب الفعالية · حسب الخادم · الحجوزات (+ الفعالية)
 *   · الدفعات (+ حالة الأقساط) · الأقساط المتأخرة — all RTL
 * → { book: { sheets }, filename }
 */
export function reportBook(report, { today = '', filterText = '' } = {}) {
  const data = report || {};
  const access = data.access || {};
  const money = !!access.money;
  const parts = Array.isArray(data.events) ? data.events : [];
  const sheet = (name, rows, textColumns, extra) => Object.assign({ name, rows, rtl: true, header: true, filter: true, widths: widths(rows), textColumns }, extra || {});
  const sum = (list, f) => list.reduce((n, x) => n + (Number(f(x)) || 0), 0);
  const overall = p => (p.summary && p.summary.overall) || {};
  const bookingsAll = parts.flatMap(p => (p.bookings || []).map(b => ({ b, p })));
  const label = (p, key) => methodLabel(p.event || {}, key) || key || '';

  /* «ملخص عام» */
  const count = st => bookingsAll.filter(x => x.b.status === st).length;
  const conf = bookingsAll.filter(x => x.b.status === 'confirmed');
  const general = [
    ['البند', 'القيمة'],
    ['الفعاليات', parts.length],
    ['الفلاتر', filterText || 'من غير فلاتر'],
    ['تاريخ التقرير', today],
    ['', ''],
    ['حجوزات جديدة', count('pending')],
    ['حجوزات مؤكدة', count('confirmed')],
    ['حجوزات مرفوضة', count('rejected')],
    ['الزائر لغاها', count('withdrawn')],
    ['حجوزات اتلغت', count('cancelled')],
    ['إجمالي الأفراد (المؤكدين)', sum(conf, x => (x.b.people || {}).total)]
  ];
  if (money) {
    const m = p => overall(p).money || {};
    general.push(['', ''], ['المطلوب', sum(parts, p => m(p).due)], ['المستلم', sum(parts, p => m(p).received)], ['المرتجع', sum(parts, p => m(p).refunded)],
      ['الصافي', sum(parts, p => m(p).net)], ['الباقي على الناس', sum(parts, p => m(p).balance)], ['مرتجعات مطلوبة', sum(parts, p => m(p).refundsOwed)]);
  }
  general.push(['', ''], ['ملاحظة', [money ? '' : 'الفلوس مش ظاهرة (محتاجة صلاحية «يشوف · الفلوس»).', access.pii ? '' : 'أرقام الموبايل متخبية (محتاجة صلاحية «يصدّر بأرقام التليفونات»).'].filter(Boolean).join(' ') || '—']);

  /* «حسب الفعالية» */
  const perEventHeaders = ['الفعالية', 'بتبدأ', 'جديد', 'مؤكد', 'مرفوض', 'اتلغى', 'الأفراد (المؤكدين)', 'الأماكن الفاضية'].concat(money ? ['المطلوب', 'المستلم', 'الصافي', 'الباقي'] : []);
  const perEvent = [perEventHeaders].concat(parts.map(p => {
    const o = overall(p);
    const b = o.bookings || {};
    const s = o.seats || {};
    const m = o.money || {};
    return [p.event.title || '', wall(p.event.startAt), b.pending || 0, b.confirmed || 0, b.rejected || 0, b.cancelled || 0, (o.people || {}).total || 0,
      s.left === null || s.left === undefined ? 'من غير حد' : s.left].concat(money ? [m.due || 0, m.received || 0, m.net || 0, m.balance || 0] : []);
  }));

  /* «حسب الخادم»: across the events, by servant id */
  const byServant = new Map();
  for (const p of parts) {
    for (const sv of (p.summary && p.summary.servants) || []) {
      const key = sv.id || sv.name;
      const t = byServant.get(key) || { name: sv.name || sv.id || '', chosenBy: 0, bookings: 0, received: 0, refunded: 0, net: 0 };
      t.chosenBy += sv.chosenBy || 0;
      t.bookings += sv.bookings || 0;
      t.received += sv.received || 0;
      t.refunded += sv.refunded || 0;
      t.net += sv.net || 0;
      byServant.set(key, t);
    }
  }
  const servantRows = [['الخادم', 'اختاروه', 'حجوزات دفع فيها'].concat(money ? ['المستلم', 'المرتجع', 'الصافي'] : [])]
    .concat([...byServant.values()].map(t => [t.name, t.chosenBy, t.bookings].concat(money ? [t.received, t.refunded, t.net] : [])));

  /* «الحجوزات» (+ the event); money columns only with money */
  const moneyCols = new Set(['المطلوب', 'المدفوع', 'الباقي', 'حالة الدفع', 'متأخر']);
  const keepCol = BOOKING_HEADERS.map(h => money || !moneyCols.has(h));
  const bookingRows = [['الفعالية'].concat(BOOKING_HEADERS.filter((_, i) => keepCol[i]))].concat(bookingsAll.map(({ b, p }) => {
    const ppl = b.people || {};
    const notes = [b.visitorNote, b.adminNote, b.rejectReason && 'سبب الرفض: ' + b.rejectReason, b.cancelReason && 'سبب الإلغاء: ' + b.cancelReason].filter(Boolean).join(' — ');
    const full = [
      b.ref || '', (STATUS[b.status] || { label: b.status }).label, b.name || '', localPhone(b.phone), b.servantName || '', b.method ? label(p, b.method) : '',
      ppl.adult || 0, ppl.child || 0, ppl.companion || 0, ppl.total || 0,
      (b.participants || []).length ? b.participants.map(x => x.name + ' (' + x.age + ')').join('، ') : (b.names || []).join('، '),
      b.amountDue === null || b.amountDue === undefined ? '' : b.amountDue, b.paid || 0, b.balance === null || b.balance === undefined ? '' : b.balance,
      b.paymentStatus ? (PAY_STATUS[b.paymentStatus] || { label: b.paymentStatus }).label : '', b.overdue ? 'نعم' : '', wall(b.createdAt), wall(b.confirmedAt), notes
    ];
    return [p.event.title || ''].concat(full.filter((_, i) => keepCol[i]));
  }));
  const textOf = (headers, names) => names.map(n => headers.indexOf(n)).filter(i => i >= 0);
  const bh = bookingRows[0];

  const sheets = [
    sheet('ملخص عام', general, [0, 1], { filter: false }),
    sheet('حسب الفعالية', perEvent, [0, 1]),
    sheet('حسب الخادم', servantRows, [0]),
    sheet('الحجوزات', bookingRows, textOf(bh, ['الفعالية', 'الرقم', 'الاسم', 'الموبايل', 'الأسماء', 'ملاحظات']))
  ];

  if (money) {
    /* «الدفعات» (+ the event and the booking's installment status) */
    const statusOf = new Map(bookingsAll.map(({ b }) => [b.id, b]));
    const payHeaders = ['الفعالية'].concat(PAYMENT_HEADERS, ['حالة الأقساط']);
    const payRows = [payHeaders].concat(parts.flatMap(p => (p.payments || []).map(x => {
      const bk = statusOf.get(x.bookingId) || {};
      return [p.event.title || '', x.id || '', x.ref || bk.ref || '', x.name || bk.name || '', KIND[x.kind] || x.kind || '', x.amount || 0, label(p, x.method),
        x.servantName || x.servantId || '', wall(x.receivedAt), wall(x.recordedAt), x.recordedBy || '', x.kind === 'void' ? '' : x.voided ? 'نعم' : 'لا', x.voidReason || '',
        x.hasProof ? 'نعم' : 'لا', bk.paymentStatus ? (PAY_STATUS[bk.paymentStatus] || { label: bk.paymentStatus }).label : ''];
    })));
    sheets.push(sheet('الدفعات', payRows, textOf(payHeaders, ['الفعالية', 'رقم الدفعة', 'رقم الحجز', 'الاسم', 'سبب الإلغاء'])));

    /* «الأقساط المتأخرة»: confirmed bookings past their final date with money still owed */
    const lateHeaders = ['الفعالية', 'الرقم', 'الاسم', 'الموبايل', 'الخادم', 'المطلوب', 'المدفوع', 'الباقي', 'آخر ميعاد للدفع'];
    const lateRows = [lateHeaders].concat(bookingsAll.filter(({ b }) => b.overdue && (b.balance || 0) > 0).map(({ b, p }) => [
      p.event.title || '', b.ref || '', b.name || '', localPhone(b.phone), b.servantName || '', b.amountDue || 0, b.paid || 0, b.balance || 0,
      wall((p.event.payment || {}).finalDueAt || '')
    ]));
    sheets.push(sheet('الأقساط المتأخرة', lateRows, textOf(lateHeaders, ['الفعالية', 'الرقم', 'الاسم', 'الموبايل'])));
  }

  return { book: { sheets }, filename: 'تقرير-الحجوزات-' + String(today || '').slice(0, 10) + '.xlsx' };
}
