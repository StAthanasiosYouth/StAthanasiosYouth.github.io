// Phase 2 step 2: the shadow comparison (src/publish-shadow.js): the live D1 revision of every
// published file vs. what GitHub Pages serves. Real SQLite, a fake site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, fakeGoogle } from './helpers.mjs';
import { signSync } from '../src/lib/sync.js';
import { shadowCheck, shadowStatus, shadowTargets } from '../src/publish-shadow.js';
import { scheduled } from '../src/scheduled.js';

const SITE = 'https://stathanasiosyouth.github.io';
const MIN = 60 * 1000;
const content = (rev, extra = {}) => JSON.stringify({ revision: rev, pages: [{ slug: 'black-theatre' }], events: [{ slug: 'trip' }], competitions: [], ...extra });
const files = rev => ({
  'content.json': content(rev),
  'meeting.ics': 'BEGIN:VCALENDAR\r\nX-REV:' + rev + '\r\nEND:VCALENDAR\r\n',
  'black-theatre/page.json': JSON.stringify({ slug: 'black-theatre', v: rev }),
  'events/trip/event.json': JSON.stringify({ slug: 'trip', v: rev })
});

/* the site serves `served` (path → text; missing = 404); every read is counted */
function fakeSite(served) {
  const reads = [];
  const fetchImpl = async url => {
    const path = url.slice(SITE.length + 1).replace(/\?.*$/, '');
    reads.push(path);
    if (served.down) return new Response('down', { status: 503 });
    return path in served ? new Response(served[path]) : new Response('nope', { status: 404 });
  };
  return { fetchImpl, reads };
}

let clock = Date.now();
async function post(h, id, posted, at) {
  const raw = JSON.stringify({ id, mode: 'shadow', by: 'admin@example.com', at, files: posted });
  const ts = String(++clock);
  return h.call('/v1/sync/publish', { method: 'POST', body: raw, headers: { 'x-sync-ts': ts, 'x-sync-signature': await signSync('sync-test-secret', ts, raw) } });
}

test('targets: content.json + meeting.ics + every listed page, event, competition (bad slugs skipped)', () => {
  assert.deepEqual(shadowTargets({ pages: [{ slug: 'a-b' }, { slug: '../x' }], events: [{ slug: 'trip' }], competitions: [{ slug: 'q1' }, {}] }).map(t => t.path),
    ['content.json', 'meeting.ics', 'a-b/page.json', 'events/trip/event.json', 'competition/q1/comp.json']);
});

test('nothing posted yet → skipped, the site is not read; a publish settling → skipped', async () => {
  const h = harness();
  const site = fakeSite(files('r1'));
  assert.deepEqual(await shadowCheck(h.env, { fetchImpl: site.fetchImpl }), { skipped: 'no publish posted yet' });
  assert.equal(site.reads.length, 0);
  const now = Date.now();
  await post(h, 'pub-1', files('r1'), now - 2 * MIN);
  assert.deepEqual(await shadowCheck(h.env, { fetchImpl: site.fetchImpl, now }), { skipped: 'a publish is settling' });
  assert.equal((await shadowCheck(h.env, { fetchImpl: site.fetchImpl, now: now + 11 * MIN })).clean, true);
});

test('equal, lag, mismatch, missing, error — one row per run', async () => {
  const h = harness();
  const t0 = Date.now() - 60 * MIN;
  await post(h, 'pub-1', files('r1'), t0);
  const served = files('r1');
  const site = fakeSite(served);
  const run = () => shadowCheck(h.env, { fetchImpl: site.fetchImpl, now: Date.now() });

  let r = await run();
  assert.deepEqual([r.total, r.equal, r.clean], [4, 4, true]);

  await post(h, 'pub-2', files('r2'), t0 + 1);              // Pages not rebuilt yet: the site still has r1
  r = await run();
  assert.deepEqual([r.equal, r.lag, r.clean], [0, 4, false]);

  Object.assign(served, files('r2'), { 'events/trip/event.json': '{"edited":"by hand"}' });
  r = await run();
  assert.deepEqual([r.equal, r.mismatch], [3, 1]);
  assert.deepEqual(r.detail.map(d => [d.kind, d.key, d.state]), [['event', 'trip', 'mismatch']]);

  Object.assign(served, files('r2'));
  served['content.json'] = content('r2', { competitions: [{ slug: 'quiz' }] });   // a listed file D1 never got
  delete served['black-theatre/page.json'];
  r = await run();
  assert.equal(r.missing, 2);
  assert.deepEqual(r.detail.map(d => d.kind + ':' + d.key + ':' + d.state).sort(), ['comp:quiz:missing', 'content:site:mismatch', 'page:black-theatre:missing']);

  served.down = true;
  r = await run();
  assert.deepEqual([r.total, r.errors], [1, 1]);
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM shadow_checks').first()).n, 5);
});

