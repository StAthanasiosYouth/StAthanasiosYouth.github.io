// Phase 2 step 2: PUBLISH_MODE='shadow' (apps-script/WorkerSync.gs publishShadow_, Publish.gs step D).
// The commit lands as today; then the same files go to the Worker, signed with the Worker's own code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './fakes/gas.mjs';
import { signSync } from '../worker/src/lib/sync.js';

const ADMIN = 'menazakmena@gmail.com';
const URL_ = 'https://athanasios-api.menazak-lab.workers.dev/v1/sync/publish';
const SECRET = 's'.repeat(48);
const plain = value => JSON.parse(JSON.stringify(value));

function world(mode) {
  const w = createWorld();
  w.as(ADMIN).gs.setup();
  w.properties.set('GITHUB_TOKEN', 'test-token');
  w.properties.set('GITHUB_REPO', 'StAthanasiosYouth/StAthanasiosYouth.github.io');
  w.properties.set('SITE_URL', 'https://stathanasiosyouth.github.io/');
  w.properties.set('WORKER_SYNC_SECRET', SECRET);
  if (mode) w.properties.set('PUBLISH_MODE', mode);
  w.web[URL_] = { status: 200, body: '{"ok":true}' };
  return w;
}
const posts = w => w.webRequests.filter(r => r.url === URL_);
const bodyOf = req => Buffer.from(req.options.payload.map(b => (b < 0 ? b + 256 : b))).toString('utf8');
function publish(w) {
  const gs = w.as(ADMIN).gs;
  return plain(gs.apiPublish(plain(gs.apiReview()).revision));
}

test('shadow: default (github) and unknown modes post nothing; the publish is unchanged', () => {
  for (const mode of [null, 'github', 'SHADOW', 'nonsense']) {
    const w = world(mode);
    const result = publish(w);
    assert.ok(result.commit, 'the commit landed');
    assert.equal(posts(w).length, 0, String(mode));
    assert.ok(!w.properties.get('PUBLISH_SHADOW_LAST'));
  }
});

test('shadow: after the commit, the same files go to the Worker once, signed as the Worker checks', async () => {
  const w = world('shadow');
  const result = publish(w);
  assert.equal(posts(w).length, 1);
  const req = posts(w)[0];
  const raw = bodyOf(req);
  assert.equal(req.options.headers['x-sync-signature'], await signSync(SECRET, req.options.headers['x-sync-ts'], raw));

  const body = JSON.parse(raw);
  assert.equal(body.mode, 'shadow');
  assert.equal(body.by, ADMIN);
  assert.match(body.id, new RegExp('^pub-' + result.revision + '-\\d+$'));
  assert.ok(/^[A-Za-z0-9._:-]{4,80}$/.test(body.id), 'the Worker accepts the id');
  assert.ok(Number.isFinite(body.at));
  const site = w.github.files();
  assert.ok(Object.keys(body.files).length >= 2);
  for (const [path, text] of Object.entries(body.files)) assert.equal(text, site[path], path + ': exactly what was committed');
  assert.equal(JSON.parse(w.properties.get('PUBLISH_SHADOW_LAST')).outcome, 'ok');

  // a publish with nothing new: no commit, so nothing to post
  publish(w);
  assert.equal(posts(w).length, 1);
});

test('shadow: the Worker down → one retry, then the publish still succeeds; a refusal is not retried', () => {
  const w = world('shadow');
  w.web[URL_] = { status: 503, body: 'down' };
  const result = publish(w);
  assert.ok(result.commit);
  assert.equal(posts(w).length, 2, 'one retry');
  assert.equal(JSON.parse(bodyOf(posts(w)[0])).id, JSON.parse(bodyOf(posts(w)[1])).id, 'the retry reuses the id');
  assert.equal(JSON.parse(w.properties.get('PUBLISH_SHADOW_LAST')).outcome, 'HTTP 503');
  assert.equal(w.properties.get('PUBLISHED_REVISION'), result.revision, 'the publish itself is recorded');

  const w2 = world('shadow');
  w2.web[URL_] = { status: 409, body: '{"ok":false,"code":"conflict"}' };
  publish(w2);
  assert.equal(posts(w2).length, 1, 'refused: no retry');
  assert.equal(JSON.parse(w2.properties.get('PUBLISH_SHADOW_LAST')).outcome, 'HTTP 409');
});

test('shadow: no secret → nothing sent, the publish succeeds', () => {
  const w = world('shadow');
  w.properties.delete('WORKER_SYNC_SECRET');
  assert.ok(publish(w).commit);
  assert.equal(posts(w).length, 0);
  assert.equal(JSON.parse(w.properties.get('PUBLISH_SHADOW_LAST')).outcome, 'no secret');
});

// ---------- PUBLISH_MODE='worker' (P2-4): live on the Worker, GitHub follows (the Worker's mirror) ----------

const webp = fill => Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x20, 0, 0, 0]), Buffer.from('WEBPVP8L'), Buffer.alloc(40, fill)]);
const ok = id => ({ status: 200, body: JSON.stringify({ ok: true, id, unchanged: false, files: 2, changed: [] }) });

