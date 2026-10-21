// Phase 2 P2-5 in headless Chrome: GitHub Pages' 404 (this server answers every missing path with
// 404.html, status 404). A new page / event / competition live on the Worker (MOCKED by request
// interception) but without a stub yet shows at once; the Worker down → «مش متاحة»; any other path →
// the plain 404 page. Run: cd tools && node --test --test-concurrency=1 ../tests/not-found.e2e.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { ROOT } from '../tools/lib/gs.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');
const PORT = 4984;
const BASE = `http://localhost:${PORT}`;
const API = 'https://athanasios-api.menazak-lab.workers.dev';
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find(existsSync);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const read = p => readFileSync(`${ROOT}${p}`, 'utf8');
const MARK = 'جديد من الـ Worker ✓';
const FILES = {
  '/v1/public/event/new-trip': JSON.stringify({ ...JSON.parse(read('events/test/event.json')), slug: 'new-trip', title: MARK + ' رحلة' }),
  '/v1/public/page/new-page': JSON.stringify({ ...JSON.parse(read('black-theatre/page.json')), slug: 'new-page', title: MARK + ' صفحة' }),
  '/v1/public/comp/new-quiz': JSON.stringify({ ...JSON.parse(read('competition/test/comp.json')), slug: 'new-quiz', title: MARK + ' مسابقة' }),
  '/v1/public/content': read('content.json')
};
let server, browser, down = false;

test.before(async () => {
  server = createServer((req, res) => {
    let path = decodeURIComponent(new URL(req.url, BASE).pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(normalize(ROOT)) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });     // as GitHub Pages
      res.end(readFileSync(`${ROOT}404.html`));
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(readFileSync(file));
  });
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
});
test.after(async () => { await browser?.close(); await new Promise(r => (server ? server.close(r) : r())); });

async function open(path) {
  const page = await browser.newPage();
  const problems = [];
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && /Content Security Policy|document\.write/.test(m.text())) problems.push(m.text()); });
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = request.url();
    if (!url.startsWith(API)) { if (/^http:\/\/(localhost|127\.0\.0\.1)/.test(url) || /^(data|blob):/.test(url)) request.continue(); else request.abort(); return; }
    const cors = { 'access-control-allow-origin': BASE, 'access-control-expose-headers': 'etag, date' };
    if (request.method() === 'OPTIONS') { request.respond({ status: 204, headers: cors }); return; }
    const p = new URL(url).pathname;
    if (down) { request.respond({ status: 503, headers: cors, body: 'down' }); return; }
    if (FILES[p]) request.respond({ status: 200, headers: cors, contentType: 'application/json; charset=utf-8', body: FILES[p] });
    else request.respond({ status: 404, headers: cors, contentType: 'application/json', body: '{"ok":false,"code":"not_found"}' });
  });
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  return { page, problems };
}
const shows = (page, text) => page.waitForFunction(t => document.body && document.body.innerText.includes(t), { timeout: 9000 }, text);

for (const [name, path] of [['an event', '/events/new-trip/?content=worker'], ['a page', '/new-page/?content=worker'], ['a competition', '/competition/new-quiz/?content=worker'], ['no trailing slash', '/events/new-trip?content=worker']]) {
  test(`a new slug before its stub — ${name}: shown from the Worker`, async () => {
    down = false;
    const { page, problems } = await open(path);
    await shows(page, MARK);
    const at = await page.evaluate(() => ({ path: location.pathname, slug: document.documentElement.dataset.slug }));
    assert.ok(at.path.endsWith('/'), at.path);
    assert.ok(at.slug && path.includes(at.slug), JSON.stringify(at));
    assert.deepEqual(problems, []);
    await page.close();
  });
}

test('the Worker down: the new slug is «not available» (the page engine), never broken', async () => {
  down = true;
  const { page, problems } = await open('/events/new-trip/?content=worker');
  await page.waitForFunction(() => document.querySelector('main') && document.querySelector('main').dataset.state && document.querySelector('main').dataset.state !== 'loading', { timeout: 9000 });
  assert.ok(!(await page.evaluate(() => document.body.innerText)).includes(MARK));
  assert.deepEqual(problems, []);
  await page.close();
  down = false;
});

test('any other missing path: the plain 404 page, nothing written in', async () => {
  for (const path of ['/media/2026/nope.webp.html', '/admin/nope/', '/a/b/c/']) {
    const { page, problems } = await open(path);
    await shows(page, 'الصفحة دي مش موجودة');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.shell), '404');
    assert.deepEqual(problems, [], path);
    await page.close();
  }
});
