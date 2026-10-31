// The account page in headless Chrome: the REAL page with its real CSP, over real HTTP, against the REAL Worker code
// on SQLite (only the API's origin is added to connect-src). Sign-in and direct entry, every section, empty and busy
// states, the photo through the real canvas and upload, sound rules, reduced motion, sizes, overflow, axe.
// Run: cd tools && node --experimental-sqlite --no-warnings --test ../tests/account-page.e2e.mjs

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';
import { harness } from '../worker/test/helpers.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const SITE_PORT = 4751;
const API_PORT = 4752;
const LOCAL = `http://localhost:${SITE_PORT}`;
const API = `http://localhost:${API_PORT}`;
const SHOTS = `${ROOT}tools/.cache/account-page/`;
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].find(existsSync);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const KEYS = { PW_PEPPER: 'pepper', PW_KEY: Buffer.alloc(32, 7).toString('base64'), OTP_PEPPER: 'otp', ACCOUNT_PAD_MS: '0', BOOK_SECRET: 'b'.repeat(40) };
const SAMPLE = join(ROOT, 'assets/img/og-image.png');

let h, site, apiServer, browser, tick = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));

test.before(async () => {
  mkdirSync(SHOTS, { recursive: true });
  h = harness({ env: { ENVIRONMENT: 'staging', ADMIN_EMAILS: '', ALLOWED_ORIGINS: LOCAL, ...KEYS } });
  await h.db.prepare("UPDATE settings SET value = 'on' WHERE key = 'accounts_mode'").run();
  await h.db.prepare("UPDATE settings SET value = 'open' WHERE key = 'SHOP_MODE'").run();
  await h.db.prepare("UPDATE settings SET value = '1' WHERE key = 'SHOP_ALLOW_CANCEL'").run();
  const now = Date.now();
  await h.db.prepare("UPDATE seasons SET status = 'closed' WHERE status = 'active'").run();
  await h.db.prepare("INSERT INTO seasons (id, name, status, created_ms, updated_ms) VALUES ('sea-e2e-one', 'موسم ٢٠٢٦', 'active', ?, ?)").bind(now, now).run();
  await h.db.prepare("INSERT INTO comp_versions (comp_id, version, slug, def, meta, synced_ms) VALUES ('c-e2e', 'v1', 'bible', '{}', ?, ?)").bind(JSON.stringify({ title: 'مسابقة الكتاب المقدس', slug: 'bible', scoring: true, resultShow: 'both', wallet: true, showPoints: true }), now).run();
  await h.db.prepare("INSERT INTO event_cfg (id, slug, title, start_at, end_ms, online, fetched_at) VALUES ('evt-e2e', 'trip', 'رحلة دير الأنبا أنطونيوس', '2099-11-14T06:00', ?, 1, ?)").bind(Date.UTC(2099, 10, 14), now).run();

  site = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, LOCAL).pathname);
    let file = normalize(path);
    if (file.endsWith('\\') || file.endsWith('/')) file += 'index.html';
    try {
      let body = readFileSync(join(ROOT, file));
      if (file.endsWith('.html')) body = body.toString().replace("connect-src 'self'", `connect-src 'self' ${API}`);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
      res.end(body);
    }
    catch {
      res.writeHead(404);
      res.end('');
    }
  });
  apiServer = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const headers = { ...req.headers };
    delete headers.host;
    delete headers['content-length'];
    const init = { method: req.method, headers };
    if (chunks.length) init.body = Buffer.concat(chunks);
    const { handle } = await import('../worker/src/index.js');
    const reply = await handle(new Request('https://api.test' + req.url, init), h.env, { waitUntil: () => {} });
    const out = {};
    reply.headers.forEach((v, k) => { out[k] = v; });
    res.writeHead(reply.status, out);
    res.end(Buffer.from(await reply.arrayBuffer()));
  });
  await Promise.all([new Promise(r => site.listen(SITE_PORT, r)), new Promise(r => apiServer.listen(API_PORT, r))]);
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
});

test.after(async () => {
  await browser?.close();
  await Promise.all([site, apiServer].map(s => new Promise(r => (s ? s.close(r) : r()))));
});

