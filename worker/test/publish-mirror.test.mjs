// Phase 2 P2-4: the GitHub mirror (src/publish-mirror.js, src/lib/github.js). Real SQLite, a GitHub
// fake in memory (branches, trees, commits, refs; fast-forward only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers.mjs';
import { signSync } from '../src/lib/sync.js';
import { mirrorPending, mirrorDue, mirrorStatus, mirrorAccess, revisionPath } from '../src/publish-mirror.js';
import { githubConfig, commitFiles, checkAccess, PRODUCTION_REPO } from '../src/lib/github.js';
import { scheduled } from '../src/scheduled.js';
import { consume } from '../src/jobs.js';

const REPO = 'StAthanasiosYouth/publish-mirror-staging';
const ENV = { ENVIRONMENT: 'staging', GITHUB_REPO: REPO, GITHUB_BRANCH: 'main', GITHUB_TOKEN: 'ghp_test' };

/* a tiny GitHub: commits are { tree: { path: text }, parent } */
function fakeGitHub({ down = false, readOnly = false } = {}) {
  let n = 0;
  const commits = new Map([['c0', { files: { 'README.md': 'x' }, parent: null }]]);
  const trees = new Map([['t-c0', { 'README.md': 'x' }]]);
  const gh = { head: 'c0', calls: [], down, raceOnce: false, commits };
  gh.files = () => commits.get(gh.head).files;
  gh.fetch = async (url, init = {}) => {
    const path = url.replace(`https://api.github.com/repos/${REPO}`, '');
    const body = init.body ? JSON.parse(init.body) : null;
    gh.calls.push({ method: init.method, path, auth: init.headers.authorization });
    if (gh.down) return new Response('{"message":"Server Error"}', { status: 502 });
    const json = (status, value) => new Response(JSON.stringify(value), { status });
    if (init.method === 'GET' && path === '/branches/main') return json(200, { commit: { sha: gh.head, commit: { tree: { sha: 't-' + gh.head } } } });
    if (init.method === 'GET' && path.startsWith('/git/trees/')) {
      const files = trees.get(path.slice('/git/trees/'.length)) || {};
      return json(200, { tree: Object.keys(files).map(p => ({ path: p, mode: '100644', type: 'blob', sha: 'b:' + files[p] })) });
    }
    if (init.method === 'POST' && path === '/git/trees') {
      if (readOnly) return json(403, { message: 'Resource not accessible by personal access token' });
      const files = { ...trees.get(body.base_tree) };
      for (const e of body.tree) files[e.path] = e.sha ? e.sha.slice(2) : e.content;
      const same = JSON.stringify(Object.entries(files).sort()) === JSON.stringify(Object.entries(trees.get(body.base_tree)).sort());
      const sha = same ? body.base_tree : 't-new' + (++n);
      trees.set(sha, files);
      return json(201, { sha });
    }
    if (init.method === 'POST' && path === '/git/commits') {
      const sha = 'c' + (++n);
      commits.set(sha, { files: trees.get(body.tree), parent: body.parents[0], message: body.message, author: body.author });
      trees.set('t-' + sha, trees.get(body.tree));
      return json(201, { sha });
    }
    if (init.method === 'PATCH' && path === '/git/refs/heads/main') {
      const c = commits.get(body.sha);
      if (gh.raceOnce) {                                   // someone pushed in between
        gh.raceOnce = false;
        const other = 'c' + (++n);
        commits.set(other, { files: { ...commits.get(gh.head).files, 'index.html': 'code change' }, parent: gh.head });
        trees.set('t-' + other, commits.get(other).files);
        gh.head = other;
      }
      if (body.force !== false || c.parent !== gh.head) return json(422, { message: 'Update is not a fast forward' });
      gh.head = body.sha;
      return json(200, { object: { sha: body.sha } });
    }
    return json(404, { message: 'Not Found' });
  };
  return gh;
}

