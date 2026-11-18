// «خبزنا اليومي» W5: the real page next to the approved W1 design, state by state, at the six sizes.
// Left: W1 (docs/daily-bread/w1/member.html, the approved prototype) · right: the real /daily-bread/ on the real Worker
// code (SQLite) with W1's sample program. One PNG per state and size in tools/.cache/bread-compare/.
//   node --experimental-sqlite --no-warnings tools/bread-compare.mjs [state-prefix …] [--sizes=390,1440]
import { mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { ROOT } from './lib/gs.mjs';
import { startWorld, seedFor, prime, CHROME, PROTO } from '../tests/bread-world.mjs';
import { cairoDay, dayAdd } from '../worker/src/bread/model.js';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');
const sharp = require('sharp');
const OUT = `${ROOT}tools/.cache/bread-compare/`;
mkdirSync(OUT, { recursive: true });

export const SIZES = [
  ['360', { width: 360, height: 780, deviceScaleFactor: 1, isMobile: true, hasTouch: true }],
  ['375', { width: 375, height: 812, deviceScaleFactor: 1, isMobile: true, hasTouch: true }],
  ['390', { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true }],
  ['768', { width: 768, height: 1024, deviceScaleFactor: 1, isMobile: true, hasTouch: true }],
  ['1024', { width: 1024, height: 768, deviceScaleFactor: 1 }],
  ['1440', { width: 1440, height: 900, deviceScaleFactor: 1 }]
];
const DRAFT = 'حاسس إني بدوّر على الشبع في الموبايل والسوشيال، وبعدها بحس بفراغ أكتر. محتاج أبدأ يومي بكلمة من ربنا قبل أي حاجة.';
const PROD = 'https://athanasios-api.menazak-lab.workers.dev';

/* the device's notifications as W1 shows them (no real push: the production Worker is never asked) */
async function pushMock(page, mode) {
  await page.setRequestInterception(true);
  page.on('request', r => {
    if (r.url().startsWith(PROD)) {
      if (r.method() === 'OPTIONS') { r.respond({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST' } }); return; }
      if (r.url().endsWith('/v1/bread/slots')) r.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true, times: mode === 'on' ? ['08:00', '22:00'] : [], max: 3, defaultTime: '08:00' }) });
      else r.abort();
      return;
    }
    r.continue();
  });
  await page.evaluateOnNewDocument(mode => {
    if (mode === 'on' || mode === 'denied') {
      try { Object.defineProperty(Notification, 'permission', { get: () => (mode === 'on' ? 'granted' : 'denied') }); } catch { /* fine */ }
    }
    if (mode === 'on') localStorage.setItem('athanasios.push.v1', JSON.stringify({ token: 'fid_' + 'x'.repeat(18), at: Date.now() }));
    if (mode === 'ios') { try { delete window.PushManager; Object.defineProperty(navigator, 'standalone', { get: () => false }); } catch { /* fine */ } }
  }, mode);
}

