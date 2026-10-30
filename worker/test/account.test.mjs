// Youth accounts, batch 1 (docs/PHASE5-PLAN.md P5-1, P5-2): the rules, the credentials,
// registration, sign-in, sessions and recovery, on real SQLite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers.mjs';
import { canonEmail, phoneParts, checkName, nameParts, checkBirthDate, eligibility, normName, deviceLabel } from '../src/account/model.js';
import { generatePassword, normalizePassword, passwordEncrypt, passwordDecrypt, generateCode, sameHex } from '../src/account/secret.js';
import { setGmailFetch } from '../src/notify/gmail.js';
import { housekeeping } from '../src/scheduled.js';

const KEYS = { PW_PEPPER: 'pepper-test', PW_KEY: Buffer.alloc(32, 7).toString('base64'), OTP_PEPPER: 'otp-test', ACCOUNT_PAD_MS: '0' };

async function world(extra = {}) {
  const h = harness({ env: { ENVIRONMENT: 'staging', ...KEYS, ...extra } });
  await h.db.prepare("UPDATE settings SET value = 'on' WHERE key = 'accounts_mode'").run();
  return h;
}
let serial = 0;
const form = (over = {}) => {
  serial++;
  return { email: `user${serial}@staging.invalid`, phone: '010' + String(10000000 + serial), name: 'مينا زكريا عبد المسيح', birthDate: '2000-03-12', ...over };
};
const post = (h, path, body, headers) => h.call(path, { method: 'POST', body, headers });

async function register(h, over) {
  const f = form(over);
  const start = await post(h, '/v1/account/register/start', f);
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const done = await post(h, '/v1/account/register/verify', { pendingId: start.body.pendingId, code: start.body.testCode });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  return { ...f, password: done.body.password, reply: done.body };
}
const signin = (h, email, password, extra = {}) => post(h, '/v1/account/signin', { email, password, ...extra });
const me = (h, token) => h.call('/v1/account/me', { headers: { authorization: 'Bearer ' + token } });

/* ---------- pure rules ---------- */

test('email canon: gmail dots and tags, googlemail, outlook tags, others lower case', () => {
  assert.equal(canonEmail(' Mi.Na+x@GMAIL.com '), 'mina@gmail.com');
  assert.equal(canonEmail('mina@googlemail.com'), 'mina@gmail.com');
  assert.equal(canonEmail('a.b+x@hotmail.com'), 'a.b@hotmail.com');
  assert.equal(canonEmail('A.b+x@Yahoo.com'), 'a.b+x@yahoo.com');
});

test('phone: every format is one number; landlines and strangers refused', () => {
  const same = ['01012345678', '+201012345678', '00201012345678', '201012345678', '1012345678', '٠١٠١٢٣٤٥٦٧٨', '010-1234 5678'];
  for (const p of same) assert.deepEqual(phoneParts(p), { phone: '01012345678', phoneNorm: '1012345678' }, p);
  for (const p of ['0212345678', '01312345678', '+966501234567', 'abc', '']) assert.equal(phoneParts(p), null, p);
});

test('name: 3 or 4 names, «عبد» joins the next word', () => {
  assert.deepEqual(nameParts('مينا عبد المسيح زكريا'), ['مينا', 'عبد المسيح', 'زكريا']);
  assert.ok(checkName('مينا زكريا فؤاد').name);
  assert.ok(checkName('مينا عبد المسيح').message, 'two names only');
  assert.ok(checkName('واحد اتنين تلاتة اربعة خمسة').message);
  assert.equal(normName('أمينة  ياسر'), 'امينه ياسر');
});

test('birth date: real, not in the future, age 5–100', () => {
  const now = Date.UTC(2026, 9, 30, 12);
  assert.ok(checkBirthDate('2000-02-29', now).birthDate);
  for (const d of ['2001-02-29', '2030-01-01', '2024-01-01', '1900-01-01', 'x']) assert.ok(checkBirthDate(d, now).message, d);
});

