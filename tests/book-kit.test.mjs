// «الحجوزات» in the admin: the pure parts (admin/book-kit.js) — the queue's
// requests, prices and places as the server counts them, the server's
// refusals said before sending, one key per write, and the §13 workbook
// (sheets, headers, RTL, phones and refs as text, the file name).
// The screens themselves: tests/book-admin.e2e.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readXlsx, writeXlsx, unzip } from '../admin/xlsx.js';
import * as K from '../admin/book-kit.js';
import { ROOT } from '../tools/lib/gs.mjs';

const PRICING = {
  mode: 'group',
  categories: [
    { key: 'applicant', label: 'الحاجز', group: 'adult', price: 1500, seat: true, min: 1, max: 1 },
    { key: 'adult', label: 'فرد إضافي', group: 'adult', price: 1500, seat: true, min: 0, max: 6 },
    { key: 'child', label: 'طفل', group: 'child', price: 800, seat: true, min: 0, max: 6 },
    { key: 'infant', label: 'أقل من ٤ سنين', group: 'child', price: 0, seat: false, min: 0, max: 4 },
    { key: 'guest', label: 'مرافق', group: 'companion', price: 1700, seat: true, min: 0, max: 4 }
  ]
};

test('the chips: one request per status, «المرفوضة والملغية» = three lists merged; counts from the reply', () => {
  assert.deepEqual(K.FILTERS.map(f => f.label), ['مستنية المراجعة', 'المؤكدة', 'متأخر', 'مرتجعات مطلوبة', 'المرفوضة والملغية', 'الكل']);
  const [pending] = K.queuePaths('evt-abcd1234', 'pending', '');
  assert.equal(pending, '/v1/admin/book/bookings?eventId=evt-abcd1234&status=pending&limit=50');
  assert.match(K.queuePaths('evt-abcd1234', 'overdue', '')[0], /status=all&overdue=1/);
  assert.match(K.queuePaths('evt-abcd1234', 'refunds', '')[0], /status=all&refunds=1/);
  const closed = K.queuePaths('evt-abcd1234', 'closed', ' 0101 ', { cursors: ['', 'c2', ''] });
  assert.equal(closed.length, 3);
  assert.deepEqual(closed.map(p => new URL(p, 'https://x').searchParams.get('status')), ['rejected', 'withdrawn', 'cancelled']);
  assert.equal(new URL(closed[0], 'https://x').searchParams.get('q'), '0101');
  assert.equal(new URL(closed[1], 'https://x').searchParams.get('cursor'), 'c2');
  assert.equal(new URL(closed[0], 'https://x').searchParams.get('cursor'), null);

  const counts = { byStatus: { pending: 3, confirmed: 5, rejected: 1, withdrawn: 2, cancelled: 1 }, overdue: 2, refunds: 1 };
  assert.deepEqual(K.FILTERS.map(f => K.filterCount(f.key, counts)), [3, 5, 2, 1, 4, 12]);

  const merged = K.mergeRows([[{ id: 'a', createdAt: '2026-10-01T10:00' }], [{ id: 'b', createdAt: '2026-10-03T10:00' }, { id: 'a', createdAt: '2026-10-01T10:00' }]]);
  assert.deepEqual(merged.map(r => r.id), ['b', 'a'], 'newest first, each once');
});

test('prices and places: quote, seats (an infant takes none), people by group, free events', () => {
  const counts = { applicant: 1, adult: 1, child: 2, infant: 1, guest: 1 };
  assert.equal(K.quote(PRICING, counts), 1500 + 1500 + 1600 + 0 + 1700);
  assert.equal(K.seats(PRICING, counts), 5);
  assert.deepEqual(K.people(PRICING, counts), { adult: 2, child: 3, companion: 1, total: 6 });
  assert.equal(K.isFree(PRICING), false);
  assert.equal(K.isFree({ categories: [{ key: 'applicant', price: 0 }] }), true);
  assert.equal(K.peopleText({ adult: 2, child: 1, companion: 0, total: 3 }), '٢ كبار، ١ طفل');
  assert.equal(K.money(1500), '١٬٥٠٠ ج');
  assert.equal(K.money(-300), '−٣٠٠ ج');
});

