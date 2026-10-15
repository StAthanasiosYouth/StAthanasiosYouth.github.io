// STAGING-ONLY: the real event page in headless Chrome → the real staging Worker (no mocks).
// Usage: node worker/scripts/book-ui-staging.mjs <out-dir>   (needs puppeteer-core + sharp: tools/node_modules or TOOLS_FROM)
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createSign, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/\\/g, '/');
const req = createRequire(process.env.TOOLS_FROM || ROOT + 'tools/package.json');
const puppeteer = req('puppeteer-core');
const sharp = req('sharp');
const OUT = process.argv[2];
const API = 'https://athanasios-api-staging.menazak-lab.workers.dev';
const PEM = readFileSync(ROOT + 'worker/.staging-test-key.pem', 'utf8');
const CLIENT_ID = '246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com';
const RUN = Date.now().toString(36);

function stamp(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
function tok() {
  const e = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const n = Math.floor(Date.now() / 1000);
  const h = e({ alg: 'RS256', kid: 'staging-test' }) + '.' + e({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 'loadtest-1', email: 'loadtest@staging.invalid', email_verified: true, name: 'Load Test', iat: n, exp: n + 3600 });
  return h + '.' + createSign('RSA-SHA256').update(h).sign(PEM).toString('base64url');
}
async function admin(m, p, b) {
  const r = await fetch(API + p, { method: m, headers: { origin: 'https://stathanasiosyouth.github.io', authorization: 'Bearer ' + tok(), 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  return r.json();
}

const base = JSON.parse(readFileSync(ROOT + 'tests/fixtures/pages/event.json', 'utf8'));
const now = Date.now();
const slug = 'ui-' + RUN;
const ev = {
  ...base, slug, id: 'evt-u' + RUN, v: 'ui' + RUN, title: 'تجربة الواجهة ' + RUN, startAt: stamp(now + 10 * 864e5), endAt: stamp(now + 11 * 864e5),
  booking: {
    ...base.booking, online: true, showLeft: true, showLeftBelow: 20, opensAt: stamp(now - 864e5), closesAt: stamp(now + 5 * 864e5),
    payment: { mode: 'installments', minFirst: 500, finalDueAt: '' }, methods: base.booking.methods.map(m => ({ ...m, needsProof: m.key === 'instapay' }))
  }
};
const log = [];
const ok = (name, cond, detail) => { log.push((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + JSON.stringify(detail).slice(0, 300))); };
const fx = await admin('POST', '/v1/admin/diag/event-fixture', ev);
ok('fixture on staging', fx.ok, fx);

const SHELL = readFileSync(ROOT + 'pages/index.html', 'utf8').replace(/\r\n/g, '\n');
const stub = SHELL.replace('  <meta name="robots" content="noindex">\n', '')
  .replace('<html lang="ar" dir="rtl">', `<html lang="ar" dir="rtl" data-kind="event" data-slug="${slug}" data-v="${ev.v}">`)
  .replace(/(\s(?:href|src)=")\.\.\//g, '$1../../');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.webmanifest': 'application/manifest+json' };
const server = createServer((rq, rs) => {
  const path = decodeURIComponent(new URL(rq.url, 'http://x').pathname);
  if (path === `/events/${slug}/` || path === `/events/${slug}/index.html`) { rs.writeHead(200, { 'content-type': TYPES['.html'] }); return rs.end(stub); }
  if (path === `/events/${slug}/event.json`) { rs.writeHead(200, { 'content-type': TYPES['.json'] }); return rs.end(JSON.stringify(ev)); }
  const file = normalize(join(ROOT, path.endsWith('/') ? path + 'index.html' : path));
  if (!file.startsWith(normalize(ROOT)) || !existsSync(file)) { rs.writeHead(404); return rs.end(); }
  rs.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  rs.end(readFileSync(file));
});
await new Promise(r => server.listen(8080, '127.0.0.1', r));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage();
  const problems = [];
  page.on('pageerror', e => problems.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(m.text()); });
  await page.setViewport({ width: 360, height: 740, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:8080/events/${slug}/?api=${encodeURIComponent(API)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main[data-state="ready"]', { timeout: 15000 });
  await page.waitForSelector('#book[data-live="open"]', { timeout: 15000 });
  ok(`page ready + live state from staging (${Date.now() - t0} ms)`, true);
  const step = s => page.waitForSelector(`.bk-flow[data-step="${s}"]`, { timeout: 15000 });
  const type = async (sel, text) => { await page.click(sel, { clickCount: 3 }); await page.keyboard.press('Backspace'); await page.type(sel, text); };
  await page.click('.bk-start');
  await step('a');
  await type('#bk-name', 'تجربة متصفح حقيقية');
  await type('#bk-phone', '0101' + String(Date.now()).slice(-7));
  await page.click('.bk-flow [aria-label="زوّد فرد إضافي"]');
  await page.click('.bk-flow .bk-next');
  await step('b');
  await page.click('label[for="bk-servant-srv-mina0001"]');
  await page.click('label[for="bk-method-instapay"]');
  await page.click('.bk-flow .bk-next');
  await step('c');
  const jpg = OUT + '/proof.jpg';
  writeFileSync(jpg, await sharp({ create: { width: 1170, height: 2532, channels: 3, background: { r: 240, g: 240, b: 245 } } })
    .composite([{ input: Buffer.from('<svg width="1170" height="2532"><text x="80" y="1200" font-size="90" fill="#123">InstaPay 3000 EGP</text></svg>'), top: 0, left: 0 }]).jpeg({ quality: 85 }).toBuffer());
  const t1 = Date.now();
  await (await page.$('#bk-proof-input')).uploadFile(jpg);
  await page.waitForSelector('.bk-proof[data-state="done"]', { timeout: 30000 });
  ok(`phone-size screenshot prepared in the browser + uploaded to staging R2 (${Date.now() - t1} ms)`, true);
  if (!(await page.$eval('#bk-agree', e => e.checked))) await page.click('label[for="bk-agree"]');
  // the REAL Turnstile widget (Cloudflare's script, staging's always-pass test site key; its iframe sits in a closed shadow root): its token before the send
  const t3 = Date.now();
  await page.waitForFunction(() => { const i = document.querySelector('#bk-turnstile input[name="cf-turnstile-response"]'); return i && i.value; }, { timeout: 30000 });
  ok(`Turnstile widget loaded under the page CSP and issued a token (${Date.now() - t3} ms)`, true);
  await (await page.$('[data-field="turnstile"]')).screenshot({ path: OUT + '/turnstile.png' });
  const t2 = Date.now();
  await page.click('.bk-send');
  await step('done');
  const ref = await page.$eval('.bk-done__code', e => e.textContent.trim());
  ok(`submitted to staging → ${ref} (${Date.now() - t2} ms)`, /^B-[0-9A-Z]{5}$/.test(ref), ref);
  await page.screenshot({ path: OUT + '/done.png' });
  await page.click('.bk-done__status-link');
  await page.waitForSelector('#bstat .bstat__chip', { timeout: 15000 });
  ok('status view (pending) from staging', (await page.$eval('.bstat__chip', e => e.textContent.trim())) === 'قيد المراجعة');

  const list = await admin('GET', `/v1/admin/book/bookings?eventId=${ev.id}&q=${encodeURIComponent(ref)}`);
  const row = list.rows && list.rows[0];
  ok('admin sees the booking, server price 3000', row && row.quotedTotal === 3000, list);
  const det = await admin('GET', '/v1/admin/book/bookings/' + row.id);
  ok('visitor proof stored privately and attached', det.proofs.length === 1, det.proofs);
  const conf = await admin('POST', `/v1/admin/book/bookings/${row.id}/confirm`, { version: det.booking.version, payments: [{ kind: 'payment', amount: 1000, servantId: 'srv-mina0001', method: 'instapay', receivedAt: stamp(Date.now() - 60000), proofIds: [det.proofs[0].id], idemKey: 'ui-' + randomUUID() }] });
  ok('admin confirmed with a 1000 first payment + the visitor proof', conf.ok && conf.booking.status === 'confirmed', conf);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#bstat .bstat__chip', { timeout: 15000 });
  const chip = await page.$eval('.bstat__chip', e => e.textContent.trim());
  const rows = await page.$eval('.bstat__rows', e => e.textContent.replace(/\s+/g, ' '));
  ok('visitor status now confirmed with paid / remaining', !/المراجعة/.test(chip) && /١٬٠٠٠/.test(rows) && /٢٬٠٠٠/.test(rows), { chip, rows });
  await page.screenshot({ path: OUT + '/status-confirmed.png' });
  ok('no page errors', problems.length === 0, problems);
  await admin('POST', `/v1/admin/book/events/${ev.id}/cancel-all`, { reason: 'نهاية التجربة', idemKey: 'ca-' + ev.id });
} finally {
  await browser.close();
  server.close();
}
console.log(log.join('\n'));
