// Media matrix: every scene that shows the admin's pictures (kit.js
// mediaNode), with one picture of each shape, on a phone and a desktop.
// For each it measures the media box against the picture it shows:
//   bandX / bandY  blurred bands beside / above-below the picture (px)
//   cropX / cropY  how much of the picture is cut off (cover) (px)
//   stretch        picture's drawn ratio ÷ its real ratio (1 = true shape)
//   gap            room left beside the box inside its own frame (px)
// and writes contact sheets + the numbers to tools/.cache/matrix/.
//
// Usage: cd tools && node xp-media-matrix.mjs [port] [--views=phone,desktop] [keys…]
// Dev-only (needs Chrome). tests/xp-media.e2e.mjs checks the same numbers.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ROOT } from './lib/gs.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');
const sharp = require('sharp');

export const SHAPES = {
  '9x16': [720, 1280],
  '4x5': [1080, 1350],
  '1x1': [1080, 1080],
  '16x9': [1600, 900],
  '4x1': [2000, 500]
};

export const SCENES = ['facebook', 'instagram', 'whatsapp', 'telegram', 'messenger', 'discord', 'x', 'threads', 'tiktok', 'snapchat', 'youtube', 'spotify'];

export const VIEWS = {
  phone: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  desktop: { width: 1366, height: 860, deviceScaleFactor: 1 }
};

/* a path content.js accepts (media/YYYY/img-xxxxxxxx.webp), served by matrixPage */
export const pathOf = shape => `media/2099/img-${`mx${shape}`.padEnd(8, 'a')}.webp`;

const HUES = { '9x16': ['#7b2ff7', '#f107a3'], '4x5': ['#0f6fff', '#14d4c4'], '1x1': ['#ff7a00', '#ffd000'], '16x9': ['#00a86b', '#b8f000'], '4x1': ['#e0115f', '#ff8a00'] };

/* a test picture: its shape in words, a frame 2 % in (cropping shows), a circle (stretching shows) */
export async function testPicture(shape) {
  const [w, h] = SHAPES[shape];
  const [a, b] = HUES[shape];
  const r = Math.min(w, h) * 0.32;
  const edge = Math.round(Math.min(w, h) * 0.02);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
    <rect x="${edge}" y="${edge}" width="${w - 2 * edge}" height="${h - 2 * edge}" fill="none" stroke="#fff" stroke-width="${edge}"/>
    <circle cx="${w / 2}" cy="${h / 2}" r="${r}" fill="none" stroke="#fff" stroke-width="${edge * 1.5}"/>
    <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="Arial" font-weight="700" font-size="${r * 0.55}" fill="#fff">${shape.replace('x', ':')}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).webp({ quality: 80 }).toBuffer();
}

/* content.json with one link per scene × shape (its gallery: that one picture, with words) */
export function matrixContent(base, scenes = SCENES) {
  const content = JSON.parse(JSON.stringify(base));
  const section = content.sections[0];
  section.links = section.links.filter(l => !l.id.startsWith('mx-'));
  for (const key of scenes) {
    for (const [shape, [w, h]] of Object.entries(SHAPES)) {
      section.links.push({
        id: `mx-${key}-${shape}`, title: `${key} ${shape}`, subtitle: '', url: `https://example.org/${key}`, icon: 'star',
        style: 'card', badge: '', startAt: '', endAt: '', experience: key,
        gallery: [{ src: pathOf(shape), thumb: pathOf(shape), w, h, alt: '', text: `صورة ${shape.replace('x', ':')} للتجربة` }]
      });
    }
  }
  // every scene section showing
  if (Array.isArray(content.layout)) content.layout.forEach(s => { s.visibleFrom = ''; s.visibleUntil = ''; });
  return content;
}

/* measured in the page: the first own media box that is on screen */
export function measureMedia() {
  const box = [...document.querySelectorAll('dialog[open] .xp-media[data-id^="own-"]')]
    .find(el => { const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4 && getComputedStyle(el).visibility !== 'hidden'; });
  if (!box) return null;
  const main = box.querySelector('.xp-media__main');
  if (!main || !(main.naturalWidth || main.videoWidth)) return null;
  // a frame's picture is its own box inside the frame (the room around it is the design): measure that
  const framed = box.classList.contains('xp-media--framed');
  const r = (framed ? main : box).getBoundingClientRect();
  const iw = main.naturalWidth || main.videoWidth;
  const ih = main.naturalHeight || main.videoHeight;
  const fit = getComputedStyle(main).objectFit;
  const scale = fit === 'cover' ? Math.max(r.width / iw, r.height / ih) : fit === 'fill' ? null : Math.min(r.width / iw, r.height / ih);
  const cw = scale ? iw * scale : r.width;
  const ch = scale ? ih * scale : r.height;
  // the room beside the box inside the frame it sits in (its parent's content box)
  const parent = box.parentElement;
  const ps = getComputedStyle(parent);
  const inner = framed ? r.width : parent.getBoundingClientRect().width - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight) - parseFloat(ps.borderLeftWidth) - parseFloat(ps.borderRightWidth);
  return {
    cls: [...box.classList].filter(c => c !== 'xp-media').join(' '),
    fit: framed ? 'framed' : box.classList.contains('xp-media--bleed') ? 'bleed' : fit,
    box: [Math.round(r.width), Math.round(r.height)],
    frame: framed ? [Math.round(box.getBoundingClientRect().width), Math.round(box.getBoundingClientRect().height)] : null,
    bandX: Math.max(0, Math.round(r.width - cw)),
    bandY: Math.max(0, Math.round(r.height - ch)),
    cropX: Math.max(0, Math.round(cw - r.width)),
    cropY: Math.max(0, Math.round(ch - r.height)),
    stretch: +((cw / ch) / (iw / ih)).toFixed(3),
    gap: Math.max(0, Math.round(inner - r.width)),
    rect: [r.left, r.top, r.width, r.height].map(Math.round)
  };
}