test('counts: each category within its min/max, unknown keys, perBookingMax, single mode', () => {
  assert.equal(K.checkCounts(PRICING, 10, { applicant: 1 }), '');
  assert.match(K.checkCounts(PRICING, 10, { applicant: 1, child: 7 }), /طفل/);
  assert.match(K.checkCounts(PRICING, 10, { applicant: 1, pets: 1 }), /فئة/);
  assert.match(K.checkCounts(PRICING, 3, { applicant: 1, adult: 3 }), /أكتر من ٣/);
  assert.match(K.checkCounts({ mode: 'single', categories: PRICING.categories }, 10, { applicant: 1, adult: 1 }), /للحاجز بس/);
});

test('a payment or refund: the server\'s hard refusals before sending (§5.2)', () => {
  const ctx = { now: '2026-10-15T12:00', createdAt: '2026-10-10T09:00', paid: 0 };
  const good = { kind: 'payment', amount: '1200', servantId: 'srv-1', method: 'instapay', receivedAt: '2026-10-14T18:30' };
  assert.deepEqual(K.checkPay(good, ctx), []);
  const fields = input => K.checkPay({ ...good, ...input }, ctx).map(e => e.field);
  assert.deepEqual(fields({ amount: '' }), ['amount']);
  assert.deepEqual(fields({ amount: '12.5' }), ['amount'], 'integers only');
  assert.deepEqual(fields({ amount: '0' }), ['amount']);
  assert.deepEqual(fields({ amount: '1000001' }), ['amount'], '≤ 1,000,000');
  assert.deepEqual(fields({ amount: '١٢٠٠' }), [], 'Arabic digits are fine');
  assert.deepEqual(fields({ servantId: '' }), ['servantId']);
  assert.deepEqual(fields({ method: '' }), ['method']);
  assert.deepEqual(fields({ receivedAt: '2026-10-16T09:00' }), ['receivedAt'], 'not in the future');
  assert.deepEqual(fields({ receivedAt: '2026-10-09T09:00' }), ['receivedAt'], 'not before the booking');
  assert.deepEqual(fields({ proofIds: ['a', 'b', 'c', 'd'] }), ['proofs']);
  assert.deepEqual(fields({ kind: 'refund' }), ['amount'], 'a refund with nothing paid');
  assert.deepEqual(K.checkPay({ ...good, kind: 'refund' }, { ...ctx, paid: 500 }), []);
  assert.equal(K.amountOf('١٥٠٠'), 1500);
  assert.ok(Number.isNaN(K.amountOf('1.5')));
});

test('confirm, cancel, manual: the amount due needs a reason off the quote; retain ≤ paid; an Egyptian mobile', () => {
  const base = { pricing: PRICING, perBookingMax: 10, actual: { applicant: 1 }, amountDue: '1500', dueReason: '', quoted: 1500 };
  assert.deepEqual(K.checkConfirm(base), []);
  assert.deepEqual(K.checkConfirm({ ...base, amountDue: '1000' }).map(e => e.field), ['dueReason']);
  assert.deepEqual(K.checkConfirm({ ...base, amountDue: '1000', dueReason: 'خصم' }), []);
  assert.deepEqual(K.checkConfirm({ ...base, amountDue: '0', dueReason: 'إعفاء' }), [], 'an exemption is a valid amount');
  assert.deepEqual(K.checkConfirm({ ...base, actual: { applicant: 0 } }).map(e => e.field), ['actual']);

  assert.deepEqual(K.checkCancel({ reason: 'اعتذر', retain: '0', paid: 1500 }), []);
  assert.deepEqual(K.checkCancel({ reason: '', retain: '0', paid: 1500 }).map(e => e.field), ['reason']);
  assert.deepEqual(K.checkCancel({ reason: 'x', retain: '2000', paid: 1500 }).map(e => e.field), ['retain']);

  assert.equal(K.normPhone('0101 234 5678'), '+201012345678');
  assert.equal(K.normPhone('+20 10 1234 5678'), '+201012345678');
  assert.equal(K.normPhone('٠١٢٣٤٥٦٧٨٩٠'), '+201234567890');
  assert.equal(K.normPhone('0123'), '');
  const manual = { name: 'مينا', phone: '01012345678', counts: { applicant: 1 }, pricing: PRICING, perBookingMax: 10, note: '' };
  assert.deepEqual(K.checkManual(manual), []);
  assert.deepEqual(K.checkManual({ ...manual, name: 'م', phone: '123' }).map(e => e.field), ['name', 'phone']);
});

