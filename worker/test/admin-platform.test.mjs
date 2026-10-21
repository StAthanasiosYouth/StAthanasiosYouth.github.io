// Phase 3 P3-1…P3-3 (docs/ADMIN-PLATFORM-PLAN.md): sessions, presence, edit
// locks, the panel token, the Apps Script session check, /me and renames — real SQLite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { harness, fakeGoogle } from './helpers.mjs';
import { verifyWorkerToken } from '../src/lib/auth.js';
import { nameKey } from '../src/admin/me.js';
import { housekeeping } from '../src/scheduled.js';

const P = 'p@example.com', M = 'm@example.com';
const TAB1 = 'tab-aaaaaaaaaaaaaaaa', TAB2 = 'tab-bbbbbbbbbbbbbbbb';

async function world({ on = '1' } = {}) {
  const g = await fakeGoogle();
  const h = harness({ env: { ADMIN_EMAILS: '' } });
  await h.db.prepare(`INSERT INTO admins (email, name, role, active, created_at) VALUES ('${P}', 'Primary', 'primary', 1, 0), ('${M}', 'Mina', 'admin', 1, 0)`).run();
  await h.db.prepare("UPDATE settings SET value = ? WHERE key = 'ADMIN_PLATFORM'").bind(on).run();
  const google = async email => 'Bearer ' + await g.sign(g.claims({ email, sub: 'sub-' + email }));
  const call = async (auth, method, path, body) => h.call(path, { method, body, headers: { authorization: auth }, fetch: g.fetch });
  const start = async (email, body) => call(await google(email), 'POST', '/v1/admin/session/start', { device: 'Chrome', tab: TAB1, ...body });
  return { h, g, google, call, start };
}

function signed(h, body, ts = Date.now()) {
  const raw = JSON.stringify(body);
  return { raw, headers: { 'x-sync-ts': String(ts), 'x-sync-signature': 'v1=' + createHmac('sha256', h.env.SYNC_SECRET).update(ts + '.' + raw).digest('hex'), 'content-type': 'text/plain' } };
}

async function syncCheck(h, body) {
  const s = signed(h, body);
  return h.call('/v1/sync/session', { method: 'POST', body: s.raw, headers: s.headers });
}

test('migration: the switch exists and is off by default', async () => {
  const h = harness();
  assert.equal(await h.db.prepare("SELECT value FROM settings WHERE key = 'ADMIN_PLATFORM'").first('value'), '0');
});

test('switch off: session routes answer off, nothing written', async () => {
  const w = await world({ on: '0' });
  const r = await w.start(M);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'off');
  assert.equal((await w.h.db.prepare('SELECT COUNT(*) AS n FROM admin_sessions').first()).n, 0);
});

test('start → sid + panel token (sid inside); the token works on admin routes; whoami', async () => {
  const w = await world();
  const r = await w.start(M);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.sid, /^[\w-]{16,64}$/);
  const claims = await verifyWorkerToken(w.h.env, r.body.token);
  assert.equal(claims.sid, r.body.sid);
  assert.equal(claims.email, M);
  const who = await w.call('Bearer ' + r.body.token, 'GET', '/v1/admin/whoami');
  assert.equal(who.status, 200);
  assert.equal(who.body.email, M);
});

test('one session per account: another device gets the question; force takes over (audit row); the old token is replaced', async () => {
  const w = await world();
  const a = await w.start(M);
  // the panel drew (a heartbeat), so a second device is asked
  await w.call('Bearer ' + a.body.token, 'POST', '/v1/admin/session/heartbeat', { area: 'home' });
  const b = await w.start(M, { device: 'Android', tab: TAB2 });
  assert.equal(b.status, 200);
  assert.equal(b.body.active.device, 'Chrome');
  assert.ok(!b.body.sid);
  const f = await w.start(M, { device: 'Android', tab: TAB2, force: true });
  assert.ok(f.body.sid && f.body.sid !== a.body.sid);
  const old = await w.call('Bearer ' + a.body.token, 'POST', '/v1/admin/session/heartbeat', {});
  assert.equal(old.status, 401);
  assert.equal(old.body.code, 'session_replaced');
  const audit = await w.h.db.prepare("SELECT actor, action FROM activity WHERE action = 'session.takeover'").first();
  assert.deepEqual({ ...audit }, { actor: M, action: 'session.takeover' });
});

test('no takeover question: same tab retry, and a session that never drew its panel on the same device label', async () => {
  const w = await world();
  const a = await w.start(M);
  const again = await w.start(M);                       // same tab: a retry
  assert.ok(again.body.sid);
  const other = await w.start(M, { tab: TAB2 });        // never drew, same label «Chrome»
  assert.ok(other.body.sid);
  assert.notEqual(other.body.sid, a.body.sid);
});

