// «خبزنا اليومي» W4 — the admin section against the STAGING Worker, in a real browser (docs/daily-bread/PLAN.md §3 W4).
// This branch's /admin/ served locally; every Worker call goes to staging (proxied from here with the site's origin,
// signed in as the staging test admin with the staging test key, like worker/scripts/bread-check.mjs). The fake Apps
// Script world only draws the panel around it. Nothing is published to the site; BREAD_MODULE / BREAD_PUSH and the
// NOTIFY_* / PUSH_* / PERMS_ENFORCE settings are never touched, and it refuses to run if staging could send a push.
//
//   a 7-day program from an Excel file → the review (Van Dyck text, preview) → the upload in parts → «بعد الحالي»
//   (nothing live: starts today) → «البرامج», «المواضيع», the numbers, the reflections, the settings → stop (typed)
//   → its rows removed (the name stays, purged), like bread-check.
//
// Run:  cd tools && node bread-admin-staging.mjs        (keys: STAGING_KEYS_DIR, else ../worker/.staging-test-key.pem)
// Shots: tools/.cache/bread-staging/
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createSign } from 'node:crypto';
import { ROOT } from './lib/gs.mjs';
import { createSiteServer, interceptGoogle, TEST_API, TEST_FALLBACK } from './lib/admin-server.mjs';
import { createWorld } from '../tests/fakes/gas.mjs';
import { writeXlsx } from '../admin/xlsx.js';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');
const STAGING = 'https://athanasios-api-staging.menazak-lab.workers.dev';
const SITE = 'https://stathanasiosyouth.github.io';
const CLIENT_ID = '246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com';
const ADMIN = 'loadtest@staging.invalid';
const PORT = 4745;
const LOCAL = `http://127.0.0.1:${PORT}`;
const KEYS = process.env.STAGING_KEYS_DIR || `${ROOT}worker`;
const PEM = readFileSync(join(KEYS, '.staging-test-key.pem'), 'utf8');
const SHOTS = `${ROOT}tools/.cache/bread-staging/`;
const RUN = Date.now().toString(36);
const NAME = '[فحص W4] برنامج ' + RUN;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find(existsSync);
mkdirSync(SHOTS, { recursive: true });

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  ' + JSON.stringify(detail).slice(0, 400)));
  if (!ok) failed++;
}
function sql(command) {
  const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'athanasios-staging', '--remote', '--env', 'staging', '--json', '--command', `"${command}"`], { shell: true, encoding: 'utf8', cwd: `${ROOT}worker` });
  if (r.status !== 0) throw new Error('d1: ' + String(r.stderr).slice(0, 300));
  return JSON.parse(r.stdout)[0].results;
}

// ---------- guards: no real notification can leave, nothing live to disturb ----------
const guard = Object.fromEntries(sql("SELECT key, value FROM settings WHERE key IN ('NOTIFY_ROUTER', 'PUSH_SENDER', 'BREAD_PUSH', 'BREAD_MODULE')").map(r => [r.key, r.value]));
if (guard.NOTIFY_ROUTER === '1' || guard.PUSH_SENDER === 'worker' || (guard.BREAD_PUSH || '0') !== '0') {
  console.error('refusing: staging could send a real push now', JSON.stringify(guard));
  process.exit(2);
}
if (sql("SELECT id FROM bread_programs WHERE status = 'scheduled'").length) { console.error('refusing: staging already has a scheduled program'); process.exit(2); }
check('guards: no push possible, nothing scheduled; BREAD_MODULE stays ' + (guard.BREAD_MODULE || '0'), true);

// ---------- the staging test admin's Google token ----------
const now = Math.floor(Date.now() / 1000);
const claims = { iss: 'https://accounts.google.com', aud: CLIENT_ID, azp: CLIENT_ID, sub: 'loadtest-1', email: ADMIN, email_verified: true, name: 'check', iat: now, exp: now + 3600 };
const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url');
const head = b64({ alg: 'RS256', kid: 'staging-test', typ: 'JWT' }) + '.' + b64(claims);
const TOKEN = head + '.' + createSign('RSA-SHA256').update(head).sign(PEM).toString('base64url');

const world = createWorld({ owner: ADMIN, executeAs: 'USER_DEPLOYING' });
world.as(ADMIN).gs.setup();
world.properties.set('SITE_URL', `${SITE}/`);
world.properties.set('ADMIN_CLIENT_ID', CLIENT_ID);
world.properties.set('ADMIN_EMAILS', ADMIN);
world.properties.set('ADMIN_NAMES', JSON.stringify({ [ADMIN]: 'فحص Staging' }));
world.as('');
world.idTokens.set(TOKEN, Object.fromEntries(Object.entries(claims).map(([k, v]) => [k, String(v)])));

