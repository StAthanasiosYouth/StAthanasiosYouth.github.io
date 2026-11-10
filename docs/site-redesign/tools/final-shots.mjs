// S2 final: full-page + first-screen shots of final.html (the live code + the redesign layer), guest and member, phone and desktop.
//   node docs/site-redesign/tools/final-shots.mjs     (static server on :4330)
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire('D:/private_projects/athanasios-links/.claude/worktrees/admin-panel-redesign-1907bc/tools/package.json');
const puppeteer = require('puppeteer-core');
const OUT = 'D:/private_projects/athanasios-links/.claude/worktrees/admin-panel-redesign-1907bc/docs/site-redesign/shots';
const V = { phone: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, desktop: { width: 1440, height: 900, deviceScaleFactor: 1 } };
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
for (const [w, vp] of Object.entries(V)) {
  mkdirSync(`${OUT}/${w}`, { recursive: true });
  for (const v of ['guest', 'member']) {
    const p = await b.newPage(); await p.setViewport(vp);
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(`http://127.0.0.1:4330/index.html?s2=1&still=1&v=${v}`, { waitUntil: 'networkidle0' });
    await p.waitForFunction(() => document.documentElement.classList.contains('s2-ready'), { timeout: 20000 });
    await p.evaluate(async () => { await document.fonts.ready; for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight * .5) { scrollTo(0, y); await new Promise(r => setTimeout(r, 300)); } scrollTo(0, 0); await new Promise(r => setTimeout(r, 900)); });
    await p.screenshot({ path: `${OUT}/${w}/final-${v}-top.png` });
    await p.screenshot({ path: `${OUT}/${w}/final-${v}.png`, fullPage: true });
    const ov = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    console.log(w, v, 'errors', errs.length, errs.slice(0, 3).join(' | '), 'overflowX', ov);
    await p.close();
  }
}
await b.close();
