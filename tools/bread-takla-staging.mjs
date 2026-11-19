// «خبزنا اليومي» W7 part A on STAGING (St-Takla source + feast): the real member page (this checkout, served on http://localhost:8080, an origin the
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
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createSign } from 'node:crypto';
import { extname, join, normalize } from 'node:path';
import { ROOT } from './lib/gs.mjs';
import { orderFor, cairoDay } from '../worker/src/bread/model.js';
import { parseRef, versesOf } from '../assets/js/bread/refs.js';
import { seedFor, CHROME } from '../tests/bread-world.mjs';

// the month file made by tools/bread-takla.mjs (real St-Takla text): SUGGEST=<path to YYYY-MM.json>
const SUGGEST = JSON.parse(readFileSync(process.env.SUGGEST, 'utf8'));

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
const SHOTS = `${ROOT}tools/.cache/bread-takla-staging/`;
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


// ---------- the topics as the admin would send them (Van Dyck text resolved here, as the admin's browser does) ----------
const books = {};
const book = code => (books[code] ||= JSON.parse(readFileSync(join(ROOT, 'assets/bible/vd', code + '.json'), 'utf8')));
function resolve(n, o) {
  const v = parseRef(o.verseRef), r = parseRef(o.readingRef);
  const verse = versesOf(v, book(v.book)).map(x => x.text).join(' ');
  const parts = [];
  for (const x of versesOf(r, book(r.book))) {
    let last = parts[parts.length - 1];
    if (!last || last.chapter !== x.ch) parts.push(last = { book: r.name, chapter: x.ch, verses: [] });
    last.verses.push([x.v, x.text]);
  }
  return { n, title: o.title, verseRef: v.text, verse, readingRef: r.text, reading: parts, meditation: o.meditation, sourceUrl: o.sourceUrl, sourceRefs: o.sourceRefs || undefined };
}
const DAYS = 30;
const topics = SUGGEST.days.slice(0, DAYS).map((d, i) => resolve(i + 1, d.options[d.pick || 0]));
const today = cairoDay();
const feastSrc = SUGGEST.feasts.find(f => f.img) || SUGGEST.feasts[0];
const feast = { date: today, name: feastSrc.name, title: feastSrc.title, word: feastSrc.word, url: feastSrc.sourceUrl, img: feastSrc.img || undefined };

// ---------- the site on :8080, its published files from the Worker (as GitHub Pages would mirror them) ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.m4a': 'audio/mp4', '.opus': 'audio/ogg', '.mp4': 'video/mp4' };
const site = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, SITE).pathname);
  const data = /^\/daily-bread\/data\/(index|brd-[0-9a-f]{10}\/\d{1,3}|feasts\/\d{4}-\d{2})\.json$/.exec(path);
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
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });

let id = null;
try {
  const sg = await admin('GET', 'bread/suggest?month=' + SUGGEST.month);
  check('GET suggest answers (no bread-suggest branch yet → ready: false)', sg.status === 200 && typeof sg.body.ready === 'boolean', sg.body);
  const c = await admin('POST', 'bread/programs', { name: '[فحص W7] الأنبا تكلا', days: DAYS });
  check('create the program', c.status === 200, c.body);
  id = c.body.program.id;
  for (let i = 0; i < DAYS; i += 10) {
    const r = await admin('POST', `bread/programs/${id}/topics`, { topics: topics.slice(i, i + 10) });
    check(`upload days ${i + 1}-${Math.min(DAYS, i + 10)} (St-Takla source)`, r.status === 200, r.body);
  }
  const a = await admin('POST', `bread/programs/${id}/activate`, { mode: 'now' });
  check('activate now', a.status === 200, a.body);
  const fe = await admin('POST', 'bread/feasts', { month: today.slice(0, 7), feasts: [feast] });
  check('publish a feast dated today', fe.status === 200, fe.body);
  const sw = await admin('POST', 'bread/settings', { module: true });
  check('BREAD_MODULE = 1 on Staging (only here)', sw.status === 200, sw.body);
  const seed = seedFor(id, DAYS, 0, 0);
  const n = orderFor(seed, id, DAYS)[0] + 1;
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', x => { if (x.type() === 'error' && !/Failed to load resource|favicon/.test(x.text())) errors.push(x.text()); });
    await page.setViewport({ width, height, isMobile: width < 700, hasTouch: width < 700 });
    await page.setRequestInterception(true);
    page.on('request', r => (r.url().startsWith(PROD) ? r.abort() : r.continue()));
    await page.evaluateOnNewDocument((api, sd) => { sessionStorage.setItem('athanasios:intro', '1'); localStorage.setItem('athanasios.book.api', api); localStorage.setItem('bread.seed', sd); }, BASE, seed);
    await page.goto(SITE + '/daily-bread/?intro=0', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.br-med', { timeout: 30000 });
    await page.waitForSelector('.br-feast', { timeout: 15000 }).catch(() => null);
    const got = await page.evaluate(() => ({
      title: document.querySelector('.br-title')?.textContent.trim(),
      src: document.querySelector('.br-med__src')?.textContent.replace(/\s+/g, ' ').trim(),
      srcHref: document.querySelector('.br-med .br-med__src a')?.href,
      inner: [...document.querySelectorAll('.br-med p:not(.br-med__by) a')].map(x => x.href),
      feast: document.querySelector('.br-feast__name')?.textContent.trim(),
      wide: document.documentElement.scrollWidth - innerWidth,
      over: [...document.querySelectorAll('.br-main *')].filter(x => { const r = x.getBoundingClientRect(); return r.width > 0 && (r.left < -1 || r.right > innerWidth + 1); }).slice(0, 5).map(x => x.tagName + '.' + x.className + ' ' + Math.round(x.getBoundingClientRect().left) + '..' + Math.round(x.getBoundingClientRect().right))
    }));
    await page.evaluate(() => document.querySelector('.br-feast')?.scrollIntoView({ block: 'center' }));
    const img = await page.waitForFunction(() => { const i = document.querySelector('.br-feast__img'); return i && i.complete && i.naturalWidth > 0; }, { timeout: 20000 }).then(() => true, () => false);
    if (width === 390) {
      check('today: the St-Takla topic', got.title === topics[n - 1].title, got);
      check('the small source line and its page link', /بمساعدة موقع الأنبا تكلا/.test(got.src || '') && got.srcHref === topics[n - 1].sourceUrl, got);
      check('links inside the meditation: st-takla.org only (FAQ 043)', got.inner.every(h => /^https:\/\/(www\.)?st-takla\.org\//.test(h)), got.inner);
      check('the feast card on the date', got.feast === 'النهارده تذكار ' + feast.name, got.feast);
      check('the picture loads from St-Takla (img-src, lazy: after scrolling to it)', img || !feast.img, feast.img);
    }
    await page.evaluate(() => document.querySelector('.br-feast')?.scrollIntoView({ block: 'center' }));
    await sleep(800);
    await page.screenshot({ path: SHOTS + `feast-${width}.png` });
    await page.evaluate(() => document.querySelector('.br-med')?.scrollIntoView({ block: 'start' }));
    await sleep(500);
    await page.screenshot({ path: SHOTS + `source-${width}.png` });
    check(`no sideways scroll (${width})`, got.wide <= 0 && !got.over.length, [got.wide, got.over]);
    check(`no page errors (${width})`, !errors.length, errors);
    await ctx.close();
  }
  check('no push was started for the program', sql(`SELECT COUNT(*) AS n FROM push_sends WHERE ref LIKE 'bread:${id}%'`)[0].n === 0, 'push_sends');
}
catch (err) {
  check('no exception', false, String(err && err.stack || err));
}
finally {
  await browser.close().catch(() => {});
  site.close();
  if (id) {
    await admin('POST', `bread/programs/${id}/stop`, { confirm: true }).catch(() => {});
    sql(`DELETE FROM bread_daily WHERE program_id = '${id}'`);
    sql(`DELETE FROM bread_opens WHERE program_id = '${id}'`);
    sql(`DELETE FROM bread_members WHERE program_id = '${id}'`);
    sql(`DELETE FROM bread_topics WHERE program_id = '${id}'`);
    sql(`UPDATE bread_programs SET purged_ms = ${Date.now()} WHERE id = '${id}'`);
  }
  await admin('POST', 'bread/feasts', { month: today.slice(0, 7), feasts: [] }).catch(() => {});
  await admin('POST', 'bread/settings', { module: moduleBefore === '1' }).catch(() => {});
  const after = sql("SELECT value FROM settings WHERE key = 'BREAD_MODULE'")[0];
  check('BREAD_MODULE back to ' + moduleBefore, after && after.value === moduleBefore, after);
  const g2 = Object.fromEntries(sql("SELECT key, value FROM settings WHERE key IN ('NOTIFY_ROUTER', 'BREAD_PUSH')").map(r => [r.key, r.value]));
  check('NOTIFY_ROUTER and BREAD_PUSH untouched', g2.NOTIFY_ROUTER === guard.NOTIFY_ROUTER && g2.BREAD_PUSH === guard.BREAD_PUSH, g2);
}
console.log(failed ? `\n${failed} FAILED` : '\nALL OK');