async function member(over = {}) {
  tick++;
  const email = `page${tick}${Date.now()}@staging.invalid`;
  const start = await h.call('/v1/account/register/start', { method: 'POST', body: { email, phone: '012' + String(30000000 + tick), name: 'مارك سامي فوزي', birthDate: over.birthDate || '2000-03-12' } });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const done = await h.call('/v1/account/register/verify', { method: 'POST', body: { pendingId: start.body.pendingId, code: start.body.testCode } });
  const row = await h.db.prepare('SELECT id FROM participants WHERE email = ?').bind(email).first();
  if (!over.fresh) await h.db.prepare('UPDATE participants SET onboarded_at = 1 WHERE id = ?').bind(row.id).run();
  return { email, password: done.body.password, id: row.id };
}

async function seed(m) {
  const now = Date.now();
  await h.db.prepare("INSERT INTO points_ledger (id, participant_id, season_id, amount, kind, ref, comp_id, idem_key, actor, created_ms) VALUES (?, ?, 'sea-e2e-one', 80, 'competition', ?, 'c-e2e', ?, 'system', ?)").bind('led-a' + tick, m.id, 'x:' + tick, 'k-a' + tick, now).run();
  await h.db.prepare("INSERT INTO points_ledger (id, participant_id, season_id, amount, kind, note, note_public, idem_key, actor, created_ms) VALUES (?, ?, 'sea-e2e-one', 100, 'manual', 'حضور يوم الخدمة', 1, ?, 'admin', ?)").bind('led-b' + tick, m.id, 'k-b' + tick, now - 5000).run();
  const rid = 'r-' + String(tick).padStart(10, 'a');
  await h.db.prepare("INSERT INTO redemptions (id, item_id, item_name, participant_id, season_id, cost, status, request_key, created_ms, updated_ms) VALUES (?, 'i-1', 'كتاب مقدس جيب', ?, 'sea-e2e-one', 0, 'approved', ?, ?, ?)").bind(rid, m.id, 'rk-' + tick, now, now).run();
  const ref = 'B-E2E' + tick;
  await h.db.prepare(`INSERT INTO bookings (id, ref, event_id, source, status, name, phone, requested, seats_requested, quoted_total, price_rev, amount_due, request_key, created_at, created_ms, updated_ms, participant_id)
    VALUES (?, ?, 'evt-e2e', 'site', 'confirmed', 'مارك', '+201000000000', '{}', 1, 900, 'r', 900, ?, '2026-10-01', ?, ?, ?)`).bind('bkg-e2e' + tick, ref, 'rqk-' + tick, now, now, m.id).run();
  return { ref, rid };
}

async function open(path = '/account/', { width = 390, height = 844, reduced = false, context = null } = {}) {
  const ctx = context || await browser.createBrowserContext();
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', e => problems.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/404|401|Failed to load resource/.test(m.text())) problems.push(m.text()); });
  await page.setViewport({ width, height });
  if (reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.evaluateOnNewDocument(api => {
    localStorage.setItem('athanasios.book.api', api);
    window.__audio = 0;
    const Real = window.AudioContext;
    window.AudioContext = class extends Real { constructor(...a) { super(...a); window.__audio++; } };
  }, API);
  await page.goto(LOCAL + path, { waitUntil: 'domcontentloaded' });
  return { page, ctx, problems };
}

const set = (page, selector, value) => page.$eval(selector, (n, v) => { n.value = v; n.dispatchEvent(new Event('input', { bubbles: true })); }, value);

async function signIn(page, m) {
  await page.waitForSelector('#acct-email', { timeout: 8000 });
  await set(page, '#acct-email', m.email);
  await set(page, '#acct-password', m.password);
  await page.$eval('form', f => f.requestSubmit());
  await page.waitForSelector('[data-home], .ac-view', { timeout: 8000 });
}

const home = page => page.waitForSelector('[data-home]', { timeout: 8000 });
const text = (page, selector) => page.$eval(selector, n => n.textContent.trim());
const route = async (page, hash, selector) => {
  await page.evaluate(v => { location.hash = v; }, hash);
  await page.waitForSelector(selector, { timeout: 8000 });
  await sleep(450);
};

const press = async (page, selector) => {
  await sleep(500);
  await page.$eval(selector, n => n.scrollIntoView({ block: 'center' }));
  await sleep(80);
  await page.click(selector);
};

async function fits(page, name) {
  const report = await page.evaluate(() => {
    const over = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const small = [...document.querySelectorAll('#acct-main a, #acct-main button, #acct-main select, .cbar a, .cbar button')]
      .filter(e => e.offsetParent && !e.closest('.acct__support'))
      .map(e => [e, e.getBoundingClientRect()])
      .filter(([, r]) => r.height < 40 || r.width < 40)
      .map(([e, r]) => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 24) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    return { over, small };
  });
  assert.equal(report.over, 0, name + ': sideways scroll');
  assert.deepEqual(report.small, [], name + ': small targets');
}

async function axe(page, name) {
  await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))));
  await page.evaluate(AXE);
  const result = await page.evaluate(() => window.axe.run(document.body, { runOnly: ['wcag2a', 'wcag2aa'], rules: { 'color-contrast': { enabled: true } } }));
  assert.deepEqual(result.violations.map(v => v.id + ': ' + v.nodes[0].target.join(' ')), [], name);
}

