// W1: captures the LIVE admin shell (rail, top bar, dock) from the real /admin/ booted against the test fakes
// (tests/fakes/gas.mjs + tools/lib/admin-server.mjs, the same world the admin e2e tests use; generic test accounts,
// nothing leaves the machine). The W1 admin prototype puts its screens inside this captured shell, styled by the
// real admin/admin.css, so the build (W4) is a transfer, not a rewrite.
// Usage: node docs/daily-bread/w1/tools/capture-admin.mjs  → docs/daily-bread/w1/admin-shell.json
import { existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', '..');
const { createSiteServer, interceptGoogle, TEST_API, TEST_CLIENT, TEST_FALLBACK } = await import('file:///' + join(ROOT, 'tools/lib/admin-server.mjs').replace(/\\/g, '/'));
const { createWorld } = await import('file:///' + join(ROOT, 'tests/fakes/gas.mjs').replace(/\\/g, '/'));
const MOD = [join(ROOT, 'tools'), 'D:/private_projects/athanasios-links/tools'].find(d => existsSync(join(d, 'node_modules', 'puppeteer-core')));
const puppeteer = createRequire(join(MOD, 'package.json'))('puppeteer-core');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);

const ADMIN = 'owner@example.test';
const world = createWorld({ owner: ADMIN, adminEmails: ADMIN, executeAs: 'USER_DEPLOYING' });
world.properties.set('ADMIN_EMAILS', ADMIN);
world.properties.set('ADMIN_PRIMARY', ADMIN);
world.as(ADMIN).gs.setup();
world.properties.set('GITHUB_TOKEN', 'test-token');
world.properties.set('GITHUB_REPO', 'example/example.github.io');
world.properties.set('SITE_URL', 'https://example.test/');
world.properties.set('ADMIN_CLIENT_ID', TEST_CLIENT);
world.properties.set('ADMIN_EMAILS', ADMIN);
world.properties.set('ADMIN_NAMES', JSON.stringify({ [ADMIN]: 'مينا' }));
world.gs.SESSION_STALE_SECONDS = 0;
world.as('');

const PORT = 4612;
const server = createSiteServer({
  world: { issueToken: c => world.issueToken(c), get github() { return world.github; } },
  config: () => ({ apiUrl: TEST_API, clientId: TEST_CLIENT, fallbackUrl: TEST_FALLBACK, timing: { gisSlow: 700, gisFail: 2500, button: 3000, silent: 1500, slow: 900, fail: 4000, render: 8000, beat: 900, beatFail: 2500 } }),
  claims: () => ({ email: ADMIN })
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const out = {};
for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  await interceptGoogle(page, { post: body => world.post(body) });
  await page.goto(`http://127.0.0.1:${PORT}/admin/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.gis-stub');
  await page.click('.gis-stub');
  await page.waitForFunction(() => window.A && A.state && !document.getElementById('shell').hidden, { timeout: 20000 });
  await new Promise(r => setTimeout(r, 2500));
  out[name] = await page.evaluate(() => ({
    html: document.documentElement.outerHTML.length,
    htmlAttrs: Object.fromEntries([...document.documentElement.attributes].map(a => [a.name, a.value])),
    bodyClass: document.body.className,
    shell: document.getElementById('shell').outerHTML
  }));
  await page.screenshot({ path: join(HERE, '..', 'captured-admin-' + name + '.png') });
  if (name === 'desktop') {
    out.views = {};
    for (const area of ['settings', 'content', 'pages', 'activity', 'comps']) {
      await page.evaluate(a => document.querySelector('.rail [data-area="' + a + '"]').click(), area);
      await new Promise(r => setTimeout(r, 1800));
      out.views[area] = await page.evaluate(() => ({ tabs: document.getElementById('subtabs').outerHTML, view: document.getElementById('view').outerHTML, title: document.getElementById('page-title').textContent }));
      await page.screenshot({ path: join(HERE, '..', 'captured-admin-' + area + '.png') });
    }
    await page.evaluate(() => document.getElementById('bell-open').click());
    await new Promise(r => setTimeout(r, 900));
    out.bell = await page.evaluate(() => { const m = document.querySelector('[role=menu], .menu, .bellmenu'); return m ? m.outerHTML : document.body.lastElementChild.outerHTML; });
    await page.screenshot({ path: join(HERE, '..', 'captured-admin-bell.png') });
  }
  await ctx.close();
}
await browser.close();
server.close();
writeFileSync(join(HERE, '..', 'admin-shell.json'), JSON.stringify(out, null, 1));
console.log('captured', Object.keys(out).join(' '));
