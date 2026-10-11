// Builds the ADMIN app's icons (admin/manifest.webmanifest, iOS, admin
// notifications) — a variant of the site's icon that is easy to tell apart
// on a home screen: the same logo on GOLD (the site's is on navy), with a
// navy gear badge.
//   admin/icon-192.png, icon-512.png    "any": install, notifications
//   admin/icon-maskable-512.png         logo + badge inside the 80 % safe zone (Android adaptive icons)
//   admin/apple-touch-icon.png          180 px, opaque (iOS «إضافة إلى الشاشة الرئيسية»)
//   admin/favicon-32.png                the admin tab
//
// The public icons (tools/build-pwa-icons.mjs, assets/img/) are not touched.
// Usage: cd tools && node build-admin-icons.mjs

import sharp from 'sharp';
import { statSync } from 'node:fs';
import { ROOT } from './lib/gs.mjs';

const SRC = `${ROOT}tools/source/logo.png`;
const OUT = `${ROOT}admin/`;
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

/* a gold field: light at the top, deeper at the bottom */
const field = size => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#f2d28b"/><stop offset=".55" stop-color="#d7aa50"/><stop offset="1" stop-color="#a87a2e"/>
  </linearGradient></defs>
  <rect width="${size}" height="${size}" fill="url(#g)"/>
</svg>`);

/* the badge: a navy disc with a gold gear (the admin's own "gear" icon) */
const badge = size => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${size}" height="${size}">
  <circle cx="24" cy="24" r="22.5" fill="${NAVY}" stroke="#f2d28b" stroke-width="3"/>
  <g transform="translate(12 12)" fill="none" stroke="#f2d28b" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3.2"/>
    <path d="M12 2.5v3M12 18.5v3M4.2 6.5l2.6 1.5M17.2 16l2.6 1.5M4.2 17.5l2.6-1.5M17.2 8l2.6-1.5"/>
    <circle cx="12" cy="12" r="6.5"/>
  </g>
</svg>`);

/*
 * The logo (`ratio` of the side) on gold, the badge (`badgeRatio`) with its
 * center at `at` (fraction of the side, from the top-left).
 */
async function icon(size, ratio, badgeRatio, at) {

  const inner = Math.round(size * ratio);
  const b = Math.round(size * badgeRatio);
  const center = Math.round(size * at);
  const logo = await sharp(square).resize(inner, inner, { kernel: 'lanczos3' }).png().toBuffer();
  const mark = await sharp(badge(b)).resize(b, b).png().toBuffer();

  return sharp(field(size))
    .composite([
      { input: logo, gravity: 'center' },
      { input: mark, left: center - Math.round(b / 2), top: center - Math.round(b / 2) }
    ])
    .flatten({ background: '#d7aa50' })
    .png({ compressionLevel: 9, palette: true, quality: 92, effort: 10 });

}

const files = {
  'icon-192.png': await icon(192, 0.84, 0.34, 0.8),
  'icon-512.png': await icon(512, 0.84, 0.34, 0.8),
  // Android crops to a circle (or a squircle) inside the middle 80 %: all of it in there
  'icon-maskable-512.png': await icon(512, 0.68, 0.22, 0.7),
  'apple-touch-icon.png': await icon(180, 0.84, 0.34, 0.8),
  'favicon-32.png': await icon(32, 0.9, 0.5, 0.74)
};

for (const [name, pipeline] of Object.entries(files)) {
  await pipeline.toFile(OUT + name);
  console.log(`admin/${name.padEnd(22)} ${(statSync(OUT + name).size / 1024).toFixed(1)} KB`);
}