test('a server error that names a field lands under that field («<label>: …»)', () => {
  assert.equal(K.fieldLine('amount', 'لازم يبقى أكبر من صفر'), 'المبلغ: لازم يبقى أكبر من صفر');
  assert.equal(K.fieldLine('amount', 'المبلغ كبير'), 'المبلغ كبير', 'already starts with the label');
  assert.equal(K.fieldLine('reason', 'مطلوب'), 'السبب: مطلوب');
  assert.equal(K.fieldLine('', 'مفيش حاجة اتغيرت.'), 'مفيش حاجة اتغيرت.');
  // every label the server may name is a label the dialogs show (AdminBook.html)
  const ui = readFileSync(`${ROOT}apps-script/AdminBook.html`, 'utf8');
  for (const field of ['name', 'phone', 'counts', 'servantId', 'method', 'proofs', 'names', 'note', 'amount', 'receivedAt', 'amountDue', 'reason', 'retain']) {
    assert.ok(ui.includes(`A.field('${K.FIELD_LABELS[field]}'`) || ui.includes(`'${K.FIELD_LABELS[field]}'`), field);
  }
});

test('one write = one key: a retry of the same body keeps it; another body (force) gets a new one', () => {
  const keys = K.keyKeeper('pay');
  const a = keys.for({ amount: 100 });
  assert.match(a, /^pay-[0-9a-f]{24}$/);
  assert.equal(keys.for({ amount: 100 }), a);
  const b = keys.for({ amount: 100, force: true });
  assert.notEqual(b, a);
  assert.notEqual(K.newKey(), K.newKey());
});

