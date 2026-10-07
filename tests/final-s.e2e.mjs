// Final polish, public scenes (browser): the outer effects layer (reactions
// cross the phone's edges, unclipped; the controls stay on top and
// clickable), believable words per platform, the real media loading only
// with its scene, the scenes' sound (a stubbed AudioContext: voices, the
// typing taps, mute, no sound before a gesture), the speaker in the sheet,
// the contact cards' extra life, the tiers, no page overflow, and nothing
// added to the first load.
//
// Run: cd tools && node --test --test-concurrency=1 ../tests/final-s.e2e.mjs

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';
import { PLATFORMS } from '../assets/js/platforms.js';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');

const PORT = 4800;
const BASE = `http://localhost:${PORT}/`;
const VIEWS = {
  320: { width: 320, height: 640, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
  360: { width: 360, height: 780, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
  390: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
  412: { width: 412, height: 915, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
  1366: { width: 1366, height: 768, deviceScaleFactor: 1 },
  1920: { width: 1920, height: 1080, deviceScaleFactor: 1 }
};

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find(existsSync);

const ROOTS = {
  facebook: '.fb', instagram: '.ig', tiktok: '.tt', whatsapp: '.wa', chat: '.ch', feed: '.fd',
  vertical: '.vt', stories: '.vt', player: '.pl', music: '.mu', map: '.mp', call: '.cl', mail: '.ml', browser: '.br', voice: '.vo'
};

let server;
let browser;
let content;
let body;

test.before(async () => {
  execFileSync(process.execPath, [`${ROOT}tools/demo.mjs`], { stdio: 'pipe' });
  content = JSON.parse(readFileSync(`${ROOT}tools/.cache/demo/content.json`, 'utf8'));
  // one link for every registry key the demo doesn't have yet
  for (const key of Object.keys(PLATFORMS)) {
    if ([...content.featured, ...content.sections.flatMap(s => s.links)].some(l => l.experience === key)) continue;
    content.sections[0].links.push({ id: `fs-${key}`, title: PLATFORMS[key].label, subtitle: '', url: `https://example.org/${key}`, icon: 'star', style: 'card', badge: '', startAt: '', endAt: '', experience: key });
  }
  body = JSON.stringify(content);
  server = spawn(process.execPath, [`${ROOT}tools/serve.mjs`, String(PORT), '--demo'], { stdio: 'pipe' });
  await new Promise(resolve => server.stdout.once('data', resolve));
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
});

test.after(async () => {
  await browser?.close();
  server?.kill();
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const linkOf = key => [...content.featured, ...content.sections.flatMap(s => s.links)].find(l => l.experience === key);

/* a stand-in AudioContext that counts what the page asks of it */
function fakeAudio() {
  const stats = window.__audio = { contexts: 0, starts: 0, stops: 0 };
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} });
  const node = () => ({ connect: target => target, disconnect() {}, gain: param(), frequency: param(), Q: param(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() });
  const source = () => ({ ...node(), type: '', buffer: null, start() { stats.starts += 1; }, stop() { stats.stops += 1; } });
  class FakeContext {
    constructor() { stats.contexts += 1; this.state = 'running'; this.sampleRate = 8000; this.destination = node(); }
    get currentTime() { return performance.now() / 1000; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    createGain() { return node(); }
    createBiquadFilter() { return node(); }
    createDynamicsCompressor() { return node(); }
    createOscillator() { return source(); }
    createBufferSource() { return source(); }
    createBuffer(channels, length) { const data = new Float32Array(length); return { getChannelData: () => data }; }
  }
  window.AudioContext = FakeContext;
  window.webkitAudioContext = FakeContext;
  window.__xpAudioLog = [];
}

async function open({ view = VIEWS[390], reduced = false, weak = false, sound = false, audio = true, hash = '', inactive = false } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];
  const requests = [];
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', message => { if (message.type() === 'error') problems.push(message.text()); });
  page.on('request', request => requests.push(request.url()));
  await page.setRequestInterception(true);
  page.on('request', request => (request.url().includes('content.json')
    ? request.respond({ status: 200, contentType: 'application/json', body })
    : request.continue()));
  if (audio) await page.evaluateOnNewDocument(fakeAudio);
  // puppeteer's own evaluate calls count as gestures: stand in for a visitor who never touched
  if (inactive) await page.evaluateOnNewDocument(() => Object.defineProperty(navigator, 'userActivation', { value: { hasBeenActive: false, isActive: false } }));
  if (sound) await page.evaluateOnNewDocument(() => { try { localStorage.setItem('athanasios.sound', 'on'); } catch { /* opaque frames */ } });
  if (weak) {
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 2 });
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 1 });
    });
  }
  await page.setViewport(view);
  if (reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.goto(BASE + hash, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#main[data-state="ready"]');
  return { page, problems, requests, close: () => context.close() };
}

async function follow(page, key) {
  await page.evaluate(id => { location.hash = `#follow/${id}`; }, linkOf(key).id);
  await page.waitForSelector(`dialog.sheet--xp[open] .xp-stage[data-platform="${key}"] ${ROOTS[PLATFORMS[key].scene]}`);
}

async function shut(page) {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog.sheet'));
}

/* is the point at the element's centre on the element itself? */
const onTop = (page, selector) => page.evaluate(sel => {
  const node = document.querySelector(sel);
  if (!node) return false;
  const box = node.getBoundingClientRect();
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return !!hit && (hit === node || node.contains(hit));
}, selector);

const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);


