// Phase 2 step 1: published revisions (POST /v1/sync/publish, GET /v1/public/*). Real SQLite,
// real published files from the repo. docs/PUBLISH-SEPARATION-PLAN.md §4–5.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { harness } from './helpers.mjs';
import { signSync } from '../src/lib/sync.js';
import { pathKind, privateKey } from '../src/publish.js';

const repo = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const SITE = {
  'content.json': repo('content.json'),
  // its own event, not the repository's: the mirror can withdraw that one, as it did on main
  'events/test/event.json': JSON.stringify({ schema: 1, slug: 'test', title: 'تجربة' }),
  'events/test/index.html': repo('events/test/index.html'),
  'black-theatre/page.json': repo('black-theatre/page.json'),
  'black-theatre/index.html': repo('black-theatre/index.html'),
  'competition/test/comp.json': repo('competition/test/comp.json'),
  'meeting.ics': 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n'
};

let clock = Date.now();
async function post(h, body, { ts = ++clock, secret = 'sync-test-secret' } = {}) {
  const raw = JSON.stringify(body);
  return h.call('/v1/sync/publish', { method: 'POST', body: raw, headers: { 'x-sync-ts': String(ts), 'x-sync-signature': await signSync(secret, String(ts), raw) } });
}
const pub = (id, files, over = {}) => ({ id, mode: 'shadow', by: 'Admin@Example.com', at: ++clock, files, ...over });
const live = h => h.db.prepare('SELECT kind, key, rev FROM published_revisions WHERE live = 1 ORDER BY kind, key').all().then(r => r.results.map(x => `${x.kind}:${x.key}@${x.rev}`));
const text = r => new TextDecoder().decode(r.bytes);

test('pathKind: the files a publish writes, nothing else', () => {
  assert.deepEqual(pathKind('content.json'), { kind: 'content', key: 'site' });
  assert.deepEqual(pathKind('meeting.ics'), { kind: 'ics', key: 'site' });
  assert.deepEqual(pathKind('events/test/event.json'), { kind: 'event', key: 'test' });
  assert.deepEqual(pathKind('events/test/index.html'), { kind: 'stub', key: 'events/test' });
  assert.deepEqual(pathKind('competition/q1/comp.json'), { kind: 'comp', key: 'q1' });
  assert.deepEqual(pathKind('competition/q1/index.html'), { kind: 'stub', key: 'competition/q1' });
  assert.deepEqual(pathKind('black-theatre/page.json'), { kind: 'page', key: 'black-theatre' });
  assert.deepEqual(pathKind('black-theatre/index.html'), { kind: 'stub', key: 'black-theatre' });
  for (const bad of ['index.html', 'live.json', 'events/page.json', 'competition/page.json', 'events/a--b/event.json', 'Admin/page.json',
    '../x/page.json', 'events/x/y/event.json', 'assets/js/main.js', 'media/a.webp', 'events/x/comp.json']) {
    assert.equal(pathKind(bad), null, bad);
  }
});

test('privateKey: the real published files carry none; any private key is found at any depth', () => {
  for (const [path, body] of Object.entries(SITE)) if (path.endsWith('.json')) assert.equal(privateKey(JSON.parse(body)), '', path);
  assert.equal(privateKey({ a: [{ b: { phone: '010' } }] }), 'phone');
  assert.equal(privateKey({ people: [{ name: 'x', codeHash: 'y' }] }), 'codeHash');
  assert.equal(privateKey({ phoneDisplay: '+20', answersAt: 'x' }), '', 'exact keys only');
});

