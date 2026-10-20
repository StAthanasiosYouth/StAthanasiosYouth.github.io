// Event age eligibility (Phase 1.5 step 10, BOOKING-PHASE1-COMPLETION-PLAN §4.9):
// the booker's date of birth judged at the event's start, companions against the
// allowed categories, a snapshot on each booking, the admin override, and events
// without a rule behaving exactly as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookWorld, eventJson } from './book-helpers.mjs';
import { ageAt, parseDob, checkBooker, ageRule } from '../src/book/age.js';
import { rowFromJson } from '../src/book/event.js';

const A = 'admin@example.com';
const START = '2026-12-10T08:00';
const AGE_EVENT = eventJson({ startAt: START, endAt: '2026-12-11T20:00' }, {
  bookerAge: { min: 18, max: 30 },
  pricing: { mode: 'group', categories: [
    { key: 'applicant', label: 'الحاجز', group: 'adult', price: 1500, seat: true, min: 1, max: 1, note: '' },
    { key: 'adult', label: 'فرد إضافي', group: 'adult', price: 1500, seat: true, min: 0, max: 5, note: '' },
    { key: 'child', label: 'طفل', group: 'child', price: 800, seat: true, min: 0, max: 5, note: '', ageMin: 4, ageMax: 12, allowed: false }
  ] }
});
const PEOPLE_EVENT = eventJson({ startAt: START, endAt: '2026-12-11T20:00' }, {
  bookerAge: { min: 18, max: 30 }, participants: true, ageStrict: true,
  pricing: { mode: 'group', categories: [
    { key: 'applicant', label: 'فرد', group: 'adult', price: 100, seat: true, min: 0, max: 6, note: '', ageMin: 16, ageMax: 40 },
    { key: 'child', label: 'طفل', group: 'child', price: 50, seat: true, min: 0, max: 6, note: '', ageMin: 4, ageMax: 12 }
  ] }
});

test('age at the event: full years on its start day (Cairo wall date); a birthday that day counts; bad dates refused', () => {
  assert.equal(ageAt(parseDob('2008-12-10'), START), 18, 'the 18th birthday on the trip day');
  assert.equal(ageAt(parseDob('2008-12-11'), START), 17, 'one day short');
  assert.equal(ageAt(parseDob('1996-02-29'), START), 30);
  for (const bad of ['2008-02-30', '08-12-10', '2008/12/10', '', null, '2999-01-01']) assert.equal(parseDob(bad), null, String(bad));
  const b = rowFromJson(AGE_EVENT, 't');
  const booking = JSON.parse(b.booking);
  assert.deepEqual(booking.bookerAge, { min: 18, max: 30 });
  assert.deepEqual(checkBooker(booking, START, '2010-01-01').problem.message, 'الفعالية دي للسن من ١٨ لـ ٣٠ سنة.');
  assert.equal(checkBooker(booking, START, '1990-01-01').problem.field, 'bookerDob');
  assert.equal(checkBooker(booking, START, '2025-01-01').problem.message, 'اكتب تاريخ ميلادك صح.', 'under 5: not a real booker');
  assert.deepEqual(checkBooker(booking, START, '2000-06-01'), { dob: '2000-06-01', age: 26 });
});

