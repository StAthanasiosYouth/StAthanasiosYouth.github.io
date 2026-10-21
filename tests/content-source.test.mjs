// Phase 2 P2-3: where published content comes from (assets/js/content-source.js) — the switch,
// the localhost-only overrides, the Worker first with the static file as the fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONTENT_SOURCE, resolveContentSource, workerPath, fetchPublished } from '../assets/js/content-source.js';

const PROD = 'https://athanasios-api.menazak-lab.workers.dev';
const STAGING = 'https://athanasios-api-staging.menazak-lab.workers.dev';
const loc = (url) => new URL(url);
const store = (map = {}) => ({ getItem: k => (k in map ? map[k] : null) });
const WORKER = { mode: 'worker', api: STAGING };

test('the switch: static (the default and the rollback) or worker (the P2-9 cutover); overrides only on localhost', () => {
  assert.ok(['static', 'worker'].includes(CONTENT_SOURCE), CONTENT_SOURCE);
  const other = CONTENT_SOURCE === 'static' ? 'worker' : 'static';
  assert.deepEqual(resolveContentSource(loc(`https://stathanasiosyouth.github.io/?content=${other}&api=https://evil.example`), store({ 'athanasios.content.source': other })), { mode: CONTENT_SOURCE, api: PROD }, 'the site: the switch, never an override');
  assert.deepEqual(resolveContentSource(loc('http://localhost:8080/?content=worker'), store()), { mode: 'worker', api: PROD });
  assert.deepEqual(resolveContentSource(loc(`http://127.0.0.1:8080/?content=worker&api=${STAGING}`), store()), { mode: 'worker', api: STAGING });
  assert.deepEqual(resolveContentSource(loc('http://localhost:8080/'), store({ 'athanasios.content.source': 'worker', 'athanasios.book.api': STAGING })), { mode: 'worker', api: STAGING });
  // on this machine: the repo's files unless asked (local previews and tests never read the live Worker)
  assert.equal(resolveContentSource(loc('http://localhost:8080/'), store()).mode, 'static');
  assert.equal(resolveContentSource(loc('http://localhost:8080/?content=nonsense'), store()).mode, 'static');
  assert.equal(resolveContentSource(loc('http://localhost:8080/?content=static'), store({ 'athanasios.content.source': 'worker' })).mode, 'static');
  assert.equal(resolveContentSource(null, null).mode, CONTENT_SOURCE, 'no location (not a browser): the switch');
  assert.equal(resolveContentSource(loc('http://localhost:8080/'), { getItem() { throw new Error('blocked'); } }).mode, 'static');
});

test('workerPath: the four public routes; a bad slug or kind has none', () => {
  assert.equal(workerPath('content'), '/v1/public/content');
  assert.equal(workerPath('page', 'black-theatre'), '/v1/public/page/black-theatre');
  assert.equal(workerPath('event', 'trip'), '/v1/public/event/trip');
  assert.equal(workerPath('comp', 'q1'), '/v1/public/comp/q1');
  for (const [k, s] of [['page', ''], ['page', '../x'], ['event', 'a--b'], ['events', 'x'], ['ics', ''], ['comp', 'A']]) assert.equal(workerPath(k, s), '', k + ' ' + s);
});

function fakeFetch(worker, statik = async () => new Response('{"static":true}', { status: 200 })) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return String(url).startsWith(STAGING) ? worker(init) : statik(init);
  };
  return { fn, calls };
}
const body = async r => (await r.json());
const wait = ms => new Promise(r => setTimeout(r, ms));
const later = (ms, text) => async () => { await wait(ms); return new Response(text, { status: 200 }); };

test('worker mode: the Worker and the static file are asked at once; a Worker within the grace → its file', async () => {
  const f = fakeFetch(async () => new Response('{"worker":true}', { status: 200 }));
  const r = await fetchPublished('content.json', { cache: 'no-cache' }, { kind: 'content' }, { source: WORKER, fetchImpl: f.fn });
  assert.deepEqual(await body(r), { worker: true });
  assert.deepEqual(f.calls.map(c => c.url), [STAGING + '/v1/public/content', 'content.json']);
  assert.deepEqual([f.calls[0].init.cache, f.calls[0].init.credentials, f.calls[0].init.mode], ['no-cache', 'omit', 'cors']);
});

test('worker mode: a slow Worker never slows the page — the static file at once, the newer file to onNewer', async () => {
  const newer = [];
  const f = fakeFetch(later(150, '{"worker":2}'));
  const t0 = Date.now();
  const r = await fetchPublished('content.json', { cache: 'no-cache' }, { kind: 'content', onNewer: n => newer.push(n) }, { source: WORKER, fetchImpl: f.fn, graceMs: 20 });
  assert.ok(Date.now() - t0 < 120, 'not waiting for the Worker');
  assert.deepEqual(await body(r), { static: true }, 'the caller reads the static body (not consumed by the comparison)');
  await wait(250);
  assert.equal(newer.length, 1);
  assert.deepEqual(await body(newer[0]), { worker: 2 });

  // the same file late, a failing or a too-slow Worker: no onNewer
  for (const [worker, opts] of [
    [later(60, '{"static":true}'), {}],
    [async () => new Response('down', { status: 503 }), {}],
    [later(400, '{"worker":3}'), { timeoutMs: 100 }]
  ]) {
    const seen = [];
    const g = fakeFetch(worker);
    const s = await fetchPublished('content.json', { cache: 'no-cache' }, { kind: 'content', onNewer: n => seen.push(n) }, { source: WORKER, fetchImpl: g.fn, graceMs: 20, ...opts });
    assert.deepEqual(await body(s), { static: true });
    await wait(500);
    assert.equal(seen.length, 0);
  }
});

