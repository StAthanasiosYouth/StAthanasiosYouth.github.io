// «خبزنا اليومي» W5 on STAGING: the real member page (this checkout, served on http://localhost:8080, an origin the
// Staging Worker allows) against the Staging Worker and D1, with BREAD_MODULE on in Staging only for the run.
//   a W1 sample program «[فحص W5]» (30 days, live today) → the page: today's topic, the intro, the open beacon and
//   «قريت» counted once, a member's reflection + edit + the 20-minute lock (the row aged in D1), the look saved to the
//   account, the home card and the «المزيد» link; screenshots at 390 and 1440. Then everything back as it was.
// NEVER a real push: refuses unless NOTIFY_ROUTER ≠ '1', PUSH_SENDER ≠ 'worker' and BREAD_PUSH = '0' on Staging, and never
// touches NOTIFY_*, PUSH_* or PERMS_ENFORCE. The production Worker is never asked (the browser's requests to it are cut).
// Uses @staging.invalid addresses (no email). Run from the repo root:
//   STAGING_KEYS_DIR=<folder with .staging-test-key.pem> node tools/bread-staging.mjs
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createSign } from 'node:crypto';
import { extname, join, normalize } from 'node:path';
import { ROOT } from './lib/gs.mjs';
import { orderFor } from '../worker/src/bread/model.js';
import { sampleTopic, seedFor, CHROME, PROTO } from '../tests/bread-world.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');
const BASE = 'https://athanasios-api-staging.menazak-lab.workers.dev';
const PROD = 'https://athanasios-api.menazak-lab.workers.dev';
const SITE = 'http://localhost:8080';
const ORIGIN = 'https://stathanasiosyouth.github.io';
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const CLIENT_ID = '246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com';
const KEYS = process.env.STAGING_KEYS_DIR || join(ROOT, 'worker');
const PEM = readFileSync(join(KEYS, '.staging-test-key.pem'), 'utf8');
const SHOTS = `${ROOT}tools/.cache/bread-staging/`;
mkdirSync(SHOTS, { recursive: true });
const RUN = Date.now().toString(36);
const stamp = String(Date.now()).slice(-6);
let failed = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  ' + JSON.stringify(detail).slice(0, 400)));
  if (!ok) failed++;
}
function sql(command) {
  const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'athanasios-staging', '--remote', '--env', 'staging', '--json', '--command', `"${command}"`], { shell: true, encoding: 'utf8', cwd: join(ROOT, 'worker') });
  if (r.status !== 0) throw new Error('d1: ' + String(r.stderr).slice(0, 300));
  return JSON.parse(r.stdout)[0].results;
}
function google(email, sub) {
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: 'RS256', kid: 'staging-test', typ: 'JWT' }) + '.' + enc({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub, email, email_verified: true, name: 'check', iat: now, exp: now + 3600 });
  return head + '.' + createSign('RSA-SHA256').update(head).sign(PEM).toString('base64url');
}
async function call(method, path, body, token) {
  const res = await fetch(BASE + path, { method, headers: { origin: ORIGIN, ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const P = google('loadtest@staging.invalid', 'loadtest-1');
const admin = (method, path, body) => call(method, '/v1/admin/' + path, body, P);
async function member() {
  const f = { email: `bread5-${RUN}@staging.invalid`, phone: '012' + stamp + '55', name: 'مارك سامي فوزي', birthDate: '2004-05-09', turnstile: TOKEN };
  const s = await call('POST', '/v1/account/register/start', f);
  const d = await call('POST', '/v1/account/register/verify', { pendingId: s.body && s.body.pendingId, code: s.body && s.body.testCode });
  const si = await call('POST', '/v1/account/signin', { email: f.email, password: d.body && d.body.password, turnstile: TOKEN });
  if (!si.body || !si.body.session) throw new Error('member sign-in: ' + JSON.stringify([s.body, d.body && d.body.code, si.body]).slice(0, 300));
  return { token: si.body.session.token, id: si.body.account.id, email: f.email, firstName: 'مارك' };
}

// ---------- guards ----------
const guard = Object.fromEntries(sql("SELECT key, value FROM settings WHERE key IN ('NOTIFY_ROUTER', 'PUSH_SENDER', 'BREAD_PUSH', 'BREAD_MODULE')").map(r => [r.key, r.value]));
if (guard.NOTIFY_ROUTER === '1' || guard.PUSH_SENDER === 'worker' || (guard.BREAD_PUSH || '0') !== '0') {
  console.error('refusing: staging could send a real push now', JSON.stringify(guard));
  process.exit(2);
}
check('guards: NOTIFY_ROUTER off, PUSH_SENDER not worker, BREAD_PUSH 0', true);
const moduleBefore = guard.BREAD_MODULE || '0';
const busy = sql("SELECT id, name FROM bread_programs WHERE status = 'scheduled' AND purged_ms IS NULL");
if (busy.length) { console.error('refusing: staging already has a scheduled program (another check running?)', JSON.stringify(busy)); process.exit(2); }

// ---------- the site on :8080, its published files from the Worker (as GitHub Pages would mirror them) ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.m4a': 'audio/mp4', '.opus': 'audio/ogg', '.mp4': 'video/mp4', '.ics': 'text/calendar' };
const site = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, SITE).pathname);
  const data = /^\/daily-bread\/data\/(index|brd-[0-9a-f]{10}\/\d{1,3})\.json$/.exec(path);
  if (data) {
    const r = await fetch(`${BASE}/v1/bread/file/${data[1]}`, { headers: { origin: SITE } });
    res.writeHead(r.status === 200 ? 200 : 404, { 'content-type': 'application/json' });
    res.end(r.status === 200 ? await r.text() : '');
    return;
  }
  let file = normalize(path);
  if (file.endsWith('\\') || file.endsWith('/')) file += 'index.html';
  try {
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(readFileSync(join(ROOT, file)));
  }
  catch {
    res.writeHead(404);
    res.end('');
  }
});
await new Promise((ok, no) => site.listen(8080, ok).on('error', no));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });

