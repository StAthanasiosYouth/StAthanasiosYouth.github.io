// Final pass M (the map card): unit checks in Node.
//   - map-route.js: distances / times in Arabic, the request body (only the
//     start, rounded), reading the web app's answers and error codes
//   - apps-script/Route.gs in the fake Apps Script world: the ORS key stays
//     on the server (Script Property ORS_API_KEY), validation (profile,
//     Egypt, 1,000 km), the church from Settings, caching, the minute/day
//     budgets, upstream errors mapped to config / busy / invalid / upstream,
//     replies with only the documented fields, nothing written anywhere
//   - the vendored Leaflet is the official 1.9.4 file with its licence; the
//     public CSP adds only the OSM tiles and the Apps Script hosts
//
// Run: cd tools && node --test ../tests/final-m.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { ROOT } from '../tools/lib/gs.mjs';
import { createWorld } from './fakes/gas.mjs';
import { formatDistance, formatDuration, routeBody, readRoute, PROFILES } from '../assets/js/map-route.js';

const ADMIN = 'menazakmena@gmail.com';
const CHURCH = { lat: 26.7314392, lng: 33.9379229 };
const KEY = 'test-ors-key-0123456789';
const plain = value => JSON.parse(JSON.stringify(value));


/* =========================================================
   map-route.js
========================================================= */

test('distances: metres under a kilometre, then km with an Arabic decimal comma', () => {
  assert.equal(formatDistance(0), '١٠ متر');
  assert.equal(formatDistance(847), '٨٥٠ متر');
  assert.equal(formatDistance(2430), '٢٫٤ كم');
  assert.equal(formatDistance(3000), '٣ كم');
  assert.equal(formatDistance(12600), '١٣ كم');
  assert.equal(formatDistance(980), '١ كم');
});

test('times: whole minutes (at least one), hours in words', () => {
  assert.equal(formatDuration(20), 'دقيقة');
  assert.equal(formatDuration(690), '١٢ دقيقة');
  assert.equal(formatDuration(3600), 'ساعة');
  assert.equal(formatDuration(4200), 'ساعة و١٠ دقايق');
  assert.equal(formatDuration(7500), 'ساعتين و٥ دقايق');
});

test('the request: fn "route", the profile and only the start, rounded to 4 decimals', () => {
  const body = JSON.parse(routeBody(PROFILES.foot, { lat: 26.740512345, lng: 33.930298765 }));
  assert.deepEqual(body, { fn: 'route', args: [{ profile: 'foot-walking', from: [33.9303, 26.7405] }] });
  assert.equal(PROFILES.car, 'driving-car');
});

test('answers: the route (plain or wrapped in result), codes, and anything odd = upstream', () => {
  const route = { ok: true, profile: 'driving-car', distance: 2430, duration: 690, geometry: [[33.93, 26.74], [33.9379, 26.7314]] };
  const read = readRoute(route);
  assert.deepEqual(read, { ok: true, distance: 2430, duration: 690, line: [[26.74, 33.93], [26.7314, 33.9379]] });
  assert.deepEqual(readRoute({ ok: true, result: route }), read);
  for (const code of ['config', 'busy', 'invalid']) assert.deepEqual(readRoute({ ok: false, code, message: 'x' }), { ok: false, code });
  assert.deepEqual(readRoute({ ok: false, code: 'denied', error: 'x' }), { ok: false, code: 'upstream' }, 'an API error from doPost');
  assert.deepEqual(readRoute({ ok: false, code: 'toString' }), { ok: false, code: 'upstream' });
  assert.deepEqual(readRoute(null), { ok: false, code: 'upstream' });
  assert.deepEqual(readRoute({ ok: true, distance: 1, duration: 1, geometry: [[1, 2]] }), { ok: false, code: 'upstream' }, 'a line needs two points');
  assert.deepEqual(readRoute({ ok: true, distance: '1', duration: 1, geometry: [[1, 2], [3, 4]] }), { ok: false, code: 'upstream' });
});


/* =========================================================
   apps-script/Route.gs
========================================================= */

/* a fake openrouteservice behind UrlFetchApp (other URLs keep the fake world's own) */
function routeWorld({ key = KEY, settings = null, answer = null } = {}) {

  const world = createWorld();
  vm.runInContext(readFileSync(`${ROOT}apps-script/Route.gs`, 'utf8'), world.gs, { filename: 'Route.gs' });

  if (settings) {
    world.as(ADMIN).gs.setup();
    world.gs.apiSaveSettings(settings);
  }
  if (key) world.properties.set('ORS_API_KEY', key);

  const calls = [];
  const ors = { answer: answer || (() => ({ status: 200, body: geojson(ors.line) })), line: [[33.9303, 26.7405], [33.934, 26.73], [CHURCH.lng, CHURCH.lat]] };
  const original = world.gs.UrlFetchApp.fetch;
  world.gs.UrlFetchApp.fetch = (url, options) => {
    if (!String(url).startsWith('https://api.openrouteservice.org/')) return original(url, options);
    calls.push({ url, options, body: JSON.parse(options.payload) });
    const reply = ors.answer(url, options);
    if (reply instanceof Error) throw reply;
    return { getResponseCode: () => reply.status, getContentText: () => (typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body)), getHeaders: () => ({}) };
  };

  const route = request => plain(world.gs.publicRoute_(request));

  return { world, calls, ors, route };

}

