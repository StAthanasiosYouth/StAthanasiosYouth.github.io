// Screenshots of every scene (and the contact cards) for review.
// Usage: cd tools && node demo.mjs && node review-xp.mjs [port] [--views=phone,desktop] [keys…]
// Writes tools/.cache/review/*.png. Dev-only.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { ROOT } from './lib/gs.mjs';
import { PLATFORMS } from '../assets/js/platforms.js';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');

const args = process.argv.slice(2);
const PORT = Number(args.find(a => /^\d+$/.test(a))) || 4830;
const views = ((args.find(a => a.startsWith('--views=')) || '--views=phone,desktop').split('=')[1]).split(',');
const ONLY = args.filter(a => !/^\d+$/.test(a) && !a.startsWith('--'));
const OUT = `${ROOT}tools/.cache/review/`;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
mkdirSync(OUT, { recursive: true });

const content = JSON.parse(readFileSync(`${ROOT}tools/.cache/demo/content.json`, 'utf8'));
for (const key of Object.keys(PLATFORMS)) {
  if ([...content.featured, ...content.sections.flatMap(s => s.links)].some(l => l.experience === key)) continue;
  content.sections[0].links.push({ id: `r-${key}`, title: PLATFORMS[key].label, subtitle: '', url: `https://example.org/${key}`, icon: 'star', style: 'card', badge: '', startAt: '', endAt: '', experience: key });
}
const body = JSON.stringify(content);
const links = [...content.featured, ...content.sections.flatMap(s => s.links)].filter(l => l.experience);

const server = spawn(process.execPath, [`${ROOT}tools/serve.mjs`, String(PORT), '--demo'], { stdio: 'pipe' });
await new Promise(resolve => server.stdout.once('data', resolve));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });

const VIEWS = {
  phone: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  small: { width: 320, height: 640, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  desktop: { width: 1366, height: 860, deviceScaleFactor: 1 },
  wide: { width: 1920, height: 1080, deviceScaleFactor: 1 }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

for (const name of views) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.on('pageerror', e => console.log('ERROR', name, e.message));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('console', name, m.text()); });
  await page.setRequestInterception(true);
  page.on('request', r => (r.url().includes('content.json') ? r.respond({ status: 200, contentType: 'application/json', body }) : r.continue()));
  await page.setViewport(VIEWS[name]);
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#main[data-state="ready"]');

  if (!ONLY.length || ONLY.includes('cards')) {
    await page.evaluate(() => document.querySelector('.person-card.contact').scrollIntoView({ block: 'center' }));
    await sleep(700);
    await page.evaluate(() => document.querySelector('.person-card.support').scrollIntoView({ block: 'center' }));
    await sleep(3200);
    await page.screenshot({ path: `${OUT}cards-${name}.png` });
    await page.evaluate(() => window.scrollTo(0, 0));
  }

  const seen = new Set();
  for (const link of links) {
    if (seen.has(link.experience) || (ONLY.length && !ONLY.includes(link.experience))) continue;
    seen.add(link.experience);
    await page.evaluate(id => { location.hash = `#follow/${id}`; }, link.id);
    try {
      await page.waitForSelector('dialog.sheet--xp[open] .xp-stage', { timeout: 6000 });
    }
    catch {
      console.log('no scene for', link.experience);
      continue;
    }
    await sleep(1000);
    await page.screenshot({ path: `${OUT}${link.experience}-${name}-1s.png` });
    await sleep(7000);
    await page.screenshot({ path: `${OUT}${link.experience}-${name}-8s.png` });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog.sheet'));
  }
  await context.close();
}

await browser.close();
server.kill();
console.log('done');
