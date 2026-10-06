// Final Polish, Agent B (browser): every experience opens its scene family,
// the pooled ambient engine (caps, recycling, hidden tabs, close, lite,
// reduced, never over the button or the close button), the «صوتك يهمنا»
// scene, the admin editors (person card, experiences + photos, banners)
// and the /admin/ gateway.
//
// Run: cd tools && node --test --test-concurrency=1 ../tests/polish-b.e2e.mjs

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';
import { createAdminServer } from '../tools/lib/admin-server.mjs';
import { createWorld } from './fakes/gas.mjs';
import { PLATFORMS, resolveExperience } from '../assets/js/platforms.js';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');
const sharp = require('sharp');

const PORT = 4425;
const ADMIN_PORT = 4426;
const BASE = `http://localhost:${PORT}/`;
const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };
const DESKTOP = { width: 1440, height: 900 };
const ADMIN = 'menazakmena@gmail.com';

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find(existsSync);

/* the scene family's root element, per registry scene */
const ROOTS = {
  voice: '.vo', facebook: '.fb', instagram: '.ig', tiktok: '.tt', whatsapp: '.wa', chat: '.ch', feed: '.fd',
  vertical: '.vt', stories: '.vt', player: '.pl', music: '.mu', map: '.mp', call: '.cl', mail: '.ml', browser: '.br'
};

let server;
let browser;
let content;
let body;

/* one link per registry key the demo doesn't have yet, a future key, a plain website,
   and YouTube / Spotify links known only by their URL (resolved like the publisher does) */
const EXTRA = [
  ...Object.keys(PLATFORMS).map(key => ({ key, url: `https://example.org/${key}` })),
  { key: 'future-app', url: 'https://new-app.example.com/us', title: 'تطبيق جديد' },
  { key: resolveExperience({ icon: 'link', url: 'https://www.youtube.com/@stathanasios' }), url: 'https://www.youtube.com/@stathanasios', id: 'by-url-youtube' },
  { key: resolveExperience({ icon: 'link', url: 'https://open.spotify.com/show/x' }), url: 'https://open.spotify.com/show/x', id: 'by-url-spotify' },
  { key: '', url: 'https://plain.example.org/', id: 'plain-site', title: 'موقع عادي' }
];

test.before(async () => {
  execFileSync(process.execPath, [`${ROOT}tools/demo.mjs`], { stdio: 'pipe' });
  content = JSON.parse(readFileSync(`${ROOT}tools/.cache/demo/content.json`, 'utf8'));
  for (const extra of EXTRA) {
    content.sections[0].links.push({
      id: extra.id || `x-${extra.key}`, title: extra.title || (PLATFORMS[extra.key] || {}).label || extra.key, subtitle: '', url: extra.url,
      icon: extra.id && extra.id.startsWith('by-url') ? 'link' : 'star', style: 'card', badge: '', startAt: '', endAt: '', ...(extra.key ? { experience: extra.key } : {})
    });
  }
  body = JSON.stringify(content);
  server = spawn(process.execPath, [`${ROOT}tools/serve.mjs`, String(PORT), '--demo'], { stdio: 'pipe' });
  await new Promise(resolve => server.stdout.once('data', resolve));
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
});

test.after(async () => {
  await browser?.close();
  server?.kill();
  if (adminServer) await new Promise(resolve => adminServer.close(resolve));
});

