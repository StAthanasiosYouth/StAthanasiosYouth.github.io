// S1: the intro at the sizes the owner tests (phone small/large, tablet both ways, desktop, big desktop), plus a live
// resize check (phone → tablet) — frames written to shots/sizes/<size>/intro-<ms>.png
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire('D:/private_projects/athanasios-links/.claude/worktrees/admin-panel-redesign-1907bc/tools/package.json');
const puppeteer = require('puppeteer-core');
const OUT = 'D:/private_projects/athanasios-links/.claude/worktrees/admin-panel-redesign-1907bc/docs/site-redesign/shots/sizes';
const SIZES = { 'iphone-se': [375, 667, true], 'iphone-16-pro-max': [440, 956, true], 'tablet-portrait': [768, 1024, true], 'tablet-landscape': [1024, 768, true], 'desktop': [1440, 900, false], 'desktop-1080': [1920, 1080, false] };
const TIMES = (process.argv[2] || '1300,2700,3100,6900').split(',').map(Number);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const problems = [];
for (const [name, [w, h, mob]] of Object.entries(SIZES)) {
  mkdirSync(`${OUT}/${name}`, { recursive: true });
  const p = await b.newPage();
  await p.setViewport({ width: w, height: h, isMobile: mob, hasTouch: mob, deviceScaleFactor: mob ? 2 : 1 });
  for (const t of TIMES) {
    await p.goto(`http://127.0.0.1:4330/docs/site-redesign/intro.html?freeze=${t}`, { waitUntil: 'networkidle0' });
    await p.evaluate(() => document.fonts.ready); await new Promise(r => setTimeout(r, 250));
    await p.screenshot({ path: `${OUT}/${name}/intro-${t}.png` });
    if (t >= 6900) {
      const bad = await p.evaluate(() => {
        const out = [], V = { w: innerWidth, h: innerHeight };
        const els = [...document.querySelectorAll('.saint, .logo, .name, .slogan, .cta, .plaque')].filter(n => getComputedStyle(n).display !== 'none');
        els.forEach(n => { const r = n.getBoundingClientRect(); if (r.left < -1 || r.top < -1 || r.right > V.w + 1 || r.bottom > V.h + 1) out.push('off:' + n.className); });
        const R = n => document.querySelector(n).getBoundingClientRect(), hit = (a, c) => !(a.right <= c.left || c.right <= a.left || a.bottom <= c.top || c.bottom <= a.top);
        [['.saint--athanasius', '.logo'], ['.saint--sefein', '.logo'], ['.saint--athanasius', '.name'], ['.saint--sefein', '.name'], ['.saint--athanasius', '.cta'], ['.saint--sefein', '.cta'], ['.welcome', '.cta'], ['.slogan', '.cta']].forEach(([a, c]) => { const ea = document.querySelector(a); if (getComputedStyle(ea).display !== 'none' && hit(R(a), R(c))) out.push('overlap:' + a + '×' + c); });
        return out;
      });
      if (bad.length) problems.push(name + ': ' + bad.join(', '));
    }
  }
  await p.close();
}
// live resize: start as a phone, then become a tablet (the owner's case), end frame
{
  const p = await b.newPage();
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await p.goto('http://127.0.0.1:4330/docs/site-redesign/intro.html?freeze=6900', { waitUntil: 'networkidle0' });
  await p.setViewport({ width: 1024, height: 768, isMobile: false, deviceScaleFactor: 1 });
  await new Promise(r => setTimeout(r, 600));
  mkdirSync(`${OUT}/resize`, { recursive: true });
  await p.screenshot({ path: `${OUT}/resize/phone-to-tablet.png` });
  await p.close();
}
await b.close();
console.log(problems.length ? problems.join('\n') : 'no overflow/overlap at any size');
