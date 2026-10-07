/**
 * THE REAL MAP (lazy: loaded by render.js only when the visitor taps
 * «عرض الخريطة» or «الاتجاهات»; nothing of it is on the first load)
 *
 * Leaflet 1.9.4 (assets/vendor/leaflet, BSD-2-Clause, self-hosted: the CSP
 * allows scripts from this site only) with OpenStreetMap's standard tiles,
 * darkened in CSS (map.css) to sit in the navy page. Per the OSM tile policy:
 * a visible, linked «© OpenStreetMap contributors», tiles over HTTPS with the
 * page's own referrer policy, normal browser caching, nothing prefetched.
 *
 * Routes («الاتجاهات»): the start (the visitor's location, or a point they
 * tap) goes to the Apps Script web app (map-config.js routeUrl, Route.gs),
 * which asks openrouteservice.org (HeiGIT) with a key only it knows. Only the
 * start coordinates travel; nothing is stored (memory only, gone with the map).
 *
 *   mount(slot, location, signal) → { directions() } | null
 *   signal aborted = «اخفي الخريطة»: the map is destroyed (memory freed).
 */

import { h, external } from './dom.js';
import { iconNode } from './icons.js';
import { motionTier } from './feel.js';
import { MAP_CONFIG } from './map-config.js';
import { PROFILES, ROUTE_TEXT, formatDistance, formatDuration, routeBody, readRoute } from './map-route.js';

const ASSETS = new URL('../', import.meta.url);
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_CREDIT = '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>';
const ZOOM = 16;
const SLOW_MS = 6000;
const TIMEOUT_MS = 20000;

/* trusted, static markup */
const parser = document.createElement('template');

function markup(html) {
  parser.innerHTML = html.trim();
  return parser.content.firstElementChild;
}

const icon = paths => markup(`<svg class="icon icon--line" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths}</svg>`);

const ICONS = {
  car: '<path class="duo" d="M5 11.5 6.6 7A2 2 0 0 1 8.5 5.6h7A2 2 0 0 1 17.4 7l1.6 4.5"/><rect x="3.5" y="11.5" width="17" height="6" rx="2"/><path d="M6 17.5v1.5M18 17.5v1.5M7 14.5h1.5M15.5 14.5H17"/>',
  foot: '<circle class="duo" cx="13" cy="4.5" r="2"/><path d="m9.5 21 2.2-6.2L14 17v4M11.7 14.8 12.5 9l-3.2 1.8L8 14M12.5 9l2 3.2 3 1"/>',
  locate: '<circle class="duo" cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>',
  pick: '<path class="duo" d="M12 21s-6-5.4-6-10a6 6 0 0 1 12 0c0 4.6-6 10-6 10Z"/><path d="M12 8v5M9.5 10.5h5"/>',
  church: '<path class="duo" d="M5 21v-8l7-5 7 5v8Z"/><path d="M12 2.5v5M10 4.5h4M10 21v-4.5a2 2 0 0 1 4 0V21"/>'
};

/* the church pin: the drawing's own gold pin with its door and cross */
const PIN = `<svg viewBox="-14 -32 28 35" width="34" height="42" aria-hidden="true" focusable="false">
  <ellipse cx="0" cy="1" rx="6" ry="2" fill="#000" fill-opacity=".45"/>
  <path d="M0 0C-8-8-11-13-11-19a11 11 0 0 1 22 0C11-13 8-8 0 0Z" fill="#d7aa50" stroke="#061a31" stroke-width="1"/>
  <g fill="none" stroke="#061a31" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M-4.6-14.2v-3.8a4.6 4.6 0 0 1 9.2 0v3.8Z"/><path d="M0-26.4v3.6M-1.7-24.8h3.4"/>
  </g></svg>`;


/* ---------- loading (once per page) ---------- */

let stylesReady = null;
let leafletReady = null;

function attach(tag, attrs) {
  return new Promise((resolve, reject) => {
    const el = h(tag, { ...attrs, onload: resolve, onerror: () => { el.remove(); reject(new Error(`${tag} failed`)); } });
    document.head.append(el);
  });
}