test('a valid session opens the account at once; the question comes only when the session ended', async () => {
  const m = await member();
  const { page, ctx, problems } = await open();
  await page.waitForSelector('#acct-email');
  await axe(page, 'sign-in');
  await page.screenshot({ path: SHOTS + 'signin-mobile.png' });
  await signIn(page, m);
  await home(page);
  assert.equal(await page.evaluate(() => document.activeElement.tagName), 'H1');
  assert.match(await text(page, '.ac-hero__hi'), /مارك/);

  // back later: no question
  const again = await open('/account/', { context: ctx });
  await home(again.page);
  assert.equal(await again.page.$('[data-hint]'), null, 'no «continue?»');
  await again.page.close();

  // the session ends (revoked elsewhere): now the question, then a return to the form with the email in place
  await h.db.prepare('UPDATE account_sessions SET revoked_at = ? WHERE participant_id = ?').bind(Date.now(), m.id).run();
  const after = await open('/account/', { context: ctx });
  await after.page.waitForSelector('[data-hint]', { timeout: 8000 });
  assert.match(await text(after.page, '.acct__title'), /تكمّل بالحساب ده/);
  await after.page.click('[data-continue]');
  await after.page.waitForSelector('#acct-password', { timeout: 8000 });
  assert.equal(await after.page.$eval('#acct-email', n => n.value), m.email);
  assert.deepEqual(problems, []);
  assert.deepEqual(after.problems, []);
  await ctx.close();
});

test('the network down with a session never asks for a password; retry opens it', async () => {
  const m = await member();
  const { page, ctx } = await open();
  await signIn(page, m);
  await home(page);
  const next = await ctx.newPage();
  await next.setRequestInterception(true);
  let down = true;
  next.on('request', r => {
    if (down && r.url().includes('/v1/account/summary')) r.abort();
    else r.continue();
  });
  await next.goto(LOCAL + '/account/', { waitUntil: 'domcontentloaded' });
  await next.waitForFunction(() => /مقدرناش نوصل/.test(document.body.textContent), { timeout: 8000 });
  assert.equal(await next.$('#acct-password'), null);
  down = false;
  await next.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('جرّب تاني')).click());
  await home(next);
  await ctx.close();
});

test('a new member: first steps, no empty numbers, every section teaches what to do', async () => {
  const m = await member();
  const { page, ctx, problems } = await open();
  await signIn(page, m);
  await home(page);
  await sleep(1300);
  assert.match(await text(page, '.ac-hero__hi'), /أهلاً بيك يا مارك/);
  assert.match(await text(page, '[data-home]'), /تبدأ منين/);
  assert.equal(await page.$('.ac-band'), null, 'no row of zeros');
  await fits(page, 'new home');
  await axe(page, 'new home');
  await page.screenshot({ path: SHOTS + 'new-mobile.png', fullPage: true });
  await route(page, '#me/bookings', '.ac-empty');
  assert.match(await text(page, '.ac-empty'), /اربطه بحسابي/);
  await route(page, '#me/points', '.ac-empty');
  assert.match(await text(page, '.ac-empty'), /لسه مفيش نقط/);
  await page.screenshot({ path: SHOTS + 'new-points-mobile.png' });
  await route(page, '#me/results', '.ac-empty');
  await route(page, '#me/orders', '.ac-empty');
  assert.deepEqual(problems, []);
  await ctx.close();
});

