// Batch 3 (docs/PHASE5-PLAN.md P5-5, P5-6): accounts in the admin, points and seasons,
// and bookings linked to accounts (YOUTH-ACCOUNTS-PLAN §18.1, MEMBER-NOTIFICATIONS-PLAN §4.2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, fakeGoogle } from './helpers.mjs';
import { bookWorld, eventJson, pay } from './book-helpers.mjs';
import { rowFromJson, saveRow } from '../src/book/event.js';
import { msStamp } from '../src/book/model.js';
import { setGmailFetch } from '../src/notify/gmail.js';
import { memberLease, memberSend } from '../src/notify/member.js';
import { bookingReminders } from '../src/book/account.js';
import { typeOf } from '../src/notify/catalog.js';
import { bookingEmail, pointsEmail } from '../src/notify/templates.js';
import { passwordDecrypt } from '../src/account/secret.js';

const KEYS = { PW_PEPPER: 'pepper-test', PW_KEY: Buffer.alloc(32, 7).toString('base64'), OTP_PEPPER: 'otp-test', ACCOUNT_PAD_MS: '0' };
const P = 'p@example.com', A = 'a@example.com';
const DAY = 24 * 3600 * 1000;
let serial = 100;

async function world({ enforce = '1' } = {}) {
  const g = await fakeGoogle();
  const h = harness({ env: { ENVIRONMENT: 'staging', ADMIN_EMAILS: '', ...KEYS } });
  await h.db.prepare(`INSERT INTO admins (email, name, role, active, created_at) VALUES ('${P}', 'P', 'primary', 1, 0), ('${A}', 'A', 'admin', 1, 0)`).run();
  await h.db.prepare("UPDATE settings SET value = ? WHERE key = 'PERMS_ENFORCE'").bind(enforce).run();
  await h.db.prepare("UPDATE settings SET value = 'on' WHERE key = 'accounts_mode'").run();
  const call = async (email, method, path, body) => h.call(path, { method, body, headers: { authorization: 'Bearer ' + await g.sign(g.claims({ email, sub: 'sub-' + email })) }, fetch: g.fetch });
  const grant = (...perms) => Promise.all(perms.map(perm => h.db.prepare("INSERT OR REPLACE INTO admin_grants (email, perm, scope, granted_by, granted_at) VALUES (?, ?, 'all', ?, 0)").bind(A, perm, P).run()));
  return { h, call, grant };
}
const person = (over = {}) => {
  serial++;
  const email = over.email || `u${serial}@example.com`;
  return { name: 'مينا زكريا فؤاد', email, emailConfirm: email, checkMethod: 'in_person_readback', phone: '0100' + String(1000000 + serial), birthDate: '2000-03-12', ...over };
};
async function created(w, over) {
  const f = person(over);
  const r = await w.call(P, 'POST', '/v1/admin/participants', f);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { ...f, id: r.body.id, password: r.body.password };
}
const sheet = (w, id) => w.call(P, 'GET', '/v1/admin/participants/' + id);
const post = (w, id, what, body, who = P) => w.call(who, 'POST', `/v1/admin/participants/${id}/${what}`, body);
const signin = (h, a, password = a.password) => h.call('/v1/account/signin', { method: 'POST', body: { email: a.email, password } });
const outbox = h => h.db.prepare('SELECT * FROM member_outbox ORDER BY created_ms, id').all().then(r => r.results);

/* ---------- admin create (§6.5) ---------- */

test('create without OTP: active, administratively verified; a notice row, an audit with the method; the password once', async () => {
  const w = await world();
  const a = await created(w);
  assert.match(a.password, /^[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}$/);
  const p = await w.h.db.prepare('SELECT * FROM participants WHERE id = ?').bind(a.id).first();
  assert.equal(p.status, 'active');
  assert.equal(p.email_source, 'admin');
  assert.equal(p.email_verified_via, 'admin');
  assert.ok(p.email_verified_at);
  assert.equal(p.created_via, 'admin');
  assert.equal(p.pw_issued_by, P);
  assert.equal(await passwordDecrypt(KEYS, a.id, 1, p.pw_enc), a.password);
  const rows = await outbox(w.h);
  assert.deepEqual(rows.map(r => r.kind), ['acct.new']);
  const audit = await w.h.db.prepare("SELECT * FROM participant_audit WHERE action = 'register.admin'").first();
  assert.equal(audit.check_method, 'in_person_readback');
  assert.equal((await signin(w.h, a)).status, 200, 'signs in like anyone');
});

test('create: the email typed twice, a method, valid fields, no duplicates; the field is named', async () => {
  const w = await world();
  const bad = [[{ emailConfirm: 'other@example.com' }, 'emailConfirm'], [{ checkMethod: '' }, 'checkMethod'], [{ email: 'x@mailinator.com', emailConfirm: 'x@mailinator.com' }, 'email'], [{ phone: '0212345678' }, 'phone'], [{ name: 'مينا زكريا' }, 'name'], [{ birthDate: '2030-01-01' }, 'birthDate']];
  for (const [over, field] of bad) {
    const r = await w.call(P, 'POST', '/v1/admin/participants', person(over));
    assert.equal(r.status, 400, field);
    assert.equal(r.body.field, field);
  }
  const a = await created(w);
  const e = await w.call(P, 'POST', '/v1/admin/participants', person({ email: a.email.toUpperCase(), emailConfirm: a.email.toUpperCase() }));
  assert.equal(e.body.code, 'dup_email');
  assert.equal(e.body.field, 'email');
  const ph = await w.call(P, 'POST', '/v1/admin/participants', person({ phone: a.phone }));
  assert.equal(ph.body.code, 'dup_phone');
});

