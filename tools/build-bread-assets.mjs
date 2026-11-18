// «خبزنا اليومي» W5: the page's pictures and sound, made from the approved W1 identity (docs/daily-bread/w1/).
//
//   assets/img/bread/logo-b.svg        logo B for the intro (inlined by assets/js/bread/intro.js). The family seal is
//                                      no longer a base64 PNG inside the file: it points at family-seal.webp (W1
//                                      PROGRESS: «اللوجو في الانترو ... يشاور على صورة الختم (webp)»), 290 KB → ~40 KB.
//   assets/img/bread/family-seal.webp  the seal (152 px, 2x of its 76-unit box in a ≈ 560 px stage)
//   assets/img/bread/logo-b-512.webp   logo B as a picture (<img>: the signature, «المحتوى خلص»)
//   assets/img/bread/mark-192.png      mark C (the top bar, the home card, the share image); PNG for notifications
//   assets/img/bread/mark-96.webp      mark C for the top bar / home card (2x of 38–64 px)
//   assets/media/bread/intro-a.m4a     sound A «فجر» (decision 3), + .opus
//
// Usage: cd tools && node build-bread-assets.mjs
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { ROOT } from './lib/gs.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const W1 = `${ROOT}docs/daily-bread/w1/`;
const IMG = `${ROOT}assets/img/bread/`;
const MEDIA = `${ROOT}assets/media/bread/`;
mkdirSync(IMG, { recursive: true });
mkdirSync(MEDIA, { recursive: true });

let svg = readFileSync(`${W1}identity/svg/logo-b-family.svg`, 'utf8');
const m = /xlink:href="data:image\/png;base64,([A-Za-z0-9+/=]+)"/.exec(svg);
if (!m) throw new Error('logo-b-family.svg: no embedded seal');
await sharp(Buffer.from(m[1], 'base64')).resize(152, 152).webp({ quality: 88 }).toFile(`${IMG}family-seal.webp`);
svg = svg.replace(m[0], 'xlink:href="/assets/img/bread/family-seal.webp"');
writeFileSync(`${IMG}logo-b.svg`, svg);

await sharp(`${W1}identity/png/logo-b-family-1024.png`).resize(512, 512).webp({ quality: 86 }).toFile(`${IMG}logo-b-512.webp`);
copyFileSync(`${W1}identity/png/icon-192.png`, `${IMG}mark-192.png`);
await sharp(`${W1}identity/png/icon-192.png`).resize(128, 128).webp({ quality: 90 }).toFile(`${IMG}mark-128.webp`);
for (const ext of ['m4a', 'opus']) copyFileSync(`${W1}sound/intro-a.${ext}`, `${MEDIA}intro-a.${ext}`);

for (const f of ['logo-b.svg', 'family-seal.webp', 'logo-b-512.webp', 'mark-192.png', 'mark-128.webp']) console.log(f, (readFileSync(IMG + f).length / 1024).toFixed(1), 'KB');
