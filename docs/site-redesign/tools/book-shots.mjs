// S6: every booking step of the LIVE event page + booking engine (sample event, booking API mock), today and redesigned.
//   node docs/site-redesign/tools/book-shots.mjs [now|new|both]   (static server :4330 + tools/book-mock.mjs :4331)
// Output: shots/changes/<phone|desktop>/<now|new>-book-<step>.png
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire('D:/private_projects/athanasios-links/.claude/worktrees/admin-panel-redesign-1907bc/tools/package.json');
const puppeteer = require('puppeteer-core');
const ROOT = 'D:/private_projects/athanasios-links/.claude/worktrees/admin-panel-redesign-1907bc';
const OUT = ROOT + '/docs/site-redesign/shots/changes';
const PROOF = ROOT + '/docs/site-redesign/s6/proof-sample.png';
const WHICH = process.argv[2] || 'both';
const V = { phone: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, desktop: { width: 1440, height: 900, deviceScaleFactor: 1 } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const log = [];
for (const [w, vp] of Object.entries(V)) {
  mkdirSync(`${OUT}/${w}`, { recursive: true });
  for (const mode of (WHICH === 'both' ? ['now', 'new'] : [WHICH])) {
    const ctx = await b.createBrowserContext();
    const p = await ctx.newPage(); await p.setViewport(vp);
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    const url = `http://127.0.0.1:4330/events/s6-sample/?api=http://127.0.0.1:4331${mode === 'new' ? '&s6=1' : ''}`;
    await p.goto(url, { waitUntil: 'networkidle0' }); await wait(2500);
    const settle = async () => { await p.evaluate(async () => { await document.fonts.ready; for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight * .5) { scrollTo(0, y); await new Promise(r => setTimeout(r, 200)); } scrollTo(0, 0); }); await wait(600); };
    const book = async name => { await p.evaluate(() => { const b = document.querySelector('.pbar'); if (b) b.style.visibility = 'hidden'; }); const s = await p.$('#book'); await s.scrollIntoView(); await wait(500); const bb = await s.boundingBox(); await p.screenshot({ path: `${OUT}/${w}/${mode}-book-${name}.png`, captureBeyondViewport: true, clip: { x: 0, y: Math.max(0, bb.y + (await p.evaluate(() => scrollY)) - 16), width: vp.width, height: bb.height + 32 } }); await p.evaluate(() => { const b = document.querySelector('.pbar'); if (b) b.style.visibility = ''; }); };
    const label = t => p.evaluate(t => { const l = [...document.querySelectorAll('#book label')].find(x => x.offsetParent && x.innerText.trim().replace(/\s+/g, ' ') === t); if (l) l.click(); return !!l; }, t);
    const labelHas = t => p.evaluate(t => { const l = [...document.querySelectorAll('#book label')].find(x => x.offsetParent && x.innerText.includes(t)); if (l) l.click(); return !!l; }, t);
    const btn = t => p.evaluate(t => { const x = [...document.querySelectorAll('#book button, #book a.btn')].find(n => n.offsetParent && n.innerText.trim().includes(t)); if (x) x.click(); return !!x; }, t);
    async function typeIn(sel, v, i = 0) { const els = await p.$$(sel); if (els[i]) { await els[i].click({ clickCount: 3 }); await els[i].type(v); } }

    await settle(); await p.screenshot({ path: `${OUT}/${w}/${mode}-book-page.png`, fullPage: true });
    await book('start');
    await btn('احجز الآن'); await wait(800);
    await typeIn('#book input[name=name]', 'مينا زكريا'); await typeIn('#book input[name=phone]', '01012345678');
    await typeIn('#book input[type=text]:not([name])', 'مينا زكريا'); await typeIn('#book input[type=number]', '19');
    await book('a');
    await btn('التالي'); await wait(1000);
    await labelHas('مسؤول الرحلة'); await wait(500); await label('إنستاباي'); await wait(1800);
    await book('b');
    if (!(await btn('تم التحويل'))) await btn('دفعت'); await wait(1200);
    const file = await p.$('#book input[type=file]'); if (file) { await file.uploadFile(PROOF); await wait(2500); }
    await p.evaluate(() => { const c = [...document.querySelectorAll('#book input[type=checkbox]')].find(x => x.offsetParent || x.closest('label')); if (c && !c.checked) c.click(); });
    await wait(400); await book('c'); console.log(w, mode, 'c buttons:', await p.evaluate(() => [...document.querySelectorAll('#book button')].filter(n => n.offsetParent).map(n => n.innerText.trim()).join(' / ')));
    await btn('ابعت'); await btn('أكّد'); await wait(2200);
    await book('done');
    const link = await p.evaluate(() => { const a = [...document.querySelectorAll('#book a')].find(x => /#b\//.test(x.href)); return a ? a.href : ''; });
    if (link) { await p.goto(link, { waitUntil: 'networkidle0' }); await p.reload({ waitUntil: 'networkidle0' }); await wait(2500); await settle(); await book('status'); }
    log.push(`${w} ${mode} errors ${errs.length} ${errs.slice(0, 2).join(' | ')} status-link ${!!link}`);
    await ctx.close();
  }
}
await b.close();
console.log(log.join('\n'));