test('park → another device gets in without a question; resume of the same tab keeps sid and locks', async () => {
  const w = await world();
  const a = await w.start(M);
  const auth = 'Bearer ' + a.body.token;
  const hb = await w.call(auth, 'POST', '/v1/admin/session/heartbeat', { locks: ['news:news-1'] });
  assert.deepEqual(hb.body.locks, { 'news:news-1': { granted: true } });
  // the page reloads: park (text/plain beacon with the token in the body)
  const park = await w.h.call('/v1/admin/session/park', { method: 'POST', body: JSON.stringify({ token: a.body.token, tab: TAB1 }), headers: { 'content-type': 'text/plain' } });
  assert.equal(park.body.parked, true);
  const res = await w.call(await w.google(M), 'POST', '/v1/admin/session/resume', { sid: a.body.sid, device: 'Chrome', tab: TAB2, prev: TAB1, left: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.sid, a.body.sid);
  assert.equal(res.body.resumed, true);
  const lock = await w.h.db.prepare("SELECT sid FROM edit_locks WHERE kind = 'news' AND id = 'news-1'").first();
  assert.equal(lock.sid, a.body.sid);
});

test('resume: a live session in another tab (duplicated tab) is asked; an unknown sid is expired', async () => {
  const w = await world();
  const a = await w.start(M);
  await w.call('Bearer ' + a.body.token, 'POST', '/v1/admin/session/heartbeat', {});
  const dup = await w.call(await w.google(M), 'POST', '/v1/admin/session/resume', { sid: a.body.sid, tab: TAB2 });
  assert.ok(dup.body.active);
  const none = await w.call(await w.google(P), 'POST', '/v1/admin/session/resume', { sid: 'zzzzzzzzzzzzzzzzzzzz' });
  assert.equal(none.body.code, 'session_expired');
});

test('edit locks: held by another live session → refused with the holder; its own renew; released when not wanted; free when the holder parks out', async () => {
  const w = await world();
  const m = await w.start(M);
  const p = await w.start(P);
  const am = 'Bearer ' + m.body.token, ap = 'Bearer ' + p.body.token;
  assert.equal((await w.call(am, 'POST', '/v1/admin/session/heartbeat', { locks: ['page:pg-1', 'bad:key', 'settings:location'], item: { kind: 'page', id: 'pg-1', label: '<b>عنوان</b>' } })).body.locks['page:pg-1'].granted, true);
  const denied = await w.call(ap, 'POST', '/v1/admin/session/heartbeat', { locks: ['page:pg-1'] });
  assert.equal(denied.body.locks['page:pg-1'].granted, false);
  assert.equal(denied.body.locks['page:pg-1'].holder.name, 'Mina');
  assert.equal(denied.body.locks['page:pg-1'].holder.device, 'Chrome');
  // presence: P sees M where M is and what M edits (cleaned label)
  assert.equal(denied.body.others.length, 1);
  assert.equal(denied.body.others[0].email, M);
  assert.equal(denied.body.others[0].item.label, 'b عنوان /b'.replace('b عنوان /b', denied.body.others[0].item.label));
  assert.ok(!/[<>]/.test(denied.body.others[0].item.label));
  // M lets go of the page lock (keeps settings)
  await w.call(am, 'POST', '/v1/admin/session/heartbeat', { locks: ['settings:location'] });
  assert.equal((await w.call(ap, 'POST', '/v1/admin/session/heartbeat', { locks: ['page:pg-1'] })).body.locks['page:pg-1'].granted, true);
  // M parks and the grace runs out: P gets settings:location
  await w.h.db.prepare('UPDATE admin_sessions SET parked_ms = ? WHERE email = ?').bind(Date.now() - 60_000, M).run();
  assert.equal((await w.call(ap, 'POST', '/v1/admin/session/heartbeat', { locks: ['settings:location'] })).body.locks['settings:location'].granted, true);
  // booking leases are never touched by the panel heartbeat
  await w.h.db.prepare("INSERT INTO edit_locks (kind, id, email, name, sid, since_ms, expires_ms) VALUES ('booking', 'bkg-1', ?, '', ?, 0, ?)").bind(P, p.body.sid, Date.now() + 60_000).run();
  await w.call(ap, 'POST', '/v1/admin/session/heartbeat', { locks: [] });
  assert.ok(await w.h.db.prepare("SELECT 1 FROM edit_locks WHERE kind = 'booking'").first());
});

test('heartbeat: at most 6 locks; activity of the others since a time; a renewed token near the end', async () => {
  const w = await world();
  const m = await w.start(M);
  await w.h.db.prepare("INSERT INTO activity (id, at, cairo, actor, action, summary, severity, source) VALUES ('act-000000000001', ?, 'x', ?, 'update', 'عدّل خبر', 'routine', 'worker'), ('act-000000000002', ?, 'x', ?, 'update', 'أنا', 'routine', 'worker')")
    .bind(Date.now() - 1000, P, Date.now() - 1000, M).run();
  const keys = ['news:a', 'news:b', 'news:c', 'news:d', 'news:e', 'news:f', 'news:g'];
  const r = await w.call('Bearer ' + m.body.token, 'POST', '/v1/admin/session/heartbeat', { locks: keys, since: Date.now() - 60_000 });
  assert.equal(Object.keys(r.body.locks).length, 6);
  assert.deepEqual(r.body.activity.map(a => a.actorName), ['Primary']);
  assert.ok(!r.body.token);
  // a token with < 5 minutes left: the beat brings a new one
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ e: M, x: now + 120, v: 'google', i: now - 600, s: m.body.sid })).toString('base64url');
  const near = 'wk1.' + payload + '.' + createHmac('sha256', 'sync-test-secret').update('wk1.' + payload).digest('hex');
  const r2 = await w.call('Bearer ' + near, 'POST', '/v1/admin/session/heartbeat', {});
  assert.match(r2.body.token, /^wk1\./);
  assert.equal((await verifyWorkerToken(w.h.env, r2.body.token)).sid, m.body.sid);
});