test('an active member: needs first, sections in words, deep links, the points bug fixed, the way to pay', async () => {
  const m = await member();
  const { ref, rid } = await seed(m);
  const { page, ctx, problems } = await open();
  await signIn(page, m);
  await home(page);
  await sleep(1300);
  const now = await text(page, '[data-now]');
  assert.match(now, /باقي ٩٠٠ جنيه على رحلة دير الأنبا أنطونيوس/);
  assert.match(now, /كتاب مقدس جيب جاهزة للاستلام/);
  assert.match(await text(page, '.ac-band__seg--gold'), /١٨٠/);
  await fits(page, 'home');
  await axe(page, 'home');
  await page.screenshot({ path: SHOTS + 'active-mobile.png', fullPage: true });

  await route(page, '#me/points', '[data-ledger]');
  const ledger = await text(page, '[data-ledger]');
  assert.match(ledger, /مسابقة الكتاب المقدس/, 'the competition is named');
  assert.match(ledger, /نقاط مسابقة/, 'and the kind is in words');
  assert.match(ledger, /حضور يوم الخدمة/);
  assert.ok(await page.$('[data-store]'));
  await axe(page, 'points');
  await page.screenshot({ path: SHOTS + 'points-mobile.png', fullPage: true });

  await route(page, `#me/bookings/${ref}`, `[data-booking="${ref}"]`);
  const pay = await page.$eval('[data-pay]', a => a.getAttribute('href'));
  assert.match(pay, /\/events\/trip\/#b\/.+/, 'the booking page, by its status link');
  assert.equal(await page.$eval('.ac-pay__fill', n => getComputedStyle(n).transform), 'matrix(0, 0, 0, 1, 0, 0)', 'nothing paid yet');
  await axe(page, 'booking');
  await page.screenshot({ path: SHOTS + 'booking-mobile.png' });

  await route(page, `#me/orders/${rid}`, '[data-orders]');
  assert.match(await text(page, '[data-orders]'), /جاهزة للاستلام/);
  await route(page, '#me/bookings/NOPE', '.ac-note');
  assert.match(await text(page, '.ac-note'), /مش لاقيين/);
  await route(page, '#me/results', '.ac-view');
  await route(page, '#me/support', '[data-support]');
  await route(page, '#me/profile', '[data-facts]');
  assert.match(await text(page, '[data-facts]'), new RegExp(m.email.replace(/\./g, '\\.')));
  assert.equal(await page.$('[data-facts] input'), null, 'read only');
  await axe(page, 'profile');
  assert.deepEqual(problems, []);
  await ctx.close();
});

test('a link from an email while signed out: sign in, land on that record', async () => {
  const m = await member();
  const { ref } = await seed(m);
  const { page, ctx } = await open(`/account/#me/bookings/${ref}`);
  await signIn(page, m);
  await page.waitForSelector(`[data-booking="${ref}"]`, { timeout: 8000 });
  await ctx.close();
});

test('the photo: refuse a wrong file, crop, save small, stays after a reload, delete; the admin can see and remove it', async () => {
  const m = await member();
  const { page, ctx, problems } = await open();
  await signIn(page, m);
  await home(page);
  await page.click('.ac-hero .ac-arch');
  await page.waitForSelector('[data-photo-sheet][open]');
  await axe(page, 'sheet');

  const svg = join(SHOTS, 'bad.svg');
  (await import('node:fs')).writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await (await page.$('#ac-photo-file')).uploadFile(svg);
  await page.waitForSelector('[data-photo-sheet] .ac-note--alert');
  assert.match(await text(page, '[data-photo-sheet] .ac-note--alert'), /مش صورة مدعومة/);

  await (await page.$('#ac-photo-file')).uploadFile(SAMPLE);
  await page.waitForSelector('[data-photo-crop] canvas');
  await page.screenshot({ path: SHOTS + 'crop-mobile.png' });
  await page.click('[data-photo-save]');
  await page.waitForSelector('.ac-toast__b--ok', { timeout: 8000 });
  assert.match(await text(page, '.ac-toast__b'), /اتحفظت صورتك/);
  const stored = await h.db.prepare('SELECT avatar_key, avatar_version FROM participants WHERE id = ?').bind(m.id).first();
  assert.ok(stored.avatar_key.startsWith('avatars/'));
  const size = (await h.env.PROOFS.head(stored.avatar_key)).size;
  assert.ok(size < 60 * 1024, 'small: ' + size);
  await page.waitForSelector('.ac-hero .ac-arch__img');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await home(page);
  await page.waitForFunction(() => { const i = document.querySelector('.ac-hero .ac-arch__img'); return i && i.src.startsWith('blob:') && i.naturalWidth === 256; }, { timeout: 8000 });

  await page.click('.ac-hero .ac-arch');
  await page.waitForSelector('[data-photo-delete]');
  await page.click('[data-photo-delete]');
  await page.waitForSelector('[data-photo-delete-yes]');
  await page.click('[data-photo-delete-yes]');
  await page.waitForSelector('.ac-hero .ac-arch__initial', { timeout: 8000 });
  assert.equal((await h.db.prepare('SELECT avatar_key FROM participants WHERE id = ?').bind(m.id).first()).avatar_key, null);
  assert.deepEqual(problems, []);
  await ctx.close();
});

test('settings: a switch saves and says so; a failure puts it back; signing out everywhere asks first', async () => {
  const m = await member();
  const { page, ctx, problems } = await open();
  await signIn(page, m);
  await home(page);
  await route(page, '#me/notifications', '[data-prefs]');
  await axe(page, 'prefs');
  await page.screenshot({ path: SHOTS + 'prefs-mobile.png' });
  await page.evaluate(() => document.getElementById('pref-security').click());
  await page.waitForFunction(() => /اتحفظ/.test(document.querySelector('[data-prefs]').textContent));
  assert.equal(await page.$eval('#pref-security', n => n.checked), true);
  const saved = await h.db.prepare("SELECT mode FROM member_prefs WHERE participant_id = ? AND grp = 'security'").bind(m.id).first();
  assert.equal(saved.mode, 'on');

  await page.setRequestInterception(true);
  const block = r => { if (r.method() === 'POST' && r.url().includes('/prefs')) r.abort(); else r.continue(); };
  page.on('request', block);
  await page.evaluate(() => document.getElementById('pref-bookings').click());
  await page.waitForFunction(() => /مقدرناش نحفظ/.test(document.querySelector('[data-prefs]').textContent));
  assert.equal(await page.$eval('#pref-bookings', n => n.checked), true, 'back as it was');
  page.off('request', block);
  await page.setRequestInterception(false);

  await route(page, '#me/security', '[data-sessions]');
  assert.match(await text(page, '[data-sessions]'), /الجهاز ده/);
  await axe(page, 'security');
  await page.screenshot({ path: SHOTS + 'security-mobile.png', fullPage: true });
  await page.click('[data-logout-all]');
  assert.ok(await page.$('[data-logout-all-yes]'), 'a second press');
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM account_sessions WHERE participant_id = ? AND revoked_at IS NULL').bind(m.id).first()).n > 0, true);
  await page.click('[data-logout-all-yes]');
  await page.waitForSelector('#acct-email', { timeout: 8000 });
  assert.match(await text(page, '#acct-main'), /خرجت من كل الأجهزة/);
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM account_sessions WHERE participant_id = ? AND revoked_at IS NULL').bind(m.id).first()).n, 0);
  assert.deepEqual(problems, []);
  await ctx.close();
});

test('sign out; forget this device; a new password from the account; a guest and frozen points', async () => {
  const m = await member();
  const a = await open();
  await signIn(a.page, m);
  await home(a.page);
  await press(a.page, '.ac-signout--m');
  await a.page.waitForSelector('#acct-email');
  assert.equal(await a.page.$eval('#acct-email', n => n.value), m.email);
  assert.match(await text(a.page, '#acct-main'), /خرجت من حسابك/);
  await signIn(a.page, m);
  await home(a.page);
  await route(a.page, '#me/security', '[data-logout-forget]');
  await press(a.page, '[data-new-password]');
  await a.page.waitForSelector('#acct-forgot');
  assert.equal(await a.page.$eval('#acct-forgot', n => n.value), m.email);
  await a.page.click('.acct__link[href="#me/security"]');
  await a.page.waitForSelector('[data-logout-forget]', { timeout: 8000 });
  await press(a.page, '[data-logout-forget]');
  await a.page.waitForSelector('#acct-email');
  assert.equal(await a.page.$eval('#acct-email', n => n.value), '');
  assert.equal(await a.page.evaluate(() => JSON.parse(localStorage.getItem('athanasios.account.hints.v1') || '[]').length), 0);
  await a.ctx.close();

  const old = await member({ birthDate: '1990-01-01' });
  await h.db.prepare("INSERT INTO points_ledger (id, participant_id, season_id, amount, kind, idem_key, actor, created_ms) VALUES (?, ?, 'sea-e2e-one', 120, 'competition', ?, 'system', ?)").bind('led-g' + tick, old.id, 'k-g' + tick, Date.now()).run();
  const g = await open();
  await signIn(g.page, old);
  await home(g.page);
  assert.match(await text(g.page, '[data-now]'), /خارج النطاق العمري/);
  await route(g.page, '#me/points', '[data-frozen]');
  assert.equal(await g.page.$eval('[data-store]', n => n.disabled), true, 'no store while frozen');
  await g.ctx.close();
});

test('sound: nothing before the first gesture, a toggle in the bar that remembers', async () => {
  const m = await member();
  const { page, ctx } = await open();
  await page.waitForSelector('#acct-email');
  await page.waitForSelector('.cbar .usound');
  await sleep(400);
  assert.equal(await page.evaluate(() => window.__audio), 0, 'no AudioContext on arrival');
  await signIn(page, m);
  await home(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await home(page);
  await sleep(900);
  assert.equal(await page.evaluate(() => window.__audio), 0, 'the staged arrival is silent');
  await page.click('.cbar .usound');
  assert.equal(await page.evaluate(() => localStorage.getItem('athanasios.sound')), 'off');
  assert.equal(await page.$eval('.cbar .usound', b => b.getAttribute('aria-pressed')), 'false');
  await page.click('.cbar .usound');
  assert.equal(await page.evaluate(() => localStorage.getItem('athanasios.sound')), 'on');
  assert.ok(await page.evaluate(() => window.__audio) >= 1, 'awake after a tap');
  await ctx.close();
});

test('motion: staged once a visit; reduced motion stops everything and skips the transitions', async () => {
  const m = await member();
  await seed(m);
  const { page, ctx } = await open();
  await signIn(page, m);
  await home(page);
  assert.ok(await page.$('.ac-hero.is-staged'), 'the first arrival plays');
  await route(page, '#me/profile', '[data-facts]');
  await page.evaluate(() => { location.hash = '#me'; });
  await home(page);
  assert.equal(await page.$('.ac-hero.is-staged'), null, 'once');
  const names = await page.evaluate(() => ['.ac-wrap', '.cbar'].map(s => getComputedStyle(document.querySelector(s)).viewTransitionName));
  assert.deepEqual(names, ['ac-view', 'ac-bar']);
  const rest = await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map(a => a.finished.catch(() => {})));
    return [...document.querySelectorAll('.ac-view > *')].filter(e => e.offsetParent).every(e => getComputedStyle(e).opacity === '1');
  });
  assert.ok(rest, 'everything is visible at rest');
  await ctx.close();

  const r = await open('/account/', { reduced: true });
  await r.page.evaluate(() => {
    window.__vt = 0;
    const real = document.startViewTransition && document.startViewTransition.bind(document);
    if (real) document.startViewTransition = fn => { window.__vt++; return real(fn); };
  });
  await signIn(r.page, m);
  await home(r.page);
  assert.equal(await r.page.evaluate(() => window.__vt), 0);
  assert.equal(await r.page.$('.ac-hero.is-staged'), null);
  assert.equal(await r.page.evaluate(() => document.documentElement.dataset.motion), 'reduced');
  assert.equal(await r.page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length), 0);
  await r.ctx.close();
});

