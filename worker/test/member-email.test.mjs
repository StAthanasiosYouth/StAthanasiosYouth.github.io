// Member email, batch 2 (docs/PHASE5-PLAN.md P5-4, docs/MEMBER-NOTIFICATIONS-PLAN.md §12) and the
// account's own sections (P5-3): the pipeline on real SQLite, with a fake Gmail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers.mjs';
import { setGmailFetch } from '../src/notify/gmail.js';
import { memberEmailStmt, memberLease, memberSend, memberStatus, KINDS } from '../src/notify/member.js';
import { securityEmail } from '../src/notify/templates.js';
import { hourKey, quotaOf } from '../src/notify/email.js';
import { notifyTick } from '../src/notify/tick.js';

const KEYS = { PW_PEPPER: 'pepper-test', PW_KEY: Buffer.alloc(32, 7).toString('base64'), OTP_PEPPER: 'otp-test', ACCOUNT_PAD_MS: '0' };
const GMAIL = { GMAIL_CLIENT_ID: 'c', GMAIL_CLIENT_SECRET: 's', GMAIL_REFRESH_TOKEN: 'r' };

async function world(extra = {}) {
  const h = harness({ env: { ENVIRONMENT: 'staging', ...KEYS, ...GMAIL, ...extra } });
  await h.db.prepare("UPDATE settings SET value = 'on' WHERE key = 'accounts_mode'").run();
  await h.db.prepare("UPDATE settings SET value = '1' WHERE key = 'MEMBER_EMAIL'").run();
  return h;
}
function gmail(t, { status = 200, reason = 'INTERNAL' } = {}) {
  const mails = [];
  setGmailFetch(async (url, init) => {
    if (/token/.test(String(url))) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }));
    if (status !== 200) return new Response(JSON.stringify({ error: { status: reason } }), { status });
    mails.push(Buffer.from(JSON.parse(init.body).raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return new Response(JSON.stringify({ id: 'm' + mails.length }));
  });
  t.after(() => setGmailFetch(null));
  return mails;
}
let serial = 0;
async function account(h, over = {}) {
  serial++;
  const id = 'p-test' + String(serial).padStart(4, 'a');
  await h.db.prepare(`INSERT INTO participants (id, name, name_norm, email, email_canon, email_verified_at, email_source, email_verified_via, phone, phone_norm, birth_date, status, pw_hash, pw_enc, pw_version, pw_issued_at, pw_issued_by, created_via, created_at, updated_at)
    VALUES (?, 'مينا زكريا فؤاد', 'مينا زكريا فؤاد', ?, ?, ?, 'self', 'otp', ?, ?, '2000-03-12', ?, 'h', 'e', ?, 1, 'self', 'self', 1, 1)`)
    .bind(id, over.email || `u${serial}@example.com`, over.email || `u${serial}@example.com`, over.verified === false ? null : 1, '0101000' + String(1000 + serial), '101000' + String(1000 + serial), over.status || 'active', over.pwVersion || 1).run();
  return id;
}
const enqueue = (h, kind, participantId, over = {}) => memberEmailStmt(h.db, { kind, participantId, dedupeKey: over.dedupeKey || `t:${kind}:${participantId}:${++serial}`, entityVersion: over.entityVersion ?? null, now: over.now }).run();
const rows = h => h.db.prepare('SELECT * FROM member_outbox ORDER BY created_ms, id').all().then(r => r.results);
async function deliver(h, now = Date.now()) {
  const ids = await memberLease(h.env, now);
  return memberSend(h.env, ids, now);
}

test('a Tier 0 notice: sent once to the verified address, counted, no body kept', async t => {
  const mails = gmail(t);
  const h = await world();
  const p = await account(h, { email: 'mina@example.com' });
  await enqueue(h, 'acct.new', p);
  assert.equal((await deliver(h)).sent, 1);
  assert.equal(mails.length, 1);
  assert.match(mails[0], /To: mina@example\.com/);
  const [row] = await rows(h);
  assert.equal(row.status, 'sent');
  assert.ok(!('body' in row));
  const q = await quotaOf(h.db);
  assert.deepEqual([q.total, q.member_tx], [1, 1]);
  assert.equal((await deliver(h)).sent, 0, 'never twice');
});

