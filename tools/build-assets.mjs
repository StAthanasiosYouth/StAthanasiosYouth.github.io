// Builds optimized image assets from tools/source/:
//   assets/img/logo-{128,256,384}.webp   hero / header logo (1x, 2x, 3x)
//   assets/img/logo-512.png              fallback + QR center + OG
//   assets/img/favicon-32.png, favicon-192.png
//   assets/img/apple-touch-icon.png      180px on navy (iOS fills transparency with black)
//   assets/img/og-image.png              1200x630 link preview (rendered with Chrome)
//
// Usage: npm run assets            (all)
//        npm run assets -- --no-og (skip the Chrome render)

import sharp from 'sharp';
import { mkdirSync, existsSync, statSync, readFileSync } from 'node:fs';
import { ROOT } from './lib/gs.mjs';

const SRC = `${ROOT}tools/source/logo.png`;
const OUT = `${ROOT}assets/img/`;
const NAVY = '#061a31';

mkdirSync(OUT, { recursive: true });

// the source is 848x858: pad to a centered square first
const meta = await sharp(SRC).metadata();
const side = Math.max(meta.width, meta.height);

const square = await sharp(SRC)
  .extend({
    top: Math.floor((side - meta.height) / 2),
    bottom: Math.ceil((side - meta.height) / 2),
    left: Math.floor((side - meta.width) / 2),
    right: Math.ceil((side - meta.width) / 2),
    background: { r: 0, g: 0, b: 0, alpha: 0 }
  })
  .png()
  .toBuffer();

const report = [];

async function out(name, pipeline) {
  await pipeline.toFile(OUT + name);
  report.push(`${name.padEnd(24)} ${(statSync(OUT + name).size / 1024).toFixed(1)} KB`);
}

for (const size of [128, 256, 384]) {
  await out(`logo-${size}.webp`, sharp(square).resize(size, size, { kernel: 'lanczos3' }).webp({ quality: 86, alphaQuality: 90, effort: 6 }));
}

await out('logo-512.png', sharp(square).resize(512, 512).png({ compressionLevel: 9, palette: true, quality: 92, effort: 10 }));
await out('favicon-32.png', sharp(square).resize(32, 32).png({ compressionLevel: 9 }));
await out('favicon-192.png', sharp(square).resize(192, 192).png({ compressionLevel: 9, palette: true, quality: 92 }));

await out('apple-touch-icon.png',
  sharp({ create: { width: 180, height: 180, channels: 4, background: NAVY } })
    .composite([{ input: await sharp(square).resize(152, 152).png().toBuffer(), gravity: 'center' }])
    .png({ compressionLevel: 9 })
);

// games corner logo (tools/source/games-logo.png, transparent): trimmed, 1x / 2x
const gamesLogo = await sharp(`${ROOT}tools/source/games-logo.png`).trim({ threshold: 1 }).png().toBuffer();

for (const width of [480, 960]) {
  await out(`games-logo-${width}.webp`, sharp(gamesLogo).resize({ width, kernel: 'lanczos3' }).webp({ quality: 86, alphaQuality: 92, effort: 6 }));
}


/* ---------- Open Graph image ---------- */

if (!process.argv.includes('--no-og')) {

  const puppeteer = (await import('puppeteer-core')).default;

  const chrome = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome'
  ].find(existsSync);

  if (!chrome) {
    throw new Error('Chrome/Edge not found; run with --no-og');
  }

  const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage();

  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  // fonts and logo inlined as data URLs so the template needs no server
  const dataUrl = (file, type) => `data:${type};base64,${readFileSync(file).toString('base64')}`;
  const html = readFileSync(`${ROOT}tools/og.html`, 'utf8')
    .replaceAll('{{CAIRO}}', dataUrl(`${ROOT}assets/fonts/cairo-arabic.woff2`, 'font/woff2'))
    .replaceAll('{{RUQAA}}', dataUrl(`${ROOT}assets/fonts/aref-ruqaa-arabic.woff2`, 'font/woff2'))
    .replaceAll('{{LOGO}}', dataUrl(`${ROOT}assets/img/logo-384.webp`, 'image/webp'));

  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(img => img.decode()));
  });

  const png = await page.screenshot({ type: 'png' });
  await browser.close();

  await out('og-image.png', sharp(png).png({ compressionLevel: 9, palette: true, quality: 90, effort: 10 }));

}

console.log(report.join('\n'));