function styles() {
  stylesReady ||= Promise.all([
    attach('link', { rel: 'stylesheet', href: new URL('vendor/leaflet/leaflet.css', ASSETS).href }),
    attach('link', { rel: 'stylesheet', href: new URL('css/map.css', ASSETS).href })
  ]).catch(error => { stylesReady = null; throw error; });
  return stylesReady;
}

function leaflet() {
  leafletReady ||= Promise.all([styles(), globalThis.L ? null : attach('script', { src: new URL('vendor/leaflet/leaflet.js', ASSETS).href })])
    .then(() => globalThis.L)
    .catch(error => { leafletReady = null; throw error; });
  return leafletReady;
}


/* ---------- mount ---------- */

export async function mount(slot, location, signal) {

  // a phone: the opened map may start above the screen
  if (slot.getBoundingClientRect().top < 64) slot.scrollIntoView({ block: 'nearest', behavior: motionTier() === 'reduced' ? 'auto' : 'smooth' });

  // no coordinates: Google's keyless embed, as before (search by name)
  if (location.lat === null) {
    await styles().catch(() => {});
    if (signal.aborted) return null;
    slot.replaceChildren(h('iframe', {
      class: 'location__live',
      src: `https://www.google.com/maps?q=${encodeURIComponent(location.name)}&z=${ZOOM}&hl=ar&output=embed`,
      title: `خريطة: ${location.name}`,
      loading: 'lazy',
      referrerpolicy: 'strict-origin-when-cross-origin',
      allowfullscreen: true
    }));
    return null;
  }

  let L;
  try {
    L = await leaflet();
  }
  catch {
    if (!signal.aborted) slot.append(h('p', { class: 'location__fail', role: 'status' }, 'الخريطة محتاجة إنترنت. جرّب تاني بعد شوية.'));
    // «الاتجاهات» still works: Google Maps in a new tab
    return { directions: () => location.directionsUrl && open(location.directionsUrl, '_blank', 'noopener') };
  }

  return signal.aborted ? null : liveMap(L, slot, location, signal);

}