async function open({ viewport = PHONE, reduced = false, intercept = true } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', message => { if (message.type() === 'error') problems.push(message.text()); });
  if (intercept) {
    await page.setRequestInterception(true);
    page.on('request', request => (request.url().includes('content.json')
      ? request.respond({ status: 200, contentType: 'application/json', body })
      : request.continue()));
  }
  await page.setViewport(viewport);
  if (reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#main[data-state="ready"]');
  return { page, problems, close: () => context.close() };
}

const linkOf = key => [...content.featured, ...content.sections.flatMap(s => s.links)].find(l => l.experience === key);

async function follow(page, id) {
  await page.evaluate(target => { location.hash = `#follow/${target}`; }, id);
  await page.waitForSelector('dialog.sheet--xp[open] .xp-stage');
}

async function shut(page) {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog.sheet'));
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/* is the point at the element's centre on the element itself? */
const uncovered = (page, selector) => page.evaluate(sel => {
  const node = document.querySelector(sel);
  const box = node.getBoundingClientRect();
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return !!hit && (hit === node || node.contains(hit));
}, selector);


/* ---------------- every key opens its family ---------------- */

for (const viewport of [PHONE, DESKTOP]) {

  test(`every registry key opens its scene family (${viewport === PHONE ? 'phone' : 'desktop'})`, async () => {
    const { page, problems, close } = await open({ viewport });
    for (const [key, platform] of Object.entries(PLATFORMS)) {
      const link = linkOf(key);
      await follow(page, link.id);
      await page.waitForSelector(`dialog.sheet--xp[open] .xp-stage[data-platform="${key}"] ${ROOTS[platform.scene]}`, { timeout: 5000 });
      const cta = await page.$eval('dialog.sheet--xp[open] .xp__cta', a => ({ href: a.href, text: a.textContent.trim(), target: a.target, rel: a.rel }));
      assert.equal(cta.href, link.url, key);
      assert.equal(cta.target, '_blank');
      assert.match(cta.rel, /noopener/);
      const expected = key === 'voice' ? platform.cta : key === 'whatsapp' && !/chat\.whatsapp\.com/.test(link.url) ? 'افتح واتساب' : link.cta || platform.cta;
      assert.equal(cta.text, expected, key);
      await sleep(400);
      await shut(page);
    }
    assert.deepEqual(problems, []);
    await close();
  });

}

test('an unknown (future) key: the generic scene with the link\'s title and domain', async () => {
  const { page, problems, close } = await open();
  await follow(page, 'x-future-app');
  await page.waitForSelector('dialog.sheet--xp[open] .br');
  const shown = await page.evaluate(() => ({
    title: document.querySelector('.br-title').textContent,
    domain: document.querySelector('.br-domain').textContent,
    address: document.querySelector('.br-address').textContent,
    cta: document.querySelector('.xp__cta').textContent.trim()
  }));
  assert.equal(shown.title, 'تطبيق جديد');
  assert.equal(shown.domain, 'new-app.example.com');
  assert.match(shown.address, /new-app\.example\.com/);
  assert.equal(shown.cta, PLATFORMS.web.cta);
  assert.deepEqual(problems, []);
  await close();
});

test('a plain website opens directly; Telegram (icon), YouTube and Spotify (URL) open their scenes', async () => {
  const { page, problems, close } = await open();
  const plain = await page.$eval('a[href="https://plain.example.org/"]', a => ({ experience: a.dataset.experience || '', target: a.target }));
  assert.deepEqual(plain, { experience: '', target: '_blank' }, 'no scene for a plain website');

  // the demo's Telegram link only has the icon (the publisher resolved it)
  const telegram = content.sections[0].links.find(l => l.icon === 'telegram');
  assert.equal(telegram.experience, 'telegram');
  await follow(page, telegram.id);
  await page.waitForSelector('dialog.sheet--xp[open] .ch.ch--channel');
  await shut(page);

  for (const [id, root] of [['by-url-youtube', '.pl'], ['by-url-spotify', '.mu']]) {
    await follow(page, id);
    await page.waitForSelector(`dialog.sheet--xp[open] ${root}`);
    await shut(page);
  }
  assert.deepEqual(problems, []);
  await close();
});


/* ---------------- the ambient engine ---------------- */

test('ambient: capped, recycled, edge activity, never over the button or the close button', async () => {
  const { page, problems, close } = await open();
  await follow(page, linkOf('facebook').id);
  await page.waitForSelector('.fb');
  const samples = [];
  for (let i = 0; i < 10; i++) {
    await sleep(1000);
    samples.push(await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('.xp-stage .xp-amb[data-amb]')];
      const groups = {};
      nodes.forEach(n => { (groups[n.dataset.amb] = groups[n.dataset.amb] || { n: 0, cap: Number(n.dataset.cap) }).n += 1; });
      return { total: nodes.length, groups, uses: nodes.reduce((s, n) => s + Number(n.dataset.uses), 0), maxUses: Math.max(0, ...nodes.map(n => Number(n.dataset.uses))) };
    }));
    assert.ok(await uncovered(page, 'dialog.sheet--xp[open] .xp__cta'), `the button is never covered (${i + 1}s)`);
    assert.ok(await uncovered(page, 'dialog.sheet--xp[open] .sheet__close'), `the close button is never covered (${i + 1}s)`);
  }
  for (const sample of samples) {
    for (const [name, group] of Object.entries(sample.groups)) assert.ok(group.n <= group.cap, `${name}: ${group.n} > cap ${group.cap}`);
  }
  const last = samples.at(-1);
  assert.ok(last.uses > samples[3].uses, 'activity keeps going after the entrance');
  assert.ok(last.maxUses > 1, 'nodes are recycled');
  assert.ok(last.total <= samples[5].total + 2, `no growth: ${samples.map(s => s.total).join(', ')}`);
  assert.ok(last.groups.edge && last.groups.edge.n > 0, 'the edge layer is active (full tier)');
  assert.deepEqual(problems, []);
  await close();
});

