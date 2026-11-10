// S9: one pass over every redesigned page at 4 sizes: sideways overflow, script errors, broken pictures, too-small tap targets.
//   node docs/site-redesign/tools/audit.mjs     (static :4330 + tools/book-mock.mjs :4331)
// Prints one line per page and size, and a summary; exit code 1 when something fails.
import { createRequire } from 'node:module';
const require = createRequire('D:/private_projects/athanasios-links/.claude/worktrees/admin-panel-redesign-1907bc/tools/package.json');
const puppeteer = require('puppeteer-core');
const B = 'http://127.0.0.1:4330';
const API = 'api=http://127.0.0.1:4331';
const PAGES = [
  ['intro (first visit)', '/docs/site-redesign/intro.html?v=first&freeze=6900'],
  ['home guest', '/index.html?s2=1&still=1&v=guest'],
  ['home member', '/index.html?s2=1&still=1&v=member'],
  ['home member intro end', '/index.html?s2=1&still=1&v=member&intro=1&freeze=2400'],
  ['home rose + colour sheet', '/index.html?s2=1&still=1&v=member&tint=rose&picker=1'],
  ['competitions list', '/docs/site-redesign/comp-list.html'],
  ['competition', '/docs/site-redesign/comp-final.html?still=1&state=open'],
  ['black-theatre', '/black-theatre/index.html?s5=1&team=1'],
  ['silenttheatre', '/silenttheatre/index.html?s5=1'],
  ['event + booking', `/events/s6-sample/?${API}&s6=1`],
  ['account', `/account/?${API}&s7=1#me`],
  ['store', `/points/?${API}&s7=1`],
  ['privacy', '/privacy/?s8=1'],
  ['terms', '/terms/?s8=1'],
  ['404', '/old/link/that-moved?s8=1']
];
const SIZES = [['SE', { width: 375, height: 667, isMobile: true, hasTouch: true }], ['phone', { width: 390, height: 844, isMobile: true, hasTouch: true }], ['tablet', { width: 768, height: 1024, isMobile: true, hasTouch: true }], ['desktop', { width: 1440, height: 900 }]];
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
let bad = 0;
for (const [name, path] of PAGES) {
  for (const [sz, vp] of SIZES) {
    const ctx = await b.createBrowserContext(); const p = await ctx.newPage(); await p.setViewport(vp);
    await p.evaluateOnNewDocument(() => { try { localStorage.setItem('athanasios.account.v1', JSON.stringify({ token: 'as1.sampletokensampletoken', email: 'example@example.com', firstName: 'مينا', at: Date.now() })); } catch (e) {} });
    const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 90)));
    p.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errs.push(m.text().slice(0, 90)); });
    try {
      await p.goto(B + path, { waitUntil: 'networkidle0', timeout: 30000 }); await new Promise(r => setTimeout(r, 2200));
      const r = await p.evaluate(async () => {
        for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight * .7) { scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); }
        scrollTo(0, 0); await new Promise(r => setTimeout(r, 300));
        const over = document.documentElement.scrollWidth - innerWidth;
        const broken = [...document.images].filter(i => i.complete && i.src && !i.naturalWidth && getComputedStyle(i).display !== 'none').map(i => i.src.split('/').slice(-2).join('/'));
        const small = [...document.querySelectorAll('a[href], button')].filter(n => { const b = n.getBoundingClientRect(); const cs = getComputedStyle(n); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && (b.height < 30 || b.width < 30) && n.innerText.trim().length < 3 && !n.closest('.visually-hidden, .skip-link'); }).length;
        return { over, broken: [...new Set(broken)].slice(0, 3), small };
      });
      const fail = r.over > 1 || errs.length || r.broken.length;
      if (fail) bad++;
      console.log(`${fail ? 'FAIL' : 'ok  '} ${name.padEnd(26)} ${sz.padEnd(8)} overflow ${r.over}  small-taps ${r.small}${r.broken.length ? '  broken ' + r.broken.join(', ') : ''}${errs.length ? '  errors ' + errs.slice(0, 2).join(' | ') : ''}`);
    } catch (e) { bad++; console.log(`FAIL ${name.padEnd(26)} ${sz.padEnd(8)} ${e.message.slice(0, 80)}`); }
    await ctx.close();
  }
}
await b.close();
console.log(bad ? `\n${bad} checks failed` : '\nall checks passed');
process.exitCode = bad ? 1 : 0;
