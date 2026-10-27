// Phase 4 P4-5: the media library on R2 (src/content/media.js) with the real Media.gs code:
// an upload stores the bytes in R2 (never Drive), the row is the one Apps Script would write,
// the site copy goes to GitHub in the background (then publishedAt), the preview reads R2,
// a purge removes the bytes, and the one-time Drive copy is checked file by file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { harness, fakeGoogle, fakeR2 } from './helpers.mjs';
import { signSync } from '../src/lib/sync.js';
import { mirrorMedia } from '../src/content/media.js';
import { compWorld, adminApi, webp, plain, ADMIN } from '../../tests/fakes/comp.mjs';

const SECRET = 'sync-test-secret';
const REPO = 'StAthanasiosYouth/publish-mirror-staging';
let tick = 0;

/* a GitHub that keeps blobs: { path: bytes(base64) } per commit */
function fakeGitHub() {
  let n = 0;
  const trees = new Map([['t0', {}]]);
  const gh = { head: 'c0', commits: [] };
  const heads = new Map([['c0', 't0']]);
  gh.fetch = async (url, init = {}) => {
    const path = url.replace(`https://api.github.com/repos/${REPO}`, '');
    const body = init.body ? JSON.parse(init.body) : null;
    const json = (status, v) => new Response(JSON.stringify(v), { status });
    if (init.method === 'GET' && path === '/branches/main') return json(200, { commit: { sha: gh.head, commit: { tree: { sha: heads.get(gh.head) } } } });
    if (init.method === 'POST' && path === '/git/blobs') return json(201, { sha: 'blob:' + body.content });
    if (init.method === 'POST' && path === '/git/trees') {
      const files = { ...trees.get(body.base_tree) };
      for (const e of body.tree) files[e.path] = e.sha ? e.sha.slice(5) : Buffer.from(e.content).toString('base64');
      const sha = 't' + (++n);
      trees.set(sha, files);
      return json(201, { sha });
    }
    if (init.method === 'POST' && path === '/git/commits') { const sha = 'c' + (++n); heads.set(sha, body.tree); gh.commits.push({ sha, message: body.message, files: trees.get(body.tree) }); return json(201, { sha }); }
    if (init.method === 'PATCH') { gh.head = body.sha; return json(200, {}); }
    return json(404, { message: 'nope ' + path });
  };
  gh.files = () => trees.get(heads.get(gh.head));
  return gh;
}

async function setup() {
  const world = compWorld();
  const call = adminApi(world);
  const g = await fakeGoogle();
  const gh = fakeGitHub();
  const h = harness({ env: { ADMIN_EMAILS: '', MEDIA: fakeR2(), ENVIRONMENT: 'staging', GITHUB_REPO: REPO, GITHUB_BRANCH: 'main', GITHUB_TOKEN: 'ghp_test', COMPS_SOURCE: 'none', SITE_URL: 'https://stathanasiosyouth.github.io' } });
  await h.db.prepare("INSERT INTO admins (email, name, role, active, created_at) VALUES (?, 'x', 'primary', 1, 0)").bind(ADMIN).run();
  await h.db.prepare("UPDATE settings SET value = '1' WHERE key = 'ADMIN_PLATFORM'").run();
  const sync = async (path, body) => {
    const raw = JSON.stringify(body);
    const ts = String(Date.now() + (++tick));
    return h.call(path, { method: 'POST', body: raw, headers: { 'x-sync-ts': ts, 'x-sync-signature': await signSync(SECRET, ts, raw) } });
  };
  return { world, call, g, gh, h, sync };
}

async function writerOn(s) {
  assert.equal((await s.sync('/v1/sync/content-import', { mode: 'apply', ...plain(s.world.gs.contentExportPayload_()) })).body.state, 'ok');
  await s.h.db.prepare("UPDATE settings SET value = '1' WHERE key = 'CONTENT_DRAFTS'").run();
  const fetch = async (url, init) => (url.startsWith('https://api.github.com/') ? s.gh.fetch(url, init) : s.g.fetch(url, init));
  const start = await s.h.call('/v1/admin/session/start', { method: 'POST', body: { device: 'x', tab: 'tab-aaaaaaaaaaaaaaaa' }, headers: { authorization: 'Bearer ' + await s.g.sign(s.g.claims({ email: ADMIN, sub: 's' })) }, fetch });
  const auth = { authorization: 'Bearer ' + start.body.token };
  return {
    fetch,
    call: (fn, ...args) => s.h.call('/v1/admin/content/call', { method: 'POST', body: { fn, args }, headers: auth, fetch }),
    upload: input => s.h.call('/v1/admin/media/upload', { method: 'POST', body: input, headers: auth, fetch })
  };
}

const picture = fill => ({ full: webp(fill).toString('base64'), thumb: webp(fill + 1).toString('base64'), mime: 'image/webp', width: 1280, height: 720, alt: 'صورة ' + fill });
const mediaRows = async h => (await h.db.prepare("SELECT data FROM draft_rows WHERE kind = 'media' AND deleted_ms IS NULL ORDER BY pos").all()).results.map(r => JSON.parse(r.data));

