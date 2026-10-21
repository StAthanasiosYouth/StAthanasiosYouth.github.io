// Phase 2 P2-3 (docs/PUBLISH-SEPARATION-PLAN.md): the public pages read published content from
// the Worker when CONTENT_SOURCE is 'worker' (here: ?content=worker, localhost only), and fall
// back to the static files when it is down, switched off, slow or empty. Headless Chrome on the
// real files of the repo; the Worker is MOCKED by request interception (nothing reaches it).
//   home (content.json) · a page (black-theatre) · an event (events/test) · the events list ·
//   a competition (competition/test)
// Run: cd tools && node --test --test-concurrency=1 ../tests/content-source.e2e.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { ROOT } from '../tools/lib/gs.mjs';
import { CONTENT_SOURCE } from '../assets/js/content-source.js';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');

const PORT = 4983;
const BASE = `http://localhost:${PORT}`;
const API = 'https://athanasios-api.menazak-lab.workers.dev';
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find(existsSync);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.ics': 'text/calendar' };

const read = p => readFileSync(`${ROOT}${p}`, 'utf8');
const MARK = 'من الـ Worker ✓';
// the Worker's live revisions: the repo's files with one visible field changed
const WORKER_FILES = {
  '/v1/public/content': (() => { const c = JSON.parse(read('content.json')); c.site.tagline = MARK; return JSON.stringify(c); })(),
  '/v1/public/page/black-theatre': (() => { const p = JSON.parse(read('black-theatre/page.json')); p.title = MARK; return JSON.stringify(p); })(),
  '/v1/public/event/test': (() => { const e = JSON.parse(read('events/test/event.json')); e.title = MARK; return JSON.stringify(e); })(),
  '/v1/public/comp/test': (() => { const c = JSON.parse(read('competition/test/comp.json')); c.title = MARK; return JSON.stringify(c); })()
};

let server;
let browser;
let worker = 'serve';          // serve | down | off | slow | empty
let freshStubs = true;         // the committed stubs predate the Worker in the CSP: serve them as a re-publish would make them
const SITE_CSP = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(read('index.html'))[1];
const STUB_CSP = { '/black-theatre/index.html': /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(read('pages/index.html'))[1], '/competition/test/index.html': SITE_CSP };
const seen = [];

test.before(async () => {
  server = createServer((req, res) => {
    let path = decodeURIComponent(new URL(req.url, BASE).pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(normalize(ROOT)) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    if (freshStubs && STUB_CSP[path]) {
      res.end(readFileSync(file, 'utf8').replace(/(<meta http-equiv="Content-Security-Policy" content=")[^"]+/, `$1${STUB_CSP[path]}`));
      return;
    }
    res.end(readFileSync(file));
  });
  await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
});

test.after(async () => {
  await browser?.close();
  await new Promise(resolve => (server ? server.close(resolve) : resolve()));
});

async function open(path) {
  // a rare puppeteer hiccup ("Session with given id not found") on a new tab: once more
  const page = await browser.newPage().catch(() => browser.newPage());
  const problems = [];
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && /Content Security Policy/.test(m.text())) problems.push('csp: ' + m.text()); });
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = request.url();
    if (!url.startsWith(API)) {
      if (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(url) || url.startsWith('data:') || url.startsWith('blob:')) request.continue();
      else request.abort();                       // nothing else leaves the machine
      return;
    }
    const cors = { 'access-control-allow-origin': BASE, 'access-control-expose-headers': 'etag, date', vary: 'Origin' };
    if (request.method() === 'OPTIONS') { request.respond({ status: 204, headers: { ...cors, 'access-control-allow-methods': 'GET' } }); return; }
    const p = new URL(url).pathname;
    if (!p.startsWith('/v1/public/')) { request.respond({ status: 404, headers: cors, contentType: 'application/json', body: '{"ok":false}' }); return; }
    seen.push(p);
    if (worker === 'slow') return;                // never answers: the page's 2-s timeout
    if (worker === 'down') { request.respond({ status: 503, headers: cors, body: 'down' }); return; }
    if (worker === 'off') { request.respond({ status: 403, headers: cors, contentType: 'application/json', body: '{"ok":false,"code":"disabled"}' }); return; }
    const body = worker === 'empty' ? null : WORKER_FILES[p];
    if (!body) { request.respond({ status: 404, headers: cors, contentType: 'application/json', body: '{"ok":false,"code":"not_found"}' }); return; }
    request.respond({ status: 200, headers: { ...cors, etag: '"x"', 'cache-control': 'no-cache' }, contentType: 'application/json; charset=utf-8', body });
  });
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  return { page, problems };
}