function geojson(line, summary = { distance: 2430.4, duration: 690.2 }) {
  return {
    type: 'FeatureCollection',
    bbox: [33.93, 26.73, 33.94, 26.75],
    features: [{ type: 'Feature', properties: { summary, way_points: [0, line.length - 1] }, geometry: { type: 'LineString', coordinates: line } }],
    metadata: { attribution: 'openrouteservice.org | OpenStreetMap contributors', query: { coordinates: [] } }
  };
}

const FROM = [33.930298765, 26.740512345];

test('Route.gs: a route from the start to the church (never a destination from the request)', () => {
  const { route, calls } = routeWorld();
  const answer = route({ profile: 'driving-car', from: FROM, to: [31.2, 30.0] });
  assert.deepEqual(Object.keys(answer).sort(), ['distance', 'duration', 'geometry', 'ok', 'profile']);
  assert.deepEqual(answer, { ok: true, profile: 'driving-car', distance: 2430, duration: 690, geometry: [[33.9303, 26.7405], [33.934, 26.73], [33.93792, 26.73144]] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.openrouteservice.org/v2/directions/driving-car/geojson');
  assert.equal(calls[0].options.method, 'post');
  assert.equal(calls[0].options.headers.Authorization, KEY);
  assert.equal(calls[0].options.muteHttpExceptions, true);
  assert.deepEqual(calls[0].body, { coordinates: [[33.9303, 26.7405], [CHURCH.lng, CHURCH.lat]], instructions: false, units: 'm' });
  assert.ok(!JSON.stringify(answer).includes(KEY), 'the key never leaves the server');
});

test('Route.gs: walking too; profiles outside the list and malformed starts are refused before any call', () => {
  const { route, calls } = routeWorld();
  assert.equal(route({ profile: 'foot-walking', from: FROM }).ok, true);
  assert.match(calls[0].url, /\/foot-walking\/geojson$/);
  const bad = [
    null, 'x', [], {},
    { profile: 'cycling-regular', from: FROM },
    { profile: 'driving-car' },
    { profile: 'driving-car', from: [33.93] },
    { profile: 'driving-car', from: ['33.93', '26.74'] },
    { profile: 'driving-car', from: [NaN, 26.74] },
    { profile: 'driving-car', from: [33.93, Infinity] },
    { profile: 'driving-car', from: [2.35, 48.85] },        // Paris: outside Egypt
    { profile: 'driving-car', from: [34.2, 21.5] },         // south of the box
    { profile: 'driving-car', from: [24.8, 22.0] }          // in Egypt (the far south-west corner) but > 1,000 km away
  ];
  for (const request of bad) {
    const answer = route(request);
    assert.deepEqual(Object.keys(answer).sort(), ['code', 'message', 'ok']);
    assert.equal(answer.code, 'invalid', JSON.stringify(request));
    assert.match(answer.message, /[؀-ۿ]/, 'an Arabic message');
  }
  assert.equal(calls.length, 1, 'no upstream call for a refused request');
  assert.equal(route({ profile: 'driving-car', from: [33.81, 27.25] }).ok, true, 'Hurghada');
  assert.equal(route({ profile: 'driving-car', from: [32.64, 25.69] }).ok, true, 'Luxor (about 170 km)');
  assert.equal(route({ profile: 'driving-car', from: [31.23, 30.04] }).ok, true, 'Cairo (about 450 km): visitors may come from anywhere in Egypt');
});

test('Route.gs: no key = config (and no call)', () => {
  const { route, calls } = routeWorld({ key: null });
  assert.equal(route({ profile: 'driving-car', from: FROM }).code, 'config');
  assert.equal(calls.length, 0);
});

test('Route.gs: answers are cached 6 h per profile and the start rounded to ~11 m', () => {
  const { world, route, calls } = routeWorld();
  const first = route({ profile: 'driving-car', from: FROM });
  assert.deepEqual(route({ profile: 'driving-car', from: [33.93032, 26.74048] }), first, 'the same rounded start');
  assert.equal(calls.length, 1);
  route({ profile: 'foot-walking', from: FROM });
  assert.equal(calls.length, 2, 'another profile is another route');
  const entry = [...world.cache.entries()].find(([k]) => k.startsWith('route:driving-car:'));
  assert.equal(entry[1].seconds, 21600);
  world.advance(6 * 3600 * 1000 + 1000);
  route({ profile: 'driving-car', from: FROM });
  assert.equal(calls.length, 3, 'asked again after 6 h');
});

test('Route.gs: upstream errors map to config / busy / invalid / upstream, never the upstream text', () => {
  const cases = [
    [{ status: 401, body: { error: 'Access to this API has been disallowed' } }, 'config'],
    [{ status: 403, body: { error: 'Quota exceeded' } }, 'config'],
    [{ status: 429, body: { error: 'Rate limit exceeded' } }, 'busy'],
    [{ status: 500, body: { error: { code: 2099, message: 'Unknown internal error.' } } }, 'upstream'],
    [{ status: 503, body: '<html>down</html>' }, 'upstream'],
    [{ status: 404, body: { error: { code: 2010, message: 'Could not find routable point within a radius of 350.0 meters of specified coordinate 0' } } }, 'invalid'],
    [{ status: 400, body: { error: { code: 2004, message: 'Request parameters exceed the server configuration limits.' } } }, 'invalid'],
    [{ status: 400, body: { error: { code: 2003, message: 'Parameter units has incorrect value' } } }, 'upstream'],
    [{ status: 200, body: 'not json' }, 'upstream'],
    [{ status: 200, body: { type: 'FeatureCollection', features: [] } }, 'upstream'],
    [new Error('DNS error: api.openrouteservice.org'), 'upstream']
  ];
  for (const [reply, code] of cases) {
    const { route } = routeWorld({ answer: () => reply });
    const answer = route({ profile: 'driving-car', from: FROM });
    assert.deepEqual(Object.keys(answer).sort(), ['code', 'message', 'ok'], code);
    assert.equal(answer.code, code, JSON.stringify(reply.body || reply.message));
    assert.doesNotMatch(answer.message, /routable|Quota|Rate|DNS|Unknown|html/i);
  }
});

test('Route.gs: an unroutable start is cached too; other failures are not', () => {
  const { route, calls, ors } = routeWorld();
  ors.answer = () => ({ status: 404, body: { error: { code: 2010, message: 'x' } } });
  route({ profile: 'foot-walking', from: FROM });
  route({ profile: 'foot-walking', from: FROM });
  assert.equal(calls.length, 1);
  ors.answer = () => ({ status: 502, body: 'bad gateway' });
  route({ profile: 'driving-car', from: FROM });
  ors.answer = () => ({ status: 200, body: geojson(ors.line) });
  assert.equal(route({ profile: 'driving-car', from: FROM }).ok, true, 'a passing failure is retried');
  assert.equal(calls.length, 3);
});

test('Route.gs: at most 30 upstream calls a minute and 1,500 a day (cached answers are free)', () => {
  const { world, route, calls } = routeWorld();
  const start = i => [33.9 + i * 0.001, 26.7];
  for (let i = 0; i < 30; i++) assert.equal(route({ profile: 'driving-car', from: start(i) }).ok, true);
  assert.equal(route({ profile: 'driving-car', from: start(31) }).code, 'busy');
  assert.equal(route({ profile: 'driving-car', from: start(3) }).ok, true, 'a cached start still answers');
  assert.equal(calls.length, 30);
  world.advance(61 * 1000);
  assert.equal(route({ profile: 'driving-car', from: start(31) }).ok, true, 'the next minute');
  const today = new Date(Date.now() + world.clock.skew).toISOString().slice(0, 10);
  assert.equal(world.properties.get('ROUTE_DAY_COUNT'), `${today}:31`);
  world.properties.set('ROUTE_DAY_COUNT', `${today}:1500`);
  world.advance(61 * 1000);
  assert.equal(route({ profile: 'driving-car', from: start(40) }).code, 'busy', 'the day budget');
  world.properties.set('ROUTE_DAY_COUNT', `1999-01-01:1500`);
  assert.equal(route({ profile: 'driving-car', from: start(41) }).ok, true, 'a new day');
  world.scriptLock.busy = true;
  world.advance(61 * 1000);
  assert.equal(route({ profile: 'driving-car', from: start(42) }).ok, true, 'a busy script lock (an admin publishing) does not block routes');
});

test('Route.gs: long lines are simplified to at most 400 points, ends kept', () => {
  const line = Array.from({ length: 3000 }, (_, i) => [33.93 + i * 0.00001 + Math.sin(i / 7) * 0.0003, 26.74 - i * 0.000004]);
  line.push([CHURCH.lng, CHURCH.lat]);
  const { route, ors } = routeWorld();
  ors.line = line;
  const answer = route({ profile: 'driving-car', from: FROM });
  assert.ok(answer.geometry.length <= 400 && answer.geometry.length > 50, `${answer.geometry.length} points`);
  assert.deepEqual(answer.geometry[0], [33.93, 26.74]);
  assert.deepEqual(answer.geometry.at(-1), [33.93792, 26.73144]);
  assert.ok(JSON.stringify(answer).length < 20000);
});

test('Route.gs: the church comes from Settings (cached 10 min); nothing is written to the spreadsheet', () => {
  const { world, route, calls } = routeWorld({ settings: { 'location.lat': '26.75', 'location.lng': '33.95' } });
  const before = JSON.stringify(world.spreadsheet.getSheets().map(s => [s.name, s.data]));
  assert.equal(route({ profile: 'driving-car', from: FROM }).ok, true);
  assert.deepEqual(calls[0].body.coordinates[1], [33.95, 26.75]);
  assert.equal(JSON.stringify(world.spreadsheet.getSheets().map(s => [s.name, s.data])), before, 'no log rows, no writes');
  assert.ok(![...world.properties.keys()].some(k => /route/i.test(k) && k !== 'ROUTE_DAY_COUNT'));
  assert.ok(![...world.properties.values()].some(v => String(v).includes('33.9303')), 'the start is never stored');
});

test('Route.gs: no spreadsheet (or no coordinates) = the known church', () => {
  const { route, calls } = routeWorld();
  route({ profile: 'driving-car', from: FROM });
  assert.deepEqual(calls[0].body.coordinates[1], [CHURCH.lng, CHURCH.lat]);
});


/* =========================================================
   vendored Leaflet, CSP
========================================================= */

// (line endings normalized: the upstream CSS is CRLF, git may store either)
const sha256 = path => createHash('sha256').update(readFileSync(path, 'utf8').replace(/\r\n/g, '\n')).digest('hex');

test('Leaflet 1.9.4 is the official build (npm leaflet@1.9.4 dist), with its BSD licence', () => {
  const dir = `${ROOT}assets/vendor/leaflet/`;
  assert.equal(sha256(`${dir}leaflet.js`), 'db49d009c841f5ca34a888c96511ae936fd9f5533e90d8b2c4d57596f4e5641a');
  assert.equal(sha256(`${dir}leaflet.css`), '337bfca5cabd03b39815b2700febe2b3b7edf55921c59cd49f88ecb328212303');
  assert.ok(existsSync(`${dir}LICENSE`));
  assert.match(readFileSync(`${dir}LICENSE`, 'utf8'), /BSD 2-Clause License[\s\S]*Agafonkin/);
});

test('public CSP: only the OSM tiles (img) and the Apps Script hosts (connect) are added', () => {
  const html = readFileSync(`${ROOT}index.html`, 'utf8');
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)[1];
  const rules = Object.fromEntries(csp.split(';').map(s => s.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
  assert.deepEqual(rules['script-src'], ["'self'"]);
  assert.deepEqual(rules['style-src'], ["'self'"]);
  assert.deepEqual(rules['img-src'], ["'self'", 'data:', 'blob:', 'https://tile.openstreetmap.org']);
  assert.deepEqual(rules['connect-src'], ["'self'", 'https://script.google.com', 'https://script.googleusercontent.com']);
  assert.deepEqual(rules['frame-src'], ['https://www.google.com']);
  assert.doesNotMatch(csp, /openrouteservice/, 'routing goes through Apps Script, never from the browser');
  assert.match(html, /<meta name="referrer" content="strict-origin-when-cross-origin">/);
  assert.doesNotMatch(readFileSync(`${ROOT}assets/js/map-config.js`, 'utf8') + readFileSync(`${ROOT}assets/js/map.js`, 'utf8'), /api\.openrouteservice|ORS_API_KEY\s*=|Authorization/);
});


test('doPost: the public route action needs no sign-in and reaches nothing else', () => {
  const { world, calls } = routeWorld();
  world.as('');
  // a visitor (no token, no session): a route answer, through the real API entry
  const reply = world.post({ fn: 'route', args: [{ profile: 'driving-car', from: [33.93, 26.74] }] });
  assert.equal(reply.ok, true, JSON.stringify(reply));
  assert.equal(calls.length, 1, 'one upstream call');
  assert.equal(typeof reply.distance, 'number');
  assert.ok(!JSON.stringify(reply).includes(KEY), 'the key never comes back');
  // anything else without a token is still refused
  const admin = world.post({ fn: 'apiState', args: [] });
  assert.equal(admin.ok, false);
  assert.equal(admin.code, 'auth');
  // a "route" can't smuggle another function or a destination
  const sneaky = world.post({ fn: 'route', args: [{ profile: 'driving-car', from: [33.93, 26.74], to: [0, 0], fn: 'apiState' }] });
  assert.equal(calls.at(-1).body.coordinates.at(-1)[0] !== 0, true, 'the destination is always the church');
  assert.ok(!('state' in sneaky));
});
