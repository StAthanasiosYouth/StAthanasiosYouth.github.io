/*
 * «خبزنا اليومي» — talking to the published files and the Worker (progress/W3.md «قرار: إزاي المحتوى بيوصل للمخدوم»).
 *
 *   The index and the day: the static file on GitHub Pages (daily-bread/data/…) and the Worker's copy
 *   (/v1/bread/file/…) are asked together. The Worker also says whether the section is open: while BREAD_MODULE ≠ 1
 *   it answers `disabled`, and the page / the home card / the menu stay hidden. When the Worker cannot be reached,
 *   the static file is used only if this device already saw the section open (offline / a slow morning).
 *   The open beacon: fetch keepalive, text/plain (no preflight), once per device a day (the Worker counts it once).
 * The Worker's address: the production Worker; on localhost only, ?api= / the stored override (page/book-config.js).
 */
import { bookApiUrl } from '../page/book-config.js';
import { readSession } from '../account/link.js';
import { cleanTopic } from './model.js';
import { cleanOccasions } from './occasions.js';

const ROOT = new URL('../../../', import.meta.url);
export const ON_KEY = 'bread.on';
const WORKER_WAIT_MS = 3200;   // the intro covers this; after it, a known-open device takes the static file
const WORKER_MAX_MS = 12000;

const store = name => { try { return globalThis[name] || null; } catch { return null; } };
const get = (name, key) => { try { return store(name)?.getItem(key) ?? null; } catch { return null; } };
const set = (name, key, value) => { try { if (value == null) store(name)?.removeItem(key); else store(name)?.setItem(key, value); } catch { /* the page still works */ } };

export const api = () => bookApiUrl();
export const session = () => readSession(store('localStorage'), store('sessionStorage'));

function withTimeout(promise, ms) {
  let t;
  return Promise.race([promise, new Promise((_, no) => { t = setTimeout(() => no(new Error('timeout')), ms); })]).finally(() => clearTimeout(t));
}