const shows = (page, text, timeout = 8000) => page.waitForFunction(t => document.body && document.body.innerText.includes(t), { timeout }, text);
const CASES = [
  ['home', '/?content=worker', '/v1/public/content', JSON.parse(read('content.json')).site.tagline],
  ['a page', '/black-theatre/?content=worker', '/v1/public/page/black-theatre', JSON.parse(read('black-theatre/page.json')).title],
  ['an event', '/events/test/?content=worker', '/v1/public/event/test', JSON.parse(read('events/test/event.json')).title],
  ['a competition', '/competition/test/?content=worker', '/v1/public/comp/test', JSON.parse(read('competition/test/comp.json')).title]
];

for (const [name, path, route] of CASES) {
  test(`${name}: the Worker's live revision is shown`, async () => {
    worker = 'serve'; seen.length = 0;
    const { page, problems } = await open(path);
    await shows(page, MARK);
    assert.ok(seen.includes(route), seen.join(', '));
    assert.deepEqual(problems, []);
    await page.close();
  });
}

for (const mode of ['down', 'off', 'empty', 'slow']) {
  test(`the Worker ${mode}: every page falls back to its static file`, async () => {
    worker = mode;
    for (const [name, path, route, staticText] of CASES) {
      seen.length = 0;
      const t0 = Date.now();
      const { page, problems } = await open(path);
      await shows(page, staticText, 9000);
      assert.ok(!(await page.evaluate(() => document.body.innerText)).includes(MARK), name + ': nothing from the Worker');
      assert.ok(seen.includes(route), name + ': the Worker was asked first');
      if (mode === 'slow') assert.ok(Date.now() - t0 < 8000, name + ': within the timeout');
      assert.deepEqual(problems, [], name);
      await page.close();
    }
  });
}

test(`without ?content= on this machine (switch ${CONTENT_SOURCE}): the repo's files, no request to the Worker`, async () => {
  worker = 'serve'; seen.length = 0;
  for (const [, path] of CASES) {
    const { page } = await open(path.replace('?content=worker', ''));
    await page.waitForNetworkIdle({ idleTime: 400, timeout: 8000 });
    await page.close();
  }
  assert.deepEqual(seen, [], 'local previews and tests stay on the repo (the site itself follows the switch: unit test)');
});

test('?content=static on this machine: the static files only (the rollback path)', async () => {
  worker = 'serve'; seen.length = 0;
  for (const [, path] of CASES) {
    const { page } = await open(path.replace('?content=worker', '?content=static'));
    await page.waitForNetworkIdle({ idleTime: 400, timeout: 8000 });
    await page.close();
  }
  assert.deepEqual(seen, []);
});

test('the events list reads content.json from the Worker too', async () => {
  worker = 'serve'; seen.length = 0;
  const { page, problems } = await open('/events/?content=worker');
  await page.waitForFunction(() => document.body.innerText.length > 100, { timeout: 8000 });
  assert.ok(seen.includes('/v1/public/content'), seen.join(', '));
  assert.deepEqual(problems, []);
  await page.close();
});

test('an old stub (its CSP without the Worker, as committed today): the static file, the page works', async () => {
  worker = 'serve'; freshStubs = false;
  try {
    const { page, problems } = await open('/black-theatre/?content=worker');
    await shows(page, JSON.parse(read('black-theatre/page.json')).title, 9000);
    assert.ok(!(await page.evaluate(() => document.body.innerText)).includes(MARK));
    assert.deepEqual(problems.filter(p => !p.startsWith('csp:')), [], 'only the CSP refusal, handled');
    await page.close();
  } finally {
    freshStubs = true;
  }
});