function liveMap(L, slot, location, signal) {

  const reduced = motionTier() === 'reduced';
  const church = L.latLng(location.lat, location.lng);
  const card = slot.closest('.location');

  const el = h('div', {
    class: 'location__live',
    dir: 'ltr',
    role: 'region',
    'aria-label': `خريطة ${location.name}: اسحبها أو استخدم الأسهم للتحريك، و+ و− للتكبير والتصغير`
  });
  slot.replaceChildren(el);

  const map = L.map(el, {
    center: church,
    zoom: ZOOM,
    minZoom: 6,
    maxZoom: 19,
    zoomControl: false,
    attributionControl: false,
    scrollWheelZoom: false,          // the page scrolls past it until the map is clicked or focused
    keyboard: true,
    zoomAnimation: !reduced,
    fadeAnimation: !reduced,
    markerZoomAnimation: !reduced,
    inertia: !reduced
  });

  L.control.zoom({ position: 'topleft', zoomInTitle: 'تكبير', zoomOutTitle: 'تصغير' }).addTo(map);
  L.control.attribution({ position: 'bottomright', prefix: '<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>' }).addTo(map);
  L.tileLayer(TILES, { maxZoom: 19, attribution: OSM_CREDIT, className: 'map-tiles' }).addTo(map);

  const marker = L.marker(church, {
    icon: L.divIcon({ className: 'map-pin', html: PIN, iconSize: [34, 42], iconAnchor: [17, 38], popupAnchor: [0, -36] }),
    title: location.name,
    keyboard: true,
    zIndexOffset: 1000
  }).addTo(map);

  marker.bindPopup(h('div', { class: 'map-popup', dir: 'rtl' },
    h('strong', {}, location.name),
    location.address ? h('span', {}, location.address) : null
  ), { maxWidth: 240, autoPanPadding: [12, 12] });

  map.on('popupopen', event => {
    const close = event.popup.getElement()?.querySelector('.leaflet-popup-close-button');
    close?.setAttribute('aria-label', 'اقفل');
    close?.setAttribute('title', 'اقفل');
  });

  const Recenter = L.Control.extend({
    onAdd() {
      const button = h('button', { type: 'button', class: 'map-recenter', title: 'رجّع للكنيسة', onclick: () => map.setView(church, ZOOM, { animate: !reduced }) },
        icon(ICONS.church),
        h('span', {}, 'رجّع للكنيسة')
      );
      L.DomEvent.disableClickPropagation(button);
      return button;
    }
  });
  new Recenter({ position: 'topright' }).addTo(map);

  // the wheel zooms only once the visitor is "in" the map (a click or keyboard focus)
  const wheel = on => (on ? map.scrollWheelZoom.enable() : map.scrollWheelZoom.disable());
  el.addEventListener('pointerdown', () => wheel(true));
  el.addEventListener('focusin', () => wheel(true));
  el.addEventListener('focusout', event => { if (!el.contains(event.relatedTarget)) wheel(false); });


  /* ---------- directions ---------- */

  let gone = false;
  let panel = null;
  let status;
  let hint;
  let credit;
  let outside;
  let pickButton;
  let modeButtons = [];
  let mode = 'car';
  let start = null;
  let startMarker = null;
  let routeLayer = null;
  let request = null;
  let picking = false;
  let locating = 0;
  const routes = new Map();     // mode → answer, for the current start

  const directionsHref = location.directionsUrl || `https://www.google.com/maps/dir/?api=1&destination=${location.lat}%2C${location.lng}`;

  function say(content, problem = false, result = false) {
    status.replaceChildren(...[].concat(content));
    panel.classList.toggle('is-problem', problem);
    status.classList.toggle('is-result', result);
    if (!result) credit.hidden = true;
  }

  // the map at the top of the screen, its panel right under it
  function reveal() {
    slot.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
  }

  function setPicking(on, announce = true) {
    picking = on;
    pickButton.setAttribute('aria-pressed', String(on));
    el.classList.toggle('is-picking', on);
    if (on && announce) say(ROUTE_TEXT.pick);
    // choosing needs the map in sight
    if (on && slot.getBoundingClientRect().top < 0) reveal();
  }

  function setMode(next) {
    mode = next;
    for (const button of modeButtons) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    if (start) route();
  }

  function locate() {
    setPicking(false, false);
    if (!navigator.geolocation) {
      say(ROUTE_TEXT.unavailable, true);
      setPicking(true, false);
      return;
    }
    const ticket = ++locating;
    say(ROUTE_TEXT.locating);
    navigator.geolocation.getCurrentPosition(
      position => {
        if (gone || ticket !== locating) return;
        setStart(L.latLng(position.coords.latitude, position.coords.longitude));
      },
      error => {
        if (gone || ticket !== locating) return;
        say(ROUTE_TEXT[error && error.code === 1 ? 'denied' : 'unavailable'], true);
        setPicking(true, false);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  }

  function setStart(latlng) {
    locating++;
    start = latlng;
    routes.clear();
    hint.hidden = true;
    if (startMarker) startMarker.setLatLng(latlng);
    else {
      startMarker = L.marker(latlng, {
        icon: L.divIcon({ className: 'map-start', html: '<span></span>', iconSize: [22, 22], iconAnchor: [11, 11] }),
        title: 'نقطة البداية (اسحبها لو عايز تغيّرها)',
        draggable: true,
        keyboard: true,
        autoPan: true
      }).addTo(map);
      startMarker.on('dragend', () => setStart(startMarker.getLatLng()));
    }
    route();
  }

  async function route() {

    const wanted = mode;

    if (routes.has(wanted)) {
      request?.abort();
      request = null;
      show(routes.get(wanted));
      return;
    }

    request?.abort();
    const controller = new AbortController();
    request = controller;
    let timedOut = false;
    say(ROUTE_TEXT.routing);
    const slow = setTimeout(() => { if (request === controller) say(ROUTE_TEXT.slow); }, SLOW_MS);
    const limit = setTimeout(() => { timedOut = true; controller.abort(); }, TIMEOUT_MS);

    let answer;
    try {
      const response = await fetch(MAP_CONFIG.routeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: routeBody(PROFILES[wanted], start),
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal
      });
      answer = response.ok ? readRoute(await response.json()) : { ok: false, code: response.status === 429 ? 'busy' : 'upstream' };
    }
    catch {
      if (gone || (controller.signal.aborted && !timedOut)) return;   // replaced by a newer request
      answer = { ok: false, code: navigator.onLine === false ? 'offline' : 'upstream' };
    }
    finally {
      clearTimeout(slow);
      clearTimeout(limit);
    }

    if (gone || request !== controller) return;
    request = null;
    if (answer.ok || answer.code === 'invalid') routes.set(wanted, answer);
    show(answer);

  }

  function show(answer) {

    routeLayer?.remove();
    routeLayer = null;

    if (!answer.ok) {
      say(ROUTE_TEXT[answer.code] || ROUTE_TEXT.upstream, true);
      return;
    }

    routeLayer = L.layerGroup([
      L.polyline(answer.line, { className: 'route-glow', weight: 12, interactive: false }),
      L.polyline(answer.line, { className: 'route-line', weight: 5, interactive: false })
    ]).addTo(map);

    map.fitBounds(L.latLngBounds(answer.line).extend(church).extend(start), { padding: [32, 32], maxZoom: 17, animate: !reduced });
    if (slot.getBoundingClientRect().top < 0) reveal();

    say([
      h('strong', {}, formatDistance(answer.distance)),
      h('span', { 'aria-hidden': 'true' }, ' · '),
      h('span', {}, `حوالي ${formatDuration(answer.duration)} ${mode === 'car' ? 'بالعربية' : 'مشي'}`)
    ], false, true);
    credit.hidden = false;

  }

  function buildPanel() {

    const modeButton = (key, label) => h('button', {
      type: 'button',
      class: 'route__mode',
      'aria-pressed': String(key === mode),
      dataset: { mode: key },
      onclick: () => setMode(key)
    }, icon(ICONS[key]), label);

    modeButtons = [modeButton('car', 'بالعربية'), modeButton('foot', 'مشي')];
    pickButton = h('button', { type: 'button', class: 'btn route__pick', 'aria-pressed': 'false', onclick: () => setPicking(!picking) }, icon(ICONS.pick), 'اختار نقطة البداية');
    status = h('p', { class: 'route__status', role: 'status' });
    credit = h('p', { class: 'route__credit', dir: 'ltr', hidden: true },
      'Routing © ', h('a', external('https://openrouteservice.org/'), 'openrouteservice.org'), ' by HeiGIT · ',
      h('a', external('https://www.openstreetmap.org/copyright'), '© OpenStreetMap contributors')
    );
    outside = h('a', { class: 'btn route__outside', ...external(directionsHref) }, iconNode('directions'), 'افتح الاتجاهات في خرائط جوجل');

    return h('section', { class: 'route', 'aria-label': 'الاتجاهات للكنيسة' },
      h('div', { class: 'route__modes', role: 'group', 'aria-label': 'هتيجي إزاي؟' }, modeButtons),
      hint = h('p', { class: 'route__hint' }, 'علشان نرسم الطريق محتاجين نقطة بدايتك. «من موقعي» بيسأل المتصفح عن موقعك مرة واحدة؛ بيتبعت لحساب الطريق بس، ومش بيتحفظ.'),
      h('div', { class: 'route__start' },
        h('button', { type: 'button', class: 'btn btn--primary route__locate', onclick: locate }, icon(ICONS.locate), 'من موقعي'),
        pickButton
      ),
      status,
      credit,
      outside
    );

  }

  // tap to choose the start; from the keyboard, Enter picks the map's centre
  map.on('click', event => {
    if (!picking) return;
    setPicking(false, false);
    setStart(event.latlng);
  });

  el.addEventListener('keydown', event => {
    if (!picking || event.target !== el || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    setPicking(false, false);
    setStart(map.getCenter());
  });

  signal.addEventListener('abort', () => {
    gone = true;
    request?.abort();
    panel?.remove();
    slot.classList.remove('is-routing');
    // (Leaflet 1.9: a zoom animation's 250 ms timer would touch the removed panes)
    map._animatingZoom = false;
    map.remove();
  }, { once: true });

  return {

    /* «الاتجاهات»: the panel right under the map (once), the map a bit taller */
    directions() {
      if (gone) return;
      if (!panel) {
        panel = buildPanel();
        slot.after(panel);
        slot.classList.add('is-routing');
        map.invalidateSize({ pan: false });
      }
      if (slot.getBoundingClientRect().top < 64 || panel.getBoundingClientRect().bottom > innerHeight) reveal();
      panel.querySelector('.route__locate').focus({ preventScroll: true });
    }

  };

}
