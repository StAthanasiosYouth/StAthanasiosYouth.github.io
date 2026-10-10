// Builds the icons the web app manifest and push notifications use:
//   assets/img/icon-192.png, icon-512.png   the logo on navy ("any": install, notifications)
//   assets/img/icon-maskable-512.png        the logo inside the 80 % safe zone (Android adaptive icons)
//   assets/img/push-badge.png               96 px white bell on transparent: Android's
//                                           status-bar badge (only the alpha channel is used)
//
// Usage: cd tools && npm run pwa-icons

import sharp from 'sharp';
import { statSync } from 'node:fs';
import { ROOT } from './lib/gs.mjs';

const SRC = `${ROOT}tools/source/logo.png`;
const OUT = `${ROOT}assets/img/`;
const NAVY = '#061a31';

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

/* the logo, `ratio` of the side, centered on navy */
async function onNavy(size, ratio) {
  const inner = Math.round(size * ratio);
  return sharp({ create: { width: size, height: size, channels: 4, background: NAVY } })
    .composite([{ input: await sharp(square).resize(inner, inner, { kernel: 'lanczos3' }).png().toBuffer(), gravity: 'center' }])
    .png({ compressionLevel: 9, palette: true, quality: 92, effort: 10 });
}

const BADGE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="96" height="96">
  <path fill="#fff" d="M12 2.2a1.1 1.1 0 0 1 1.1 1.1v.75A6.6 6.6 0 0 1 18.6 10.6v5.2l1.75 2.35a.8.8 0 0 1-.64 1.28H4.29a.8.8 0 0 1-.64-1.28L5.4 15.8v-5.2a6.6 6.6 0 0 1 5.5-6.55v-.75A1.1 1.1 0 0 1 12 2.2Z"/>
  <path fill="#fff" d="M9.6 20.6h4.8a2.4 2.4 0 0 1-4.8 0Z"/>
</svg>`;

const files = {
  'icon-192.png': await onNavy(192, 0.86),
  'icon-512.png': await onNavy(512, 0.86),
  'icon-maskable-512.png': await onNavy(512, 0.76),
  'push-badge.png': sharp(Buffer.from(BADGE)).resize(96, 96).png({ compressionLevel: 9 })
};

for (const [name, pipeline] of Object.entries(files)) {
  await pipeline.toFile(OUT + name);
  console.log(`${name.padEnd(24)} ${(statSync(OUT + name).size / 1024).toFixed(1)} KB`);
}
