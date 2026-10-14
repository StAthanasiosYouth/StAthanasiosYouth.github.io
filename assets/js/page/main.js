/**
 * SERVICE PAGES AND EVENTS — boot (pages/index.html, events/index.html and
 * the generated stubs; docs/EVENTS.md §17.3)
 *
 * What the page is comes from <html data-kind>:
 *   page    /<slug>/            → ./page.json?v=<data-v>   (stub, same depth as the shell)
 *   event   /events/<slug>/     → ./event.json?v=<data-v>  (stub, one level deeper)
 *   events  /events/            → content.json events[]    (the list)
 *   (none)  /pages/             → ?preview: the admin's preview frame; else the home page
 * URLs of the site are built from this module's own address (import.meta.url),
 * never from the page's; the JSON sits next to the page (relative to it).
 *
 *  ?preview  the draft arrives by postMessage from the same-origin parent;
 *            no network, no storage, no history (protocol: §17.10)
 */

import { sanitizePage, sanitizeEvent, sanitizeEntry, bookingPhase, eventsList } from './model.js';
import { createView } from './view.js';
import { createVideoSheet } from './video.js';
import { zonedNow, stamp, setServerTime } from '../schedule.js';
import { soundToggle, uiSounds } from '../ui-sound.js';

const ROOT = new URL('../../../', import.meta.url);
const html = document.documentElement;
const KIND = ['page', 'event', 'events'].includes(html.dataset.kind) ? html.dataset.kind : '';
const PREVIEW = !KIND && new URLSearchParams(location.search).has('preview');
const FRAMED = window.parent !== window;
const SITE = 'أسرة البابا أثناسيوس';

/* the mount points (a stub made from an older shell may lack them) */
function mount(id, make) {
  let el = document.getElementById(id);
  if (!el) {
    el = make();
    el.id = id;
    document.body.appendChild(el);
  }
  return el;
}

const main = mount('page-main', () => Object.assign(document.createElement('main'), { className: 'pg', tabIndex: -1 }));
const live = mount('page-live', () => Object.assign(document.createElement('p'), { className: 'visually-hidden' }));
live.setAttribute('aria-live', 'polite');

/* the admin preview's not-yet-published pictures (blob: URLs of this origin only) */
let previewImages = {};

function mediaUrl(src) {
  const swapped = previewImages[src];
  if (typeof swapped === 'string' && swapped.startsWith(`blob:${location.origin}/`)) return swapped;
  return new URL(src, ROOT).href;
}

const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const reduced = () => !!(reducedQuery && reducedQuery.matches);

const nowStamp = () => stamp(zonedNow('Africa/Cairo'));

const view = createView({ main, live, rootUrl: ROOT, mediaUrl, onClip: (list, at, from) => sheet.open(list, at, from) });

const sheet = createVideoSheet({ mediaUrl, announce: message => view.announce(message), history: !PREVIEW });

const UNAVAILABLE = { page: 'الصفحة دي مش متاحة دلوقتي', event: 'الفعالية دي مش متاحة دلوقتي' };


/* =========================================================
   RENDER
========================================================= */

let shown = null;       // { kind, data } on screen
let phaseKey = '';      // the event's booking phase / the list's state (re-render when it changes)
let listPartners = {};  // the list's partners (content.json partners: the cards' «بإشراف» chips)

function render(kind, data) {

  shown = { kind, data };

  if (!data || data.withdrawn) {
    view.unavailable(UNAVAILABLE[kind] || UNAVAILABLE.page);
    phaseKey = '';
    return;
  }

  if (data.theme) html.dataset.theme = data.theme;
  else delete html.dataset.theme;

  if (kind === 'page') {
    view.page(data, { reduced: reduced() });
    sheet.attach(data.media, { title: data.title });
    // the clip sheet's living stage, ready before the first tap
    if (data.media.some(card => card.source === 'clip' && card.clip)) {
      (window.requestIdleCallback || (fn => setTimeout(fn, 1200)))(() => sheet.prepare());
    }
    phaseKey = '';
  }
  else if (kind === 'event') {
    phaseKey = view.event(data, nowStamp(), { reduced: reduced() }).phase;
  }
  else {
    const list = eventsList(data, nowStamp());
    view.events(list, nowStamp(), listPartners);
    phaseKey = listKey(data);
  }

  if (!PREVIEW && kind !== 'events') document.title = `${data.title} – ${SITE}`;

}

