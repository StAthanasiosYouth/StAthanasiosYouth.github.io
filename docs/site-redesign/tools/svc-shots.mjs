// S5: the service pages today (the live page engine as is) and redesigned (?s5=1 + the S5 layer), phone + desktop, whole page,
// plus the live clip player opened from «اتفرّج على أحدث عرض».
//   node docs/site-redesign/tools/svc-shots.mjs     (static server on :4330)
// Output: shots/changes/<phone|desktop>/<now|new>-svc-<slug>.png, new-svc-player.png
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire('D:/private_projects/athanasios-links/.claude/worktrees/admin-panel-redesign-1907bc/tools/package.json');
const puppeteer = require('puppeteer-core');
const OUT = 'D:/private_projects/athanasios-links/.claude/worktrees/admin-panel-redesign-1907bc/docs/site-redesign/shots/changes';
const V = { phone: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, desktop: { width: 1440, height: 900, deviceScaleFactor: 1 } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const log = [];
for (const [w, vp] of Object.entries(V)) {
  mkdirSync(`${OUT}/${w}`, { recursive: true });
  for (const slug of ['black-theatre', 'silenttheatre']) {
    for (const mode of ['now', 'new']) {
      const p = await b.newPage(); await p.setViewport(vp);
      const errs = []; p.on('pageerror', e => errs.push(e.message));
      // the B.U.G ident plays once a session; a fresh page per shot, then wait it out
      await p.goto(`http://127.0.0.1:4330/${slug}/${mode === 'new' ? 'index.html?s5=1&team=1' : ''}`, { waitUntil: 'networkidle0' });
      await wait(4500);
      await p.evaluate(async () => { await document.fonts.ready; for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight * .5) { scrollTo(0, y); await new Promise(r => setTimeout(r, 250)); } scrollTo(0, 0); await new Promise(r => setTimeout(r, 900)); });
      await p.screenshot({ path: `${OUT}/${w}/${mode}-svc-${slug}.png`, fullPage: true });
      if (mode === 'new' && slug === 'black-theatre') {
        await p.evaluate(() => { const b = document.querySelector('.s5-play'); if (b) b.click(); }); await wait(2500);
        await p.screenshot({ path: `${OUT}/${w}/new-svc-player.png` });
      }
      log.push(`${w} ${slug} ${mode} errors ${errs.length} ${errs.slice(0, 2).join(' | ')}`);
      await p.close();
    }
  }
}
await b.close();
console.log(log.join('\n'));
