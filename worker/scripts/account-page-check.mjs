// Live STAGING check for the account page (accounts improvements, Step 1): the real page with its real CSP in Chrome
// against the staging Worker, R2 and D1: register, direct entry, the photo, sections, the admin's view and removal,
// refusals on the API, request times. Uses only @staging.invalid addresses, cleans up after itself.
// Needs the site on http://localhost:8080 (the portal-8080 preview). Run from worker/: node scripts/account-page-check.mjs [shots dir]
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../tools/package.json', import.meta.url));
const puppeteer = require('puppeteer-core');

const base = 'https://athanasios-api-staging.menazak-lab.workers.dev';
const SITE = 'http://localhost:8080';
const ORIGIN = SITE;
const CLIENT_ID = '246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com';
const PEM = readFileSync(new URL('../.staging-test-key.pem', import.meta.url), 'utf8');
const SAMPLE = fileURLToPath(new URL('../../assets/img/og-image.png', import.meta.url));
const SHOTS = process.argv[2] || fileURLToPath(new URL('../../tools/.cache/account-staging/', import.meta.url));
const RUN = Date.now().toString(36);
const stamp = String(Date.now()).slice(-7);
const PRIMARY = 'loadtest@staging.invalid';
mkdirSync(SHOTS, { recursive: true });
let failed = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  ' + JSON.stringify(detail).slice(0, 500)));
  if (!ok) failed++;
}
function sql(command) {
  const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'athanasios-staging', '--remote', '--env', 'staging', '--json', '--command', `"${command}"`], { shell: true, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('d1: ' + String(r.stderr).slice(0, 300));
  return JSON.parse(r.stdout)[0].results;
}
function google(email, sub) {
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: 'RS256', kid: 'staging-test', typ: 'JWT' }) + '.' + enc({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub, email, email_verified: true, name: 'check', iat: now, exp: now + 3000 });
  return head + '.' + createSign('RSA-SHA256').update(head).sign(PEM).toString('base64url');
}
const P = google(PRIMARY, 'loadtest-1');

async function call(method, path, { body, token, raw, type, origin = ORIGIN } = {}) {
  const t0 = Date.now();
  const res = await fetch(base + path, {
    method,
    headers: { origin, ...(token ? { authorization: 'Bearer ' + token } : {}), ...(raw ? { 'content-type': type || 'application/octet-stream' } : body ? { 'content-type': 'application/json' } : {}) },
    body: raw || (body ? JSON.stringify(body) : undefined)
  });
  const isJson = (res.headers.get('content-type') || '').startsWith('application/json');
  return { status: res.status, ms: Date.now() - t0, headers: res.headers, body: isJson ? await res.json().catch(() => null) : null, bytes: isJson ? null : new Uint8Array(await res.arrayBuffer()) };
}

const email = `page-${RUN}@staging.invalid`;
const phone = '015' + stamp + '1';
sql("UPDATE settings SET value = 'on' WHERE key = 'accounts_mode'");
sql("DELETE FROM rate_limits WHERE key LIKE 'acct.%' OR key LIKE 'participants.%'");

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const context = await browser.createBrowserContext();
const open = async (width, height, path = '/account/') => {
  const page = await context.newPage();
  page.problems = [];
  page.on('pageerror', e => page.problems.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|turnstile|challenges\.cloudflare|preload/i.test(m.text())) page.problems.push(m.text()); });
  await page.setViewport({ width, height, deviceScaleFactor: width < 640 ? 2 : 1 });
  await page.evaluateOnNewDocument(api => localStorage.setItem('athanasios.book.api', api), base);
  await page.goto(SITE + path, { waitUntil: 'domcontentloaded' });
  return page;
};
const set = (page, s, v) => page.$eval(s, (n, val) => { n.value = val; n.dispatchEvent(new Event('input', { bubbles: true })); n.dispatchEvent(new Event('change', { bubbles: true })); }, v);
const settle = page => page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))));
const go = async (page, hash, selector) => {
  await page.evaluate(v => { location.hash = v; }, hash);
  await page.waitForSelector(selector, { timeout: 15000 });
  await sleep(500);
  await settle(page);
};

