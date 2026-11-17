// Screenshots for the study (puppeteer-core from tools/node_modules + local Chrome).
// Usage: node docs/daily-bread/tools/shot.mjs <jobs.json | "url|out.png|w|h[|waitMs][|dpr]" ...>
// Needs docs/daily-bread/tools/static.mjs running on 4340.
import { createRequire } from 'node:module';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
// a worktree has no node_modules of its own: fall back to the main checkout's tools/
const MOD = [join(ROOT, 'tools'), process.env.PUPPETEER_FROM, 'D:/private_projects/athanasios-links/tools']
  .filter(Boolean).find(d => existsSync(join(d, 'node_modules', 'puppeteer-core')));
const require = createRequire(join(MOD, 'package.json'));
const puppeteer = require('puppeteer-core');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);

let jobs = [];
for (const a of process.argv.slice(2)) {
  if (a.endsWith('.json')) jobs.push(...JSON.parse(readFileSync(a, 'utf8')));
  else { const [url, out, w, h, wait, dpr, mobile] = a.split('|'); jobs.push({ url, out, w: +w, h: +h, wait: +(wait || 600), dpr: +(dpr || 1), mobile: mobile === 'm' }); }
}
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
for (const j of jobs) {
  await page.setViewport({ width: j.w, height: j.h, deviceScaleFactor: j.dpr || 1, isMobile: !!j.mobile, hasTouch: !!j.mobile });
  const url = j.url.startsWith('http') ? j.url : 'http://localhost:4340/' + j.url.replace(/^\//, '');
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await new Promise(r => setTimeout(r, j.wait || 600));
  const out = isAbsolute(j.out) ? j.out : join(ROOT, j.out);
  mkdirSync(dirname(out), { recursive: true });
  await page.screenshot({ path: out, fullPage: !!j.full });
  console.log('shot', j.out);
}
await browser.close();