test('the dedupe key: a replay writes no second row', async t => {
  gmail(t);
  const h = await world();
  const p = await account(h);
  await enqueue(h, 'acct.new', p, { dedupeKey: 'acct:new:' + p });
  await enqueue(h, 'acct.new', p, { dedupeKey: 'acct:new:' + p });
  assert.equal((await rows(h)).length, 1);
});

test('the row lives or dies with its state change (one batch)', async () => {
  const h = await world();
  const p = await account(h);
  await assert.rejects(h.db.batch([
    memberEmailStmt(h.db, { kind: 'acct.new', participantId: p, dedupeKey: 'x' }),
    h.db.prepare('INSERT INTO no_such_table VALUES (1)')
  ]));
  assert.equal((await rows(h)).length, 0);
});

test('unverified, blocked or missing recipient → nothing sent, row kept as suppressed', async t => {
  const mails = gmail(t);
  const h = await world();
  await enqueue(h, 'acct.new', await account(h, { verified: false }));
  await enqueue(h, 'acct.new', await account(h, { status: 'blocked' }));
  await enqueue(h, 'acct.new', 'p-gone');
  assert.equal((await deliver(h)).suppressed, 3);
  assert.equal(mails.length, 0);
  assert.ok((await rows(h)).every(r => r.status === 'suppressed' && r.error === 'recipient'));
});

test('superseded: a newer password makes the older notice stale', async t => {
  const mails = gmail(t);
  const h = await world();
  const p = await account(h, { pwVersion: 3 });
  await enqueue(h, 'acct.pw', p, { entityVersion: 2 });
  assert.equal((await deliver(h)).superseded, 1);
  assert.equal(mails.length, 0);
  await enqueue(h, 'acct.pw', p, { entityVersion: 3 });
  assert.equal((await deliver(h)).sent, 1);
});

test('preferences: Tier 3 is opt-in; a muted row is kept as suppressed; Tier 0 ignores them', async t => {
  const mails = gmail(t);
  const h = await world();
  const p = await account(h);
  await enqueue(h, 'acct.dev', p);
  assert.equal((await deliver(h)).suppressed, 1, 'not opted in');
  await h.db.prepare("INSERT INTO member_prefs (participant_id, grp, mode, updated_at) VALUES (?, 'security', 'on', 1)").bind(p).run();
  await enqueue(h, 'acct.dev', p);
  assert.equal((await deliver(h)).sent, 1);
  await h.db.prepare("INSERT INTO member_prefs (participant_id, grp, mode, updated_at) VALUES (?, 'bookings', 'off', 1)").bind(p).run();
  await enqueue(h, 'acct.new', p);
  assert.equal((await deliver(h)).sent, 1, 'security notices can not be muted');
  assert.equal(mails.length, 2);
});

test('Tier 2: on by default, muted by choice, ten receipts a day at most', async t => {
  const mails = gmail(t);
  const h = await world();
  KINDS['test.receipt'] = { tier: 2, cls: 'member_tx', ttl: 3600000, group: 'store', notice: 'new_signin' };
  t.after(() => { delete KINDS['test.receipt']; });
  const p = await account(h);
  for (let i = 0; i < 12; i++) await enqueue(h, 'test.receipt', p);
  let sent = 0;
  let suppressed = 0;
  for (let i = 0; i < 2; i++) {
    const r = await deliver(h);
    sent += r.sent;
    suppressed += r.suppressed;
  }
  assert.deepEqual([sent, suppressed], [10, 2]);
  assert.equal(mails.length, 10);
  const q = await account(h);
  await h.db.prepare("INSERT INTO member_prefs (participant_id, grp, mode, updated_at) VALUES (?, 'store', 'off', 1)").bind(q).run();
  await enqueue(h, 'test.receipt', q);
  assert.equal((await deliver(h)).suppressed, 1);
});

test('MEMBER_EMAIL off or accounts off: nothing leases; rows wait until they expire', async t => {
  const mails = gmail(t);
  const h = await world();
  const p = await account(h);
  await enqueue(h, 'acct.new', p);
  await h.db.prepare("UPDATE settings SET value = '0' WHERE key = 'MEMBER_EMAIL'").run();
  assert.deepEqual(await memberLease(h.env), []);
  await h.db.prepare("UPDATE settings SET value = '1' WHERE key = 'MEMBER_EMAIL'").run();
  await h.db.prepare("UPDATE settings SET value = 'off' WHERE key = 'accounts_mode'").run();
  assert.deepEqual(await memberLease(h.env), []);
  await memberLease(h.env, Date.now() + 80 * 3600000);
  assert.equal((await rows(h))[0].status, 'expired');
  assert.equal(mails.length, 0);
});

