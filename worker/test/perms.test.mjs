// Phase 1.5 step 1: migration 0009 (grants + notification schema), requirePerm,
// the route → permission table, PERMS_ENFORCE. Real SQLite, real migrations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { harness, fakeGoogle } from './helpers.mjs';
import { D1Sqlite, migratedDb } from './d1-sqlite.mjs';
import { ROUTES } from '../src/routes.js';
import { PERMS, PRIMARY_DEFAULT, ANY_ADMIN, ROUTE_PERMS, OWN_SCOPE_ROUTES, routePerm, requirePerm, requireRoutePerm } from '../src/lib/perms.js';
import { signSync } from '../src/lib/sync.js';
import { bookWorld, pay } from './book-helpers.mjs';

const DIR = new URL('../migrations/', import.meta.url);
const FILES = readdirSync(DIR).filter(f => f.endsWith('.sql')).sort();
const apply = (db, f) => db.raw.exec(readFileSync(new URL(f, DIR), 'utf8'));

function dbBefore0009() {
  const db = new D1Sqlite();
  for (const f of FILES.filter(f => f < '0009')) apply(db, f);
  return db;
}

const setEnforce = (db, v) => db.prepare("UPDATE settings SET value = ? WHERE key = 'PERMS_ENFORCE'").bind(v).run();
const grant = (db, email, perm, scope = 'all') => db.prepare("INSERT INTO admin_grants (email, perm, scope, granted_by, granted_at) VALUES (?, ?, ?, 'test', 0) ON CONFLICT(email, perm) DO UPDATE SET scope = excluded.scope").bind(email, perm, scope).run();
const addAdmin = (db, email, role = 'admin', servant = null) => db.prepare('INSERT INTO admins (email, name, role, active, created_at, servant_id) VALUES (?, ?, ?, 1, 0, ?)').bind(email, email, role, servant).run();
const ctxFor = (db, email, role = 'admin') => ({ env: { DB: db }, actor: { email, name: email, role } });

async function denied(p, perm) {
  await assert.rejects(p, e => e.code === 'denied' && (perm === undefined || (e.extra && e.extra.perm === perm)));
}

// ---------- migration ----------

test('0009 is the next number and every migration applies in order', () => {
  assert.ok(FILES.includes('0009_admin_grants_notify.sql'));
  assert.equal(FILES.filter(f => f.startsWith('0009')).length, 1);
  const db = migratedDb();
  const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name);
  for (const t of ['admin_grants', 'notify_settings', 'notify_prefs', 'notify_outbox']) assert.ok(tables.includes(t), t);
  const cols = t => db.raw.prepare(`PRAGMA table_info(${t})`).all().map(r => r.name);
  assert.ok(cols('admins').includes('servant_id'));
  for (const c of ['severity', 'source', 'notified']) assert.ok(cols('activity').includes(c), c);
  assert.deepEqual(cols('notify_outbox'), ['id', 'dedupe_key', 'recipient', 'channel', 'kind', 'activity_ids', 'status', 'attempts', 'next_ms', 'sent_ms', 'error', 'created_ms']);
  assert.equal(db.raw.prepare("SELECT value FROM settings WHERE key = 'PERMS_ENFORCE'").get().value, '0');
});

