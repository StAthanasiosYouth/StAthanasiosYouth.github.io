// CHANGES.html: the same part of the page, cropped from the LIVE site («دلوقتي», read-only GETs, no sign-in)
// and from the design mockup («الجديد»), on phone (390) and desktop (1440).
//   node docs/site-redesign/tools/changes-shots.mjs            (needs the static server on :4330)
// Output: docs/site-redesign/shots/changes/<phone|desktop>/<now|new>-<key>.png
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire('D:/private_projects/athanasios-links/.claude/worktrees/admin-panel-redesign-1907bc/tools/package.json');
const puppeteer = require('puppeteer-core');
const OUT = 'D:/private_projects/athanasios-links/.claude/worktrees/admin-panel-redesign-1907bc/docs/site-redesign/shots/changes';
const LIVE = 'https://stathanasiosyouth.github.io/';
const MOCK = 'http://127.0.0.1:4330/docs/site-redesign/home.html?still=1&v=';
const V = { phone: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, desktop: { width: 1440, height: 900, deviceScaleFactor: 1 } };
// key: [live selectors (union), mock selectors (union)]. "sel@text" = the first match whose text contains text.
const PARTS = {
  top: [['#topbar', 'header.hero'], ['header.top']],
  featured: [['article.featured'], ['.sugg']],
  join: [[], ['.join']],
  meeting: [['section.meeting'], ['.meet']],
  events: [[], ['section.sec@الفعاليات الجاية']],
  services: [['section.items--services'], ['section.sec@خدماتنا']],
  news: [[], ['section.sec@جديد الأسرة']],
  location: [['section.location'], ['section.sec@مكان الاجتماع']],
  social: [['section.links-section'], ['section.sec@تابعنا']],
  contact: [['section.contact', 'section.support'], ['section.sec@تواصل معانا']],
  share: [['section.share'], ['section.share']],
  footer: [['footer.footer'], ['footer.foot']],
  bar: [['nav.tabbar'], ['nav.dock']]
};
const BARS = { live: ['#topbar', 'nav.tabbar', '.bell-hint'], mock: ['header.top', 'nav.dock'] };

async function rectOf(p, sels) {
  return p.evaluate((sels) => {
    let r = null;
    for (const s of sels) {
      const [q, t] = s.split('@');
      const el = [...document.querySelectorAll(q)].find(n => !t || n.innerText.includes(t));
      if (!el) continue;
      const b = el.getBoundingClientRect(), x = { l: b.left + scrollX, t: b.top + scrollY, r: b.right + scrollX, b: b.bottom + scrollY };
      r = r ? { l: Math.min(r.l, x.l), t: Math.min(r.t, x.t), r: Math.max(r.r, x.r), b: Math.max(r.b, x.b) } : x;
    }
    return r;
  }, sels);
}
async function walk(p) {
  await p.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight * .5) { scrollTo(0, y); await new Promise(r => setTimeout(r, 300)); } scrollTo(0, 0); await new Promise(r => setTimeout(r, 500)); });
}
async function shoot(p, sels, file, bars, which) {
  const r = await rectOf(p, sels); if (!r) return false;
  const isBar = which === 'bar' || which === 'top';
  // fixed bars sit over everything when cropping the page; keep them only for their own crop
  await p.evaluate((hide) => { for (const s of hide) for (const n of document.querySelectorAll(s)) n.style.visibility = 'hidden'; }, isBar ? [] : bars);
  const pad = 12, vw = p.viewport().width;
  if (which === 'bar') {
    // fixed element: crop it where it sits in the viewport
    await p.evaluate(() => scrollTo(0, 0));
    const b = await p.evaluate((s) => { const n = document.querySelector(s); const x = n.getBoundingClientRect(); return { l: x.left, t: x.top, w: x.width, h: x.height }; }, sels[0]);
    await p.screenshot({ path: file, clip: { x: Math.max(0, b.l - pad), y: Math.max(0, b.t - pad), width: Math.min(vw, b.w + pad * 2), height: b.h + pad * 2 } });
  } else {
    await p.screenshot({ path: file, captureBeyondViewport: true, clip: { x: 0, y: Math.max(0, r.t - pad), width: vw, height: (r.b - r.t) + pad * 2 } });
  }
  await p.evaluate((hide) => { for (const s of hide) for (const n of document.querySelectorAll(s)) n.style.visibility = ''; }, bars);
  return true;
}

const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const log = [];
for (const [w, vp] of Object.entries(V)) {
  mkdirSync(`${OUT}/${w}`, { recursive: true });
  // the live intro as it plays today (fresh profile = first visit)
  {
    const ctx = await b.createBrowserContext(); const p = await ctx.newPage(); await p.setViewport(vp);
    p.goto(LIVE, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await p.waitForSelector('body', { timeout: 60000 }); const t0 = Date.now();
    for (const t of [500, 1500, 3000, 5000]) { await new Promise(r => setTimeout(r, Math.max(0, t - (Date.now() - t0)))); await p.screenshot({ path: `${OUT}/${w}/now-intro-${t}.png` }); }
    log.push(w + ' now intro'); await ctx.close();
  }
  // the live site
  const p = await b.newPage(); await p.setViewport(vp);
  await p.goto(LIVE, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 7500)); await walk(p);
  for (const [k, [live]] of Object.entries(PARTS)) if (live.length) log.push(w + ' now ' + k + ' ' + await shoot(p, live, `${OUT}/${w}/now-${k}.png`, BARS.live, k));
  await p.close();
  // the mockup, guest and member
  for (const v of ['guest', 'member']) {
    const m = await b.newPage(); await m.setViewport(vp);
    await m.goto(MOCK + v, { waitUntil: 'networkidle0' }); await m.evaluate(() => document.fonts.ready); await walk(m);
    for (const [k, [, mock]] of Object.entries(PARTS)) {
      if (v === 'member' && !['join', 'top'].includes(k)) continue;
      log.push(w + ' new ' + v + ' ' + k + ' ' + await shoot(m, mock, `${OUT}/${w}/new-${k}${v === 'member' ? '-member' : ''}.png`, BARS.mock, k));
    }
    await m.close();
  }
}
await b.close();
console.log(log.join('\n'));
