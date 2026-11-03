// Phase 6 Step 5 (docs/PHASE6-PLAN.md): the map card's routes on the Worker (src/route.js), Route.gs's contract,
// against a fake openrouteservice. Real SQLite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers.mjs';
import { simplify, routeKm, ROUTE_CHURCH, ROUTE_PER_MINUTE } from '../src/route.js';
import { readRoute, routeBody } from '../../assets/js/map-route.js';

function ors({ status = 200, code = 0 } = {}) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, auth: init.headers.authorization, body: JSON.parse(init.body) });
    if (status !== 200) return Response.json({ error: { code, message: 'x' } }, { status });
    const line = Array.from({ length: 600 }, (_, i) => [33.9 + i * 0.0001, 26.7 + Math.sin(i / 7) * 0.0005]);
    return Response.json({ features: [{ geometry: { coordinates: line }, properties: { summary: { distance: 4321.4, duration: 610.6 } } }] });
  };
  return { f, calls };
}

const world = (env = {}) => harness({ env: { ORS_API_KEY: ' "ors-test-key"\n', ...env } });
const ask = (h, body, f, headers = {}) => h.call('/v1/public/route', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'text/plain;charset=utf-8', ...headers }, fetch: f });

test('the page\'s own body, as text/plain; the answer where readRoute looks; the key cleaned and never sent back', async () => {
  const h = world();
  const { f, calls } = ors();
  const r = await ask(h, routeBody('driving-car', { lat: 26.75, lng: 33.93 }), f);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const read = readRoute(r.body);
  assert.equal(read.ok, true);
  assert.deepEqual([read.distance, read.duration], [4321, 611]);
  assert.ok(read.line.length <= 400 && read.line.length >= 2, 'simplified to 400 points at most');
  assert.equal(calls[0].auth, 'ors-test-key', 'a pasted key\'s quotes and spaces are dropped');
  assert.deepEqual(calls[0].body.coordinates, [[33.93, 26.75], [ROUTE_CHURCH.lng, ROUTE_CHURCH.lat]], 'to the church, never the request\'s');
  assert.ok(!JSON.stringify(r.body).includes('ors-test-key'));
});

test('the same start (rounded to ≈ 11 m) is answered from the cache; the cache keeps only the rounded point', async () => {
  const h = world();
  const { f, calls } = ors();
  await ask(h, { profile: 'foot-walking', from: [33.93001, 26.75001] }, f);
  await ask(h, { profile: 'foot-walking', from: [33.93004, 26.75004] }, f);
  assert.equal(calls.length, 1);
  const keys = (await h.db.prepare('SELECT key FROM route_cache').all()).results.map(r => r.key);
  assert.deepEqual(keys, ['foot-walking:33.9300,26.7500:' + ROUTE_CHURCH.lat + ',' + ROUTE_CHURCH.lng]);
});

test('refused shapes, outside Egypt, no key, a refused key, a road-less start, a busy upstream', async () => {
  const h = world();
  const code = async (body, f = ors().f, env) => readRoute((await ask(env ? world(env) : h, body, f)).body).code;
  assert.equal(await code({ profile: 'flying', from: [33.9, 26.7] }), 'invalid');
  assert.equal(await code({ profile: 'driving-car', from: ['33.9', 26.7] }), 'invalid');
  assert.equal(await code({ profile: 'driving-car', from: [2.35, 48.85] }), 'invalid', 'Paris');
  assert.equal(await code({ profile: 'driving-car', from: [33.9, 26.7] }, ors().f, { ORS_API_KEY: '' }), 'config');
  assert.equal(await code({ profile: 'driving-car', from: [33.91, 26.71] }, ors({ status: 403 }).f), 'config');
  assert.equal(await code({ profile: 'driving-car', from: [33.92, 26.72] }, ors({ status: 429 }).f), 'busy');
  const road = ors({ status: 404, code: 2010 });
  assert.equal(await code({ profile: 'driving-car', from: [33.95, 26.74] }, road.f), 'invalid');
  assert.equal(await code({ profile: 'driving-car', from: [33.95, 26.74] }, road.f), 'invalid');
  assert.equal(road.calls.length, 1, 'a road-less start is cached too');
  assert.equal(await code({ profile: 'driving-car', from: [33.96, 26.75] }, ors({ status: 500 }).f), 'upstream');
});

test('budgets: the minute\'s upstream calls, then busy; a visitor\'s own limit', async () => {
  const h = world();
  const { f } = ors();
  const codes = [];
  for (let i = 0; i < ROUTE_PER_MINUTE + 1; i++) {
    const r = await ask(h, { profile: 'driving-car', from: [33.9 + i * 0.001, 26.7] }, f, { 'cf-connecting-ip': '10.0.0.' + (i % 200) });
    codes.push(readRoute(r.body).ok ? 'ok' : readRoute(r.body).code);
  }
  assert.equal(codes.filter(c => c === 'ok').length, ROUTE_PER_MINUTE);
  assert.equal(codes[ROUTE_PER_MINUTE], 'busy');
  const one = world();
  let last;
  for (let i = 0; i < 21; i++) last = await ask(one, { profile: 'driving-car', from: [33.9, 26.7] }, f, { 'cf-connecting-ip': '10.9.9.9' });
  assert.equal(readRoute(last.body).code, 'busy', 'one visitor: 20 a minute');
});

test('the church comes from the live content when it has a place', async () => {
  const h = world();
  await h.db.prepare("INSERT INTO published_revisions (id, kind, key, rev, hash, body, live, publish_id, published_at) VALUES ('rev-1', 'content', 'site', 1, 'h', ?, 1, 'p', 0)")
    .bind(JSON.stringify({ location: { lat: 26.8, lng: 33.95 } })).run();
  const { f, calls } = ors();
  await ask(h, { profile: 'driving-car', from: [33.9, 26.7] }, f);
  assert.deepEqual(calls[0].body.coordinates[1], [33.95, 26.8]);
  assert.ok(routeKm(26.7, 33.9, 26.8, 33.95) < 20);
  assert.equal(simplify([[0, 0], [1, 1]]).length, 2);
});