const server = createSiteServer({
  world: { issueToken: () => TOKEN, get github() { return world.github; } },
  config: () => ({ apiUrl: TEST_API, clientId: CLIENT_ID, fallbackUrl: TEST_FALLBACK, workerUrl: STAGING })
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const calls = [];

/* the panel's Worker calls → staging, from here, with the site's origin (staging allows only the site) */
async function handle(request) {
  const url = request.url();
  if (!url.startsWith(STAGING + '/')) return null;
  const cors = { 'access-control-allow-origin': LOCAL, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization, content-type, idempotency-key, accept, x-edit-session', 'access-control-allow-methods': 'GET, POST, DELETE' };
  if (request.method() === 'OPTIONS') return { status: 204, headers: cors, body: '' };
  const headers = { ...request.headers(), origin: SITE };
  delete headers.host;
  const body = request.method() === 'GET' ? undefined : (request.postData() ?? (request.hasPostData() ? await request.fetchPostData() : undefined));
  const res = await fetch(url, { method: request.method(), headers, body });
  const out = {};
  res.headers.forEach((v, k) => { if (!/^(content-length|content-encoding|transfer-encoding|connection|access-control-)/i.test(k)) out[k] = v; });
  const buf = Buffer.from(await res.arrayBuffer());
  calls.push({ method: request.method(), path: new URL(url).pathname, status: res.status });
  return { status: res.status, headers: { ...out, ...cors }, body: buf };
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const problems = [];
let programId = null;
try {
  const page = await browser.newPage();
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('dialog', async d => { problems.push('native ' + d.type()); await d.dismiss(); });
  await page.setViewport({ width: 1440, height: 900 });
  await interceptGoogle(page, { post: body => world.post(body) }, { handle });
  await page.goto(`${LOCAL}/admin/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.gis-stub');
  await page.click('.gis-stub');
  await page.waitForFunction(() => window.A && A.state && !document.getElementById('shell').hidden, { timeout: 30000 });
  await page.waitForFunction(() => A.bread && (A.bread.programs || A.bread.programsError), { timeout: 30000 });
  await sleep(2500);
  await page.addStyleTag({ content: '*, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; } .intro, .p8intro { display: none !important; }' });
  const shot = async name => { await page.evaluate(() => { const t = document.getElementById('toasts'); if (t) t.replaceChildren(); }); await page.mouse.move(2, 2); await sleep(600); await page.screenshot({ path: SHOTS + name + '.png' }); };
  check('the panel reads the programs from staging', await page.evaluate(() => !!A.bread.programs), await page.evaluate(() => A.bread.programsError && A.bread.programsError.message));
  check('the section is in the rail', await page.evaluate(() => !!document.querySelector('#rail-nav [data-area="bread"]')));

  await page.evaluate(() => A.go('bread', 'breadprograms'));
  await sleep(1500);
  await shot('1-programs-before');

  // ---------- a file: 7 days, the text from Van Dyck ----------
  const rows = [['أنا هو خبز الحياة', 'يوحنا ٦: ٣٥', 'يوحنا ٦: ٣٢–٣٥'], ['خبزنا كفافنا', 'متى ٦: ١١', 'متى ٦: ٩–١٣'], ['الرب راعيّ', 'مزمور ٢٣: ١', 'مزمور ٢٣: ١–٤'], ['تعالوا إليّ', 'متى ١١: ٢٨', 'متى ١١: ٢٨–٣٠'],
    ['اثبتوا فيّ', 'يوحنا ١٥: ٥', 'يوحنا ١٥: ٤–٥'], ['نور العالم', 'يوحنا ٨: ١٢', 'يوحنا ٨: ١٢–٢٠'], ['الابن الضال', 'لوقا ١٥: ٢٠', 'لوقا ١٥: ١١–٢٤']];
  const file = join(mkdtempSync(join(tmpdir(), 'bread-staging-')), 'w4-check.xlsx');
  writeFileSync(file, writeXlsx({ sheets: [{ name: 'البرنامج', rtl: true, header: true, rows: [['رقم', 'العنوان', 'مرجع الآية', 'مرجع القراءة', 'التأمل', 'السؤال (اختياري)'], ...rows.map((r, i) => [i + 1, ...r, '[فحص Staging] تأمل اليوم ' + (i + 1), i % 2 ? 'سؤال فحص؟' : ''])] }] }));
  await page.evaluate(() => { A.go('bread', 'breadnew'); A.bread.wiz.step = 2; A.render(); });
  await page.type('[data-act="bread-name"]', NAME);
  const input = await page.waitForSelector('input[type=file][data-act="bread-file"]');
  await input.uploadFile(file);
  await page.waitForFunction(() => A.bread.wiz.step === 3 && document.querySelector('.ba-table'), { timeout: 30000 });
  const sum = await page.$eval('.ba-sum', n => n.innerText);
  check('review: 7 days, no red row', /٧ يوم|٧ أيام/.test(sum) && !/لازم يتصلّحوا/.test(sum), sum);
  const frame = await (await page.$('.ba-phone iframe')).contentFrame();
  await frame.waitForFunction(() => document.querySelector('.br-title'), { timeout: 15000 });
  await shot('2-review');

  // ---------- upload in parts + activate «after» (nothing live → today) ----------
  await page.click('[data-act="bread-to-activate"]');
  await page.waitForFunction(() => A.bread.wiz.step === 4, { timeout: 60000 });
  programId = await page.evaluate(() => A.bread.wiz.program);
  check('the draft and its days reached staging', /^brd-[0-9a-f]{10}$/.test(programId || '') && calls.some(c => c.method === 'POST' && /\/topics$/.test(c.path) && c.status === 200), calls.filter(c => c.method === 'POST'));
  await shot('3-activate');
  await page.click('[data-act="bread-activate"]');
  await page.waitForFunction(() => A.sub.bread === 'breadprograms' && document.querySelector('.ba-hero'), { timeout: 60000 });
  await sleep(1500);
  const live = await page.$eval('.ba-hero', n => n.innerText);
  check('the program is live today on staging («١ من ٧»)', live.includes(NAME) && /١\s*من ٧ يوم/.test(live), live.slice(0, 300));
  const row = sql(`SELECT status, starts_on, ends_on, created_by FROM bread_programs WHERE id = '${programId}'`)[0];
  check('D1: scheduled from today for 7 days, by the test admin', row && row.status === 'scheduled' && row.created_by === ADMIN, row);
  const days = sql(`SELECT n, verse_text, reading_json FROM bread_topics WHERE program_id = '${programId}' ORDER BY n`);
  const jhn = JSON.parse(readFileSync(`${ROOT}assets/bible/vd/JHN.json`, 'utf8'));
  check('D1: the 7 days, day 1 = Van Dyck John 6:35 and its reading 32–35', days.length === 7 && days[0].verse_text === jhn.chapters[5][34] && JSON.parse(days[0].reading_json)[0].verses.map(v => v[0]).join() === '32,33,34,35', days[0]);
  await shot('4-programs-live');

  // «المواضيع»
  await page.click('.ba-hero .p8-card__acts .btn');
  await page.waitForFunction(() => document.querySelectorAll('#sheet[open] .ba-table tbody tr').length === 7, { timeout: 30000 });
  await shot('5-topics');
  await page.evaluate(() => A.closeSheet());

  // the other tabs
  for (const [sub, name] of [['breadstats', '6-stats'], ['breadrefl', '7-reflections'], ['breadsettings', '8-settings']]) {
    await page.evaluate(s => A.go('bread', s), sub);
    await sleep(3000);
    await shot(name);
  }
  check('stats answered', calls.some(c => c.path === '/v1/admin/bread/stats' && c.status === 200));
  check('reflections answered (and logged)', calls.some(c => c.path === '/v1/admin/bread/reflections' && c.status === 200) && sql(`SELECT COUNT(*) AS n FROM activity WHERE action = 'bread.reflections.view' AND entity_id = '${programId}'`)[0].n >= 1);

  // ---------- stop it (typed) ----------
  await page.evaluate(() => A.go('bread', 'breadprograms'));
  await page.waitForSelector('.ba-hero');
  await page.click('.ba-hero .p8-iconbtn');
  await page.waitForSelector('.menu--p8 .menu__item--danger');
  await page.click('.menu--p8 .menu__item--danger');
  await page.waitForSelector('dialog.modal[open] .modal__typed');
  await page.type('dialog.modal[open] .modal__typed', 'إيقاف');
  await page.click('dialog.modal[open] .modal__actions .btn--danger');
  await page.waitForFunction(() => !document.querySelector('.ba-hero') || !/شغال/.test(document.querySelector('.ba-hero').innerText), { timeout: 60000 });
  await sleep(1500);
  await shot('9-stopped');
  check('stopped from the panel', sql(`SELECT status FROM bread_programs WHERE id = '${programId}'`)[0].status === 'stopped');
  check('no push was started', sql("SELECT COUNT(*) AS n FROM push_sends WHERE ref LIKE 'bread:%'")[0].n === 0);
  check('no page error in the panel', problems.length === 0, problems);
} catch (err) {
  check('no exception', false, String(err && err.stack || err));
} finally {
  await browser.close();
  server.close();
  if (programId) {
    // back as it was (like bread-check): the program's rows go, its name stays (purged)
    sql(`UPDATE bread_programs SET status = 'stopped', ends_on = COALESCE(ends_on, starts_on), purged_ms = ${Date.now()} WHERE id = '${programId}' AND status IN ('scheduled', 'stopped')`);
    sql(`DELETE FROM bread_programs WHERE id = '${programId}' AND status IN ('draft', 'ready')`);
    for (const t of ['bread_reflections', 'bread_members', 'bread_daily', 'bread_opens', 'bread_topics']) sql(`DELETE FROM ${t} WHERE program_id = '${programId}'`);
  }
  const after = sql("SELECT key, value FROM settings WHERE key IN ('BREAD_MODULE', 'BREAD_PUSH')");
  check('BREAD_MODULE / BREAD_PUSH as they were', after.every(r => r.value === (r.key === 'BREAD_MODULE' ? (guard.BREAD_MODULE || '0') : '0')), after);
}
console.log(`program ${programId || '-'} · shots in tools/.cache/bread-staging/`);
console.log(failed ? `\n${failed} FAILED` : '\nALL OK');
process.exit(failed ? 1 : 0);