/* ---------- the grant split (§12.2) ---------- */

test('each action refused without its grant', async () => {
  const w = await world();
  const a = await created(w);
  const denied = async (method, path, body) => assert.equal((await w.call(A, method, path, body)).status, 403, path);
  await denied('GET', '/v1/admin/participants');
  await denied('POST', '/v1/admin/participants', person());
  await w.grant('participants.view');
  assert.equal((await w.call(A, 'GET', '/v1/admin/participants')).status, 200);
  assert.equal((await w.call(A, 'GET', '/v1/admin/participants/' + a.id)).status, 200);
  await denied('POST', `/v1/admin/participants/${a.id}/profile`, { group: 'x' });
  await denied('POST', `/v1/admin/participants/${a.id}/block`, { reason: 'سبب' });
  for (const what of ['email', 'phone', 'dob', 'eligibility', 'reset-password', 'unblock', 'sessions/revoke']) await denied('POST', `/v1/admin/participants/${a.id}/${what}`, { reason: 'سبب' });
  await w.grant('participants.edit');
  assert.equal((await post(w, a.id, 'profile', { group: 'الشباب' }, A)).status, 200);
  assert.equal((await post(w, a.id, 'block', { reason: 'سبب واضح' }, A)).status, 200, 'emergency block: edit or higher');
  await denied('POST', `/v1/admin/participants/${a.id}/unblock`, { reason: 'سبب' });
});

/* ---------- viewing vs resetting (§12.3) ---------- */

test('view password: Primary only, unlimited, changes nothing, every view logged', async () => {
  const w = await world();
  const a = await created(w);
  const token = (await signin(w.h, a)).body.session.token;
  await w.grant('participants.view', 'participants.manage', 'participants.edit', 'participants.add');
  const other = await post(w, a.id, 'view-password', {}, A);
  assert.equal(other.status, 403, 'even with every participants grant');
  for (let i = 0; i < 12; i++) {
    const r = await post(w, a.id, 'view-password', {});
    assert.equal(r.status, 200);
    assert.equal(r.body.password, a.password);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  }
  const p = await w.h.db.prepare('SELECT pw_version FROM participants WHERE id = ?').bind(a.id).first();
  assert.equal(p.pw_version, 1);
  assert.equal((await w.h.call('/v1/account/me', { headers: { authorization: 'Bearer ' + token } })).status, 200, 'sessions untouched');
  assert.equal((await w.h.db.prepare("SELECT COUNT(*) AS n FROM participant_audit WHERE action = 'password.view'").first()).n, 12);
  const act = await w.h.db.prepare("SELECT * FROM activity WHERE action = 'password.view' LIMIT 1").first();
  assert.ok(!JSON.stringify(act).includes(a.password));
});

test('reset: a new password, sessions gone, a notice and never the password; support needs a check method', async () => {
  const w = await world();
  const a = await created(w);
  const token = (await signin(w.h, a)).body.session.token;
  assert.equal((await post(w, a.id, 'reset-password', {})).body.field, 'reason');
  assert.equal((await post(w, a.id, 'reset-password', { reason: 'نسي', support: true })).body.field, 'checkMethod');
  const r = await post(w, a.id, 'reset-password', { reason: 'نسي الباسورد', support: true, checkMethod: 'details_match' });
  assert.equal(r.status, 200);
  assert.notEqual(r.body.password, a.password);
  assert.equal((await signin(w.h, a)).body.code, 'password');
  assert.equal((await w.h.call('/v1/account/me', { headers: { authorization: 'Bearer ' + token } })).status, 401);
  assert.equal((await signin(w.h, a, r.body.password)).status, 200);
  const rows = await outbox(w.h);
  const notice = rows.find(x => x.kind === 'acct.pw');
  assert.equal(notice.entity_version, 2);
  assert.ok(!JSON.stringify(rows).includes(r.body.password));
  const audit = await w.h.db.prepare("SELECT * FROM participant_audit WHERE action = 'password.reset.support'").first();
  assert.equal(audit.check_method, 'details_match');
  assert.equal((await w.h.db.prepare("SELECT severity FROM activity WHERE action = 'participant.reset'").first()).severity, 'critical');
});

/* ---------- corrections ---------- */

test('email change: verified by admin, sessions end, both addresses told, 7 days apart unless the Primary overrides', async () => {
  const w = await world();
  const a = await created(w);
  await w.grant('participants.view', 'participants.manage');
  const token = (await signin(w.h, a)).body.session.token;
  const next = () => { const email = `n${++serial}@example.com`; return { email, emailConfirm: email, checkMethod: 'member_typed', reason: 'الإيميل القديم ضاع' }; };
  const body = next();
  assert.equal((await post(w, a.id, 'email', { ...body, reason: '' }, A)).body.field, 'reason');
  const r = await post(w, a.id, 'email', body, A);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.person.email, body.email);
  assert.equal(r.body.person.emailChangedRecently, true);
  assert.equal((await w.h.call('/v1/account/me', { headers: { authorization: 'Bearer ' + token } })).status, 401);
  const rows = await outbox(w.h);
  const old = rows.find(x => x.kind === 'acct.email');
  assert.equal(old.to_email, a.email, 'the old address, kept only until sent');
  assert.equal(rows.filter(x => x.kind === 'acct.new').length, 2);
  const again = await post(w, a.id, 'email', next(), A);
  assert.equal(again.body.code, 'recent');
  assert.equal((await post(w, a.id, 'email', { ...next(), override: true }, A)).body.code, 'recent', 'only the Primary overrides');
  assert.equal((await post(w, a.id, 'email', { ...next(), override: true })).status, 200);
  const audit = (await w.h.db.prepare("SELECT old_value, new_value, check_method FROM participant_audit WHERE action = 'email.change' ORDER BY at").all()).results[0];
  assert.deepEqual([audit.old_value, audit.new_value, audit.check_method], [a.email, body.email, 'member_typed']);
  const acts = JSON.stringify((await w.h.db.prepare("SELECT * FROM activity WHERE action = 'participant.email'").all()).results);
  assert.ok(!acts.includes(a.email) && !acts.includes(body.email), 'no member address in the activity row');
});

