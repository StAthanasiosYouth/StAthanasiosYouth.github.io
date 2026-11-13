// «دليل الأدمن»: the guide's screenshots, taken from the REAL admin panel (the same harness as tools/phase8-baseline.mjs:
// the real Worker code on SQLite, the fake Apps Script world), signed in as a demo admin with demo data only —
// no real name, email, phone or booking ever appears in a guide picture.
//
//   cd tools && node guide-shots.mjs              every shot of tools/source/admin-guide.mjs → admin/guide/<id>-d.webp / -m.webp
//   GUIDE_ONLY=news-add,publish node guide-shots.mjs   only those shot ids
//   GUIDE_SURVEY=1 node guide-shots.mjs           every screen (desktop 1440 + phone 390) as PNG in tools/.cache/guide-survey/ (for writing the articles)
//
// A shot: { id, go: 'content:news', run: '<js run on the screen, may return a promise>', mark: '<css selector of the spot to press>',
//           phone: { go, run, mark } (the phone's own way, when it differs) }. The marked spot gets a ring and a soft
// glow drawn over the page before the picture (the panel itself is not changed).
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, createSign, createHmac } from 'node:crypto';
import { ROOT } from './lib/gs.mjs';
import { createSiteServer, interceptGoogle, TEST_CLIENT } from './lib/admin-server.mjs';
import { createWorld } from '../tests/fakes/gas.mjs';
import { handle as workerHandle } from '../worker/src/index.js';
import { resetAuthCaches, GOOGLE_JWKS_URL } from '../worker/src/lib/auth.js';
import { migratedDb } from '../worker/test/d1-sqlite.mjs';
import GUIDE from './source/admin-guide.mjs';
import { adminApi, scoredComp, wallAt } from '../tests/fakes/comp.mjs';
import { compImportTick } from '../worker/src/content/compdrafts.js';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');
const SURVEY = !!process.env.GUIDE_SURVEY;
const OUT = SURVEY ? fileURLToPath(new URL('./.cache/guide-survey/', import.meta.url)) : (process.env.GUIDE_OUT || fileURLToPath(new URL('../admin/guide/', import.meta.url)));
const ONLY = (process.env.GUIDE_ONLY || '').split(',').filter(Boolean);
const PORT = 4614;
const LOCAL = `http://127.0.0.1:${PORT}`;
const SITE = 'https://stathanasiosyouth.github.io';
const WORKER_URL = 'https://athanasios-api.menazak-lab.workers.dev';
const ADMIN = 'demo.admin@example.com';
const SECRET = 's'.repeat(48);
const TIMING = { gisSlow: 700, gisFail: 2500, button: 3000, silent: 1500, slow: 900, fail: 8000, render: 8000, beat: 900, beatFail: 2500 };
const WIDTHS = { d: { width: 1440, height: 900 }, m: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } };
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = { ...publicKey.export({ format: 'jwk' }), kid: 'e2e', alg: 'RS256', use: 'sig' };
const jwksFetch = async url => {
  if (url !== GOOGLE_JWKS_URL) throw new Error('unexpected fetch ' + url);
  return new Response(JSON.stringify({ keys: [JWK] }), { headers: { 'cache-control': 'max-age=3600' } });
};
let world, env;

function issueToken(c) {
  const now = Math.floor(Date.now() / 1000);
  const full = { iss: 'https://accounts.google.com', aud: TEST_CLIENT, azp: TEST_CLIENT, sub: 'sub-' + c.email, email: c.email, email_verified: true, name: 'خادم تجريبي', iat: now, exp: now + 3600 };
  const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url');
  const head = b64({ alg: 'RS256', kid: 'e2e', typ: 'JWT' }) + '.' + b64(full);
  const token = head + '.' + createSign('RSA-SHA256').update(head).sign(privateKey).toString('base64url');
  world.idTokens.set(token, Object.fromEntries(Object.entries(full).map(([k, v]) => [k, typeof v === 'number' || typeof v === 'boolean' ? String(v) : v])));
  return token;
}
async function call(path, init) {
  const waits = [];
  const res = await workerHandle(new Request(WORKER_URL + path, init), env, { waitUntil: p => waits.push(p) }, { fetch: jwksFetch });
  await Promise.all(waits);
  return res;
}
async function worker(request) {
  if (!request.url().startsWith(WORKER_URL + '/')) return null;
  const init = { method: request.method(), headers: request.headers() };
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) init.body = request.postData() ?? (request.hasPostData() ? await request.fetchPostData() : undefined);
  const res = await call(request.url().slice(WORKER_URL.length), init);
  const headers = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  return { status: res.status, headers, body: Buffer.from(await res.arrayBuffer()) };
}