test('0009 seeds existing admins: primary = every permission; others = all but the Primary defaults; inactive = none; history marked notified', () => {
  const db = dbBefore0009();
  db.raw.exec(`INSERT INTO admins (email, name, role, active, created_at) VALUES
    ('p@example.com', 'P', 'primary', 1, 0), ('a@example.com', 'A', 'admin', 1, 0), ('i@example.com', 'I', 'admin', 0, 0)`);
  db.raw.exec("INSERT INTO activity (id, at, cairo, actor, action) VALUES ('act-old', 1, '2026-01-01 00:00', 'x', 'old')");
  apply(db, '0009_admin_grants_notify.sql');
  const of = e => db.raw.prepare('SELECT perm, scope FROM admin_grants WHERE email = ? ORDER BY perm').all(e);
  const p = of('p@example.com');
  assert.deepEqual(p.map(r => r.perm), [...PERMS].sort(), 'the SQL seed list equals the code catalog');
  assert.ok(p.every(r => r.scope === 'all'));
  assert.deepEqual(of('a@example.com').map(r => r.perm), PERMS.filter(x => !PRIMARY_DEFAULT.includes(x)).sort());
  assert.equal(of('i@example.com').length, 0);
  const old = db.raw.prepare("SELECT notified, severity, source FROM activity WHERE id = 'act-old'").get();
  assert.deepEqual({ ...old }, { notified: 1, severity: 'routine', source: 'worker' });
});

test('0009 schema constraints: outbox dedupe_key UNIQUE, CHECKs on scope / channel / status', () => {
  const db = migratedDb();
  const ob = "INSERT INTO notify_outbox (id, dedupe_key, recipient, channel, kind, activity_ids, created_ms) VALUES (?, ?, 'a@x.com', ?, 'k', '[]', 0)";
  db.raw.prepare(ob).run('o1', 'k:e:a:1', 'email');
  assert.throws(() => db.raw.prepare(ob).run('o2', 'k:e:a:1', 'push'), /UNIQUE/);
  assert.throws(() => db.raw.prepare(ob).run('o3', 'k:e:a:2', 'sms'), /CHECK/);
  assert.throws(() => db.raw.prepare("UPDATE notify_outbox SET status = 'lost' WHERE id = 'o1'").run(), /CHECK/);
  assert.throws(() => db.raw.prepare("INSERT INTO admin_grants (email, perm, scope, granted_by, granted_at) VALUES ('a', 'bookings.view', 'event', 't', 0)").run(), /CHECK/);
  assert.throws(() => db.raw.prepare("INSERT INTO notify_prefs (email, type, channel, mode, updated_at) VALUES ('a', 't', 'email', 'sometimes', 0)").run(), /CHECK/);
});

// ---------- route → permission table ----------

test('every admin route has exactly one mapping to catalog permissions; no stale mappings', () => {
  const admin = ROUTES.filter(r => r.auth === 'admin');
  for (const r of admin) assert.notEqual(routePerm(r), undefined, 'unmapped: ' + r.method + ' ' + r.path);
  const keys = new Set(admin.map(r => r.method + ' ' + r.path));
  for (const k of Object.keys(ROUTE_PERMS)) assert.ok(keys.has(k), 'stale mapping: ' + k);
  for (const v of Object.values(ROUTE_PERMS)) for (const p of [].concat(v)) assert.ok(p === ANY_ADMIN || PERMS.includes(p), p);
  // no non-admin route is in the table (public / sync routes never need a grant)
  for (const r of ROUTES.filter(r => r.auth !== 'admin')) assert.equal(routePerm(r), undefined, r.path);
});

test('money routes need the money permissions (§4.2, §4.7)', () => {
  assert.deepEqual(ROUTE_PERMS['POST /v1/admin/book/bookings/:id/payments'], ['bookings.approve', 'finance.manage']);
  assert.equal(ROUTE_PERMS['POST /v1/admin/book/payments/:id/void'], 'finance.manage');
  assert.equal(ROUTE_PERMS['POST /v1/admin/book/bookings'], 'bookings.create_cash');
  assert.equal(ROUTE_PERMS['POST /v1/admin/book/bookings/:id/confirm'], 'bookings.approve');
  assert.equal(ROUTE_PERMS['GET /v1/admin/book/export'], 'exports.export');
});

// ---------- requirePerm matrix ----------