test('phone, DOB, eligibility: reason, audit old → new, the next request sees it', async () => {
  const w = await world();
  const a = await created(w);
  const b = await created(w);
  assert.equal((await post(w, a.id, 'phone', { phone: b.phone, reason: 'رقم جديد' })).body.code, 'dup_phone');
  assert.equal((await post(w, a.id, 'phone', { phone: '01099990000', reason: 'رقم جديد' })).body.person.phone, '01099990000');
  assert.equal((await post(w, a.id, 'dob', { birthDate: '1980-01-01' })).body.field, 'reason');
  const dob = await post(w, a.id, 'dob', { birthDate: '1980-01-01', reason: 'اتكتب غلط' });
  assert.equal(dob.body.person.eligibility.state, 'guest');
  const forced = await post(w, a.id, 'eligibility', { override: 'eligible', reason: 'قرار الخدمة' });
  assert.equal(forced.body.person.eligibility.state, 'eligible');
  assert.equal(forced.body.person.eligibility.source, 'override');
  assert.equal((await post(w, a.id, 'eligibility', { override: 'auto', reason: 'رجوع' })).body.person.eligibility.state, 'guest');
  const audit = (await w.h.db.prepare("SELECT old_value, new_value FROM participant_audit WHERE action = 'dob.correct'").all()).results[0];
  assert.deepEqual([audit.old_value, audit.new_value], ['2000-03-12', '1980-01-01']);
  assert.equal((await w.h.db.prepare("SELECT severity FROM activity WHERE action = 'participant.dob'").first()).severity, 'critical');
});

test('block ends sessions and sign-in; unblock restores it', async () => {
  const w = await world();
  const a = await created(w);
  const token = (await signin(w.h, a)).body.session.token;
  assert.equal((await post(w, a.id, 'block', {})).body.field, 'reason');
  await post(w, a.id, 'block', { reason: 'حساب مكرر' });
  assert.equal((await w.h.call('/v1/account/me', { headers: { authorization: 'Bearer ' + token } })).status, 401);
  assert.equal((await signin(w.h, a)).body.code, 'blocked');
  await post(w, a.id, 'unblock', { reason: 'اتحلت' });
  assert.equal((await signin(w.h, a)).status, 200);
});

test('a name change needs a reason; other profile fields do not; notes are never public', async () => {
  const w = await world();
  const a = await created(w);
  assert.equal((await post(w, a.id, 'profile', { name: 'مينا زكريا جرجس' })).body.field, 'reason');
  assert.equal((await post(w, a.id, 'profile', { name: 'مينا زكريا جرجس', reason: 'تصحيح' })).body.person.name, 'مينا زكريا جرجس');
  assert.equal((await post(w, a.id, 'profile', { group: 'أولى جامعة', notes: 'خاص' })).body.person.notes, 'خاص');
  const me = await signin(w.h, a);
  assert.ok(!JSON.stringify(me.body).includes('خاص'));
});

test('first recovery on an admin-entered email: the notice, a critical alert, then it counts as proven', async () => {
  const w = await world();
  const a = await created(w, { email: 'rec@staging.invalid', emailConfirm: 'rec@staging.invalid' });
  const asked = await w.h.call('/v1/account/forgot', { method: 'POST', body: { email: a.email } });
  assert.ok(asked.body.testCode, 'admin-verified emails can recover themselves');
  const done = await w.h.call('/v1/account/forgot/verify', { method: 'POST', body: { email: a.email, code: asked.body.testCode } });
  assert.equal(done.status, 200);
  const p = await w.h.db.prepare('SELECT email_verified_via FROM participants WHERE id = ?').bind(a.id).first();
  assert.equal(p.email_verified_via, 'otp');
  assert.equal((await outbox(w.h)).filter(r => r.kind === 'acct.rec1').length, 1);
  const alert = await w.h.db.prepare("SELECT * FROM activity WHERE action = 'account.recovery.first'").first();
  assert.equal(alert.severity, 'critical');
  assert.equal(typeOf(alert).level, 'critical');
  const again = await w.h.call('/v1/account/forgot', { method: 'POST', body: { email: a.email } });
  await w.h.db.prepare("UPDATE otp_codes SET created_at = 0").run();
  const second = again.body.testCode ? again : await w.h.call('/v1/account/forgot', { method: 'POST', body: { email: a.email } });
  await w.h.call('/v1/account/forgot/verify', { method: 'POST', body: { email: a.email, code: second.body.testCode } });
  assert.equal((await outbox(w.h)).filter(r => r.kind === 'acct.rec1').length, 1, 'once');
});

test('resend: Tier 1 only, once a day, never a code', async () => {
  const w = await world();
  const a = await created(w);
  await w.h.db.prepare("INSERT INTO member_outbox (id, participant_id, kind, tier, class, dedupe_key, status, created_ms) VALUES ('mo-t1aaaa', ?, 'book.confirmed', 1, 'member_tx', 'k1', 'sent', 1), ('mo-otpaaa', ?, 'otp_recover', 0, 'otp', 'k2', 'sent', 1)").bind(a.id, a.id).run();
  assert.equal((await post(w, a.id, 'resend', { outboxId: 'mo-otpaaa' })).status, 400);
  const notice = (await outbox(w.h)).find(r => r.kind === 'acct.new');
  assert.equal((await post(w, a.id, 'resend', { outboxId: notice.id })).status, 400, 'Tier 0');
  assert.equal((await post(w, a.id, 'resend', { outboxId: 'mo-t1aaaa' })).status, 200);
  assert.equal((await post(w, a.id, 'resend', { outboxId: 'mo-t1aaaa' })).body.code, 'recent');
});

