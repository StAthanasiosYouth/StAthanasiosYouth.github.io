// Accounts improvements, Step 1: the member's photo, the account's first page, the fixes in points and bookings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, fakeGoogle, webpBytes } from './helpers.mjs';
import { sweepAvatars, AVATAR_MAX_BYTES } from '../src/account/avatar.js';
import { sniffImage } from '../src/lib/image.js';

const KEYS = { PW_PEPPER: 'pepper-test', PW_KEY: Buffer.alloc(32, 7).toString('base64'), OTP_PEPPER: 'otp-test', ACCOUNT_PAD_MS: '0' };

const P = 'p@example.com', A = 'a@example.com';

async function world() {
  const g = await fakeGoogle();
  const h = harness({ env: { ENVIRONMENT: 'staging', ADMIN_EMAILS: '', ...KEYS } });
  await h.db.prepare(`INSERT INTO admins (email, name, role, active, created_at) VALUES ('${P}', 'P', 'primary', 1, 0), ('${A}', 'A', 'admin', 1, 0)`).run();
  await h.db.prepare("UPDATE settings SET value = '1' WHERE key = 'PERMS_ENFORCE'").run();
  await h.db.prepare("UPDATE settings SET value = 'on' WHERE key = 'accounts_mode'").run();
  h.admin = async (email, method, path, body) => h.call(path, { method, body, headers: { authorization: 'Bearer ' + await g.sign(g.claims({ email, sub: 'sub-' + email })) }, fetch: g.fetch });
  h.grant = perm => h.db.prepare("INSERT OR REPLACE INTO admin_grants (email, perm, scope, granted_by, granted_at) VALUES (?, ?, 'all', ?, 0)").bind(A, perm, P).run();
  return h;
}

let serial = 0;
async function member(h, kind) {
  serial++;
  const email = `photo${serial}@staging.invalid`;
  const start = await h.call('/v1/account/register/start', { method: 'POST', body: { email, phone: '010' + String(20000000 + serial), name: 'مينا زكريا عبد المسيح', birthDate: '2000-03-12' } });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const done = await h.call('/v1/account/register/verify', { method: 'POST', body: { pendingId: start.body.pendingId, code: start.body.testCode } });
  const signin = await h.call('/v1/account/signin', { method: 'POST', body: { email, password: done.body.password, shared: kind === 'shared' } });
  assert.equal(signin.status, 200, JSON.stringify(signin.body));
  return { token: signin.body.session.token, id: signin.body.account.id, auth: { authorization: 'Bearer ' + signin.body.session.token } };
}

const webp = (side = 256, pad = 400) => webpBytes(side, side, pad);

const upload = (h, m, bytes) => h.call('/v1/account/avatar', { method: 'POST', body: bytes, headers: m.auth });
const read = (h, headers) => h.call('/v1/account/avatar', { headers });
const objects = async h => (await h.env.PROOFS.list({ prefix: 'avatars/' })).objects.map(o => o.key);

test('the helper builds an image the sniffer accepts', () => {
  assert.deepEqual(sniffImage(webp(256)), { mime: 'image/webp', width: 256, height: 256 });
});

test('photo: add, read, replace (the old file goes), delete; the account says which version', async () => {
  const h = await world();
  const m = await member(h);
  assert.equal((await h.call('/v1/account/me', { headers: m.auth })).body.account.avatar, null);
  assert.equal((await read(h, m.auth)).status, 404);

  const first = await upload(h, m, webp());
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.avatar, 1);
  assert.equal((await h.call('/v1/account/me', { headers: m.auth })).body.account.avatar, 1);
  assert.equal((await objects(h)).length, 1);
  assert.match((await objects(h))[0], /^avatars\/[a-z2-7]{16}$/, 'a random name, nothing about the member');

  const got = await read(h, m.auth);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('content-type'), 'image/webp');
  assert.equal(got.headers.get('x-content-type-options'), 'nosniff');
  assert.match(got.headers.get('content-security-policy'), /sandbox/);
  assert.match(got.headers.get('cache-control'), /private/);

  const same = await read(h, { ...m.auth, 'if-none-match': got.headers.get('etag') });
  assert.equal(same.status, 304);

  assert.equal((await upload(h, m, webp(128))).body.avatar, 2);
  assert.equal((await objects(h)).length, 1, 'the replaced file is gone');

  const del = await h.call('/v1/account/avatar/delete', { method: 'POST', body: {}, headers: m.auth });
  assert.equal(del.body.avatar, null);
  assert.equal((await objects(h)).length, 0);
  assert.equal((await read(h, m.auth)).status, 404);
  assert.equal((await h.call('/v1/account/avatar/delete', { method: 'POST', body: {}, headers: m.auth })).status, 200, 'again: quiet');
  const audit = (await h.db.prepare('SELECT action, actor FROM participant_audit WHERE participant_id = ? ORDER BY at').bind(m.id).all()).results.map(a => a.action);
  assert.ok(audit.includes('avatar.set') && audit.includes('avatar.delete'));
});

