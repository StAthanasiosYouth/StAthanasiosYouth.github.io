import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire('D:/private_projects/athanasios-links/.claude/worktrees/admin-panel-redesign-1907bc/tools/package.json');
const puppeteer = require('puppeteer-core');
const OUT = process.argv[2];
const SCREENS = (process.argv[3] || 'home,intro,editor,publish,publish-changes,publish-history,comp-new,youth,servants,paymethods,bookings,finance,settings,team,team-remove,servant-remove,events,event-menu,event-delete').split(',');
const V = { desktop: { width: 1440, height: 900, deviceScaleFactor: 1 }, phone: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } };
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const errs = [];
for (const [w, vp] of Object.entries(V)) {
  mkdirSync(`${OUT}/${w}`, { recursive: true });
  const p = await b.newPage(); await p.setViewport(vp);
  p.on('pageerror', e => errs.push(w + ' ' + e.message));
  for (const s of SCREENS) {
    const q = s === 'intro' ? 's=intro&freeze=1500' : `s=${s}&still=1`;
    await p.goto(`http://127.0.0.1:4330/docs/phase8b/?${q}`, { waitUntil: 'networkidle0' });
    await p.evaluate(() => document.fonts.ready); await p.evaluate(() => { const f = document.querySelector('[data-focus]'); if (f) f.scrollIntoView({ block: 'start' }); });
    await new Promise(r => setTimeout(r, s === 'intro' ? 300 : 150));
    const modal = await p.$('.scrim');
    await p.screenshot({ path: `${OUT}/${w}/${s}.png`, fullPage: !modal && s !== 'intro' });
  }
  await p.close();
}
await b.close();
console.log('done', SCREENS.length * 2, 'errors', errs.length, errs.slice(0, 5).join(' | '));
