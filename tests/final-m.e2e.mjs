// Final pass M (the map card), in headless Chrome. No real network: the
// OpenStreetMap tiles are a local PNG, the route web app (Apps Script) is a
// fake that answers by request interception.
//   - lazy: nothing of the map on the first load; Leaflet, map.js, map.css
//     and tiles only after «عرض الخريطة»; tiles over HTTPS with a Referer
//   - the map: drag pans, the wheel zooms only once the map is clicked or
//     focused (the page scrolls past it before), +/− buttons, keyboard
//     (arrows, +), the gold church pin and its popup, «رجّع للكنيسة», the
//     linked OSM attribution (never filtered), one-finger pan and pinch on a
//     phone; «اخفي الخريطة» destroys it and brings the drawing back
//   - «الاتجاهات»: location granted → the start goes to the web app (only
//     the start, rounded), the route is drawn, distance and time in Arabic,
//     the credit; the other mode asks again, the first comes from memory;
//     location denied → tap (or Enter) to choose the start; no routeUrl →
//     Google Maps as before; busy / config / invalid / HTTP errors / offline
//     → a clear message and the Google Maps button; a slow answer says so
//   - no sideways scroll at 320–1920 with the map and the panel open;
//     buttons ≥ 44px; reduced motion = no map animation; axe passes
//
// Run: cd tools && node --test --test-concurrency=1 ../tests/final-m.e2e.mjs

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');
const sharp = require('sharp');
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const PORT = 4880;
const ORIGIN = `http://localhost:${PORT}`;

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find(existsSync);