let clock = Date.now();
async function post(h, id, files, mode = 'worker') {
  const raw = JSON.stringify({ id, mode, by: 'admin@example.com', at: ++clock, files });
  const ts = String(++clock);
  return h.call('/v1/sync/publish', { method: 'POST', body: raw, headers: { 'x-sync-ts': ts, 'x-sync-signature': await signSync('sync-test-secret', ts, raw) } });
}
const content = rev => JSON.stringify({ revision: rev, pages: [], events: [], competitions: [] });

test('config: needs repo + token; outside production the production repository is refused', () => {
  assert.equal(githubConfig({ ...ENV, GITHUB_TOKEN: '' }).error, 'GITHUB_TOKEN not set');
  assert.equal(githubConfig({ ...ENV, GITHUB_REPO: '' }).error, 'GITHUB_REPO not set');
  assert.match(githubConfig({ ...ENV, GITHUB_REPO: PRODUCTION_REPO }).error, /refused outside production/);
  assert.match(githubConfig({ ...ENV, ENVIRONMENT: 'test', GITHUB_REPO: PRODUCTION_REPO.toLowerCase() }).error, /refused/);
  assert.equal(githubConfig({ ...ENV, ENVIRONMENT: 'production', GITHUB_REPO: PRODUCTION_REPO }).repo, PRODUCTION_REPO);
  assert.deepEqual(['content', 'ics', 'page', 'event', 'comp', 'stub'].map(k => revisionPath(k, k === 'stub' ? 'events/trip' : 'trip')),
    ['content.json', 'meeting.ics', 'trip/page.json', 'events/trip/event.json', 'competition/trip/comp.json', 'events/trip/index.html']);
});

test('a worker-mode publish: live at once, then one commit with exactly its files; the job and rows marked', async () => {
  const gh = fakeGitHub();
  const h = harness({ env: ENV });
  const r = await post(h, 'pub-1', { 'content.json': content('r1'), 'events/trip/event.json': '{"slug":"trip"}', 'events/trip/index.html': '<!doctype html><title>trip</title>' });
  assert.equal(r.status, 200);
  assert.equal((await h.call('/v1/public/content')).body.revision, 'r1', 'live before GitHub has it');
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].type, 'publish.mirror', 'the mirror is queued');

  const out = await mirrorPending(h.env, { fetchImpl: gh.fetch });
  assert.equal(out.committed, true);
  assert.equal(out.files, 3);
  assert.deepEqual(Object.keys(gh.files()).sort(), ['README.md', 'content.json', 'events/trip/event.json', 'events/trip/index.html']);
  assert.equal(JSON.parse(gh.files()['content.json']).revision, 'r1');
  const c = gh.commits.get(gh.head);
  assert.match(c.message, /^Publish content r1 \(.+ Cairo, mirror\)$/);
  assert.deepEqual(c.author, { name: 'Athanasius Portal Admin', email: 'portal-admin@users.noreply.github.com' }, 'the non-personal identity');
  assert.ok(gh.calls.every(x => x.auth === 'Bearer ghp_test'));
  assert.equal((await h.db.prepare("SELECT state FROM publish_jobs WHERE id = 'pub-1'").first()).state, 'mirrored');
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM published_revisions WHERE github_commit = ?').bind(gh.head).first()).n, 3);
  assert.equal((await mirrorPending(h.env, { fetchImpl: gh.fetch })).files, 0, 'nothing left');
});

test('shadow and seed revisions are never mirrored (Apps Script committed them)', async () => {
  const gh = fakeGitHub();
  const h = harness({ env: ENV });
  await post(h, 'pub-s', { 'content.json': content('s1') }, 'shadow');
  assert.equal(h.sent.length, 0);
  assert.deepEqual(await mirrorPending(h.env, { fetchImpl: gh.fetch }), { committed: false, files: 0 });
  assert.equal(gh.calls.length, 0);
});