/* freeze every running animation at `ms` (the intro's own clock), as W1's ?hold= does */
const hold = (page, ms) => page.evaluate(ms => { document.getAnimations().filter(a => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.br-intro')).forEach(a => { a.pause(); a.currentTime = ms; }); }, ms);

export async function compareRun({ only = [], sizes = SIZES } = {}) {
  const w = await startWorld({ sitePort: 4762, apiPort: 4763 });
  const p = await w.program({ dayNo: 5 });
  const seed = seedFor(p.id, 30, 4, 0);
  const eligible = await w.member();
  const guest = await w.member({ guest: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'] });

  const sent = async (m, agoMs) => {
    await w.h.db.prepare('DELETE FROM rate_limits').run();  // a sample reflection for every size: not a real member's pace
    const r = await w.h.call('/v1/bread/reflection', { method: 'POST', body: { seed, text: DRAFT }, headers: { authorization: 'Bearer ' + m.token } });
    if (r.status !== 200) throw new Error(JSON.stringify(r.body));
    await w.h.db.prepare('UPDATE bread_reflections SET created_ms = ? WHERE id = ?').bind(Date.now() - agoMs, r.body.reflection.id).run();
    return r.body.reflection.id;
  };
  const unsend = m => w.h.db.prepare('DELETE FROM bread_reflections WHERE participant_id = ?').bind(m.id).run();

  // id, W1 url, the real page: { path, member, look, push, ua, extra, before(page), after(page), w1after(page), full, holdMs }
  const STATES = [
    ['03-today', 'member.html?s=today&intro=0', { member: eligible, push: 'on' }],
    ['03-today-full', 'member.html?s=today&intro=0', { member: eligible, push: 'on', full: true, only: ['390'] }],
    ['03-dawn', 'member.html?s=today&intro=0&look=dawn', { member: eligible, push: 'on', look: 'dawn' }],
    ['04-question', 'member.html?s=today&intro=0&acct=eligible#reflect', { member: eligible, push: 'on', hash: '#reflect' }],
    ['05-reflect-none', 'member.html?s=today&intro=0&acct=none&refl=typing#reflect', { push: 'on', hash: '#reflect', extra: k => ({ [`bread.draft.${p.id}.${k}`]: DRAFT }) }],
    ['05-signin', 'member.html?s=today&intro=0&acct=none&refl=typing&signin=1', { push: 'on', extra: k => ({ [`bread.draft.${p.id}.${k}`]: DRAFT }), after: page => page.click('[data-act="signin"]') }],
    ['05-reflect-guest', 'member.html?s=today&intro=0&acct=guest#reflect', { member: guest, push: 'on', hash: '#reflect' }],
    ['05-reflect-sent', 'member.html?s=today&intro=0&refl=sent#reflect', { member: eligible, push: 'on', hash: '#reflect', before: () => sent(eligible, 340000) }],
    ['05-reflect-edit', 'member.html?s=today&intro=0&refl=edit#reflect', { member: eligible, push: 'on', hash: '#reflect', before: () => sent(eligible, 538000), after: async page => { await page.click('[data-act="edit"]'); await page.evaluate(() => document.getElementById('reflect').scrollIntoView()); } }],
    ['05-reflect-locked', 'member.html?s=today&intro=0&refl=locked&read=1#reflect', { member: eligible, push: 'on', hash: '#reflect', read: true, before: () => sent(eligible, 22 * 60000) }],
    ['06-reminders', 'member.html?s=reminders&rem=on&intro=0', { member: eligible, push: 'on', path: '?s=reminders' }],
    ['06-reminders-denied', 'member.html?s=reminders&rem=denied&intro=0', { member: eligible, push: 'denied', path: '?s=reminders' }],
    ['06-reminders-ios', 'member.html?s=reminders&rem=ios&intro=0', { member: eligible, push: 'ios', path: '?s=reminders', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' }],
    ['07-late', 'member.html?s=today&intro=0&late=19&t=2', { member: eligible, push: 'on', late: true }],
    ['08-empty', 'member.html?s=empty&intro=0', { member: eligible, push: 'on', over: true }],
    ['09-share', 'member.html?s=today&intro=0&share=1', { member: eligible, push: 'on', after: page => page.click('[data-act="share"]'), wait: 2500 }],
    ['02-intro-a', 'member.html?s=today&intro=1&sound=off&hold=500', { member: eligible, push: 'on', intro: 500 }],
    ['02-intro-b', 'member.html?s=today&intro=1&sound=off&hold=1250', { member: eligible, push: 'on', intro: 1250 }],
    ['02-intro-c', 'member.html?s=today&intro=1&sound=off&hold=2250', { member: eligible, push: 'on', intro: 2250 }],
    ['02-intro-d', 'member.html?s=today&intro=1&sound=off&hold=2780', { member: eligible, push: 'on', intro: 2780 }],
    ['10-home', 'home-card.html', { home: true, push: 'on' }]
  ].filter(([id]) => !only.length || only.some(o => id.startsWith(o)));

  const done = [];
  for (const [id, w1, o] of STATES) {
    // the program's dates for this state
    if (o.late) await w.startOn(p.id, dayAdd(cairoDay(), -11));
    else if (o.over) await w.startOn(p.id, dayAdd(cairoDay(), -30));
    else await w.startOn(p.id, dayAdd(cairoDay(), -4));
    const s = o.late ? seedFor(p.id, 30, 11, 2) : seed;
    const n = (await import('../worker/src/bread/model.js')).orderFor(s, p.id, 30)[o.late ? 11 : 4] + 1;
    for (const [size, vp] of sizes) {
      if (o.only && !o.only.includes(size)) continue;
      if (o.member) await unsend(o.member);
      if (o.before) await o.before();
      const shots = [];
      for (const side of ['w1', 'real']) {
        const ctx = await browser.createBrowserContext();
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        if (o.ua) await page.setUserAgent(o.ua);
        await page.setViewport(vp);
        await pushMock(page, o.push);
        let url;
        if (side === 'w1') url = `${w.LOCAL}/docs/daily-bread/w1/${w1}`;
        else if (o.home) {
          await page.evaluateOnNewDocument(() => { try { sessionStorage.setItem('athanasios:intro', '1'); } catch { /* fine */ } });
          await prime(page, w.API, { seed: s, extra: { ['bread.joined.' + p.id]: dayAdd(cairoDay(), -4) } });
          url = `${w.LOCAL}/index.html`;
        }
        else {
          await prime(page, w.API, { seed: s, member: o.member, look: o.look, extra: { ...(o.extra ? o.extra(n) : {}), ...(o.read ? { 'bread.read': cairoDay() } : {}), ...(o.late ? {} : { ['bread.joined.' + p.id]: dayAdd(cairoDay(), -4) }) } });
          const q = o.path || '?';
          url = `${w.LOCAL}/daily-bread/${q}${q.includes('?') && q.length > 1 ? '&' : ''}${o.intro ? '' : 'intro=0'}${o.hash || ''}`;
        }
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 45000 });
        await page.evaluate(() => document.fonts && document.fonts.ready);
        if (side === 'real') {
          if (o.intro) {
            await page.waitForSelector('.br-intro', { timeout: 15000 });
            await hold(page, o.intro);
          }
          else if (!o.home) await page.waitForSelector('.br-dawn, .br-sheet-page', { timeout: 15000 });
          if (o.home) {
            await page.waitForSelector('.br-home', { timeout: 15000 });
            await page.evaluate(() => document.querySelector('.br-home').scrollIntoView({ block: 'center' }));
          }
          if (o.after) await o.after(page);
          if (o.hash && !o.after) await page.evaluate(() => document.getElementById('reflect')?.scrollIntoView({ block: 'start' }));
        }
        await new Promise(r => setTimeout(r, o.wait || (o.intro ? 400 : 1600)));
        if (o.intro && side === 'real') await hold(page, o.intro);
        const buf = await page.screenshot({ fullPage: !!o.full, type: 'png' });
        shots.push(buf);
        if (errors.length) console.log(`  ${side} ${id} ${size}: ${errors.join(' | ').slice(0, 200)}`);
        await ctx.close();
      }
      const [a, b] = await Promise.all(shots.map(s => sharp(s).metadata()));
      const H = Math.max(a.height, b.height), W = a.width + b.width + 24;
      const file = `${OUT}${id}-${size}.png`;
      await sharp({ create: { width: W, height: H, channels: 3, background: '#ff00aa' } })
        .composite([{ input: shots[0], left: 0, top: 0 }, { input: shots[1], left: a.width + 24, top: 0 }])
        .png().toFile(file);
      done.push(file);
      console.log('compare', id, size);
    }
  }
  await browser.close();
  await w.close();
  return done;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('bread-compare.mjs')) {
  const sizeArg = process.argv.find(a => a.startsWith('--sizes='));
  const sizes = sizeArg ? SIZES.filter(([s]) => sizeArg.slice(8).split(',').includes(s)) : SIZES;
  const only = process.argv.slice(2).filter(a => !a.startsWith('--'));
  if (!existsSync(CHROME || '')) throw new Error('no Chrome');
  if (!PROTO) throw new Error('docs/daily-bread/prototype/data.js missing');
  await compareRun({ only, sizes });
  process.exit(0);
}