test('photo: SVG, HTML, GIF, PNG, oversized, not square, too big in pixels: all refused, nothing stored', async () => {
  const h = await world();
  const m = await member(h);
  const text = t => new TextEncoder().encode(t.padEnd(64));
  const bad = {
    svg: text('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'),
    html: text('<!doctype html><script>alert(1)</script>'),
    gif: text('GIF89a'),
    png: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(60).fill(0)]),
    empty: new Uint8Array(0),
    small: webp(32),
    huge: webp(2048)
  };
  for (const [name, bytes] of Object.entries(bad)) {
    const r = await upload(h, m, bytes);
    assert.equal(r.status, 400, name);
  }
  assert.equal((await upload(h, m, webpBytes(256, 100))).status, 400, 'not square');
  assert.equal((await upload(h, m, webp(256, AVATAR_MAX_BYTES + 1))).status, 413);
  assert.deepEqual(await objects(h), []);
});

test('photo: needs a session; another member never reads it; a shared device caches nothing', async () => {
  const h = await world();
  const a = await member(h);
  const b = await member(h);
  const s = await member(h, 'shared');
  await upload(h, a, webp());
  assert.equal((await h.call('/v1/account/avatar', {})).status, 401);
  assert.equal((await upload(h, { auth: {} }, webp())).status, 401);
  assert.equal((await read(h, b.auth)).status, 404, "b has none, and can't name a's");
  await upload(h, s, webp());
  const shared = await read(h, s.auth);
  assert.match(shared.headers.get('cache-control'), /no-store/);
  const revoked = await h.call('/v1/account/logout', { method: 'POST', body: {}, headers: a.auth });
  assert.equal(revoked.status, 200);
  assert.equal((await read(h, a.auth)).status, 401);
});

test('photo: the limit is per member', async () => {
  const h = await world();
  const m = await member(h);
  let last = 0;
  for (let i = 0; i < 22; i++) last = (await upload(h, m, webp())).status;
  assert.equal(last, 429);
});

test('admin: participants.view sees the photo, participants.edit removes it with a reason, both on the record', async () => {
  const h = await world();
  const m = await member(h);
  await upload(h, m, webp());

  const list = await h.admin(P, 'GET', `/v1/admin/participants/${m.id}`);
  assert.equal(list.status, 200);
  assert.equal(list.body.person.avatar, 1);
  const shown = await h.admin(P, 'GET', `/v1/admin/participants/${m.id}/avatar`);
  assert.equal(shown.status, 200);
  assert.equal(shown.headers.get('content-type'), 'image/webp');
  assert.match(shown.headers.get('cache-control'), /no-store/);

  const noReason = await h.admin(P, 'POST', `/v1/admin/participants/${m.id}/avatar/delete`, {});
  assert.equal(noReason.status, 400);
  assert.equal(noReason.body.field, 'reason');
  const del = await h.admin(P, 'POST', `/v1/admin/participants/${m.id}/avatar/delete`, { reason: 'صورة مش مناسبة' });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal(del.body.person.avatar, null);
  assert.deepEqual(await objects(h), []);
  const row = del.body.audit.find(a => a.action === 'avatar.remove');
  assert.equal(row.reason, 'صورة مش مناسبة');
  const act = await h.db.prepare("SELECT actor, summary, severity FROM activity WHERE action = 'participant.avatar'").first();
  assert.equal(act.summary, 'مسح صورة مشترك');
  assert.equal(act.severity, 'important');
  assert.equal((await read(h, m.auth)).status, 404);
  assert.equal((await upload(h, m, webp())).status, 200, 'the member can add another');
});

