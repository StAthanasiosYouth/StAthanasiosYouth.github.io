// S7: the account (signed out and signed in, every section) and «نقاطي» + store, LIVE code + the local API stand-in, today and redesigned.
//   node docs/site-redesign/tools/acct-shots.mjs [now|new|both]   (static :4330 + tools/book-mock.mjs :4331)
// Output: shots/changes/<phone|desktop>/<now|new>-acct-<view>.png
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire('D:/private_projects/athanasios-links/.claude/worktrees/admin-panel-redesign-1907bc/tools/package.json');
const puppeteer = require('puppeteer-core');
const OUT = 'D:/private_projects/athanasios-links/.claude/worktrees/admin-panel-redesign-1907bc/docs/site-redesign/shots/changes';
const WHICH = process.argv[2] || 'both';
const V = { phone: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, desktop: { width: 1440, height: 900, deviceScaleFactor: 1 } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const API = 'api=http://127.0.0.1:4331';
const VIEWS = [['home', '#me'], ['points', '#me/points'], ['bookings', '#me/bookings'], ['results', '#me/results'], ['orders', '#me/orders'], ['profile', '#me/profile']];
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const log = [];
for (const [w, vp] of Object.entries(V)) {
  mkdirSync(`${OUT}/${w}`, { recursive: true });
  for (const mode of (WHICH === 'both' ? ['now', 'new'] : [WHICH])) {
    const q = `?${API}${mode === 'new' ? '&s7=1' : ''}`;
    const shot = async (p, name) => { await p.evaluate(async () => { await document.fonts.ready; for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight * .5) { scrollTo(0, y); await new Promise(r => setTimeout(r, 150)); } scrollTo(0, 0); }); await wait(900); await p.screenshot({ path: `${OUT}/${w}/${mode}-acct-${name}.png`, fullPage: true }); };
    // signed out
    { const ctx = await b.createBrowserContext(); const p = await ctx.newPage(); await p.setViewport(vp);
      await p.goto(`http://127.0.0.1:4330/account/${q}`, { waitUntil: 'networkidle0' }); await wait(1800); await shot(p, 'signin'); await ctx.close(); }
    // signed in: a session in storage, then each section
    const ctx = await b.createBrowserContext(); const p = await ctx.newPage(); await p.setViewport(vp);
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.evaluateOnNewDocument(() => { try { localStorage.setItem('athanasios.account.v1', JSON.stringify({ token: 'as1.sampletokensampletoken', email: 'example@example.com', firstName: 'مينا', at: Date.now() })); } catch (e) {} });
    for (const [name, hash] of VIEWS) {
      await p.goto(`http://127.0.0.1:4330/account/${q}${hash}`, { waitUntil: 'networkidle0' }); await wait(2600); await shot(p, name);
    }
    await p.goto(`http://127.0.0.1:4330/points/${q}`, { waitUntil: 'networkidle0' }); await wait(2600); await shot(p, 'store');
    log.push(`${w} ${mode} errors ${errs.length} ${errs.slice(0, 3).join(' | ')}`);
    await ctx.close();
  }
}
await b.close();
console.log(log.join('\n'));
// the colour sheet from the account (new only)
if (WHICH !== 'now') {
  const b2 = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  for (const [w, vp] of Object.entries(V)) {
    const p = await b2.newPage(); await p.setViewport(vp);
    await p.evaluateOnNewDocument(() => { try { localStorage.setItem('athanasios.account.v1', JSON.stringify({ token: 'as1.sampletokensampletoken', email: 'example@example.com', firstName: 'مينا', at: Date.now() })); localStorage.removeItem('s2.site-tint'); } catch (e) {} });
    await p.goto(`http://127.0.0.1:4330/account/?${API}&s7=1#me`, { waitUntil: 'networkidle0' }); await wait(2500);
    await p.evaluate(() => { const r = document.querySelector('[data-s7-tint]'); if (r) r.click(); }); await wait(800);
    await p.evaluate(() => { const o = document.querySelector('.tint-opt[data-id="emerald"]'); if (o) o.click(); }); await wait(1200);
    await p.screenshot({ path: `${OUT}/${w}/new-acct-tint.png` }); await p.close();
  }
  await b2.close();
}