/* an export as GET /v1/admin/book/export returns it */
function exported() {
  const event = { id: 'evt-alex2026', slug: 'alex-trip', title: 'رحلة إسكندرية', startAt: '2026-11-01T07:00', endAt: '2026-11-02T22:00',
    methods: [{ key: 'cash', label: 'كاش' }, { key: 'instapay', label: 'إنستاباي' }],
    servants: [{ id: 'srv-mina', name: 'مينا عادل', methods: ['cash', 'instapay'] }, { id: 'srv-fady', name: 'فادي يوسف', methods: ['cash'] }] };
  const bookings = [
    { id: 'bk-1', ref: 'B-7K2QX', status: 'confirmed', name: 'مريم سمير', phone: '+201012345678', servantName: 'مينا عادل', method: 'instapay',
      people: { adult: 2, child: 1, companion: 0, total: 3 }, names: ['مريم', 'جورج'], amountDue: 3800, paid: 3000, balance: 800, paymentStatus: 'partial',
      overdue: true, createdAt: '2026-10-10T09:00', confirmedAt: '2026-10-11T10:00', visitorNote: 'هنركب من الغردقة', adminNote: '' },
    { id: 'bk-2', ref: 'B-9PQ2M', status: 'rejected', name: 'بيتر', phone: '+201112223334', servantName: 'فادي يوسف', method: 'cash',
      people: { adult: 1, child: 0, companion: 0, total: 1 }, amountDue: 0, paid: 0, balance: 0, paymentStatus: 'free', createdAt: '2026-10-12T09:00', rejectReason: 'اكتمل العدد' }
  ];
  const payments = [
    { id: 'pay-1', bookingId: 'bk-1', kind: 'payment', amount: 1200, servantId: 'srv-mina', servantName: 'مينا عادل', method: 'instapay', receivedAt: '2026-10-11T10:00', recordedAt: '2026-10-11T10:05', recordedName: 'مينا', proofIds: ['prf-1'], note: '', voidedBy: '' },
    { id: 'pay-2', bookingId: 'bk-1', kind: 'payment', amount: 800, servantId: 'srv-fady', servantName: 'فادي يوسف', method: 'cash', receivedAt: '2026-10-12T10:00', recordedAt: '2026-10-12T10:05', recordedName: 'فادي', proofIds: [], note: '', voidedBy: 'pay-3' },
    { id: 'pay-3', bookingId: 'bk-1', kind: 'void', amount: 800, servantId: 'srv-fady', method: 'cash', receivedAt: '2026-10-12T11:00', recordedAt: '2026-10-12T11:00', note: 'اتكتب غلط', voidsId: 'pay-2', voidedBy: '' },
    { id: 'pay-4', bookingId: 'bk-1', kind: 'payment', amount: 1800, servantId: 'srv-fady', servantName: 'فادي يوسف', method: 'cash', receivedAt: '2026-10-12T11:05', recordedAt: '2026-10-12T11:05', recordedName: 'فادي', proofIds: [], note: 'الصح', voidedBy: '' },
    { id: 'pay-5', bookingId: 'bk-2', kind: 'payment', amount: 500, servantId: 'srv-fady', servantName: 'فادي يوسف', method: 'cash', receivedAt: '2026-10-12T12:00', recordedAt: '2026-10-12T12:00', recordedName: 'فادي', proofIds: [], voidedBy: '' },
    { id: 'pay-6', bookingId: 'bk-2', kind: 'refund', amount: 500, servantId: 'srv-fady', servantName: 'فادي يوسف', method: 'cash', receivedAt: '2026-10-13T12:00', recordedAt: '2026-10-13T12:00', recordedName: 'فادي', proofIds: [], voidedBy: '' }
  ];
  const summary = {
    overall: { bookings: { pending: 0, confirmed: 1, rejected: 1, withdrawn: 0, cancelled: 0 }, seats: { capacity: 40, taken: 3, left: 37 }, people: { adult: 2, child: 1, companion: 0, total: 3 },
      money: { due: 3800, received: 3500, refunded: 500, net: 3000, balance: 800, refundsOwed: 0, byMethod: { cash: { received: 2300, refunded: 500, net: 1800 }, instapay: { received: 1200, refunded: 0, net: 1200 } } },
      payStatus: { free: 1, unpaid: 0, partial: 1, paid: 0, overpaid: 0, overdue: 1 }, pending: { count: 0, quoted: 0 } },
    servants: [
      { id: 'srv-mina', name: 'مينا عادل', active: true, payments: 1, received: 1200, refunded: 0, net: 1200, byMethod: { instapay: 1200 }, bookings: 1, chosenBy: 1 },
      { id: 'srv-fady', name: 'فادي يوسف', active: true, payments: 3, received: 2300, refunded: 500, net: 1800, byMethod: { cash: 1800 }, bookings: 2, chosenBy: 0 }
    ]
  };
  return { event, bookings, payments, servants: event.servants, summary };
}