test('list + search by name, email, any phone format; the review list flags; export has no credential', async () => {
  const w = await world();
  const a = await created(w, { name: 'بولس ماهر فايز', phone: '01033334444' });
  const b = await created(w, { name: 'بولس ماهر فايز' });
  await created(w, { name: 'سارة عادل نبيل', birthDate: '1980-01-01' });
  const find = async q => (await w.call(P, 'GET', '/v1/admin/participants?q=' + encodeURIComponent(q))).body.people.map(p => p.id);
  assert.deepEqual((await find('بولس')).sort(), [a.id, b.id].sort());
  assert.deepEqual(await find(a.email), [a.id]);
  assert.deepEqual(await find('+201033334444'), [a.id]);
  assert.equal((await w.call(P, 'GET', '/v1/admin/participants?state=guest')).body.people.length, 1);
  const list = await w.call(P, 'GET', '/v1/admin/participants');
  assert.ok(!JSON.stringify(list.body).includes('pw_'));
  assert.equal(list.body.can.viewPassword, true);

  const s = form => w.h.call('/v1/account/register/start', { method: 'POST', body: form });
  const f = { email: 'self@staging.invalid', phone: '01077778888', name: 'بولس ماهر فايز', birthDate: '2000-03-12' };
  const st = await s(f);
  await w.h.call('/v1/account/register/verify', { method: 'POST', body: { pendingId: st.body.pendingId, code: st.body.testCode } });
  const review = await w.call(P, 'GET', '/v1/admin/participants/review');
  assert.equal(review.body.people.length, 1, 'self-registered only');
  assert.ok(review.body.people[0].flags.includes('same_name_dob'));

  const exp = await w.call(P, 'GET', '/v1/admin/participants/export');
  assert.equal(exp.status, 200);
  assert.ok(exp.body.rows.every(r => !('password' in r) && !('pwHash' in r) && !('pw_enc' in r)));
  assert.ok(!JSON.stringify(exp.body).includes(a.password));
  await w.grant('participants.view');
  assert.equal((await w.call(A, 'GET', '/v1/admin/participants/export')).status, 403, 'needs exports.export_pii too');
});

