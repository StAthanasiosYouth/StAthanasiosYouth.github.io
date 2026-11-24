// P3: captures the LIVE admin shell with «الآيات والقراءات اليومية» open on «الأعياد» (the real /admin/ booted against
// the test fakes: tests/fakes/gas.mjs + tests/fakes/bread-worker.mjs, the world tests/bread-admin.e2e.mjs uses; generic
// test accounts, nothing leaves the machine). The P3 prototype puts its screens inside this shell, styled by the real
// admin/admin.css, so the build is a transfer, not a rewrite (the W1 method, docs/daily-bread/w1/tools/capture-admin.mjs).
// Usage: node docs/daily-bread/saints/p3/tools/capture-admin.mjs → docs/daily-bread/saints/p3/admin-shell.json (+ captured-*.png)
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const P3 = join(HERE, '..');
const ROOT = join(HERE, '..', '..', '..', '..', '..');
const imp = p => import(pathToFileURL(join(ROOT, p)).href);
const { createSiteServer, interceptGoogle, TEST_API, TEST_CLIENT, TEST_FALLBACK } = await imp('tools/lib/admin-server.mjs');
const { createWorld } = await imp('tests/fakes/gas.mjs');
const { createBreadWorker, WORKER_URL } = await imp('tests/fakes/bread-worker.mjs');
const { cairoDay, dayAdd } = await imp('worker/src/bread/model.js');
const MOD = [join(ROOT, 'tools'), 'D:/private_projects/athanasios-links/tools'].find(d => existsSync(join(d, 'node_modules', 'puppeteer-core')));
const req = createRequire(join(MOD, 'package.json'));
const puppeteer = req('puppeteer-core');
const sharp = req('sharp');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);

const ADMIN = 'mina.servant@example.com';
const world = createWorld({ owner: ADMIN, executeAs: 'USER_DEPLOYING' });
world.as(ADMIN).gs.setup();
world.properties.set('GITHUB_TOKEN', 'test-token');
world.properties.set('GITHUB_REPO', 'example/example.github.io');
world.properties.set('SITE_URL', 'https://example.test/');
world.properties.set('ADMIN_CLIENT_ID', TEST_CLIENT);
world.properties.set('ADMIN_EMAILS', ADMIN);
world.properties.set('WORKER_SYNC_SECRET', 's'.repeat(48));
world.properties.set('ADMIN_NAMES', JSON.stringify({ [ADMIN]: 'مينا' }));
world.gs.SESSION_STALE_SECONDS = 0;
world.as('');

const PORT = 4747;
const LOCAL = `http://127.0.0.1:${PORT}`;
const TODAY = cairoDay();
const fake = createBreadWorker({ origin: LOCAL, today: TODAY, admin: ADMIN });
fake.seed({ name: 'سلسلة «خبز الحياة»', days: 30, startsOn: dayAdd(TODAY, -4) });
const month = TODAY.slice(0, 7);
fake.state.suggest = { [month]: { schema: 2, month, made: 'x', days: [], feasts: [{ date: dayAdd(TODAY, 1), on: true, name: 'الشهيد أبي سيفين', title: 'استشهاد القديس مرقوريوس أبي سيفين', word: 'كلمة عنه.', sourceUrl: 'https://st-takla.org/k.html', img: null }] } };

async function handle(request) {
  const url = request.url();
  if (url.startsWith(WORKER_URL + '/v1/admin/bread/')) return fake.handle(request);
  if (url.startsWith(WORKER_URL)) {
    if (request.method() === 'OPTIONS') return { status: 204, headers: { 'access-control-allow-origin': LOCAL, 'access-control-allow-headers': 'authorization, content-type, idempotency-key, accept, x-edit-session', 'access-control-allow-methods': 'GET, POST' }, body: '' };
    return { status: 404, headers: { 'access-control-allow-origin': LOCAL, 'content-type': 'application/json' }, body: JSON.stringify({ ok: false, code: 'not_found', message: 'x' }) };
  }
  return null;
}

const TIMING = { gisSlow: 700, gisFail: 2500, button: 3000, silent: 1500, slow: 900, fail: 4000, render: 8000, beat: 900, beatFail: 2500 };
const server = createSiteServer({
  world: { issueToken: c => world.issueToken(c), get github() { return world.github; } },
  config: () => ({ apiUrl: TEST_API, clientId: TEST_CLIENT, fallbackUrl: TEST_FALLBACK, timing: TIMING, workerUrl: WORKER_URL }),
  claims: () => ({ email: ADMIN })
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
mkdirSync(join(P3, 'shots'), { recursive: true });
const out = {};
for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  await interceptGoogle(page, { post: body => world.post(body) }, { handle });
  await page.goto(`${LOCAL}/admin/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.gis-stub');
  await page.click('.gis-stub');
  await page.waitForFunction(() => window.A && A.state && !document.getElementById('shell').hidden, { timeout: 20000 });
  await sleep(2500);
  await page.addStyleTag({ content: '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; } .intro, .p8intro { display: none !important; }' });
  await page.evaluate(() => A.go('bread', 'breadfeasts'));
  await page.waitForFunction(() => A.area === 'bread' && document.querySelector('#view .ba') && document.querySelector('.ba-feast'), { timeout: 10000 });
  await sleep(900);
  out[name] = await page.evaluate(() => ({
    htmlAttrs: Object.fromEntries([...document.documentElement.attributes].map(a => [a.name, a.value])),
    bodyClass: document.body.className,
    shell: document.getElementById('shell').outerHTML,
    icons: A.ICONS
  }));
  await sharp(await page.screenshot()).webp({ quality: 82 }).toFile(join(P3, 'shots', '00-live-feasts-' + (name === 'desktop' ? 'd' : 'm') + '.webp'));
  await ctx.close();
}
await browser.close();
server.close();
writeFileSync(join(P3, 'admin-shell.json'), JSON.stringify(out, null, 1));
console.log('captured', Object.keys(out).join(' '), out.desktop.shell.length, out.phone.shell.length);