/* GET a JSON file → { status, body } (body null when it is not JSON) */
async function getJson(url, ms) {
  const res = await withTimeout(fetch(url, { cache: 'no-cache', credentials: 'omit' }), ms);
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

/*
 * → { state: 'on' | 'off' | 'unknown', index }
 *   on: the Worker answered (or this device knew it open and the Worker is slow/unreachable)
 *   off: the Worker says `disabled` (the section is not open yet)
 *   unknown: no Worker, and this device never saw it open
 */
export async function loadIndex() {
  const statics = getJson(new URL('daily-bread/data/index.json', ROOT).href, WORKER_MAX_MS).then(r => (r.status === 200 && r.body ? r.body : null), () => null);
  const worker = getJson(api() + '/v1/bread/file/index', WORKER_MAX_MS).then(r => {
    if (r.status === 200 && r.body && Array.isArray(r.body.programs)) return { state: 'on', index: r.body };
    if (r.body && r.body.code === 'disabled') return { state: 'off', index: null };
    if (r.status === 404 && r.body && r.body.code === 'not_found') return { state: 'on', index: { programs: [] } };
    return null;
  }, () => null);
  const known = get('localStorage', ON_KEY) === '1';
  const early = await Promise.race([worker, new Promise(r => setTimeout(() => r(undefined), WORKER_WAIT_MS))]);
  let out = early;
  if (out === undefined && known) {
    const s = await statics;
    out = s ? { state: 'on', index: s, from: 'static' } : await worker;
  }
  else if (out === undefined) out = await worker;
  if (!out) {
    const s = known ? await statics : null;
    out = s ? { state: 'on', index: s, from: 'static' } : { state: 'unknown', index: null };
  }
  if (out.state === 'on') set('localStorage', ON_KEY, '1');
  if (out.state === 'off') set('localStorage', ON_KEY, null);
  return out;
}

/*
 * P5 «مناسبات كنيستنا» → the clean file | null. Its own switch (BREAD_OCCASIONS): the Worker says `disabled` → null
 * (no card, no «كنيستنا» tab). The static copy only when the Worker is unreachable and this device saw it on.
 */
export const OCC_KEY = 'bread.occ.on';
export async function loadOccasions() {
  const worker = getJson(api() + '/v1/bread/file/occasions', WORKER_MAX_MS).then(r => {
    if (r.status === 200 && r.body) return { on: true, file: r.body };
    if (r.body && (r.body.code === 'disabled' || r.body.code === 'not_found')) return { on: false };
    return null;
  }, () => null);
  let out = await worker;
  if (!out && get('localStorage', OCC_KEY) === '1') {
    const st = await getJson(new URL('daily-bread/data/occasions.json', ROOT).href, WORKER_MAX_MS).catch(() => null);
    if (st && st.status === 200 && st.body) out = { on: true, file: st.body };
  }
  if (out && out.on) set('localStorage', OCC_KEY, '1');
  if (out && !out.on) set('localStorage', OCC_KEY, null);
  return out && out.on ? cleanOccasions(out.file) : null;
}

/* the day's file: static and Worker together, the first good one wins → topic | null */
export async function loadDay(programId, n) {
  const key = programId + '/' + n;
  const tries = [
    getJson(new URL(`daily-bread/data/${key}.json`, ROOT).href, WORKER_MAX_MS),
    getJson(`${api()}/v1/bread/file/${key}`, WORKER_MAX_MS)
  ].map(p => p.then(r => (r.status === 200 ? cleanTopic(r.body, programId, n) : null), () => null).then(t => t || Promise.reject(new Error('no'))));
  try {
    return await Promise.any(tries);
  }
  catch {
    return null;
  }
}

/* W7: the month's feasts file (static and Worker together) → the file | null. Missing = no feasts that month. */
export async function loadFeasts(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  const key = 'feasts/' + month;
  const tries = [
    getJson(new URL(`daily-bread/data/${key}.json`, ROOT).href, WORKER_MAX_MS),
    getJson(`${api()}/v1/bread/file/${key}`, WORKER_MAX_MS)
  ].map(p => p.then(r => (r.status === 200 && r.body && Array.isArray(r.body.feasts) ? r.body : null), () => null).then(t => t || Promise.reject(new Error('no'))));
  try {
    return await Promise.any(tries);
  }
  catch {
    return null;
  }
}

/* POST to the Worker → { ok, status, body } (never throws) */
export async function post(path, body, { token = '', plain = false, keepalive = false } = {}) {
  try {
    const headers = plain ? { 'content-type': 'text/plain;charset=UTF-8' } : { 'content-type': 'application/json' };
    if (token) headers.authorization = 'Bearer ' + token;
    const res = await withTimeout(fetch(api() + path, { method: 'POST', headers, body: JSON.stringify(body), credentials: 'omit', cache: 'no-store', keepalive }), 15000);
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    return { ok: res.ok && !!json && json.ok !== false, status: res.status, body: json || {} };
  }
  catch {
    return { ok: false, status: 0, body: { code: 'network' } };
  }
}

/* the open / «قريت» beacon: once per device, day and kind on this device too */
export function beacon(seed, kind, day) {
  const key = 'bread.sent.' + kind;
  if (get('localStorage', key) === day) return;
  set('localStorage', key, day);
  post('/v1/bread/open', { seed, kind }, { plain: true, keepalive: true });
}

export const me = (token, seed) => post('/v1/bread/me', { seed }, { token });
export const reflect = (token, seed, text) => post('/v1/bread/reflection', { seed, text }, { token });
export const reflectEdit = (token, id, text) => post('/v1/bread/reflection/edit', { id, text }, { token });
export const reflectDelete = (token, id) => post('/v1/bread/reflection/delete', { id }, { token });
export const saveLook = (token, look) => post('/v1/account/prefs', { prefs: { bread_look: look } }, { token });