test('seed: copies what the site has and D1 lacks, as live revisions; a later shadow publish still goes through', async () => {
  const h = harness();
  const now = Date.now();
  const site = fakeSite(files('r1'));
  const r = await shadowCheck(h.env, { fetchImpl: site.fetchImpl, seed: true, now });
  assert.deepEqual([r.seeded, r.clean], [4, true]);
  assert.equal((await h.call('/v1/public/event/trip')).body.v, 'r1', 'served from the seed');
  const job = await h.db.prepare("SELECT mode, files FROM publish_jobs WHERE id LIKE 'seed-%'").first();
  assert.deepEqual({ ...job }, { mode: 'seed', files: 4 });
  assert.deepEqual(await shadowCheck(h.env, { fetchImpl: site.fetchImpl, now: now + 15 * MIN }), { skipped: 'no publish posted yet' }, 'a seed alone does not start the cron');

  const p = await post(h, 'pub-1', { 'content.json': content('r2') }, now - 5 * MIN);   // started before the seed, posted after
  assert.equal(p.status, 200, 'a seed never makes a real publish "older"');
  assert.deepEqual(p.body.changed.map(c => c.kind + '@' + c.rev), ['content@2']);
  const again = await shadowCheck(h.env, { fetchImpl: site.fetchImpl, seed: true, now: now + 20 * MIN, settle: false });
  assert.deepEqual([again.seeded, again.lag, again.equal], [0, 1, 3], 'nothing seeded twice; the site lags behind r2');
});

test('status: the gate counts clean days since the last unclean run', async () => {
  const h = harness();
  const day = 24 * 60 * MIN;
  const base = Date.now() - 10 * day;
  await post(h, 'pub-1', files('r1'), base - day);
  const site = fakeSite(files('r1'));
  await shadowCheck(h.env, { fetchImpl: site.fetchImpl, now: base });
  const bad = fakeSite({ ...files('r1'), down: true });
  await shadowCheck(h.env, { fetchImpl: bad.fetchImpl, now: base + day });
  await shadowCheck(h.env, { fetchImpl: site.fetchImpl, now: base + 2 * day });
  await shadowCheck(h.env, { fetchImpl: site.fetchImpl, now: base + 9 * day });
  const s = await shadowStatus(h.db, base + 9 * day);
  assert.equal(s.checks, 4);
  assert.equal(s.lastDirtyAt, base + day);
  assert.equal(s.cleanSince, base + 2 * day);
  assert.equal(s.cleanDays, 7);
  assert.equal(s.last.equal, 4);
  assert.equal(s.jobs[0].id, 'pub-1');
});

test('cron: every 15 minutes (on the per-minute trigger), never breaking the notifications tick', async () => {
  const h = harness();
  await post(h, 'pub-1', files('r1'), Date.UTC(2026, 9, 21, 9, 0));
  const reads = [];
  const real = globalThis.fetch;
  globalThis.fetch = async url => { reads.push(url); return new Response(files('r1')[url.slice(SITE.length + 1).replace(/\?.*$/, '')] ?? 'x', { status: 200 }); };
  try {
    await scheduled({ cron: '* * * * *', scheduledTime: Date.UTC(2026, 9, 21, 10, 7) }, h.env);
    assert.equal(reads.length, 0, 'minute 7: no check');
    await scheduled({ cron: '* * * * *', scheduledTime: Date.UTC(2026, 9, 21, 10, 15) }, h.env);
    assert.equal(reads.length, 4, 'minute 15: one check');
  } finally {
    globalThis.fetch = real;
  }
  assert.equal((await h.db.prepare('SELECT equal FROM shadow_checks').first()).equal, 4);
});

test('admin routes: status (system.view) and a run now (system.manage)', async () => {
  const g = await fakeGoogle();
  const h = harness();
  await h.db.prepare("INSERT INTO admins (email, name, role, active, created_at) VALUES ('admin@example.com', 'A', 'primary', 1, 0)").run();
  const auth = { authorization: 'Bearer ' + await g.sign(g.claims()) };
  const site = fakeSite(files('r1'));
  const fetchBoth = async (url, init) => (String(url).startsWith(SITE) ? site.fetchImpl(url, init) : g.fetch(url, init));
  const run = await h.call('/v1/admin/publish/shadow-check', { method: 'POST', body: { seed: true }, headers: auth, fetch: fetchBoth });
  assert.equal(run.status, 200, JSON.stringify(run.body));
  assert.equal(run.body.seeded, 4);
  const status = await h.call('/v1/admin/publish/status', { headers: auth, fetch: fetchBoth });
  assert.equal(status.status, 200);
  assert.equal(status.body.checks, 1);
  assert.equal((await h.call('/v1/admin/publish/status')).status, 401, 'no token');
});