resetAuthCaches();
env = { ENVIRONMENT: 'test', ALLOWED_ORIGINS: SITE, GOOGLE_CLIENT_ID: TEST_CLIENT, LOG_SALT: 'salt', ADMIN_EMAILS: '', SYNC_SECRET: SECRET, DEVICE_KEY: 'k'.repeat(48), DB: migratedDb(), JOBS: { send: async () => {} }, COMPS_SOURCE: 'none', SITE_URL: SITE, PW_PEPPER: 'pepper', PW_KEY: Buffer.alloc(32, 7).toString('base64'), OTP_PEPPER: 'otp', ACCOUNT_PAD_MS: '0' };
env.DB.raw.exec(`INSERT INTO admins (email, name, role, active, created_at) VALUES ('${ADMIN}', 'خادم تجريبي', 'primary', 1, 0);
  UPDATE settings SET value = '1' WHERE key = 'ADMIN_PLATFORM';`);
world = createWorld({ executeAs: 'USER_DEPLOYING' });
// the fake Apps Script world is set up by its built-in primary (nothing of it is shown); the panel runs as the demo admin
world.as('menazakmena@gmail.com').gs.setup();
world.properties.set('ADMIN_EMAILS', ADMIN + ',menazakmena@gmail.com');
world.properties.set('SITE_URL', `${SITE}/`);
world.properties.set('ADMIN_CLIENT_ID', TEST_CLIENT);
// demo data only
world.gs.apiSaveItem('news', { id: 'news-aaaa1111', title: 'رحلة الصيف', summary: 'سجّل اسمك قبل الخميس' });
world.gs.apiSaveItem('news', { id: 'news-bbbb2222', title: 'مؤتمر الشباب', summary: 'الجمعة الجاية الساعة ٦' });
world.gs.apiSaveItem('notifications', { title: 'بوستر المؤتمر نزل', type: 'important', target: 'https://example.org/poster' });
// «المسابقات»: one demo competition (made-up questions), made in the fake Apps Script world and moved to the local Worker below
// the same way production moved them (compImportTick) — all in memory, nothing real is read or written
world.as('');
{
  const gcall = adminApi(world);
  gcall('apiCompSettings', { registry: true, wallet: true });
  scoredComp(gcall, { title: 'مسابقة تجريبية', slug: 'demo-quiz', description: 'مسابقة للتجربة', startAt: wallAt(world, -60), endAt: wallAt(world, 1440) });
}
world.properties.set('WORKER_SYNC_SECRET', SECRET);
world.properties.set('ADMIN_PLATFORM', 'worker');
world.gs.API_REQUEST_ = null;
{
  const raw = JSON.stringify({ mode: 'apply', ...JSON.parse(JSON.stringify(world.gs.contentExportPayload_())) });
  const ts = String(Date.now());
  const sig = 'v1=' + createHmac('sha256', SECRET).update(ts + '.' + raw).digest('hex');
  const imp = await call('/v1/sync/content-import', { method: 'POST', body: raw, headers: { 'x-sync-ts': ts, 'x-sync-signature': sig } });
  if ((await imp.json()).state !== 'ok') throw new Error('content import failed');
  env.DB.raw.exec("UPDATE settings SET value = '1' WHERE key = 'CONTENT_DRAFTS'");
  {
    const APPS = 'https://script.google.test/macros/s/demo/exec';
    env.APPS_SCRIPT_URL = APPS;
    world.properties.set('CONTENT_WRITER', 'worker');
    const appsFetch = async (url, init) => {
      if (url !== APPS) throw new Error('unexpected fetch ' + url);
      const reply = world.post(JSON.parse(init.body));
      delete reply.mime;
      return new Response(JSON.stringify(reply), { headers: { 'content-type': 'application/json' } });
    };
    env.DB.raw.exec("INSERT INTO settings (key, value, updated_at) VALUES ('COMP_IMPORT', 'apply', 0) ON CONFLICT(key) DO UPDATE SET value = 'apply'");
    const moved = await compImportTick(env, appsFetch);
    if (!moved || moved.state !== 'applied') throw new Error('demo competition move: ' + JSON.stringify(moved).slice(0, 300));
    // the fake world's built-in admin never shows: every stamp becomes the demo admin
    env.DB.raw.exec("UPDATE draft_rows SET data = replace(data, 'menazakmena@gmail.com', '" + ADMIN + "')");
  }
  env.DB.raw.exec("UPDATE settings SET value = 'on' WHERE key = 'accounts_mode'");
  // «الحجوزات والفلوس»: the module on, one demo trip and four demo bookings (made-up names, 0100… numbers)
  {
    const booking = { online: true, capacity: 40, perBookingMax: 10, collectNames: false,
      pricing: { mode: 'group', categories: [{ key: 'applicant', label: 'الحاجز', group: 'adult', price: 1500, seat: true, min: 1, max: 1, note: '' }, { key: 'child', label: 'طفل', group: 'child', price: 800, seat: true, min: 0, max: 6, note: '' }] },
      payment: { mode: 'full', minFirst: 0, finalDueAt: '' },
      methods: [{ key: 'cash', label: 'كاش', icon: '' }, { key: 'instapay', label: 'إنستاباي', icon: '' }],
      servants: [{ id: 'srv-demo', name: 'خادم الحجوزات', role: '', image: null, wa: null, methods: ['cash', 'instapay'] }] };
    const start = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
    const endMs = Date.now() + 21 * 86400000;
    env.DB.raw.exec("UPDATE settings SET value = '1' WHERE key = 'BOOKING_MODULE'; INSERT OR IGNORE INTO settings (key, value, updated_at, updated_by) VALUES ('BOOKING_MODULE', '1', 0, 't');");
    env.DB.raw.prepare('INSERT INTO event_cfg (id, slug, title, start_at, end_at, end_ms, booking, online, capacity, price_rev, revision, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 40, ?, ?, ?)')
      .run('evt-demo1', 'summer-trip', 'رحلة الصيف (تجريبية)', start + 'T07:00', start + 'T22:00', endMs, JSON.stringify(booking), 'p1', 'v1', Date.now());
    const ins = env.DB.raw.prepare(`INSERT INTO bookings (id, ref, event_id, source, status, name, phone, servant_id, method, requested, actual, seats_requested, seats_actual, quoted_total, price_rev, amount_due, request_key, created_at, created_ms, updated_ms)
      VALUES (?, ?, 'evt-demo1', 'site', ?, ?, ?, 'srv-demo', ?, ?, ?, ?, ?, ?, 'p1', ?, ?, ?, ?, ?)`);
    const now = Date.now();
    [['B-DEMO1', 'pending', 'حاجز تجريبي أول', 'instapay', { applicant: 1, child: 1 }, 2300],
      ['B-DEMO2', 'pending', 'حاجز تجريبي تاني', 'cash', { applicant: 1 }, 1500],
      ['B-DEMO3', 'confirmed', 'حاجز تجريبي تالت', 'cash', { applicant: 1 }, 1500],
      ['B-DEMO4', 'confirmed', 'حاجز تجريبي رابع', 'instapay', { applicant: 1, child: 2 }, 3100]]
      .forEach(([ref, status, name, method, counts, total], i) => {
        const seats = Object.values(counts).reduce((a, b) => a + b, 0);
        ins.run('bkg-demox' + i, ref, status, name, '+20100000000' + i, method, JSON.stringify(counts), status === 'confirmed' ? JSON.stringify(counts) : null, seats, status === 'confirmed' ? seats : 0, total, status === 'confirmed' ? total : null, 'rk-demo' + i, new Date(now - (i + 1) * 3600000).toISOString().slice(0, 16), now - (i + 1) * 3600000, now);
      });
  }
  const { PRESETS } = await import('../worker/src/lib/perms.js');
  const day = 86400000;
  env.DB.raw.exec(`INSERT INTO admins (email, name, role, active, created_at, last_seen) VALUES
    ('servant.one@example.com', 'خادم الحجوزات', 'admin', 1, 0, ${Date.now() - 2 * day}),
    ('servant.two@example.com', 'خادم المحتوى', 'admin', 1, 0, ${Date.now() - 9 * day});`);
  const ins = env.DB.raw.prepare("INSERT INTO admin_grants (email, perm, scope, granted_by, granted_at) VALUES (?, ?, ?, 't', 0)");
  for (const [p, sc] of Object.entries(PRESETS.servant_bookings.grants)) ins.run('servant.one@example.com', p, sc);
  for (const [p, sc] of Object.entries(PRESETS.content_editor.grants)) ins.run('servant.two@example.com', p, sc);
}

