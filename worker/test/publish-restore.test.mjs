// Phase 2 P2-8: «ارجع للنسخة دي» — a restore is a new publish of the texts that were live right after
// the chosen one (src/publish-restore.js). Real SQLite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, fakeGoogle } from './helpers.mjs';
import { signSync } from '../src/lib/sync.js';
import { mirrorPending } from '../src/publish-mirror.js';

let clock = Date.now();
async function world() {
  const g = await fakeGoogle();
  const h = harness({ env: { ENVIRONMENT: 'staging', GITHUB_REPO: 'StAthanasiosYouth/publish-mirror-staging', GITHUB_BRANCH: 'main', GITHUB_TOKEN: 'ghp_test' } });
  await h.db.prepare("INSERT INTO admins (email, name, role, active, created_at) VALUES ('admin@example.com', 'الأدمن', 'primary', 1, 0)").run();
  const admin = async (method, path, body) => h.call(path, { method, body, headers: { authorization: 'Bearer ' + await g.sign(g.claims()) }, fetch: g.fetch });
  const post = async (id, mode, files) => {
    const raw = JSON.stringify({ id, mode, by: 'admin@example.com', at: ++clock, files });
    const ts = String(++clock);
    const r = await h.call('/v1/sync/publish', { method: 'POST', body: raw, headers: { 'x-sync-ts': ts, 'x-sync-signature': await signSync('sync-test-secret', ts, raw) } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r;
  };
  return { h, admin, post };
}
const content = rev => JSON.stringify({ revision: rev });
const page = v => JSON.stringify({ schema: 1, slug: 'about', v });
const event = (slug, v) => JSON.stringify({ schema: 1, slug, v });
const live = async (h, route) => (await h.call(route)).body;

test('restore: the texts live after the chosen publish come back; what was added since is withdrawn; history kept', async () => {
  const { h, admin, post } = await world();
  await post('pub-1', 'worker', { 'content.json': content('r1'), 'about/page.json': page(1), 'events/trip/event.json': event('trip', 1), 'events/trip/index.html': '<!doctype html><title>trip</title>' });
  await post('pub-2', 'worker', { 'content.json': content('r2'), 'about/page.json': page(2), 'events/new-one/event.json': event('new-one', 1) });

  const list = await admin('GET', '/v1/admin/publish/revisions');
  assert.equal(list.status, 200);
  assert.equal(list.body.enabled, true);
  assert.deepEqual(list.body.jobs.map(j => j.id + (j.live ? '*' : '')), ['pub-2*', 'pub-1']);

  const r = await admin('POST', '/v1/admin/publish/restore', { to: 'pub-1', expect: 'pub-2' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.revision, 'r1');
  assert.deepEqual(r.body.changed.map(c => `${c.kind}:${c.key}${c.withdrawn ? ':withdrawn' : ''}`).sort(), ['content:site', 'event:new-one:withdrawn', 'page:about']);

  assert.equal((await live(h, '/v1/public/content')).revision, 'r1');
  assert.equal((await live(h, '/v1/public/page/about')).v, 1);
  assert.deepEqual(await live(h, '/v1/public/event/new-one'), { schema: 1, slug: 'new-one', withdrawn: true });
  assert.equal((await live(h, '/v1/public/event/trip')).v, 1, 'unchanged since: untouched');
  const revs = (await h.db.prepare("SELECT rev, live FROM published_revisions WHERE kind = 'content' ORDER BY rev").all()).results;
  assert.deepEqual(revs.map(x => [x.rev, x.live]), [[1, 0], [2, 0], [3, 1]], 'a new revision, the old ones kept');
  const job = await h.db.prepare("SELECT mode, state, by FROM publish_jobs WHERE id = ?").bind(r.body.id).first();
  assert.deepEqual({ ...job }, { mode: 'restore', state: 'live', by: 'admin@example.com' });
  const act = await h.db.prepare("SELECT action, entity_type, severity, summary FROM activity WHERE action = 'publish'").first();
  assert.deepEqual([act.entity_type, act.severity], ['site', 'important']);
  assert.match(act.summary, /رجّع الموقع للنسخة اللي اتنشرت \(r1\)/);
  assert.ok(h.sent.some(m => m.type === 'publish.mirror'), 'GitHub follows through the mirror');

  // and forward again: restore to pub-2
  const back = await admin('POST', '/v1/admin/publish/restore', { to: 'pub-2' });
  assert.equal(back.status, 200);
  assert.equal((await live(h, '/v1/public/content')).revision, 'r2');
  assert.equal((await live(h, '/v1/public/event/new-one')).v, 1);
});

test('the mirror commits a restore like a worker publish', async () => {
  const { h, admin, post } = await world();
  const commits = [];
  const fetchImpl = async (url, init) => {
    const path = url.replace('https://api.github.com/repos/StAthanasiosYouth/publish-mirror-staging', '');
    const body = init.body ? JSON.parse(init.body) : null;
    if (path === '/branches/main') return new Response(JSON.stringify({ commit: { sha: 'h' + commits.length, commit: { tree: { sha: 't' + commits.length } } } }));
    if (path === '/git/trees') { commits.push(body.tree); return new Response(JSON.stringify({ sha: 'tn' + commits.length }), { status: 201 }); }
    if (path === '/git/commits') return new Response(JSON.stringify({ sha: 'c' + commits.length }), { status: 201 });
    return new Response(JSON.stringify({}), { status: 200 });
  };
  await post('pub-1', 'worker', { 'content.json': content('r1') });
  await post('pub-2', 'worker', { 'content.json': content('r2') });
  await mirrorPending(h.env, { fetchImpl });
  await admin('POST', '/v1/admin/publish/restore', { to: 'pub-1' });
  const out = await mirrorPending(h.env, { fetchImpl });
  assert.equal(out.files, 1);
  assert.equal(JSON.parse(commits.at(-1).find(e => e.path === 'content.json').content).revision, 'r1');
});

test('refused: in github/shadow mode, someone published in between, the live one, an unknown id', async () => {
  const { admin, post } = await world();
  await post('pub-1', 'shadow', { 'content.json': content('r1') });
  await post('pub-2', 'shadow', { 'content.json': content('r2') });
  const list = await admin('GET', '/v1/admin/publish/revisions');
  assert.equal(list.body.enabled, false);
  const shadow = await admin('POST', '/v1/admin/publish/restore', { to: 'pub-1' });
  assert.deepEqual([shadow.status, shadow.body.code], [409, 'mode']);

  await post('pub-3', 'worker', { 'content.json': content('r3') });
  assert.equal((await admin('POST', '/v1/admin/publish/restore', { to: 'pub-1', expect: 'pub-2' })).body.code, 'conflict');
  assert.equal((await admin('POST', '/v1/admin/publish/restore', { to: 'pub-3' })).status, 400, 'already live');
  assert.equal((await admin('POST', '/v1/admin/publish/restore', { to: 'nope' })).status, 404);
  const ok = await admin('POST', '/v1/admin/publish/restore', { to: 'pub-1', expect: 'pub-3' });
  assert.equal(ok.status, 200);
});