test('publishes in a row coalesce; the newest text wins, never an older one', async () => {
  const gh = fakeGitHub();
  const h = harness({ env: ENV });
  await post(h, 'pub-1', { 'content.json': content('r1'), 'black-theatre/page.json': '{"v":1}' });
  await post(h, 'pub-2', { 'content.json': content('r2') });
  await post(h, 'pub-3', { 'content.json': content('r3'), 'black-theatre/page.json': '{"v":3}' });
  const out = await mirrorPending(h.env, { fetchImpl: gh.fetch });
  assert.equal(out.files, 2, 'only the live revisions');
  assert.equal(JSON.parse(gh.files()['content.json']).revision, 'r3');
  assert.equal(gh.files()['black-theatre/page.json'], '{"v":3}');
  assert.equal([...gh.commits.values()].filter(c => c.message && /mirror/.test(c.message)).length, 1, 'one commit');
  const states = (await h.db.prepare('SELECT id, state FROM publish_jobs ORDER BY id').all()).results.map(r => r.id + ':' + r.state);
  assert.deepEqual(states, ['pub-1:mirrored', 'pub-2:mirrored', 'pub-3:mirrored']);
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM published_revisions WHERE mirrored_at IS NULL').first()).n, 0);
});

test('a later shadow publish of the same file: the older worker text is no longer live, so never committed', async () => {
  const gh = fakeGitHub();
  const h = harness({ env: ENV });
  await post(h, 'pub-w', { 'content.json': content('w1') });
  await post(h, 'pub-s', { 'content.json': content('s2') }, 'shadow');    // the rollback mode: Apps Script commits again
  assert.deepEqual(await mirrorPending(h.env, { fetchImpl: gh.fetch }), { committed: false, files: 0 });
  assert.equal(gh.files()['content.json'], undefined);
});

test('GitHub down: the publish stays live, the job failed, backoff 1 → 2 → 4 min; then it goes through', async () => {
  const gh = fakeGitHub({ down: true });
  const h = harness({ env: ENV });
  await post(h, 'pub-1', { 'content.json': content('r1') });
  const t0 = Date.now();
  const f1 = await mirrorPending(h.env, { fetchImpl: gh.fetch, now: t0 });
  assert.match(f1.failed, /GitHub 502/);
  assert.equal(f1.fails, 1);
  assert.equal((await h.db.prepare("SELECT state FROM publish_jobs WHERE id = 'pub-1'").first()).state, 'failed');
  assert.equal((await h.call('/v1/public/content')).body.revision, 'r1', 'still live');
  assert.equal(await mirrorDue(h.db, t0 + 30 * 1000), false);
  assert.equal(await mirrorDue(h.db, t0 + 61 * 1000), true);
  await mirrorPending(h.env, { fetchImpl: gh.fetch, now: t0 + 61 * 1000 });
  assert.equal(await mirrorDue(h.db, t0 + 61 * 1000 + 90 * 1000), false, 'two failures: wait 2 min');
  const late = await mirrorStatus(h.env, t0 + 6 * 60 * 1000);
  assert.deepEqual([late.pending, late.late, late.last.ok, late.last.fails], [1, true, false, 2]);

  gh.down = false;
  const ok = await mirrorPending(h.env, { fetchImpl: gh.fetch, now: t0 + 5 * 60 * 1000 });
  assert.equal(ok.committed, true);
  const after = await mirrorStatus(h.env, t0 + 6 * 60 * 1000);
  assert.deepEqual([after.pending, after.late, after.last.ok], [0, false, true]);
  assert.equal((await h.db.prepare("SELECT state, error FROM publish_jobs WHERE id = 'pub-1'").first()).state, 'mirrored');
});