/* opens one scene link and waits for its picture to be on screen and measurable */
export async function openAndMeasure(page, id, { timeout = 16000 } = {}) {
  await page.evaluate(link => { location.hash = `#follow/${link}`; }, id);
  await page.waitForSelector('dialog.sheet--xp[open] .xp-stage', { timeout: 6000 });
  const until = Date.now() + timeout;
  let m = null;
  while (Date.now() < until) {
    m = await page.evaluate(measureMedia);
    if (m) break;
    await new Promise(r => setTimeout(r, 250));
  }
  // let entrance animations settle, then measure again
  await new Promise(r => setTimeout(r, 900));
  return (await page.evaluate(measureMedia)) || m;
}

export async function closeScene(page) {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog.sheet'), { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => history.replaceState(null, '', location.pathname));
}

/* a page with the matrix content and pictures served by request interception */
export async function matrixPage(browser, port, view, content, pictures) {
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
  await page.setViewport(VIEWS[view]);
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#main[data-state="ready"]');
  return { context, page };
}

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
];

export function chromePath() {
  return CHROME.find(p => { try { readFileSync(p); return true; } catch { return false; } });
}


if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {

  const args = process.argv.slice(2);
  const PORT = Number(args.find(a => /^\d+$/.test(a))) || 4870;
  const views = ((args.find(a => a.startsWith('--views=')) || '--views=phone,desktop').split('=')[1]).split(',');
  const only = args.filter(a => !/^\d+$/.test(a) && !a.startsWith('--'));
  const scenes = only.length ? SCENES.filter(s => only.includes(s)) : SCENES;
  const OUT = `${ROOT}tools/.cache/matrix/`;
  mkdirSync(`${OUT}shots`, { recursive: true });

  const pictures = {};
  for (const shape of Object.keys(SHAPES)) pictures[shape] = await testPicture(shape);
  const content = matrixContent(JSON.parse(readFileSync(`${ROOT}content.json`, 'utf8')), scenes);

  const server = spawn(process.execPath, [`${ROOT}tools/serve.mjs`, String(PORT)], { stdio: 'pipe' });
  await new Promise(resolve => server.stdout.once('data', resolve));
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true });
  const results = [];

  for (const view of views) {
    const { context, page } = await matrixPage(browser, PORT, view, content, pictures);
    page.on('pageerror', e => console.log('ERROR', view, e.message));
    for (const key of scenes) {
      for (const shape of Object.keys(SHAPES)) {
        const id = `mx-${key}-${shape}`;
        let m = null;
        try {
          m = await openAndMeasure(page, id);
          const panel = await page.$('dialog.sheet--xp[open] .sheet__panel');
          await (panel || page).screenshot({ path: `${OUT}shots/${view}-${key}-${shape}.png` });
        }
        catch (error) {
          console.log('fail', view, id, error.message);
        }
        await closeScene(page);
        results.push({ view, key, shape, ...(m || { missing: true }) });
        const flag = !m ? 'MISSING' : [m.bandX > 6 && `bandX ${m.bandX}`, m.bandY > 6 && `bandY ${m.bandY}`, m.cropX + m.cropY > 6 && `crop ${m.cropX}/${m.cropY}`, Math.abs(m.stretch - 1) > 0.02 && `stretch ${m.stretch}`, m.gap > 6 && `gap ${m.gap}`].filter(Boolean).join(', ');
        console.log(`${view.padEnd(8)} ${key.padEnd(10)} ${shape.padEnd(5)} ${m ? `${m.box.join('x').padEnd(9)} ${m.fit.padEnd(7)}` : ''} ${flag}`);
      }
    }
    await context.close();
  }

  writeFileSync(`${OUT}results.json`, JSON.stringify(results, null, 1));

  // contact sheets: one per view, a row per scene, a column per shape
  for (const view of views) {
    const cellW = view === 'phone' ? 300 : 340;
    const cells = [];
    let cellH = 0;
    const rows = [];
    for (const key of scenes) {
      const row = [];
      for (const shape of Object.keys(SHAPES)) {
        try {
          const img = sharp(`${OUT}shots/${view}-${key}-${shape}.png`).resize({ width: cellW });
          const buf = await img.png().toBuffer();
          const { height } = await sharp(buf).metadata();
          cellH = Math.max(cellH, height);
          row.push(buf);
        }
        catch {
          row.push(null);
        }
      }
      rows.push(row);
    }
    const head = 28;
    const label = 110;
    const W = label + cellW * Object.keys(SHAPES).length;
    const H = head + rows.length * (cellH + 6);
    rows.forEach((row, r) => row.forEach((buf, c) => { if (buf) cells.push({ input: buf, left: label + c * cellW, top: head + r * (cellH + 6) }); }));
    const text = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      ${Object.keys(SHAPES).map((s, c) => `<text x="${label + c * cellW + cellW / 2}" y="20" fill="#fff" font-family="Arial" font-size="16" text-anchor="middle">${s.replace('x', ':')}</text>`).join('')}
      ${scenes.map((k, r) => `<text x="8" y="${head + r * (cellH + 6) + 24}" fill="#fff" font-family="Arial" font-size="15">${k}</text>`).join('')}
    </svg>`;
    await sharp({ create: { width: W, height: H, channels: 3, background: '#111' } })
      .composite([{ input: Buffer.from(text) }, ...cells])
      .png({ compressionLevel: 9 })
      .toFile(`${OUT}contact-${view}.png`);
    console.log(`contact sheet: ${OUT}contact-${view}.png`);
  }

  await browser.close();
  server.kill();

}