const listKey = events => eventsList(events, nowStamp()).map(e => `${e.slug}:${bookingPhase(e.booking, e.startAt, nowStamp())}:${nowStamp() > (e.endAt || e.startAt)}`).join(',');

/* once a minute: a booking window that opens / closes, an event that ends */
function tick() {
  if (!shown || !shown.data || shown.data.withdrawn) return;
  if (shown.kind === 'event' && shown.data.booking && bookingPhase(shown.data.booking, shown.data.startAt, nowStamp()) !== phaseKey) render('event', shown.data);
  if (shown.kind === 'events' && listKey(shown.data) !== phaseKey) render('events', shown.data);
}


/* =========================================================
   LIVE
========================================================= */

/* the page's JSON, next to the page; GitHub Pages' clock corrects a wrong device clock */
async function fetchJson(url) {

  for (const cache of ['no-cache', 'force-cache']) {
    try {
      const response = await fetch(url, { cache, credentials: 'same-origin' });
      if (response.status === 404) return { missing: true };
      if (!response.ok) continue;
      if (cache === 'no-cache') setServerTime(response.headers.get('Date'));
      return { raw: await response.json() };
    }
    catch {
      // offline: the browser's copy next
    }
  }

  return { failed: true };

}

async function boot() {

  view.loading();

  if (KIND === 'events') {
    const loaded = await fetchJson(new URL('content.json', ROOT));
    if (loaded.raw) {
      try {
        // the home page's own sanitizer (loaded only here)
        const { sanitizeContent } = await import('../content.js');
        const content = sanitizeContent(loaded.raw);
        listPartners = content.partners || {};
        render('events', content.events);
        return;
      }
      catch {
        // a broken file: below
      }
    }
    view.error('مش قادرين نحمّل الفعاليات. اتأكد من النت وجرّب تاني.', boot);
    return;
  }

  const v = html.dataset.v || '';
  const file = KIND === 'page' ? 'page.json' : 'event.json';
  const loaded = await fetchJson(new URL(`${file}${v ? `?v=${encodeURIComponent(v)}` : ''}`, location.href));

  if (loaded.failed) {
    view.error('مش قادرين نحمّل الصفحة. اتأكد من النت وجرّب تاني.', boot);
    return;
  }

  const data = loaded.raw ? (KIND === 'page' ? sanitizePage : sanitizeEvent)(loaded.raw) : null;
  const slug = html.dataset.slug || '';

  // missing, broken, or another page's file: unavailable
  render(KIND, data && (data.withdrawn || !slug || data.slug === slug) ? data : null);

}


/* =========================================================
   PREVIEW (admin): docs/EVENTS.md §17.10
========================================================= */

function startPreview() {

  html.dataset.preview = '';
  const reply = message => window.parent.postMessage(message, location.origin);

  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== location.origin) return;
    const msg = event.data;
    if (!msg || msg.type !== 'athanasios:page-preview') return;

    const kind = msg.kind === 'event' ? 'event' : msg.kind === 'page' ? 'page' : '';
    const data = kind ? sanitizeEntry(kind, msg.data) : null;
    if (!data) {
      reply({ type: 'athanasios:page-preview-error', message: 'data' });
      return;
    }

    sheet.hide({ fromHistory: true });
    previewImages = msg.images && typeof msg.images === 'object' ? { ...msg.images } : {};
    render(kind, data);
    reply({ type: 'athanasios:page-preview-shown' });
  });

  view.loading();
  reply({ type: 'athanasios:page-preview-ready' });

}


/* =========================================================
   START
========================================================= */

let sameOriginParent = false;
try {
  sameOriginParent = FRAMED && window.parent.location.origin === location.origin;
}
catch {
  sameOriginParent = false;
}

if (PREVIEW && sameOriginParent) {
  startPreview();
}
else if (PREVIEW) {
  view.error('المعاينة بتشتغل من لوحة التحكم بس.');
}
else if (!KIND) {
  // the bare shell (/pages/) is not a page of its own
  location.replace(ROOT.href);
}
else {
  // never shown inside another site (clickjacking; GitHub Pages can't send frame headers)
  if (FRAMED) {
    try {
      window.top.location.replace(location.href);
    }
    catch {
      // sandboxed frame: nothing more we can do
    }
  }
  // the site's sound: the same toggle and taps as the home page
  soundToggle(document.querySelector('.pbar'));
  uiSounds();
  boot();
  setInterval(tick, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
}