async function open(path, { width = 390, height = 844, seed, m = null, look = null } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', x => { if (x.type() === 'error' && !/Failed to load resource|favicon/.test(x.text())) errors.push(x.text()); });
  await page.setViewport({ width, height, isMobile: width < 700, hasTouch: width < 700 });
  await page.setRequestInterception(true);
  page.on('request', r => (r.url().startsWith(PROD) ? r.abort() : r.continue()));
  await page.evaluateOnNewDocument((api, seed, m, look) => {
    if (sessionStorage.getItem('primed')) return;
    sessionStorage.setItem('primed', '1');
    sessionStorage.setItem('athanasios:intro', '1');
    localStorage.setItem('athanasios.book.api', api);
    localStorage.setItem('bread.seed', seed);
    if (look) localStorage.setItem('bread.look', look);
    if (m) {
      localStorage.setItem('athanasios.account.v1', JSON.stringify({ token: m.token, email: m.email, firstName: m.firstName, at: Date.now() }));
      localStorage.setItem('athanasios.account.face.v1', JSON.stringify({ firstName: m.firstName, photo: '', version: 1 }));
    }
  }, BASE, seed, m, look);
  await page.goto(SITE + path, { waitUntil: 'domcontentloaded' });
  return { page, ctx, errors };
}
const text = (page, sel) => page.$eval(sel, n => n.textContent.replace(/\s+/g, ' ').trim());

