// Final polish A, in headless Chrome against the demo content
// (tools/demo.mjs, built through the real admin code):
//   - the top bar: a continuous change while scrolling, no layout shift,
//     dialogs above it, its buttons still work (also without
//     scroll-driven animations)
//   - the service / support pair: equal on desktop, stacked on a phone,
//     the same links, the chat reaching its final frame, defaults
//   - the poster hero in sheets: its own ratio, never cropped, capped,
//     sharp, the surround per motion tier, the zoom viewer by keyboard
//   - section banners: one on every section (demo --banners), none without
//   - reduced motion and the lite tier: nothing hidden, nothing looping
//
// Run: cd tools && node --test --test-concurrency=1 ../tests/polish-a.e2e.mjs

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');

const PORT = 4412;
const BASE = `http://localhost:${PORT}/`;
const DEMO = `${ROOT}tools/.cache/demo/`;

const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESKTOP = { width: 1366, height: 900, deviceScaleFactor: 1 };

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find(existsSync);

let server;
let browser;
let content;
let bannerFiles;

/* every published file of a demo build, path → bytes */
function readDemo() {
  const files = new Map();
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const full = `${dir}${name}`;
      if (statSync(full).isDirectory()) walk(`${full}/`);
      else files.set(`/${full.slice(DEMO.length)}`, readFileSync(full));
    }
  };
  walk(DEMO);
  return files;
}

test.before(async () => {
  // the banner build first (kept in memory), then the default one (served)
  execFileSync(process.execPath, [`${ROOT}tools/demo.mjs`, '--banners'], { stdio: 'pipe' });
  bannerFiles = readDemo();
  execFileSync(process.execPath, [`${ROOT}tools/demo.mjs`], { stdio: 'pipe' });
  content = JSON.parse(readFileSync(`${DEMO}content.json`, 'utf8'));
  server = spawn(process.execPath, [`${ROOT}tools/serve.mjs`, String(PORT), '--demo'], { stdio: 'pipe' });
  await new Promise(resolve => server.stdout.once('data', resolve));
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
});

