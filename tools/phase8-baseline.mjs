// Phase 8 A0 (docs/PHASE8-PLAN.md §2): screenshot baselines of every admin screen at 375 / 768 / 1440, and the
// parity inventory (every control per screen) written to docs/PHASE8-INVENTORY.md.
// The official panel as production runs it: the REAL Worker (worker/src/index.js on SQLite, the same migrations)
// answers the session and the content; the fake Apps Script world holds the Sheets the copy came from
// (the harness of tests/content-worker.e2e.mjs). Nothing here touches Google, GitHub or Cloudflare.
//   cd tools && node phase8-baseline.mjs [shots dir]
// A1 and later (the look): PHASE8_PREFS='{"theme":"light"}' seeds the panel's look on the device; PHASE8_WIDTHS=phone,desktop
// limits the sizes; PHASE8_ONLY=settings limits the areas. With any of them the inventory is not rewritten.
// Run it again at the end of Phase 8 and compare: every inventory row must still exist, or be listed as moved.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, createSign, createHmac } from 'node:crypto';
import { ROOT } from './lib/gs.mjs';
import { createSiteServer, interceptGoogle, TEST_CLIENT } from './lib/admin-server.mjs';
import { createWorld } from '../tests/fakes/gas.mjs';
import { handle as workerHandle } from '../worker/src/index.js';
import { resetAuthCaches, GOOGLE_JWKS_URL } from '../worker/src/lib/auth.js';
import { migratedDb } from '../worker/test/d1-sqlite.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');
const SHOTS = process.argv[2] || fileURLToPath(new URL('./.cache/phase8-baseline/', import.meta.url));
const PORT = 4613;
const LOCAL = `http://127.0.0.1:${PORT}`;
const SITE = 'https://stathanasiosyouth.github.io';
const WORKER_URL = 'https://athanasios-api.menazak-lab.workers.dev';
const ADMIN = 'menazakmena@gmail.com';
const SECRET = 's'.repeat(48);
const TIMING = { gisSlow: 700, gisFail: 2500, button: 3000, silent: 1500, slow: 900, fail: 8000, render: 8000, beat: 900, beatFail: 2500 };
const WIDTHS = { desktop: { width: 1440, height: 900 }, tablet: { width: 768, height: 1024 }, phone: { width: 375, height: 812, isMobile: true, hasTouch: true } };
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
  const full = { iss: 'https://accounts.google.com', aud: TEST_CLIENT, azp: TEST_CLIENT, sub: 'sub-' + c.email, email: c.email, email_verified: true, name: c.email.split('@')[0], iat: now, exp: now + 3600 };
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
env.DB.raw.exec(`INSERT INTO admins (email, name, role, active, created_at) VALUES ('${ADMIN}', 'مينا', 'primary', 1, 0);
  UPDATE settings SET value = '1' WHERE key = 'ADMIN_PLATFORM';`);
world = createWorld({ executeAs: 'USER_DEPLOYING' });
world.as(ADMIN).gs.setup();
world.properties.set('SITE_URL', `${SITE}/`);
world.properties.set('ADMIN_CLIENT_ID', TEST_CLIENT);
world.properties.set('ADMIN_EMAILS', ADMIN);
world.gs.apiSaveItem('news', { id: 'news-aaaa1111', title: 'رحلة الغردقة', summary: 'سجّل اسمك' });
world.gs.apiSaveItem('notifications', { title: 'بوستر المؤتمر نزل', type: 'important', target: 'https://example.org/poster' });
world.as('');
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
  // PHASE8_ACCOUNTS=1: youth accounts on (the «الشباب» area); PHASE8_EVAL can then add people over the admin's session
  if (process.env.PHASE8_ACCOUNTS) env.DB.raw.exec("UPDATE settings SET value = 'on' WHERE key = 'accounts_mode'");
}

const server = createSiteServer({
  world: { issueToken: c => issueToken(c), get github() { return world.github; } },
  config: () => ({ clientId: TEST_CLIENT, timing: TIMING, workerUrl: WORKER_URL, platform: 'worker', content: 'worker' }),
  claims: () => ({ email: ADMIN })
});
await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });

const inventory = new Map();
const errors = [];
let shots = 0;
try {
  const PREFS = process.env.PHASE8_PREFS || '';
  const ONLY = (process.env.PHASE8_ONLY || '').split(',').filter(Boolean);
  const SIZES = (process.env.PHASE8_WIDTHS || '').split(',').filter(Boolean);
  for (const [wname, viewport] of Object.entries(WIDTHS)) {
    if (SIZES.length && !SIZES.includes(wname)) continue;
    env.DB.raw.exec('DELETE FROM admin_sessions');
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(`[${wname}] ${e.message.slice(0, 160)}`));
    page.on('dialog', d => d.dismiss());
    if (PREFS) await page.evaluateOnNewDocument(p => { try { localStorage.setItem('athanasios-admin.prefs.v1', JSON.stringify({ prefs: JSON.parse(p), dirty: true })); } catch { /* no storage */ } }, PREFS);
    await interceptGoogle(page, { post: body => world.post(body) }, { site: { origin: SITE, local: LOCAL }, handle: worker, calls: [] });
    await page.setViewport(viewport);
    await page.goto(`${SITE}/admin/`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.gate[data-state="signin"] .gis-stub');
    await page.click('.gis-stub');
    try {
      await page.waitForFunction(() => window.A && A.state && A.state.draft && !document.getElementById('shell').hidden, { timeout: 20000 });
    } catch (err) {
      console.log('gate', wname, await page.evaluate(() => JSON.stringify({ gate: document.getElementById('gate').dataset, text: document.getElementById('gate').textContent.replace(/s+/g, ' ').slice(0, 300) })));
      throw err;
    }
    await sleep(1500);
    // PHASE8_GO=settings:system,content:news shoots exactly those screens (A.go(area, sub))
    const GO = (process.env.PHASE8_GO || '').split(',').filter(Boolean).map(x => { const [area, sub] = x.split(':'); return { area, areaLabel: area, sub: sub || '', subLabel: sub || '' }; });
    const screens = GO.length ? GO : await page.evaluate(() => A.AREAS.flatMap(a => (a.subs && a.subs.length ? a.subs : [{ key: '', label: '' }]).map(s => ({ area: a.key, areaLabel: a.label, sub: s.key, subLabel: s.label }))));
    mkdirSync(`${SHOTS}${wname}`, { recursive: true });
    for (const s of screens.filter(x => GO.length || !ONLY.length || ONLY.includes(x.area))) {
      await page.evaluate((area, sub) => A.go(area, sub || undefined), s.area, s.sub);
      await sleep(1100);
      // PHASE8_EVAL: a script run on the screen before the shot (open an editor, a menu…); may return a promise
      if (process.env.PHASE8_EVAL) { await page.evaluate(process.env.PHASE8_EVAL).catch(e => errors.push('eval ' + e.message)); await sleep(1500); }
      const name = `${s.area}${s.sub ? '-' + s.sub : ''}`;
      await page.screenshot({ path: `${SHOTS}${wname}/${name}.png`, fullPage: !process.env.PHASE8_VIEWPORT });
      shots++;
      const controls = await page.evaluate(() => {
        const out = [];
        const view = document.querySelector('#view') || document.body;
        for (const n of view.querySelectorAll('button, a[href], input, select, textarea, [role="switch"], [role="tab"]')) {
          if (!n.offsetParent) continue;
          const kind = n.tagName === 'A' ? 'link' : n.tagName === 'BUTTON' ? 'button' : n.type === 'checkbox' ? 'checkbox' : n.tagName.toLowerCase();
          const label = (n.getAttribute('aria-label') || n.textContent || n.placeholder || n.closest('label')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
          const act = n.dataset.act ? ` \`${n.dataset.act}\`` : '';
          if (label || act) out.push(`${kind}: ${label}${act}`);
        }
        return [...new Set(out)];
      });
      const key = `${s.areaLabel}${s.subLabel ? ' › ' + s.subLabel : ''}`;
      if (!inventory.has(key)) inventory.set(key, new Set());
      controls.forEach(c => inventory.get(key).add(c));
    }
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

const lines = [
  '# Phase 8 — parity inventory (A0)',
  '',
  'Generated by `tools/phase8-baseline.mjs`: the official panel against the real Worker code on SQLite (as `tests/content-worker.e2e.mjs`), at 375, 768 and 1440 px.',
  'Every control listed here must still exist after the redesign, or be listed under **Moved** with its new place. Run the tool again at the end of Phase 8 and diff.',
  'Screens that appear only with a module switch or live data (bookings, youth accounts, points, store, seasons) are listed by hand under **Switch-gated screens**.',
  '',
  `Screens: ${inventory.size}. Screenshots: ${shots} (\`tools/.cache/phase8-baseline/\`, not committed).`,
  ''
];
for (const [screen, set] of inventory) {
  lines.push(`## ${screen}`, '');
  for (const c of [...set].sort()) lines.push(`- [ ] ${c}`);
  lines.push('');
}
if (!process.env.PHASE8_PREFS && !process.env.PHASE8_ONLY && !process.env.PHASE8_GO && !process.env.PHASE8_WIDTHS) writeFileSync(new URL('../docs/PHASE8-INVENTORY.md', import.meta.url), lines.join('\n'));
console.log(`screens ${inventory.size}, shots ${shots}, errors ${errors.length}`);
errors.slice(0, 10).forEach(e => console.log(e));
