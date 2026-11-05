// S1: stage frames of the proposed intro (desktop + phone) from intro.html?freeze=<ms>.
//   node docs/site-redesign/tools/intro-shots.mjs   (needs docs/phase8b/tools/static.mjs on 4330)
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire('D:/private_projects/athanasios-links/.claude/worktrees/admin-panel-redesign-1907bc/tools/package.json');
const puppeteer = require('puppeteer-core');
const OUT = 'D:/private_projects/athanasios-links/.claude/worktrees/admin-panel-redesign-1907bc/docs/site-redesign/shots';
const F = { first: [300, 650, 1150, 1700, 2400, 2850, 3300, 3700, 4300, 4800, 5600, 6600], member: [] };
const V = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } };
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
for (const [w, vp] of Object.entries(V)) {
  mkdirSync(`${OUT}/${w}`, { recursive: true });
  const p = await b.newPage(); await p.setViewport(vp);
  for (const [v, list] of Object.entries(F)) for (const t of list) {
    await p.goto(`http://127.0.0.1:4330/docs/site-redesign/intro.html?v=${v}&freeze=${t}`, { waitUntil: 'networkidle0' });
    await p.evaluate(() => document.fonts.ready); await new Promise(r => setTimeout(r, 250));
    await p.screenshot({ path: `${OUT}/${w}/intro-${v}-${t}.png` });
  }
  await p.close();
}
await b.close(); console.log('ok');
