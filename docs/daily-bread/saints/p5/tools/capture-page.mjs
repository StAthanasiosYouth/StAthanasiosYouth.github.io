// P5: captures the LIVE member page /daily-bread/ (the real page, the real Worker code on SQLite: tests/bread-world.mjs,
// the world tests/bread-page.e2e.mjs uses; generic test accounts, nothing leaves the machine) in its two states:
//   today = a program live today (W1's sample, day 5)   rest = no reading today (the next program waiting)
// The P5 prototype (../member.html) puts the «مناسبات كنيستنا» card inside this DOM, styled by the real
// assets/css/main.css + bread.css, so the build is a transfer, not a rewrite (the P3 method, p3/tools/capture-admin.mjs).
// Usage: node --experimental-sqlite --no-warnings docs/daily-bread/saints/p5/tools/capture-page.mjs → p5/page-shell.json
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const P5 = join(HERE, '..');
const ROOT = join(HERE, '..', '..', '..', '..', '..');
const imp = p => import(pathToFileURL(join(ROOT, p)).href);
const { startWorld, seedFor, prime, CHROME } = await imp('tests/bread-world.mjs');
const { cairoDay, dayAdd } = await imp('worker/src/bread/model.js');
const req = createRequire(join(ROOT, 'tools', 'package.json'));
const puppeteer = req('puppeteer-core');

const w = await startWorld({ sitePort: 4772, apiPort: 4773 });
const p = await w.program({ dayNo: 5 });
const seed = seedFor(p.id, 30, 4, 0);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--hide-scrollbars'] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = { captured: cairoDay(), sizes: {} };

async function grab(viewport, state) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  await prime(page, w.API, { seed });
  // ?from=signin = the page without its intro (the return after signing in), nothing else changes
  await page.goto(w.LOCAL + '/daily-bread/?from=signin', { waitUntil: 'networkidle0' });
  await page.waitForFunction(s => s === 'today' ? !!document.querySelector('.br-paper') : !!document.querySelector('.br-rest'), { timeout: 20000 }, state);
  await sleep(600);
  const r = await page.evaluate(() => ({
    htmlAttrs: Object.fromEntries([...document.documentElement.attributes].map(a => [a.name, a.value])),
    bodyClass: document.body.className,
    app: document.getElementById('app').innerHTML
  }));
  await ctx.close();
  return r;
}

for (const [name, vp] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
  out.sizes[name] = { today: await grab(vp, 'today') };
}
// the next program waiting: no reading today
await w.startOn(p.id, dayAdd(cairoDay(), 3));
for (const [name, vp] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
  out.sizes[name].rest = await grab(vp, 'rest');
}
await browser.close();
await w.close();
writeFileSync(join(P5, 'page-shell.json'), JSON.stringify(out, null, 1));
console.log('captured', Object.entries(out.sizes).map(([k, v]) => k + ': today ' + v.today.app.length + ', rest ' + v.rest.app.length).join(' · '));
process.exit(0);
