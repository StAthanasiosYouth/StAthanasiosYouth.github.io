// S8: privacy, terms, 404, and the home's menus («المزيد», the bell), today and redesigned (?s8=1 on the review server).
//   node docs/site-redesign/tools/rest-shots.mjs [now|new|both]     (static server :4330)
// Output: shots/changes/<phone|desktop>/<now|new>-rest-<name>.png
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire('D:/private_projects/athanasios-links/.claude/worktrees/admin-panel-redesign-1907bc/tools/package.json');
const puppeteer = require('puppeteer-core');
const OUT = 'D:/private_projects/athanasios-links/.claude/worktrees/admin-panel-redesign-1907bc/docs/site-redesign/shots/changes';
const WHICH = process.argv[2] || 'both';
const V = { phone: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, desktop: { width: 1440, height: 900, deviceScaleFactor: 1 } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const log = [];
for (const [w, vp] of Object.entries(V)) {
  mkdirSync(`${OUT}/${w}`, { recursive: true });
  for (const mode of (WHICH === 'both' ? ['now', 'new'] : [WHICH])) {
    const s8 = mode === 'new' ? 's8=1' : '';
    const p = await b.newPage(); await p.setViewport(vp);
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    const full = async name => { await p.evaluate(async () => { await document.fonts.ready; for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight * .5) { scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); } scrollTo(0, 0); }); await wait(700); await p.screenshot({ path: `${OUT}/${w}/${mode}-rest-${name}.png`, fullPage: true }); };
    for (const [name, path] of [['privacy', '/privacy/'], ['terms', '/terms/'], ['404', '/old/link/that-moved'], ['unavail', '/no-such-page-here/']]) {
      await p.goto(`http://127.0.0.1:4330${path}${s8 ? '?' + s8 : ''}`, { waitUntil: 'networkidle0' }); await wait(1500); await full(name);
    }
    // the home menus (phone: the bottom bar's «المزيد»; both: the bell)
    const home = `http://127.0.0.1:4330/index.html?s2=1&still=1&v=member${s8 ? '&' + s8 : ''}`;
    await p.goto(home, { waitUntil: 'networkidle0' }); await wait(2500);
    if (w === 'phone') {
      await p.evaluate(() => { const m = [...document.querySelectorAll('nav.tabbar button, nav.tabbar a')].find(x => /المزيد/.test(x.innerText)); if (m) m.click(); }); await wait(1200);
      await p.screenshot({ path: `${OUT}/${w}/${mode}-rest-more.png` });
      await p.keyboard.press('Escape'); await wait(600);
    }
    await p.evaluate(() => { const bell = document.getElementById('bell'); if (bell) bell.click(); }); await wait(1400);
    await p.screenshot({ path: `${OUT}/${w}/${mode}-rest-bell.png` });
    log.push(`${w} ${mode} errors ${errs.length} ${errs.slice(0, 2).join(' | ')}`);
    await p.close();
  }
}
await b.close();
console.log(log.join('\n'));
