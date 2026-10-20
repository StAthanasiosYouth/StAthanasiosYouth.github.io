// Phase 1.5 step 8 (admin/book-kit.js reportBook): the combined report over
// several events — the six sheets, RTL, the event on every row, money sheets
// and columns only when the Worker sent money, masked phones kept masked, and
// the formula-injection guard (user text never becomes a formula).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readXlsx, writeXlsx, unzip } from '../admin/xlsx.js';
import * as K from '../admin/book-kit.js';

const ev = (id, title, over = {}) => ({ id, slug: id, title, startAt: '2026-11-04T07:00', endAt: '2026-11-04T22:00', methods: [{ key: 'cash', label: 'كاش' }], payment: { finalDueAt: '2026-11-01T23:59' }, ...over });
const booking = (over = {}) => ({ id: 'bkg-' + Math.random().toString(36).slice(2, 8), ref: 'B-AAAA1', status: 'confirmed', name: 'مريم', phone: '+201012345678', servantName: 'مينا', method: 'cash',
  people: { adult: 2, child: 0, companion: 0, total: 2 }, amountDue: 3000, paid: 1000, balance: 2000, paymentStatus: 'partial', overdue: true, createdAt: '2026-10-10T10:00', ...over });
const summary = (over = {}) => ({ overall: { bookings: { confirmed: 1, pending: 1 }, seats: { left: 10 }, people: { total: 2 }, money: { due: 3000, received: 1000, net: 1000, balance: 2000 } },
  servants: [{ id: 'srv-a', name: 'مينا', chosenBy: 2, bookings: 1, received: 1000, refunded: 0, net: 1000 }], ...over });

function report({ money = true, pii = true } = {}) {
  const b1 = booking();
  const b2 = booking({ ref: 'B-BBBB2', status: 'pending', name: '=HYPERLINK("http://x")', phone: pii ? '+201112223334' : '011•••••334', overdue: false, balance: 0 });
  const strip = b => (money ? b : Object.fromEntries(Object.entries(b).filter(([k]) => !['amountDue', 'paid', 'balance', 'paymentStatus', 'overdue'].includes(k))));
  return {
    access: { money, pii },
    events: [
      { event: ev('evt-a', 'رحلة إسكندرية'), bookings: [b1, b2].map(b => ({ ...strip(b), phone: pii ? b.phone : K.localPhone(b.phone).replace(/^(\d{3})\d+(\d{3})$/, '$1•••••$2') })),
        payments: money ? [{ id: 'pay-1', bookingId: b1.id, ref: 'B-AAAA1', name: 'مريم', kind: 'payment', amount: 1000, method: 'cash', servantName: 'مينا', receivedAt: '2026-10-11T10:00', recordedAt: '2026-10-11T10:00', voided: false }] : [],
        summary: money ? summary() : { overall: { bookings: { confirmed: 1, pending: 1 }, seats: { left: 10 }, people: { total: 2 } }, servants: [{ id: 'srv-a', name: 'مينا', chosenBy: 2, bookings: 1 }] } },
      { event: ev('evt-b', 'يوم القاهرة'), bookings: [], payments: [], summary: money ? summary({ overall: { bookings: {}, seats: { left: null }, people: {}, money: { due: 0 } }, servants: [{ id: 'srv-a', name: 'مينا', chosenBy: 1, bookings: 0, received: 500, refunded: 0, net: 500 }] }) : { overall: { bookings: {}, seats: {}, people: {} }, servants: [] } }
    ]
  };
}

test('with money: the six sheets, RTL, the event on every row, servants summed across events', () => {
  const made = K.reportBook(report(), { today: '2026-10-20', filterText: 'كل الفعاليات' });
  assert.equal(made.filename, 'تقرير-الحجوزات-2026-10-20.xlsx');
  const names = made.book.sheets.map(s => s.name);
  assert.deepEqual(names, ['ملخص عام', 'حسب الفعالية', 'حسب الخادم', 'الحجوزات', 'الدفعات', 'الأقساط المتأخرة']);
  assert.ok(made.book.sheets.every(s => s.rtl));
  const sheet = n => made.book.sheets.find(s => s.name === n).rows;
  assert.deepEqual(sheet('حسب الفعالية').slice(1).map(r => r[0]), ['رحلة إسكندرية', 'يوم القاهرة']);
  assert.deepEqual(sheet('حسب الخادم')[1], ['مينا', 3, 1, 1500, 0, 1500], 'across both events');
  assert.equal(sheet('الحجوزات')[1][0], 'رحلة إسكندرية');
  assert.equal(sheet('الحجوزات')[1][4], '01012345678', 'a full phone as 01x text');
  assert.ok(sheet('الدفعات')[0].includes('حالة الأقساط'));
  assert.equal(sheet('الأقساط المتأخرة').length, 2, 'the one overdue booking with a balance');
  assert.equal(sheet('الأقساط المتأخرة')[1][8], '2026-11-01 23:59');
  const general = Object.fromEntries(sheet('ملخص عام').slice(1));
  assert.equal(general['المستلم'], 1000);
  assert.equal(general['الفلاتر'], 'كل الفعاليات');
});

test('without money: no money sheet, column or total; masked phones stay masked; a note says why', () => {
  const made = K.reportBook(report({ money: false, pii: false }), { today: '2026-10-20' });
  const names = made.book.sheets.map(s => s.name);
  assert.deepEqual(names, ['ملخص عام', 'حسب الفعالية', 'حسب الخادم', 'الحجوزات']);
  const sheet = n => made.book.sheets.find(s => s.name === n).rows;
  const headers = sheet('الحجوزات')[0];
  for (const h of ['المطلوب', 'المدفوع', 'الباقي', 'حالة الدفع', 'متأخر']) assert.ok(!headers.includes(h), h);
  assert.deepEqual(sheet('حسب الخادم')[0], ['الخادم', 'اختاروه', 'حجوزات دفع فيها']);
  assert.match(sheet('الحجوزات')[1][headers.indexOf('الموبايل')], /^010•+678$/);
  const flat = JSON.stringify(made.book.sheets.map(s => s.rows));
  assert.doesNotMatch(flat, /3000|1000|2000/, 'no amount anywhere');
  const note = Object.fromEntries(sheet('ملخص عام').slice(1))['ملاحظة'];
  assert.match(note, /الفلوس مش ظاهرة/);
  assert.match(note, /أرقام الموبايل متخبية/);
});

test('the workbook: user text never becomes a formula; phones keep their leading zero (text cells)', async () => {
  const made = K.reportBook(report(), { today: '2026-10-20' });
  const bytes = writeXlsx(made.book);
  const files = await unzip(bytes);
  const xml = Object.entries(files).filter(([n]) => /worksheets\/sheet\d+\.xml$/.test(n)).map(([, v]) => new TextDecoder().decode(v)).join('');
  assert.doesNotMatch(xml, /<f>/, 'no formula cells');
  const back = await readXlsx(bytes);
  const rows = back.sheets.find(s => s.name === 'الحجوزات').rows;
  assert.ok(rows.some(r => r.includes('=HYPERLINK("http://x")')), 'kept as plain text');
  assert.ok(rows.some(r => r.includes('01012345678')));
});
