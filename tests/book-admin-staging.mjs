// STAGING-ONLY (not part of `npm run e2e`): the real admin «الحجوزات» screens in
// headless Chrome against the REAL staging Worker. Apps Script stays the test
// fake (tools/lib/admin-server.mjs); every Worker call is passed through to
// staging with the staging test admin token (worker/.staging-test-key.pem).
// Usage: cd tools && node ../tests/book-admin-staging.mjs
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { createSign, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { ROOT } from '../tools/lib/gs.mjs';
import { createSiteServer, interceptGoogle, TEST_API, TEST_CLIENT, TEST_FALLBACK } from '../tools/lib/admin-server.mjs';
import { createWorld } from './fakes/gas.mjs';
import { wallAt } from './fakes/comp.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');
const sharp = require('sharp');
const STAGING = 'https://athanasios-api-staging.menazak-lab.workers.dev';
const PORT = 8080;                                   // an origin the staging Worker allows (CORS)
const LOCAL = `http://127.0.0.1:${PORT}`;
const ADMIN = 'menazakmena@gmail.com';
const SHOTS = `${ROOT}tools/.cache/book-admin-staging/`;
const PEM = readFileSync(`${ROOT}worker/.staging-test-key.pem`, 'utf8');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find(existsSync);
const RUN = Date.now().toString(36);
const log = [];
const ok = (name, cond, detail) => { log.push((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + JSON.stringify(detail).slice(0, 300))); };