test('priority: transactional before bulk, lower tier first', async t => {
  gmail(t);
  const h = await world();
  KINDS['test.bulk'] = { tier: 2, cls: 'member_bulk', ttl: 3600000, notice: 'new_signin' };
  t.after(() => { delete KINDS['test.bulk']; });
  const p = await account(h);
  const now = Date.now();
  await enqueue(h, 'test.bulk', p, { now: now - 5000 });
  await enqueue(h, 'acct.dev', p, { now: now - 3000 });
  await enqueue(h, 'acct.new', p, { now: now - 1000 });
  const ids = await memberLease(h.env, now);
  const byId = Object.fromEntries((await rows(h)).map(r => [r.id, r.kind]));
  assert.deepEqual(ids.map(id => byId[id]), ['acct.new', 'acct.dev', 'test.bulk']);
});

test('budget: never the OTP reserve; a full day waits for the window; bulk drips', async t => {
  const mails = gmail(t);
  const h = await world();
  KINDS['test.bulk'] = { tier: 2, cls: 'member_bulk', ttl: 72 * 3600000, notice: 'new_signin' };
  t.after(() => { delete KINDS['test.bulk']; });
  const p = await account(h);
  const hour = hourKey(Date.now());
  // 250 of 400 used by nobody with a reservation: otp 100 + critical 50 are still held
  await h.db.prepare('INSERT INTO notify_quota (day, total) VALUES (?, 250)').bind(hour).run();
  await enqueue(h, 'acct.new', p);
  assert.equal((await deliver(h)).deferred, 1);
  assert.equal(mails.length, 0);
  assert.equal((await rows(h))[0].error, 'quota');
  // the reservations are used up: the same total now leaves room
  await h.db.prepare('UPDATE notify_quota SET otp = 100, critical = 50 WHERE day = ?').bind(hour).run();
  await h.db.prepare('UPDATE member_outbox SET next_ms = 0').run();
  assert.equal((await deliver(h)).sent, 1, 'a reservation never caps while room is free');

  await h.db.prepare('UPDATE notify_quota SET total = 0, otp = 100, critical = 50, member_tx = 100, admin = 120, member_bulk = 30 WHERE day = ?').bind(hour).run();
  await enqueue(h, 'test.bulk', p);
  assert.equal((await deliver(h)).deferred, 1, 'over the hourly drip');
  assert.ok((await rows(h)).some(r => r.error === 'drip'));
});

test('OTP has precedence: it goes while everything else is held back', async t => {
  gmail(t);
  const h = await world({ ENVIRONMENT: 'production', TURNSTILE_SECRET: 'ts', SITE_URL: 'https://stathanasiosyouth.github.io' });
  await h.db.prepare("UPDATE settings SET value = '1' WHERE key = 'OTP_EMAIL'").run();
  await h.db.prepare('INSERT INTO notify_quota (day, total) VALUES (?, 399)').bind(hourKey(Date.now())).run();
  const r = await h.call('/v1/account/register/start', {
    method: 'POST', fetch: async () => new Response(JSON.stringify({ success: true, hostname: 'stathanasiosyouth.github.io' })),
    body: { email: 'new@example.com', phone: '01012341234', name: 'مينا زكريا فؤاد', birthDate: '2000-03-12', turnstile: 'tok' }
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await quotaOf(h.db)).otp, 1);
});

test('Gmail down: rows wait, nothing lost; transient errors back off; five → dead + one alert', async t => {
  gmail(t, { status: 500 });
  const h = await world();
  const p = await account(h);
  await h.db.prepare("INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('GMAIL_HEALTH', '{\"ok\":false}', 0, 't')").run();
  await enqueue(h, 'acct.new', p);
  assert.equal((await deliver(h)).deferred, 1);
  await h.db.prepare("DELETE FROM settings WHERE key = 'GMAIL_HEALTH'").run();
  let last;
  for (let i = 0; i < 5; i++) {
    await h.db.prepare('UPDATE member_outbox SET next_ms = 0').run();
    last = await deliver(h);
  }
  assert.equal(last.dead, 1);
  const [row] = await rows(h);
  assert.equal(row.status, 'dead');
  assert.equal(row.attempts, 5);
  await enqueue(h, 'acct.new', await account(h));
  await h.db.prepare("UPDATE member_outbox SET attempts = 4, next_ms = 0 WHERE status = 'queued'").run();
  await deliver(h);
  assert.equal((await h.db.prepare("SELECT COUNT(*) AS n FROM activity WHERE action = 'member.mail.dead'").first()).n, 1, 'one alert an hour, not per row');
});