const server = createSiteServer({
  world: { issueToken: c => issueToken(c), get github() { return world.github; } },
  config: () => ({ clientId: TEST_CLIENT, timing: TIMING, workerUrl: WORKER_URL, platform: 'worker', content: 'worker' }),
  claims: () => ({ email: ADMIN })
});
await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });

/* the ring over the spot to press: drawn in the page, over everything (also over an open dialog: it lives in it) */
function markSpot(selector) {
  document.querySelectorAll('.gshot-mark').forEach(n => n.remove());
  if (!selector) return 'none';
  // 'selector::text' — the element with that text (or aria-label); several alternatives with ', '
  const pick = one => { const [sel, txt] = one.split('::'); return [...document.querySelectorAll(sel)].filter(n => !txt || n.textContent.replace(/s+/g, ' ').trim() === txt || (n.getAttribute('aria-label') || '') === txt || n.textContent.replace(/s+/g, ' ').trim().endsWith(' ' + txt)); };
  const all = (selector.includes('::') ? selector.split(/,s*(?![^[]*])/).flatMap(pick) : [...document.querySelectorAll(selector)]).filter(n => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden');
  const target = all[0];
  if (!target) return 'missing';
  target.scrollIntoView({ block: 'center', inline: 'center' });
  const r = target.getBoundingClientRect();
  const host = target.closest('dialog[open], [popover]:popover-open') || document.body;
  const pad = 6;
  const ring = document.createElement('div');
  ring.className = 'gshot-mark';
  ring.style.cssText = `position:fixed;z-index:2147483647;pointer-events:none;left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px;border:3px solid #ffcf5a;border-radius:14px;box-shadow:0 0 0 4px rgb(255 207 90 / .28),0 0 26px 6px rgb(255 207 90 / .45);`;
  host.appendChild(ring);
  return 'ok';
}

const errors = [];
let shots = 0;
const SHOTS = GUIDE.shots.filter(s => !ONLY.length || ONLY.includes(s.id));
try {
  mkdirSync(OUT, { recursive: true });
  for (const [dev, viewport] of Object.entries(WIDTHS)) {
    env.DB.raw.exec('DELETE FROM admin_sessions');
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(`[${dev}] ${e.message.slice(0, 160)}`));
    page.on('dialog', d => d.dismiss());
    // the intro is not part of any step (it never plays with reduced motion)
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    // P(selector, text): press the first shown element (with that text or aria-label)
    await page.evaluateOnNewDocument(() => { window.P = (sel, txt) => { const n = [...document.querySelectorAll(sel)].find(x => x.getClientRects().length && (!txt || x.textContent.replace(/s+/g, ' ').trim() === txt || x.textContent.replace(/s+/g, ' ').trim().endsWith(' ' + txt) || x.getAttribute('aria-label') === txt)); if (!n) throw new Error('no ' + sel + ' ' + (txt || '')); n.click(); return true; }; });
    await interceptGoogle(page, { post: body => world.post(body) }, { site: { origin: SITE, local: LOCAL }, handle: worker, calls: [] });
    await page.setViewport(viewport);
    await page.goto(`${SITE}/admin/`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.gate[data-state="signin"] .gis-stub');
    await page.click('.gis-stub');
    await page.waitForFunction(() => window.A && A.state && A.state.draft && !document.getElementById('shell').hidden, { timeout: 20000 });
    await sleep(2500);
    await page.addStyleTag({ content: '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; caret-color: transparent !important; } .intro, .p8intro { display: none !important; }' });

    if (SURVEY) {
      const screens = await page.evaluate(() => A.AREAS.flatMap(a => (a.subs && a.subs.length ? a.subs : [{ key: '' }]).map(s => a.key + ':' + s.key)));
      screens.push('settings:me', 'settings:notify', 'settings:site', 'settings:content', 'settings:publish', 'settings:team', 'settings:system', 'settings:guide');
      for (const go of process.env.GUIDE_EVAL ? [] : screens) {
        const [area, sub] = go.split(':');
        await page.evaluate((a, s) => { if (window.A.closeSheet) A.closeSheet(); A.go(a, s || undefined); }, area, sub);
        await sleep(1200);
        await page.screenshot({ path: `${OUT}${dev}-${area}${sub ? '-' + sub : ''}.png`, fullPage: dev === 'd' });
        shots++;
      }
      if (process.env.GUIDE_EVAL) {
        for (const [i, js] of process.env.GUIDE_EVAL.split('\n@@\n').entries()) {
          console.log('EVAL', dev, i, JSON.stringify(await page.evaluate(`(async () => { ${js} })()`).catch(e => 'error ' + e.message)));
          await sleep(1500);
          await page.screenshot({ path: `${OUT}${dev}-eval${i}.png` });
          shots++;
        }
      }
      await context.close();
      continue;
    }

    for (const shot of SHOTS) {
      if (shot.only && shot.only !== dev) continue;
      const how = Object.assign({}, shot, dev === 'm' && shot.phone ? shot.phone : {});
      // a clean start: no editor, menu or bubble left from the shot before
      await page.evaluate(() => {
        document.querySelectorAll('[popover]').forEach(p => { try { p.hidePopover(); } catch { /* not open */ } });
        document.querySelectorAll('dialog[open]').forEach(d => { if (!d.classList.contains('sheet')) d.close(); });
        if (A.closeSheet && document.querySelector('dialog.sheet[open]')) { A.dirty = false; A.closeSheet(true); }
        document.querySelectorAll('dialog.sheet[open]').forEach(d => d.close());
        document.querySelectorAll('.gshot-mark').forEach(n => n.remove());
        window.scrollTo(0, 0);
      });
      await sleep(400);
      if (how.go) {
        const [area, sub] = how.go.split(':');
        await page.evaluate((a, s) => A.go(a, s || undefined), area, sub);
        await sleep(1300);
      }
      if (how.run) { await page.evaluate(`(async () => { ${how.run} })()`).catch(e => errors.push(`${shot.id}/${dev} run: ${e.message}`)); await sleep(1400); }
      const marked = await page.evaluate(markSpot, how.mark || '');
      if (marked === 'missing') errors.push(`${shot.id}/${dev}: mark not found ${how.mark}`);
      await sleep(250);
      await page.screenshot({ path: `${OUT}${shot.id}-${dev}.webp`, type: 'webp', quality: dev === 'm' ? 62 : 72 });
      shots++;
    }
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
console.log(`shots ${shots}, errors ${errors.length}`);
errors.forEach(e => console.log(e));
if (errors.length && !SURVEY) process.exitCode = 1;