test('PERMS_ENFORCE=0: every admin holds everything except the Primary defaults (today\'s access)', async () => {
  const db = migratedDb();
  await addAdmin(db, 'a@example.com');
  for (const p of PERMS) {
    const ctx = ctxFor(db, 'a@example.com');
    if (PRIMARY_DEFAULT.includes(p)) await denied(requirePerm(ctx, p), p);
    else assert.deepEqual(await requirePerm(ctx, p), { perm: p, scope: 'all', servantId: null }, p);
  }
  await grant(db, 'a@example.com', 'accounts.manage');
  assert.equal((await requirePerm(ctxFor(db, 'a@example.com'), 'accounts.manage')).scope, 'all', 'an explicit grant counts');
});

test('PERMS_ENFORCE=1: grants only; list = all of them; unknown keys refused', async () => {
  const db = migratedDb();
  await addAdmin(db, 'a@example.com');
  await setEnforce(db, '1');
  for (const p of PERMS) await denied(requirePerm(ctxFor(db, 'a@example.com'), p), p);
  await grant(db, 'a@example.com', 'bookings.view');
  await grant(db, 'a@example.com', 'bookings.approve');
  assert.equal((await requirePerm(ctxFor(db, 'a@example.com'), 'bookings.view')).scope, 'all');
  await denied(requirePerm(ctxFor(db, 'a@example.com'), 'bookings.manage'), 'bookings.manage');
  await denied(requirePerm(ctxFor(db, 'a@example.com'), ['bookings.approve', 'finance.manage']), 'finance.manage');
  await grant(db, 'a@example.com', 'finance.manage');
  assert.equal((await requirePerm(ctxFor(db, 'a@example.com'), ['bookings.approve', 'finance.manage'])).scope, 'all');
  await denied(requirePerm(ctxFor(db, 'a@example.com'), 'bookings.fly'));
  await denied(requirePerm(ctxFor(db, 'a@example.com'), []));
  assert.equal((await requirePerm(ctxFor(db, 'a@example.com'), ANY_ADMIN)).scope, 'all');
});

test('Primary Admin holds every permission, enforced or not, with no grant rows', async () => {
  const db = migratedDb();
  await addAdmin(db, 'p@example.com', 'primary');
  for (const v of ['0', '1']) {
    await setEnforce(db, v);
    for (const p of PERMS) assert.equal((await requirePerm(ctxFor(db, 'p@example.com', 'primary'), p, { scope: 'all' })).scope, 'all', v + ' ' + p);
  }
});

test('scope: own needs a linked servant; a request needing all refuses an own grant', async () => {
  const db = migratedDb();
  await addAdmin(db, 'a@example.com');
  await addAdmin(db, 's@example.com', 'admin', 'srv-aaaa1111');
  await setEnforce(db, '1');
  await grant(db, 'a@example.com', 'bookings.create_cash', 'own');
  await grant(db, 's@example.com', 'bookings.create_cash', 'own');
  await grant(db, 's@example.com', 'bookings.view', 'all');
  await denied(requirePerm(ctxFor(db, 'a@example.com'), 'bookings.create_cash'), 'bookings.create_cash');
  assert.deepEqual(await requirePerm(ctxFor(db, 's@example.com'), 'bookings.create_cash'), { perm: 'bookings.create_cash', scope: 'own', servantId: 'srv-aaaa1111' });
  await denied(requirePerm(ctxFor(db, 's@example.com'), 'bookings.create_cash', { scope: 'all' }), 'bookings.create_cash');
  assert.equal((await requirePerm(ctxFor(db, 's@example.com'), 'bookings.view', { scope: 'all' })).scope, 'all');
  // a mixed list is limited by its narrowest grant
  assert.equal((await requirePerm(ctxFor(db, 's@example.com'), ['bookings.view', 'bookings.create_cash'])).scope, 'own');
});

test('one grants read per request (ctx cache); no actor → auth', async () => {
  const db = migratedDb();
  await addAdmin(db, 'a@example.com');
  let reads = 0;
  const orig = db.prepare.bind(db);
  db.prepare = sql => { if (/admin_grants/.test(sql)) reads++; return orig(sql); };
  const ctx = ctxFor(db, 'a@example.com');
  await requirePerm(ctx, 'bookings.view');
  await requirePerm(ctx, 'finance.view');
  assert.equal(reads, 1);
  await assert.rejects(requirePerm({ env: { DB: db }, actor: null }, 'bookings.view'), e => e.code === 'auth');
});

