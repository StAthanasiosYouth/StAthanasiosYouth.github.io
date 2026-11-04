// Phase 8 track P (docs/PHASE8-PLAN.md §1): the public site's navigation, checked in Chrome on every page type.
//   phones: the bottom bar is there, the top account icon is not, every tab's target is right
//   desktop: no bottom bar, the account icon stays in the top bar
//   every top bar: «ارجع للموقع» is the Home icon (44px, named «الرئيسية»)
//   Back: a page opened from the home page returns to it at the same scroll (the Home icon and the browser's Back)
//   cold deep links: an inner page and /index.html#activities open directly
// Run against a served site (locally: node tools/serve.mjs 8080 --404):  node tools/nav-check.mjs [base]   (default http://localhost:8080, e.g. https://stathanasiosyouth.github.io)
import { createRequire } from 'node:module';
import { ROOT } from './lib/gs.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');
const BASE = (process.argv[2] || 'http://localhost:8080').replace(/\/$/, '');
const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESKTOP = { width: 1280, height: 860 };
const PAGES = ['/', '/black-theatre/', '/events/tgrba/', '/competition/test/', '/points/', '/account/', '/no-such-page-x/'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
// the pages' own first-visit intros (home intro.js, the service pages' .cintro) are tapped away, as a person would
// (the service pages' ident and the games intro end by themselves; the check lets them, as a visitor would)
const settle = async page => { await sleep(1200); await page.waitForFunction(() => !document.querySelector('.cintro, .gintro') && document.documentElement.getAttribute('data-intro-state') !== 'playing', { timeout: 9000 }).catch(() => {}); await sleep(600); };
let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  ' + JSON.stringify(detail ?? '').slice(0, 300)));
  if (!ok) failed++;
};
// errors that are about the network from this origin, not the page (a local origin the production Worker refuses)
// (and Cloudflare Turnstile's own hidden console lines on the live account page: "%c%d font-size:0;color:transparent …")
const NOISE = /CORS|Failed to load resource|net::ERR_|ERR_FAILED|Turnstile|challenges\.cloudflare|^%c%[do] font-size:0;color:transparent/;

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
async function open(viewport) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !NOISE.test(m.text())) errors.push(m.text()); });
  await page.setViewport(viewport);
  return { page, errors, close: () => context.close() };
}
const state = page => page.evaluate(() => {
  const visible = n => !!n && getComputedStyle(n).display !== 'none' && n.getBoundingClientRect().width > 0;
  const bar = document.querySelector('.tabbar');
  const home = document.querySelector('.pbar__home, .cbar__home');
  return {
    path: location.pathname,
    tabbar: visible(bar),
    tabs: bar ? [...bar.querySelectorAll('[data-tab]')].map(a => [a.dataset.tab, a.href ? new URL(a.href).pathname + new URL(a.href).hash : '', a.getAttribute('aria-current') || '']) : [],
    topAccount: visible(document.querySelector('.topbar .acct-badge, .pbar .acct-badge, .cbar .acct-badge')),
    hasTopAccount: !!document.querySelector('.topbar .acct-badge, .pbar .acct-badge, .cbar .acct-badge'),
    home: home ? { label: home.getAttribute('aria-label'), w: Math.round(home.getBoundingClientRect().width), text: getComputedStyle(home).fontSize } : null,
    covered: (() => { // nothing of the page's last content sits under the bar once scrolled to the end
      if (!visible(bar)) return false;
      scrollTo(0, document.documentElement.scrollHeight);
      const last = [...document.querySelectorAll('main *, footer *')].filter(n => n.children.length === 0 && n.getBoundingClientRect().height > 0 && n.textContent.trim()).pop();
      return !!last && last.getBoundingClientRect().bottom > bar.getBoundingClientRect().top + 1;
    })()
  };
});

