// Builds the images of the service's emails (worker/src/notify/templates.js,
// the «Azure Crest» design) into assets/email/, served from the public site:
//
//   header.jpg    1200x640  the header artwork: the blue gradient, two soft
//                           waves and the gold line (shown at 600px, anchored
//                           to the bottom; solid navy when images are off)
//   logo.png      148x148   the family logo on a white disc with a gold ring
//   s-*.png       72x72     Facebook / Instagram / TikTok / website, white on blue
//   i-*.png                 small icons: WhatsApp, mail, lock, check, shield, clock
//
// Everything is drawn at 2x for sharp phones. Re-run after a design change:
//   node build-mail-assets.mjs

import sharp from 'sharp';
import { mkdirSync, statSync } from 'node:fs';
import * as si from 'simple-icons';
import { ROOT } from './lib/gs.mjs';

const OUT = `${ROOT}assets/email/`;
mkdirSync(OUT, { recursive: true });

const png = (svg, name) => sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: true, quality: 90, effort: 10 }).toFile(OUT + name)
  .then(() => console.log(name.padEnd(14), statSync(OUT + name).size, 'B'));
const glyph = (d, size, color, at) => `<g transform="translate(${at},${at}) scale(${size / 24})"><path d="${d}" fill="${color}"/></g>`;
const stroke = (inner, size, color, at, w = 1.8) => `<g transform="translate(${at},${at}) scale(${size / 24})" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`;

/* ---------- header: 600x320 at 2x; the gold line sits 30–86px above the bottom (just over the card) ---------- */
const H = 320;
const arcY = y => H - 86 + y;
const header = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="640" viewBox="0 0 600 ${H}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#061A44"/><stop offset=".46" stop-color="#0D3F98"/><stop offset=".86" stop-color="#1A7FD0"/><stop offset="1" stop-color="#3BB0E4"/></linearGradient></defs>
<rect width="600" height="${H}" fill="url(#g)"/>
<circle cx="-10" cy="-60" r="250" fill="#fff" fill-opacity=".07"/>
<circle cx="640" cy="${H + 110}" r="210" fill="#04143C" fill-opacity=".32"/>
<path d="M-15 ${arcY(8)} C 150 ${arcY(62)}, 380 ${arcY(14)}, 615 ${arcY(48)}" fill="none" stroke="#E2BE6A" stroke-opacity=".85" stroke-width="1.4"/>
</svg>`;
await sharp(Buffer.from(header)).jpeg({ quality: 84, mozjpeg: true }).toFile(OUT + 'header.jpg');
console.log('header.jpg'.padEnd(14), statSync(OUT + 'header.jpg').size, 'B');

/* ---------- logo on a white disc, gold ring ---------- */
const disc = `<svg xmlns="http://www.w3.org/2000/svg" width="148" height="148"><circle cx="74" cy="74" r="72" fill="#fff" stroke="#D4AF5A" stroke-width="3"/></svg>`;
const logo = await sharp(`${ROOT}assets/img/logo-512.png`).resize(132, 132).toBuffer();
await sharp(Buffer.from(disc)).composite([{ input: logo, top: 8, left: 8 }]).png({ compressionLevel: 9, palette: true, quality: 92, effort: 10 }).toFile(OUT + 'logo.png');
console.log('logo.png'.padEnd(14), statSync(OUT + 'logo.png').size, 'B');

/* ---------- social: white glyph on a royal → azure disc ---------- */
const blueDisc = inner => `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#1259C3"/><stop offset="1" stop-color="#1E8FD6"/></linearGradient></defs><circle cx="36" cy="36" r="36" fill="url(#b)"/>${inner}</svg>`;
const globe = '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>';
await png(blueDisc(glyph(si.siFacebook.path, 34, '#fff', 19)), 's-facebook.png');
await png(blueDisc(glyph(si.siInstagram.path, 32, '#fff', 20)), 's-instagram.png');
await png(blueDisc(glyph(si.siTiktok.path, 32, '#fff', 20)), 's-tiktok.png');
await png(blueDisc(stroke(globe, 34, '#fff', 19)), 's-website.png');

/* ---------- small icons ---------- */
const box = (w, inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${w}">${inner}</svg>`;
await png(box(32, glyph(si.siWhatsapp.path, 28, '#4ADE80', 2)), 'i-whatsapp.png');
await png(box(32, stroke('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M4 7l8 6 8-6"/>', 28, '#EAF2FC', 2)), 'i-mail.png');
await png(box(108, `<defs><linearGradient id="l" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#E6F1FD"/><stop offset="1" stop-color="#DDF2FB"/></linearGradient></defs>
<circle cx="54" cy="54" r="52" fill="url(#l)" stroke="#CFE4F7" stroke-width="2"/>` +
  stroke('<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>', 44, '#1259C3', 32) +
  `<circle cx="54" cy="60.5" r="2.6" fill="#1259C3"/>`), 'i-lock.png');
await png(box(112, `<defs><linearGradient id="c" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0E8A5F"/><stop offset="1" stop-color="#22B07C"/></linearGradient></defs>
<circle cx="56" cy="56" r="56" fill="#E3F6EE"/><circle cx="56" cy="56" r="46" fill="url(#c)"/>` + stroke('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 52, '#fff', 30, 2.4)), 'i-check.png');
await png(box(36, stroke('<path d="M12 3l7 3v6c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>', 34, '#1259C3', 1)), 'i-shield.png');
await png(box(32, stroke('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 30, '#B88A2E', 1, 2)), 'i-clock.png');