function token() {
  const e = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const n = Math.floor(Date.now() / 1000);
  const h = e({ alg: 'RS256', kid: 'staging-test' }) + '.' + e({ iss: 'https://accounts.google.com', aud: '246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com', sub: 'loadtest-1', email: 'loadtest@staging.invalid', email_verified: true, name: 'Load Test', iat: n, exp: n + 3600 });
  return h + '.' + createSign('RSA-SHA256').update(h).sign(PEM).toString('base64url');
}
async function api(method, path, body, raw, session = '') {
  const headers = { origin: LOCAL, authorization: 'Bearer ' + token() };
  if (session) headers['x-edit-session'] = session;
  if (raw) headers['content-type'] = 'image/jpeg', headers['idempotency-key'] = 'stg-' + randomUUID();
  else if (body) headers['content-type'] = 'application/json';
  return (await fetch(STAGING + path, { method, headers, body: raw || (body ? JSON.stringify(body) : undefined) })).json();
}
function stamp(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

// the event in the Apps Script fake (the admin's events list) and, with the same id, on staging
const world = createWorld({ executeAs: 'USER_DEPLOYING' });
world.as(ADMIN).gs.setup();
for (const [k, v] of Object.entries({ GITHUB_TOKEN: 't', GITHUB_REPO: 'StAthanasiosYouth/StAthanasiosYouth.github.io', SITE_URL: 'https://stathanasiosyouth.github.io/', ADMIN_CLIENT_ID: TEST_CLIENT, ADMIN_EMAILS: ADMIN, ADMIN_NAMES: JSON.stringify({ [ADMIN]: 'مينا زكريا' }) })) world.properties.set(k, v);
world.gs.SESSION_STALE_SECONDS = 0;
const slug = 'stg-' + RUN;
const saved = JSON.parse(JSON.stringify(world.as(ADMIN).gs.apiEventSave(null, {
  slug, kind: 'trip', title: 'رحلة تجربة الإدارة', summary: 'تجربة', startAt: wallAt(world, 20 * 1440), endAt: wallAt(world, 20 * 1440 + 600),
  booking: { capacity: 40, pricing: { mode: 'group', categories: [{ label: 'الحاجز', price: 1500 }, { key: 'adult', label: 'فرد إضافي', group: 'adult', price: 1500, max: 6 }] }, payment: { mode: 'full' } },
  home: { show: false }
})));
world.as('');
const eventId = saved.event.id;
const now = Date.now();
const EVENT_JSON = {
  schema: 1, v: 'stg' + RUN, id: eventId, slug, title: 'رحلة تجربة الإدارة', startAt: stamp(now + 20 * 864e5), endAt: stamp(now + 20 * 864e5 + 36e6),
  booking: { online: true, opensAt: stamp(now - 864e5), closesAt: '', capacity: 40, showLeft: true, showLeftBelow: 20, perBookingMax: 6, collectNames: false,
    pricing: { mode: 'group', categories: [{ key: 'applicant', label: 'الحاجز', group: 'adult', price: 1500, seat: true, min: 1, max: 1, note: '' }, { key: 'adult', label: 'فرد إضافي', group: 'adult', price: 1500, seat: true, min: 0, max: 6, note: '' }] },
    payment: { mode: 'full', minFirst: 0, finalDueAt: '' },
    methods: [{ key: 'cash', label: 'كاش', icon: '', needsProof: false }, { key: 'instapay', label: 'إنستاباي', icon: '', needsProof: true }],
    servants: [{ id: 'srv-mina0001', name: 'مينا عادل', role: '', image: null, wa: null, methods: ['cash', 'instapay'] }, { id: 'srv-fady0002', name: 'فادي يوسف', role: '', image: null, wa: null, methods: ['cash'] }] }
};
ok('event stored on staging (same id as the admin\'s)', (await api('POST', '/v1/admin/diag/event-fixture', EVENT_JSON)).ok);
const made = await api('POST', '/v1/admin/book/bookings', { eventId, requestKey: 'stg-' + RUN, name: 'زائر الإدارة', phone: '0102' + String(Date.now()).slice(-7), counts: { applicant: 1, adult: 1 }, servantId: 'srv-mina0001', method: 'instapay' });
const ref = made.booking && made.booking.ref;
const proofJpg = await sharp({ create: { width: 900, height: 1600, channels: 3, background: { r: 230, g: 236, b: 240 } } }).composite([{ input: Buffer.from('<svg width="900" height="1600"><text x="60" y="800" font-size="70" fill="#123">InstaPay 3000</text></svg>'), top: 0, left: 0 }]).jpeg().toBuffer();
const up = await api('POST', `/v1/admin/proofs?purpose=booking&bookingId=${made.booking.id}`, null, proofJpg);
ok(`booking ${ref} + a real proof on staging`, !!ref && up.ok, { made, up });

const server = createSiteServer({
  world: { issueToken: c => world.issueToken(c), get github() { return world.github; } },
  config: () => ({ apiUrl: TEST_API, clientId: TEST_CLIENT, fallbackUrl: TEST_FALLBACK, workerUrl: STAGING }),
  claims: () => ({ email: ADMIN })
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const proxied = [];
try {
  mkdirSync(SHOTS, { recursive: true });
  const page = await browser.newPage();
  const problems = [];
  page.on('pageerror', e => problems.push(e.message));
  page.on('console', m => { if (/Content Security Policy|Refused to/i.test(m.text())) problems.push(m.text()); });
  await page.setViewport({ width: 1366, height: 900 });
  // every Worker call goes to the real staging Worker (only the token is the staging test admin's)
  await interceptGoogle(page, { post: body => world.post(body) }, {
    handle: async request => {
      const url = request.url();
      if (url.split('?')[0] === `${LOCAL}/events/${slug}/event.json`) return { status: 200, contentType: 'application/json', body: JSON.stringify(EVENT_JSON) };
      // test only: the admin page's CSP also allows the staging Worker (production allows only its own)
      if (url.split(/[?#]/)[0] === `${LOCAL}/admin/` || url.split(/[?#]/)[0] === `${LOCAL}/admin/index.html`) {
        const html = readFileSync(`${ROOT}admin/index.html`, 'utf8').replace('https://athanasios-api.menazak-lab.workers.dev', `https://athanasios-api.menazak-lab.workers.dev ${STAGING}`);
        return { status: 200, contentType: 'text/html; charset=utf-8', body: html };
      }
      if (!url.startsWith(STAGING + '/')) return null;
      const method = request.method();
      const headers = { ...request.headers(), origin: LOCAL };
      delete headers.host;
      if (headers.authorization) headers.authorization = 'Bearer ' + token();
      const body = ['GET', 'HEAD', 'OPTIONS'].includes(method) ? undefined : (request.postData() ?? (request.hasPostData() ? await request.fetchPostData() : undefined));
      const res = await fetch(url, { method, headers, body });
      proxied.push(`${method} ${new URL(url).pathname} ${res.status}`);
      const out = {};
      res.headers.forEach((v, k) => { if (!/^(content-length|content-encoding|transfer-encoding|connection)$/i.test(k)) out[k] = v; });
      return { status: res.status, headers: out, body: Buffer.from(await res.arrayBuffer()) };
    }
  });
  await page.goto(`${LOCAL}/admin/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.gis-stub');
  await page.click('.gis-stub');
  await page.waitForFunction(() => window.A && A.state && !document.getElementById('shell').hidden, { timeout: 20000 });
  await page.evaluate(id => A.openLink('#open/bookings/' + id), eventId);
  await page.waitForSelector(`.book-row[data-ref="${ref}"]`, { timeout: 20000 });
  ok('«الحجوزات» opened from staging: the booking is in the queue', true);
  await page.click(`.book-row[data-ref="${ref}"]`);
  await page.waitForFunction(r => { const n = document.querySelector('#sheet[open] .sheet__title'); return n && n.textContent === 'حجز ' + r; }, { timeout: 15000 }, ref);
  await page.waitForFunction(() => { const img = document.querySelector('#sheet .book-proof img'); return img && img.src.startsWith('blob:') && img.complete && img.naturalWidth === 900; }, { timeout: 20000 });
  ok('booking sheet: the real proof streamed from private R2 as a blob', true);
  await page.screenshot({ path: SHOTS + '1-sheet.png' });

  await page.waitForSelector('#sheet [data-act="confirm"]:not([disabled])', { visible: true });
  await page.click('#sheet [data-act="confirm"]');
  await page.waitForFunction(r => document.querySelector('#sheet[open] .sheet__title').textContent === 'تأكيد ' + r, { timeout: 15000 }, ref);
  const amount = await page.waitForSelector('#sheet .field[data-label="المبلغ"] input', { visible: true });
  await amount.click({ clickCount: 3 });
  await amount.type('3000');
  const preset = await page.$('#sheet .field[data-label="وقت الاستلام"] .preset');
  if (preset) await preset.click();
  await page.click('#sheet [data-act="submit"]');
  await page.waitForFunction(r => { const t = document.querySelector('#sheet[open] .sheet__title'); return t && t.textContent === 'حجز ' + r && /مؤكد/.test(document.querySelector('#sheet .book-chips').innerText); }, { timeout: 20000 }, ref);
  ok('confirmed from the admin UI with a 3000 payment (full mode)', true);
  await page.screenshot({ path: SHOTS + '2-confirmed.png' });

  // edit locks against the real Worker: the open sheet holds the booking …
  const OTHER = 'sid-other-page-' + RUN;
  const held = await api('POST', `/v1/admin/book/bookings/${made.booking.id}/lock`, {}, null, OTHER);
  ok('while the sheet is open, another page is refused the lock (holder named)', held.ok && held.granted === false && held.holder && held.holder.name === 'Load Test', held);
  // … gives it back on close; another page takes it; reopened → read only with who
  await page.evaluate(() => A.closeSheet());
  await page.waitForFunction(() => !document.getElementById('sheet').open);
  let taken = null;
  for (let i = 0; i < 20 && !(taken && taken.granted); i++) {
    await new Promise(r => setTimeout(r, 300));
    taken = await api('POST', `/v1/admin/book/bookings/${made.booking.id}/lock`, {}, null, OTHER);
  }
  ok('closing the sheet released it: the other page takes it', taken && taken.granted === true, taken);
  // (confirmed now: not in the «جديد» queue) the booking opened directly, as a push link would
  await page.evaluate(id => A.book.openBooking(id), made.booking.id);
  await page.waitForSelector('#sheet.is-locked .lock-banner[data-lock="held"]', { timeout: 15000 });
  const lockText = await page.$eval('#sheet .lock-banner__title', n => n.textContent);
  const lockedActs = await page.$$eval('#sheet [data-act]', ns => ns.filter(n => n.getAttribute('data-act') !== 'back').map(n => n.disabled));
  ok('reopened while held elsewhere: «… بيعدّل الحجز ده دلوقتي», every move off', /^Load Test بيعدّل الحجز ده دلوقتي/.test(lockText) && lockedActs.length > 0 && lockedActs.every(Boolean), { lockText, lockedActs });
  await page.screenshot({ path: SHOTS + '3-locked.png' });
  const refused = await page.evaluate(id => window.AdminWorker.call('POST', '/v1/admin/book/bookings/' + id + '/payments', { kind: 'payment', amount: 10, servantId: 'srv-mina0001', method: 'cash', receivedAt: '2026-01-01T10:00', idemKey: 'lockchk-' + Date.now() }).then(() => 'ok', e => e.code), made.booking.id);
  ok('a move from this page anyway → the Worker says locked', refused === 'locked', refused);
  await api('DELETE', `/v1/admin/book/bookings/${made.booking.id}/lock`, undefined, null, OTHER);
  await page.waitForSelector('#sheet .lock-banner[data-lock="free"] [data-lock-refresh]', { timeout: 45000 });
  ok('the other page let go: the next renewal offers «افتح آخر نسخة»', true);
  await page.click('#sheet [data-lock-refresh]');
  await page.waitForFunction(() => { const s = document.getElementById('sheet'); return s.open && !s.classList.contains('is-locked') && !s.querySelector('.lock-banner'); }, { timeout: 15000 });
  ok('… the latest booking, moves back on', true);
  ok('no page errors / CSP refusals', problems.length === 0, problems);
} catch (err) {
  log.push('FAIL ' + err.message.split('\n')[0]);
  try {
    const p = (await browser.pages()).at(-1);
    await p.screenshot({ path: SHOTS + 'fail.png' });
    log.push('shot: ' + SHOTS + 'fail.png');
    log.push('text: ' + (await p.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 400))));
  } catch { /* best effort */ }
} finally {
  await browser.close();
  server.close();
}

console.log(log.join('\n'));
console.log('worker calls:', proxied.join(' | '));
if (log.some(l => l.startsWith('FAIL'))) process.exit(1);
// what staging now holds
const det = await api('GET', '/v1/admin/book/bookings/' + made.booking.id);
ok('staging: confirmed, paid 3000, payment by the signed-in admin, the proof attached to it', det.booking.status === 'confirmed' && det.derived.paymentStatus === 'paid' && det.payments.length === 1 && det.payments[0].recordedBy === 'loadtest@staging.invalid', { status: det.booking.status, derived: det.derived, payments: det.payments });
await api('POST', `/v1/admin/book/events/${eventId}/cancel-all`, { reason: 'نهاية التجربة', idemKey: 'ca-' + eventId });
console.log(log.join('\n'));
console.log('worker calls:', proxied.length, [...new Set(proxied.map(p => p.replace(/bkg-[a-z0-9]+|prf-[a-z0-9]+|evt-[a-z0-9]+/g, ':id')))].join(' | '));