test('worker: no text commit; the files go to the Worker as mode worker; the publish is recorded; mirror pending', () => {
  const w = world('worker');
  w.web[URL_] = ok('x');
  const head = w.github.head;
  const result = publish(w);
  assert.equal(w.github.head, head, 'GitHub untouched (no new picture): the mirror commits later');
  assert.equal(posts(w).length, 1);
  const body = JSON.parse(bodyOf(posts(w)[0]));
  assert.equal(body.mode, 'worker');
  assert.ok(body.files['content.json'] && body.files['meeting.ics'] !== undefined);
  assert.equal(JSON.parse(body.files['content.json']).revision, result.revision);
  assert.deepEqual([result.commit, result.unchanged, result.mirror], ['', false, 'pending']);
  assert.equal(w.properties.get('PUBLISHED_REVISION'), result.revision);
  assert.ok(!w.properties.get('PUBLISH_SHADOW_LAST'), 'no shadow post on top');
});

test('worker: the Worker refuses or is down → the publish fails clearly; nothing recorded; never a GitHub commit instead', () => {
  for (const reply of [{ status: 503, body: 'down' }, { status: 409, body: '{"ok":false,"code":"conflict"}' }]) {
    const w = world('worker');
    w.web[URL_] = reply;
    const gs = w.as(ADMIN).gs;
    const head = w.github.head;
    const revision = plain(gs.apiReview()).revision;
    assert.throws(() => gs.apiPublish(revision), /النشر ما اتمش: السيرفر الجديد مردش \(HTTP (503|409)\)/);
    assert.equal(w.github.head, head, 'no fallback commit (one writer)');
    assert.ok(!w.properties.get('PUBLISHED_REVISION'));
    assert.equal(posts(w).length, reply.status === 503 ? 2 : 1, 'one retry only when it may help');
    // the claim was released: a second try works once the Worker is back
    w.web[URL_] = ok('y');
    assert.equal(plain(gs.apiPublish(revision)).mirror, 'pending');
  }
});

test('worker: a new picture is committed to GitHub first (binaries only), then the text goes to the Worker', () => {
  const w = world('worker');
  w.web[URL_] = ok('z');
  const gs = w.as(ADMIN).gs;
  const banner = plain(gs.apiUploadMedia({ full: webp(7).toString('base64'), thumb: webp(7).toString('base64'), tiny: webp(7).toString('base64'), tinyMime: 'image/webp',
    color: '#1D3557', name: 'بوستر', mime: 'image/webp', width: 1200, height: 1500, alt: 'وصف' })).media;
  gs.apiSaveItem('news', { title: 'رحلة', summary: 'x' });
  gs.apiSaveSection({ key: 'news', title: 'جديد الأسرة', theme: 'ember', banner: banner.id });
  const head = w.github.head;
  publish(w);
  const files = w.github.files();
  assert.notEqual(w.github.head, head, 'one media commit');
  assert.ok(files[banner.path] && files[banner.thumb], 'the picture is on the site before the content points at it');
  assert.ok(!files['content.json'], 'content.json is not committed by Apps Script');
  assert.match(w.github.commits.get(w.github.head).message, /^Publish media for /);
  const sent = JSON.parse(bodyOf(posts(w)[0]));
  assert.ok(!Object.keys(sent.files).some(p => p.startsWith('media/')), 'no binaries to the Worker');
});

// ---------- P2-7: in 'worker' mode the review, the publish and the status follow the Worker's live revision ----------

const LIVE_URL = 'https://athanasios-api.menazak-lab.workers.dev/v1/public/content';

test('worker: after a restore on the Worker, the draft is not "already live": the review diffs against the Worker and the publish goes through', () => {
  const w = world('worker');
  w.web[URL_] = ok('a');
  const first = publish(w);                                          // r1 live (the Worker took it)
  const gs = w.as(ADMIN).gs;
  // the Worker serves an older revision now (a restore, P2-8): this script still remembers r1
  w.web[LIVE_URL] = { status: 200, body: JSON.stringify({ revision: 'older-rev', meeting: {}, sections: [] }) };
  assert.equal(w.properties.get('PUBLISHED_REVISION'), first.revision);
  const state = plain(gs.apiPublishRefresh());
  assert.equal(state.status.publishedRevision, 'older-rev', 'the status follows the Worker');
  assert.equal(state.status.hasChanges, true);
  const review = plain(gs.apiReview());
  assert.ok(review.changes.length > 0, 'a real diff against the Worker, not "nothing changed"');
  const again = plain(gs.apiPublish(review.revision));
  assert.deepEqual([again.unchanged, again.mirror], [false, 'pending'], 'published again, not skipped as unchanged');
  assert.equal(posts(w).length, 2);
});

test('worker: the Worker cannot say what is live → the property decides (as before)', () => {
  const w = world('worker');
  w.web[URL_] = ok('a');
  const first = publish(w);
  w.web[LIVE_URL] = { status: 503, body: 'down' };
  const state = plain(w.as(ADMIN).gs.apiPublishRefresh());
  assert.equal(state.status.publishedRevision, first.revision);
});

test('github / shadow mode: never asks the Worker what is live', () => {
  for (const mode of [null, 'shadow']) {
    const w = world(mode);
    publish(w);
    plain(w.as(ADMIN).gs.apiState());
    plain(w.as(ADMIN).gs.apiReview());
    assert.equal(w.webRequests.filter(r => r.url === LIVE_URL).length, 0, String(mode));
  }
});