test('someone pushes in between: rebuilt once on the new head (their change kept); same files → no empty commit', async () => {
  const gh = fakeGitHub();
  const cfg = githubConfig(ENV);
  gh.raceOnce = true;
  const out = await commitFiles(cfg, { 'content.json': 'a' }, 'm', gh.fetch);
  assert.equal(out.unchanged, false);
  assert.equal(gh.files()['index.html'], 'code change', 'the other push survives');
  assert.equal(gh.files()['content.json'], 'a');
  const again = await commitFiles(cfg, { 'content.json': 'a' }, 'm', gh.fetch);
  assert.deepEqual(again, { sha: gh.head, unchanged: true });
});

test('not configured: nothing sent, the status says why; one run at a time', async () => {
  const gh = fakeGitHub();
  const h = harness({ env: { ...ENV, GITHUB_TOKEN: '' } });
  await post(h, 'pub-1', { 'content.json': content('r1') });
  assert.deepEqual(await mirrorPending(h.env, { fetchImpl: gh.fetch }), { skipped: 'GITHUB_TOKEN not set' });
  const st = await mirrorStatus(h.env);
  assert.deepEqual([st.configured, st.reason, st.pending], [false, 'GITHUB_TOKEN not set', 1]);

  const h2 = harness({ env: ENV });
  await post(h2, 'pub-1', { 'content.json': content('r1') });
  await h2.db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('MIRROR_CLAIM', ?, 0)").bind(String(Date.now())).run();
  assert.deepEqual(await mirrorPending(h2.env, { fetchImpl: gh.fetch }), { skipped: 'another mirror run is busy' });
  assert.equal((await mirrorPending(h2.env, { fetchImpl: gh.fetch, now: Date.now() + 3 * 60 * 1000 })).committed, true, 'a stale claim is taken over');
});

test('the queue job and the per-minute cron both run it', async () => {
  const gh = fakeGitHub();
  const real = globalThis.fetch;
  globalThis.fetch = gh.fetch;
  try {
    const h = harness({ env: ENV });
    await post(h, 'pub-1', { 'content.json': content('r1') });
    const acked = [];
    await consume({ messages: [{ body: h.sent[0], attempts: 1, ack: () => acked.push(1), retry: () => {} }] }, h.env);
    assert.deepEqual(acked, [1]);
    assert.equal(JSON.parse(gh.files()['content.json']).revision, 'r1');

    await post(h, 'pub-2', { 'content.json': content('r2') });
    await scheduled({ cron: '* * * * *', scheduledTime: Date.UTC(2026, 9, 21, 10, 7) }, h.env);
    assert.equal(JSON.parse(gh.files()['content.json']).revision, 'r2');
  } finally {
    globalThis.fetch = real;
  }
});

test('the hourly token check: read + write proven with no commit, no new tree, the ref unmoved; failures kept for the admin', async () => {
  const gh = fakeGitHub();
  const before = { head: gh.head, commits: gh.commits.size };
  const cfg = githubConfig(ENV);
  assert.deepEqual(await checkAccess(cfg, gh.fetch), { head: 'c0', expires: '' });
  assert.equal(gh.head, before.head);
  assert.equal(gh.commits.size, before.commits);
  assert.deepEqual(gh.calls.map(c => c.method + ' ' + c.path), ['GET /branches/main', 'GET /git/trees/t-c0', 'POST /git/trees']);
  await assert.rejects(checkAccess(cfg, fakeGitHub({ readOnly: true }).fetch), /GitHub 403/);

  const h = await harness({ env: ENV });
  assert.equal((await mirrorAccess(h.env, { now: 1000, fetchImpl: gh.fetch })).ok, true);
  assert.equal((await mirrorStatus(h.env)).access.head, 'c0');
  const bad = await mirrorAccess(h.env, { now: 2000, fetchImpl: fakeGitHub({ readOnly: true }).fetch });
  assert.equal(bad.ok, false);
  assert.match((await mirrorStatus(h.env)).access.error, /403/);
  assert.deepEqual(await mirrorAccess({ ...h.env, GITHUB_TOKEN: '' }), { skipped: 'GITHUB_TOKEN not set' });
});
