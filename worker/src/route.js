/*
 * ROUTES FOR THE PUBLIC PAGE «الاتجاهات» on the Worker (docs/PHASE6-PLAN.md Step 5; Route.gs, the same contract).
 *
 *   POST /v1/public/route  { fn: 'route', args: [{ profile, from: [lng, lat] }] }  (or { profile, from })
 *     → { ok: true, profile, distance (m), duration (s), geometry: [[lng, lat], …] }
 *     → { ok: false, code: 'config' | 'busy' | 'invalid' | 'upstream', message }
 *
 * - The key is the Worker secret ORS_API_KEY: never in a reply, a log or the page.
 * - The destination is never the request's: the church, from the live content's location, else the known point.
 * - `from` inside Egypt and within ROUTE_MAX_KM, rounded to 4 decimals before anything (≈ 11 m). Only that rounded
 *   point is kept, as the cache key, for 6 hours (route_cache), and never logged.
 * - Budgets: ROUTE_PER_MINUTE and ROUTE_PER_DAY upstream calls (the free plan allows 40 and 2,000), and a visitor's
 *   own per-minute limit. Beyond them: 'busy'.
 * - Accepts the page's old body ({ fn, args }) and text/plain, so moving it is only the page's routeUrl.
 */

import { retry } from './lib/db.js';
import { logLine } from './lib/log.js';
import { limit, clientIp } from './lib/ratelimit.js';
import { ApiError } from './lib/http.js';

export const ROUTE_PROFILES = ['driving-car', 'foot-walking'];
export const ROUTE_ENDPOINT = 'https://api.openrouteservice.org/v2/directions/';
export const ROUTE_CHURCH = { lat: 26.7314392, lng: 33.9379229 };
const EGYPT = { minLng: 24.7, maxLng: 37.0, minLat: 21.9, maxLat: 31.8 };
const ROUTE_MAX_KM = 1000;
const ROUTE_MAX_POINTS = 400;
const CACHE_MS = 6 * 3600000;
export const ROUTE_PER_MINUTE = 30;
export const ROUTE_PER_DAY = 1500;
const MESSAGES = {
  config: 'الاتجاهات جوه الموقع مش متاحة دلوقتي. افتحها في خرائط جوجل.',
  busy: 'خدمة الاتجاهات عليها ضغط دلوقتي. جرّب كمان شوية، أو افتحها في خرائط جوجل.',
  invalid: 'مش لاقيين طريق من النقطة دي. جرّب نقطة تانية قريبة من شارع.',
  upstream: 'خدمة الاتجاهات مش بترد دلوقتي. جرّب تاني بعد شوية، أو افتحها في خرائط جوجل.'
};

const failure = code => ({ ok: false, code, message: MESSAGES[code] });

export function routeKm(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function offset(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length)) : 0;
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
}

