// S3: the site in every colour (final.html + tint.js), member view, phone and desktop, plus the «لون الموقع» sheet.
//   node docs/site-redesign/tools/tint-shots.mjs     (static server on :4330)
// Output: shots/<phone|desktop>/tint-<id>.png (first screen), tint-<id>-full.png (phone, whole page), tint-picker[-<id>].png
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire('D:/private_projects/athanasios-links/.claude/worktrees/admin-panel-redesign-1907bc/tools/package.json');
const puppeteer = require('puppeteer-core');
const OUT = 'D:/private_projects/athanasios-links/.claude/worktrees/admin-panel-redesign-1907bc/docs/site-redesign/shots';
const IDS = ['gold', 'sea', 'emerald', 'rose', 'ember', 'violet', 'silver'];
const V = { phone: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, desktop: { width: 1440, height: 900, deviceScaleFactor: 1 } };
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
async function load(p, q) {
  await p.goto('http://127.0.0.1:4330/index.html?s2=1&still=1&v=member' + q, { waitUntil: 'networkidle0' });
  await p.waitForFunction(() => document.documentElement.classList.contains('s2-ready') && !document.documentElement.classList.contains('tint-pending'), { timeout: 20000 });
  await p.evaluate(async () => { await document.fonts.ready; for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight * .5) { scrollTo(0, y); await new Promise(r => setTimeout(r, 250)); } scrollTo(0, 0); const h = document.querySelector('.bell-hint'); if (h) h.style.display = 'none'; await new Promise(r => setTimeout(r, 1200)); });
}
const log = [];
for (const [w, vp] of Object.entries(V)) {
  mkdirSync(`${OUT}/${w}`, { recursive: true });
  const p = await b.newPage(); await p.setViewport(vp);
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.evaluateOnNewDocument(() => { try { localStorage.removeItem('s2.site-tint'); } catch (e) {} });
  for (const id of IDS) {
    await load(p, '&tint=' + id);
    await p.screenshot({ path: `${OUT}/${w}/tint-${id}.png` });
    if (w === 'phone' && (id === 'gold' || id === 'sea' || id === 'rose')) await p.screenshot({ path: `${OUT}/${w}/tint-${id}-full.png`, fullPage: true });
  }
  for (const id of ['gold', 'sea', 'violet']) {
    await load(p, '&tint=' + id + '&picker=1');
    await new Promise(r => setTimeout(r, 700));
    await p.screenshot({ path: `${OUT}/${w}/tint-picker${id === 'gold' ? '' : '-' + id}.png` });
  }
  log.push(w + ' errors ' + errs.length + ' ' + errs.slice(0, 3).join(' | '));
  await p.close();
}
await b.close();
console.log(log.join('\n'));