test.after(async () => {
  await browser?.close();
  server?.kill();
});

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function open({ viewport = PHONE, reduced = false, weak = false, hash = '', files = null, json = null, before = null } = {}) {

  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', msg => { if (msg.type() === 'error') problems.push(msg.text()); });
  await page.evaluateOnNewDocument(() => {
    document.addEventListener('securitypolicyviolation', e => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`));
  });
  if (weak) {
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 2 });
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 1 });
    });
  }
  if (before) await page.evaluateOnNewDocument(before);
  if (reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.setViewport(viewport);

  if (files || json) {
    await page.setRequestInterception(true);
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (json && path === '/content.json') {
        request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(json) });
      }
      else if (files && files.has(path)) {
        request.respond({ status: 200, contentType: path.endsWith('.json') ? 'application/json' : 'image/webp', body: files.get(path) });
      }
      else request.continue();
    });
  }

  await page.goto(BASE + hash, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#main[data-state="ready"]');

  return { page, problems, close: () => context.close() };

}

/* scroll in steps (scroll-driven animations and observers follow a thumb, not a jump) */
async function scrollTo(page, target, step = 120) {
  const from = await page.evaluate(() => scrollY);
  const dir = Math.sign(target - from) || 1;
  for (let y = from; dir > 0 ? y < target : y > target; y += step * dir) {
    await page.evaluate(top => window.scrollTo(0, top), y);
    await wait(30);
  }
  await page.evaluate(top => window.scrollTo(0, top), target);
  await wait(250);
}

const barState = page => page.evaluate(() => {
  const bar = document.getElementById('topbar');
  const r = bar.getBoundingClientRect();
  return {
    surface: Number(getComputedStyle(bar, '::before').opacity),
    line: getComputedStyle(bar, '::after').transform,
    brand: Number(getComputedStyle(bar.querySelector('.topbar__brand')).opacity),
    top: Math.round(r.top),
    height: Math.round(r.height),
    width: Math.round(r.width)
  };
});

const scaleX = matrix => (matrix === 'none' ? 1 : Number(matrix.match(/matrix\(([^,]+)/)[1]));


/* ---------------- top bar ---------------- */

for (const [name, viewport] of Object.entries({ phone: PHONE, desktop: DESKTOP })) {

  test(`${name}: the top bar changes continuously, with no layout shift`, async () => {

    const { page, problems, close } = await open({ viewport });

    await page.evaluate(() => {
      window.__shift = 0;
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__shift += entry.value;
      }).observe({ type: 'layout-shift' });
    });

    const mainTop = () => page.evaluate(() => Math.round(document.getElementById('main').getBoundingClientRect().top + scrollY));
    const mainBefore = await mainTop();

    const top = await barState(page);
    assert.ok(top.surface < 0.05, `no surface at the very top (${top.surface})`);
    assert.ok(top.brand < 0.05, `no compact name at the top (${top.brand})`);
    assert.ok(scaleX(top.line) < 0.05, 'the hairline is not drawn yet');
    // full-bleed: the whole layout width (refine A keeps a stable scrollbar
    // gutter on mouse screens, so that is the viewport minus the gutter)
    assert.equal(top.width, await page.evaluate(() => document.documentElement.clientWidth), 'full-bleed');

    // part way: in between (continuous, not a switch)
    await scrollTo(page, 60);
    const mid = await barState(page);
    assert.ok(mid.surface > 0.2 && mid.surface < 0.8, `half a surface at 60px (${mid.surface})`);

    await scrollTo(page, 900);
    const scrolled = await barState(page);
    assert.ok(scrolled.surface > 0.95, `the surface is there (${scrolled.surface})`);
    assert.ok(scrolled.brand > 0.95, `the compact name is there (${scrolled.brand})`);
    assert.ok(scaleX(scrolled.line) > 0.95, 'the hairline is drawn');
    assert.equal(scrolled.top, 0, 'sticky at the top');
    assert.equal(scrolled.height, top.height, 'the bar never changes height');
    assert.equal(await page.$eval('#topbar', bar => bar.classList.contains('is-compact')), true);

    // the page under it did not move, nothing shifted
    assert.equal(await mainTop(), mainBefore);
    assert.ok(await page.evaluate(() => window.__shift) < 0.001, `layout shift ${await page.evaluate(() => window.__shift)}`);

    // the bar's content lines up with the page's widgets
    const edges = await page.evaluate(() => {
      const inner = document.querySelector('.topbar__inner').getBoundingClientRect();
      const brand = document.querySelector('.topbar__brand img').getBoundingClientRect();
      const bell = document.getElementById('bell').getBoundingClientRect();
      // a widget that spans the whole page width
      const widget = document.querySelector('#main > [data-wide]:not([data-area="hero"])').getBoundingClientRect();
      return { brandRight: Math.round(brand.right), bellLeft: Math.round(bell.left), widgetRight: Math.round(widget.right), widgetLeft: Math.round(widget.left), inner: Math.round(inner.width) };
    });
    assert.ok(Math.abs(edges.brandRight - edges.widgetRight) <= 2, `logo aligned with the widgets (${edges.brandRight} / ${edges.widgetRight})`);
    assert.ok(Math.abs(edges.bellLeft - edges.widgetLeft) <= 2, `buttons aligned with the widgets (${edges.bellLeft} / ${edges.widgetLeft})`);

    // back to the top: the end state again
    await scrollTo(page, 0, 300);
    const back = await barState(page);
    assert.ok(back.surface < 0.05 && back.brand < 0.05);

    assert.deepEqual(problems, []);
    await close();

  });

}

test('top bar: dialogs sit above it; the bell and the sound button still work', async () => {

  const { page, problems, close } = await open();
  await scrollTo(page, 700);

  await page.click('#bell');
  await page.waitForSelector('dialog.sheet[open]');
  await wait(700);
  // what is on top where the bar is: the sheet's backdrop / dialog, not the bar
  const onTop = await page.evaluate(() => {
    const bar = document.getElementById('bell').getBoundingClientRect();
    const el = document.elementFromPoint(bar.left + bar.width / 2, bar.top + bar.height / 2);
    // (the sheet's ::backdrop covers it: no element at all, or the dialog)
    return el && el.closest('#topbar') ? 'topbar' : String(el && el.tagName);
  });
  assert.notEqual(onTop, 'topbar');
  assert.equal(await page.evaluate(() => location.hash), '#notifications');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog.sheet'));

  assert.equal(await page.$eval('#sound-toggle', b => b.getAttribute('aria-pressed')), 'false');
  await page.click('#sound-toggle');
  assert.equal(await page.$eval('#sound-toggle', b => b.getAttribute('aria-pressed')), 'true');
  assert.match(await page.$eval('#sound-toggle', b => b.getAttribute('aria-label')), /شغالة/);

  // touch targets
  const sizes = await page.$$eval('.topbar__btn', els => els.map(e => Math.min(e.offsetWidth, e.offsetHeight)));
  assert.ok(sizes.every(s => s >= 44), sizes.join(','));

  assert.deepEqual(problems, []);
  await close();

});

test('top bar without scroll-driven animations: the script drives it', async () => {

  const { page, problems, close } = await open({
    before: () => {
      const real = CSS.supports.bind(CSS);
      CSS.supports = (...args) => (String(args.join(':')).includes('animation-timeline') ? false : real(...args));
    }
  });

  await scrollTo(page, 40);
  const mid = await page.$eval('#topbar', bar => Number(bar.style.getPropertyValue('--p')));
  assert.ok(mid > 0.2 && mid < 0.5, `--p follows the scroll (${mid})`);
  await scrollTo(page, 900);
  const end = await page.$eval('#topbar', bar => ({ p: bar.style.getPropertyValue('--p'), pb: bar.style.getPropertyValue('--pb') }));
  assert.deepEqual(end, { p: '1.000', pb: '1.000' });

  assert.deepEqual(problems, []);
  await close();

});


/* ---------------- the two people ---------------- */

const service = () => content.contacts.find(c => c.kind === 'service');
const support = () => content.contacts.find(c => c.kind === 'support');

async function showContacts(page) {
  await page.$eval('.support', el => el.scrollIntoView({ block: 'center' }));
  await wait(400);
  // scroll a little to let the reveal and the observers run like a thumb would
  await page.evaluate(() => window.scrollBy(0, 1));
}

test('desktop: service and support are a matched pair of equal height', async () => {

  const { page, problems, close } = await open({ viewport: DESKTOP });
  await showContacts(page);
  await wait(1200);

  const boxes = await page.evaluate(() => [...document.querySelectorAll('.person-card')].map(card => {
    const r = card.getBoundingClientRect();
    const stage = card.querySelector('.person__stage').getBoundingClientRect();
    const action = card.querySelector('.person__actions').getBoundingClientRect();
    return { top: Math.round(r.top), height: Math.round(r.height), width: Math.round(r.width), stageTop: Math.round(stage.top), stage: Math.round(stage.height), actionBottom: Math.round(action.bottom) };
  }));

  assert.equal(boxes.length, 2);
  const [a, b] = boxes;
  assert.equal(a.top, b.top, 'side by side');
  assert.ok(Math.abs(a.height - b.height) <= 1, `equal heights ${a.height} / ${b.height}`);
  assert.ok(Math.abs(a.width - b.width) <= 1, `half and half ${a.width} / ${b.width}`);
  assert.ok(Math.abs(a.stageTop - b.stageTop) <= 1 && Math.abs(a.stage - b.stage) <= 1, 'the stages line up');
  assert.ok(Math.abs(a.actionBottom - b.actionBottom) <= 1, 'the actions line up at the bottom');

  assert.deepEqual(problems, []);
  await close();

});

test('phone: the pair stacks; links unchanged; the chat plays (and loops); the avatar shows', async () => {

  const { page, problems, close } = await open();

  const layout = await page.evaluate(() => {
    const [a, b] = [...document.querySelectorAll('.person-card')].map(c => c.getBoundingClientRect());
    return { stacked: b.top >= a.bottom, sameWidth: Math.abs(a.width - b.width) < 1 };
  });
  assert.deepEqual(layout, { stacked: true, sameWidth: true });

  // the actions: the same tel: / wa.me links as before, one tap each
  const links = await page.evaluate(() => ({
    call: document.querySelector('.contact .btn--call').getAttribute('href'),
    whatsapp: document.querySelector('.support .btn--whatsapp').getAttribute('href'),
    target: document.querySelector('.support .btn--whatsapp').getAttribute('target'),
    number: document.querySelector('.contact .btn--call .phone-number').textContent
  }));
  assert.deepEqual(links, { call: service().action.href, whatsapp: support().action.href, target: '_blank', number: service().phoneDisplay });

  // the words come from the data
  assert.equal(await page.$eval('.ring__intro', el => el.textContent), service().intro);
  assert.equal(await page.$eval('.chat__msg--out .chat__text', el => el.textContent), support().intro);
  assert.equal(await page.$eval('.chat__bubble .chat__text', el => el.textContent), support().reply);

  // waiting before it is seen, then it plays (refine A: it keeps looping
  // while visible in the full tier, see tests/refine-a.e2e.mjs; this used
  // to assert "plays once and rests", which the loop makes obsolete)
  assert.equal(await page.$eval('.chat', el => el.classList.contains('is-armed')), true);
  await showContacts(page);
  await page.waitForFunction(() => document.querySelector('.chat').classList.contains('is-looping'), { timeout: 3000 });
  // the whole story is shown within one cycle (the reply and the reaction appear)
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.chat__reaction')).opacity) > 0.99, { timeout: 6000 });
  const full = await page.evaluate(() => {
    const op = sel => Number(getComputedStyle(document.querySelector(sel)).opacity);
    return { out: op('.chat__msg--out') > 0.99, reply: op('.chat__bubble') > 0.99, seen: op('.chat__ticks--seen') > 0.99, typing: op('.chat__typing') < 0.01 };
  });
  assert.deepEqual(full, { out: true, reply: true, seen: true, typing: true });

  // the CTA never waited
  assert.equal(await page.$eval('.support .btn--whatsapp', el => getComputedStyle(el).opacity), '1');

  // his picture
  await page.waitForFunction(() => document.querySelector('.support .person__avatar--photo img').complete);
  assert.ok(await page.$eval('.support .person__avatar--photo img', img => img.naturalWidth > 0 && img.getAttribute('src') === img.currentSrc.replace(location.origin + '/', '')));

  // screen readers: a labelled list of two messages, no decoration
  const spoken = await page.evaluate(() => {
    const log = document.querySelector('.chat__log');
    return { label: log.getAttribute('aria-label'), items: log.querySelectorAll(':scope > li').length, hidden: [...log.querySelectorAll('.chat__typing, .chat__meta, .chat__reaction, .chat__avatar')].every(n => n.getAttribute('aria-hidden') === 'true') };
  });
  assert.deepEqual(spoken, { label: `محادثة مع ${support().name}`, items: 2, hidden: true });

  assert.deepEqual(problems, []);
  await close();

});

test('reduced motion: the chat and the phone are simply in their final state', async () => {

  const { page, problems, close } = await open({ reduced: true });
  await showContacts(page);
  await wait(300);
  const state = await page.evaluate(() => ({
    armed: document.querySelector('.chat').className.includes('is-'),
    reply: Number(getComputedStyle(document.querySelector('.chat__bubble')).opacity),
    out: Number(getComputedStyle(document.querySelector('.chat__msg--out')).opacity),
    moving: document.getAnimations().filter(a => a.effect?.target?.closest?.('.person-card, #topbar')).length
  }));
  assert.deepEqual(state, { armed: false, reply: 1, out: 1, moving: 0 });
  assert.deepEqual(problems, []);
  await close();

});

test('older content (no image / intro / reply): the defaults and the monogram', async () => {

  const json = JSON.parse(JSON.stringify(content));
  for (const c of json.contacts) { delete c.image; delete c.intro; delete c.reply; }
  const { page, problems, close } = await open({ json, reduced: true });

  const words = await page.evaluate(() => ({
    invite: document.querySelector('.ring__intro').textContent,
    visitor: document.querySelector('.chat__msg--out .chat__text').textContent,
    reply: document.querySelector('.chat__bubble .chat__text').textContent,
    monogram: document.querySelector('.support .person__avatar').textContent,
    photo: !!document.querySelector('.person__avatar--photo, .chat__avatar--photo')
  }));
  assert.deepEqual(words, {
    invite: 'عندك سؤال أو محتاج تتكلم؟',
    visitor: 'معايا مشكلة',
    reply: 'أهلاً بيك 👋 ابعتلي المشكلة أو التفاصيل وأنا هساعدك إن شاء الله.',
    monogram: Array.from(support().name)[0],
    photo: false
  });
  assert.deepEqual(problems, []);
  await close();

});


/* ---------------- poster hero ---------------- */

const POSTERS = { wide: 'بوستر عريض', square: 'بوستر مربع', tall: 'بوستر طويل جداً', portrait: 'رحلة الغردقة', none: 'صور اجتماع الأحد' };

async function hero(page) {
  await page.waitForSelector('dialog.sheet[open] .detail');
  await wait(800);
  return page.evaluate(() => {
    const fig = document.querySelector('dialog.sheet[open] .media-hero');
    if (!fig) return null;
    const img = fig.querySelector('.media-hero__img');
    const ambient = fig.querySelector('.media-hero__ambient');
    const r = fig.getBoundingClientRect();
    return {
      shape: fig.dataset.shape,
      w: r.width,
      h: r.height,
      fit: getComputedStyle(img).objectFit,
      imgBox: [img.getBoundingClientRect().width, img.getBoundingClientRect().height],
      natural: [img.naturalWidth, img.naturalHeight],
      current: img.currentSrc,
      ambient: getComputedStyle(ambient).display,
      ambientLoaded: ambient.complete && ambient.naturalWidth > 0,
      background: getComputedStyle(fig).backgroundImage,
      vh: innerHeight,
      dpr: devicePixelRatio
    };
  });
}

for (const [name, viewport] of Object.entries({ phone: PHONE, desktop: DESKTOP })) {

  test(`${name}: every poster shape keeps its ratio, is never cropped, capped, sharp`, async () => {

    const cap = name === 'phone' ? 0.56 : 0.62;
    const tiers = [];

    for (const [shape, title] of Object.entries(POSTERS)) {

      const item = content.news.find(n => n.title === title);
      const { page, problems, close } = await open({ viewport, hash: `#news/${item.id}` });
      await page.waitForFunction(() => { const i = document.querySelector('dialog.sheet[open] .media-hero__img'); return !i || (i.complete && i.naturalWidth); });
      const m = await hero(page);

      if (shape === 'none') {
        assert.equal(m, null, 'no poster, no empty frame');
        await close();
        continue;
      }

      const ratio = item.image.w / item.image.h;
      assert.equal(m.shape, shape);
      assert.equal(m.fit, 'contain', 'never cropped or stretched');
      // the loaded file has the poster's own ratio (no distortion anywhere)
      assert.ok(Math.abs(m.natural[0] / m.natural[1] - ratio) < 0.01);
      assert.ok(m.h <= m.vh * cap + 1, `${shape}: height capped (${m.h} / ${m.vh * cap})`);
      // the frame is the poster's shape unless the cap took over
      if (m.h < m.vh * cap - 1) assert.ok(Math.abs(m.w / m.h - ratio) < 0.02, `${shape}: frame ratio ${m.w / m.h} vs ${ratio}`);
      if (shape === 'tall') assert.ok(Math.abs(m.h - m.vh * cap) <= 1, 'a very tall poster stops at the cap');
      // sharp: the chosen file is at least as wide as what is drawn (× DPR), or the largest there is
      const drawn = Math.min(m.w, m.h * ratio) * m.dpr;
      const chosen = /-480\.webp$/.test(m.current) ? 480 : item.image.w;
      assert.ok(chosen >= drawn - 2 || chosen === item.image.w, `${shape}: ${chosen}px file for ${Math.round(drawn)} device px`);
      // full tier: the blurred poster around unusual shapes (a headless phone
      // may measure slow frames and land in lite: then the colour light)
      const tier = await page.evaluate(() => document.documentElement.dataset.motion);
      tiers.push(tier);
      if (shape !== 'wide') {
        assert.equal(m.ambient, tier === 'full' ? 'block' : 'none', `${shape}: surround in the ${tier} tier`);
        if (tier === 'full') assert.ok(m.ambientLoaded, `${shape}: surround loaded`);
      }
      assert.match(m.background, /gradient/, 'a navy/gold light under it anyway');

      assert.deepEqual(problems, []);
      await close();

    }

    assert.ok(tiers.includes('full'), `the full-tier surround was checked at least once (${tiers})`);

  });

}