test('eligibility follows the current range and its edges; overrides and block win', () => {
  const rules = { min: 18, max: 30, warnDays: 60 };
  const at = (dob, iso) => eligibility({ birth_date: dob, status: 'active' }, rules, Date.parse(iso));
  assert.equal(at('2008-10-30', '2026-10-30T12:00:00Z').state, 'eligible', '18 today');
  assert.equal(at('2008-10-31', '2026-10-30T12:00:00Z').state, 'guest', '17, a day short');
  assert.equal(at('1995-10-31', '2026-10-30T12:00:00Z').state, 'eligible', '30, last day');
  assert.equal(at('1995-10-30', '2026-10-30T12:00:00Z').state, 'guest', '31 today');
  assert.equal(at('1995-11-20', '2026-10-30T12:00:00Z').soon, true);
  assert.equal(at('2000-03-12', '2026-10-30T12:00:00Z').soon, false);
  // the same person under a wider Admin range
  assert.equal(eligibility({ birth_date: '1995-01-01', status: 'active' }, { ...rules, max: 32 }, Date.parse('2026-10-30T12:00:00Z')).state, 'eligible');
  assert.equal(eligibility({ birth_date: '1995-01-01', status: 'active' }, rules, Date.parse('2026-10-30T12:00:00Z')).state, 'guest');
  assert.equal(eligibility({ birth_date: '1995-01-01', status: 'active', eligibility_override: 'eligible' }, rules).state, 'eligible');
  assert.equal(eligibility({ birth_date: '2000-01-01', status: 'active', eligibility_override: 'guest' }, rules).state, 'guest');
  assert.equal(eligibility({ birth_date: '2000-01-01', status: 'blocked' }, rules).state, 'blocked');
});

test('device label: a family, never the raw agent', () => {
  assert.equal(deviceLabel('Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537'), 'Android Chrome');
  assert.equal(deviceLabel('Mozilla/5.0 (iPhone) Version/17 Mobile Safari/604'), 'iPhone Safari');
});

/* ---------- credentials ---------- */

test('password: format, alphabet, forgiving input', () => {
  for (let i = 0; i < 200; i++) assert.match(generatePassword(), /^[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}$/);
  assert.equal(normalizePassword(' k7qm-4rtx 9pha '), 'K7QM4RTX9PHA');
  assert.equal(normalizePassword('k٧qm-٤rtx-٩pha'), 'K7QM4RTX9PHA');
});

test('password copy: decrypts for its row and version only', async () => {
  const stored = await passwordEncrypt(KEYS, 'p-1', 1, 'ABCD-EFGH-JKMN');
  assert.equal(await passwordDecrypt(KEYS, 'p-1', 1, stored), 'ABCD-EFGH-JKMN');
  await assert.rejects(passwordDecrypt(KEYS, 'p-2', 1, stored), 'moved to another row');
  await assert.rejects(passwordDecrypt(KEYS, 'p-1', 2, stored), 'an older version');
});

test('code: 6 digits; compare is exact', () => {
  for (let i = 0; i < 200; i++) assert.match(generateCode(), /^\d{6}$/);
  assert.equal(sameHex('ab', 'ab'), true);
  assert.equal(sameHex('ab', 'ac'), false);
  assert.equal(sameHex('ab', 'abc'), false);
});

/* ---------- the switch ---------- */

test('off by default and without the secrets: every route says so, config too', async () => {
  const off = harness({ env: { ENVIRONMENT: 'staging', ...KEYS } });
  assert.equal((await off.call('/v1/account/config')).body.mode, 'off');
  const r = await post(off, '/v1/account/signin', { email: 'a@staging.invalid' });
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'accounts_off');
  const noKeys = harness({ env: { ENVIRONMENT: 'staging' } });
  await noKeys.db.prepare("UPDATE settings SET value = 'on' WHERE key = 'accounts_mode'").run();
  assert.equal((await noKeys.call('/v1/account/config')).body.mode, 'off');
});

test('the migration leaves everything dormant, including the code email', async () => {
  const h = harness();
  const rows = (await h.db.prepare("SELECT key, value FROM settings WHERE key IN ('accounts_mode', 'OTP_EMAIL', 'MEMBER_EMAIL')").all()).results;
  assert.deepEqual(Object.fromEntries(rows.map(r => [r.key, r.value])), { accounts_mode: 'off', OTP_EMAIL: '0', MEMBER_EMAIL: '0' });
});

/* ---------- registration ---------- */

