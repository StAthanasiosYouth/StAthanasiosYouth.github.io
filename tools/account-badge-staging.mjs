// Live STAGING check for the header's account icon (accounts improvements, Step 2): the real pages and CSP in Chrome
// against the staging Worker. Uses one @staging.invalid account and removes it. Needs the site on http://localhost:8080
// (the portal-8080 preview). Here, not in worker/scripts: a push to worker/ redeploys production.
// Run from worker/ so wrangler finds its config: node ../tools/account-badge-staging.mjs [shots dir]
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('./package.json', import.meta.url));
const puppeteer = require('puppeteer-core');

const API = 'https://athanasios-api-staging.menazak-lab.workers.dev';
const SITE = 'http://localhost:8080';
const SAMPLE = fileURLToPath(new URL('../assets/img/og-image.png', import.meta.url));
const SHOTS = process.argv[2] || fileURLToPath(new URL('./.cache/account-badge-staging/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });
const RUN = Date.now().toString(36);
const email = `badge-${RUN}@staging.invalid`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  ' + JSON.stringify(detail).slice(0, 300)));
  if (!ok) failed++;
};
function sql(command) {
  const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'athanasios-staging', '--remote', '--env', 'staging', '--json', '--command', `"${command}"`], { shell: true, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('d1: ' + String(r.stderr).slice(0, 300));
  return JSON.parse(r.stdout)[0].results;
}
const post = async (path, body) => (await fetch(API + path, { method: 'POST', headers: { origin: SITE, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();

sql("DELETE FROM rate_limits WHERE key LIKE 'acct.%'");
const started = await post('/v1/account/register/start', { email, phone: '015' + String(Date.now()).slice(-7) + '3', name: 'مارك سامي فوزي', birthDate: '2003-03-12', turnstile: 'XXXX.DUMMY.TOKEN.XXXX' });
if (!started.ok) throw new Error(JSON.stringify(started));
const { password } = await post('/v1/account/register/verify', { pendingId: started.pendingId, code: started.testCode });

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', e => problems.push(e.message));
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument(api => localStorage.setItem('athanasios.book.api', api), API);
  const clear = () => page.waitForFunction(() => { const b = document.querySelector('.acct-badge'); if (!b) return false; const r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.x + 22, r.y + 22); return e && b.contains(e); }, { timeout: 15000 });

  await page.goto(SITE + '/black-theatre/', { waitUntil: 'domcontentloaded' });
  await clear();
  check('signed out: the icon asks to sign in', (await page.$eval('.acct-badge', n => n.getAttribute('aria-label'))) === 'سجّل دخولك');
  await page.screenshot({ path: SHOTS + 'signed-out-mobile.png' });
  await page.click('.acct-badge');
  await page.waitForSelector('#acct-email', { timeout: 15000 });
  await page.$eval('#acct-email', (n, v) => { n.value = v; n.dispatchEvent(new Event('input', { bubbles: true })); }, email);
  await page.$eval('#acct-password', (n, v) => { n.value = v; n.dispatchEvent(new Event('input', { bubbles: true })); }, password);
  await sleep(1500); // the Turnstile test widget
  await page.$eval('form', f => f.requestSubmit());
  await page.waitForSelector('[data-tour]', { timeout: 20000 });
  check('the icon lands on the account at once, the walkthrough shows', (await page.evaluate(() => location.pathname)) === '/account/');
  await page.click('[data-tour-skip]');
  await page.waitForFunction(() => !document.querySelector('[data-tour]'));
  await sleep(800);
  await page.goto(SITE + '/black-theatre/', { waitUntil: 'domcontentloaded' });
  await clear();
  check('the icon has the first letter', (await page.$eval('.acct-badge__face', n => n.textContent)) === 'م');
  await page.screenshot({ path: SHOTS + 'signed-in-mobile.png' });

  await page.click('.acct-badge');
  await page.waitForSelector('[data-home]', { timeout: 15000 });
  check('signed in: straight to the account, no walkthrough again', !(await page.$('[data-tour]')));
  check('«ارجع للموقع» goes back to that page', (await page.$eval('.cbar__home', a => new URL(a.href).pathname)) === '/black-theatre/');
  await sleep(1500);
  await page.click('.ac-hero .ac-arch');
  await page.waitForSelector('[data-photo-sheet][open]');
  await (await page.$('#ac-photo-file')).uploadFile(SAMPLE);
  await page.waitForSelector('[data-photo-crop] canvas');
  await page.click('[data-photo-save]');
  await page.waitForSelector('.ac-toast__b--ok', { timeout: 20000 });
  await sleep(300);

  const seen = [];
  page.on('request', r => { if (r.url().startsWith(API)) seen.push(new URL(r.url()).pathname); });
  await page.goto(SITE + '/black-theatre/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const i = document.querySelector('.acct-badge img'); return i && i.naturalWidth === 256; }, { timeout: 15000 });
  await clear();
  check('the photo shows in the header (real CSP), no account request', !seen.some(p => p.startsWith('/v1/account/')), seen);
  await page.screenshot({ path: SHOTS + 'photo-mobile.png' });
  await page.goto(SITE + '/', { waitUntil: 'domcontentloaded' });
  await clear();
  await sleep(1200);
  await page.screenshot({ path: SHOTS + 'photo-home-mobile.png' });
  await page.setViewport({ width: 1280, height: 800 });
  await sleep(600);
  await page.screenshot({ path: SHOTS + 'photo-home-desktop.png' });
  check('no script errors', problems.length === 0, problems);
}
finally {
  await browser.close();
  const key = sql(`SELECT avatar_key FROM participants WHERE email = '${email}'`)[0]?.avatar_key;
  if (key) console.log('     the sweep removes ' + key + ' after a day');
  sql(`DELETE FROM account_sessions WHERE participant_id IN (SELECT id FROM participants WHERE email = '${email}')`);
  sql(`DELETE FROM participant_audit WHERE participant_id IN (SELECT id FROM participants WHERE email = '${email}')`);
  sql(`DELETE FROM participants WHERE email = '${email}'`);
  sql("DELETE FROM rate_limits WHERE key LIKE 'acct.%'");
}
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
