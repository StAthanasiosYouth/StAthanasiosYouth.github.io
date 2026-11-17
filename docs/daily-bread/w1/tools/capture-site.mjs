// W1: captures the LIVE public site's own chrome (top bar, phone bottom bar, a widget) from the local site
// (docs/daily-bread/tools/static.mjs on 4340), so the member prototype is a layer on the site's real markup + CSS.
// Usage: node docs/daily-bread/w1/tools/capture-site.mjs → docs/daily-bread/w1/site-shell.json
import { existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', '..');
const MOD = [join(ROOT, 'tools'), 'D:/private_projects/athanasios-links/tools'].find(d => existsSync(join(d, 'node_modules', 'puppeteer-core')));
const puppeteer = createRequire(join(MOD, 'package.json'))('puppeteer-core');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const out = {};
for (const [name, vp] of [['phone', { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }], ['desktop', { width: 1440, height: 900 }]]) {
  const page = await browser.newPage();
  await page.setViewport(vp);
  await page.goto('http://localhost:4340/?nointro=1', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 2500));
  out[name] = await page.evaluate(() => {
    const pick = sel => { const n = document.querySelector(sel); return n ? n.outerHTML : null; };
    const strip = s => s && s.replace(/<svg[\s\S]*?<\/svg>/g, m => m.length > 1600 ? '<svg/>' : m);
    const html = document.documentElement;
    return {
      htmlAttrs: Object.fromEntries([...html.attributes].map(a => [a.name, a.value])),
      bodyClass: document.body.className,
      head: [...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.getAttribute('href')),
      bodyChildren: [...document.body.children].map(c => c.tagName.toLowerCase() + (c.id ? '#' + c.id : '') + (c.className && typeof c.className === 'string' ? '.' + c.className.split(' ').join('.') : '')),
      topbar: strip(pick('header')),
      dock: strip(pick('nav.dock, .dock, nav[class*=bar], .tabbar, .bnav')),
      widgets: [...document.querySelectorAll('main section, main article')].slice(0, 6).map(s => strip(s.outerHTML).slice(0, 4000))
    };
  });
  await page.close();
}
await browser.close();
writeFileSync(join(HERE, '..', 'site-shell.json'), JSON.stringify(out, null, 1));
console.log('captured site', out.phone.bodyChildren.join(' | '));
