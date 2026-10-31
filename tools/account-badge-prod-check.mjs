// After a production release of the header's account icon (read-only, no account made): the real site in Chrome at
// several widths. The icon is there, fits, asks nothing of the Worker, opens the sign-in and remembers where to return.
// Run from tools/: node account-badge-prod-check.mjs [shots dir]
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('./package.json', import.meta.url));
const puppeteer = require('puppeteer-core');

const SITE = 'https://stathanasiosyouth.github.io';
const API = 'https://athanasios-api.menazak-lab.workers.dev';
const SHOTS = process.argv[2] || fileURLToPath(new URL('./.cache/account-badge-prod/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });
let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  ' + JSON.stringify(detail).slice(0, 400)));
  if (!ok) failed++;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });

for (const path of ['/', '/black-theatre/']) {
  for (const width of [320, 390, 1280]) {
    const name = path + ' at ' + width;
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const problems = [];
    const calls = [];
    page.on('pageerror', e => problems.push(e.message));
    page.on('request', r => { if (r.url().startsWith(API)) calls.push(new URL(r.url()).pathname); });
    await page.setViewport({ width, height: 800, deviceScaleFactor: width < 640 ? 2 : 1 });
    await page.goto(SITE + path + '?check=' + Date.now(), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.acct-badge', { timeout: 20000 });
    await page.waitForFunction(() => { const b = document.querySelector('.acct-badge'); const r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.x + 22, r.y + 22); return e && b.contains(e); }, { timeout: 15000 });
    await sleep(1200);
    const r = await page.evaluate(() => {
      const a = document.querySelector('.acct-badge');
      const box = a.getBoundingClientRect();
      const bar = a.closest('.topbar, .pbar, .cbar');
      const items = [...bar.querySelectorAll('a, button')].filter(n => n.offsetParent).map(n => n.getBoundingClientRect());
      return {
        label: a.getAttribute('aria-label'), w: box.width, h: box.height, left: box.left, right: box.right, inner: innerWidth,
        over: document.documentElement.scrollWidth - document.documentElement.clientWidth, dir: document.documentElement.dir,
        overlap: items.some((x, i) => items.some((y, j) => i < j && x.left < y.right - 1 && y.left < x.right - 1 && x.top < y.bottom - 1 && y.top < x.bottom - 1))
      };
    });
    check(name + ': says sign in', r.label === 'سجّل دخولك', r);
    check(name + ': fits, 44px, no overlap, RTL', r.w >= 44 && r.h >= 44 && r.left >= 0 && r.right <= r.inner && r.over <= 0 && !r.overlap && r.dir === 'rtl', r);
    check(name + ': no account request', !calls.some(c => c.startsWith('/v1/account/')), calls);
    check(name + ': no script errors', problems.length === 0, problems);
    await page.screenshot({ path: SHOTS + (path.replace(/\W/g, '') || 'home') + '-' + width + '.png' });
    if (width === 390) {
      await page.click('.acct-badge');
      await page.waitForFunction(() => location.pathname === '/account/', { timeout: 15000 });
      await page.waitForSelector('#acct-email', { timeout: 20000 });
      const kept = await page.evaluate(() => sessionStorage.getItem('athanasios.account.return.v1'));
      check(name + ': opens the sign-in, keeps this page to return to', !!kept && kept.startsWith(path === '/' ? '/' : path), kept);
      const home = await page.$eval('.cbar__home', a => new URL(a.href).pathname);
      check(name + ': «ارجع للموقع» points back there', path === '/' ? ['/', '/index.html'].includes(home) : home === path, home);
    }
    await context.close();
  }
}
await browser.close();

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