test('every width: no sideways scroll, the rail on a computer, RTL throughout', async () => {
  const m = await member();
  const { ref } = await seed(m);
  const shots = { 360: 'small', 390: 'mobile', 820: 'tablet', 1280: 'desktop', 1680: 'wide' };
  for (const [width, name] of Object.entries(shots)) {
    const { page, ctx, problems } = await open('/account/', { width: Number(width), height: 900 });
    await signIn(page, m);
    await home(page);
    await sleep(1400);
    await fits(page, 'home ' + width);
    await page.screenshot({ path: SHOTS + `home-${name}.png`, fullPage: Number(width) < 980 });
    const rail = await page.$eval('.ac-rail', n => getComputedStyle(n).display);
    assert.equal(rail === 'none', Number(width) < 980, 'rail at ' + width);
    assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
    for (const [hash, sel, file] of [[`#me/bookings/${ref}`, '[data-booking]', 'booking'], ['#me/points', '[data-ledger]', 'points'], ['#me/profile', '[data-facts]', 'profile'], ['#me/security', '[data-sessions]', 'security']]) {
      await route(page, hash, sel);
      await fits(page, hash + ' ' + width);
      if (Number(width) >= 1280) await page.screenshot({ path: SHOTS + `${file}-${name}.png` });
    }
    assert.deepEqual(problems, [], String(width));
    await ctx.close();
  }
  const { page, ctx } = await open('/account/', { width: 1280, height: 860 });
  await page.waitForSelector('#acct-email');
  await page.screenshot({ path: SHOTS + 'signin-desktop.png' });
  await fits(page, 'signin 1280');
  await ctx.close();
});