let id = null;
try {
  // ---------- the program (W1's sample text), live today ----------
  const c = await admin('POST', 'bread/programs', { name: '[فحص W5] ' + PROTO.PROGRAM.name, days: 30 });
  check('create the program', c.status === 200, c.body);
  id = c.body.program.id;
  for (let i = 1; i <= 30; i += 20) {
    const r = await admin('POST', `bread/programs/${id}/topics`, { topics: Array.from({ length: Math.min(20, 31 - i) }, (_, k) => sampleTopic(i + k, PROTO.TOPICS[(i + k - 1) % 7])) });
    check(`upload days ${i}–${Math.min(30, i + 19)}`, r.status === 200, r.body);
  }
  const a = await admin('POST', `bread/programs/${id}/activate`, { mode: 'now' });
  check('activate now', a.status === 200, a.body);
  const sw = await admin('POST', 'bread/settings', { module: true });
  check('BREAD_MODULE = 1 on Staging (only here)', sw.status === 200 && sql("SELECT value FROM settings WHERE key = 'BREAD_MODULE'")[0].value === '1', sw.body);
  const seed = seedFor(id, 30, 0, 0);
  const n = orderFor(seed, id, 30)[0] + 1;

  // ---------- no account ----------
  const s1 = await open('/daily-bread/?from=push', { seed });
  await s1.page.waitForSelector('.br-intro', { timeout: 25000 });
  check('the intro plays on a new entry (?from=push)', true);
  await s1.page.waitForSelector('.br-dawn', { timeout: 25000 });
  await s1.page.waitForFunction(() => !document.querySelector('.br-intro'), { timeout: 10000 });
  check('today: the seed\'s own topic from the Staging Worker', (await text(s1.page, '.br-title')) === PROTO.TOPICS[(n - 1) % 7].title, await text(s1.page, '.br-title'));
  check('«اليوم ١ من ٣٠»', /اليوم ١ من ٣٠/.test(await text(s1.page, '.br-day')), await text(s1.page, '.br-day'));
  await sleep(1500);
  await s1.page.click('[data-act="read"]');
  await sleep(2500);
  await s1.page.screenshot({ path: SHOTS + 'today-390.png' });
  const daily = () => sql(`SELECT opens, reads, reflections FROM bread_daily WHERE program_id = '${id}'`)[0] || {};
  const d1 = daily();
  check('the open beacon and «قريت» counted once each', d1.opens === 1 && d1.reads === 1, d1);
  check('no page errors (no account)', !s1.errors.length, s1.errors);
  await s1.page.reload({ waitUntil: 'domcontentloaded' });
  await s1.page.waitForSelector('.br-dawn', { timeout: 25000 });
  await sleep(2000);
  check('a second open the same day is not counted again', daily().opens === 1, daily());
  await s1.ctx.close();

  // ---------- a member: reflection, edit, the lock, the look ----------
  const m = await member();
  const s2 = await open('/daily-bread/?intro=0#reflect', { seed, m, width: 1440, height: 900 });
  await s2.page.waitForSelector('[data-act="send"]', { timeout: 25000 });
  await s2.page.type('.br-field textarea', 'تأمل فحص W5 على Staging');
  await s2.page.click('[data-act="send"]');
  await s2.page.waitForSelector('.br-sent', { timeout: 15000 });
  const row = sql(`SELECT id, text, state FROM bread_reflections WHERE participant_id = '${m.id}' AND program_id = '${id}'`)[0];
  check('the reflection is saved, eligible', row && row.text === 'تأمل فحص W5 على Staging' && row.state === 'eligible', row);
  await s2.page.screenshot({ path: SHOTS + 'reflect-1440.png' });
  await s2.page.click('[data-act="edit"]');
  await s2.page.$eval('.br-field textarea', t => { t.value = 'تأمل فحص W5 بعد التعديل'; t.dispatchEvent(new Event('input', { bubbles: true })); });
  await s2.page.click('[data-act="save"]');
  await sleep(2500);
  check('the edit is saved', sql(`SELECT text FROM bread_reflections WHERE id = '${row.id}'`)[0].text === 'تأمل فحص W5 بعد التعديل');
  sql(`UPDATE bread_reflections SET created_ms = created_ms - 1260000 WHERE id = '${row.id}'`);
  await s2.page.reload({ waitUntil: 'domcontentloaded' });
  await s2.page.waitForSelector('.br-locked', { timeout: 25000 });
  check('after 20 minutes it is locked (no edit, no delete)', !(await s2.page.$('[data-act="edit"]')) && !(await s2.page.$('[data-act="delete"]')));
  const del = await call('POST', '/v1/bread/reflection/delete', { id: row.id }, m.token);
  check('the Worker refuses a late delete', del.status === 409 && del.body.code === 'locked', del.body);
  await s2.page.goto(SITE + '/daily-bread/?s=reminders&intro=0', { waitUntil: 'domcontentloaded' });
  await s2.page.waitForSelector('[data-act="look-dawn"]', { timeout: 25000 });
  await sleep(1500);
  await s2.page.evaluate(() => document.querySelector('[data-act="look-dawn"]').click());
  await sleep(2500);
  check('the look is saved to the account (prefs.bread_look)', sql(`SELECT bread_look FROM participants WHERE id = '${m.id}'`)[0].bread_look === 'dawn');
  await s2.page.screenshot({ path: SHOTS + 'settings-dawn-1440.png' });
  check('no page errors (member)', !s2.errors.length, s2.errors);
  await s2.ctx.close();

  // ---------- the home card and the menu ----------
  const s3 = await open('/index.html', { seed });
  await s3.page.waitForSelector('.br-home', { timeout: 30000 });
  check('the home card shows today\'s topic', (await text(s3.page, '.br-home')).includes(PROTO.TOPICS[(n - 1) % 7].title));
  await s3.page.evaluate(() => document.querySelector('.br-home').scrollIntoView({ block: 'center' }));
  await sleep(800);
  await s3.page.screenshot({ path: SHOTS + 'home-390.png' });
  await (await s3.page.waitForSelector('.tabbar [aria-haspopup="dialog"]', { timeout: 10000 })).click();
  check('«المزيد» lists «خبزنا اليومي»', !!(await s3.page.waitForSelector('dialog.nav-more a[href$="/daily-bread/"]', { timeout: 10000 }).catch(() => null)));
  await s3.ctx.close();
  check('no push was started for the program', sql("SELECT COUNT(*) AS n FROM push_sends WHERE ref LIKE 'bread:%'")[0].n === 0);
}
catch (err) {
  check('no exception', false, String(err && err.stack || err));
}
finally {
  await browser.close().catch(() => {});
  site.close();
  if (id) {
    await admin('POST', `bread/programs/${id}/stop`, { confirm: true }).catch(() => {});
    sql(`DELETE FROM bread_reflections WHERE program_id = '${id}'`);
    sql(`DELETE FROM bread_members WHERE program_id = '${id}'`);
    sql(`DELETE FROM bread_daily WHERE program_id = '${id}'`);
    sql(`DELETE FROM bread_opens WHERE program_id = '${id}'`);
    sql(`DELETE FROM bread_topics WHERE program_id = '${id}'`);
    sql(`UPDATE bread_programs SET purged_ms = ${Date.now()} WHERE id = '${id}'`);
  }
  await admin('POST', 'bread/settings', { module: moduleBefore === '1' }).catch(() => {});
  const after = sql("SELECT value FROM settings WHERE key = 'BREAD_MODULE'")[0];
  check('BREAD_MODULE back to ' + moduleBefore, after && after.value === moduleBefore, after);
  const g2 = Object.fromEntries(sql("SELECT key, value FROM settings WHERE key IN ('NOTIFY_ROUTER', 'BREAD_PUSH')").map(r => [r.key, r.value]));
  check('NOTIFY_ROUTER and BREAD_PUSH untouched', g2.NOTIFY_ROUTER === guard.NOTIFY_ROUTER && g2.BREAD_PUSH === guard.BREAD_PUSH, g2);
}
console.log(failed ? `\n${failed} FAILED` : '\nALL OK');
process.exit(failed ? 1 : 0);