test('upload: the same row as Apps Script, bytes in R2 (not Drive), the site copy committed in the background, then publishedAt', async () => {
  const s = await setup();
  const gsMedia = s.call('apiUploadMedia', picture(7)).media;
  const gsRow = plain(s.world.gs.readOptionalTable_('Media')).find(r => r.id === gsMedia.id);
  delete gsRow.__row;
  const w = await writerOn(s);

  const r = await w.upload(picture(9));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const m = r.body.result.media;
  assert.match(m.id, /^img-[a-z0-9]{8}$/);
  const row = (await mediaRows(s.h)).find(x => x.id === m.id);
  const sameShape = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, /Id$|^id$|path|thumb|hash|uploadedAt|bytes|alt/.test(k) ? typeof v : v]));
  assert.deepEqual(sameShape(row), sameShape(gsRow), 'the row Apps Script would write (values that differ by picture masked)');
  assert.equal(row.driveId, 'r2:media/' + m.id + '.webp');
  assert.equal(row.thumbDriveId, 'r2:media/' + m.id + '-480.webp');
  assert.equal(row.hash, createHash('sha256').update(webp(9)).digest('hex'));
  assert.deepEqual([...s.h.env.MEDIA.objects.keys()].sort(), ['media/' + m.id + '-480.webp', 'media/' + m.id + '.webp']);
  assert.deepEqual(Buffer.from(s.h.env.MEDIA.objects.get('media/' + m.id + '.webp').bytes), webp(9));
  assert.ok(s.h.sent.some(j => j.type === 'media.mirror'), 'the GitHub copy is queued');

  // the same picture again: the library's own duplicate check, nothing stored twice
  const dup = await w.upload(picture(9));
  assert.equal(dup.body.result.duplicate, true);
  assert.equal(s.h.env.MEDIA.objects.size, 2);

  // the background job: one commit with both files at their site paths, then publishedAt
  const done = await mirrorMedia(s.h.env, s.gh.fetch);
  assert.equal(done.mirrored, 2);
  assert.deepEqual(Object.keys(s.gh.files()).sort(), [row.path, row.thumb].sort());
  assert.equal(s.gh.files()[row.path], webp(9).toString('base64'));
  assert.ok((await mediaRows(s.h)).find(x => x.id === m.id).publishedAt, 'publishedAt once on the site');
  assert.equal((await mirrorMedia(s.h.env, s.gh.fetch)).mirrored, 0, 'idempotent');
  // the kind's hash still describes its rows (what the reverse export and the integrity checks compare)
  const { exportDrafts } = await import('../src/content/store.js');
  const exp = await exportDrafts(s.h.db);
  const kind = await s.h.db.prepare("SELECT hash FROM draft_kinds WHERE kind = 'media'").first();
  assert.equal(kind.hash, exp.media.hash, 'draft_kinds.hash = the rows after the background update');

  // the preview reads R2
  const prev = await w.call('apiMediaPreview', m.id);
  assert.equal(prev.body.result, 'data:image/webp;base64,' + webp(10).toString('base64'));
});

test('purge: the R2 bytes go with the row; a publish first sends any file still waiting for the site', async () => {
  const s = await setup();
  const w = await writerOn(s);
  const m = (await w.upload(picture(11))).body.result.media;
  assert.equal((await w.call('apiDeleteMedia', m.id)).status, 200);
  assert.equal((await w.call('apiPurgeMedia', m.id)).status, 200);
  assert.equal(s.h.env.MEDIA.objects.size, 0);
  assert.equal((await s.h.db.prepare('SELECT COUNT(*) AS n FROM media_files WHERE deleted_ms IS NULL').first()).n, 0);

  const m2 = (await w.upload(picture(13))).body.result.media;
  await w.call('apiSaveItem', 'news', { title: 'خبر بصورة', summary: 'x', image: m2.id });
  const review = (await w.call('apiReview')).body.result;
  const p = await w.call('apiPublish', review.revision);
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.ok(Object.keys(s.gh.files()).some(path => path.includes(m2.id)), 'the picture was on the site before the content went live');
});

test('Drive → R2 copy: each file checked (SHA-256 and the library\'s own hash), stored once, the row pointed at R2; a wrong file is refused', async () => {
  const s = await setup();
  const media = s.call('apiUploadMedia', picture(15)).media;
  const w = await writerOn(s);
  void w;
  const row = (await mediaRows(s.h)).find(x => x.id === media.id);
  assert.ok(row.driveId && !row.driveId.startsWith('r2:'), 'still a Drive id after the content copy');

  // the Apps Script side, dry: it lists without sending
  s.world.properties.set('WORKER_SYNC_SECRET', SECRET);
  s.world.as(ADMIN);
  const dry = plain(s.world.gs.mediaCopy_('dry'));
  assert.equal(dry.files, 2);
  assert.equal(dry.sent, 0);

  for (const [part, fileId] of [['full', row.driveId], ['thumb', row.thumbDriveId]]) {
    const data = s.world.gs.driveDownloadBase64_(fileId);
    const sha = createHash('sha256').update(Buffer.from(data, 'base64')).digest('hex');
    const bad = await s.sync('/v1/sync/media-copy', { id: media.id, part, mime: 'image/webp', data, sha256: '0'.repeat(64) });
    assert.equal(bad.status, 400, 'a SHA-256 that does not match is refused');
    const ok = await s.sync('/v1/sync/media-copy', { id: media.id, part, mime: 'image/webp', data, sha256: sha });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.stored, true);
    const again = await s.sync('/v1/sync/media-copy', { id: media.id, part, mime: 'image/webp', data, sha256: sha });
    assert.equal(again.body.stored, false, 'a stored file is not stored twice');
  }
  const after = (await mediaRows(s.h)).find(x => x.id === media.id);
  assert.equal(after.driveId, 'r2:media/' + media.id + '.webp');
  assert.equal(after.thumbDriveId, 'r2:media/' + media.id + '-480.webp');
  const other = webp(99).toString('base64');
  const wrong = await s.sync('/v1/sync/media-copy', { id: media.id, part: 'full', mime: 'image/webp', data: other, sha256: createHash('sha256').update(webp(99)).digest('hex') });
  assert.equal(wrong.status, 400, 'not the file the library knows');
});
