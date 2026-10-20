// Manual QA (not part of the suites): «التقرير المجمّع» in the real admin UI
// (Chrome), its Worker calls proxied to the STAGING Worker with a staging test
// identity — so filters, masking and the audit are the real server's.
// Runs twice: the staging Primary (everything), then a restricted admin
// (bookings.view + exports.export only) with PERMS_ENFORCE=1 on staging,
// restored to 0 afterwards. Never touches production.
// Run: cd tools && node ../tests/report-staging.qa.mjs
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createSign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { ROOT } from '../tools/lib/gs.mjs';
import { createSiteServer, interceptGoogle, TEST_API, TEST_CLIENT, TEST_FALLBACK } from '../tools/lib/admin-server.mjs';
import { createWorld } from './fakes/gas.mjs';
import { readXlsx } from '../admin/xlsx.js';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');
const PORT = 4744;
const LOCAL = `http://127.0.0.1:${PORT}`;
const WORKER_URL = 'https://athanasios-api.menazak-lab.workers.dev';
const STAGING = 'https://athanasios-api-staging.menazak-lab.workers.dev';
const ADMIN = 'menazakmena@gmail.com';
const PRIMARY = 'loadtest@staging.invalid';
const RESTRICTED = `qa-report-${Date.now().toString(36)}@staging.invalid`;
const SHOTS = `${ROOT}tools/.cache/report-qa/`;
const PEM = readFileSync(new URL('../worker/.staging-test-key.pem', import.meta.url), 'utf8');
const CLIENT_ID = '246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com';
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find(existsSync);
const TIMING = { gisSlow: 700, gisFail: 2500, button: 3000, silent: 1500, slow: 900, fail: 15000, render: 15000, beat: 900, beatFail: 2500 };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function staffToken(email) {
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: 'RS256', kid: 'staging-test', typ: 'JWT' }) + '.' + enc({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: email === PRIMARY ? 'loadtest-1' : 'qa-' + email, email, email_verified: true, name: 'QA', iat: now, exp: now + 3600 });
  return 'Bearer ' + head + '.' + createSign('RSA-SHA256').update(head).sign(PEM).toString('base64url');
}
function sql(command) {
  const bin = fileURLToPath(new URL('../worker/node_modules/wrangler/bin/wrangler.js', import.meta.url));
  execFileSync(process.execPath, [bin, 'd1', 'execute', 'athanasios-staging', '--remote', '--env', 'staging', '--command', command], { cwd: fileURLToPath(new URL('../worker/', import.meta.url)), encoding: 'utf8' });
}
async function staging(email, method, path, body) {
  const r = await fetch(STAGING + path, { method, headers: { authorization: staffToken(email), origin: 'https://stathanasiosyouth.github.io', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
}

let as = PRIMARY;
const seen = [];
async function handle(request) {
  const url = new URL(request.url());
  if (url.origin !== WORKER_URL) return null;
  const cors = { 'access-control-allow-origin': LOCAL, 'access-control-allow-headers': 'authorization, content-type, idempotency-key, accept, x-edit-session', 'access-control-allow-methods': 'GET, POST, DELETE' };
  if (request.method() === 'OPTIONS') return { status: 204, headers: cors, body: '' };
  seen.push(request.method() + ' ' + url.pathname + url.search);
  const r = await fetch(STAGING + url.pathname + url.search, { method: request.method(), headers: { authorization: staffToken(as), 'content-type': 'application/json', origin: 'https://stathanasiosyouth.github.io' }, body: request.postData() || undefined });
  return { status: r.status, headers: { ...cors, 'content-type': r.headers.get('content-type') || 'application/json' }, body: Buffer.from(await r.arrayBuffer()) };
}

const world = createWorld({ executeAs: 'USER_DEPLOYING' });
world.as(ADMIN).gs.setup();
world.properties.set('ADMIN_CLIENT_ID', TEST_CLIENT);
world.properties.set('ADMIN_EMAILS', ADMIN);
world.properties.set('WORKER_SYNC_SECRET', 's'.repeat(48));
world.gs.SESSION_STALE_SECONDS = 0;
world.as('');
mkdirSync(SHOTS, { recursive: true });
const server = createSiteServer({
  world: { issueToken: c => world.issueToken(c), get github() { return world.github; } },
  config: () => ({ apiUrl: TEST_API, clientId: TEST_CLIENT, fallbackUrl: TEST_FALLBACK, timing: TIMING, workerUrl: WORKER_URL }),
  claims: () => ({ email: ADMIN })
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });

async function run(label, viewport) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', e => problems.push(e.message));
  await page.setViewport(viewport);
  await interceptGoogle(page, { post: body => world.post(body) }, { handle, outside: [] });
  await page.goto(`${LOCAL}/admin/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.gis-stub');
  await page.click('.gis-stub');
  await page.waitForFunction(() => window.A && A.state && !document.getElementById('shell').hidden, { timeout: 20000 });
  await page.evaluate(() => A.go('pages', 'finance'));
  await page.waitForSelector('.card--report', { timeout: 30000 }).catch(async e => {
    await page.screenshot({ path: `${SHOTS}${label}-stuck.png` });
    console.log('STUCK', JSON.stringify({ seen: seen.slice(-8), text: (await page.evaluate(() => document.querySelector('main') ? document.querySelector('main').innerText : document.body.innerText)).slice(0, 400), problems }));
    throw e;
  });
  await page.evaluate(() => document.querySelector('.card--report').scrollIntoView({ block: 'start' }));
  await sleep(500);
  await page.screenshot({ path: `${SHOTS}${label}.png` });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  // the same card on a phone-sized screen (same session)
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });   // (isMobile would reload the page)
  await sleep(600);
  await page.evaluate(() => document.querySelector('.card--report').scrollIntoView({ block: 'start' }));
  await sleep(300);
  await page.screenshot({ path: `${SHOTS}${label}-phone.png` });
  const phoneOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  await page.setViewport(viewport);
  await sleep(300);
  const ui = await page.evaluate(() => {
    const c = document.querySelector('.card--report');
    return { text: c.innerText, events: c.querySelectorAll('.grants__group input[type=checkbox]').length, selects: [...c.querySelectorAll('select')].map(s => s.options.length) };
  });
  // the status filter → confirmed, then the download
  await page.select('.card--report select[data-act="report-status"]', 'confirmed');
  await page.click('.card--report [data-act="report-download"]');
  await page.waitForFunction(() => [...document.querySelectorAll('dialog.modal .btn')].some(b => b.textContent.trim() === 'نزّل الملف'), { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll('dialog.modal .btn')].find(b => b.textContent.trim() === 'نزّل الملف').click());
  await page.waitForFunction(() => A.book.lastDownload && /^تقرير/.test(A.book.lastDownload.filename), { timeout: 60000 });
  const file = await page.evaluate(() => ({ filename: A.book.lastDownload.filename, bytes: Array.from(A.book.lastDownload.bytes) }));
  const book = await readXlsx(new Uint8Array(file.bytes));
  await context.close();
  return { problems, overflow, phoneOverflow, ui, file, book };
}

const checks = [];
const check = (name, ok, detail) => { checks.push([ok, name]); console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  ' + JSON.stringify(detail).slice(0, 300))); };
try {
  // 1. the Primary: everything
  as = PRIMARY;
  const p = await run('primary-desktop', { width: 1366, height: 900 });
  const sheets = p.book.sheets.map(s => s.name);
  check('UI: card, Arabic labels, filters filled', /التقرير المجمّع/.test(p.ui.text) && /من يوم/.test(p.ui.text) && p.ui.events > 0 && p.ui.selects.every(n => n > 1), p.ui);
  check('no page errors, no horizontal overflow (desktop)', !p.problems.length && !p.overflow, p.problems);
  check('the request carried the filter to the server', seen.some(s => /\/v1\/admin\/book\/report\?events=all&status=confirmed/.test(s)), seen.slice(-3));
  check('Primary: six sheets', sheets.join() === 'ملخص عام,حسب الفعالية,حسب الخادم,الحجوزات,الدفعات,الأقساط المتأخرة', sheets);
  const pb = p.book.sheets.find(s => s.name === 'الحجوزات').rows;
  check('Primary: only confirmed rows, full 01x phones', pb.slice(1).every(r => r[2] === 'مؤكد') && pb.slice(1).every(r => /^01\d{9}$/.test(String(r[pb[0].indexOf('الموبايل')]))), pb.slice(0, 3));

  check('phone: no horizontal overflow', !p.phoneOverflow);

  // 3. a restricted admin (bookings.view + exports.export), enforcing on staging
  const add = await staging(PRIMARY, 'POST', '/v1/admin/accounts', { email: RESTRICTED, grants: { 'bookings.view': 'all', 'events.view': 'all', 'exports.export': 'all' } });
  check('restricted admin created on staging', add.status === 200, add.body);
  sql("UPDATE settings SET value = '1' WHERE key = 'PERMS_ENFORCE'");
  as = RESTRICTED;
  const r = await run('restricted-desktop', { width: 1366, height: 900 });
  const rs = r.book.sheets.map(s => s.name);
  check('restricted: no money sheets', rs.join() === 'ملخص عام,حسب الفعالية,حسب الخادم,الحجوزات', rs);
  const rb = r.book.sheets.find(s => s.name === 'الحجوزات').rows;
  check('restricted: no money columns', !['المطلوب', 'المدفوع', 'الباقي', 'حالة الدفع', 'متأخر'].some(h => rb[0].includes(h)), rb[0]);
  check('restricted: phones masked', rb.slice(1).every(x => /•/.test(String(x[rb[0].indexOf('الموبايل')]))), rb.slice(1, 3));
  const flat = JSON.stringify(r.book.sheets.map(s => s.rows));
  check('restricted: no full phone anywhere in the file', !/01\d{9}/.test(flat));
  const note = Object.fromEntries(r.book.sheets[0].rows.slice(1))['ملاحظة'] || '';
  check('restricted: the summary says what is hidden', /الفلوس مش ظاهرة/.test(note) && /متخبية/.test(note), note);
  const forbidden = await staging(RESTRICTED, 'GET', '/v1/admin/book/finance?eventId=all');
  check('restricted: the finance screen route itself is refused (finance.view)', forbidden.status === 403, forbidden.body);
  const log = await staging(PRIMARY, 'GET', '/v1/admin/activity?view=log&limit=20');
  const mine = (log.body.items || []).filter(i => i.actor === RESTRICTED && i.action.startsWith('export.'));
  check('audit: the restricted download is export.bookings (routine), not PII', mine.length >= 1 && mine.every(i => i.action === 'export.bookings' && i.severity === 'routine'), mine);
} finally {
  sql("UPDATE settings SET value = '0' WHERE key = 'PERMS_ENFORCE'");
  await staging(PRIMARY, 'POST', `/v1/admin/accounts/${encodeURIComponent(RESTRICTED)}/remove`, {}).catch(() => {});
  await browser.close();
  server.close();
}
const failed = checks.filter(c => !c[0]).length;
console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
