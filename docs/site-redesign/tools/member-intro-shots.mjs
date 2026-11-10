// S1b: the member intro frames (phone + desktop), from home.html?intro=1&v=member&freeze=<ms>
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire('D:/private_projects/athanasios-links/.claude/worktrees/admin-panel-redesign-1907bc/tools/package.json');
const puppeteer = require('puppeteer-core');
const OUT = 'D:/private_projects/athanasios-links/.claude/worktrees/admin-panel-redesign-1907bc/docs/site-redesign/shots';
const T = [250, 650, 900, 1150, 1500, 1750, 2150];
const V = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } };
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
for (const [w, vp] of Object.entries(V)) {
  mkdirSync(`${OUT}/${w}`, { recursive: true });
  const p = await b.newPage(); await p.setViewport(vp);
  for (const t of T) {
    await p.goto(`http://127.0.0.1:4330/docs/site-redesign/home.html?still=1&v=member&intro=1&freeze=${t}`, { waitUntil: 'networkidle0' });
    await p.evaluate(() => document.fonts.ready); await new Promise(r => setTimeout(r, 200));
    await p.screenshot({ path: `${OUT}/${w}/member-intro-${t}.png` });
  }
  await p.close();
}
await b.close(); console.log('ok');