test('settings: the Admin range drives eligibility; the support contact reaches the page', async () => {
  const w = await world();
  const a = await created(w, { birthDate: '1995-01-01' });
  const before = await sheet(w, a.id);
  assert.equal(before.body.person.eligibility.state, 'guest');
  assert.equal((await w.call(P, 'POST', '/v1/admin/participants/settings', { ageMin: 40, ageMax: 20 })).status, 400);
  const saved = await w.call(P, 'POST', '/v1/admin/participants/settings', { ageMin: 18, ageMax: 32, support: { id: 'c1', name: 'جرجس', phone: '01011112222' } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.support.whatsapp, 'https://wa.me/201011112222');
  assert.equal((await sheet(w, a.id)).body.person.eligibility.state, 'eligible', 'on the next request, no code change');
  const config = await w.h.call('/v1/account/config');
  assert.equal(config.body.support.whatsapp, 'https://wa.me/201011112222');
  assert.equal(config.body.support.name, 'جرجس');
});

/* ---------- points ---------- */

const adjust = (w, id, amount, over = {}) => post(w, id, 'points', { amount, note: 'سبب', key: 'k' + (++serial) + 'xxxxxx', ...over });

test('ledger: append-only, never below zero, same key = same row; a deduction is told, an addition is not', async () => {
  const w = await world();
  const a = await created(w);
  const r = await adjust(w, a.id, 100);
  assert.equal(r.body.balance, 100);
  assert.equal((await outbox(w.h)).filter(x => x.kind === 'pts.deduct').length, 0);
  const low = await adjust(w, a.id, -101);
  assert.equal(low.status, 400);
  assert.match(low.body.message, /بالسالب/);
  assert.equal((await outbox(w.h)).filter(x => x.kind === 'pts.deduct').length, 0, 'no row without the change');
  const again = { amount: -40, note: 'سبب', notePublic: true, key: 'same-key-001' };
  const once = await post(w, a.id, 'points', again);
  const twice = await post(w, a.id, 'points', again);
  assert.equal(once.body.balance, 60);
  assert.equal(twice.body.balance, 60);
  assert.equal(twice.body.replay, true);
  assert.equal((await post(w, a.id, 'points', { ...again, amount: -41 })).status, 409, 'the key means one thing');
  assert.equal((await outbox(w.h)).filter(x => x.kind === 'pts.deduct').length, 1);
  for (const amount of [0, 1.5, 2000000, 'x']) assert.equal((await adjust(w, a.id, amount)).status, 400, String(amount));
  assert.equal((await adjust(w, a.id, 5, { note: '' })).body.field, 'note');
});

test('member view: balance, public notes only; frozen when out of range, spendable again when back', async () => {
  const w = await world();
  const a = await created(w);
  await adjust(w, a.id, 50, { note: 'ملاحظة خاصة' });
  await adjust(w, a.id, 20, { note: 'جايزة حفظ', notePublic: true });
  const token = (await signin(w.h, a)).body.session.token;
  const see = () => w.h.call('/v1/account/points', { headers: { authorization: 'Bearer ' + token } });
  const r = await see();
  assert.equal(r.body.balance, 70);
  assert.equal(r.body.frozen, false);
  assert.deepEqual(r.body.ledger.map(l => l.note).sort((x, y) => String(x).localeCompare(String(y))), ['جايزة حفظ', null].sort((x, y) => String(x).localeCompare(String(y))));
  assert.ok(!JSON.stringify(r.body).includes('خاصة'));
  assert.ok(!JSON.stringify(r.body).includes(P), 'never who did it');
  assert.equal((await w.h.call('/v1/account/points')).status, 401);

  await post(w, a.id, 'eligibility', { override: 'guest', reason: 'اختبار' });
  const frozen = await see();
  assert.deepEqual([frozen.body.frozen, frozen.body.eligible, frozen.body.balance], [true, false, 70]);
  assert.equal((await w.h.db.prepare('SELECT COUNT(*) AS n FROM points_ledger WHERE participant_id = ?').bind(a.id).first()).n, 2, 'freezing writes nothing');
  await post(w, a.id, 'eligibility', { override: 'auto', reason: 'رجوع' });
  assert.equal((await see()).body.frozen, false);
});

test('transfer between duplicates: both rows or neither; audited; not more than there is', async () => {
  const w = await world();
  const a = await created(w);
  const b = await created(w);
  await adjust(w, a.id, 30);
  const move = over => post(w, a.id, 'transfer', { to: b.id, amount: 20, note: 'حساب مكرر', key: 'transfer-001', ...over });
  assert.equal((await move({ amount: 31, key: 'transfer-big' })).status, 400);
  assert.equal((await move()).body.balance, 10);
  assert.equal((await move()).body.replay, true);
  const bal = id => w.h.db.prepare('SELECT SUM(amount) AS n FROM points_ledger WHERE participant_id = ?').bind(id).first('n');
  assert.deepEqual([await bal(a.id), await bal(b.id)], [10, 20]);
  await w.grant('points.edit');
  assert.equal((await w.call(A, 'POST', `/v1/admin/participants/${a.id}/transfer`, { to: b.id, amount: 1, note: 'x', key: 'transfer-002' })).status, 403, 'points.approve');
});

test('season close: totals frozen, the next starts at 0; a moved number refuses; the old season stays readable', async () => {
  const w = await world();
  const a = await created(w);
  const g = await created(w, { birthDate: '1980-01-01' });
  await adjust(w, a.id, 70);
  await adjust(w, g.id, 40);
  const seasons = (await w.call(P, 'GET', '/v1/admin/points/seasons')).body.seasons;
  assert.equal(seasons[0].id, 'sea-first');
  const preview = await w.call(P, 'GET', '/v1/admin/points/seasons/sea-first/preview');
  assert.deepEqual([preview.body.participants, preview.body.total], [2, 110]);
  assert.deepEqual(preview.body.frozen, { participants: 1, total: 40 }, 'frozen balances shown apart');
  await adjust(w, a.id, 1);
  const stale = await w.call(P, 'POST', '/v1/admin/points/seasons/sea-first/close', { key: preview.body.key, next: { name: 'الموسم التاني' } });
  assert.equal(stale.body.code, 'stale');
  const fresh = (await w.call(P, 'GET', '/v1/admin/points/seasons/sea-first/preview')).body.key;
  assert.equal((await w.call(P, 'POST', '/v1/admin/points/seasons/sea-first/close', { key: fresh, next: { name: '' } })).status, 400);
  const closed = await w.call(P, 'POST', '/v1/admin/points/seasons/sea-first/close', { key: fresh, next: { name: 'الموسم التاني' } });
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  assert.equal(closed.body.participants, 2);
  const s = await sheet(w, a.id);
  assert.equal(s.body.points.balance, 0);
  assert.equal(s.body.points.season.name, 'الموسم التاني');
  assert.equal(s.body.points.seasons[0].final, 71);
  assert.equal((await w.call(P, 'POST', '/v1/admin/points/seasons/sea-first/close', { key: fresh, next: { name: 'x y' } })).body.code, 'final');
  assert.equal((await w.h.db.prepare("SELECT COUNT(*) AS n FROM seasons WHERE status = 'active'").first()).n, 1);
});

/* ---------- bookings and accounts (§18.1) ---------- */

async function bookingWorld({ event = eventJson({}, { bookerAge: { min: 18, max: 30 } }), accounts = 'on' } = {}) {
  const w = await bookWorld({ event, env: { ENVIRONMENT: 'staging', ...KEYS } });
  await w.h?.db;
  await w.db.prepare("UPDATE settings SET value = ? WHERE key = 'accounts_mode'").bind(accounts).run();
  return w;
}
async function member(w, birthDate = '2000-03-12') {
  const f = { email: `b${++serial}@staging.invalid`, phone: '0120' + String(1000000 + serial), name: 'مينا زكريا فؤاد', birthDate };
  const s = await w.call('/v1/account/register/start', { method: 'POST', body: f });
  const d = await w.call('/v1/account/register/verify', { method: 'POST', body: { pendingId: s.body.pendingId, code: s.body.testCode } });
  const si = await w.call('/v1/account/signin', { method: 'POST', body: { email: f.email, password: d.body.password } });
  return { ...f, password: d.body.password, token: si.body.session.token, id: si.body.account.id };
}
const bookAs = (w, token, over = {}) => w.call('/v1/book/submit', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'cf-connecting-ip': '198.51.100.8' }, body: { slug: 'alex-trip', requestKey: w.key('rq'), name: 'مينا زكريا', phone: '01012345678', counts: { applicant: 1 }, servantId: 'srv-aaaa1111', method: 'transfer', hp: '', revision: 'rev1', ...over } });

