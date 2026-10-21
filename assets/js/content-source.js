/**
 * WHERE PUBLISHED CONTENT COMES FROM (Phase 2, docs/PUBLISH-SEPARATION-PLAN.md §3, P2-3)
 *
 * CONTENT_SOURCE
 *   'static'  content.json / page.json / event.json / comp.json from GitHub
 *             Pages, as always (the default, and the rollback)
 *   'worker'  the live revision from the Worker (GET /v1/public/…), asked
 *             together with the static file: the page opens as fast as
 *             today and takes the Worker's newer file when it comes
 *             (fetchPublished). A Worker that is slow, down, switched off
 *             (CONTENT_SERVE=0) or has no revision yet never stops the page
 *
 * It changes only at the cutover (P2-9, owner approval). On a developer's
 * machine (localhost / 127.0.0.1) the default is always 'static' (the repo's
 * own files: local previews and tests never read the live Worker), and a
 * page load can try the Worker:
 *   ?content=worker | ?content=static           this page load
 *   localStorage['athanasios.content.source']   until removed
 * and the Worker address follows the booking's override (?api= /
 * localStorage['athanasios.book.api'], same rules as page/book-config.js).
 * Anywhere else the overrides are ignored. Self-contained on purpose: a page
 * without online booking loads no booking module (tests/book-public.e2e.mjs).
 */

export const CONTENT_SOURCE = 'worker';
export const WORKER_TIMEOUT_MS = 8000;   // how long the Worker's answer is still taken
export const WORKER_GRACE_MS = 300;      // the static file arrived: the Worker's answer is still taken this long
export const CONTENT_API_URL = 'https://athanasios-api.menazak-lab.workers.dev';

const SOURCE_KEY = 'athanasios.content.source';
const API_KEY = 'athanasios.book.api';
const LOCAL_HOSTS = ['localhost', '127.0.0.1'];
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])$/;

/* an override is an https:// address, or http:// on this machine; no path tricks, no credentials */
function cleanOverride(value) {
  if (typeof value !== 'string' || !value || value.length > 300) return '';
  try {
    const url = new URL(value);
    const local = LOCAL_HOSTS.includes(url.hostname);
    if (url.username || url.password || url.search || url.hash) return '';
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return '';
    return url.href.replace(/\/+$/, '');
  }
  catch {
    return '';
  }
}

/* localhost only: ?api= first, then the stored key; else the production Worker */
function apiFor(loc, storage) {
  let override = '';
  try { override = cleanOverride(new URLSearchParams(loc.search || '').get('api') || ''); } catch { override = ''; }
  if (!override) {
    try { override = cleanOverride(storage ? storage.getItem(API_KEY) : ''); } catch { override = ''; }
  }
  return override || CONTENT_API_URL;
}

/** { mode: 'static' | 'worker', api } for this page. Pure: location and storage are passed in. */
export function resolveContentSource(loc, storage) {
  if (!loc || !LOCAL_HOSTS.includes(loc.hostname)) return { mode: CONTENT_SOURCE, api: CONTENT_API_URL };
  let wanted = '';
  try { wanted = new URLSearchParams(loc.search || '').get('content') || ''; } catch { wanted = ''; }
  if (!wanted) {
    try { wanted = storage ? storage.getItem(SOURCE_KEY) || '' : ''; } catch { wanted = ''; }
  }
  const mode = wanted === 'worker' ? 'worker' : 'static';
  return { mode, api: apiFor(loc, storage) };
}

export function contentSource() {
  let storage = null;
  try { storage = typeof localStorage === 'undefined' ? null : localStorage; } catch { storage = null; }
  return resolveContentSource(typeof location === 'undefined' ? null : location, storage);
}

/** the Worker route of a published file: kind 'content' | 'page' | 'event' | 'comp'; '' when the slug is not one */
export function workerPath(kind, slug = '') {
  if (kind === 'content') return '/v1/public/content';
  if (!['page', 'event', 'comp'].includes(kind) || !SLUG.test(slug) || /--/.test(slug)) return '';
  return `/v1/public/${kind}/${slug}`;
}

/* the Worker's file as text, or null (not a 200 within timeoutMs, down, blocked); never rejects */
async function askWorker(url, fetchImpl, timeoutMs) {
  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  let timer = null;
  const late = new Promise(resolve => {
    timer = setTimeout(() => {
      if (controller) controller.abort();
      resolve(null);
    }, timeoutMs);
  });
  const answer = (async () => {
    const response = await fetchImpl(url, {
      cache: 'no-cache', credentials: 'omit', mode: 'cors', ...(controller ? { signal: controller.signal } : {})
    });
    if (!response.ok) return null;
    const text = await response.text();
    return { text, response: () => new Response(text, { status: 200, headers: response.headers }) };
  })().catch(() => null);
  try {
    return await Promise.race([answer, late]);
  }
  finally {
    clearTimeout(timer);
  }
}

/**
 * fetch() for a published file. In 'worker' mode the first, revalidating
 * load (cache 'no-cache') asks the Worker and the static file AT ONCE, so a
 * slow network to the Worker never slows the page:
 *   - the static file answers: it is used, unless the Worker answers within
 *     WORKER_GRACE_MS too; a Worker that answers later with a different file
 *     goes to onNewer(response) (the loader redraws when that is safe);
 *   - the static file is missing or fails (a page published a minute ago,
 *     GitHub not mirrored yet): the Worker's file, waited for up to
 *     WORKER_TIMEOUT_MS; else the static answer as it was.
 * Other loads (the offline 'force-cache' retry) go to the static file only.
 */
export async function fetchPublished(staticUrl, init, { kind, slug = '', onNewer = null }, {
  source = contentSource(), fetchImpl = (...args) => fetch(...args), timeoutMs = WORKER_TIMEOUT_MS, graceMs = WORKER_GRACE_MS
} = {}) {
  const path = workerPath(kind, slug);
  if (source.mode !== 'worker' || !path || (init && init.cache && init.cache !== 'no-cache')) return fetchImpl(staticUrl, init);

  const worker = askWorker(source.api + path, fetchImpl, timeoutMs);
  let response = null;
  let failure = null;
  try {
    response = await fetchImpl(staticUrl, init);
  }
  catch (error) {
    failure = error;
  }

  if (!response || !response.ok) {
    const live = await worker;
    if (live) return live.response();
    if (failure) throw failure;
    return response;
  }

  const quick = await Promise.race([worker, new Promise(resolve => setTimeout(() => resolve(undefined), graceMs))]);
  if (quick) return quick.response();
  if (quick === undefined && typeof onNewer === 'function') {
    const shown = response.clone().text().catch(() => null);
    Promise.all([worker, shown]).then(([live, text]) => {
      if (live && text !== null && live.text !== text) onNewer(live.response());
    }).catch(() => {});
  }
  return response;
}