test('the walkthrough: once for a new account, not again on this or another device; six steady cards; reopens from support', async () => {
  const m = await member({ fresh: true });
  const { page, ctx, problems } = await open();
  await signIn(page, m);
  await home(page);
  await page.waitForSelector('[data-tour]', { timeout: 5000 });
  await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))));
  await axe(page, 'walkthrough');
  const heights = [];
  const titles = [];
  const shot = n => page.screenshot({ path: SHOTS + 'tour-' + n + '.png' });
  for (let i = 0; i < 6; i++) {
    await sleep(120);
    heights.push(await page.$eval('[data-tour]', n => Math.round(n.getBoundingClientRect().height)));
    titles.push(await page.$eval('.ac-ob__t', n => n.textContent));
    if (i === 0 || i === 3) {
      await sleep(900);
      await shot(i + 1);
    }
    if (i < 5) await page.click('[data-tour-next]');
  }
  assert.deepEqual(titles, ['ده حسابك', 'نقطك ونتايجك', 'حجوزاتك', 'صورتك', 'الإشعارات والدعم', 'لما تخلص']);
  assert.equal(new Set(heights).size, 1, 'the sheet stays still: ' + heights);
  assert.equal(await page.$eval('[data-tour-skip]', n => n.hidden), true, 'no skip on the last');
  await page.click('[data-tour-back]');
  assert.equal(await page.$eval('.ac-ob__t', n => n.textContent), 'الإشعارات والدعم');
  await page.click('[data-tour-next]');
  assert.equal((await h.db.prepare('SELECT onboarded_at FROM participants WHERE id = ?').bind(m.id).first()).onboarded_at, null, 'not marked until it closes');
  await page.click('[data-tour-next]');
  await page.waitForFunction(() => !document.querySelector('[data-tour]'));
  await page.waitForFunction(() => true);
  await sleep(300);
  assert.ok((await h.db.prepare('SELECT onboarded_at FROM participants WHERE id = ?').bind(m.id).first()).onboarded_at > 0);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await home(page);
  await sleep(1300);
  assert.equal(await page.$('[data-tour]'), null, 'not on the same device');
  const other = await open();
  await signIn(other.page, m);
  await home(other.page);
  await sleep(1300);
  assert.equal(await other.page.$('[data-tour]'), null, 'not on another device');
  await other.ctx.close();

  await route(page, '#me/support', '[data-tour-open]');
  await page.click('[data-tour-open]');
  await page.waitForSelector('[data-tour]', { timeout: 5000 });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('[data-tour]'));
  assert.deepEqual(problems, []);
  await ctx.close();
});

