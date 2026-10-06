// Browser end-to-end checks for the public portal, in headless Chrome:
//   - renders from content.json with no console errors / CSP violations
//   - no horizontal overflow; comfortable touch targets
//   - axe-core accessibility audit (WCAG 2.x A/AA) at phone, tablet, desktop
//   - reduced motion honoured
//   - the QR code really decodes to the page URL
//   - offline / broken content.json shows a retry state
//   - a maliciously edited content.json cannot inject links or markup
//
// Run: cd tools && npm run e2e

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');
const sharp = require('sharp');
const jsQR = require('jsqr');
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const PORT = 4399;
const BASE = `http://localhost:${PORT}/`;

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find(existsSync);

const VIEWPORTS = {
  phone: { width: 360, height: 780, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  tablet: { width: 768, height: 1024, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  desktop: { width: 1366, height: 900, deviceScaleFactor: 1 }
};

let server;
let browser;

test.before(async () => {
  server = spawn(process.execPath, [`${ROOT}tools/serve.mjs`, String(PORT)], { stdio: 'pipe' });
  await new Promise(resolve => server.stdout.once('data', resolve));
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
});

test.after(async () => {
  await browser?.close();
  server?.kill();
});


async function open(viewport, { intercept, media } = {}) {

  // fresh profile per page: no localStorage cache carried between tests
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];

  page.on('console', msg => { if (msg.type() === 'error') problems.push(`console: ${msg.text()}`); });
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));

  await page.evaluateOnNewDocument(() => {
    document.addEventListener('securitypolicyviolation', e => {
      console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`);
    });
  });

  await page.setViewport(viewport);

  if (media) await page.emulateMediaFeatures(media);

  if (intercept) {
    await page.setRequestInterception(true);
    page.on('request', request => {
      const handled = intercept(request);
      if (!handled) request.continue();
    });
  }

  await page.goto(BASE, { waitUntil: 'networkidle0' });

  return { page, problems };

}

const ready = page => page.waitForSelector('main[data-state="ready"], main[data-state="error"]', { timeout: 8000 });


for (const [name, viewport] of Object.entries(VIEWPORTS)) {

  test(`${name}: renders cleanly, fits, accessible`, async () => {

    const { page, problems } = await open(viewport);
    await ready(page);

    assert.equal(await page.$eval('main', m => m.dataset.state), 'ready');
    assert.deepEqual(problems, [], 'no console errors or CSP violations');

    // nothing wider than the screen
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(overflow <= 0, `horizontal overflow ${overflow}px`);

    // the agreed content order on the page
    const order = await page.$$eval('[data-area]', els => els.map(e => e.dataset.area));
    assert.deepEqual(order.filter((a, i) => order.indexOf(a) === i),
      ['hero', 'meeting', 'featured', 'location', 'section', 'contacts', 'support', 'share', 'footer']);

    // touch targets: every link/button at least 44x44 (stretched card link counts as its card)
    const small = await page.$$eval('a[href], button', els => els
      .filter(el => el.offsetParent !== null && !el.closest('dialog:not([open])'))
      .map(el => {
        const target = el.classList.contains('stretched') ? el.closest('.widget') : el;
        const r = target.getBoundingClientRect();
        return { text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) };
      })
      .filter(r => r.w < 44 || r.h < 44));
    assert.deepEqual(small, [], 'touch targets under 44px');

    // external links open safely
    const unsafe = await page.$$eval('a[target="_blank"]', els => els.filter(a => !/\bnoopener\b/.test(a.rel)).map(a => a.href));
    assert.deepEqual(unsafe, []);

    // axe-core (inject with CSP bypass; the page itself keeps its CSP)
    await page.setBypassCSP(true);
    await page.reload({ waitUntil: 'networkidle0' });
    await ready(page);
    // measure contrast after the one-time entrance animations (fading cards are see-through)
    const ENTRANCES = ['rise-depth', 'arch-in', 'logo-in', 'cross-in', 'name-in'];
    await page.waitForFunction(names => document.getAnimations()
      .filter(a => names.includes(a.animationName))
      .every(a => a.playState !== 'running'), { timeout: 8000 }, ENTRANCES);
    await page.evaluate(AXE);
    const results = await page.evaluate(() => axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }
    }));
    const violations = results.violations.map(v => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`);
    assert.deepEqual(violations, [], 'axe violations');

    await page.close();

  });

}


