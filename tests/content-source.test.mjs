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

function fakeFetch(worker) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith(STAGING)) return worker(init);
    return new Response('{"static":true}', { status: 200 });
  };
  return { fn, calls };
}
const body = async r => (await r.json());

test('worker mode: the Worker answers → its file; the request is credential-less CORS with no-cache', async () => {
  const f = fakeFetch(async () => new Response('{"worker":true}', { status: 200 }));
  const r = await fetchPublished('content.json', { cache: 'no-cache' }, { kind: 'content' }, { source: WORKER, fetchImpl: f.fn });
  assert.deepEqual(await body(r), { worker: true });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, STAGING + '/v1/public/content');
  assert.deepEqual([f.calls[0].init.cache, f.calls[0].init.credentials, f.calls[0].init.mode], ['no-cache', 'omit', 'cors']);
});

test('worker mode: 404, 403 (CONTENT_SERVE=0), 5xx, a network error or > 2 s → the static file', async () => {
  for (const worker of [
    async () => new Response('{}', { status: 404 }),
    async () => new Response('{"code":"disabled"}', { status: 403 }),
    async () => new Response('down', { status: 503 }),
    async () => { throw new TypeError('Failed to fetch'); }
  ]) {
    const f = fakeFetch(worker);
    const r = await fetchPublished('events/trip/event.json', { cache: 'no-cache', credentials: 'same-origin' }, { kind: 'event', slug: 'trip' }, { source: WORKER, fetchImpl: f.fn });
    assert.deepEqual(await body(r), { static: true });
    assert.deepEqual(f.calls.map(c => c.url), [STAGING + '/v1/public/event/trip', 'events/trip/event.json']);
    assert.equal(f.calls[1].init.credentials, 'same-origin', 'the static request keeps its own init');
  }
  // never answers: aborted after the timeout
  const slow = fakeFetch(init => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
  const t0 = Date.now();
  const r = await fetchPublished('content.json', { cache: 'no-cache' }, { kind: 'content' }, { source: WORKER, fetchImpl: slow.fn, timeoutMs: 80 });
  assert.deepEqual(await body(r), { static: true });
  assert.ok(Date.now() - t0 < 1000);
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
  assert.match(read('assets/js/content.js'), /fetchPublished\('content\.json', \{ cache: 'no-cache' \}, \{ kind: 'content' \}\)/);
  const page = read('assets/js/page/main.js');
  assert.match(page, /fetchJson\(new URL\('content\.json', ROOT\), \{ kind: 'content' \}\)/);
  assert.match(page, /\{ kind: KIND, slug: html\.dataset\.slug \|\| '' \}/);
  assert.match(read('assets/js/comp/main.js'), /fetchPublished\(url, \{ cache, credentials: 'same-origin' \}, \{ kind: 'comp', slug \}\)/);
});

test('content-source.js imports nothing: a page without online booking still loads no booking module', () => {
  const src = readFileSync(new URL('../assets/js/content-source.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^\s*import\s/m);
});
