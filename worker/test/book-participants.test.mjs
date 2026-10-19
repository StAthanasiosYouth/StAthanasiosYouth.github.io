// «كل فرد باسمه وسنه» (Phase 1): people one by one, each priced by age on the
// server; counts derived → the usual quote, seats, capacity, accounting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookWorld, eventJson } from './book-helpers.mjs';
import { categoryForAge } from '../src/book/model.js';

const PEOPLE_EVENT = eventJson({}, {
  participants: true, capacity: 5, perBookingMax: 4,
  pricing: { mode: 'group', categories: [
    { key: 'applicant', label: 'فرد', group: 'adult', price: 100, seat: true, min: 0, max: 4, note: '' },
    { key: 'child', label: 'طفل', group: 'child', price: 50, seat: true, min: 0, max: 4, note: '', ageMin: 4, ageMax: 12 },
    { key: 'infant', label: 'رضيع', group: 'child', price: 0, seat: false, min: 0, max: 4, note: '', ageMin: 0, ageMax: 3 }
  ] }
});

test('participants: each person priced by age on the server; the counts, seats and total follow', async () => {
  const w = await bookWorld({ event: PEOPLE_EVENT });
  const r = await w.submit({ counts: { applicant: 9 }, participants: [{ name: 'مينا', age: 30 }, { name: 'مريم', age: 8 }, { name: 'يوسف', age: 2 }, { name: 'مرقس', age: 13 }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.quotedTotal, 100 + 50 + 0 + 100, 'server price: the counts sent are ignored');
  const b = await w.db.prepare('SELECT requested, seats_requested, names, participants FROM bookings').first();
  assert.deepEqual(JSON.parse(b.requested), { applicant: 2, child: 1, infant: 1 });
  assert.equal(b.seats_requested, 3, 'the infant takes no seat');
  assert.deepEqual(JSON.parse(b.names), ['مينا', 'مريم', 'يوسف', 'مرقس']);
  assert.deepEqual(JSON.parse(b.participants).map(p => p.cat), ['applicant', 'child', 'infant', 'applicant']);
  assert.equal(categoryForAge(PEOPLE_EVENT.booking.pricing, 12).key, 'child');
  assert.equal(categoryForAge(PEOPLE_EVENT.booking.pricing, 40).key, 'applicant');
});

test('participants: bad lists refused; per-booking limit and places left enforced', async () => {
  const w = await bookWorld({ event: PEOPLE_EVENT });
  const bad = async participants => (await w.submit({ participants })).body.field;
  assert.equal(await bad([]), 'participants');
  assert.equal(await bad([{ name: 'م', age: 20 }]), 'participants', 'a name of 1 letter');
  assert.equal(await bad([{ name: 'مينا', age: 200 }]), 'participants');
  assert.equal(await bad([{ name: 'مينا', age: '20.5' }]), 'participants');
  assert.equal(await bad(Array.from({ length: 5 }, (_, i) => ({ name: 'فرد ' + i, age: 20 }))), 'participants', 'over the per-booking limit (4)');
  assert.equal((await w.db.prepare('SELECT COUNT(*) AS n FROM bookings').first()).n, 0);
  // capacity 5: a 4-person booking confirmed, then a 2-person one is too many at confirm (pending takes nothing)
  const a = await w.submit({ phone: '01011112222', participants: Array.from({ length: 4 }, (_, i) => ({ name: 'فرد ' + i, age: 20 })) });
  assert.equal(a.status, 200);
  const row = await w.db.prepare('SELECT id, version FROM bookings').first();
  const ok = await w.admin('POST', '/v1/admin/book/bookings/' + row.id + '/confirm', { version: row.version, overridePay: true, reason: 'تجربة' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.booking.participants.map(p => p.age), [20, 20, 20, 20]);
  const full = await w.submit({ phone: '01033334444', participants: [{ name: 'مينا', age: 20 }, { name: 'مريم', age: 20 }] });
  assert.equal(full.body.code, 'full');
  assert.equal(full.body.left, 1);
});
