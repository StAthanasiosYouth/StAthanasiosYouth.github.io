// One pass over «خبزنا اليومي»'s member page (W5) and the home page with its card, at the six sizes: sideways overflow,
// script / CSP errors, broken pictures, tap targets under 30 px, and axe (WCAG 2.x A/AA). The pages run against the
// REAL Worker code on SQLite with W1's sample program (tests/bread-world.mjs). Same checks as the site redesign's audit.
//   node --experimental-sqlite --no-warnings tools/audit.mjs
// One line per page and size, then a summary; exit code 1 when something fails.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { ROOT } from './lib/gs.mjs';
import { startWorld, seedFor, prime, CHROME } from '../tests/bread-world.mjs';
import { cairoDay, dayAdd } from '../worker/src/bread/model.js';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const SIZES = [['360', 360, 780, true], ['375', 375, 812, true], ['390', 390, 844, true], ['768', 768, 1024, true], ['1024', 1024, 768, false], ['1440', 1440, 900, false]];

const w = await startWorld({ sitePort: 4768, apiPort: 4769 });
const p = await w.program({ dayNo: 5 });
const seed = seedFor(p.id, 30, 4, 0);
const eligible = await w.member();
const guest = await w.member({ guest: true });
await w.h.call('/v1/bread/reflection', { method: 'POST', body: { seed, text: 'تأمل للفحص' }, headers: { authorization: 'Bearer ' + guest.token } });
const joined = { ['bread.joined.' + p.id]: dayAdd(cairoDay(), -4) };

const PAGES = [
  ['today, no account', '/daily-bread/?intro=0', {}],
  ['today, eligible', '/daily-bread/?intro=0#reflect', { member: eligible }],
  ['today, guest + sent', '/daily-bread/?intro=0#reflect', { member: guest }],
  ['today, dawn look', '/daily-bread/?intro=0', { member: eligible, look: 'dawn' }],
  ['today, share sheet', '/daily-bread/?intro=0', { click: '[data-act="share"]' }],
  ['today, sign-in sheet', '/daily-bread/?intro=0', { click: '[data-act="signin"]' }],
  ['«إعداداتي»', '/daily-bread/?s=reminders&intro=0', { member: eligible }],
  ['late joiner', '/daily-bread/?intro=0', { late: true }],
  ['finished', '/daily-bread/?intro=0', { over: true }],
  ['closed (module off)', '/daily-bread/?intro=0', { closed: true }],
  ['home + card', '/index.html', { home: true }]
];

let bad = 0;
for (const [name, path, o] of PAGES) {
  // a fresh browser per page: one Chrome through 66 contexts with service workers runs out of breath
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true });
  if (o.late) await w.startOn(p.id, dayAdd(cairoDay(), -11));
  else if (o.over) await w.startOn(p.id, dayAdd(cairoDay(), -30));
  else await w.startOn(p.id, dayAdd(cairoDay(), -4));
  await w.setting('BREAD_MODULE', o.closed ? '0' : '1');
  for (const [sz, width, height, mobile] of SIZES) {
    const ctx = await b.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile });
    await page.setRequestInterception(true);
    page.on('request', r => (r.url().startsWith('https://athanasios-api.menazak-lab.workers.dev') ? r.abort() : r.continue()));
    if (o.home) await page.evaluateOnNewDocument(() => { try { sessionStorage.setItem('athanasios:intro', '1'); } catch { /* fine */ } });
    await prime(page, w.API, { seed: o.late ? seedFor(p.id, 30, 11, 2) : seed, member: o.member, look: o.look, extra: { ...(o.late ? {} : joined), ...(o.over ? { 'bread.last': JSON.stringify({ id: p.id, name: 'سلسلة «خبز الحياة»', days: 30, endsOn: dayAdd(cairoDay(), -1) }) } : {}) } });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message.slice(0, 90)));
    page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource|ERR_FAILED/.test(m.text())) errs.push(m.text().slice(0, 90)); });
    try {
      await page.goto(w.LOCAL + path, { waitUntil: 'networkidle0', timeout: 30000 });
      await page.waitForSelector(o.home ? '.br-home' : '.br-dawn, .br-rest, .br-h1', { timeout: 15000 });
      await new Promise(r => setTimeout(r, 1500));
      if (o.click) { await page.click(o.click); await new Promise(r => setTimeout(r, 1500)); }
      const r = await page.evaluate(async () => {
        for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight * .7) { scrollTo(0, y); await new Promise(r => setTimeout(r, 40)); }
        scrollTo(0, 0); await new Promise(r => setTimeout(r, 200));
        const over = document.documentElement.scrollWidth - innerWidth;
        const broken = [...document.images].filter(i => i.complete && i.src && !i.naturalWidth && getComputedStyle(i).display !== 'none').map(i => i.src.split('/').slice(-2).join('/'));
        const small = [...document.querySelectorAll('a[href], button, [role="button"], [role="switch"], [role="radio"]')].filter(n => {
          const b = n.getBoundingClientRect(); const cs = getComputedStyle(n);
          return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && (b.height < 30 || b.width < 30) && !n.closest('.visually-hidden, .skip-link, p, li');
        }).map(n => (n.getAttribute('aria-label') || n.textContent).trim().slice(0, 20));
        return { over, broken: [...new Set(broken)].slice(0, 3), small };
      });
      await page.evaluate(AXE);  // through the DevTools protocol: the page's CSP stays on
      const axe = await page.evaluate(async () => {
        const res = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
        return res.violations.map(v => `${v.id}(${v.nodes.length})`);
      });
      const fail = r.over > 1 || errs.length || r.broken.length || r.small.length || axe.length;
      if (fail) bad++;
      console.log(`${fail ? 'FAIL' : 'ok  '} ${name.padEnd(22)} ${sz.padEnd(5)} overflow ${r.over}  small-taps ${r.small.length}${r.small.length ? ' (' + r.small.join(', ') + ')' : ''}${r.broken.length ? '  broken ' + r.broken.join(', ') : ''}${axe.length ? '  axe ' + axe.join(' ') : '  axe 0'}${errs.length ? '  errors ' + errs.slice(0, 2).join(' | ') : ''}`);
    }
    catch (e) { bad++; console.log(`FAIL ${name.padEnd(22)} ${sz.padEnd(5)} ${e.message.slice(0, 100)}`); }
    await ctx.close();
  }
  await b.close();
}
await w.setting('BREAD_MODULE', '1');
await w.close();
console.log(bad ? `\n${bad} checks failed` : '\nall checks passed');
process.exit(bad ? 1 : 0);