test('the walkthrough: skipping counts as seen; swipe follows RTL; a guest reads the right words; a computer sees it beside its drawing', async () => {
  const m = await member({ fresh: true });
  const { page, ctx } = await open();
  await signIn(page, m);
  await home(page);
  await page.waitForSelector('[data-tour]', { timeout: 5000 });
  const box = await (await page.$('[data-tour]')).boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 60, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, y);
  await page.mouse.up();
  assert.equal(await page.$eval('.ac-ob__t', n => n.textContent), 'نقطك ونتايجك', 'a swipe to the right goes forward');
  await page.click('[data-tour-skip]');
  await page.waitForFunction(() => !document.querySelector('[data-tour]'));
  await sleep(300);
  assert.ok((await h.db.prepare('SELECT onboarded_at FROM participants WHERE id = ?').bind(m.id).first()).onboarded_at > 0);
  await ctx.close();

  const g = await member({ fresh: true, birthDate: '1990-01-01' });
  const guest = await open('/account/', { width: 1280, height: 860 });
  await signIn(guest.page, g);
  await home(guest.page);
  await guest.page.waitForSelector('[data-tour]', { timeout: 5000 });
  await guest.page.click('[data-tour-next]');
  assert.match(await text(guest.page, '.ac-ob__text'), /كضيف بدون نقاط/);
  await sleep(900);
  await guest.page.screenshot({ path: SHOTS + 'tour-desktop.png' });
  await guest.ctx.close();
});