test('the workbook (§13): ملخص, حسب الخادم, الحجوزات, الدفعات, one sheet per servant; RTL, text phones and refs, the file name', async () => {
  const made = K.bookingBook(exported(), { today: '2026-10-15' });
  assert.equal(made.filename, 'حجوزات-alex-trip-2026-10-15.xlsx');
  const bytes = writeXlsx(made.book);
  const book = await readXlsx(bytes);
  assert.deepEqual(book.sheets.map(s => s.name), ['ملخص', 'حسب الخادم', 'الحجوزات', 'الدفعات', 'مينا عادل', 'فادي يوسف']);

  const [summary, byServant, bookings, payments, mina, fady] = book.sheets;
  assert.deepEqual(summary.rows[1], ['الفعالية', 'رحلة إسكندرية']);
  assert.ok(summary.rows.some(r => r[0] === 'الصافي' && r[1] === '3000'));
  assert.ok(summary.rows.some(r => r[0] === 'الفترة' && r[1] === 'كل الوقت'));
  assert.deepEqual(byServant.rows[0], ['الخادم', 'عدد الدفعات', 'المستلم', 'المرتجع', 'الصافي', 'صافي كاش', 'صافي إنستاباي', 'عدد الحجوزات', 'اختاروه']);
  assert.deepEqual(byServant.rows[2], ['فادي يوسف', '3', '2300', '500', '1800', '1800', '0', '2', '0']);

  assert.deepEqual(bookings.rows[0], K.BOOKING_HEADERS);
  assert.deepEqual(K.BOOKING_HEADERS, ['الرقم', 'الحالة', 'الاسم', 'الموبايل', 'الخادم المختار', 'طريقة الدفع', 'كبار', 'أطفال', 'مرافقين', 'الإجمالي',
    'الأسماء', 'المطلوب', 'المدفوع', 'الباقي', 'حالة الدفع', 'متأخر', 'تاريخ الطلب', 'تاريخ التأكيد', 'ملاحظات']);
  assert.deepEqual(bookings.rows[1].slice(0, 6), ['B-7K2QX', 'مؤكد', 'مريم سمير', '01012345678', 'مينا عادل', 'إنستاباي']);
  assert.equal(bookings.rows[1][15], 'نعم', 'overdue');
  assert.match(bookings.rows[2][18], /سبب الرفض: اكتمل العدد/);

  assert.deepEqual(payments.rows[0], ['رقم الدفعة', 'رقم الحجز', 'الاسم', 'النوع', 'المبلغ', 'الطريقة', 'الخادم', 'وقت الاستلام', 'وقت التسجيل', 'سجلها', 'ملغية؟', 'سبب الإلغاء', 'فيه إثبات؟']);
  assert.equal(payments.rows.length, 1 + 6, 'the full history, voids included');
  const voided = payments.rows.find(r => r[0] === 'pay-2');
  assert.deepEqual([voided[1], voided[10], voided[11]], ['B-7K2QX', 'نعم', 'اتكتب غلط']);
  assert.equal(payments.rows.find(r => r[0] === 'pay-1')[12], 'نعم');

  // a servant's sheet: live rows only (the voided 800 is out), refunds negative, then the total
  assert.deepEqual(fady.rows.map(r => r[0]), ['رقم الدفعة', 'pay-4', 'pay-5', 'pay-6', 'الإجمالي']);
  assert.equal(fady.rows.at(-1)[4], '1800');
  assert.equal(fady.rows.find(r => r[0] === 'pay-6')[4], '-500');
  assert.equal(mina.rows.at(-1)[4], '1200');

  // RTL on every sheet; the phone and the ref are text cells (the leading 0 stays)
  const files = await unzip(bytes);
  const workbook = new TextDecoder().decode(files['xl/workbook.xml']);
  assert.match(workbook, /rightToLeft="1"/);
  const sheet3 = new TextDecoder().decode(files['xl/worksheets/sheet3.xml']);
  assert.match(sheet3, /rightToLeft="1"/);
  assert.match(sheet3, /<c r="D2"[^>]*t="(s|inlineStr|str)"/, 'the phone is text');
  assert.match(sheet3, /<c r="A2"[^>]*t="(s|inlineStr|str)"/, 'the ref is text');
  assert.match(sheet3, /autoFilter/, 'header filters');
});

test('the workbook is formula-proof: visitor text starting with = + - @ TAB CR stays text (never a formula), phones keep their leading 0', async () => {
  const data = exported();
  const evil = ['=HYPERLINK("http://x","y")', '+cmd|" /C calc"!A0', '-2+3', '@SUM(1,2)', '\t=1+1', '\r=1+1'];
  data.bookings[0].name = evil[0];
  data.bookings[0].visitorNote = evil[1];
  data.bookings[1].name = evil[2];
  data.bookings[1].adminNote = evil[3] + ' ' + evil[4] + evil[5];
  data.payments[0].note = evil[3];
  const bytes = writeXlsx(K.bookingBook(data, { today: '2026-10-15' }).book);
  const files = await unzip(bytes);
  for (const [name, file] of Object.entries(files)) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) continue;
    const xml = new TextDecoder().decode(file);
    assert.doesNotMatch(xml, /<f[ >]/, name + ': no formula cell');
  }
  const book = await readXlsx(bytes);
  const rows = book.sheets[2].rows;
  assert.equal(rows[1][2], evil[0], 'kept as the text it was');
  assert.equal(rows[2][2], evil[2]);
  assert.equal(rows[1][3], '01012345678');
  assert.equal(K.localPhone('+201112223334'), '01112223334');
  assert.equal(K.localPhone(''), '');
});