test('sync/publish: signed; stores every file once, live; the public reads return the exact text', async () => {
  const h = harness();
  assert.equal((await post(h, pub('pub-1', SITE), { secret: 'wrong' })).status, 401);

  const r = await post(h, pub('pub-1', SITE));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.unchanged, false);
  assert.equal(r.body.files, 7);
  assert.equal(r.body.changed.length, 7);
  assert.deepEqual(await live(h), ['comp:test@1', 'content:site@1', 'event:test@1', 'ics:site@1', 'page:black-theatre@1', 'stub:black-theatre@1', 'stub:events/test@1']);
  const job = await h.db.prepare('SELECT * FROM publish_jobs WHERE id = ?').bind('pub-1').first();
  assert.deepEqual([job.mode, job.state, job.files, job.changed, job.by, job.revision], ['shadow', 'live', 7, 7, 'admin@example.com', JSON.parse(SITE['content.json']).revision]);

  for (const [route, path, type] of [
    ['/v1/public/content', 'content.json', 'application/json'],
    ['/v1/public/event/test', 'events/test/event.json', 'application/json'],
    ['/v1/public/page/black-theatre', 'black-theatre/page.json', 'application/json'],
    ['/v1/public/comp/test', 'competition/test/comp.json', 'application/json'],
    ['/v1/public/ics', 'meeting.ics', 'text/calendar']
  ]) {
    const g = await h.call(route);
    assert.equal(g.status, 200, route);
    assert.ok(g.headers.get('content-type').startsWith(type), route);
    assert.equal(g.headers.get('cache-control'), 'no-cache');
    assert.equal(g.headers.get('access-control-allow-origin'), 'https://stathanasiosyouth.github.io');
    assert.match(g.headers.get('etag'), /^"[0-9a-f]{32}"$/);
    const body = g.body ? JSON.stringify(g.body) : text(g);
    assert.equal(body, g.body ? JSON.stringify(JSON.parse(SITE[path])) : SITE[path], route + ': the exact text');
  }
  assert.equal((await h.call('/v1/public/page/nope')).status, 404);
  assert.equal((await h.call('/v1/public/page/events')).status, 404, 'a stub is never served');
  assert.equal((await h.call('/v1/public/event/' + encodeURIComponent('../x'))).status, 404);
});

test('ETag: 304 on a repeat (also weak, as Cloudflare may send it); a new revision → a new ETag', async () => {
  const h = harness();
  await post(h, pub('pub-1', SITE));
  const first = await h.call('/v1/public/content');
  const etag = first.headers.get('etag');
  const again = await h.call('/v1/public/content', { headers: { 'if-none-match': etag } });
  assert.equal(again.status, 304);
  assert.equal(again.body, null, "no body");
  assert.equal(again.headers.get('etag'), etag);
  assert.equal((await h.call('/v1/public/content', { headers: { 'if-none-match': '"other", W/' + etag } })).status, 304);

  const next = JSON.parse(SITE['content.json']);
  next.revision = 'r-next';
  await post(h, pub('pub-2', { 'content.json': JSON.stringify(next) }));
  const fresh = await h.call('/v1/public/content', { headers: { 'if-none-match': etag } });
  assert.equal(fresh.status, 200);
  assert.notEqual(fresh.headers.get('etag'), etag);
  assert.equal(fresh.body.revision, 'r-next');
});

test('a later publish: only changed files get a revision; history kept; a withdrawn file is served as withdrawn', async () => {
  const h = harness();
  await post(h, pub('pub-1', SITE));
  const same = await post(h, pub('pub-2', { 'content.json': SITE['content.json'], 'meeting.ics': SITE['meeting.ics'] }));
  assert.equal(same.status, 200);
  assert.deepEqual([same.body.unchanged, same.body.changed.length], [true, 0]);

  const gone = JSON.stringify({ schema: 1, slug: 'test', withdrawn: true });
  const r = await post(h, pub('pub-3', { 'content.json': SITE['content.json'], 'events/test/event.json': gone }));
  assert.deepEqual(r.body.changed.map(c => `${c.kind}:${c.key}@${c.rev}`), ['event:test@2']);
  assert.deepEqual(await live(h), ['comp:test@1', 'content:site@1', 'event:test@2', 'ics:site@1', 'page:black-theatre@1', 'stub:black-theatre@1', 'stub:events/test@1']);
  const rows = await h.db.prepare("SELECT rev, live, withdrawn FROM published_revisions WHERE kind = 'event' ORDER BY rev").all();
  assert.deepEqual(rows.results.map(x => [x.rev, x.live, x.withdrawn]), [[1, 0, 0], [2, 1, 1]]);
  assert.deepEqual((await h.call('/v1/public/event/test')).body, JSON.parse(gone));
});