test('lite tier: no blurred surround, the colour light instead', async () => {

  const item = content.news.find(n => n.title === POSTERS.tall);
  const { page, problems, close } = await open({ weak: true, hash: `#news/${item.id}` });
  const m = await hero(page);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.motion), 'lite');
  assert.equal(m.ambient, 'none');
  assert.equal(m.ambientLoaded, false, 'the lite tier never downloads it');
  assert.match(m.background, /radial-gradient/);
  // no image.color in the demo: the light takes the poster's own average colour (green)
  const tint = await page.$eval('.media-hero', fig => fig.style.getPropertyValue('--tint'));
  const [r, g, b] = tint.match(/\d+/g).map(Number);
  assert.ok(g > r && g > b, `a green poster, a green light (${tint})`);
  assert.deepEqual(problems, []);
  await close();

});

test('the zoom viewer opens and closes with the keyboard; the sheet stays', async () => {

  const item = content.news.find(n => n.title === POSTERS.tall);
  const { page, problems, close } = await open({ hash: `#news/${item.id}` });
  await hero(page);

  await page.focus('.media-hero__zoom');
  await page.keyboard.press('Enter');
  await page.waitForSelector('dialog.viewer[open]');
  const viewer = await page.evaluate(() => ({
    focus: document.activeElement.className,
    src: document.querySelector('.viewer__img').getAttribute('src'),
    label: document.querySelector('.viewer__close').getAttribute('aria-label')
  }));
  assert.deepEqual(viewer, { focus: 'viewer__close', src: item.image.src, label: 'قفل الصورة' });

  // real size and back, by keyboard
  await page.focus('.viewer__scroll');
  await page.keyboard.press('Enter');
  assert.equal(await page.$eval('.viewer__scroll', el => el.classList.contains('is-zoomed')), true);
  await page.waitForFunction(() => document.querySelector('.viewer__img').complete);
  await wait(200);
  const size = await page.$eval('.viewer__img', img => [img.getBoundingClientRect().width, img.naturalWidth, img.width]);
  assert.ok(size[0] >= size[1] - 1, `real size ${size}`);

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog.viewer'));
  assert.ok(await page.$('dialog.sheet[open]'), 'the sheet is still open');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'media-hero__zoom', 'focus back on the poster');

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog.sheet'));

  assert.deepEqual(problems, []);
  await close();

});