test('accounts off: bookings behave exactly as before, whatever the event says', async () => {
  const w = await bookingWorld({ accounts: 'off' });
  const state = await w.pub('GET', '/v1/book/state?slug=alex-trip');
  assert.deepEqual(state.body.account, { on: false, required: false });
  const r = await w.submit({ bookerDob: '2000-01-01', counts: { applicant: 1 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const b = await w.db.prepare('SELECT age_source, participant_id FROM bookings').first();
  assert.deepEqual([b.age_source, b.participant_id], ['self', null]);
  assert.equal((await outbox(w)).length, 0);
});

test('a ranged event needs an account by default; signed out is refused, self-declaring doesn\'t help', async () => {
  const w = await bookingWorld();
  assert.deepEqual((await w.pub('GET', '/v1/book/state?slug=alex-trip')).body.account, { on: true, required: true });
  const r = await w.submit({ bookerDob: '2000-01-01', counts: { applicant: 1 } });
  assert.equal(r.status, 401);
  assert.equal(r.body.code, 'account_required');
  assert.equal((await w.db.prepare('SELECT COUNT(*) AS n FROM bookings').first()).n, 0);
});

test('the event can open itself, or demand an account without a range', async () => {
  const open = await bookingWorld({ event: eventJson({}, { bookerAge: { min: 18, max: 30 }, requireAccount: false }) });
  assert.equal((await open.pub('GET', '/v1/book/state?slug=alex-trip')).body.account.required, false);
  assert.equal((await open.submit({ bookerDob: '2000-01-01', counts: { applicant: 1 } })).status, 200);
  const closed = await bookingWorld({ event: eventJson({}, { requireAccount: true }) });
  assert.equal((await closed.submit({ counts: { applicant: 1 } })).body.code, 'account_required');
  const plain = await bookingWorld({ event: eventJson() });
  assert.equal((await plain.submit({ counts: { applicant: 1 } })).status, 200, 'no range: open to everyone, as today');
});

test('signed-in booker: the DOB is the account\'s, a client one is ignored; snapshot, link, receipt row', async () => {
  const w = await bookingWorld();
  const old = await member(w, '1980-01-01');
  const out = await bookAs(w, old.token, { bookerDob: '2000-01-01' });
  assert.equal(out.status, 400, 'a client-sent DOB can not rescue it');
  assert.equal(out.body.code, 'age');
  const a = await member(w);
  const ok = await bookAs(w, a.token, { bookerDob: '1950-01-01' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const b = await w.db.prepare('SELECT * FROM bookings').first();
  assert.equal(b.participant_id, a.id);
  assert.equal(b.age_source, 'account');
  assert.equal(b.booker_dob, '2000-03-12');
  assert.ok(JSON.parse(b.age_rule).bookerAge);
  const rows = await outbox(w);
  assert.equal(rows.filter(r => r.kind === 'book.received').length, 1);
});

test('a dead session is refused, never treated as a stranger', async () => {
  const w = await bookingWorld({ event: eventJson() });
  const a = await member(w);
  await w.call('/v1/account/logout', { method: 'POST', body: {}, headers: { authorization: 'Bearer ' + a.token } });
  assert.equal((await bookAs(w, a.token)).body.code, 'session');
});

test('an admin DOB correction changes the next booking only; the confirm screen warns about the old one', async () => {
  const w = await bookingWorld();
  const a = await member(w);
  const made = await bookAs(w, a.token);
  assert.equal(made.status, 200);
  const before = await w.db.prepare('SELECT id, booker_age, booker_dob FROM bookings').first();
  await w.db.prepare("UPDATE participants SET birth_date = '1980-01-01' WHERE id = ?").bind(a.id).run();
  const after = await w.db.prepare('SELECT booker_age, booker_dob FROM bookings').first();
  assert.deepEqual([after.booker_age, after.booker_dob], [before.booker_age, before.booker_dob], 'the snapshot stays');
  assert.equal((await bookAs(w, a.token)).body.code, 'age', 'read live from the account');
  const shown = await w.admin('GET', '/v1/admin/book/bookings/' + before.id);
  assert.equal(shown.body.booking.age.dobChanged, true);
  assert.equal(shown.body.booking.participantId, a.id);
});

test('linking an older booking: by its status link or an admin, never by phone; different DOBs flag it', async () => {
  const w = await bookingWorld({ event: eventJson({}, { bookerAge: { min: 18, max: 30 }, requireAccount: false }) });
  const made = await w.submit({ bookerDob: '1999-01-01', counts: { applicant: 1 } });
  const a = await member(w);
  assert.equal((await w.db.prepare('SELECT participant_id FROM bookings').first()).participant_id, null, 'the same phone links nothing');
  const link = () => w.call('/v1/account/bookings/link', { method: 'POST', headers: { authorization: 'Bearer ' + a.token }, body: { token: made.body.token } });
  const r = await link();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.linked, true);
  assert.equal((await link()).body.already, true);
  const b = await w.db.prepare('SELECT participant_id, dob_mismatch, age_source, booker_dob FROM bookings').first();
  assert.deepEqual([b.participant_id, b.dob_mismatch, b.age_source, b.booker_dob], [a.id, 1, 'self', '1999-01-01']);
  const other = await member(w);
  assert.equal((await w.call('/v1/account/bookings/link', { method: 'POST', headers: { authorization: 'Bearer ' + other.token }, body: { token: made.body.token } })).body.code, 'final');
  const mine = await w.call('/v1/account/bookings', { headers: { authorization: 'Bearer ' + a.token } });
  assert.equal(mine.body.bookings[0].ref, made.body.ref);
  assert.ok(!JSON.stringify(mine.body).includes('token'));
  const id = (await w.db.prepare('SELECT id FROM bookings').first()).id;
  assert.equal((await w.admin('POST', `/v1/admin/book/bookings/${id}/link`, { participantId: null })).status, 200);
  assert.equal((await w.call('/v1/account/bookings', { headers: { authorization: 'Bearer ' + a.token } })).body.bookings.length, 0);
});

/* ---------- booking and payment email (§4.2) ---------- */

function gmail(t) {
  const mails = [];
  setGmailFetch(async (url, init) => {
    if (/token/.test(String(url))) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }));
    const raw = Buffer.from(JSON.parse(init.body).raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    mails.push(raw);
    return new Response(JSON.stringify({ id: 'm' }));
  });
  t.after(() => setGmailFetch(null));
  return mails;
}
async function emailWorld(event) {
  const w = await bookWorld({ event: event || eventJson(), env: { ENVIRONMENT: 'staging', ...KEYS, GMAIL_CLIENT_ID: 'c', GMAIL_CLIENT_SECRET: 's', GMAIL_REFRESH_TOKEN: 'r' } });
  await w.db.prepare("UPDATE settings SET value = 'on' WHERE key = 'accounts_mode'").run();
  await w.db.prepare("UPDATE settings SET value = '1' WHERE key = 'MEMBER_EMAIL'").run();
  return w;
}
async function deliver(w, now = Date.now()) {
  const ids = await memberLease(w.env, now);
  return memberSend(w.env, ids, now);
}
const kinds = async w => (await outbox(w)).map(r => r.kind).filter(k => /^(book|pay)\./.test(k));

test('no account, no email: the same admin steps write nothing', async t => {
  gmail(t);
  const w = await emailWorld();
  await w.submit({ counts: { applicant: 1 } });
  const b = await w.db.prepare('SELECT id, version FROM bookings').first();
  const r = await w.admin('POST', `/v1/admin/book/bookings/${b.id}/confirm`, { version: b.version, payments: [pay({ amount: 1500 })] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(await kinds(w), []);
});

test('each state change: one row, in its own batch; confirm then cancel supersedes the stale email', async t => {
  gmail(t);
  const w = await emailWorld();
  const a = await member(w);
  await bookAs(w, a.token);
  assert.deepEqual(await kinds(w), ['book.received']);
  const b = await w.db.prepare('SELECT id, version FROM bookings').first();
  await w.admin('POST', `/v1/admin/book/bookings/${b.id}/confirm`, { version: b.version, payments: [pay({ amount: 1500 })] });
  assert.deepEqual(await kinds(w), ['book.received', 'book.confirmed']);
  const v = (await w.db.prepare('SELECT version FROM bookings').first()).version;
  await w.admin('POST', `/v1/admin/book/bookings/${b.id}/cancel`, { version: v, reason: 'طلب الحاجز' });
  assert.deepEqual(await kinds(w), ['book.received', 'book.confirmed', 'book.cancelled']);
  const out = await deliver(w);
  assert.equal(out.superseded, 2, 'received and confirmed no longer tell the truth');
  assert.equal(out.sent, 1);
});

test('a lost race writes no email', async t => {
  gmail(t);
  const w = await emailWorld();
  const a = await member(w);
  await bookAs(w, a.token);
  const b = await w.db.prepare('SELECT id, version FROM bookings').first();
  const stale = await w.admin('POST', `/v1/admin/book/bookings/${b.id}/reject`, { version: b.version + 5, reason: 'سبب' });
  assert.equal(stale.status, 409);
  assert.deepEqual(await kinds(w), ['book.received']);
});

test('payments: recorded, voided, due changed, request received and refused; amounts at send time; no secrets', async t => {
  const mails = gmail(t);
  const w = await emailWorld();
  const a = await member(w);
  await w.db.prepare("UPDATE participants SET email = 'real@example.com' WHERE id = ?").bind(a.id).run();
  await bookAs(w, a.token);
  const id = (await w.db.prepare('SELECT id FROM bookings').first()).id;
  const version = async () => (await w.db.prepare('SELECT version FROM bookings').first()).version;
  await w.admin('POST', `/v1/admin/book/bookings/${id}/confirm`, { version: await version(), payments: [pay({ amount: 1500 })], overridePay: true, reason: 'ok ok' });
  const added = await w.admin('POST', `/v1/admin/book/bookings/${id}/update`, { version: await version(), amountDue: 2000, reason: 'تعديل' });
  assert.equal(added.status, 200, JSON.stringify(added.body));
  const p = await w.admin('POST', `/v1/admin/book/bookings/${id}/payments`, pay({ amount: 200 }));
  assert.equal(p.status, 200, JSON.stringify(p.body));
  const payId = p.body.payments.find(x => x.amount === 200).id;
  assert.equal((await w.admin('POST', `/v1/admin/book/payments/${payId}/void`, { reason: 'غلط', idemKey: w.key('vd') })).status, 200);
  assert.deepEqual((await kinds(w)).sort(), ['book.confirmed', 'book.due', 'book.received', 'pay.recorded', 'pay.voided'].sort());
  const out = await deliver(w);
  assert.equal(out.sent, 4, JSON.stringify(out));
  assert.equal(out.superseded, 1, 'the receipt of a booking already confirmed');
  const all = mails.join('\n');
  assert.doesNotMatch(all, /#b\//);
  assert.match(all, /To: real@example\.com/);
});

test('the cancel-all email and «بلّغ الحاجزين»: pending + confirmed with an account only; on the press, not on an edit', async t => {
  gmail(t);
  const w = await emailWorld();
  const a = await member(w);
  await bookAs(w, a.token);
  await w.submit({ counts: { applicant: 1 }, phone: '01099998888' });
  const ev = 'evt-alex01';
  const bad = await w.admin('POST', `/v1/admin/book/events/${ev}/notify`, { changes: [{ field: 'price', to: 'x' }], idemKey: w.key('nt') });
  assert.equal(bad.status, 400);
  const key = w.key('nt');
  const n = await w.admin('POST', `/v1/admin/book/events/${ev}/notify`, { changes: [{ field: 'time', from: '٦ ص', to: '٧ ص' }], idemKey: key });
  assert.equal(n.body.notified, 1, JSON.stringify(n.body));
  await w.admin('POST', `/v1/admin/book/events/${ev}/notify`, { changes: [{ field: 'time', from: '٦ ص', to: '٧ ص' }], idemKey: key });
  assert.equal((await kinds(w)).filter(k => k === 'book.eventChange').length, 1, 'a replay notifies nobody twice');
  assert.equal((await deliver(w)).sent, 2);
  const c = await w.admin('POST', `/v1/admin/book/events/${ev}/cancel-all`, { reason: 'الجو', idemKey: w.key('ca') });
  assert.equal(c.body.cancelled, 2);
  assert.equal((await kinds(w)).filter(k => k === 'book.eventCancelled').length, 1);
});

test('deadline reminders: the event\'s switch, 3 days before and on the day, confirmed with a balance only', async t => {
  gmail(t);
  const now = Date.now();
  const due = msStamp(now + 3 * DAY);
  const ev = eventJson({}, { payment: { mode: 'installments', minFirst: 100, finalDueAt: due }, mailReminders: true });
  const w = await emailWorld(ev);
  const a = await member(w);
  await bookAs(w, a.token);
  const b = await w.db.prepare('SELECT id, version FROM bookings').first();
  const conf = await w.admin('POST', `/v1/admin/book/bookings/${b.id}/confirm`, { version: b.version, payments: [pay({ amount: 500 })] });
  assert.equal(conf.status, 200, JSON.stringify(conf.body));
  assert.equal(await bookingReminders(w.env, now), 1);
  assert.equal(await bookingReminders(w.env, now), 1, 'the dedupe key answers a repeat');
  assert.equal((await kinds(w)).filter(k => k === 'book.reminder').length, 1);
  assert.equal(await bookingReminders(w.env, now + DAY), 0, 'not between the stages');

  await w.db.prepare("INSERT INTO reminders (id, event_id, booking_id, balance, sent_at, sent_ms, sent_by, idem_key) VALUES ('r1', ?, ?, 1, 'x', ?, 'a', 'rk1')").bind('evt-alex01', b.id, now + 3 * DAY - 3600000).run();
  assert.equal(await bookingReminders(w.env, now + 3 * DAY), 0, 'within 20 h of a WhatsApp reminder');

  const off = await emailWorld(eventJson({}, { payment: { mode: 'installments', minFirst: 100, finalDueAt: due } }));
  const m = await member(off);
  await bookAs(off, m.token);
  const c = await off.db.prepare('SELECT id, version FROM bookings').first();
  await off.admin('POST', `/v1/admin/book/bookings/${c.id}/confirm`, { version: c.version, payments: [pay({ amount: 500 })] });
  assert.equal(await bookingReminders(off.env, now), 0, 'off by default');
});

test('templates: the new notices hold what they should and nothing else', () => {
  const base = { name: 'مينا', event: 'رحلة', when: 'الجمعة', ref: 'B-7QK2M', people: 2, total: 1000, paid: 400, due: 'الأربعاء', url: 'https://stathanasiosyouth.github.io/account/#me/bookings/B-7QK2M' };
  for (const status of ['rejected', 'event_cancelled', 'payment_recorded', 'payment_voided', 'due_changed', 'request_received', 'request_rejected', 'event_change']) {
    const m = bookingEmail({ ...base, status, reason: status.includes('reject') ? 'سبب' : '', amount: 200, changes: status === 'event_change' ? [{ field: 'time', from: 'أ', to: 'ب' }] : null, prefs: true });
    assert.doesNotMatch(m.html + m.text, /\/admin|#b\//, status);
    assert.ok(m.subject.includes('B-7QK2M'), status);
  }
  const closed = bookingEmail({ ...base, status: 'rejected' });
  assert.doesNotMatch(closed.text, /الباقي/, 'a closed booking owes nothing');
  const p = pointsEmail({ amount: 20, balance: 5, note: '', url: 'https://stathanasiosyouth.github.io/account/#me/points' });
  assert.match(p.text, /٢٠ نقطة/);
  const custom = pointsEmail({ amount: 1, balance: 1, url: 'https://stathanasiosyouth.github.io/account/#me/points', support: { name: 'جرجس', phone: '01011112222', whatsapp: 'https://wa.me/201011112222' } });
  assert.match(custom.text, /جرجس/);
  assert.match(custom.html, /wa\.me\/201011112222/);
  assert.doesNotMatch(custom.html, /201276162016/);
});

test('saveRow keeps the new event fields through event.json', async () => {
  const h = harness();
  const row = rowFromJson(eventJson({}, { requireAccount: true, mailReminders: true }), 'fixture');
  await saveRow(h.env, row);
  const saved = JSON.parse((await h.db.prepare('SELECT booking FROM event_cfg').first()).booking);
  assert.deepEqual([saved.requireAccount, saved.mailReminders], [true, true]);
  const def = JSON.parse(rowFromJson(eventJson(), 'fixture').booking);
  assert.deepEqual([def.requireAccount, def.mailReminders], [null, false]);
});
