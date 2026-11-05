// S0: screenshots of the LIVE public site (read-only GETs, no sign-in) at 1440 and 390.
//   node docs/site-redesign/tools/current.mjs <outDir> [paths,comma,separated]
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire('D:/private_projects/athanasios-links/.claude/worktrees/admin-panel-redesign-1907bc/tools/package.json');
const puppeteer = require('puppeteer-core');
const OUT = process.argv[2];
const SITE = 'https://stathanasiosyouth.github.io';
const PAGES = (process.argv[3] || '/,/events/,/events/tgrba/,/competition/,/competition/msabqa-nqat/,/competition/test/,/black-theatre/,/silenttheatre/,/pages/,/account/,/points/,/privacy/,/terms/,/your-voice-matters/,/no-such-page/').split(',');
const V = { desktop: { width: 1440, height: 900, deviceScaleFactor: 1 }, phone: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1.5 } };
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const report = [];
for (const [w, vp] of Object.entries(V)) {
  mkdirSync(`${OUT}/${w}`, { recursive: true });
  const p = await b.newPage(); await p.setViewport(vp);
  const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 120)));
  for (const path of PAGES) {
    const name = path.replace(/^\/|\/$/g, '').replace(/\//g, '-') || 'home';
    try {
      const res = await p.goto(SITE + path, { waitUntil: 'networkidle2', timeout: 45000 });
      await new Promise(r => setTimeout(r, 6500)); // intros / entry animations finish
      // walk down so scroll-revealed sections render, then back up
      await p.evaluate(async () => { const H = () => document.documentElement.scrollHeight; for (let y = 0; y < H(); y += innerHeight * 0.6) { scrollTo(0, y); await new Promise(r => setTimeout(r, 350)); } scrollTo(0, 0); await new Promise(r => setTimeout(r, 600)); });
      const info = await p.evaluate(() => ({ title: document.title, h: document.documentElement.scrollHeight, buttons: [...document.querySelectorAll('button, a[href]')].filter(n => n.offsetParent).length }));
      await p.screenshot({ path: `${OUT}/${w}/${name}.png`, fullPage: true, captureBeyondViewport: true });
      report.push({ w, path, name, status: res && res.status(), ...info });
    } catch (e) { report.push({ w, path, name, error: e.message.slice(0, 120) }); }
  }
  report.push({ w, errors: errs.slice(0, 8) });
  await p.close();
}
await b.close();
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
console.log(report.map(r => [r.w, r.name, r.status, r.h, r.buttons, r.error || ''].join(' ')).join('\n'));
