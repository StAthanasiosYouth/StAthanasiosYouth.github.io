// Phase 6 Step 5 (docs/PHASE6-PLAN.md): the panel's settings and tools calls on the Worker (src/admin/tools.js),
// with Apps Script's answers, against fake GitHub, Google Maps and file hosts. Real SQLite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, fakeGoogle, fakeR2, jpegBytes } from './helpers.mjs';
import { ROUTE_PERMS } from '../src/lib/perms.js';
import { isGoogleMapsUrl, coordsFromMapsUrl, sniffMedia } from '../src/admin/tools.js';

const P = 'p@example.com';
const S = 's@example.com';

function fakeGithub() {
  const log = [];
  let head = 'a'.repeat(40);
  const f = async (url, init = {}) => {
    const u = String(url);
    const method = init.method || 'GET';
    log.push(method + ' ' + u.replace('https://api.github.com/repos/o/r', ''));
    if (u === 'https://api.github.com/repos/o/r') return Response.json({ full_name: 'o/r', has_pages: true });
    if (/\/branches\//.test(u)) return Response.json({ commit: { sha: head, commit: { tree: { sha: 'tree0' } } } });
    if (/\/git\/trees\/tree0$/.test(u)) return Response.json({ tree: [{ path: 'index.html', mode: '100644', type: 'blob', sha: 'b1' }] });
    if (/\/git\/trees$/.test(u)) {
      const body = JSON.parse(init.body);
      return Response.json({ sha: body.tree.some(e => e.content) ? 'tree1' : 'tree0' });
    }
    if (/\/git\/commits$/.test(u)) { log.body = JSON.parse(init.body); return Response.json({ sha: 'c'.repeat(40) }); }
    if (/\/git\/refs\/heads\//.test(u)) { head = 'c'.repeat(40); return Response.json({}); }
    return new Response('{}', { status: 404 });
  };
  return { f, log };
}

async function world(env = {}) {
  const g = await fakeGoogle();
  const h = harness({ env: { ADMIN_EMAILS: '', GITHUB_REPO: 'o/r', GITHUB_TOKEN: 'gh-test', ENVIRONMENT: 'production', MEDIA: fakeR2(), ...env } });
  await h.db.prepare(`INSERT INTO admins (email, name, role, active, created_at) VALUES ('${P}', 'مينا', 'primary', 1, 0), ('${S}', NULL, 'admin', 1, 0)`).run();
  const call = async (email, path, body, outside) => h.call('/v1/admin/' + path, {
    method: body === undefined ? 'GET' : 'POST', body,
    headers: { authorization: 'Bearer ' + await g.sign(g.claims({ email, sub: 's-' + email })) },
    fetch: async (u, i) => (String(u).includes('googleapis.com/oauth2') || String(u).includes('/certs') ? g.fetch(u, i) : outside(u, i))
  });
  return { h, call };
}

test('the routes carry Apps Script\'s permissions (Grants.gs API_PERMS)', () => {
  assert.equal(ROUTE_PERMS['POST /v1/admin/tools/github'], 'system.view');
  assert.equal(ROUTE_PERMS['POST /v1/admin/tools/media'], 'media.view');
  assert.equal(ROUTE_PERMS['POST /v1/admin/tools/maps'], 'content.edit');
  assert.equal(ROUTE_PERMS['POST /v1/admin/tools/fetch-media'], 'media.add');
  assert.equal(ROUTE_PERMS['POST /v1/admin/tools/live-stage'], 'content.edit');
  assert.equal(ROUTE_PERMS['POST /v1/admin/tools/migrate'], 'system.manage');
  assert.equal(ROUTE_PERMS['POST /v1/admin/tools/admins'], 'accounts.view');
});

test('GitHub: the repository, the head, Pages; a write is proved without a commit', async () => {
  const w = await world();
  const { f, log } = fakeGithub();
  const r = await w.call(P, 'tools/github', {}, f);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.repo, r.body.branch, r.body.head, r.body.pages, r.body.canPush], ['o/r', 'main', 'aaaaaaa', true, true]);
  assert.ok(!log.some(l => /commits|refs/.test(l)), 'nothing committed');
  const none = await world({ GITHUB_TOKEN: '' });
  assert.equal((await none.call(P, 'tools/github', {}, f)).body.code, 'disabled');
});

test('the media check: R2 write, read, delete; the library; the site\'s copy — every step named', async () => {
  const w = await world();
  const r = await w.call(P, 'tools/media', {}, fakeGithub().f);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ok, true);
  assert.equal(r.body.steps.length, 6);
  assert.ok(r.body.steps.every(s => s.ok));
  const broken = await world({ MEDIA: undefined });
  const b = await broken.call(P, 'tools/media', {}, fakeGithub().f);
  assert.equal(b.body.ok, false);
  assert.equal(b.body.steps.length, 1, 'stops at the first failed step');
});