test('register: no account before the right code; then a verified account and one audit row', async () => {
  const h = await world();
  const f = form();
  const start = await post(h, '/v1/account/register/start', f);
  assert.equal(start.status, 200);
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM participants').first()).n, 0);
  const pending = await h.db.prepare('SELECT * FROM pending_registrations').first();
  assert.ok(!pending.code_hash.includes(start.body.testCode));

  const done = await post(h, '/v1/account/register/verify', { pendingId: start.body.pendingId, code: start.body.testCode });
  assert.equal(done.status, 200);
  assert.match(done.body.password, /^[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}$/);
  assert.equal(done.body.firstName, 'مينا');
  assert.equal(done.body.eligible, true);
  const p = await h.db.prepare('SELECT * FROM participants').first();
  assert.ok(p.email_verified_at);
  assert.equal(p.email_source, 'self');
  assert.equal(p.email_verified_via, 'otp');
  assert.equal(p.created_via, 'self');
  assert.match(p.id, /^p-[a-z2-7]{8}$/);
  assert.equal(await passwordDecrypt(KEYS, p.id, 1, p.pw_enc), done.body.password);
  assert.equal((await h.db.prepare("SELECT COUNT(*) AS n FROM participant_audit WHERE action = 'register'").first()).n, 1);
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM pending_registrations').first()).n, 0);
});

test('register: a guest is a normal account (eligible: false)', async () => {
  const h = await world();
  const a = await register(h, { birthDate: '1980-01-01' });
  assert.equal(a.reply.eligible, false);
  const s = await signin(h, a.email, a.password);
  assert.equal(s.body.account.eligibility.state, 'guest');
});

test('register: validation names the field', async () => {
  const h = await world();
  const cases = [[{ email: 'nope' }, 'email'], [{ email: 'a@mailinator.com' }, 'email'], [{ phone: '0212345678' }, 'phone'], [{ name: 'مينا زكريا' }, 'name'], [{ birthDate: '2030-01-01' }, 'birthDate']];
  for (const [over, field] of cases) {
    const r = await post(h, '/v1/account/register/start', form(over));
    assert.equal(r.status, 400, field);
    assert.equal(r.body.field, field);
  }
  assert.equal((await post(h, '/v1/account/register/start', form({ hp: 'bot' }))).status, 400);
});

test('register: an email or phone in use is refused, in any spelling', async () => {
  const h = await world({});
  const a = await register(h, { email: 'mina.z@staging.invalid', phone: '01011112222' });
  const byPhone = await post(h, '/v1/account/register/start', form({ phone: '+20 101 111 2222' }));
  assert.equal(byPhone.body.code, 'dup_phone');
  assert.match(byPhone.body.message, /مسجّل بالفعل/);
  const byEmail = await post(h, '/v1/account/register/start', form({ email: a.email.toUpperCase() }));
  assert.equal(byEmail.body.code, 'dup_email');
});

test('code: wrong ×5 kills it; the count is told; a new code replaces the old one', async () => {
  const h = await world();
  const start = await post(h, '/v1/account/register/start', form());
  const id = start.body.pendingId;
  const wrong = start.body.testCode === '000000' ? '000001' : '000000';
  for (let left = 4; left >= 1; left--) {
    const r = await post(h, '/v1/account/register/verify', { pendingId: id, code: wrong });
    assert.equal(r.body.code, 'otp_bad');
    assert.equal(r.body.left, left);
  }
  assert.equal((await post(h, '/v1/account/register/verify', { pendingId: id, code: wrong })).body.code, 'otp_dead');
  assert.equal((await post(h, '/v1/account/register/verify', { pendingId: id, code: start.body.testCode })).body.code, 'otp_dead', 'even the right one');
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM participants').first()).n, 0);
});

test('code: Arabic digits work; expiry; 60 s between sends; 5 a day per email', async () => {
  const h = await world();
  const f = form();
  const start = await post(h, '/v1/account/register/start', f);
  const again = await post(h, '/v1/account/register/start', f);
  assert.equal(again.status, 429);
  assert.equal(again.body.code, 'otp_wait');
  assert.ok(again.body.retryAfter > 0 && again.body.retryAfter <= 60);

  const send = async () => {
    await h.db.prepare('UPDATE pending_registrations SET last_sent_at = 0').run();
    return post(h, '/v1/account/register/start', f);
  };
  const r2 = await send();
  assert.equal(r2.body.pendingId, start.body.pendingId, 'the same pending row');
  assert.equal((await post(h, '/v1/account/register/verify', { pendingId: start.body.pendingId, code: start.body.testCode === r2.body.testCode ? '111111' : start.body.testCode })).body.code, 'otp_bad', 'the old code is dead');
  for (let i = 3; i <= 5; i++) assert.equal((await send()).status, 200, 'send ' + i);
  const over = await send();
  assert.equal(over.body.code, 'otp_limit');

  await h.db.prepare('UPDATE pending_registrations SET code_expires_at = 1').run();
  const latest = await h.db.prepare('SELECT id FROM pending_registrations').first();
  assert.equal((await post(h, '/v1/account/register/verify', { pendingId: latest.id, code: '123456' })).body.code, 'otp_expired');

  // a fresh person, the code typed in Arabic digits
  const g = form();
  const s = await post(h, '/v1/account/register/start', g);
  const arabic = s.body.testCode.replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
  assert.equal((await post(h, '/v1/account/register/verify', { pendingId: s.body.pendingId, code: arabic })).status, 200);
});

