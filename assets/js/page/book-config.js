/**
 * BOOKING CONFIG (public; docs/EVENTS.md §6, worker/BOOKING-API.md)
 *
 * The booking API is the Cloudflare Worker. Its origin is in the page
 * shell's CSP connect-src (pages/index.html, events/index.html; the stubs
 * are made from the shell).
 *
 * On a developer's machine only (localhost / 127.0.0.1) the address can be
 * pointed elsewhere, for tests, the staging Worker or a mock:
 *   ?api=<url>                                    this page load
 *   localStorage['athanasios.book.api'] = <url>   until removed
 * Anywhere else the override is ignored: the real site always talks to
 * the production Worker.
 */

export const BOOK_API_URL = 'https://athanasios-api.menazak-lab.workers.dev';
export const BOOK_API_STAGING_URL = 'https://athanasios-api-staging.menazak-lab.workers.dev';

const OVERRIDE_KEY = 'athanasios.book.api';
const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

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

/**
 * The API base for this page: the production Worker, or (localhost only)
 * the ?api= / stored override. Pure: location and storage are passed in.
 */
export function resolveApiUrl(loc, storage) {
  if (!loc || !LOCAL_HOSTS.includes(loc.hostname)) return BOOK_API_URL;
  let override = '';
  try {
    override = cleanOverride(new URLSearchParams(loc.search || '').get('api') || '');
  }
  catch {
    override = '';
  }
  if (!override) {
    try {
      override = cleanOverride(storage ? storage.getItem(OVERRIDE_KEY) : '');
    }
    catch {
      override = '';
    }
  }
  return override || BOOK_API_URL;
}

export function bookApiUrl() {
  let storage = null;
  try {
    storage = typeof localStorage === 'undefined' ? null : localStorage;
  }
  catch {
    storage = null;
  }
  return resolveApiUrl(typeof location === 'undefined' ? null : location, storage);
}