test('the walkthrough waits: someone who signed in for a service goes there first; reduced motion holds still', async () => {
  const m = await member({ fresh: true });
  const { page, ctx } = await open('/account/');
  await page.waitForSelector('#acct-email');
  await page.evaluate(() => sessionStorage.setItem('athanasios.account.return.v1', '/black-theatre/'));
  await set(page, '#acct-email', m.email);
  await set(page, '#acct-password', m.password);
  await page.$eval('form', f => f.requestSubmit());
  await page.waitForFunction(() => location.pathname === '/black-theatre/', { timeout: 10000 });
  assert.equal(await page.$('[data-tour]'), null);
  assert.equal((await h.db.prepare('SELECT onboarded_at FROM participants WHERE id = ?').bind(m.id).first()).onboarded_at, null, 'still ahead of them');
  await page.goto(LOCAL + '/account/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-tour]', { timeout: 8000 });
  await ctx.close();

  const r = await member({ fresh: true });
  const still = await open('/account/', { reduced: true });
  await signIn(still.page, r);
  await home(still.page);
  await still.page.waitForSelector('[data-tour]', { timeout: 5000 });
  assert.equal(await still.page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length), 0);
  await still.ctx.close();
});

test('what the first page costs: one API call, no competition query, and a light page', async () => {
  const m = await member();
  await seed(m);
  const { page, ctx } = await open();
  await signIn(page, m);
  await home(page);
  const next = await ctx.newPage();
  const calls = [];
  next.on('request', r => { if (r.url().startsWith(API) && r.method() !== 'OPTIONS') calls.push(new URL(r.url()).pathname); });
  await next.goto(LOCAL + '/account/', { waitUntil: 'domcontentloaded' });
  await next.waitForSelector('[data-home]', { timeout: 8000 });
  await sleep(500);
  assert.deepEqual(calls.filter(c => c !== '/v1/account/config'), ['/v1/account/summary']);
  await route(next, '#me/points', '[data-ledger]');
  await next.evaluate(() => { location.hash = '#me'; });
  await next.waitForSelector('[data-home]');
  assert.equal(calls.filter(c => c === '/v1/account/summary').length, 1, 'kept for a minute');
  assert.ok(!calls.includes('/v1/comp/me'));
  const sizes = ['assets/js/account/app.js', 'assets/js/account/home.js', 'assets/js/account/parts.js', 'assets/js/account/motion.js', 'assets/js/account/model.js', 'assets/css/account.css'].map(f => readFileSync(join(ROOT, f)).length);
  assert.ok(sizes.reduce((a, b) => a + b) < 140 * 1024, 'sizes ' + sizes);
  await ctx.close();
});
