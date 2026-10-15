import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, fakeGoogle, jpegBytes, webpBytes } from './helpers.mjs';
import { sniffImage } from '../src/lib/image.js';
import { sweepProofs, putProof } from '../src/lib/proofs.js';
import { signSync } from '../src/lib/sync.js';

async function admin(h, g, extra = {}) {
  return { authorization: 'Bearer ' + await g.sign(g.claims()), ...extra };
}

test('image sniffing: type from the bytes, size from the header; others refused', () => {
  assert.deepEqual(sniffImage(jpegBytes(1200, 900)), { mime: 'image/jpeg', width: 1200, height: 900 });
  assert.deepEqual(sniffImage(webpBytes(640, 2400)), { mime: 'image/webp', width: 640, height: 2400 });
  const png = new Uint8Array(64); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(sniffImage(png), null);
  assert.equal(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null);
  assert.equal(sniffImage(jpegBytes().slice(0, 20)), null);
});

test('upload → read → delete, all behind admin auth; no public URL anywhere', async () => {
  const g = await fakeGoogle();
  const h = harness();
  const bytes = jpegBytes(1000, 750);

  const anon = await h.call('/v1/admin/proofs?purpose=test', { method: 'POST', body: bytes, headers: { 'idempotency-key': 'up-00000001' } });
  assert.equal(anon.status, 401);

  const up = await h.call('/v1/admin/proofs?purpose=test', { method: 'POST', body: bytes, headers: await admin(h, g, { 'idempotency-key': 'up-00000001', 'content-type': 'image/png' }), fetch: g.fetch });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const p = up.body.proof;
  assert.match(p.id, /^prf-[a-z2-7]{8}$/);
  assert.equal(p.mime, 'image/jpeg', 'type from the bytes, not the header');
  assert.equal(p.bytes, bytes.length);
  assert.equal(p.width, 1000);
  assert.ok(!JSON.stringify(up.body).match(/r2\.dev|https?:\/\/|proofs\//), 'no URL or storage key in the reply');

  const row = await h.db.prepare('SELECT * FROM proofs WHERE id = ?').bind(p.id).first();
  assert.equal(row.sha256.length, 64);
  assert.ok(h.env.PROOFS.objects.has(row.r2_key), 'bytes only in R2');
  assert.ok(!('bytes_data' in row) && Object.values(row).every(v => !(v instanceof Uint8Array)), 'no bytes in D1');

  const anonRead = await h.call('/v1/admin/proofs/' + p.id);
  assert.equal(anonRead.status, 401);
  const read = await h.call('/v1/admin/proofs/' + p.id, { headers: await admin(h, g), fetch: g.fetch });
  assert.equal(read.status, 200);
  assert.deepEqual(read.bytes, bytes);
  assert.equal(read.headers.get('content-type'), 'image/jpeg');
  assert.equal(read.headers.get('cache-control'), 'private, no-store');
  assert.match(read.headers.get('content-security-policy'), /sandbox/);
  assert.equal(read.headers.get('x-content-type-options'), 'nosniff');

  const del = await h.call('/v1/admin/proofs/' + p.id, { method: 'DELETE', headers: await admin(h, g), fetch: g.fetch });
  assert.equal(del.body.deleted, true);
  assert.equal(h.env.PROOFS.objects.size, 0, 'file gone');
  const kept = await h.db.prepare('SELECT deleted_at, deleted_by FROM proofs WHERE id = ?').bind(p.id).first();
  assert.ok(kept.deleted_at && kept.deleted_by === 'admin@example.com', 'row kept for accounting');
  const again = await h.call('/v1/admin/proofs/' + p.id, { method: 'DELETE', headers: await admin(h, g), fetch: g.fetch });
  assert.equal(again.body.deleted, false, 'idempotent');
  assert.equal((await h.call('/v1/admin/proofs/' + p.id, { headers: await admin(h, g), fetch: g.fetch })).status, 404);
  const acts = (await h.db.prepare("SELECT action FROM activity WHERE entity_type = 'proof' ORDER BY at").all()).results.map(r => r.action);
  assert.deepEqual(acts, ['proof.upload', 'proof.delete']);
});

test('upload is idempotent per key; same image twice under new keys is flagged as duplicate', async () => {
  const g = await fakeGoogle();
  const h = harness();
  const bytes = webpBytes();
  const a = await h.call('/v1/admin/proofs?purpose=test', { method: 'POST', body: bytes, headers: await admin(h, g, { 'idempotency-key': 'k-same-0001' }), fetch: g.fetch });
  const b = await h.call('/v1/admin/proofs?purpose=test', { method: 'POST', body: bytes, headers: await admin(h, g, { 'idempotency-key': 'k-same-0001' }), fetch: g.fetch });
  assert.equal(b.headers.get('idempotency-replayed'), '1');
  assert.equal(b.body.proof.id, a.body.proof.id);
  assert.equal(h.env.PROOFS.objects.size, 1, 'one object for one key');
  const c = await h.call('/v1/admin/proofs?purpose=test', { method: 'POST', body: bytes, headers: await admin(h, g, { 'idempotency-key': 'k-other-0001' }), fetch: g.fetch });
  assert.deepEqual(c.body.duplicates, [a.body.proof.id]);
  const conflict = await h.call('/v1/admin/proofs?purpose=test', { method: 'POST', body: jpegBytes(), headers: await admin(h, g, { 'idempotency-key': 'k-same-0001' }), fetch: g.fetch });
  assert.equal(conflict.status, 409);
});

test('upload refusals: not an image, too big, too many pixels, wrong purpose, test retention outside staging', async () => {
  const g = await fakeGoogle();
  const h = harness();
  const up = async (body, extra = {}, q = 'purpose=test') => h.call('/v1/admin/proofs?' + q, { method: 'POST', body, headers: await admin(h, g, { 'idempotency-key': 'k-' + Math.random().toString(36).slice(2, 12), ...extra }), fetch: g.fetch });
  assert.equal((await up(new TextEncoder().encode('x'.repeat(100)))).status, 400);
  assert.equal((await up(jpegBytes(800, 600, 950 * 1024))).status, 413);
  assert.equal((await up(jpegBytes(3000, 600))).status, 400);
  assert.equal((await up(jpegBytes(), {}, 'purpose=booking')).status, 400, 'booking proofs come with the pilot routes');
  assert.equal((await up(jpegBytes(), { 'x-test-retention-ms': '1000' })).status, 400, 'short retention: staging only');
  assert.equal(h.env.PROOFS.objects.size, 0);
});

test('R2 written but D1 fails → object removed; D1 committed but reply lost → object kept', async () => {
  const h = harness();
  h.db.failNext = 0;
  const orig = h.env.DB.batch.bind(h.env.DB);
  h.env.DB.batch = async () => { throw new Error('UNIQUE constraint failed: boom'); };
  await assert.rejects(putProof(h.env, { bytes: jpegBytes(), purpose: 'test', by: 'a' }));
  assert.equal(h.env.PROOFS.objects.size, 0, 'compensated');

  h.env.DB.batch = async stmts => { await orig(stmts); throw new Error('D1_ERROR: Network connection lost.'); };
  const out = await putProof(h.env, { bytes: jpegBytes(), purpose: 'test', by: 'a' }).catch(e => e);
  h.env.DB.batch = orig;
  assert.equal(h.env.PROOFS.objects.size, 1, 'its own row exists: the file stays');
  assert.ok(out.proof, 'and the call succeeds');
});

test('retention: expired files deleted + rows marked; orphans older than 24 h deleted; fresh ones kept', async () => {
  const h = harness();
  const now = Date.now();
  const old = await putProof(h.env, { bytes: jpegBytes(), purpose: 'test', by: 'a', deleteAfterMs: now - 1000 });
  const live = await putProof(h.env, { bytes: webpBytes(), purpose: 'test', by: 'a' });
  await h.env.PROOFS.put('proofs/2026/01/prf-orphan01', jpegBytes(), { __uploaded: new Date(now - 2 * 86400e3) });
  await h.env.PROOFS.put('proofs/2026/10/prf-orphan02', jpegBytes(), { __uploaded: new Date(now - 3600e3) });

  const r = await sweepProofs(h.env, { now });
  assert.deepEqual(r, { expired: 1, orphans: 1 });
  const keys = [...h.env.PROOFS.objects.keys()];
  assert.ok(!keys.some(k => k.endsWith(old.proof.id)), 'expired file gone');
  assert.ok(keys.some(k => k.endsWith(live.proof.id)), 'live file kept');
  assert.ok(!keys.includes('proofs/2026/01/prf-orphan01'), 'old orphan gone');
  assert.ok(keys.includes('proofs/2026/10/prf-orphan02'), 'young orphan kept (its row may still be on the way)');
  const row = await h.db.prepare('SELECT deleted_by FROM proofs WHERE id = ?').bind(old.proof.id).first();
  assert.equal(row.deleted_by, 'retention');
  assert.deepEqual(await sweepProofs(h.env, { now }), { expired: 0, orphans: 0 }, 'idempotent');
});

test('deep health: storage ok via a read-only probe; nothing written to R2', async () => {
  const h = harness();
  const r = await h.call('/v1/health/deep');
  assert.equal(r.body.storage, 'ok');
  assert.equal(h.env.PROOFS.objects.size, 0);
  const none = harness({ env: { PROOFS: undefined } });
  assert.equal((await none.call('/v1/health/deep')).body.storage, 'not-configured');
});

// ---------- admin allowlist sync (Apps Script → Worker) ----------

async function sync(h, body, { ts = Date.now(), secret = 'sync-test-secret' } = {}) {
  const raw = JSON.stringify(body);
  return h.call('/v1/sync/admins', { method: 'POST', body: raw, headers: { 'x-sync-ts': String(ts), 'x-sync-signature': await signSync(secret, String(ts), raw) } });
}

test('admin sync: signed list becomes the allowlist; removed admins deactivated; sub binding kept', async () => {
  const g = await fakeGoogle();
  const h = harness({ env: { ADMIN_EMAILS: '' } });
  const t = Date.now();
  const r = await sync(h, { admins: [{ email: 'Admin@Example.com', name: 'مينا', primary: true }, { email: 'b@example.com', name: 'B' }] }, { ts: t });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await h.call('/v1/admin/whoami', { headers: await admin(h, g), fetch: g.fetch })).status, 200, 'synced admin can sign in');
  const bound = await h.db.prepare("SELECT google_sub, role FROM admins WHERE email = 'admin@example.com'").first();
  assert.equal(bound.google_sub, '1001');
  assert.equal(bound.role, 'primary');

  // B removed in Apps Script → inactive here; A's binding untouched
  await sync(h, { admins: [{ email: 'admin@example.com', name: 'مينا', primary: true }] }, { ts: t + 1 });
  const b = await h.db.prepare("SELECT active FROM admins WHERE email = 'b@example.com'").first();
  assert.equal(b.active, 0);
  assert.equal((await h.db.prepare("SELECT google_sub FROM admins WHERE email = 'admin@example.com'").first()).google_sub, '1001');
  const deep = await h.call('/v1/health/deep');
  assert.equal(deep.body.admins.active, 1);
  assert.equal(deep.body.admins.syncedAt, t + 1);
});

