// Fit matrix: every scene on many screens (phones from 280 px wide to
// 440 × 956, short screens with the browser's bars showing, landscape,
// tablet, desktop). For each it checks the ONE fit rule (sheets.css
// "MINI-EXPERIENCES", engine.js fitStage):
//   the sheet inside the visible screen; the button on screen and clickable;
//   nothing sideways; nothing to scroll inside the sheet; the speaker and
//   the close button clear of the phone and the title; the phone still
//   9:16 and not too small; its picture true to shape; in chats, the shared
//   picture whole on screen.
// Writes contact sheets of the hardest screens to tools/.cache/fit/.
//
// Usage: cd tools && node xp-fit-matrix.mjs [port] [--quick] [scenes…]
// tests/xp-fit.e2e.mjs runs the same checks.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ROOT } from './lib/gs.mjs';
import { SCENES, testPicture, matrixContent, pathOf, measureMedia, chromePath } from './xp-media-matrix.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');
const sharp = require('sharp');

const phone = (width, height, extra = {}) => ({ width, height, isMobile: true, hasTouch: true, deviceScaleFactor: 2, ...extra });

/* name → viewport (CSS px). "bars": the browser's own bars take that much of the screen */
export const SCREENS = {
  '280x653': phone(280, 653),
  '320x568': phone(320, 568),
  '360x640': phone(360, 640),
  '360x740': phone(360, 740),
  '360x800': phone(360, 800),
  '375x667': phone(375, 667),
  '375x812': phone(375, 812),
  '390x844': phone(390, 844),
  '393x873': phone(393, 873),
  '412x915': phone(412, 915),
  '414x896': phone(414, 896),
  '430x932': phone(430, 932),
  '440x956': phone(440, 956),
  's20fe-bars': phone(412, 760, { deviceScaleFactor: 2.625 }),   // Galaxy S20 FE, Chrome's bars showing
  's20fe': phone(412, 914, { deviceScaleFactor: 2.625 }),
  '360x560-bars': phone(360, 560),                                // a short phone with its bars
  '412x700-tall-bars': phone(412, 700),
  'land-844x390': phone(844, 390),
  'land-667x375': phone(667, 375),
  'land-932x430': phone(932, 430),
  'tablet-768x1024': { width: 768, height: 1024, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  'desktop-1366x768': { width: 1366, height: 768, deviceScaleFactor: 1 },
  'desktop-1920x1080': { width: 1920, height: 1080, deviceScaleFactor: 1 }
};

/* the screens of the contact sheets: smallest, shortest, tallest, the tall Android, the S20 FE, a landscape */
export const HARDEST = ['280x653', '320x568', '360x560-bars', '440x956', '412x915', 's20fe-bars', 'land-844x390'];


/* measured in the page, the scene open */
export function measureFit() {

  const dialog = document.querySelector('dialog.sheet--xp[open]');
  if (!dialog) return null;
  const rect = el => (el ? el.getBoundingClientRect() : null);
  const panel = rect(dialog.querySelector('.sheet__panel'));
  const body = dialog.querySelector('.sheet__body');
  const cta = dialog.querySelector('.xp__cta');
  const ctaBox = rect(cta);
  const phoneEl = dialog.querySelector('.xp-phone, .vo');
  const phoneBox = rect(phoneEl);
  const stage = rect(dialog.querySelector('.xp-stage'));
  const sound = rect(dialog.querySelector('.xp-sound'));
  const close = rect(dialog.querySelector('.sheet__close'));
  const title = rect(dialog.querySelector('.sheet__title'));
  const line = dialog.querySelector('.xp__line');
  const overlap = (a, b) => !!a && !!b && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
  const inside = (a, b, pad = 1) => !!a && !!b && a.left >= b.left - pad && a.right <= b.right + pad && a.top >= b.top - pad && a.bottom <= b.bottom + pad;
  const view = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
  let clickable = false;
  if (ctaBox) {
    const hit = document.elementFromPoint(ctaBox.left + ctaBox.width / 2, ctaBox.top + ctaBox.height / 2);
    clickable = !!hit && (hit === cta || cta.contains(hit));
  }
  // in chats, the shared item (.is-current) whole inside its scrolling area
  const current = dialog.querySelector('.is-current');
  const scroller = current && current.closest('.wa-chat, .ch-scroll');
  return {
    vw: innerWidth,
    vh: innerHeight,
    panelInView: inside(panel, view),
    ctaInView: inside(ctaBox, view),
    ctaClickable: clickable,
    ctaHeight: ctaBox ? Math.round(ctaBox.height) : 0,
    sideways: document.documentElement.scrollWidth > innerWidth + 1 || (panel && (panel.left < -1 || panel.right > innerWidth + 1)),
    bodyScroll: body ? body.scrollHeight - body.clientHeight : 0,
    phoneInStage: inside(phoneBox, stage, 2),
    phoneInPanel: inside(phoneBox, panel, 2),
    phone: phoneBox ? [Math.round(phoneBox.width), Math.round(phoneBox.height)] : null,
    phoneRatio: phoneBox ? +(phoneBox.width / phoneBox.height).toFixed(4) : 0,
    zoom: +(getComputedStyle(dialog.querySelector('.xp-stage') || document.body).getPropertyValue('--xp-zoom') || 0),
    soundOverPhone: overlap(sound, phoneBox),
    closeOverTitle: overlap(close, title),
    lineSize: line ? parseFloat(getComputedStyle(line).fontSize) : 0,
    // layout position (offsets: an entrance transform doesn't count)
    currentWhole: current && scroller ? (() => {
      let y = 0;
      for (let el = current; el && el !== scroller; el = el.offsetParent) {
        y += el.offsetTop;
        if (el.offsetParent === scroller) break;
      }
      return y >= -1.5 && y + current.offsetHeight <= scroller.clientHeight + 1.5;
    })() : null,
    currentAt: current && scroller ? (() => {
      let y = 0;
      for (let el = current; el && el !== scroller; el = el.offsetParent) {
        y += el.offsetTop;
        if (el.offsetParent === scroller) break;
      }
      return { top: y, bottom: y + current.offsetHeight, height: scroller.clientHeight };
    })() : null,
    media: null
  };

}


export async function openScene(page, id) {

  await page.evaluate(link => { location.hash = `#follow/${link}`; }, id);
  await page.waitForSelector('dialog.sheet--xp[open] .xp-stage', { timeout: 8000 });
  await page.waitForSelector('dialog.sheet--xp[open] .xp-phone, dialog.sheet--xp[open] .vo', { timeout: 8000 });
  // the sheet's spring and the button's arrival (~0.9 s) done
  await new Promise(r => setTimeout(r, 1000));
  await page.waitForFunction(() => {
    const panel = document.querySelector('dialog.sheet--xp[open] .sheet__panel');
    return panel && panel.getAnimations().every(a => a.playState !== 'running') && !document.querySelector('.xp.cta-pending');
  }, { timeout: 8000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 300));

}

export async function fitOf(page) {

  const fit = await page.evaluate(measureFit);
  if (fit) fit.media = await page.evaluate(measureMedia);
  return fit;

}

export async function closeIt(page) {

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog.sheet'), { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => history.replaceState(null, '', location.pathname));

}

/* the problems one fit shows (empty: all good) */
export function problems(fit, { minPhoneWidth = 110 } = {}) {

  if (!fit) return ['no scene'];
  const out = [];
  if (!fit.panelInView) out.push('sheet outside the screen');
  if (!fit.ctaInView) out.push('button off screen');
  if (!fit.ctaClickable) out.push('button covered');
  if (fit.ctaHeight < 44) out.push(`button ${fit.ctaHeight}px`);
  if (fit.sideways) out.push('sideways overflow');
  if (fit.bodyScroll > 2) out.push(`sheet scrolls ${fit.bodyScroll}px`);
  if (!fit.phoneInStage || !fit.phoneInPanel) out.push('phone outside its stage');
  if (fit.phone && Math.abs(fit.phoneRatio / (236 / 420) - 1) > 0.015) out.push(`phone ratio ${fit.phoneRatio}`);
  if (fit.phone && fit.phone[0] < minPhoneWidth) out.push(`phone ${fit.phone[0]}px wide`);
  if (fit.soundOverPhone) out.push('speaker over the phone');
  if (fit.closeOverTitle) out.push('close over the title');
  if (fit.lineSize && fit.lineSize < 14) out.push(`words ${fit.lineSize}px`);
  if (fit.currentWhole === false) out.push('shared picture cut');
  const m = fit.media;
  if (m) {
    if (Math.abs(m.stretch - 1) > 0.02) out.push(`stretched ${m.stretch}`);
    if (m.bandX > 2 || m.bandY > 2) out.push(`bands ${m.bandX}/${m.bandY}`);
  }
  return out;

}

/* a page on a screen, with the matrix content (one 4:5 poster per scene) */
export async function fitPage(browser, port, screen, pictures, content) {

  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const body = JSON.stringify(content);
  await page.setRequestInterception(true);
  page.on('request', req => {
    const url = req.url();
    if (url.includes('/content.json')) return req.respond({ status: 200, contentType: 'application/json', body });
    const shape = Object.keys(pictures).find(k => url.endsWith(`/${pathOf(k)}`));
    if (shape) return req.respond({ status: 200, contentType: 'image/webp', body: pictures[shape] });
    return req.continue();
  });
  await page.setViewport(SCREENS[screen]);
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#main[data-state="ready"]');
  return { context, page };

}


if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {

  const args = process.argv.slice(2);
  const PORT = Number(args.find(a => /^\d+$/.test(a))) || 4880;
  const only = args.filter(a => !/^\d+$/.test(a) && !a.startsWith('--'));
  const scenes = only.length ? SCENES.filter(s => only.includes(s)) : SCENES;
  const screens = args.includes('--quick') ? HARDEST : Object.keys(SCREENS);
  const OUT = `${ROOT}tools/.cache/fit/`;
  mkdirSync(`${OUT}shots`, { recursive: true });

  const pictures = { '4x5': await testPicture('4x5') };
  const content = matrixContent(JSON.parse(readFileSync(`${ROOT}content.json`, 'utf8')), scenes);
  const server = spawn(process.execPath, [`${ROOT}tools/serve.mjs`, String(PORT)], { stdio: 'pipe' });
  await new Promise(resolve => server.stdout.once('data', resolve));
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true });
  let bad = 0;

  for (const screen of screens) {
    const { context, page } = await fitPage(browser, PORT, screen, pictures, content);
    for (const key of scenes) {
      await openScene(page, `mx-${key}-4x5`);
      const fit = await fitOf(page);
      const issues = problems(fit);
      if (issues.length) bad++;
      console.log(`${screen.padEnd(18)} ${key.padEnd(10)} zoom ${String(fit && fit.zoom).padEnd(5)} phone ${fit && fit.phone ? fit.phone.join('x') : '-'} ${issues.length ? 'FAIL ' + issues.join('; ') : 'ok'}`);
      if (HARDEST.includes(screen)) await page.screenshot({ path: `${OUT}shots/${screen}-${key}.png` });
      await closeIt(page);
    }
    await context.close();
  }

  // contact sheets: one per hard screen, every scene side by side
  for (const screen of screens.filter(s => HARDEST.includes(s))) {
    const cells = [];
    let x = 0;
    for (const key of scenes) {
      try {
        const buf = await sharp(`${OUT}shots/${screen}-${key}.png`).resize({ height: 640 }).png().toBuffer();
        const { width } = await sharp(buf).metadata();
        cells.push({ input: buf, left: x, top: 30 });
        x += width + 8;
      }
      catch { /* missing */ }
    }
    if (!cells.length) continue;
    const label = `<svg xmlns="http://www.w3.org/2000/svg" width="${x}" height="30"><text x="8" y="21" fill="#fff" font-family="Arial" font-size="18">${screen} — ${scenes.join(' · ')}</text></svg>`;
    await sharp({ create: { width: x, height: 670, channels: 3, background: '#111' } })
      .composite([{ input: Buffer.from(label), left: 0, top: 0 }, ...cells])
      .png({ compressionLevel: 9 })
      .toFile(`${OUT}contact-${screen}.png`);
  }

  console.log(bad ? `${bad} problem(s)` : 'all fit');
  await browser.close();
  server.kill();

}
