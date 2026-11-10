// S2: the proposed home and «عرض الكل» pages, phone (390) and desktop (1440), full page.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire('D:/private_projects/athanasios-links/.claude/worktrees/admin-panel-redesign-1907bc/tools/package.json');
const puppeteer = require('puppeteer-core');
const OUT = 'D:/private_projects/athanasios-links/.claude/worktrees/admin-panel-redesign-1907bc/docs/site-redesign/shots';
const PAGES = { 'home-guest': 'v=guest', 'home-member': 'v=member', 'all-events': 'page=events', 'all-services': 'page=services', 'all-news': 'page=news' };
const V = { desktop: { width: 1440, height: 900, deviceScaleFactor: 1 }, phone: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } };
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const errs = [];
for (const [w, vp] of Object.entries(V)) {
  mkdirSync(`${OUT}/${w}`, { recursive: true });
  const p = await b.newPage(); await p.setViewport(vp);
  p.on('pageerror', e => errs.push(w + ' ' + e.message));
  for (const [name, q] of Object.entries(PAGES)) {
    await p.goto(`http://127.0.0.1:4330/docs/site-redesign/home.html?still=1&${q}`, { waitUntil: 'networkidle0' });
    await p.evaluate(() => document.fonts.ready); await new Promise(r => setTimeout(r, 200));
    const ov = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (ov > 1) errs.push(`${w} ${name}: page ${ov}px wider than the screen`);
    if (w === 'phone') { await p.screenshot({ path: `${OUT}/${w}/${name}-top.png` }); await p.addStyleTag({ content: '.dock{display:none!important}' }); }
    await p.screenshot({ path: `${OUT}/${w}/${name}.png`, fullPage: true });
  }
  await p.close();
}
await b.close();
console.log(errs.length ? errs.join('\n') : 'ok');