// ---------- end to end through the Worker ----------

test('HTTP: switch off = today; on = route grants checked per request, revocation immediate; whoami always', async () => {
  const g = await fakeGoogle();
  const h = harness();
  const auth = async () => ({ authorization: 'Bearer ' + await g.sign(g.claims()) });
  const get = async p => h.call(p, { headers: await auth(), fetch: g.fetch });

  assert.equal((await get('/v1/admin/activity')).status, 200, 'switch off: a bootstrap admin keeps access');
  await setEnforce(h.db, '1');
  assert.equal((await get('/v1/admin/whoami')).status, 200);
  const r = await get('/v1/admin/activity');
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'denied');
  assert.equal(r.body.perm, 'activity.view');
  await grant(h.db, 'admin@example.com', 'activity.view');
  assert.equal((await get('/v1/admin/activity')).status, 200);
  await h.db.prepare("DELETE FROM admin_grants WHERE email = 'admin@example.com'").run();
  assert.equal((await get('/v1/admin/activity')).status, 403, 'revoked at the next request');
  await setEnforce(h.db, '0');
  assert.equal((await get('/v1/admin/activity')).status, 200, 'rollback: switch off restores access');
});

test('HTTP: Primary-only handler checks still apply on top of grants (module switch)', async () => {
  const g = await fakeGoogle();
  const h = harness();
  const post = async (p, body) => h.call(p, { method: 'POST', body, headers: { authorization: 'Bearer ' + await g.sign(g.claims()) }, fetch: g.fetch });
  await setEnforce(h.db, '1');
  await grant(h.db, 'admin@example.com', 'bookings.manage');
  assert.equal((await post('/v1/admin/book/module', { on: false })).status, 403, 'a granted non-primary admin still cannot switch it');
  await h.db.prepare("INSERT INTO admins (email, role, active, created_at) VALUES ('admin@example.com', 'primary', 1, 0) ON CONFLICT(email) DO UPDATE SET role = 'primary'").run();
  assert.equal((await post('/v1/admin/book/module', { on: false })).status, 200);
});

// ---------- step 2: /v1/sync/grants, route scope, cash rules (§4.2) ----------

async function syncGrants(h, { ts = Date.now(), secret = 'sync-test-secret' } = {}) {
  const raw = '{"v":1}';
  return h.call('/v1/sync/grants', { method: 'POST', body: raw, headers: { 'x-sync-ts': String(ts), 'x-sync-signature': await signSync(secret, String(ts), raw) } });
}

test('sync/grants: signed only, no replays; active admins with one letter per permission; switch + allowlist stamp', async () => {
  const h = harness();
  await addAdmin(h.db, 'p@example.com', 'primary');
  await addAdmin(h.db, 'a@example.com', 'admin', 'srv-1');
  await h.db.prepare("INSERT INTO admins (email, role, active, created_at) VALUES ('gone@example.com', 'admin', 0, 0)").run();
  await grant(h.db, 'a@example.com', 'bookings.view');
  await grant(h.db, 'a@example.com', 'bookings.create_cash', 'own');
  await grant(h.db, 'gone@example.com', 'bookings.view');
  await h.db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('SYNC_TS_admins', '1234', 0)").run();

  assert.equal((await syncGrants(h, { secret: 'wrong' })).status, 401);
  const t = Date.now();
  const r = await syncGrants(h, { ts: t });
  assert.equal(r.status, 200);
  assert.equal(r.body.v, 1);
  assert.equal(r.body.enforce, false);
  assert.equal(r.body.adminsSyncTs, 1234);
  assert.deepEqual(r.body.perms, [...PERMS]);
  assert.deepEqual(r.body.primaryDefault, [...PRIMARY_DEFAULT]);
  assert.deepEqual(r.body.admins.map(a => a.email), ['a@example.com', 'p@example.com'], 'inactive left out');
  const a = r.body.admins[0];
  assert.equal(a.servantId, 'srv-1');
  assert.equal(a.g.length, PERMS.length);
  assert.equal(a.g[PERMS.indexOf('bookings.view')], 'A');
  assert.equal(a.g[PERMS.indexOf('bookings.create_cash')], 'O');
  assert.equal(a.g.replace(/-/g, '').length, 2);
  assert.equal(r.body.admins[1].primary, true);
  assert.equal((await syncGrants(h, { ts: t })).status, 409, 'replay refused');
  await setEnforce(h.db, '1');
  assert.equal((await syncGrants(h, { ts: t + 1 })).body.enforce, true);
});