test('meeting sheet: the poster is the hero, then the topic in order', async () => {

  const { page, problems, close } = await open({ hash: '#meeting' });
  await hero(page);
  const order = await page.$$eval('dialog.sheet[open] .detail > *', els => els.map(e => e.className.split(' ')[0]));
  assert.deepEqual(order.slice(0, 4), ['media-hero', 'detail__kicker', 'detail__topic', 'detail__lead']);
  assert.equal(await page.$eval('.detail__kicker', el => el.textContent), 'موضوع الاجتماع');
  assert.deepEqual(problems, []);
  await close();

});


/* ---------------- section banners ---------------- */

const bannerCounts = page => page.evaluate(() => [...document.querySelectorAll('#main > [data-area]')]
  .map(el => ({ area: el.dataset.area, banners: el.querySelectorAll(':scope > .section-banner').length })));

test('demo --banners: every section shows its banner exactly once; pairs stay balanced', async () => {

  const json = JSON.parse(bannerFiles.get('/content.json'));
  const sections = json.layout.length;

  for (const viewport of [PHONE, DESKTOP]) {

    const { page, problems, close } = await open({ viewport, files: bannerFiles });

    const counts = await bannerCounts(page);
    const total = counts.reduce((sum, c) => sum + c.banners, 0);
    assert.equal(total, sections, `one banner per section (${JSON.stringify(counts)})`);
    for (const area of ['meeting', 'featured', 'news', 'games', 'location', 'section', 'contacts', 'support', 'share']) {
      assert.equal(counts.filter(c => c.area === area).reduce((s, c) => s + c.banners, 0), 1, `${area}: exactly one`);
    }
    assert.equal(counts.filter(c => c.area === 'items').reduce((s, c) => s + c.banners, 0), 2, 'competitions and activities: one each');
    assert.ok(counts.every(c => c.banners <= 1), 'never two on one widget');
    // the announcement and the live game are not sections of their own
    assert.ok(counts.filter(c => ['announcement', 'live-game'].includes(c.area)).every(c => c.banners === 0));

    if (viewport === DESKTOP) {
      const pair = await page.evaluate(() => ['contacts', 'support'].map(area => {
        const card = document.querySelector(`[data-area="${area}"]`);
        return { card: Math.round(card.getBoundingClientRect().height), banner: Math.round(card.querySelector('.section-banner').getBoundingClientRect().height) };
      }));
      assert.equal(pair[0].banner, pair[1].banner, 'the same banner height side by side');
      assert.ok(Math.abs(pair[0].card - pair[1].card) <= 1, 'the pair keeps equal heights');
    }

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(overflow <= 0, `horizontal overflow ${overflow}px`);
    assert.deepEqual(problems, []);
    await close();

  }

});