try {
  for (const [vname, viewport] of [['phone', PHONE], ['desktop', DESKTOP]]) {
    for (const path of PAGES) {
      const s = await open(viewport);
      await s.page.goto(BASE + path, { waitUntil: 'networkidle2', timeout: 30000 });
      await settle(s.page);
      const st = await state(s.page);
      const where = `[${vname}] ${path}${st.path !== path ? ' → ' + st.path : ''}`;
      const homePage = ['/', '/index.html'].includes(st.path);
      if (vname === 'phone' && !homePage) {
        // every page but home keeps its own top bar: no bottom bar, the account icon on top (owner, 2026-11-04)
        check(`${where}: no bottom bar (the page's own top bar)`, !st.tabbar, st);
        check(`${where}: the account icon in the top bar`, !st.hasTopAccount || st.topAccount, st);
      }
      else if (vname === 'phone') {
        check(`${where}: the bottom bar is there`, st.tabbar, st);
        const home = ['/', '/index.html'].includes(st.path);
        if (home) check(`${where}: three places near you, the top first («الرئيسية» lit)`, st.tabs.length === 5 && st.tabs[0][0] === 'top' && st.tabs[0][2] === 'location', st.tabs);
        else check(`${where}: الرئيسية · الفعاليات · المسابقات`, st.tabs.slice(0, 3).map(t => t[0]).join() === 'home,events,comps' && st.tabs[0][1] === '/index.html' && st.tabs[1][1] === '/index.html#activities' && st.tabs[2][1] === '/points/', st.tabs);
        check(`${where}: «حسابي» then «المزيد», fixed`, st.tabs.slice(-2).map(t => t[0]).join() === 'account,more' && st.tabs[st.tabs.length - 2][1] === '/account/', st.tabs);
        if (!home) check(`${where}: one tab marked as here`, st.tabs.filter(t => t[2] === 'page').length === 1, st.tabs);
        check(`${where}: no account icon in the top bar`, !st.topAccount, st);
        check(`${where}: the end of the page is not under the bar`, !st.covered, st);
      }
      else {
        check(`${where}: no bottom bar`, !st.tabbar, st);
        check(`${where}: the account icon stays in the top bar`, !st.hasTopAccount || st.topAccount, st);
      }
      if (st.home) check(`${where}: «ارجع للموقع» is the Home icon`, ['الرئيسية', 'ارجع للصفحة اللي كنت فيها'].includes(st.home.label) && st.home.w === 44 && st.home.text === '0px', st.home);
      check(`${where}: no page errors`, s.errors.length === 0, s.errors);
      await s.close();
    }
  }

  // the Home icon from the very first frame (its CSS comes with the page's own stylesheet): never the old words
  for (const path of ['/black-theatre/', '/account/', '/no-such-page-x/']) {
    const s = await open(PHONE);
    let first = null;
    s.page.on('domcontentloaded', async () => { try { first = await s.page.evaluate(() => { const a = document.querySelector('.pbar__home, .cbar__home'); return a ? [getComputedStyle(a).fontSize, getComputedStyle(a).width] : null; }); } catch { /* navigated */ } });
    await s.page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await sleep(150);
    check(`${path}: the Home icon at the first paint (no «ارجع للموقع» text)`, !!first && first[0] === '0px' && first[1] === '44px', first);
    await s.close();
  }

  // the service page's ident: part of the page (under its bar), no «تخطي», once per visit, the page ready after it
  {
    const s = await open(PHONE);
    await s.page.goto(BASE + '/black-theatre/', { waitUntil: 'domcontentloaded' });
    await sleep(700);
    const during = await s.page.evaluate(() => { const c = document.querySelector('.cintro'); const bar = document.querySelector('.pbar'); return c ? { skip: !!document.querySelector('.cintro__skip'), under: Number(getComputedStyle(c).zIndex) < Number(getComputedStyle(bar).zIndex), bars: [...document.querySelectorAll('.cintro__bar')].some(n => getComputedStyle(n).display !== 'none') } : null; });
    check('B.U.G. page: the ident plays inside the page, under its bar, no letterbox, no «تخطي»', !!during && !during.skip && during.under && !during.bars, during);
    await s.page.waitForFunction(() => !document.querySelector('.cintro'), { timeout: 6000 }).catch(() => {});
    const after = await s.page.evaluate(() => ({ gone: !document.querySelector('.cintro'), state: document.querySelector('main.pg')?.dataset.state }));
    check('B.U.G. page: it opens onto the ready page', after.gone && after.state === 'ready', after);
    await s.page.goto(BASE + '/', { waitUntil: 'networkidle2' });
    await s.page.goto(BASE + '/black-theatre/', { waitUntil: 'domcontentloaded' });
    await sleep(500);
    check('B.U.G. page: again each time you come into it', !!(await s.page.$('.cintro')));
    check('B.U.G. page: no page errors', s.errors.length === 0, s.errors);
    await s.close();
  }

  // a competition: the games intro under its bar, then the competition
  {
    const s = await open(PHONE);
    await s.page.goto(BASE + '/competition/test/', { waitUntil: 'domcontentloaded' });
    await sleep(600);
    const g = await s.page.evaluate(() => { const n = document.querySelector('.gintro'); return n ? { top: Math.round(n.getBoundingClientRect().top), bar: Math.round(document.querySelector('.cbar').getBoundingClientRect().bottom), word: n.querySelector('.gintro__word')?.textContent } : null; });
    check('competition: the games intro under the page\'s bar', !!g && Math.abs(g.top - g.bar) <= 1 && g.word === 'جاهز للتحدي؟', g);
    await s.page.waitForFunction(() => !document.querySelector('.gintro'), { timeout: 5000 }).catch(() => {});
    const r = await s.page.evaluate(() => ({ gone: !document.querySelector('.gintro'), state: document.getElementById('comp-main').dataset.state, hidden: document.getElementById('comp-main').classList.contains('gintro-covered') }));
    check('competition: then the competition, nothing left hidden', r.gone && r.state !== 'loading' && !r.hidden, r);
    check('competition: no page errors', s.errors.length === 0, s.errors);
    await s.close();
  }

  // Back from an inner page returns to the home page where it was
  for (const how of ['home-icon', 'browser-back']) {
    const s = await open(PHONE);
    await s.page.goto(BASE + '/', { waitUntil: 'networkidle2' });
    await settle(s.page);
    await s.page.evaluate(() => scrollTo(0, 900));
    await sleep(400);
    const y0 = await s.page.evaluate(() => Math.round(scrollY));
    await Promise.all([s.page.waitForNavigation({ waitUntil: 'networkidle2' }), s.page.evaluate(base => { location.href = base + '/black-theatre/'; }, BASE)]);
    await settle(s.page);
    if (how === 'browser-back') await Promise.all([s.page.waitForNavigation({ waitUntil: 'load' }).catch(() => {}), s.page.goBack()]);
    else await Promise.all([s.page.waitForNavigation({ waitUntil: 'load' }).catch(() => {}), s.page.click('.pbar__home')]);
    await sleep(2500);
    const back = await s.page.evaluate(() => ({ path: location.pathname, y: Math.round(scrollY), len: history.length }));
    check(`back via ${how}: the home page`, ['/', '/index.html'].includes(back.path), back);
    check(`back via ${how}: at the same place (${y0}px)`, Math.abs(back.y - y0) < 80, back);
    await s.close();
  }

  // a page opened cold (a shared link): the Home icon opens the home page, it does not leave the site
  {
    const s = await open(PHONE);
    await s.page.goto(BASE + '/black-theatre/', { waitUntil: 'networkidle2' });
    await settle(s.page);
    await Promise.all([s.page.waitForNavigation({ waitUntil: 'load' }), s.page.click('.pbar__home')]);
    check('cold page: the Home icon opens the home page', ['/', '/index.html'].includes(await s.page.evaluate(() => location.pathname)));
    await s.close();
  }

  // the home page: the slots follow the scroll; a cold link to a section; «المزيد» takes you to a section
  {
    const s = await open(PHONE);
    await s.page.goto(BASE + '/index.html#activities', { waitUntil: 'networkidle2' });
    await sleep(3500);
    const lit = () => s.page.evaluate(() => ({ y: Math.round(scrollY), lit: document.querySelector('.tabbar [aria-current="location"]')?.dataset.tab, slots: [...document.querySelectorAll('.tabbar__slots [data-tab]')].map(a => a.dataset.tab) }));
    const r = await s.page.evaluate(() => { const el = document.querySelector('[data-area="items"][data-key="activities"]'); return { y: Math.round(scrollY), top: el ? Math.round(el.getBoundingClientRect().top) : null, lit: document.querySelector('.tabbar [aria-current="location"]')?.dataset.tab }; });
    check('cold #activities: scrolled to the section', r.top !== null && r.y > 100 && Math.abs(r.top) < 200, r);
    check('cold #activities: «الفعاليات» is lit', r.lit === 'activities', r);
    await s.page.evaluate(() => scrollTo(0, 0));
    await sleep(500);
    const top = await lit();
    check('at the top: «الرئيسية» is lit, the next places beside it', top.lit === 'top' && top.slots[0] === 'top' && top.slots.length === 3, top);
    await s.page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await sleep(500);
    const end = await lit();
    check('at the end: the last places, one of them lit', end.slots.length === 3 && end.slots.includes(end.lit) && end.slots[0] !== 'top', end);
    await s.page.evaluate(() => scrollTo(0, 0));
    await sleep(300);
    await s.page.click('.tabbar [data-tab="more"]');
    await s.page.waitForSelector('dialog.nav-more[open] .nav-more__tile');
    const tiles = await s.page.$$eval('dialog.nav-more .nav-more__tile', as => as.map(a => a.textContent.trim()));
    check('«المزيد»: the sections, the social pages and the site pages', tiles.length >= 6, tiles);
    await s.page.evaluate(() => [...document.querySelectorAll('dialog.nav-more .nav-more__tile')].find(a => /#to-contacts$/.test(a.href))?.click());
    await sleep(1500);
    const c = await s.page.evaluate(() => ({ open: !!document.querySelector('dialog.nav-more[open]'), top: Math.round(document.querySelector('[data-area="contacts"]')?.getBoundingClientRect().top ?? 9999), path: location.pathname }));
    check('«المزيد» → تواصل: the sheet closes, the page is at the section', !c.open && Math.abs(c.top) < 160 && ['/', '/index.html'].includes(c.path), c);
    await s.close();
  }
} finally {
  await browser.close();
}
console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
