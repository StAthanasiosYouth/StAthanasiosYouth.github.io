// After a production release of the account page (read-only, no account made): the real site in Chrome at phone and
// computer widths. The sign-in opens with its CSP intact, no script errors, sound rules, and the API's closed doors.
// Here, not in worker/scripts: a push to worker/ redeploys production. Run from tools/: node account-prod-check.mjs [shots dir]
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('./package.json', import.meta.url));
const puppeteer = require('puppeteer-core');

const SITE = 'https://stathanasiosyouth.github.io';
const API = 'https://athanasios-api.menazak-lab.workers.dev';
const SHOTS = process.argv[2] || fileURLToPath(new URL('./.cache/account-prod/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });
let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  ' + JSON.stringify(detail).slice(0, 400)));
  if (!ok) failed++;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
for (const [name, width, height] of [['mobile', 390, 844], ['desktop', 1280, 860]]) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];
  const calls = [];
  page.on('pageerror', e => problems.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/challenges\.cloudflare|turnstile|Failed to load resource|preload/i.test(m.text())) problems.push(m.text()); });
  page.on('request', r => { if (r.url().startsWith(API)) calls.push(new URL(r.url()).pathname); });
  await page.setViewport({ width, height, deviceScaleFactor: width < 640 ? 2 : 1 });
  await page.evaluateOnNewDocument(() => {
    window.__audio = 0;
    const Real = window.AudioContext;
    window.AudioContext = class extends Real { constructor(...a) { super(...a); window.__audio++; } };
  });
  const t0 = Date.now();
  await page.goto(SITE + '/account/?check=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#acct-email', { timeout: 20000 });
  console.log(`     ${name}: the form in ${Date.now() - t0} ms`);
  await sleep(1200);
  await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))));
  check(name + ': the new page', !!(await page.$('.ac-gate')));
  check(name + ': no script or CSP errors', problems.length === 0, problems);
  check(name + ': one call, to the config', calls.join() === '/v1/account/config', calls);
  check(name + ': silent until a tap', (await page.evaluate(() => window.__audio)) === 0);
  check(name + ': the sound switch is there', !!(await page.$('.cbar .usound')));
  check(name + ': no sideways scroll', (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) === 0);
  check(name + ': right to left', (await page.evaluate(() => document.documentElement.dir)) === 'rtl');
  await page.screenshot({ path: SHOTS + 'signin-' + name + '.png' });
  await context.close();
}
await browser.close();

for (const [path, want] of [['/v1/account/summary', 401], ['/v1/account/avatar', 401], ['/v1/admin/participants/p-aaaaaaaa/avatar', 401]]) {
  check(path + ' closed without a session', (await fetch(API + path)).status === want);
}
const upload = await fetch(API + '/v1/account/avatar', { method: 'POST', headers: { 'content-type': 'image/webp' }, body: new Uint8Array(100) });
check('no upload without a session', upload.status === 401, upload.status);
const config = await (await fetch(API + '/v1/account/config')).json();
check('accounts are on', config.mode === 'on', config.mode);

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