test('admin: the routes follow the permissions', async () => {
  const h = await world();
  const m = await member(h);
  await upload(h, m, webp());
  const path = `/v1/admin/participants/${m.id}/avatar`;
  assert.equal((await h.admin(A, 'GET', path)).status, 403, 'nothing granted');
  await h.grant('participants.view');
  assert.equal((await h.admin(A, 'GET', path)).status, 200);
  assert.equal((await h.admin(A, 'POST', path + '/delete', { reason: 'سبب' })).status, 403, 'view is not edit');
  await h.grant('participants.edit');
  assert.equal((await h.admin(A, 'POST', path + '/delete', { reason: 'سبب' })).status, 200);
});

test('sweep: an object no account names goes after a day; a live one stays', async () => {
  const h = await world();
  const m = await member(h);
  await upload(h, m, webp());
  await h.env.PROOFS.put('avatars/orphan', new Uint8Array(4));
  await h.env.PROOFS.put('proofs/2026/10/keep', new Uint8Array(4));
  assert.equal((await sweepAvatars(h.env)).orphans, 0, 'too young');
  assert.equal((await sweepAvatars(h.env, { now: Date.now() + 2 * 24 * 3600 * 1000 })).orphans, 1);
  assert.equal((await objects(h)).length, 1);
  assert.ok(await h.env.PROOFS.head('proofs/2026/10/keep'), 'proofs are not its business');
});

test('summary: a new account reads empty, in one call', async () => {
  const h = await world();
  const m = await member(h);
  const s = await h.call('/v1/account/summary', { headers: m.auth });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal(s.body.account.id, m.id);
  assert.equal(s.body.points.balance, 0);
  assert.equal(s.body.points.frozen, false);
  assert.deepEqual(s.body.bookings.coming, []);
  assert.equal(s.body.results.count, 0);
  assert.equal(s.body.orders.count, 0);
  assert.equal(typeof s.body.store.state, 'string');
  assert.equal((await h.call('/v1/account/summary', {})).status, 401);
});

test('the walkthrough: not seen for a new account; once marked it stays, on any device; needs a session', async () => {
  const h = await world();
  const m = await member(h);
  assert.equal((await h.call('/v1/account/me', { headers: m.auth })).body.account.onboarded, false);
  assert.equal((await h.call('/v1/account/summary', { headers: m.auth })).body.account.onboarded, false);
  assert.equal((await h.call('/v1/account/onboarded', { method: 'POST', body: {} })).status, 401);
  const first = await h.call('/v1/account/onboarded', { method: 'POST', body: {}, headers: m.auth });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const at = (await h.db.prepare('SELECT onboarded_at FROM participants WHERE id = ?').bind(m.id).first()).onboarded_at;
  assert.ok(at > 0);
  assert.equal((await h.call('/v1/account/onboarded', { method: 'POST', body: {}, headers: m.auth })).status, 200, 'again: quiet');
  assert.equal((await h.db.prepare('SELECT onboarded_at FROM participants WHERE id = ?').bind(m.id).first()).onboarded_at, at, 'the first time stays');
  assert.equal((await h.call('/v1/account/summary', { headers: m.auth })).body.account.onboarded, true);
});

test('points: the rows say what they were; the store state comes with them', async () => {
  const h = await world();
  const m = await member(h);
  const now = Date.now();
  await h.db.prepare("INSERT OR IGNORE INTO seasons (id, name, status, created_ms, updated_ms) VALUES ('sea-test-one', 'موسم تجربة', 'active', ?, ?)").bind(now, now).run();
  const season = await h.db.prepare("SELECT id FROM seasons WHERE status = 'active'").first();
  await h.db.prepare("INSERT INTO comp_versions (comp_id, version, slug, def, meta, synced_ms) VALUES ('c1', 'v1', 'bible', '{}', ?, ?)").bind(JSON.stringify({ title: 'مسابقة الكتاب', slug: 'bible' }), now).run();
  await h.db.prepare("INSERT INTO points_ledger (id, participant_id, season_id, amount, kind, ref, comp_id, idem_key, actor, created_ms) VALUES ('led-1', ?, ?, 80, 'competition', 'x:1', 'c1', 'k1', 'system', ?)").bind(m.id, season.id, now).run();
  const p = await h.call('/v1/account/points', { headers: m.auth });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal(p.body.ledger[0].kind, 'competition');
  assert.equal(p.body.ledger[0].title, 'مسابقة الكتاب');
  assert.equal(typeof p.body.store.state, 'string');
  assert.equal((await h.call('/v1/account/summary', { headers: m.auth })).body.points.balance, 80);
});