test('50 parallel registrations with one phone → exactly one account', async () => {
  const h = await world();
  const phone = '01055556666';
  const starts = [];
  for (let i = 0; i < 50; i++) starts.push(await post(h, '/v1/account/register/start', form({ phone }), { 'cf-connecting-ip': '198.51.100.' + i }));
  const results = await Promise.all(starts.map(s => post(h, '/v1/account/register/verify', { pendingId: s.body.pendingId, code: s.body.testCode })));
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.equal(results.filter(r => r.body.code === 'dup_phone').length, 49);
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM participants').first()).n, 1);
});

/* ---------- sign-in ---------- */

test('discovery: exists / missing, and nothing else in the reply', async () => {
  const h = await world();
  const a = await register(h);
  const yes = await post(h, '/v1/account/signin', { email: a.email });
  assert.deepEqual(Object.keys(yes.body).sort(), ['exists', 'ok']);
  assert.equal(yes.body.exists, true);
  assert.equal((await post(h, '/v1/account/signin', { email: 'nobody@staging.invalid' })).body.exists, false);
});

test('sign-in: right, forgiving, wrong, missing, blocked', async () => {
  const h = await world();
  const a = await register(h);
  const ok = await signin(h, a.email, a.password);
  assert.equal(ok.status, 200);
  assert.match(ok.body.session.token, /^as1\./);
  assert.equal(ok.body.session.kind, 'device');
  assert.equal(ok.body.account.firstName, 'مينا');
  const stored = await h.db.prepare('SELECT token_hash FROM account_sessions').first();
  assert.ok(!stored.token_hash.includes(ok.body.session.token));

  assert.equal((await signin(h, a.email.toUpperCase(), a.password.toLowerCase().replace(/-/g, ' '))).status, 200);
  const wrong = await signin(h, a.email, 'AAAA-AAAA-AAAA');
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.code, 'password');
  assert.equal(wrong.body.challenge, false);
  assert.equal((await signin(h, 'nobody@staging.invalid', 'AAAA-AAAA-AAAA')).body.exists, false);

  await h.db.prepare("UPDATE participants SET status = 'blocked'").run();
  assert.equal((await signin(h, a.email, 'AAAA-AAAA-AAAA')).body.code, 'password', 'blocked says so only after the right password');
  assert.equal((await signin(h, a.email, a.password)).body.code, 'blocked');
});

test('wrong passwords: the check after 5, a rest after 10, then only time helps', async () => {
  const h = await world();
  const a = await register(h);
  for (let i = 1; i <= 10; i++) {
    const r = await signin(h, a.email, 'AAAA-AAAA-AAAA');
    assert.equal(r.body.code, 'password', 'try ' + i);
    assert.equal(r.body.challenge, i >= 5, 'try ' + i);
  }
  const rest = await signin(h, a.email, a.password);
  assert.equal(rest.status, 429);
  assert.ok(rest.body.retryAfter > 0);
  await h.db.prepare("DELETE FROM rate_limits WHERE key LIKE 'acct.login.fail%'").run();
  assert.equal((await signin(h, a.email, a.password)).status, 200, 'never a permanent lock');
});

test('discovery budget: 10 per 10 minutes from one address', async () => {
  const h = await world();
  const headers = { 'cf-connecting-ip': '203.0.113.9' };
  const ask = () => post(h, '/v1/account/signin', { email: 'x@staging.invalid' }, headers);
  for (let i = 0; i < 10; i++) assert.equal((await ask()).status, 200);
  assert.equal((await ask()).status, 429);
});