test('backward compatible: an event without age fields keeps today\'s behaviour (no DOB asked, nothing stored)', async () => {
  const w = await bookWorld();
  const booking = JSON.parse(rowFromJson(eventJson(), 't').booking);
  assert.equal(booking.bookerAge, null);
  assert.equal(booking.ageStrict, false);
  assert.ok(booking.pricing.categories.every(c => c.allowed === true));
  assert.equal(ageRule(booking), null);
  const r = await w.submit({ counts: { applicant: 1, child: 2 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = await w.db.prepare('SELECT booker_dob, booker_age, age_source, age_rule, age_override FROM bookings').first();
  assert.deepEqual({ ...row }, { booker_dob: null, booker_age: null, age_source: null, age_rule: null, age_override: null });
});

test('public submit: the booker range by DOB, a switched-off category refused; the snapshot stored; DOB never on the status view', async () => {
  const w = await bookWorld({ event: AGE_EVENT });
  const noDob = await w.submit({ counts: { applicant: 1 } });
  assert.equal(noDob.status, 400);
  assert.deepEqual([noDob.body.code, noDob.body.field, noDob.body.message], ['age', 'bookerDob', 'اكتب تاريخ ميلادك صح.']);
  const young = await w.submit({ counts: { applicant: 1 }, bookerDob: '2010-05-05' });
  assert.deepEqual([young.body.code, young.body.message], ['age', 'الفعالية دي للسن من ١٨ لـ ٣٠ سنة.']);
  const child = await w.submit({ counts: { applicant: 1, child: 1 }, bookerDob: '2000-05-05' });
  assert.deepEqual([child.body.code, child.body.field], ['age', 'counts']);
  assert.equal((await w.db.prepare('SELECT COUNT(*) AS n FROM bookings').first()).n, 0, 'refused bookings never reach the queue');

  const ok = await w.submit({ counts: { applicant: 1, adult: 1 }, bookerDob: '2000-05-05' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const row = await w.db.prepare('SELECT booker_dob, booker_age, age_source, age_rule FROM bookings').first();
  assert.equal(row.booker_dob, '2000-05-05');
  assert.equal(row.booker_age, 26);
  assert.equal(row.age_source, 'self');
  assert.deepEqual(JSON.parse(row.age_rule), { bookerAge: { min: 18, max: 30 }, strict: false, allowed: ['applicant', 'adult'] });
  const status = await w.pub('POST', '/v1/book/status', { token: ok.body.token });
  assert.equal(status.status, 200, JSON.stringify(status.body));
  assert.doesNotMatch(JSON.stringify(status.body), /2000-05-05|bookerDob|booker_dob/, 'the DOB is private');
});

test('participants: the booker is person #1 with the age from the DOB (never the typed one); strict companions', async () => {
  const w = await bookWorld({ event: PEOPLE_EVENT });
  const r = await w.submit({ bookerDob: '2000-05-05', participants: [{ name: 'مينا', age: 99 }, { name: 'مريم', age: 8 }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const b = await w.db.prepare('SELECT participants, booker_age FROM bookings').first();
  assert.deepEqual(JSON.parse(b.participants).map(p => p.age), [26, 8], 'the booker\'s computed age replaces the typed 99');
  const strict = await w.submit({ phone: '01099998888', bookerDob: '2000-05-05', participants: [{ name: 'مينا', age: 20 }, { name: 'جدو', age: 70 }] });
  assert.deepEqual([strict.body.code, strict.body.field, strict.body.message], ['age', 'participants', 'السن ده مش مسموح للمرافقين في الفعالية دي — كلّم الخادم المسؤول.']);
});

test('admin booking: the same check → needs_override; bookings.manage + a reason goes ahead, stored and logged as important', async () => {
  const w = await bookWorld({ event: AGE_EVENT });
  const base = { eventId: 'evt-alex01', name: 'حجز بالتليفون', phone: '01011112222', counts: { applicant: 1, child: 1 }, bookerDob: '2010-01-01' };
  const ask = await w.admin('POST', '/v1/admin/book/bookings', { ...base, requestKey: w.key('adm') });
  assert.equal(ask.body.code, 'needs_override', JSON.stringify(ask.body));
  assert.deepEqual(ask.body.warnings.map(x => x.code), ['age', 'age']);
  const noReason = await w.admin('POST', '/v1/admin/book/bookings', { ...base, requestKey: w.key('adm'), overrideAge: true });
  assert.equal(noReason.body.field, 'ageReason');

  // with grants enforced, an admin without bookings.manage can't override
  await w.db.prepare("INSERT INTO admins (email, name, role, active, created_at) VALUES (?, 'أدمن', 'admin', 1, 0) ON CONFLICT(email) DO NOTHING").bind(A).run();
  await w.db.prepare("UPDATE settings SET value = '1' WHERE key = 'PERMS_ENFORCE'").run();
  for (const p of ['bookings.view', 'bookings.create_cash']) await w.db.prepare("INSERT OR REPLACE INTO admin_grants (email, perm, scope, granted_by, granted_at) VALUES (?, ?, 'all', 't', 0)").bind(A, p).run();
  const denied = await w.admin('POST', '/v1/admin/book/bookings', { ...base, requestKey: w.key('adm'), overrideAge: true, ageReason: 'ابن الخادم' });
  assert.equal(denied.status, 403, JSON.stringify(denied.body));
  await w.db.prepare("INSERT OR REPLACE INTO admin_grants (email, perm, scope, granted_by, granted_at) VALUES (?, 'bookings.manage', 'all', 't', 0)").bind(A).run();
  const ok = await w.admin('POST', '/v1/admin/book/bookings', { ...base, requestKey: w.key('adm'), overrideAge: true, ageReason: 'ابن الخادم' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const row = await w.db.prepare('SELECT booker_dob, booker_age, age_source, age_override FROM bookings').first();
  assert.equal(row.age_source, 'admin');
  assert.equal(row.booker_age, 16);
  assert.equal(JSON.parse(row.age_override).reason, 'ابن الخادم');
  assert.equal(ok.body.booking.age.override.reason, 'ابن الخادم');
  assert.equal(ok.body.booking.age.booker, 16);
  assert.ok(!JSON.stringify(ok.body).includes('2010-01-01'), 'the admin sees the age, not the DOB');
  const log = await w.db.prepare("SELECT severity, summary FROM activity WHERE action = 'booking.ageOverride'").first();
  assert.equal(log.severity, 'important');
  assert.match(log.summary, /ابن الخادم/);
});

test('admin edit of a confirmed booking\'s counts: a switched-off category needs the override; a rule changed later is flagged, never re-judged', async () => {
  const w = await bookWorld({ event: AGE_EVENT });
  const r = await w.submit({ counts: { applicant: 1 }, bookerDob: '2000-05-05' });
  const id = (await w.db.prepare('SELECT id FROM bookings').first()).id;
  let d = await w.admin('POST', '/v1/admin/book/bookings/' + id + '/confirm', { version: 1, overridePay: true, reason: 'تجربة' });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.equal(d.body.booking.age.ruleChanged, false);
  const v = d.body.booking.version;
  const ask = await w.admin('POST', '/v1/admin/book/bookings/' + id + '/update', { version: v, actual: { applicant: 1, child: 1 } });
  assert.equal(ask.body.code, 'needs_override', JSON.stringify(ask.body));
  const ok = await w.admin('POST', '/v1/admin/book/bookings/' + id + '/update', { version: v, actual: { applicant: 1, child: 1 }, overrideAge: true, ageReason: 'طفل الخادم' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.booking.age.override.reason, 'طفل الخادم');
  assert.equal((await w.db.prepare("SELECT COUNT(*) AS n FROM activity WHERE action = 'booking.ageOverride'").first()).n, 1);
  assert.ok(r.body.token);

  // the event's rule changes after the booking: flagged, the booking stays as it is
  const { saveRow } = await import('../src/book/event.js');
  await saveRow(w.env, rowFromJson(eventJson({ startAt: START, endAt: '2026-12-11T20:00', v: 'rev2' }, { bookerAge: { min: 20, max: 25 } }), 't'));
  d = await w.admin('GET', '/v1/admin/book/bookings/' + id);
  assert.equal(d.body.booking.age.ruleChanged, true);
  assert.equal(d.body.booking.status, 'confirmed');
});
