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
  for (const mode of [null, 'github', 'worker', 'SHADOW']) {
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