test('uniform timing: existing and missing take the padded time', async () => {
  const h = await world({ ACCOUNT_PAD_MS: '120' });
  const a = await register(h);
  const timed = async email => { const t = Date.now(); await post(h, '/v1/account/signin', { email }); return Date.now() - t; };
  assert.ok(await timed(a.email) >= 110);
  assert.ok(await timed('nobody@staging.invalid') >= 110);
});

/* ---------- sessions ---------- */

test('session: me, logout here, logout everywhere; a shared session is short', async () => {
  const h = await world();
  const a = await register(h);
  const one = (await signin(h, a.email, a.password)).body.session.token;
  const two = (await signin(h, a.email, a.password, { shared: true })).body.session;
  assert.equal(two.kind, 'shared');
  assert.ok(two.expiresAt - Date.now() <= 12 * 3600 * 1000 + 1000);
  const three = (await signin(h, a.email, a.password)).body.session.token;

  const seen = await me(h, one);
  assert.equal(seen.status, 200);
  assert.equal(seen.body.account.email, a.email);
  assert.equal((await me(h, 'as1.' + 'x'.repeat(43))).body.code, 'session');
  assert.equal((await h.call('/v1/account/me')).body.code, 'session');

  assert.equal((await h.call('/v1/account/logout', { method: 'POST', body: {}, headers: { authorization: 'Bearer ' + one } })).status, 200);
  assert.equal((await me(h, one)).status, 401);
  assert.equal((await me(h, three)).status, 200, 'the other device stays');
  await h.call('/v1/account/logout', { method: 'POST', body: { all: true }, headers: { authorization: 'Bearer ' + three } });
  assert.equal((await me(h, three)).status, 401);
  assert.equal((await me(h, two.token)).status, 401);
  assert.equal((await h.call('/v1/account/logout', { method: 'POST', body: {} })).status, 200, 'quiet without a session');
});

test('session: expiry, sliding, and a blocked account', async () => {
  const h = await world();
  const a = await register(h);
  const token = (await signin(h, a.email, a.password)).body.session.token;
  await h.db.prepare('UPDATE account_sessions SET last_seen = 1, expires_at = ?').bind(Date.now() + 1000).run();
  assert.equal((await me(h, token)).status, 200);
  const row = await h.db.prepare('SELECT last_seen, expires_at FROM account_sessions').first();
  assert.ok(row.last_seen > 1 && row.expires_at > Date.now() + 29 * 24 * 3600 * 1000, 'slid forward');
  await h.db.prepare('UPDATE account_sessions SET expires_at = 1').run();
  assert.equal((await me(h, token)).status, 401);
  await h.db.prepare('UPDATE account_sessions SET expires_at = ?').bind(Date.now() + 100000).run();
  await h.db.prepare("UPDATE participants SET status = 'blocked'").run();
  assert.equal((await me(h, token)).status, 401);
});

/* ---------- recovery ---------- */

test('forgot: the old password works until the code is right; then everything rotates', async () => {
  const h = await world();
  const a = await register(h);
  const token = (await signin(h, a.email, a.password)).body.session.token;
  const asked = await post(h, '/v1/account/forgot', { email: a.email });
  assert.equal(asked.status, 200);
  assert.equal((await signin(h, a.email, a.password)).status, 200, 'nothing changed yet');
  const done = await post(h, '/v1/account/forgot/verify', { email: a.email, code: asked.body.testCode });
  assert.equal(done.status, 200);
  assert.notEqual(done.body.password, a.password);
  assert.equal((await signin(h, a.email, a.password)).body.code, 'password');
  assert.equal((await me(h, token)).status, 401, 'every session ended');
  assert.equal((await signin(h, a.email, done.body.password)).status, 200);
  const p = await h.db.prepare('SELECT pw_version, id, pw_enc FROM participants').first();
  assert.equal(p.pw_version, 2);
  assert.equal(await passwordDecrypt(KEYS, p.id, 2, p.pw_enc), done.body.password);
  assert.equal((await h.db.prepare("SELECT COUNT(*) AS n FROM participant_audit WHERE action = 'password.reset.self'").first()).n, 1);
  assert.equal((await post(h, '/v1/account/forgot/verify', { email: a.email, code: asked.body.testCode })).body.code, 'otp_bad', 'one use');
});