test('route scope: an own grant passes only routes whose handler limits itself (cash create)', async () => {
  const db = migratedDb();
  await addAdmin(db, 's@example.com', 'admin', 'srv-1');
  await setEnforce(db, '1');
  await grant(db, 's@example.com', 'bookings.view', 'own');
  await grant(db, 's@example.com', 'bookings.create_cash', 'own');
  const route = (method, path) => ({ method, path });
  await denied(requireRoutePerm(ctxFor(db, 's@example.com'), route('GET', '/v1/admin/book/bookings')), 'bookings.view');
  assert.deepEqual(await requireRoutePerm(ctxFor(db, 's@example.com'), route('POST', '/v1/admin/book/bookings')), { perm: 'bookings.create_cash', scope: 'own', servantId: 'srv-1' });
  assert.deepEqual(OWN_SCOPE_ROUTES, ['POST /v1/admin/book/bookings']);
});

test('cash create (§4.2): create_cash alone = pending only; confirm needs approve; own servant unless finance.manage', async () => {
  const w = await bookWorld();
  const phone = () => '010' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
  await w.db.prepare("INSERT INTO admins (email, name, role, active, created_at, servant_id) VALUES ('admin@example.com', 'A', 'admin', 1, 0, 'srv-bbbb2222')").run();
  await setEnforce(w.db, '1');
  await grant(w.db, 'admin@example.com', 'bookings.create_cash', 'own');
  const form = (over = {}) => ({ eventId: 'evt-alex01', requestKey: w.key('c'), name: 'حجز كاش', phone: phone(), counts: { applicant: 1 }, servantId: 'srv-bbbb2222', method: 'cash', ...over });

  const pending = await w.admin('POST', '/v1/admin/book/bookings', form({ payments: [pay({ amount: 500, servantId: 'srv-bbbb2222' })] }));
  assert.equal(pending.status, 200, JSON.stringify(pending.body));
  assert.equal(pending.body.booking.status, 'pending');

  const other = await w.admin('POST', '/v1/admin/book/bookings', form({ payments: [pay({ amount: 500, servantId: 'srv-aaaa1111' })] }));
  assert.equal(other.status, 403, 'another servant\'s money needs finance.manage');
  assert.equal(other.body.perm, 'finance.manage');

  const confirm = await w.admin('POST', '/v1/admin/book/bookings', form({ confirm: { payments: [pay({ amount: 1500, servantId: 'srv-bbbb2222' })] } }));
  assert.equal(confirm.status, 403);
  assert.equal(confirm.body.perm, 'bookings.approve');

  await grant(w.db, 'admin@example.com', 'bookings.approve');
  await grant(w.db, 'admin@example.com', 'finance.manage');
  const both = await w.admin('POST', '/v1/admin/book/bookings', form({ confirm: { payments: [pay({ amount: 1500, servantId: 'srv-aaaa1111' })] } }));
  assert.equal(both.status, 200, JSON.stringify(both.body));
  assert.equal(both.body.booking.status, 'confirmed');
});