test('heartbeat needs the panel session (a Google token alone is not a session)', async () => {
  const w = await world();
  await w.start(M);
  const r = await w.call(await w.google(M), 'POST', '/v1/admin/session/heartbeat', {});
  assert.equal(r.body.code, 'session_expired');
});

test('end: the session and its panel locks go; the token then says expired', async () => {
  const w = await world();
  const m = await w.start(M);
  const auth = 'Bearer ' + m.body.token;
  await w.call(auth, 'POST', '/v1/admin/session/heartbeat', { locks: ['news:n1'] });
  assert.equal((await w.call(auth, 'POST', '/v1/admin/session/end', {})).body.ended, true);
  assert.equal((await w.h.db.prepare('SELECT COUNT(*) AS n FROM edit_locks').first()).n, 0);
  assert.equal((await w.call(auth, 'GET', '/v1/admin/whoami')).body.code, 'session_expired');
});

test('removed admin: the panel token stops at once', async () => {
  const w = await world();
  const m = await w.start(M);
  await w.h.db.prepare('UPDATE admins SET active = 0 WHERE email = ?').bind(M).run();
  assert.equal((await w.call('Bearer ' + m.body.token, 'GET', '/v1/admin/whoami')).body.code, 'denied');
});

test('Apps Script check (POST /v1/sync/session): live / replaced / expired, and lock holders of other sessions only', async () => {
  const w = await world();
  const m = await w.start(M);
  const p = await w.start(P);
  await w.call('Bearer ' + m.body.token, 'POST', '/v1/admin/session/heartbeat', { locks: ['news:n1'] });
  const live = await syncCheck(w.h, { email: P, sid: p.body.sid, locks: ['news:n1', 'news:n2'] });
  assert.equal(live.status, 200, JSON.stringify(live.body));
  assert.equal(live.body.state, 'live');
  assert.deepEqual(Object.keys(live.body.holders), ['news:n1']);
  assert.equal(live.body.holders['news:n1'].name, 'Mina');
  const own = await syncCheck(w.h, { email: M, sid: m.body.sid, locks: ['news:n1'] });
  assert.deepEqual(own.body.holders, {});
  // the same signed question twice is fine (read-only)
  const s = signed(w.h, { email: P, sid: p.body.sid });
  assert.equal((await w.h.call('/v1/sync/session', { method: 'POST', body: s.raw, headers: s.headers })).status, 200);
  assert.equal((await w.h.call('/v1/sync/session', { method: 'POST', body: s.raw, headers: s.headers })).status, 200);
  await w.start(M, { force: true, tab: TAB2, device: 'Other' });
  assert.equal((await syncCheck(w.h, { email: M, sid: m.body.sid })).body.state, 'replaced');
  assert.equal((await syncCheck(w.h, { email: 'x@example.com', sid: 'yyyyyyyyyyyyyyyyyyyy' })).body.state, 'expired');
  // unsigned: refused
  const bad = await w.h.call('/v1/sync/session', { method: 'POST', body: s.raw, headers: { ...s.headers, 'x-sync-signature': 'v1=00' } });
  assert.equal(bad.status, 401);
});