test('admin sync refusals: bad signature, wrong secret, old/future ts, replay, empty list, no primary', async () => {
  const h = harness();
  const list = { admins: [{ email: 'a@example.com', primary: true }] };
  const raw = JSON.stringify(list);
  const t = Date.now();
  const forged = await h.call('/v1/sync/admins', { method: 'POST', body: raw, headers: { 'x-sync-ts': String(t), 'x-sync-signature': 'v1=' + '0'.repeat(64) } });
  assert.equal(forged.status, 401);
  assert.equal((await sync(h, list, { secret: 'wrong' })).status, 401);
  assert.equal((await sync(h, list, { ts: t - 10 * 60e3 })).status, 401);
  assert.equal((await sync(h, list, { ts: t + 10 * 60e3 })).status, 401);
  assert.equal((await sync(h, list, { ts: t })).status, 200);
  assert.equal((await sync(h, list, { ts: t })).status, 409, 'replay');
  assert.equal((await sync(h, { admins: [] }, { ts: t + 5 })).status, 400);
  assert.equal((await sync(h, { admins: [{ email: 'a@example.com', primary: true }, { email: 'b@example.com', primary: true }] }, { ts: t + 6 })).status, 400, 'at most one primary');
  const noSecret = harness({ env: { SYNC_SECRET: undefined } });
  assert.equal((await sync(noSecret, list)).status, 403, 'disabled without a secret');
});