test('Google Maps: coordinates from the link, or through Google\'s redirects only', async () => {
  assert.equal(isGoogleMapsUrl('https://maps.app.goo.gl/abc'), true);
  assert.equal(isGoogleMapsUrl('https://evil.example/maps'), false);
  assert.deepEqual(coordsFromMapsUrl('https://www.google.com/maps/place/x/@27.25,33.81,15z'), { lat: 27.25, lng: 33.81 });
  const w = await world();
  const hops = async u => (String(u).startsWith('https://maps.app.goo.gl/')
    ? new Response(null, { status: 302, headers: { location: 'https://www.google.com/maps/place/!3d26.5!4d34.1' } })
    : new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }));
  const r = await w.call(P, 'tools/maps', { url: 'https://maps.app.goo.gl/abc' }, hops);
  assert.deepEqual([r.body.lat, r.body.lng], [26.5, 34.1]);
  assert.equal((await w.call(P, 'tools/maps', { url: 'https://example.com/' }, hops)).status, 400);
  assert.equal((await w.call(P, 'tools/maps', { url: 'https://goo.gl/maps/x' }, hops)).status, 400, 'a redirect off Google is not followed');
});

test('a picture by its link: what it really is, its size, never a page or a local address', async () => {
  const w = await world();
  const jpg = jpegBytes(64, 64, 50);
  const host = async u => (String(u).includes('page')
    ? new Response('<html>', { headers: { 'content-type': 'text/html' } })
    : new Response(jpg, { headers: { 'content-type': 'image/jpeg' } }));
  const r = await w.call(P, 'tools/fetch-media', { url: 'https://cdn.example.com/a/%D8%B5%D9%88%D8%B1%D8%A9.jpg' }, host);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.mime, r.body.name, r.body.bytes], ['image/jpeg', 'صورة', jpg.length]);
  assert.equal(Buffer.from(r.body.base64, 'base64').length, jpg.length);
  for (const url of ['http://cdn.example.com/a.jpg', 'https://localhost/a.jpg', 'https://10.0.0.1/a.jpg', 'https://u:p@x.com/a.jpg', 'https://www.youtube.com/watch?v=1', 'https://cdn.example.com/page']) {
    assert.equal((await w.call(P, 'tools/fetch-media', { url }, host)).status, 400, url);
  }
  assert.equal(sniffMedia(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0])), 'video/webm');
});

test('the live stage: the session\'s program decides; live.json is committed alone; the panel\'s copy is kept', async () => {
  const w = await world();
  await w.h.db.prepare("INSERT INTO draft_rows (kind, id, pos, kver, data, hash, updated_ms) VALUES ('sessions', '2026-11-08', 0, 1, ?, 'h', 0)")
    .bind(JSON.stringify({ date: '2026-11-08', program: JSON.stringify([{ title: 'ترانيم' }, { title: 'كلمة' }]) })).run();
  const { f, log } = fakeGithub();
  const r = await w.call(P, 'tools/live-stage', { date: '2026-11-08', stage: 1 }, f);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.live.date, r.body.live.stage, r.body.commit.length], ['2026-11-08', 1, 40]);
  assert.match(log.body.message, /stage 2/);
  const kept = JSON.parse(await w.h.db.prepare("SELECT value FROM settings WHERE key = 'LIVE_STATE'").first('value'));
  assert.equal(kept.stage, 1);
  assert.equal((await w.call(P, 'tools/live-stage', { date: '2026-11-08', stage: 5 }, f)).status, 400, 'no fifth stage');
  assert.equal((await w.call(P, 'tools/live-stage', { date: '2026-11-09', stage: 0 }, f)).status, 400, 'no such meeting');
  assert.equal((await w.call(P, 'tools/live-stage', { date: '2026-11-08', stage: null }, f)).body.live.stage, null, 'back to automatic');
});

test('the Sheets\' upgrade is finished; the admins list comes from D1 in Apps Script\'s shape', async () => {
  const w = await world();
  const plan = await w.call(P, 'tools/migration', {}, fakeGithub().f);
  assert.deepEqual([plan.body.pending, plan.body.steps[0].needed], [false, false]);
  assert.equal((await w.call(P, 'tools/migrate', {}, fakeGithub().f)).status, 409);
  const list = await w.call(S, 'tools/admins', {}, fakeGithub().f);
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.deepEqual(list.body.emails, [P, S]);
  assert.deepEqual([list.body.names[P], list.body.names[S], list.body.stored[S], list.body.primary, list.body.me, list.body.max], ['مينا', 's', undefined, P, S, 20]);
});