test('Gmail refuses the address (rejected) → dead at once', async t => {
  gmail(t, { status: 400, reason: 'INVALID_ARGUMENT' });
  const h = await world();
  await enqueue(h, 'acct.new', await account(h));
  assert.equal((await deliver(h)).dead, 1);
});

test('staging test inbox: no Gmail call, no budget used; never in production', async t => {
  const mails = gmail(t);
  const h = await world();
  await enqueue(h, 'acct.new', await account(h, { email: 't@staging.invalid' }));
  assert.equal((await deliver(h)).sent, 1);
  assert.equal(mails.length, 0);
  assert.equal((await quotaOf(h.db)).total, 0);
  const prod = await world({ ENVIRONMENT: 'production' });
  await enqueue(prod, 'acct.new', await account(prod, { email: 't@staging.invalid' }));
  await deliver(prod);
  assert.equal(mails.length, 1, 'production treats it as any address');
});

test('the minute cron drives it, through the queue when there is one', async t => {
  gmail(t);
  const h = await world();
  await enqueue(h, 'acct.new', await account(h));
  const out = await notifyTick(h.env);
  assert.equal(out.memberLeased, 1);
  assert.equal(h.sent[h.sent.length - 1].type, 'member.email');
});

test('content scan: no secret, payment number, phone, DOB or admin link in any notice', () => {
  for (const kind of ['account_created', 'password_reset_support', 'recovery_used', 'new_signin']) {
    const m = securityEmail({ kind, cairo: '2026-10-20 10:00', device: 'Android Chrome', prefs: kind === 'new_signin' });
    const all = m.subject + m.html + m.text;
    assert.doesNotMatch(all, /\/admin|#b\/|as1\.|باسورد[^ ]* [2-9A-Z]{4}-/, kind);
    assert.doesNotMatch(all, /2000-03-12/, kind);
    assert.doesNotMatch(m.subject, /\d{6}/, kind);
  }
  assert.doesNotMatch(securityEmail({ kind: 'account_created', cairo: '2026-10-20 10:00' }).text, /#me\//, 'a creation notice may reach a stranger');
});

/* ---------- sign-in → «دخول من جهاز جديد» ---------- */

const UA = { android: 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537', windows: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537' };

async function registered(h) {
  serial++;
  const f = { email: `s${serial}@staging.invalid`, phone: '0112' + String(1000000 + serial), name: 'مينا زكريا فؤاد', birthDate: '2000-03-12' };
  const s = await h.call('/v1/account/register/start', { method: 'POST', body: f });
  const d = await h.call('/v1/account/register/verify', { method: 'POST', body: { pendingId: s.body.pendingId, code: s.body.testCode } });
  return { ...f, password: d.body.password };
}
const signin = (h, a, ua) => h.call('/v1/account/signin', { method: 'POST', body: { email: a.email, password: a.password }, headers: { 'user-agent': ua } });

test('a new device: a row only when this account has used another device before', async () => {
  const h = await world();
  const a = await registered(h);
  const devRows = async () => (await rows(h)).filter(r => r.kind === 'acct.dev');
  await signin(h, a, UA.android);
  assert.equal((await devRows()).length, 0, 'the first sign-in ever');
  await signin(h, a, UA.android);
  assert.equal((await devRows()).length, 0, 'the same device');
  const s = await signin(h, a, UA.windows);
  assert.equal(s.status, 200);
  const [row] = await devRows();
  assert.equal(row.entity_type, 'session');
  assert.equal(row.tier, 3);
});

/* ---------- the account's sections (P5-3) ---------- */

test('security: where I am signed in, families only, this device marked; nobody else\'s', async () => {
  const h = await world();
  const a = await registered(h);
  const b = await registered(h);
  await signin(h, a, UA.android);
  const mine = (await signin(h, a, UA.windows)).body.session.token;
  await signin(h, b, UA.android);
  const r = await h.call('/v1/account/security', { headers: { authorization: 'Bearer ' + mine } });
  assert.equal(r.status, 200);
  assert.equal(r.body.sessions.length, 2);
  assert.deepEqual(r.body.sessions.map(s => s.device).sort(), ['Android Chrome', 'Windows Chrome']);
  assert.equal(r.body.sessions.filter(s => s.current).length, 1);
  assert.ok(!JSON.stringify(r.body).includes('token'));
  assert.equal((await h.call('/v1/account/security')).body.code, 'session');
});

test('«إشعاراتي»: defaults, saving, unknown groups refused, needs a session', async () => {
  const h = await world();
  const a = await registered(h);
  const token = (await signin(h, a, UA.android)).body.session.token;
  const auth = { authorization: 'Bearer ' + token };
  const got = await h.call('/v1/account/prefs', { headers: auth });
  const on = Object.fromEntries(got.body.groups.map(g => [g.key, g.on]));
  assert.deepEqual(on, { bookings: true, results: true, store: true, security: false });
  assert.ok(got.body.always.length > 0);
  const saved = await h.call('/v1/account/prefs', { method: 'POST', headers: auth, body: { prefs: { store: false, security: true } } });
  const after = Object.fromEntries(saved.body.groups.map(g => [g.key, g.on]));
  assert.deepEqual(after, { bookings: true, results: true, store: false, security: true });
  assert.equal((await h.call('/v1/account/prefs', { method: 'POST', headers: auth, body: { prefs: { nope: true } } })).status, 400);
  assert.equal((await h.call('/v1/account/prefs', { method: 'POST', headers: auth, body: { prefs: { store: 'off' } } })).status, 400);
  assert.equal((await h.call('/v1/account/prefs', { method: 'POST', body: { prefs: { store: true } } })).status, 401);
});

test('a preference change stops that email (end to end)', async t => {
  const mails = gmail(t);
  const h = await world();
  const a = await registered(h);
  await h.db.prepare("UPDATE participants SET email = 'real@example.com' WHERE email = ?").bind(a.email).run();
  const token = (await signin(h, a, UA.android)).body.session.token;
  const auth = { authorization: 'Bearer ' + token };
  await h.call('/v1/account/prefs', { method: 'POST', headers: auth, body: { prefs: { security: true } } });
  await signin(h, a, UA.windows);
  assert.equal((await deliver(h)).sent, 1);
  assert.equal(mails.length, 1);
  await h.call('/v1/account/prefs', { method: 'POST', headers: auth, body: { prefs: { security: false } } });
  await signin(h, a, 'Mozilla/5.0 (iPhone) Version/17 Mobile Safari/604');
  const r = await deliver(h);
  assert.equal(r.suppressed, 1);
  assert.equal(mails.length, 1);
});

/* ---------- «حالة النظام» and the sign-in form's alert ---------- */

test('status: counts per class, the switches, the form\'s budget', async t => {
  gmail(t);
  const h = await world();
  await enqueue(h, 'acct.new', await account(h));
  await deliver(h);
  await h.call('/v1/account/signin', { method: 'POST', body: { email: 'nobody@staging.invalid' } });
  const s = await memberStatus(h.env);
  assert.equal(s.on, true);
  assert.equal(s.accounts, true);
  assert.equal(s.classes.member_tx.sent, 1);
  assert.equal(s.discovery.today, 1);
  assert.equal(s.discovery.noAccount, 1);
  assert.ok(s.lastSent > 0);
});

test('half of the daily form budget: one important alert for the admins, no personal data', async () => {
  const h = await world();
  await h.db.prepare("UPDATE settings SET value = '4' WHERE key = 'discovery_daily_cap'").run();
  for (let i = 0; i < 3; i++) await h.call('/v1/account/signin', { method: 'POST', body: { email: `x${i}@staging.invalid` }, headers: { 'cf-connecting-ip': '192.0.2.' + i } });
  const rowsA = (await h.db.prepare("SELECT * FROM activity WHERE action = 'account.discover.high'").all()).results;
  assert.equal(rowsA.length, 1);
  assert.equal(rowsA[0].severity, 'important');
  assert.ok(!JSON.stringify(rowsA[0]).includes('@'));
  const fifth = await h.call('/v1/account/signin', { method: 'POST', body: { email: 'y@staging.invalid' }, headers: { 'cf-connecting-ip': '192.0.2.9' } });
  assert.equal(fifth.status, 200);
  assert.equal((await h.call('/v1/account/signin', { method: 'POST', body: { email: 'z@staging.invalid' }, headers: { 'cf-connecting-ip': '192.0.2.10' } })).status, 429, 'over the cap');
});