test('worker mode: the static file missing or failing (just published) → the Worker waited for; else the static answer', async () => {
  const missing = async () => new Response('not found', { status: 404 });
  const r = await fetchPublished('new/page.json', { cache: 'no-cache' }, { kind: 'page', slug: 'new' }, { source: WORKER, fetchImpl: fakeFetch(later(100, '{"worker":1}'), missing).fn });
  assert.deepEqual(await body(r), { worker: 1 });
  const offline = async () => { throw new TypeError('Failed to fetch'); };
  const o = await fetchPublished('new/page.json', { cache: 'no-cache' }, { kind: 'page', slug: 'new' }, { source: WORKER, fetchImpl: fakeFetch(later(10, '{"worker":1}'), offline).fn });
  assert.deepEqual(await body(o), { worker: 1 });
  for (const worker of [
    async () => new Response('{}', { status: 404 }),
    async () => new Response('{"code":"disabled"}', { status: 403 }),
    async () => { throw new TypeError('Failed to fetch'); }
  ]) {
    const m = await fetchPublished('new/page.json', { cache: 'no-cache' }, { kind: 'page', slug: 'new' }, { source: WORKER, fetchImpl: fakeFetch(worker, missing).fn });
    assert.equal(m.status, 404, 'the page shows «مش متاحة» as today');
    await assert.rejects(fetchPublished('x.json', { cache: 'no-cache' }, { kind: 'content' }, { source: WORKER, fetchImpl: fakeFetch(worker, offline).fn }), /Failed to fetch/, 'offline: the loader tries its force-cache copy next');
  }
});

test('worker mode: 404, 403 (CONTENT_SERVE=0), 5xx, a network error or a hung Worker → the static file, the same init', async () => {
  for (const worker of [
    async () => new Response('{}', { status: 404 }),
    async () => new Response('{"code":"disabled"}', { status: 403 }),
    async () => new Response('down', { status: 503 }),
    async () => { throw new TypeError('Failed to fetch'); },
    init => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
  ]) {
    const f = fakeFetch(worker);
    const t0 = Date.now();
    const r = await fetchPublished('events/trip/event.json', { cache: 'no-cache', credentials: 'same-origin' }, { kind: 'event', slug: 'trip' }, { source: WORKER, fetchImpl: f.fn });
    assert.deepEqual(await body(r), { static: true });
    assert.ok(Date.now() - t0 < 1000);
    assert.equal(f.calls.find(c => c.url === 'events/trip/event.json').init.credentials, 'same-origin', 'the static request keeps its own init');
  }
});

test('static mode, the offline retry (force-cache) and a slug the Worker cannot have → the static file only', async () => {
  for (const [init, published, source] of [
    [{ cache: 'no-cache' }, { kind: 'content' }, { mode: 'static', api: PROD }],
    [{ cache: 'force-cache' }, { kind: 'content' }, WORKER],
    [{ cache: 'no-cache' }, { kind: 'page', slug: '../x' }, WORKER]
  ]) {
    const f = fakeFetch(async () => { throw new Error('the Worker must not be asked'); });
    await fetchPublished('x.json', init, published, { source, fetchImpl: f.fn });
    assert.deepEqual(f.calls.map(c => c.url), ['x.json']);
  }
});

test('the three loaders go through fetchPublished (content.json, page/event/list, comp.json)', () => {
  const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
  assert.match(read('assets/js/content.js'), /fetchPublished\('content\.json', \{ cache: 'no-cache' \}, \{ kind: 'content', onNewer: newer \}\)/);
  const page = read('assets/js/page/main.js');
  assert.match(page, /fetchJson\(new URL\('content\.json', ROOT\), \{ kind: 'content', onNewer: newer\(/);
  assert.match(page, /\{ kind: KIND, slug: html\.dataset\.slug \|\| '', onNewer: newer\(/);
  // a drawn page is redrawn only when nothing is in the visitor's hands
  assert.match(page, /const quiet = kind => [^\n]*!booker && !statusPanel && !sheet\.isOpen && !location\.hash/);
  assert.match(read('assets/js/comp/main.js'), /fetchPublished\(url, \{ cache, credentials: 'same-origin' \}, \{ kind: 'comp', slug \}\)/);
});

test('content-source.js imports nothing: a page without online booking still loads no booking module', () => {
  const src = readFileSync(new URL('../assets/js/content-source.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^\s*import\s/m);
});