/* ---------------- first load ---------------- */

test('first load: no scene, sound, card or media code (budgets: browser.e2e)', async () => {
  const { page, requests, problems, close } = await open({ view: VIEWS[360], audio: false });
  await sleep(600);
  const loaded = requests.map(u => u.replace(BASE, ''));
  for (const lazy of ['assets/js/xp/', 'assets/media/xp/', 'assets/css/xp', 'assets/js/platforms.js']) {
    assert.deepEqual(loaded.filter(u => u.startsWith(lazy)), [], `${lazy} is not part of the first load`);
  }
  const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(r => ({ name: r.name.replace(location.origin, ''), size: r.encodedBodySize })));
  const own = resources.filter(r => !/^\/?media\//.test(r.name));
  const raw = own.reduce((sum, r) => sum + r.size, Buffer.byteLength(readFileSync(`${ROOT}index.html`)));
  const sent = own.reduce((sum, r) => {
    const path = r.name.split('?')[0].replace(/^\//, '');
    return sum + (/\.(js|css|json|html|svg)$/.test(path) && existsSync(ROOT + path) ? gzipSync(readFileSync(ROOT + path), { level: 9 }).length : r.size);
  }, gzipSync(readFileSync(`${ROOT}index.html`)).length);
  console.log(`  first load: ${(sent / 1024).toFixed(1)} KB compressed, ${(raw / 1024).toFixed(1)} KB uncompressed`);
  // (the budgets themselves: tests/browser.e2e.mjs, on the real content)
  assert.deepEqual(problems, []);
  await close();
});


/* ---------------- the outer effects layer ---------------- */

for (const width of [320, 390, 1366]) {

  test(`effects at ${width}px: outside the phone, crossing its edges, unclipped; controls stay on top`, async () => {
    const { page, problems, close } = await open({ view: VIEWS[width] });
    for (const key of ['facebook', 'whatsapp', 'tiktok', 'instagram', 'telegram']) {
      await follow(page, key);
      const crossings = new Set();
      for (let i = 0; i < 16; i++) {
        await sleep(500);
        const sample = await page.evaluate(() => {
          const stage = document.querySelector('dialog.sheet--xp[open] .xp-stage');
          const phone = stage.querySelector(':scope > .xp-phone');
          const fx = stage.querySelector(':scope > .xp-fx');
          const p = phone.getBoundingClientRect();
          const items = [...fx.querySelectorAll('.xp-amb, .xp-float')].filter(n => Number(getComputedStyle(n).opacity) > 0.15);
          return {
            sibling: fx.parentNode === phone.parentNode && !phone.contains(fx),
            inPhone: phone.querySelectorAll('.xp-float, .xp-edge, .xp-edge__item').length,
            fxAbove: Number(getComputedStyle(fx).zIndex) > Number(getComputedStyle(phone).zIndex || 0),
            pointer: getComputedStyle(fx).pointerEvents,
            crossing: items.filter(n => {
              const r = n.getBoundingClientRect();
              return r.width && ((r.left < p.left && r.right > p.left) || (r.left < p.right && r.right > p.right) || r.right < p.left || r.left > p.right);
            }).map(n => n.dataset.amb || 'float')
          };
        });
        assert.equal(sample.sibling, true, `${key}: the effects layer is a sibling of the phone`);
        assert.equal(sample.inPhone, 0, `${key}: no decorative reaction inside the phone`);
        assert.equal(sample.fxAbove, true);
        assert.equal(sample.pointer, 'none');
        sample.crossing.forEach(name => crossings.add(name));
        for (const control of ['.xp__cta', '.sheet__close', '.xp-sound']) {
          assert.ok(await onTop(page, `dialog.sheet--xp[open] ${control}`), `${key} @${width}: ${control} is clickable (${i})`);
        }
        assert.ok(await overflow(page) <= 0, `${key} @${width}: no horizontal page overflow`);
      }
      assert.ok(crossings.size > 0, `${key} @${width}: reactions outside / across the phone's edges`);
      await shut(page);
    }
    assert.deepEqual(problems, []);
    await close();
  });

}

test('no horizontal overflow with a scene open at 360, 412 and 1920', async () => {
  for (const width of [360, 412, 1920]) {
    const { page, problems, close } = await open({ view: VIEWS[width] });
    for (const key of ['facebook', 'whatsapp', 'youtube', 'maps']) {
      await follow(page, key);
      await sleep(2500);
      assert.ok(await overflow(page) <= 0, `${key} @${width}`);
      await shut(page);
    }
    assert.deepEqual(problems, []);
    await close();
  }
});

test('wide screens: platform activity beside the sheet, behind it, gone with it', async () => {
  const { page, problems, close } = await open({ view: VIEWS[1920] });
  await follow(page, 'facebook');
  await sleep(6000);
  const side = await page.evaluate(() => ({
    items: document.querySelectorAll('.xp-side .xp-amb').length,
    words: [...document.querySelectorAll('.xp-side .xp-msg__text')].map(n => n.textContent).filter(Boolean).length,
    behind: getComputedStyle(document.querySelector('.xp-side')).zIndex
  }));
  assert.ok(side.items > 0, JSON.stringify(side));
  assert.equal(side.behind, '-1');
  await shut(page);
  assert.equal(await page.$('.xp-side'), null);
  assert.deepEqual(problems, []);
  await close();
});


/* ---------------- believable words ---------------- */

const WORDS = {
  facebook: ['أسرة البابا اثناسيوس للشباب بسفاجا', '١٫٣ ألف متابع'],
  instagram: ['pope.athanasiustheapostolic'],
  tiktok: ['@stathanasios.safaga', '#تحديات_وألعاب'],
  whatsapp: ['خادم الاجتماع', 'النهارده'],
  telegram: ['مشترك'],
  messenger: ['كل أحد'],
  discord: ['العامة'],
  x: ['البابا أثناسيوس الرسولي'],
  threads: ['البابا أثناسيوس الرسولي'],
  snapchat: ['«'],
  youtube: ['تحديات وألعاب', 'مشاهدة'],
  spotify: ['أسرة البابا أثناسيوس'],
  maps: ['كنيسة أبي سيفين'],
  phone: ['خادم الاجتماع'],
  email: ['ميعاد اجتماع الأحد'],
  web: []
};

test('every platform: real words, no placeholder bars', async () => {
  const { page, problems, close } = await open();
  for (const [key, words] of Object.entries(WORDS)) {
    await follow(page, key);
    await sleep(key === 'x' || key === 'threads' ? 900 : 300);
    const text = await page.$eval('dialog.sheet--xp[open] .xp-phone', n => n.textContent);
    for (const word of words) assert.ok(text.includes(word), `${key}: «${word}»`);
    assert.equal(await page.$$eval('dialog.sheet--xp[open] .xp-phone .xp-lines', n => n.length), 0, `${key}: no placeholder bars`);
    await shut(page);
  }
  assert.deepEqual(problems, []);
  await close();
});

test('the real material: posters in the feeds, game clips load only with their scene', async () => {
  const { page, requests, problems, close } = await open();
  assert.equal(requests.filter(u => u.includes('/assets/media/xp/')).length, 0, 'nothing before a scene opens');

  await follow(page, 'facebook');
  await sleep(800);
  const posters = await page.$$eval('.fb-post__media img', imgs => imgs.map(i => i.getAttribute('src')));
  assert.ok(posters.some(src => src.startsWith('assets/media/xp/posters/')), JSON.stringify(posters));
  assert.equal(requests.filter(u => u.endsWith('.mp4')).length, 0, 'no video for Facebook');
  await shut(page);

  await follow(page, 'tiktok');
  await page.waitForFunction(() => [...document.querySelectorAll('.tt-clip__video')].some(v => v.tagName === 'VIDEO' && !v.paused && v.readyState >= 2), { timeout: 8000 });
  const video = await page.$eval('.tt-clip__video', v => ({ preload: v.getAttribute('preload'), muted: v.muted, loop: v.loop, inline: v.hasAttribute('playsinline') }));
  assert.deepEqual(video, { preload: 'none', muted: true, loop: true, inline: true });
  assert.ok(requests.some(u => u.includes('/assets/media/xp/clips/') && u.endsWith('.mp4')));
  await shut(page);
  await sleep(300);
  assert.equal(await page.evaluate(() => document.querySelectorAll('video').length), 0, 'gone with the sheet');
  assert.deepEqual(problems, []);
  await close();
});

test('lite tier: posters instead of videos, no edge layer', async () => {
  const { page, requests, problems, close } = await open({ weak: true });
  await sleep(2800);
  await page.evaluate(() => { document.documentElement.dataset.motion = 'lite'; });
  await follow(page, 'tiktok');
  await sleep(4000);
  assert.equal(await page.$$eval('dialog.sheet--xp[open] video', v => v.length), 0);
  assert.equal(requests.filter(u => u.endsWith('.mp4')).length, 0);
  assert.equal(await page.$$eval('.xp-edge .xp-amb', n => n.length), 0);
  assert.deepEqual(problems, []);
  await close();
});

test('reduced motion: the final frame, nothing around the phone, no video', async () => {
  const { page, problems, close } = await open({ reduced: true });
  for (const key of ['facebook', 'tiktok', 'whatsapp', 'youtube']) {
    await follow(page, key);
    await sleep(1200);
    const state = await page.evaluate(() => ({
      fx: document.querySelectorAll('.xp-fx .xp-amb, .xp-fx .xp-float').length,
      videos: document.querySelectorAll('dialog.sheet--xp[open] video').length,
      moving: document.getAnimations().filter(a => a.playState === 'running' && a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.xp-stage')).length
    }));
    assert.deepEqual(state, { fx: 0, videos: 0, moving: 0 }, key);
    await shut(page);
  }
  assert.deepEqual(problems, []);
  await close();
});


/* ---------------- sound ---------------- */

test('sound: off by default, nothing before a gesture, the speaker in the sheet is the page setting', async () => {
  const { page, problems, close } = await open();
  await follow(page, 'whatsapp');
  await sleep(2500);
  assert.deepEqual(await page.evaluate(() => [window.__audio.contexts, window.__xpAudioLog.length]), [0, 0], 'silent by default');
  assert.equal(await page.$eval('.xp-sound', b => b.getAttribute('aria-pressed')), 'false');
  assert.match(await page.$eval('.xp-sound', b => b.getAttribute('aria-label')), /صوت/);

  await page.click('.xp-sound');
  assert.equal(await page.$eval('.xp-sound', b => b.getAttribute('aria-pressed')), 'true');
  assert.equal(await page.$eval('#sound-toggle', b => b.getAttribute('aria-pressed')), 'true', 'the top bar shows the same setting');
  assert.equal(await page.evaluate(() => localStorage.getItem('athanasios.sound')), 'on');
  await sleep(9000);
  const log = await page.evaluate(() => window.__xpAudioLog);
  assert.equal(await page.evaluate(() => window.__audio.contexts), 1, 'one shared AudioContext');
  assert.ok(log.filter(e => !e.dropped).length > 3, `scene sounds play (${log.length})`);

  // mute: nothing more
  await page.click('.xp-sound');
  assert.equal(await page.$eval('#sound-toggle', b => b.getAttribute('aria-pressed')), 'false');
  const before = await page.evaluate(() => window.__xpAudioLog.length);
  await sleep(4000);
  assert.equal(await page.evaluate(() => window.__xpAudioLog.length), before, 'muted');
  assert.deepEqual(problems, []);
  await close();
});

test('sound on, but a deep link with no gesture: nothing until the visitor touches', async () => {
  const { page, problems, close } = await open({ sound: true, inactive: true, hash: `#follow/${linkOf('tiktok').id}` });
  await page.waitForSelector('dialog.sheet--xp[open] .tt');
  await sleep(4000);
  const heard = await page.evaluate(() => [window.__audio.contexts, window.__audio.starts, window.__xpAudioLog.length, navigator.userActivation.hasBeenActive]);
  assert.deepEqual(heard, [0, 0, 0, false]);
  assert.deepEqual(problems, []);
  await close();
});

test('sound: never more than 3 voices, typing taps only while typing, nothing after close', async () => {
  const { page, problems, close } = await open({ sound: true });
  await page.keyboard.press('Shift');   // a first gesture
  await follow(page, 'whatsapp');
  await page.evaluate(() => {
    window.__typing = [];
    const field = document.querySelector('.wa-bar__field');
    new MutationObserver(() => window.__typing.push([field.classList.contains('is-typing'), performance.now()])).observe(field, { attributes: true, attributeFilter: ['class'] });
  });
  await sleep(16000);
  const { log, typing } = await page.evaluate(() => ({ log: window.__xpAudioLog, typing: window.__typing }));
  const played = log.filter(e => !e.dropped);
  const LENGTH = { key: 50, send: 150, pop: 130, react: 100, like: 280, tick: 100, swipe: 260, whoosh: 440, notify: 480, ring: 540 };
  for (const e of played) {
    const sounding = played.filter(o => o.t <= e.t && o.t + LENGTH[o.cat] + 30 > e.t).length;
    assert.ok(sounding <= 3, `at most 3 voices (${sounding} at ${e.cat})`);
  }
  // key taps fall inside a typing span, never after it ended
  const spans = [];
  let start = null;
  for (const [on, t] of typing) {
    if (on && start === null) start = t;
    if (!on && start !== null) { spans.push([start, t]); start = null; }
  }
  if (start !== null) spans.push([start, Infinity]);
  const keys = played.filter(e => e.cat === 'key');
  assert.ok(keys.length > 3, `taps while the visitor types (${keys.length})`);
  for (const key of keys) assert.ok(spans.some(([a, b]) => key.t >= a - 5 && key.t <= b + 5), `a key tap outside typing at ${key.t}`);
  // categories: no two of a kind closer than its gap
  const GAP = { key: 55, send: 300, pop: 220, react: 150, like: 260, tick: 260, swipe: 650, whoosh: 900, notify: 900, ring: 1400 };
  for (const cat of Object.keys(GAP)) {
    const times = played.filter(e => e.cat === cat).map(e => e.t);
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= GAP[cat] - 2, `${cat} throttled`);
  }

  await shut(page);
  const after = await page.evaluate(() => window.__xpAudioLog.length);
  await sleep(3000);
  assert.equal(await page.evaluate(() => window.__xpAudioLog.length), after, 'nothing after the sheet closes');
  assert.deepEqual(problems, []);
  await close();
});

test('sound: reduced motion keeps scenes quiet; lite has no key taps', async () => {
  for (const tier of ['reduced', 'lite']) {
    const { page, problems, close } = await open({ sound: true, reduced: tier === 'reduced', weak: tier === 'lite' });
    await page.keyboard.press('Shift');
    if (tier === 'lite') {
      await sleep(2800);
      await page.evaluate(() => { document.documentElement.dataset.motion = 'lite'; });
    }
    await follow(page, 'whatsapp');
    await sleep(12000);
    const log = await page.evaluate(() => window.__xpAudioLog.filter(e => !e.dropped));
    if (tier === 'reduced') assert.deepEqual(log, [], 'no ambient sound');
    else assert.equal(log.filter(e => e.cat === 'key').length, 0, 'no key taps in lite');
    assert.deepEqual(problems, []);
    await close();
  }
});


/* ---------------- the contact cards ---------------- */

async function toCards(page) {
  const top = await page.$eval('.person-card.support', n => n.getBoundingClientRect().top + scrollY - 200);
  for (let y = 0; y <= top; y += 300) { await page.evaluate(t => window.scrollTo(0, t), y); await sleep(40); }
  await page.evaluate(t => window.scrollTo(0, t), top);
  await page.evaluate(() => document.querySelector('.person-card.contact').scrollIntoView({ block: 'center' }));
  await sleep(400);
  await page.evaluate(() => document.querySelector('.person-card.support').scrollIntoView({ block: 'center' }));
}

test('contact cards: their extra life loads only on screen, calm, words unchanged', async () => {
  const { page, requests, problems, close } = await open();
  assert.equal(requests.filter(u => u.includes('/xp/cards.js')).length, 0, 'not in the first load');
  const words = await page.$eval('.chat__log', n => n.textContent);
  await toCards(page);
  await page.waitForFunction(() => document.querySelectorAll('.person__stage[data-alive]').length === 2, { timeout: 5000 });
  await sleep(9000);
  const state = await page.evaluate(() => ({
    layers: document.querySelectorAll('.person__stage .card-fx').length,
    signs: document.querySelectorAll('.card-fx .xp-amb').length,
    hidden: [...document.querySelectorAll('.card-fx')].every(n => n.getAttribute('aria-hidden') === 'true'),
    words: document.querySelector('.chat__log').textContent
  }));
  assert.equal(state.layers, 2);
  assert.ok(state.signs > 0 && state.signs <= 4, JSON.stringify(state));
  assert.equal(state.hidden, true);
  assert.equal(state.words, words, 'the conversation never changes');
  for (const button of ['.person-card.contact .person__actions a', '.person-card.support .person__actions a']) {
    await page.evaluate(sel => document.querySelector(sel).scrollIntoView({ block: 'center' }), button);
    assert.ok(await onTop(page, button), button);
  }
  assert.deepEqual(problems, []);
  await close();
});

test('contact cards: a soft ring as the finger lands on «اتصال» (sound on only)', async () => {
  const { page, problems, close } = await open({ sound: true });
  await toCards(page);
  await page.waitForFunction(() => document.querySelector('.ring[data-alive]'), { timeout: 5000 });
  await page.evaluate(() => document.querySelector('.person-card.contact .person__actions a').addEventListener('click', e => e.preventDefault()));
  await page.click('.person-card.contact .person__actions a');
  await sleep(200);
  const log = await page.evaluate(() => window.__xpAudioLog.map(e => e.cat));
  assert.ok(log.includes('ring'), JSON.stringify(log));
  assert.deepEqual(problems, []);
  await close();
});

test('contact cards: reduced motion loads nothing; lite has no moving extras', async () => {
  const reduced = await open({ reduced: true });
  await toCards(reduced.page);
  await sleep(1500);
  assert.equal(reduced.requests.filter(u => u.includes('/xp/cards.js')).length, 0);
  await reduced.close();

  const lite = await open({ weak: true });
  await sleep(2800);
  await toCards(lite.page);
  await sleep(4000);
  assert.equal(await lite.page.$$eval('.card-fx', n => n.length), 0);
  assert.deepEqual(lite.problems, []);
  await lite.close();
});
