/**
 * WHERE PUBLISHED CONTENT COMES FROM (Phase 2, docs/PUBLISH-SEPARATION-PLAN.md §3, P2-3)
 *
 * CONTENT_SOURCE
 *   'static'  content.json / page.json / event.json / comp.json from GitHub
 *             Pages, as always (the default, and the rollback)
 *   'worker'  the live revision from the Worker (GET /v1/public/…, ETag →
 *             304), with the static file as the fallback: a Worker that is
 *             slow (> 2 s), down, switched off (CONTENT_SERVE=0) or has no
 *             revision yet never stops the page
 *
 * It changes only at the cutover (P2-9, owner approval). On a developer's
 * machine (localhost / 127.0.0.1) a page load can try the other source:
 *   ?content=worker | ?content=static           this page load
 *   localStorage['athanasios.content.source']   until removed
 * and the Worker address follows the booking's override (?api= /
 * localStorage['athanasios.book.api'], same rules as page/book-config.js).
 * Anywhere else the overrides are ignored. Self-contained on purpose: a page
 * without online booking loads no booking module (tests/book-public.e2e.mjs).
 */

export const CONTENT_SOURCE = 'static';
export const WORKER_TIMEOUT_MS = 2000;
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
  const mode = wanted === 'worker' || wanted === 'static' ? wanted : CONTENT_SOURCE;
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

/**
 * fetch() for a published file. In 'worker' mode the first, revalidating
 * load (cache 'no-cache') asks the Worker first; anything but a 200 within
 * WORKER_TIMEOUT_MS falls back to the static file with the same init. Other
 * loads (the offline 'force-cache' retry) go to the static file directly.
 */
export async function fetchPublished(staticUrl, init, { kind, slug = '' }, {
  source = contentSource(), fetchImpl = (...args) => fetch(...args), timeoutMs = WORKER_TIMEOUT_MS
} = {}) {
  const path = workerPath(kind, slug);
  if (source.mode === 'worker' && path && (!init || !init.cache || init.cache === 'no-cache')) {
    const controller = typeof AbortController === 'undefined' ? null : new AbortController();
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchImpl(source.api + path, {
        cache: 'no-cache', credentials: 'omit', mode: 'cors', ...(controller ? { signal: controller.signal } : {})
      });
      if (response.ok) return response;
    }
    catch {
      // slow, down, blocked: the static file below
    }
    finally {
      if (timer) clearTimeout(timer);
    }
  }
  return fetchImpl(staticUrl, init);
}