test('reduced motion: no looping or entrance animation', async () => {
  const { page } = await open(VIEWPORTS.phone, { media: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await ready(page);
  const glow = await page.$eval('.backdrop__glow', el => getComputedStyle(el).animationName);
  assert.equal(glow, 'none');
  const durations = await page.$$eval('.widget', els => els.map(el => parseFloat(getComputedStyle(el).animationDuration) || 0));
  assert.ok(durations.every(d => d < 0.01), 'entrance animations disabled');
  await page.close();
});


test('QR code decodes to the page URL', async () => {
  const { page } = await open(VIEWPORTS.phone);
  await ready(page);
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('QR')).click());
  await page.waitForSelector('dialog.qr-dialog[open]');
  await page.waitForFunction(() => document.querySelector('.qr-canvas').width === 1200);
  const dataUrl = await page.$eval('.qr-canvas', c => c.toDataURL('image/png'));
  const { data, info } = await sharp(Buffer.from(dataUrl.split(',')[1], 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const code = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  assert.ok(code, 'QR not readable');
  assert.equal(code.data, BASE);
  await page.close();
});


test('content.json unavailable: friendly retry state', async () => {
  const { page } = await open(VIEWPORTS.phone, {
    intercept: request => request.url().includes('content.json') && (request.respond({ status: 503, body: 'down' }), true)
  });
  await ready(page);
  assert.equal(await page.$eval('main', m => m.dataset.state), 'error');
  assert.ok(await page.$eval('[role="alert"]', el => el.textContent.includes('جرّب تاني')));
  await page.close();
});


test('tampered content.json cannot inject links or markup', async () => {
  const content = JSON.parse(readFileSync(`${ROOT}content.json`, 'utf8'));
  content.site.tagline = '<img src=x onerror="window.__pwned=1">';
  content.featured[0].url = 'javascript:window.__pwned=1';
  content.sections[0].links[0].url = 'data:text/html,<script>window.__pwned=1</script>';
  content.sections[0].links[1].title = '<b>bold</b>';
  content.sections[0].links[2].icon = '"><script>window.__pwned=1</script>';
  content.contacts[0].action.href = 'javascript:window.__pwned=1';
  content.revision = 'tampered';
  content.location.directionsUrl = 'http://insecure.example.com';

  const { page, problems } = await open(VIEWPORTS.phone, {
    intercept: request => request.url().includes('content.json') && (request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(content) }), true)
  });
  await ready(page);

  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  const hrefs = await page.$$eval('a[href]', els => els.map(a => a.getAttribute('href')));
  assert.ok(hrefs.every(h => /^(https:|tel:\+|#|meeting\.ics$)/.test(h)), `unsafe href: ${hrefs.filter(h => !/^(https:|tel:\+|#|meeting\.ics$)/.test(h))}`);
  assert.equal(await page.$eval('#site-tagline', el => el.textContent), '<img src=x onerror="window.__pwned=1">', 'shown as text');
  assert.equal(await page.$$eval('#main img', imgs => imgs.length), 1, 'only the logo image');
  assert.ok(await page.evaluate(() => document.body.innerText.includes('<b>bold</b>')));
  assert.equal(await page.$('.featured'), null, 'featured link with a bad URL is dropped');
  assert.deepEqual(problems.filter(p => p.includes('CSP')), []);
  await page.close();
});


test('page weight on first visit', async () => {
  const { page } = await open(VIEWPORTS.phone);
  await ready(page);
  const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(r => ({ name: r.name.replace(location.origin, ''), size: r.encodedBodySize })));
  const html = Buffer.byteLength(readFileSync(`${ROOT}index.html`));
  const total = resources.reduce((sum, r) => sum + r.size, html);
  console.log(`  first load: ${resources.length + 1} requests, ${(total / 1024).toFixed(0)} KB uncompressed`);
  for (const r of resources.sort((a, b) => b.size - a.size).slice(0, 6)) console.log(`    ${(r.size / 1024).toFixed(1).padStart(6)} KB  ${r.name}`);
  assert.ok(total < 350 * 1024, 'first load under 350 KB before compression');
  assert.ok(!resources.some(r => r.name.includes('qrcode')), 'QR library is lazy-loaded');
  await page.close();
});