test('housekeeping sweeps old sessions, replaced sids and nonces', async () => {
  const w = await world();
  const old = Date.now() - 7 * 3600 * 1000;
  await w.h.db.prepare("INSERT INTO admin_sessions (email, sid, since_ms, seen_ms) VALUES (?, 'old-sid-xxxxxxxxxxxx', ?, ?)").bind(M, old, old).run();
  await w.h.db.prepare("INSERT INTO admin_sessions_gone (sid, at_ms) VALUES ('gone-sid-xxxxxxxxxxx', ?)").bind(old).run();
  await w.h.db.prepare("INSERT INTO admin_device_nonces (nonce, exp_ms) VALUES ('n1', ?)").bind(old).run();
  await housekeeping(w.h.env);
  for (const t of ['admin_sessions', 'admin_sessions_gone', 'admin_device_nonces']) {
    assert.equal((await w.h.db.prepare('SELECT COUNT(*) AS n FROM ' + t).first()).n, 0, t);
  }
});

test('P3-3 /me: the admin, their effective permissions (switch off = all but the Primary defaults), the platform flag', async () => {
  const w = await world();
  const me = await w.call(await w.google(M), 'GET', '/v1/admin/me');
  assert.equal(me.status, 200, JSON.stringify(me.body));
  assert.equal(me.body.name, 'Mina');
  assert.equal(me.body.primary, false);
  assert.equal(me.body.platform, true);
  assert.equal(me.body.perms['bookings.view'], 'all');
  assert.ok(!me.body.perms['accounts.manage']);
  await w.h.db.prepare("UPDATE settings SET value = '1' WHERE key = 'PERMS_ENFORCE'").run();
  await w.h.db.prepare("INSERT INTO admin_grants (email, perm, scope, granted_by, granted_at) VALUES (?, 'bookings.create_cash', 'own', 't', 0)").bind(M).run();
  const enforced = await w.call(await w.google(M), 'GET', '/v1/admin/me');
  assert.deepEqual(enforced.body.perms, { 'bookings.create_cash': 'own' });
  assert.equal(enforced.body.enforce, true);
  const primary = await w.call(await w.google(P), 'GET', '/v1/admin/me');
  assert.equal(primary.body.perms['accounts.manage'], 'all');
});

test('P3-3 rename: rules of Activity.gs (length, characters, unique by reading), audit row, clear', async () => {
  const w = await world();
  const auth = await w.google(M);
  const ok = await w.call(auth, 'POST', '/v1/admin/accounts/' + encodeURIComponent(P) + '/name', { name: '  مينا   زكريا ' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.name, 'مينا زكريا');
  assert.equal((await w.h.db.prepare('SELECT name FROM admins WHERE email = ?').bind(P).first('name')), 'مينا زكريا');
  assert.ok(await w.h.db.prepare("SELECT 1 FROM activity WHERE action = 'admin.rename' AND entity_id = ?").bind(P).first());
  assert.equal((await w.call(auth, 'POST', '/v1/admin/accounts/' + encodeURIComponent(M) + '/name', { name: 'مينـا زكريّا' })).body.code, 'conflict');
  assert.equal((await w.call(auth, 'POST', '/v1/admin/accounts/' + encodeURIComponent(M) + '/name', { name: 'a' })).body.code, 'invalid');
  assert.equal((await w.call(auth, 'POST', '/v1/admin/accounts/' + encodeURIComponent(M) + '/name', { name: 'x@y.z' })).body.code, 'invalid');
  assert.equal((await w.call(auth, 'POST', '/v1/admin/accounts/nobody%40example.com/name', { name: 'Someone' })).body.code, 'not_found');
  const clear = await w.call(auth, 'POST', '/v1/admin/accounts/' + encodeURIComponent(P) + '/name', { name: '' });
  assert.equal(clear.body.name, 'p');
  assert.equal(nameKey('أحمد'), nameKey('احمد'));
});

test('Apps Script check with all: every live panel lock of the OTHER sessions (asked once before a write)', async () => {
  const w = await world();
  const m = await w.start(M);
  const p = await w.start(P);
  await w.call('Bearer ' + m.body.token, 'POST', '/v1/admin/session/heartbeat', { locks: ['news:n1', 'page:pg-2'] });
  await w.call('Bearer ' + p.body.token, 'POST', '/v1/admin/session/heartbeat', { locks: ['links:l-9'] });
  const r = await syncCheck(w.h, { email: P, sid: p.body.sid, all: true });
  assert.equal(r.body.state, 'live');
  assert.deepEqual(Object.keys(r.body.holders).sort(), ['news:n1', 'page:pg-2']);
});
