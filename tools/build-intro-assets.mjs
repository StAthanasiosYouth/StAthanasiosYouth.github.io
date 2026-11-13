// The intro's pictures (site redesign W3, approved S1): the card, the church, the two saints → small WebP files in
// assets/img/intro/. (The gate's moving wall: tools/build-gate-world.mjs.)
// Run: cd tools && node build-intro-assets.mjs <folder with the approved S1 PNGs (docs/site-redesign/assets on the design branch)>

import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { ROOT } from './lib/gs.mjs';

const SRC = process.argv[2];
if (!SRC) throw new Error('give the folder with card-front.png, card-back.png, bg-phone.png, saint-*.png');
const OUT = join(ROOT, 'assets/img/intro');
mkdirSync(OUT, { recursive: true });

const jobs = [
  // the card is seen up to ~1500px wide on a big screen; 1134 is its own size
  ['card-front.png', 'card-front.webp', { width: 1134, quality: 74 }],
  ['card-back.png', 'card-back.webp', { width: 1134, quality: 74 }],
  // the church: dimmed and blurred on screen, so a soft copy is enough
  ['bg-phone.png', 'church.webp', { width: 1134, quality: 58 }],
  ['saint-athanasius.png', 'saint-athanasius.webp', { width: 259, quality: 80, alpha: true }],
  ['saint-sefein.png', 'saint-sefein.webp', { width: 258, quality: 80, alpha: true }]
];

for (const [from, to, o] of jobs) {
  await sharp(join(SRC, from)).resize({ width: o.width }).webp({ quality: o.quality, alphaQuality: o.alpha ? 85 : 100, effort: 6 }).toFile(join(OUT, to));
}

for (const f of ['card-front', 'card-back', 'church', 'saint-athanasius', 'saint-sefein']) {
  console.log(f, Math.round(statSync(join(OUT, f + '.webp')).size / 1024) + ' KB');
}