test('without banners: none anywhere', async () => {

  const { page, problems, close } = await open();
  assert.equal((await bannerCounts(page)).reduce((sum, c) => sum + c.banners, 0), 0);
  assert.deepEqual(problems, []);
  await close();

});


/* ---------------- tiers ---------------- */

for (const tier of ['reduced', 'lite']) {

  test(`${tier}: nothing of the polish stays hidden or keeps moving`, async () => {

    const { page, problems, close } = await open({ reduced: tier === 'reduced', weak: tier === 'lite' });
    assert.equal(await page.evaluate(() => document.documentElement.dataset.motion), tier);

    // walk the whole page, then look
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y <= height; y += 400) { await page.evaluate(top => window.scrollTo(0, top), y); await wait(80); }
    await showContacts(page);
    await wait(tier === 'lite' ? 3200 : 400);

    const report = await page.evaluate(() => {
      const ours = '#topbar, .person-card, .media-hero';
      const running = document.getAnimations().filter(a => {
        const target = a.effect && a.effect.target;
        return target && target.closest && target.closest(ours) && a.playState === 'running' && !(a.timeline && a.timeline.constructor.name === 'ScrollTimeline');
      });
      // everything that carries meaning (the waves and the typing dots are decoration)
      const meaningful = '.person__head, .ring__glyph, .ring__copy, .chat__chip, .chat__msg--out, .chat__ticks--seen, .chat__reaction, .chat__avatar, .chat__bubble, .person__actions, .topbar__inner';
      const hidden = [...document.querySelectorAll(meaningful)]
        .filter(el => el.getClientRects().length && Number(getComputedStyle(el).opacity) < 1);
      return { running: running.map(a => a.animationName || 'anim'), hidden: hidden.map(el => el.className) };
    });

    assert.deepEqual(report.running, [], 'no animation left running');
    assert.deepEqual(report.hidden, [], 'nothing left hidden');
    assert.deepEqual(problems, []);
    await close();

  });

}