const phone = width => ({ width, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const PHONE = phone(390);
const DESKTOP = { width: 1366, height: 900, deviceScaleFactor: 1 };

const PUBLISHED = JSON.parse(readFileSync(`${ROOT}content.json`, 'utf8'));
const CHURCH = { lat: PUBLISHED.location.lat, lng: PUBLISHED.location.lng };
const HERE = { latitude: 26.74051234, longitude: 33.93029876 };
const ROUTE_URL = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;

const MAP_FILES = /vendor\/leaflet|\/assets\/js\/map(-config|-route)?\.js|\/assets\/css\/map\.css|tile\.openstreetmap\.org|script\.google/;

let server;
let browser;
let TILE;

test.before(async () => {
  server = spawn(process.execPath, [`${ROOT}tools/serve.mjs`, String(PORT)], { stdio: 'pipe' });
  await new Promise(resolve => server.stdout.once('data', resolve));
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  // a light, map-like tile (land, a white street with a grey casing)
  TILE = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#f2efe9' } })
    .composite([
      { input: { create: { width: 256, height: 18, channels: 3, background: '#bbbbbb' } }, left: 0, top: 119 },
      { input: { create: { width: 256, height: 12, channels: 3, background: '#ffffff' } }, left: 0, top: 122 },
      { input: { create: { width: 60, height: 40, channels: 3, background: '#d9d0c9' } }, left: 40, top: 40 }
    ]).png().toBuffer();
});

test.after(async () => {
  await browser?.close();
  server?.kill();
});


/* the route the fake web app draws: from the start, a corner, to the church */
const line = from => [from, [33.934, 26.735], [CHURCH.lng, CHURCH.lat]];
const okRoute = (body, extra = {}) => ({ ok: true, profile: body.args[0].profile, distance: body.args[0].profile === 'foot-walking' ? 2300 : 2430, duration: body.args[0].profile === 'foot-walking' ? 1740 : 690, geometry: line(body.args[0].from), ...extra });

/*
 * route: (body, request) => { status, body } | 'abort' | Promise of those
 * geo: 'granted' (HERE) | 'denied' | 'timeout'
 * config: map-config.js source override
 * block: a RegExp of the site's own files that fail to load
 */
async function open({ viewport = PHONE, reduced = false, route = body => ({ status: 200, body: okRoute(body) }), geo = 'granted', config = null, content = PUBLISHED, block = null } = {}) {

  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];
  const requests = [];
  const posts = [];
  const tiles = [];

  page.on('pageerror', error => problems.push(error.message));
  page.on('console', msg => { if (msg.type() === 'error') problems.push(msg.text()); });

  await page.evaluateOnNewDocument(() => {
    try { sessionStorage.setItem('athanasios:intro', '1'); } catch {}
    document.addEventListener('securitypolicyviolation', e => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`));
    // test-only: catch every Leaflet map the page makes (window.__maps)
    let real;
    Object.defineProperty(window, 'L', {
      configurable: true,
      get: () => real,
      set: value => {
        real = value;
        if (value && value.Map && !value.__seen) {
          value.__seen = true;
          value.Map.addInitHook(function () { (window.__maps ||= []).push(this); });
        }
      }
    });
  });

  if (geo === 'granted') {
    await context.overridePermissions(ORIGIN, ['geolocation']);
    await page.setGeolocation(HERE);
  }
  else {
    await page.evaluateOnNewDocument(code => {
      const fail = (ok, error) => setTimeout(() => error({ code, message: 'nope', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }), 50);
      Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: fail, watchPosition: fail, clearWatch() {} } });
    }, geo === 'denied' ? 1 : 3);
  }

  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }]);
  await page.setViewport(viewport);

  const state = { route };
  await page.setRequestInterception(true);
  page.on('request', async request => {
    const url = new URL(request.url());
    requests.push(request.url());
    if (url.hostname === 'tile.openstreetmap.org') {
      tiles.push({ url: request.url(), referer: request.headers().referer || '' });
      request.respond({ status: 200, contentType: 'image/png', body: TILE });
    }
    else if (url.hostname === 'script.google.com') {
      const body = JSON.parse(request.postData() || 'null');
      posts.push({ url: request.url(), method: request.method(), headers: request.headers(), body });
      const answer = await state.route(body, request);
      if (answer === 'abort') request.abort('internetdisconnected');
      else if (answer.redirect) request.respond({ status: 302, headers: { Location: answer.redirect, 'Access-Control-Allow-Origin': '*' }, body: '' });
      else request.respond({ status: answer.status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body) });
    }
    else if (url.hostname === 'script.googleusercontent.com') {
      request.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(state.echo) });
    }
    else if (url.hostname === 'www.google.com') {
      request.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><title>google</title>' });
    }
    else if (url.pathname === '/content.json') {
      request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(content) });
    }
    else if (config !== null && url.pathname === '/assets/js/map-config.js') {
      request.respond({ status: 200, contentType: 'text/javascript', body: config });
    }
    else if (block && block.test(url.pathname)) request.abort('internetdisconnected');
    else if (url.origin === ORIGIN) request.continue();
    else request.abort('blockedbyclient');   // nothing else leaves the machine
  });

  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#main[data-state="ready"]');
  await page.$eval('.location', el => el.scrollIntoView({ block: 'center' }));

  return { page, context, problems, requests, posts, tiles, state, close: () => context.close() };

}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const overflow = page => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));

async function openMap(page) {
  await page.click('.location__toggle');
  await page.waitForSelector('.location__live.leaflet-container .leaflet-tile-loaded');
  await page.waitForFunction(() => window.__maps?.length && window.__maps.at(-1)._loaded);
}

const view = page => page.evaluate(() => {
  const map = window.__maps.at(-1);
  const c = map.getCenter();
  return { lat: c.lat, lng: c.lng, zoom: map.getZoom() };
});

const box = (page, selector) => page.$eval(selector, el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; });

async function openDirections(page) {
  await page.click('.location__actions a:not(.btn--primary)');
  await page.waitForSelector('.route .route__locate');
  await page.waitForFunction(() => window.__maps?.at(-1)?._loaded);
}

const status = page => page.$eval('.route__status', el => el.textContent.trim());


/* ---------------- lazy ---------------- */

test('first load: nothing of the map; it all comes on «عرض الخريطة», tiles over HTTPS with a Referer', async () => {

  const { page, problems, requests, tiles, close } = await open();

  // the whole page, scrolled through: still nothing
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await wait(300);
  assert.deepEqual(requests.filter(u => MAP_FILES.test(u)), [], 'no map file before the toggle');
  assert.equal(await page.evaluate(() => typeof window.L), 'undefined');
  const entries = await page.evaluate(() => performance.getEntriesByType('resource').map(r => r.name));
  assert.deepEqual(entries.filter(u => MAP_FILES.test(u)), []);

  await page.$eval('.location', el => el.scrollIntoView({ block: 'center' }));
  await openMap(page);
  for (const file of ['/assets/vendor/leaflet/leaflet.js', '/assets/vendor/leaflet/leaflet.css', '/assets/css/map.css', '/assets/js/map.js']) {
    assert.ok(requests.some(u => u === `${ORIGIN}${file}`), file);
  }
  assert.ok(!requests.some(u => /leaflet\.js\.map|images\/(marker|layers)/.test(u)), 'no default marker images, no source maps');
  assert.ok(tiles.length > 0 && tiles.length <= 30, `only the tiles in view: ${tiles.length}`);
  for (const tile of tiles) {
    assert.match(tile.url, /^https:\/\/tile\.openstreetmap\.org\/16\/\d+\/\d+\.png$/);
    assert.equal(tile.referer, `${ORIGIN}/`, 'the page origin as Referer (strict-origin-when-cross-origin)');
  }
  assert.equal(await page.$eval('.location__live', el => el.querySelector('.leaflet-tile').getAttribute('referrerpolicy')), null);
  assert.deepEqual(problems, []);
  await close();

});


/* ---------------- the map ---------------- */

test('desktop: drag pans; the wheel zooms only after a click; +/−; keyboard; pin, popup, recenter', async () => {

  const { page, problems, close } = await open({ viewport: DESKTOP });
  await openMap(page);
  const start = await view(page);
  assert.equal(start.zoom, 16);
  assert.ok(Math.abs(start.lat - CHURCH.lat) < 1e-6 && Math.abs(start.lng - CHURCH.lng) < 1e-6, 'centred on the church');

  // the wheel before the map is clicked: the page scrolls, the map stays
  const m = await box(page, '.location__live');
  await page.mouse.move(m.cx + 60, m.cy + 40);
  const y0 = await page.evaluate(() => scrollY);
  await page.mouse.wheel({ deltaY: 200 });
  await wait(500);
  assert.equal((await view(page)).zoom, 16, 'no zoom before the map is in use');
  assert.ok(await page.evaluate(() => scrollY) > y0, 'the page scrolled past the map');

  // drag
  const d = await box(page, '.location__live');
  await page.mouse.move(d.cx + 40, d.cy + 30);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(d.cx + 40 - i * 12, d.cy + 30 - i * 6);
  await page.mouse.up();
  await wait(400);
  const dragged = await view(page);
  assert.ok(dragged.lng > start.lng + 1e-4, `dragging left moves the map east: ${dragged.lng}`);

  // now in use: the wheel zooms
  await page.mouse.move(d.cx + 20, d.cy + 20);
  await page.mouse.wheel({ deltaY: -300 });
  await wait(700);
  assert.ok((await view(page)).zoom > 16, 'the wheel zooms once the map was clicked');

  // focus leaves the map: the wheel is the page's again
  await page.focus('.location__toggle');
  const z = (await view(page)).zoom;
  await page.mouse.move(d.cx + 20, d.cy + 20);
  await page.mouse.wheel({ deltaY: -300 });
  await wait(600);
  assert.equal((await view(page)).zoom, z);

  // +/− (44px, navy and gold)
  const zoomIn = await box(page, '.leaflet-control-zoom-in');
  assert.ok(zoomIn.w >= 44 && zoomIn.h >= 44, `${zoomIn.w}×${zoomIn.h}`);
  assert.equal(await page.$eval('.leaflet-control-zoom-in', el => el.getAttribute('aria-label')), 'تكبير');
  assert.equal(await page.$eval('.leaflet-control-zoom-out', el => el.getAttribute('aria-label')), 'تصغير');
  await page.click('.leaflet-control-zoom-out');
  await wait(500);
  assert.equal((await view(page)).zoom, z - 1);

  // keyboard: the map takes focus, arrows pan, + zooms
  await page.focus('.location__live');
  assert.equal(await page.$eval('.location__live', el => el.matches(':focus') && el.getAttribute('role') === 'region' && /خريطة/.test(el.getAttribute('aria-label'))), true);
  const before = await view(page);
  await page.keyboard.press('ArrowRight');
  await wait(400);
  assert.ok((await view(page)).lng > before.lng, 'ArrowRight pans east');
  await page.keyboard.press('Equal');   // "="/"+" key
  await wait(500);
  assert.equal((await view(page)).zoom, before.zoom + 1);

  // the pin: gold, titled, opens its popup (name + address)
  const pin = await page.$('.map-pin');
  assert.ok(pin, 'the church pin');
  assert.equal(await pin.evaluate(el => el.getAttribute('title')), PUBLISHED.location.name);
  assert.equal(await pin.evaluate(el => el.querySelector('svg path[fill="#d7aa50"]') !== null), true);

  // recenter
  await page.click('.map-recenter');
  await wait(600);
  const back = await view(page);
  assert.ok(Math.abs(back.lat - CHURCH.lat) < 1e-5 && Math.abs(back.lng - CHURCH.lng) < 1e-5 && back.zoom === 16, 'back at the church');
  await page.click('.map-pin');
  await page.waitForSelector('.leaflet-popup .map-popup');
  assert.equal(await page.$eval('.map-popup', el => el.textContent), PUBLISHED.location.name + PUBLISHED.location.address);
  assert.equal(await page.$eval('.leaflet-popup-close-button', el => el.getAttribute('aria-label')), 'اقفل');
  const recenter = await box(page, '.map-recenter');
  assert.ok(recenter.h >= 44);
  assert.equal(await page.$eval('.map-recenter', el => el.textContent.trim()), 'رجّع للكنيسة');

  // the attribution: visible, linked, readable, never filtered
  const credit = await page.$eval('.leaflet-control-attribution', el => {
    const r = el.getBoundingClientRect();
    const map = el.closest('.location__live').getBoundingClientRect();
    let filtered = false;
    for (let n = el; n && n !== document.body; n = n.parentElement) if (getComputedStyle(n).filter !== 'none') filtered = true;
    const osm = [...el.querySelectorAll('a')].find(a => /OpenStreetMap/.test(a.textContent));
    return { text: el.textContent, inside: r.top >= map.top && r.bottom <= map.bottom + 0.5 && r.width > 100, filtered, href: osm?.getAttribute('href'), size: parseFloat(getComputedStyle(el).fontSize), opacity: getComputedStyle(el).opacity };
  });
  assert.match(credit.text, /© OpenStreetMap contributors/);
  assert.equal(credit.href, 'https://www.openstreetmap.org/copyright');
  assert.ok(credit.inside, 'inside the map, visible');
  assert.equal(credit.filtered, false, 'the attribution is not darkened');
  assert.ok(credit.size >= 11 && credit.opacity === '1');
  assert.notEqual(await page.$eval('.map-tiles', el => getComputedStyle(el).filter), 'none', 'the tiles are');

  assert.deepEqual(problems, []);
  await close();

});

test('phone: one-finger pan and a pinch work inside the opened map; the page still scrolls past it', async () => {

  const { page, problems, close } = await open({ viewport: PHONE });
  await openMap(page);
  const cdp = await page.createCDPSession();
  const m = await box(page, '.location__live');
  assert.ok(m.h <= 320 && m.h < PHONE.height / 2, `a map you can scroll past: ${m.h}px`);

  const start = await view(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
  await touch('touchStart', [[m.cx + 40, m.cy]]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [[m.cx + 40 - i * 10, m.cy]]);
  await touch('touchEnd', []);
  await wait(500);
  const panned = await view(page);
  assert.ok(panned.lng > start.lng + 1e-4, 'one finger pans');

  await touch('touchStart', [[m.cx - 30, m.cy], [m.cx + 30, m.cy]]);
  for (let i = 1; i <= 10; i++) await touch('touchMove', [[m.cx - 30 - i * 10, m.cy], [m.cx + 30 + i * 10, m.cy]]);
  await touch('touchEnd', []);
  await wait(700);
  assert.ok((await view(page)).zoom > panned.zoom, 'a pinch zooms in');

  // outside the map the page scrolls as usual
  const y0 = await page.evaluate(() => scrollY);
  const body = await box(page, '.location__name');
  await touch('touchStart', [[body.cx, body.cy + 10]]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [[body.cx, body.cy + 10 - i * 25]]);
  await touch('touchEnd', []);
  await wait(500);
  assert.ok(await page.evaluate(() => scrollY) > y0, 'the page scrolls');

  assert.deepEqual(problems, []);
  await close();

});

test('«اخفي الخريطة» destroys the map (and the panel) and brings the drawing back; it opens again', async () => {

  const { page, problems, close } = await open({ viewport: PHONE });
  await openDirections(page);
  await page.click('.route__locate');
  await page.waitForSelector('.route__status.is-result');
  const toggle = await page.$('.location__toggle');
  await toggle.click();
  assert.equal(await toggle.evaluate(el => el.getAttribute('aria-expanded')), 'false');
  assert.equal(await page.$('.location__live'), null);
  assert.equal(await page.$('.route'), null, 'the panel is gone');
  assert.ok(await page.$('.location__map > svg.mapart'), 'the drawing is back');
  assert.equal(await page.evaluate(() => window.__maps[0]._mapPane === undefined && window.__maps[0]._containerId === undefined), true, 'Leaflet map removed');
  assert.equal(await page.$eval('.location__map', el => el.className), 'location__map');
  await toggle.click();
  await page.waitForFunction(() => window.__maps.length === 2 && window.__maps[1]._loaded);
  assert.equal(await page.$('.route'), null, 'opening the map alone shows no panel');
  // close it before it even loaded: no map left behind
  await toggle.click();
  await toggle.click();
  await toggle.click();
  await wait(600);
  assert.equal(await page.$('.location__live'), null);
  assert.ok(await page.$('.location__map > svg.mapart'));
  assert.equal(await page.$$eval('.location__map', els => els.length), 1);
  assert.deepEqual(problems, []);
  await close();

});


/* ---------------- directions ---------------- */

for (const [name, viewport] of Object.entries({ phone: PHONE, desktop: DESKTOP })) {

  test(`${name}: location allowed → the route, distance and time, the credit; the other mode asks again`, async () => {

    const { page, problems, posts, state, close } = await open({ viewport });
    // the real web app answers through a redirect to googleusercontent.com
    state.route = body => { state.echo = okRoute(body); return { redirect: 'https://script.googleusercontent.com/macros/echo?user_content_key=abc&lib=x' }; };
    await openDirections(page);
    assert.equal(await page.$eval('.location__toggle', el => el.getAttribute('aria-expanded')), 'true', 'the map opened with it');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'btn btn--primary route__locate', 'focus on «من موقعي»');
    assert.match(await page.$eval('.route__hint', el => el.textContent), /مرة واحدة.*مش بيتحفظ/, 'why the location, before the prompt');
    assert.equal(posts.length, 0, 'nothing sent before the visitor asks');

    await page.click('.route__locate');
    await page.waitForSelector('.route__status.is-result');
    assert.equal(posts.length, 1);
    assert.match(posts[0].url, ROUTE_URL);
    assert.equal(posts[0].method, 'POST');
    assert.match(posts[0].headers['content-type'], /^text\/plain/);
    assert.equal(posts[0].headers.authorization, undefined, 'no key in the browser');
    assert.equal(posts[0].headers.cookie, undefined);
    assert.deepEqual(posts[0].body, { fn: 'route', args: [{ profile: 'driving-car', from: [33.9303, 26.7405] }] }, 'only the start, rounded');

    assert.equal(await status(page), '٢٫٤ كم · حوالي ١٢ دقيقة بالعربية');
    assert.equal(await page.$eval('.route__credit', el => !el.hidden && el.textContent), 'Routing © openrouteservice.org by HeiGIT · © OpenStreetMap contributors');
    assert.deepEqual(await page.$$eval('.route__credit a', els => els.map(a => a.getAttribute('href'))), ['https://openrouteservice.org/', 'https://www.openstreetmap.org/copyright']);
    assert.equal(await page.$('.route__hint:not([hidden])'), null, 'the hint steps aside once there is a start');
    const drawn = await page.evaluate(() => {
      const lineEl = document.querySelector('.location__live path.route-line');
      const map = window.__maps.at(-1);
      const bounds = map.getBounds();
      return { d: lineEl?.getAttribute('d')?.length || 0, glow: !!document.querySelector('.location__live path.route-glow'), stroke: lineEl && getComputedStyle(lineEl).stroke, church: bounds.contains([26.7314392, 33.9379229]), start: bounds.contains([26.74051234, 33.93029876]), startPin: !!document.querySelector('.map-start') };
    });
    assert.ok(drawn.d > 10 && drawn.glow, 'a gold line with a glow');
    assert.equal(drawn.stroke, 'rgb(242, 210, 139)');
    assert.ok(drawn.church && drawn.start && drawn.startPin, 'fitted: the start and the church in view');

    // walking: a new request; driving again: from memory
    await page.click('.route__mode[data-mode="foot"]');
    await page.waitForFunction(() => /مشي$/.test(document.querySelector('.route__status').textContent));
    assert.equal(posts.length, 2);
    assert.equal(posts[1].body.args[0].profile, 'foot-walking');
    assert.equal(await status(page), '٢٫٣ كم · حوالي ٢٩ دقيقة مشي');
    assert.deepEqual(await page.$$eval('.route__mode', els => els.map(b => b.getAttribute('aria-pressed'))), ['false', 'true']);
    await page.click('.route__mode[data-mode="car"]');
    await page.waitForFunction(() => /بالعربية$/.test(document.querySelector('.route__status').textContent));
    assert.equal(posts.length, 2, 'cached per mode');

    // nothing about the visitor's place kept anywhere
    assert.equal(await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })).then(s => /33\.9303|26\.7405/.test(s)), false);
    assert.equal(await overflow(page), 0);
    assert.deepEqual(problems, []);
    await close();

  });

}

test('location denied → choose the start by tapping the map (or Enter at the centre); Google Maps stays offered', async () => {

  const { page, problems, posts, close } = await open({ viewport: PHONE, geo: 'denied' });
  await openDirections(page);
  await page.click('.route__locate');
  await page.waitForSelector('.route.is-problem');
  assert.equal(await status(page), 'مش قادرين نوصل لموقعك. اختار نقطة البداية على الخريطة.');
  assert.equal(await page.$eval('.route__pick', el => el.getAttribute('aria-pressed')), 'true', 'choosing is on');
  assert.ok(await page.$('.location__live.is-picking'));
  assert.equal(await page.$eval('.route__outside', el => el.getAttribute('href')), PUBLISHED.location.directionsUrl);
  assert.equal(await page.$eval('.route__outside', el => el.getAttribute('target')), '_blank');
  assert.equal(posts.length, 0);
  await wait(900);   // (choosing brings the map into sight: let that scroll settle)
  assert.ok(await page.$eval('.location__live', el => el.getBoundingClientRect().top >= 0), 'the map is in sight to choose on');

  // a tap on the map is the start
  const m = await box(page, '.location__live');
  const tap = { x: m.x + m.w * 0.3, y: m.y + m.h * 0.65 };
  const expected = await page.evaluate(({ x, y }) => {
    const map = window.__maps.at(-1);
    const r = map.getContainer().getBoundingClientRect();
    const ll = map.containerPointToLatLng([x - r.left, y - r.top]);
    return [Math.round(ll.lng * 1e4) / 1e4, Math.round(ll.lat * 1e4) / 1e4];
  }, tap);
  await page.touchscreen.tap(tap.x, tap.y);
  await page.waitForSelector('.route__status.is-result');
  const sent = posts[0].body.args[0].from;
  assert.ok(Math.abs(sent[0] - expected[0]) <= 2e-4 && Math.abs(sent[1] - expected[1]) <= 2e-4, `the tapped point: ${sent} vs ${expected}`);
  assert.equal(await page.$('.location__live.is-picking'), null);
  assert.ok(await page.$('.map-start'), 'a start marker (draggable)');
  assert.equal(await page.$eval('.map-start', el => el.classList.contains('leaflet-marker-draggable')), true);

  // from the keyboard: «اختار نقطة البداية», then Enter on the map = its centre
  await page.click('.route__pick');
  assert.match(await status(page), /دوس على الخريطة/);
  await page.focus('.location__live');
  const centre = await page.evaluate(() => { const c = window.__maps.at(-1).getCenter(); return [Math.round(c.lng * 1e4) / 1e4, Math.round(c.lat * 1e4) / 1e4]; });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.route__status').classList.contains('is-result'));
  await wait(100);
  assert.deepEqual(posts.at(-1).body.args[0].from, centre);

  assert.deepEqual(problems, []);
  await close();

});

test('location times out → the same choice, with its own message', async () => {
  const { page, close } = await open({ viewport: PHONE, geo: 'timeout' });
  await openDirections(page);
  await page.click('.route__locate');
  await page.waitForSelector('.route.is-problem');
  assert.equal(await status(page), 'موقعك مش واضح دلوقتي. اختار نقطة البداية على الخريطة.');
  assert.equal(await page.$eval('.route__pick', el => el.getAttribute('aria-pressed')), 'true');
  await close();
});

test('no routeUrl: «الاتجاهات» is the Google Maps link, as before (no map loaded)', async () => {

  const { page, problems, requests, close } = await open({ viewport: PHONE, config: "export const MAP_CONFIG = { routeUrl: '' };" });
  await page.evaluate(() => {
    window.__opened = [];
    window.open = (...args) => { window.__opened.push(args); return null; };
    window.addEventListener('click', e => { window.__native = !e.defaultPrevented; e.preventDefault(); });
  });
  const link = '.location__actions a:not(.btn--primary)';
  const href = await page.$eval(link, a => a.href);
  assert.equal(href, PUBLISHED.location.directionsUrl);

  // the first tap may come before the config is read: then it opens the link itself
  await page.click(link);
  await wait(300);
  const first = await page.evaluate(() => ({ native: window.__native, opened: window.__opened }));
  assert.ok(first.native || (first.opened.length === 1 && first.opened[0][0] === href && first.opened[0][1] === '_blank'), JSON.stringify(first));

  // from then on, a plain link
  await page.evaluate(() => { window.__native = null; window.__opened = []; });
  await page.click(link);
  await wait(200);
  assert.deepEqual(await page.evaluate(() => ({ native: window.__native, opened: window.__opened })), { native: true, opened: [] });
  assert.equal(await page.$eval('.location__toggle', el => el.getAttribute('aria-expanded')), 'false');
  assert.ok(!requests.some(u => /leaflet|\/map\.js|script\.google/.test(u)), 'no map, no route request');
  assert.deepEqual(problems, []);
  await close();

});

test('a ctrl/⌘-click on «الاتجاهات» keeps the browser\'s own new-tab behaviour', async () => {
  const { page, close } = await open({ viewport: DESKTOP });
  await page.evaluate(() => window.addEventListener('click', e => { window.__native = !e.defaultPrevented; e.preventDefault(); }));
  await page.keyboard.down('Control');
  await page.click('.location__actions a:not(.btn--primary)');
  await page.keyboard.up('Control');
  assert.equal(await page.evaluate(() => window.__native), true);
  await close();
});


/* ---------------- errors ---------------- */

const FAILURES = {
  busy: [() => ({ status: 200, body: { ok: false, code: 'busy', message: 'x' } }), 'خدمة الاتجاهات عليها ضغط دلوقتي. جرّب كمان شوية، أو افتحها في خرائط جوجل.'],
  config: [() => ({ status: 200, body: { ok: false, code: 'config', message: 'x' } }), 'الاتجاهات جوه الموقع مش متاحة دلوقتي. افتحها في خرائط جوجل.'],
  invalid: [() => ({ status: 200, body: { ok: false, code: 'invalid', message: 'x' } }), 'مش لاقيين طريق من النقطة دي. اختار نقطة تانية قريبة من شارع.'],
  upstream: [() => ({ status: 200, body: { ok: false, code: 'upstream', message: 'x' } }), 'خدمة الاتجاهات مش بترد دلوقتي. جرّب تاني بعد شوية، أو افتحها في خرائط جوجل.'],
  'api error (not wired yet)': [() => ({ status: 200, body: { ok: false, error: 'الطلب ده مش معروف.', code: 'fn' } }), 'خدمة الاتجاهات مش بترد دلوقتي. جرّب تاني بعد شوية، أو افتحها في خرائط جوجل.'],
  'HTTP 429': [() => ({ status: 429, body: 'Too Many Requests' }), 'خدمة الاتجاهات عليها ضغط دلوقتي. جرّب كمان شوية، أو افتحها في خرائط جوجل.'],
  'HTTP 500': [() => ({ status: 500, body: '<html>error</html>' }), 'خدمة الاتجاهات مش بترد دلوقتي. جرّب تاني بعد شوية، أو افتحها في خرائط جوجل.'],
  'not JSON': [() => ({ status: 200, body: '<html>sign in</html>' }), 'خدمة الاتجاهات مش بترد دلوقتي. جرّب تاني بعد شوية، أو افتحها في خرائط جوجل.'],
  'network error': [() => 'abort', 'خدمة الاتجاهات مش بترد دلوقتي. جرّب تاني بعد شوية، أو افتحها في خرائط جوجل.']
};

for (const [name, [route, message]] of Object.entries(FAILURES)) {
  test(`route ${name} → a clear message and the Google Maps button`, async () => {
    const { page, problems, close } = await open({ viewport: PHONE, route });
    await openDirections(page);
    await page.click('.route__locate');
    await page.waitForSelector('.route.is-problem');
    await wait(350);   // (the button's colour transition)
    assert.equal(await status(page), message);
    const outside = await page.$eval('.route__outside', el => ({ href: el.getAttribute('href'), bg: getComputedStyle(el).backgroundColor, h: el.getBoundingClientRect().height, visible: el.offsetParent !== null }));
    assert.equal(outside.href, PUBLISHED.location.directionsUrl);
    assert.equal(outside.bg, 'rgb(215, 170, 80)', 'the Google Maps button stands out');
    assert.ok(outside.visible && outside.h >= 44);
    assert.equal(await page.$('.location__live path.route-line'), null);
    assert.equal(await page.$eval('.route__credit', el => el.hidden), true);
    assert.deepEqual(problems.filter(p => !/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(p)), []);
    await close();
  });
}

test('offline → «مفيش اتصال», then back online: a new start draws the route', async () => {
  const { page, state, close } = await open({ viewport: PHONE });
  await openDirections(page);
  const online = state.route;
  state.route = () => 'abort';
  await page.setOfflineMode(true);
  await page.click('.route__locate');
  await page.waitForSelector('.route.is-problem');
  assert.equal(await status(page), 'مفيش اتصال بالإنترنت دلوقتي. اتأكد من الاتصال وجرّب تاني، أو افتحها في خرائط جوجل.');
  await page.setOfflineMode(false);
  state.route = online;
  await page.click('.route__locate');
  await page.waitForSelector('.route__status.is-result');
  assert.equal(await page.$('.route.is-problem'), null);
  await close();
});

test('a slow answer (Apps Script waking up) says so, then shows the route', async () => {
  const { page, close } = await open({ viewport: PHONE, route: async body => { await wait(7000); return { status: 200, body: okRoute(body) }; } });
  await openDirections(page);
  await page.click('.route__locate');
  await page.waitForFunction(() => document.querySelector('.route__status').textContent === 'بنحسب الطريق…');
  await page.waitForFunction(() => /أبطأ من العادي/.test(document.querySelector('.route__status').textContent), { timeout: 8000 });
  await page.waitForSelector('.route__status.is-result', { timeout: 6000 });
  await close();
});


/* ---------------- layout, motion, a11y ---------------- */

for (const width of [320, 360, 390, 412, 1366, 1920]) {
  test(`${width}px: no sideways scroll with the map and the route panel open; buttons ≥ 44px; nothing sticks out`, async () => {
    const viewport = width < 1024 ? phone(width) : { width, height: 1000, deviceScaleFactor: 1 };
    const { page, problems, close } = await open({ viewport });
    await openMap(page);
    assert.equal(await overflow(page), 0);
    await openDirections(page);
    await page.click('.route__locate');
    await page.waitForSelector('.route__status.is-result');
    await wait(300);
    const report = await page.evaluate(() => {
      const card = document.querySelector('.location');
      const box = card.getBoundingClientRect();
      const outside = [...card.querySelectorAll('.location__body *, .route, .route *, .location__map, .location__live, .leaflet-control-container *')]
        .filter(el => !el.classList.contains('ripple'))
        .filter(el => { const r = el.getBoundingClientRect(); return r.width && (r.left < box.left - 0.5 || r.right > box.right + 0.5); })
        .map(el => el.className || el.tagName);
      const small = [...card.querySelectorAll('.location__actions > *, .route button, .route .btn, .map-recenter, .leaflet-bar a')]
        .map(el => { const r = el.getBoundingClientRect(); return { t: el.textContent.trim(), w: r.width, h: r.height, cut: el.scrollWidth > el.clientWidth + 1 }; })
        .filter(b => b.w < 44 || b.h < 44 || b.cut);
      const map = card.querySelector('.location__map').getBoundingClientRect();
      return { outside, small, map: { w: map.width, h: map.height }, card: card.clientWidth, wide: card.hasAttribute('data-wide') };
    });
    assert.equal(await overflow(page), 0, 'no sideways scroll');
    assert.deepEqual(report.outside, []);
    assert.deepEqual(report.small, []);
    if (!report.wide) assert.ok(Math.abs(report.map.w - report.card) <= 1, `the map spans the card: ${JSON.stringify(report)}`);
    assert.ok(report.map.h >= 220 && report.map.h <= 360, `a map height you can scroll past: ${report.map.h}`);
    if (width >= 1024) {
      // still the desktop two-up grid: Google Maps on its own row, the other two side by side
      const rows = await page.$eval('.location__actions', el => new Set([...el.children].map(b => Math.round(b.getBoundingClientRect().top))).size);
      assert.equal(rows, 2);
    }
    assert.deepEqual(problems, []);
    await close();
  });
}

test('reduced motion: no map animation (zoom, fade, inertia), recenter jumps', async () => {
  const { page, close } = await open({ viewport: DESKTOP, reduced: true });
  await openMap(page);
  const options = await page.evaluate(() => {
    const o = window.__maps.at(-1).options;
    return { zoom: o.zoomAnimation, fade: o.fadeAnimation, marker: o.markerZoomAnimation, inertia: o.inertia, animated: window.__maps.at(-1)._zoomAnimated };
  });
  assert.deepEqual(options, { zoom: false, fade: false, marker: false, inertia: false, animated: false });
  await page.click('.leaflet-control-zoom-out');
  await wait(100);
  await page.click('.map-recenter');
  const v = await view(page);   // at once, no fly
  assert.equal(v.zoom, 16);
  assert.ok(Math.abs(v.lat - CHURCH.lat) < 1e-6);
  await close();

  const full = await open({ viewport: DESKTOP });
  await openMap(full.page);
  assert.equal(await full.page.evaluate(() => window.__maps.at(-1).options.zoomAnimation), true, 'animated otherwise');
  await full.close();
});

test('axe: the open map with a route passes (WCAG A/AA)', async () => {
  const { page, close } = await open({ viewport: PHONE });
  await openDirections(page);
  await page.click('.route__locate');
  await page.waitForSelector('.route__status.is-result');
  await page.click('.map-pin');
  await page.waitForSelector('.map-popup');
  await page.evaluate(AXE);
  const results = await page.evaluate(() => window.axe.run(document.querySelector('.location'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }));
  assert.deepEqual(results.violations.map(v => `${v.id}: ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`), []);
  await close();
});

test('no coordinates: the toggle shows Google\'s keyless embed as before; «الاتجاهات» stays a link', async () => {
  const content = structuredClone(PUBLISHED);
  content.location = { ...content.location, lat: null, lng: null };
  const { page, problems, requests, close } = await open({ viewport: PHONE, content });
  await page.click('.location__toggle');
  await page.waitForSelector('.location__map.is-live iframe.location__live');
  assert.match(await page.$eval('iframe.location__live', el => el.src), /^https:\/\/www\.google\.com\/maps\?q=/);
  assert.ok(!requests.some(u => /leaflet\.js/.test(u)), 'no Leaflet without coordinates');
  await page.evaluate(() => window.addEventListener('click', e => { window.__native = !e.defaultPrevented; e.preventDefault(); }));
  await page.click('.location__actions a:not(.btn--primary)');
  assert.equal(await page.evaluate(() => window.__native), true);
  assert.deepEqual(problems, []);
  await close();
});

test('Leaflet cannot load (offline, not cached): a calm message in the map; «الاتجاهات» falls back to Google Maps', async () => {
  const { page, problems, close } = await open({ viewport: PHONE, block: /\/vendor\/leaflet\/leaflet\.js$/ });
  await page.evaluate(() => { window.__opened = []; window.open = (...args) => { window.__opened.push(args); return null; }; });
  await page.click('.location__toggle');
  await page.waitForSelector('.location__map.is-live .location__fail');
  assert.equal(await page.$eval('.location__fail', el => el.textContent), 'الخريطة محتاجة إنترنت. جرّب تاني بعد شوية.');
  assert.ok(await page.$('.location__map svg.mapart'), 'the drawing stays behind it');
  await page.click('.location__actions a:not(.btn--primary)');
  await page.waitForFunction(() => window.__opened.length === 1);
  assert.deepEqual(await page.evaluate(() => window.__opened[0]), [PUBLISHED.location.directionsUrl, '_blank', 'noopener']);
  await page.click('.location__toggle');
  assert.equal(await page.$('.location__fail'), null, 'closing clears it');
  assert.deepEqual(problems.filter(p => !/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(p)), []);
  await close();
});