test('retries and order: same id + same files → the stored reply; other files → conflict; an older publish never wins', async () => {
  const h = harness();
  const first = await post(h, pub('pub-1', SITE, { at: 1000 }));
  const retry = await post(h, pub('pub-1', SITE, { at: 1000 }));
  assert.equal(retry.status, 200);
  assert.equal(retry.body.replayed, true);
  assert.deepEqual(retry.body.changed, first.body.changed);
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM published_revisions').first()).n, 7, 'nothing stored twice');

  assert.equal((await post(h, pub('pub-1', { 'content.json': '{"revision":"x"}' }, { at: 1000 }))).status, 409);
  await post(h, pub('pub-3', { 'content.json': '{"revision":"new"}' }, { at: 3000 }));
  const late = await post(h, pub('pub-2', { 'content.json': '{"revision":"old"}' }, { at: 2000 }));
  assert.equal(late.status, 409, 'a late older publish is refused');
  assert.equal((await h.call('/v1/public/content')).body.revision, 'new');

  const ts = ++clock;
  await post(h, pub('pub-4', { 'content.json': '{"revision":"r4"}' }, { at: 4000 }), { ts });
  assert.equal((await post(h, pub('pub-5', { 'content.json': '{"revision":"r5"}' }, { at: 5000 }), { ts })).status, 409, 'signed replay refused');
});

test('refusals store nothing: bad paths, private data, malformed files, sizes', async () => {
  const h = harness();
  const cases = [
    [{ id: 'x' }, 400],
    [pub('pub-1', {}), 400],
    [pub('pub-1', SITE, { mode: 'live' }), 400],
    [pub('pub-1', SITE, { at: 'soon' }), 400],
    [pub('pub-1', { ...SITE, 'assets/js/main.js': 'alert(1)' }), 400],
    [pub('pub-1', { ...SITE, 'events/xx/event.json': JSON.stringify({ slug: 'xx', servants: [{ name: 'a', phone: '0100' }] }) }), 400],
    [pub('pub-1', { ...SITE, 'events/xx/event.json': '{not json' }), 400],
    [pub('pub-1', { ...SITE, 'events/xx/event.json': '[]' }), 400],
    [pub('pub-1', { ...SITE, 'meeting.ics': '<html>' }), 400],
    [pub('pub-1', { ...SITE, 'events/xx/index.html': 'plain' }), 400],
    [pub('pub-1', { ...SITE, 'events/xx/event.json': JSON.stringify({ pad: 'x'.repeat(300 * 1024) }) }), 413],
    [pub('pub-1', Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`p${i}/page.json`, '{}']))), 400]
  ];
  for (const [body, status] of cases) {
    const r = await post(h, body);
    assert.equal(r.status, status, JSON.stringify(body).slice(0, 120) + ' → ' + JSON.stringify(r.body));
  }
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM published_revisions').first()).n, 0);
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM publish_jobs').first()).n, 0);
});

test('a big first publish is split over several insert statements, all in one batch', async () => {
  const h = harness();
  const files = {};
  for (let i = 0; i < 12; i++) files[`page-${i}/page.json`] = JSON.stringify({ slug: `page-${i}`, text: 'ن'.repeat(60 * 1024) });
  const r = await post(h, pub('pub-big', files));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.changed.length, 12);
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM published_revisions WHERE live = 1').first()).n, 12);
  assert.equal((await h.call('/v1/public/page/page-11')).body.text.length, 60 * 1024);
});

test('a failed batch leaves nothing half-published; the retry with the same id goes through', async () => {
  const h = harness();
  await post(h, pub('pub-1', SITE));
  const original = h.db.batch.bind(h.db);
  let fail = 3;   // retry() makes 3 attempts
  h.db.batch = async stmts => { if (fail-- > 0) throw new Error('D1_ERROR: Network connection lost.'); return original(stmts); };
  const body = pub('pub-2', { 'content.json': '{"revision":"r2"}' });
  assert.equal((await post(h, body)).status, 500);
  assert.equal((await h.call('/v1/public/content')).body.revision, JSON.parse(SITE['content.json']).revision, 'still the old one');
  assert.equal((await post(h, body)).status, 200);
  assert.equal((await h.call('/v1/public/content')).body.revision, 'r2');
});

test('CONTENT_SERVE=0: every public read answers disabled; absent or 1 serves', async () => {
  const h = harness();
  await post(h, pub('pub-1', SITE));
  await h.db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('CONTENT_SERVE', '0', 0)").run();
  for (const route of ['/v1/public/content', '/v1/public/event/test', '/v1/public/ics']) {
    const r = await h.call(route);
    assert.equal(r.status, 403, route);
    assert.equal(r.body.code, 'disabled');
  }
  await h.db.prepare("UPDATE settings SET value = '1' WHERE key = 'CONTENT_SERVE'").run();
  assert.equal((await h.call('/v1/public/content')).status, 200);
  const empty = harness();
  assert.equal((await empty.call('/v1/public/content')).status, 404, 'nothing published yet: not_found (the site uses its static file)');
});