function douglasPeucker(points, tolerance) {
  const keep = new Array(points.length);
  const stack = [[0, points.length - 1]];
  keep[0] = keep[points.length - 1] = true;
  while (stack.length) {
    const [first, last] = stack.pop();
    let worst = -1;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = offset(points[i], points[first], points[last]);
      if (d > worst) { worst = d; index = i; }
    }
    if (index !== -1 && worst > tolerance) {
      keep[index] = true;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((p, i) => keep[i]);
}

export function simplify(points, max = ROUTE_MAX_POINTS) {
  let tolerance = 0.00002;
  let out = points;
  while (out.length > max) {
    out = douglasPeucker(points, tolerance);
    tolerance *= 2;
  }
  return out;
}

/* the church: the live content's location, else the known point */
async function church(db) {
  const row = await retry(() => db.prepare("SELECT json_extract(body, '$.location.lat') AS lat, json_extract(body, '$.location.lng') AS lng FROM published_revisions WHERE kind = 'content' AND key = 'site' AND live = 1").first());
  const lat = row && Number(row.lat);
  const lng = row && Number(row.lng);
  return row && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (row.lat !== null && row.lng !== null) ? { lat, lng } : ROUTE_CHURCH;
}

export async function routeFor(ctx, request, now = Date.now()) {
  const env = ctx.env;
  const db = env.DB;
  const profile = request && request.profile;
  const from = request && request.from;
  if (!ROUTE_PROFILES.includes(profile) || !Array.isArray(from) || from.length !== 2 || from.some(v => typeof v !== 'number' || !Number.isFinite(v))) return failure('invalid');
  const lng = Math.round(from[0] * 1e4) / 1e4;
  const lat = Math.round(from[1] * 1e4) / 1e4;
  const to = await church(db);
  if (lng < EGYPT.minLng || lng > EGYPT.maxLng || lat < EGYPT.minLat || lat > EGYPT.maxLat || routeKm(lat, lng, to.lat, to.lng) > ROUTE_MAX_KM) return failure('invalid');

  const key = profile + ':' + lng.toFixed(4) + ',' + lat.toFixed(4) + ':' + to.lat + ',' + to.lng;
  const cached = await retry(() => db.prepare('SELECT body FROM route_cache WHERE key = ? AND expires_ms > ?').bind(key, now).first('body'));
  if (cached) return JSON.parse(cached);

  // pasted keys often carry a stray space, newline or quotes
  const apiKey = String(env.ORS_API_KEY || '').trim().replace(/^["']|["']$/g, '');
  if (!apiKey) return failure('config');
  try {
    await limit(ctx, 'route.minute', 'all', ROUTE_PER_MINUTE, 60);
    await limit(ctx, 'route.day', 'all', ROUTE_PER_DAY, 86400);
  } catch (err) {
    if (err instanceof ApiError && err.code === 'rate') return failure('busy');
    throw err;
  }

  let res;
  try {
    res = await ctx.fetch(ROUTE_ENDPOINT + profile + '/geojson', {
      method: 'POST',
      headers: { authorization: apiKey, 'content-type': 'application/json', accept: 'application/json, application/geo+json' },
      body: JSON.stringify({ coordinates: [[lng, lat], [to.lng, to.lat]], instructions: false, units: 'm' })
    });
  } catch {
    return failure('upstream');
  }
  if (res.status === 401 || res.status === 403) {
    logLine({ lvl: 'warn', kind: 'route', msg: 'openrouteservice refused the key', status: res.status });
    return failure('config');
  }
  if (res.status === 429) return failure('busy');
  const data = await res.json().catch(() => null);
  const store = body => retry(() => db.prepare('INSERT INTO route_cache (key, body, expires_ms) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET body = excluded.body, expires_ms = excluded.expires_ms').bind(key, JSON.stringify(body), now + CACHE_MS).run());
  if (res.status !== 200) {
    // no routable road near the start, or too far for this profile: the start's fault
    const upstream = data && data.error && typeof data.error === 'object' ? Number(data.error.code) : 0;
    if ((res.status === 404 || res.status === 400) && [2004, 2009, 2010].includes(upstream)) {
      const unroutable = failure('invalid');
      await store(unroutable);
      return unroutable;
    }
    return failure('upstream');
  }
  const feature = data && Array.isArray(data.features) ? data.features[0] : null;
  const line = feature && feature.geometry && Array.isArray(feature.geometry.coordinates) ? feature.geometry.coordinates : null;
  const summary = (feature && feature.properties && feature.properties.summary) || {};
  const points = (line || []).filter(p => Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number' && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (points.length < 2) return failure('upstream');
  const result = {
    ok: true, profile,
    distance: Math.max(0, Math.round(Number(summary.distance) || 0)),
    duration: Math.max(0, Math.round(Number(summary.duration) || 0)),
    geometry: simplify(points).map(p => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5])
  };
  await store(result);
  return result;
}

/* POST /v1/public/route: a visitor's own limit first; the answer in `result`, where the page's readRoute looks */
export async function publicRoute(ctx) {
  const body = ctx.body || {};
  const request = body.fn === 'route' && Array.isArray(body.args) ? body.args[0] : body;
  try {
    await limit(ctx, 'route.ip', clientIp(ctx.request), 20, 60);
  } catch (err) {
    if (err instanceof ApiError && err.code === 'rate') return { result: failure('busy') };
    throw err;
  }
  let answer;
  try {
    answer = await routeFor(ctx, request);
  } catch {
    // nothing about the request (or the error) is logged
    answer = failure('upstream');
  }
  return { result: answer };
}

/* housekeeping: answers past their 6 hours */
export const routeSweepStmt = (db, now) => db.prepare('DELETE FROM route_cache WHERE expires_ms < ?').bind(now);