test('the workbook with a period: payment sheets keep only rows received inside it; the summary says so; servant names are unique sheet names', async () => {
  const data = exported();
  data.summary.servants.push({ id: 'srv-x', name: 'مينا عادل', payments: 0, received: 0, refunded: 0, net: 0, byMethod: {}, bookings: 0, chosenBy: 0 });
  data.payments.push({ id: 'pay-7', bookingId: 'bk-1', kind: 'payment', amount: 100, servantId: 'srv-x', servantName: 'مينا عادل', method: 'cash', receivedAt: '2026-10-12T13:00', recordedAt: '2026-10-12T13:00', proofIds: [], voidedBy: '' });
  const book = await readXlsx(writeXlsx(K.bookingBook(data, { from: '2026-10-12', to: '2026-10-12', today: '2026-10-15' }).book));
  assert.ok(book.sheets[0].rows.some(r => r[0] === 'الفترة' && /من 2026-10-12 لـ 2026-10-12/.test(r[1])));
  assert.deepEqual(book.sheets[3].rows.slice(1).map(r => r[0]), ['pay-2', 'pay-3', 'pay-4', 'pay-5', 'pay-7']);
  // inside the period: مينا (srv-mina) received nothing → no sheet of his
  assert.deepEqual(book.sheets.map(s => s.name).slice(4), ['فادي يوسف', 'مينا عادل']);
  const all = await readXlsx(writeXlsx(K.bookingBook(data, { today: '2026-10-15' }).book));
  assert.deepEqual(all.sheets.map(s => s.name).slice(4), ['مينا عادل', 'فادي يوسف', 'مينا عادل 2'], 'two servants with one name: two sheets');
});

test('roster: names + booking refs only, confirmed by default — no phones, money or notes', async () => {
  const data = exported();
  data.bookings[0].participants = [{ name: 'مريم سمير', age: 30 }, { name: 'يوسف', age: 7 }];
  const made = K.rosterBook(data, { today: '2026-10-20' });
  assert.match(made.filename, /^أفراد-alex-trip-2026-10-20\.xlsx$/);
  const bytes = writeXlsx(made.book);
  const book = await readXlsx(bytes);
  assert.deepEqual(book.sheets.map(s => s.name), ['قايمة الأفراد']);
  const rows = book.sheets[0].rows;
  assert.deepEqual(rows[0], ['#', 'رقم الحجز', 'الاسم']);
  const confirmed = data.bookings.filter(b => b.status === 'confirmed');
  assert.ok(rows.length - 1 >= confirmed.length);
  assert.deepEqual(rows.slice(1, 3).map(r => r.slice(1)), [['B-7K2QX', 'مريم سمير'], ['B-7K2QX', 'يوسف']]);
  const text = JSON.stringify(rows);
  assert.doesNotMatch(text, /\+20|01\d{9}|ج\b|سبب|instapay|إنستاباي/);
});

test('detailed report: «حسابات الخدام» (servant × method, custody, pending, owed, handed over) and «التسليمات»', async () => {
  const data = exported();
  data.summary.servants[0].methods = [{ method: 'cash', net: 1000, held: 1000, pendingCount: 1, pendingQuoted: 3000, owed: 500, handedOver: 800, toHandOver: 200 }];
  Object.assign(data.summary.servants[0], { held: 1000, handedOver: 800, toHandOver: 200, owed: 500, pendingQuoted: 3000 });
  data.summary.handovers = { total: 800, held: 1000, toHandOver: 200 };
  data.handovers = [{ id: 'hnd-1', kind: 'handover', servantName: 'مينا عادل', method: 'cash', amount: 800, handedAt: '2026-10-15T10:00', receivedBy: 'أمين الصندوق', recordedName: 'مينا زكريا' }];
  const book = await readXlsx(writeXlsx(K.bookingBook(data, { today: '2026-10-20' }).book));
  const names = book.sheets.map(s => s.name);
  assert.equal(names[2], 'حسابات الخدام');
  assert.ok(names.includes('التسليمات'));
  const acct = book.sheets[2].rows;
  assert.deepEqual(acct[0], K.ACCOUNT_HEADERS);
  assert.deepEqual(acct[1].slice(2), ['1000', '1000', '1', '3000', '500', '800', '200']);
  assert.deepEqual(book.sheets.find(s => s.name === 'التسليمات').rows[1].slice(0, 5), ['hnd-1', 'تسليم', 'مينا عادل', 'كاش', '800']);
});