test('forgot: neutral for unknown, unverified and blocked; no code, no email row', async () => {
  const h = await world();
  const a = await register(h);
  const b = await register(h);
  await h.db.prepare('UPDATE participants SET email_verified_at = NULL WHERE email = ?').bind(a.email).run();
  await h.db.prepare("UPDATE participants SET status = 'blocked' WHERE email = ?").bind(b.email).run();
  const before = (await h.db.prepare("SELECT COUNT(*) AS n FROM member_outbox WHERE kind = 'otp_recover'").first()).n;
  const replies = [];
  for (const email of ['nobody@staging.invalid', a.email, b.email]) {
    const r = await post(h, '/v1/account/forgot', { email });
    assert.equal(r.status, 200);
    replies.push(JSON.stringify({ ...r.body, requestId: 0 }));
  }
  assert.equal(new Set(replies).size, 1);
  assert.equal((await h.db.prepare("SELECT COUNT(*) AS n FROM member_outbox WHERE kind = 'otp_recover'").first()).n, before);
});

test('forgot/verify: an unknown email looks like a wrong code', async () => {
  const h = await world();
  const a = await register(h);
  await post(h, '/v1/account/forgot', { email: a.email });
  const known = await post(h, '/v1/account/forgot/verify', { email: a.email, code: '000000' });
  const unknown = await post(h, '/v1/account/forgot/verify', { email: 'nobody@staging.invalid', code: '000000' });
  assert.equal(known.body.code, 'otp_bad');
  assert.equal(unknown.body.code, 'otp_bad');
  assert.equal(known.body.left, unknown.body.left);
  // a wrong-code streak ends the code for both
  for (let i = 0; i < 4; i++) {
    await post(h, '/v1/account/forgot/verify', { email: a.email, code: '000000' });
    await post(h, '/v1/account/forgot/verify', { email: 'nobody@staging.invalid', code: '000000' });
  }
  assert.equal((await post(h, '/v1/account/forgot/verify', { email: a.email, code: '000000' })).body.code, 'otp_dead');
  assert.equal((await post(h, '/v1/account/forgot/verify', { email: 'nobody@staging.invalid', code: '000000' })).body.code, 'otp_dead');
});

/* ---------- production behaviour ---------- */

function decodeMail(raw) {
  const text = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  const parts = text.split(/\r\n\r\n/);
  return { text, body: parts.map(p => { try { return Buffer.from(p.replace(/\s/g, ''), 'base64').toString('utf8'); } catch { return ''; } }).join('\n') };
}

function gmailStub(mails, { fail = false } = {}) {
  setGmailFetch(async (url, init) => {
    if (/token/.test(String(url))) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }));
    if (fail) return new Response(JSON.stringify({ error: { status: 'INTERNAL' } }), { status: 500 });
    mails.push(decodeMail(JSON.parse(init.body).raw));
    return new Response(JSON.stringify({ id: 'm1' }));
  });
}

const prodEnv = { ENVIRONMENT: 'production', TURNSTILE_SECRET: 'ts', SITE_URL: 'https://stathanasiosyouth.github.io', GMAIL_CLIENT_ID: 'c', GMAIL_CLIENT_SECRET: 's', GMAIL_REFRESH_TOKEN: 'r' };
const passTurnstile = async () => new Response(JSON.stringify({ success: true, hostname: 'stathanasiosyouth.github.io' }));

test('production: no test inbox; the code goes by Gmail, counted, never kept; no Turnstile, no send', async t => {
  t.after(() => setGmailFetch(null));
  const mails = [];
  gmailStub(mails);
  const h = await world(prodEnv);
  await h.db.prepare("UPDATE settings SET value = '1' WHERE key = 'OTP_EMAIL'").run();
  const f = form({ email: 'youth@staging.invalid' });

  const noToken = await h.call('/v1/account/register/start', { method: 'POST', body: f, fetch: passTurnstile });
  assert.equal(noToken.body.code, 'turnstile');
  assert.equal(mails.length, 0);

  const r = await h.call('/v1/account/register/start', { method: 'POST', body: { ...f, turnstile: 'tok' }, fetch: passTurnstile });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.testCode, undefined, 'never echoed in production');
  assert.equal(mails.length, 1);
  const code = /\b(\d{6})\b/.exec(mails[0].body)[1];

  const row = await h.db.prepare('SELECT * FROM member_outbox').first();
  assert.equal(row.status, 'sent');
  assert.equal(row.class, 'otp');
  assert.ok(!JSON.stringify(row).includes(code));
  const pending = await h.db.prepare('SELECT * FROM pending_registrations').first();
  assert.ok(!JSON.stringify(pending).includes(code));
  const quota = await h.db.prepare('SELECT SUM(total) AS total, SUM(otp) AS otp FROM notify_quota').first();
  assert.deepEqual({ ...quota }, { total: 1, otp: 1 });

  const done = await h.call('/v1/account/register/verify', { method: 'POST', body: { pendingId: r.body.pendingId, code } });
  assert.equal(done.status, 200);
  assert.ok(!mails.some(m => m.body.includes(done.body.password)), 'a password is never emailed');
});