let account = null;
try {
  /* ---------- a whole registration, through the page ---------- */
  const page = await open(390, 844);
  await page.waitForSelector('#acct-email', { timeout: 15000 });
  await set(page, '#acct-email', email);
  await sleep(1500); // the Turnstile test widget
  await page.$eval('form', f => f.requestSubmit());
  await page.waitForSelector('[data-create]:not([hidden])', { timeout: 20000 });
  await page.waitForFunction(() => { const n = document.querySelector('[data-none]'); return n && !n.hidden; });
  await page.click('[data-create]');
  await page.waitForSelector('#acct-phone');
  await set(page, '#acct-phone', phone);
  await set(page, '#acct-name', 'مينا زكريا فؤاد');
  await set(page, '#acct-day', '12');
  await set(page, '#acct-month', '3');
  await set(page, '#acct-year', '2003');
  await page.$eval('form', f => f.requestSubmit());
  await page.waitForSelector('[data-send]');
  await sleep(1500);
  await page.click('[data-send]');
  await page.waitForSelector('[data-test-code]', { timeout: 20000 });
  const code = await page.$eval('[data-test-code]', n => n.dataset.testCode);
  await set(page, '#acct-code', code);
  await page.$eval('form', f => f.requestSubmit());
  await page.waitForSelector('[data-password]', { timeout: 20000 });
  const password = await page.$eval('[data-password]', n => n.textContent.trim());
  await sleep(1500);
  await page.click('[data-enter]');
  await page.waitForSelector('[data-home]', { timeout: 20000 });
  await sleep(1400);
  await settle(page);
  check('registered through the page, the first page opens', /أهلاً بيك يا مينا/.test(await page.$eval('.ac-hero__hi', n => n.textContent)));
  await page.waitForSelector('[data-tour]', { timeout: 8000 });
  check('the walkthrough shows the first time', true);
  await settle(page);
  await page.screenshot({ path: SHOTS + 'tour-mobile.png' });
  await page.click('[data-tour-skip]');
  await page.waitForFunction(() => !document.querySelector('[data-tour]'));
  await sleep(1200);
  check('skipping marks it seen on the server', sql(`SELECT onboarded_at FROM participants WHERE email = '${email}'`)[0].onboarded_at > 0);
  await page.screenshot({ path: SHOTS + 'new-mobile.png', fullPage: false });
  check('no errors so far (real CSP)', page.problems.length === 0, page.problems);

  /* ---------- direct entry ---------- */
  const again = await open(390, 844);
  await again.waitForSelector('[data-home]', { timeout: 15000 });
  check('a valid session opens directly, no question', !(await again.$('[data-hint]')));
  await again.close();

  /* ---------- the photo on real R2 ---------- */
  await page.click('.ac-hero .ac-arch');
  await page.waitForSelector('[data-photo-sheet][open]');
  await (await page.$('#ac-photo-file')).uploadFile(SAMPLE);
  await page.waitForSelector('[data-photo-crop] canvas');
  await page.click('[data-photo-save]');
  await page.waitForSelector('.ac-toast__b--ok', { timeout: 20000 });
  const row = sql(`SELECT id, avatar_key, avatar_version FROM participants WHERE email = '${email}'`)[0];
  account = row.id;
  check('saved: a random key under avatars/', /^avatars\/[a-z2-7]{16}$/.test(row.avatar_key), row);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const i = document.querySelector('.ac-hero .ac-arch__img'); return i && i.src.startsWith('blob:') && i.naturalWidth === 256; }, { timeout: 15000 });
  check('after a reload it comes back from R2 as a blob: (CSP unchanged)', true);
  await sleep(1200);
  await settle(page);
  await page.screenshot({ path: SHOTS + 'photo-mobile.png' });

  /* ---------- the API's refusals, on the real Worker ---------- */
  const signed = await call('POST', '/v1/account/signin', { body: { email, password, turnstile: 'XXXX.DUMMY.TOKEN.XXXX' } });
  const token = signed.body.session.token;
  const text = t => new TextEncoder().encode(t.padEnd(64));
  check('refuses SVG', (await call('POST', '/v1/account/avatar', { raw: text('<svg xmlns="http://www.w3.org/2000/svg" onload="x()"/>'), token, type: 'image/webp' })).status === 400);
  check('refuses HTML under an image type', (await call('POST', '/v1/account/avatar', { raw: text('<!doctype html><script>x()</script>'), token, type: 'image/jpeg' })).status === 400);
  check('refuses over 64 KB', (await call('POST', '/v1/account/avatar', { raw: new Uint8Array(70 * 1024), token })).status === 413);
  check('no session, no photo', (await call('GET', '/v1/account/avatar')).status === 401);
  const got = await call('GET', '/v1/account/avatar', { token });
  check('served with a fixed type, nosniff, sandbox, private', got.status === 200 && got.headers.get('x-content-type-options') === 'nosniff' && /sandbox/.test(got.headers.get('content-security-policy')) && /private/.test(got.headers.get('cache-control')) && /^image\/(webp|jpeg)$/.test(got.headers.get('content-type')), Object.fromEntries(got.headers));
  check('small on the wire', got.bytes.length > 500 && got.bytes.length < 60 * 1024, got.bytes.length);
  console.log('     photo: ' + got.bytes.length + ' bytes, read in ' + got.ms + ' ms');
  const cross = await call('GET', '/v1/account/avatar', { token, origin: 'https://evil.example' });
  check('no CORS for other sites', !cross.headers.get('access-control-allow-origin'));
  const same = await call('POST', '/v1/admin/participants/' + account + '/avatar/delete', { body: { reason: 'x' }, token });
  check("a member's session can't use the admin route", same.status === 401 || same.status === 403, same.status);

  /* ---------- how long the first page takes ---------- */
  const times = [];
  for (let i = 0; i < 5; i++) times.push((await call('GET', '/v1/account/summary', { token })).ms);
  console.log('     /v1/account/summary: ' + times.join(', ') + ' ms');
  check('the summary answers quickly', Math.min(...times) < 1200, times);

  /* ---------- sections, mobile then computer ---------- */
  for (const [hash, selector, shot] of [['#me/points', '.ac-view h1', 'points'], ['#me/bookings', '.ac-view h1', 'bookings'], ['#me/results', '.ac-view h1', 'results'], ['#me/orders', '.ac-view h1', 'orders'], ['#me/profile', '[data-facts]', 'profile'], ['#me/notifications', '[data-prefs]', 'prefs'], ['#me/security', '[data-sessions]', 'security'], ['#me/support', '.ac-view h1', 'support']]) {
    await go(page, hash, selector);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(hash + ' opens, no sideways scroll', over === 0, over);
    await page.screenshot({ path: SHOTS + shot + '-mobile.png' });
  }
  check('no errors on any section', page.problems.length === 0, page.problems);
  const desk = await open(1280, 860);
  await desk.waitForSelector('[data-home]', { timeout: 15000 });
  await sleep(1400);
  await settle(desk);
  check('the rail on a computer', await desk.$eval('.ac-rail', n => getComputedStyle(n).display !== 'none'));
  await desk.screenshot({ path: SHOTS + 'home-desktop.png' });
  await go(desk, '#me/security', '[data-sessions]');
  await desk.screenshot({ path: SHOTS + 'security-desktop.png' });
  const nav = await desk.evaluate(() => {
    const e = performance.getEntriesByType('navigation')[0];
    return { dcl: Math.round(e.domContentLoadedEventEnd), load: Math.round(e.loadEventEnd) };
  });
  console.log('     local page, load: ' + JSON.stringify(nav));
  check('no errors on the computer', desk.problems.length === 0, desk.problems);

  /* ---------- the admin ---------- */
  const a = await call('GET', '/v1/admin/participants/' + account, { token: P });
  check('admin: the sheet says there is a photo', a.status === 200 && a.body.person.avatar >= 1, a.status);
  const seen = await call('GET', '/v1/admin/participants/' + account + '/avatar', { token: P });
  check('admin: sees it, not cached', seen.status === 200 && /no-store/.test(seen.headers.get('cache-control')), seen.status);
  check('admin: removing needs a reason', (await call('POST', '/v1/admin/participants/' + account + '/avatar/delete', { body: {}, token: P })).status === 400);
  const removed = await call('POST', '/v1/admin/participants/' + account + '/avatar/delete', { body: { reason: 'فحص Staging' }, token: P });
  check('admin: removed, in the account\'s history', removed.status === 200 && removed.body.person.avatar === null && removed.body.audit.some(x => x.action === 'avatar.remove' && x.reason === 'فحص Staging'), removed.status);
  check('admin: in the activity, without personal data', sql(`SELECT summary FROM activity WHERE action = 'participant.avatar' AND entity_id = '${account}'`)[0]?.summary === 'مسح صورة مشترك');
  check('gone for the member', (await call('GET', '/v1/account/avatar', { token })).status === 404);
  check('nothing dangling in D1', sql(`SELECT avatar_key FROM participants WHERE id = '${account}'`)[0].avatar_key === null);

  /* ---------- going out ---------- */
  await page.bringToFront();
  await go(page, '#me', '[data-home]');
  await sleep(600);
  await page.$eval('.ac-signout--m', n => n.scrollIntoView({ block: 'center' }));
  await sleep(100);
  await page.click('.ac-signout--m');
  await page.waitForSelector('#acct-email', { timeout: 15000 });
  check('sign out returns to the form with the email', (await page.$eval('#acct-email', n => n.value)) === email);
  await call('POST', '/v1/account/logout', { body: {}, token });
  check('logout ends the session', (await call('GET', '/v1/account/me', { token })).status === 401);
}
finally {
  await browser.close();
  sql(`DELETE FROM account_sessions WHERE participant_id IN (SELECT id FROM participants WHERE email = '${email}')`);
  sql(`DELETE FROM participant_audit WHERE participant_id IN (SELECT id FROM participants WHERE email = '${email}')`);
  if (account) sql(`DELETE FROM activity WHERE entity_id = '${account}'`);
  sql(`DELETE FROM participants WHERE email = '${email}'`);
  sql("DELETE FROM pending_registrations");
  sql("DELETE FROM rate_limits WHERE key LIKE 'acct.%' OR key LIKE 'participants.%'");
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