test('ambient: pauses while the tab is hidden, and nothing runs after the sheet closes', async () => {
  const { page, problems, close } = await open();
  await follow(page, linkOf('tiktok').id);
  await page.waitForSelector('.tt');
  await sleep(3500);

  const uses = () => page.evaluate(() => [...document.querySelectorAll('.xp-stage .xp-amb')].reduce((s, n) => s + Number(n.dataset.uses), 0));
  const runningScripted = () => page.evaluate(() => document.getAnimations()
    .filter(a => !(a instanceof CSSAnimation) && !(a instanceof CSSTransition) && a.playState === 'running' && a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.xp-stage')).length);

  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await sleep(200);
  const before = await uses();
  assert.equal(await runningScripted(), 0, 'every scene animation is paused');
  await sleep(2500);
  assert.equal(await uses(), before, 'nothing new spawns while hidden');

  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await sleep(2500);
  assert.ok(await uses() > before, 'it comes back when the tab does');

  // keep a pooled node to watch it after the close
  await page.evaluate(() => { window.__kept = document.querySelector('.xp-stage .xp-amb'); window.__keptUses = window.__kept.dataset.uses; });
  await shut(page);
  await sleep(2500);
  const after = await page.evaluate(() => ({
    connected: window.__kept.isConnected,
    uses: window.__kept.dataset.uses === window.__keptUses,
    animations: window.__kept.getAnimations().length,
    stages: document.querySelectorAll('.xp-stage, .xp-amb').length
  }));
  assert.deepEqual(after, { connected: false, uses: true, animations: 0, stages: 0 });
  assert.deepEqual(problems, []);
  await close();
});

test('ambient: the lite tier has no edge layer and fewer nodes', async () => {
  const { page, problems, close } = await open();
  await sleep(2800);   // feel.js decides the tier in the first 2.5 s
  await page.evaluate(() => { document.documentElement.dataset.motion = 'lite'; });
  await follow(page, linkOf('instagram').id);
  await page.waitForSelector('.ig');
  await sleep(6000);
  const lite = await page.evaluate(() => ({
    edge: document.querySelectorAll('.xp-edge .xp-amb').length,
    caps: [...document.querySelectorAll('.xp-stage .xp-amb[data-cap]')].map(n => [n.dataset.amb, Number(n.dataset.cap)])
  }));
  assert.equal(lite.edge, 0);
  assert.ok(lite.caps.length > 0, 'still alive');
  assert.ok(lite.caps.every(([name, cap]) => name !== 'ig-heart' || cap <= 3), JSON.stringify(lite.caps));
  assert.deepEqual(problems, []);
  await close();
});

test('reduced motion: the final frame of every family, nothing moving', async () => {
  const { page, problems, close } = await open({ reduced: true });
  for (const key of ['telegram', 'x', 'snapchat', 'youtube', 'spotify', 'maps', 'web', 'facebook']) {
    await follow(page, linkOf(key).id);
    await page.waitForSelector(`dialog.sheet--xp[open] ${ROOTS[PLATFORMS[key].scene]}`);
    await sleep(1200);
    const state = await page.evaluate(() => ({
      pending: document.querySelector('.xp').classList.contains('cta-pending'),
      moving: document.getAnimations().filter(a => a.playState === 'running' && a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.xp-stage')).length,
      ambient: document.querySelectorAll('.xp-stage .xp-amb').length
    }));
    assert.deepEqual(state, { pending: false, moving: 0, ambient: 0 }, key);
    await shut(page);
  }
  assert.deepEqual(problems, []);
  await close();
});


/* ---------------- «صوتك يهمنا» ---------------- */

test('voice: #follow/<featured link> opens the voice scene; «ابعت صوتك» goes to the link; quick later', async () => {
  const { page, problems, close } = await open();
  const voice = content.featured.find(l => l.experience === 'voice');
  assert.ok(voice, 'the featured link resolves to the voice scene');
  await follow(page, voice.id);
  await page.waitForSelector('dialog.sheet--xp[open] .vo .vo-intro.is-on');
  const cta = await page.$eval('.xp__cta', a => ({ text: a.textContent.trim(), href: a.href, target: a.target }));
  assert.deepEqual(cta, { text: 'ابعت صوتك', href: voice.url, target: '_blank' });
  assert.equal(await page.$eval('.xp', n => n.classList.contains('cta-pending')), true);
  await page.waitForFunction(() => !document.querySelector('.xp').classList.contains('cta-pending'), { timeout: 1300 });

  // the loop goes on: hook, then the options with the dock and the counter
  await page.waitForSelector('.vo-hook.is-on', { timeout: 5000 });
  await page.waitForSelector('.vo-opt.is-on .vo-count', { timeout: 6000 });
  await page.waitForFunction(() => document.querySelector('.vo-pdot.is-active') && /١ من ٧/.test(document.querySelector('.vo-count').textContent), { timeout: 3000 });
  assert.ok(await uncovered(page, '.xp__cta'));
  await shut(page);

  // later visits: the button at once
  await follow(page, voice.id);
  await page.waitForSelector('.vo');
  assert.equal(await page.$eval('.xp', n => n.classList.contains('cta-pending') || n.classList.contains('is-first')), false);
  await shut(page);
  assert.deepEqual(problems, []);
  await close();
});

test('voice on a wide screen: the 16:9 canvas and a calm side layer behind the sheet', async () => {
  const { page, problems, close } = await open({ viewport: DESKTOP });
  await follow(page, content.featured.find(l => l.experience === 'voice').id);
  await page.waitForSelector('.vo');
  const ratio = await page.$eval('.vo', n => n.clientWidth / n.clientHeight);
  assert.ok(Math.abs(ratio - 16 / 9) < 0.05, `16:9 (${ratio.toFixed(2)})`);
  for (let i = 0; i < 8; i++) {
    await sleep(1000);
    assert.ok(await uncovered(page, '.xp__cta'), 'the side layer never covers the button');
    assert.ok(await uncovered(page, '.sheet__close'), 'nor the close button');
  }
  const side = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.vo-side .xp-amb')];
    return { count: items.length, cap: items.length ? Number(items[0].dataset.cap) : 0, behind: getComputedStyle(document.querySelector('.vo-side')).zIndex };
  });
  assert.ok(side.count > 0 && side.count <= side.cap, JSON.stringify(side));
  assert.equal(side.behind, '-1');
  await shut(page);
  assert.equal(await page.$('.vo-side'), null, 'gone with the sheet');
  assert.deepEqual(problems, []);
  await close();
});

test('voice, reduced motion: the still frame (medallion, headline, dock), nothing moving', async () => {
  const { page, problems, close } = await open({ reduced: true });
  await follow(page, content.featured.find(l => l.experience === 'voice').id);
  await page.waitForSelector('.vo.vo--still .vo-intro.is-on');
  await sleep(1500);
  const state = await page.evaluate(() => ({
    pending: document.querySelector('.xp').classList.contains('cta-pending'),
    title: document.querySelector('.vo-intro__title').textContent.trim(),
    dock: getComputedStyle(document.querySelector('.vo-dock')).opacity,
    moving: document.getAnimations().filter(a => a.playState === 'running' && a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.xp-stage')).length
  }));
  assert.deepEqual(state, { pending: false, title: 'صوتك يهمنا', dock: '1', moving: 0 });
  assert.deepEqual(problems, []);
  await close();
});


/* ---------------- admin ---------------- */

let adminServer = null;

async function adminPage(world, viewport = DESKTOP) {
  // a test that failed early may have left the previous one listening
  if (adminServer) await new Promise(resolve => adminServer.close(resolve));
  const server = adminServer = createAdminServer({ world, admin: ADMIN, latency: 20 });
  await new Promise(resolve => server.listen(ADMIN_PORT, '127.0.0.1', resolve));
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(String(error.stack || error.message).split('\n').slice(0, 3).join(' | ')));
  page.on('dialog', async dialog => { problems.push(`native ${dialog.type()}`); await dialog.dismiss(); });
  await page.setViewport(viewport);
  await page.goto(`http://localhost:${ADMIN_PORT}/`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.A && A.state);
  return { page, problems, close: async () => { await context.close(); if (adminServer === server) adminServer = null; await new Promise(resolve => server.close(resolve)); } };
}

async function adminWorld() {
  const world = createWorld();
  const gs = world.as(ADMIN).gs;
  gs.setup();
  const ids = [];
  for (const color of ['#0e3560', '#7a3b1d', '#1d5c3a']) {
    const buf = await sharp({ create: { width: 300, height: 300, channels: 3, background: color } }).webp().toBuffer();
    ids.push(gs.apiUploadMedia({ full: buf.toString('base64'), thumb: buf.toString('base64'), mime: 'image/webp', width: 300, height: 300, alt: 'صورة ' + color }).media.id);
  }
  return { world, gs, ids };
}

const pickFromLibrary = async (page, index) => {
  await page.waitForSelector('dialog.picker-dialog[open] .media-tile');
  await page.evaluate(i => document.querySelectorAll('dialog.picker-dialog[open] .media-tile')[i].click(), index);
  await page.waitForFunction(() => !document.querySelector('dialog.picker-dialog'));
};

const saveSheet = async page => {
  await page.evaluate(() => document.querySelector('dialog.sheet[open] .sheet__foot .btn--primary').click());
  await page.waitForFunction(() => !document.querySelector('dialog.sheet').open);
};

test('admin: the contact editor saves a photo, «جملة البداية» and «الرد»', async () => {
  const { world, ids } = await adminWorld();
  const { page, problems, close } = await adminPage(world);
  await page.evaluate(() => A.go('page', 'contacts'));
  await page.evaluate(() => A.editContact(A.state.draft.contacts.find(c => c.kind === 'support')));
  await page.waitForSelector('dialog.sheet[open] .picker--avatar');
  const placeholders = await page.evaluate(() => ['جملة البداية', 'الرد'].map(label => document.querySelector(`dialog.sheet[open] .field[data-label="${label}"] input, dialog.sheet[open] .field[data-label="${label}"] textarea`).placeholder));
  assert.deepEqual(placeholders, ['معايا مشكلة', 'أهلاً بيك 👋 ابعتلي المشكلة وأنا هساعدك.']);

  await page.evaluate(() => [...document.querySelectorAll('dialog.sheet[open] .picker--avatar button')].find(b => b.textContent.includes('من المكتبة')).click());
  await pickFromLibrary(page, 0);
  await page.evaluate(() => {
    const field = label => document.querySelector(`dialog.sheet[open] .field[data-label="${label}"] input, dialog.sheet[open] .field[data-label="${label}"] textarea`);
    field('جملة البداية').value = 'عندي مشكلة في الموقع';
    field('الرد').value = 'أهلاً! ابعتلي التفاصيل.';
  });
  await saveSheet(page);
  const row = world.gs.readTable_('Contacts').find(c => c.kind === 'support');
  assert.ok(ids.includes(row.image), row.image);
  assert.equal(row.intro, 'عندي مشكلة في الموقع');
  assert.equal(row.reply, 'أهلاً! ابعتلي التفاصيل.');

  // a service card: no reply field, its own placeholder
  await page.evaluate(() => A.editContact(A.state.draft.contacts.find(c => c.kind === 'service')));
  await page.waitForSelector('dialog.sheet[open] .picker--avatar');
  const service = await page.evaluate(() => ({
    reply: document.querySelector('dialog.sheet[open] .field[data-label="الرد"]').hidden,
    intro: document.querySelector('dialog.sheet[open] .field[data-label="جملة البداية"] input').placeholder
  }));
  assert.deepEqual(service, { reply: true, intro: 'عندك سؤال أو محتاج تتكلم؟' });
  assert.deepEqual(problems, []);
  await close();
});

test('admin: the link editor lists the registry, says what «تلقائي» opens, and saves scene photos', async () => {
  const { world, ids } = await adminWorld();
  const { page, problems, close } = await adminPage(world);
  await page.evaluate(() => A.go('page', 'links'));
  await page.evaluate(() => A.editLink(null));
  await page.waitForSelector('dialog.sheet[open] .experience-said');

  const options = await page.$$eval('dialog.sheet[open] .field[data-label="التجربة قبل اللينك"] option', list => list.map(o => o.value));
  for (const key of ['', 'none', 'web', ...Object.keys(PLATFORMS)]) assert.ok(options.includes(key), `choice ${key || 'auto'}`);
  assert.ok(await page.$('dialog.sheet[open] optgroup[label="رسايل وجروبات"]'), 'grouped');

  const said = () => page.$eval('dialog.sheet[open] .experience-said', n => n.textContent);
  const galleryHidden = () => page.$eval('dialog.sheet[open] .gallery-picker', n => n.hidden);
  // a plain website: direct, no photos field
  await page.type('dialog.sheet[open] input[type=url]', 'https://forms.gle/abc');
  assert.match(await said(), /هيفتح على طول/);
  assert.equal(await galleryHidden(), true);
  // the Telegram icon: auto = Telegram
  await page.evaluate(() => document.querySelector('dialog.sheet[open] input[name=icon][value=telegram]').click());
  assert.match(await said(), /تيليجرام.*من الأيقونة/);
  assert.equal(await galleryHidden(), false);
  // a YouTube URL with the plain link icon: auto = YouTube, from the link
  await page.evaluate(() => {
    document.querySelector('dialog.sheet[open] input[name=icon][value=link]').click();
    const url = document.querySelector('dialog.sheet[open] input[type=url]');
    url.value = 'https://youtu.be/abc';
    url.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.match(await said(), /يوتيوب.*من اللينك/);

  // photos from the library (in order), then save
  for (const index of [1, 0]) {
    await page.evaluate(() => [...document.querySelectorAll('dialog.sheet[open] .gallery-picker button')].find(b => b.textContent.includes('زوّد')).click());
    await pickFromLibrary(page, index);
  }
  assert.equal(await page.$$eval('dialog.sheet[open] .gallery-picker__item', n => n.length), 2);
  await page.type('dialog.sheet[open] .field[data-label="العنوان"] input', 'قناة يوتيوب');
  await saveSheet(page);
  const saved = world.gs.readTable_('Links').find(l => l.title === 'قناة يوتيوب');
  assert.equal(saved.experience, '');
  assert.equal(saved.gallery.split(',').length, 2);
  assert.ok(saved.gallery.split(',').every(id => ids.includes(id)));

  // the list says which scene each link opens
  await page.waitForFunction(() => [...document.querySelectorAll('.chip')].some(c => c.textContent === 'مشهد: يوتيوب'));
  assert.deepEqual(problems, []);
  await close();
});

test('admin: the banner picker is there for every kind of section', async () => {
  const { world } = await adminWorld();
  const { page, problems, close } = await adminPage(world);
  await page.evaluate(() => A.go('page', 'layout'));
  const kinds = await page.evaluate(() => [...new Set(A.state.layout.map(s => s.kind))]);
  for (const kind of ['featured', 'location', 'contacts', 'support', 'share', 'meeting', 'links', 'news', 'games', 'items']) {
    assert.ok(kinds.includes(kind), `the layout has a ${kind} section`);
    const section = await page.evaluate(k => A.state.layout.find(s => s.kind === k).key, kind);
    await page.evaluate(key => A.editSection(A.state.layout.find(s => s.key === key)), section);
    await page.waitForSelector('dialog.sheet[open] .picker');
    const field = await page.evaluate(() => {
      const label = [...document.querySelectorAll('dialog.sheet[open] .field__label')].find(n => n.textContent === 'بانر القسم (اختياري)');
      return label ? label.parentNode.querySelector(':scope > .field__hint').textContent : null;
    });
    assert.match(field || '', /^بيظهر فوق/, `${kind}: banner picker with its hint`);
    if (kind === 'support') {
      await page.evaluate(() => [...document.querySelectorAll('dialog.sheet[open] .picker button')].find(b => b.textContent.includes('من المكتبة')).click());
      await pickFromLibrary(page, 0);
      await saveSheet(page);
      assert.match(world.gs.readTable_('Sections').find(s => s.key === section).banner, /^img-/);
    }
    else {
      await page.evaluate(() => document.getElementById('sheet').close());
    }
  }
  assert.deepEqual(problems, []);
  await close();
});


/* ---------------- /admin/ gateway ---------------- */

async function gateway({ viewport = PHONE, reduced = false } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];
  const outside = [];
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', message => { if (/Content Security Policy|Refused/.test(message.text())) problems.push(message.text()); });
  await page.setRequestInterception(true);
  let goneAt = 0;
  page.on('request', request => {
    if (request.url().startsWith('https://script.google.com/')) {
      if (request.isNavigationRequest()) outside.push(request.url());
      goneAt = goneAt || Date.now();
      request.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><title>admin stand-in</title>' });
      return;
    }
    request.continue();
  });
  await page.setViewport(viewport);
  if (reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const start = Date.now();
  await page.goto(`${BASE}admin/`, { waitUntil: 'domcontentloaded' });
  return { page, problems, outside, start, goneAt: () => goneAt, close: () => context.close() };
}

test('/admin/: branded page, then the admin in the same tab (no real Google request)', async () => {
  const html = readFileSync(`${ROOT}admin/index.html`, 'utf8');
  const target = /id="enter" href="([^"]+)"/.exec(html)[1];

  const { page, problems, outside, start, goneAt, close } = await gateway();
  const shown = await page.evaluate(() => ({
    depth: history.length,
    title: document.querySelector('.gate__title').textContent,
    robots: document.querySelector('meta[name=robots]').content,
    referrer: document.querySelector('meta[name=referrer]').content,
    csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]').content,
    button: document.getElementById('enter').textContent.trim()
  }));
  assert.equal(shown.title, 'لوحة التحكم');
  assert.equal(shown.robots, 'noindex, nofollow');
  assert.equal(shown.referrer, 'no-referrer');
  assert.match(shown.csp, /default-src 'none'; script-src 'self'; style-src 'self'/);
  assert.equal(shown.button, 'ادخل لوحة التحكم');
  await page.waitForFunction(() => document.title === 'admin stand-in', { timeout: 4000 });
  assert.deepEqual(outside, [target], 'straight to the admin URL');
  const after = goneAt() - start;
  assert.ok(after > 500 && after < 2000, `after the short entry (${after} ms)`);
  assert.equal(await page.evaluate(() => history.length), shown.depth, 'replaced: no back step to the door');
  assert.deepEqual(problems, []);
  await close();

  // reduced motion: at once
  const still = await gateway({ reduced: true, viewport: DESKTOP });
  await still.page.waitForFunction(() => document.title === 'admin stand-in', { timeout: 4000 });
  assert.ok(still.goneAt() - still.start < 500, `at once (${still.goneAt() - still.start} ms)`);
  assert.deepEqual(still.problems, []);
  await still.close();
});

test('/admin/ without JavaScript: the button is there and the page moves on by itself', async () => {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setJavaScriptEnabled(false);
  const outside = [];
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (request.url().startsWith('https://script.google.com/')) {
      if (request.isNavigationRequest()) outside.push(request.url());
      request.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><title>admin stand-in</title>' });
      return;
    }
    request.continue();
  });
  await page.goto(`${BASE}admin/`, { waitUntil: 'domcontentloaded' });
  // (no page script runs: the markup alone; the button's href: polish-b.test.mjs)
  for (let i = 0; i < 50 && !outside.length; i++) await sleep(100);
  assert.equal(outside.length, 1, 'the no-JS refresh goes there by itself');
  await context.close();
});