test('production: mail not ready → refused before anything is written', async t => {
  t.after(() => setGmailFetch(null));
  gmailStub([]);
  const h = await world(prodEnv);
  const f = () => ({ ...form({ email: 'y' + (++serial) + '@example.com' }), turnstile: 'tok' });
  const off = await h.call('/v1/account/register/start', { method: 'POST', body: f(), fetch: passTurnstile });
  assert.equal(off.body.code, 'mail_down', 'OTP_EMAIL = 0');
  await h.db.prepare("UPDATE settings SET value = '1' WHERE key = 'OTP_EMAIL'").run();
  await h.db.prepare("INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('GMAIL_HEALTH', '{\"ok\":false}', 0, 't')").run();
  assert.equal((await h.call('/v1/account/register/start', { method: 'POST', body: f(), fetch: passTurnstile })).body.code, 'mail_down', 'token broken');
  await h.db.prepare("DELETE FROM settings WHERE key = 'GMAIL_HEALTH'").run();
  await h.db.prepare("INSERT INTO notify_quota (day, total, critical, otp) VALUES (?, 400, 0, 0)").bind('h:' + new Date().toISOString().slice(0, 13)).run();
  assert.equal((await h.call('/v1/account/register/start', { method: 'POST', body: f(), fetch: passTurnstile })).body.code, 'mail_down', 'the day is full');
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM pending_registrations').first()).n, 0);
});

test('a failed send is marked, the pending row stays for «ابعت تاني»', async t => {
  t.after(() => setGmailFetch(null));
  gmailStub([], { fail: true });
  const h = await world(prodEnv);
  await h.db.prepare("UPDATE settings SET value = '1' WHERE key = 'OTP_EMAIL'").run();
  const r = await h.call('/v1/account/register/start', { method: 'POST', body: { ...form({ email: 'z@example.com' }), turnstile: 'tok' }, fetch: passTurnstile });
  assert.equal(r.status, 200);
  assert.equal((await h.db.prepare('SELECT status FROM member_outbox').first()).status, 'failed');
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM pending_registrations').first()).n, 1);
});

test('secrets stay out: no password, code or token in the private tables or activity', async () => {
  const h = await world();
  const a = await register(h);
  const session = (await signin(h, a.email, a.password)).body.session.token;
  const asked = await post(h, '/v1/account/forgot', { email: a.email });
  const dump = {};
  for (const table of ['member_outbox', 'participant_audit', 'activity', 'otp_codes', 'account_sessions', 'api_log']) {
    dump[table] = (await h.db.prepare('SELECT * FROM ' + table).all()).results;
  }
  const text = JSON.stringify(dump);
  for (const secret of [a.password, a.password.replace(/-/g, ''), asked.body.testCode, session, a.email, a.phone]) assert.ok(!text.includes(secret), secret);
});

test('the sweeps: stale pending rows, old codes and sessions go; IP hashes are blanked', async () => {
  const h = await world();
  const a = await register(h);
  await post(h, '/v1/account/register/start', form());
  await signin(h, a.email, a.password);
  await post(h, '/v1/account/forgot', { email: a.email });
  const later = Date.now() + 100 * 24 * 3600 * 1000;
  await housekeeping(h.env, later);
  for (const t of ['pending_registrations', 'otp_codes', 'member_outbox', 'account_sessions']) {
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM ' + t).first()).n, 0, t);
  }
  assert.equal((await h.db.prepare('SELECT reg_ip_hash FROM participants').first()).reg_ip_hash, null);
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM participants').first()).n, 1, 'the account itself stays');
});
