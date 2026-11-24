// P4 — the album crops from the faces (p4/faces.json) for the admin's 3:4 frames (AdminStyles .sa-cropper__frame), the way
// the owner set the Virgin Mary by hand (x 29.8, y 0, z 1.1): most of the picture, a small zoom, the head never cut.
// The admin draws a crop as object-fit: cover + object-position x% y% + scale(z) around that same point (applyCrop), so
// the image window seen is [p − p·s/z, p + (1 − p)·s/z] on each axis (s = the part of the axis the cover fit shows).
//   node docs/daily-bread/saints/p4/tools/crops.mjs [--sheet out.jpg]  → writes crops into p4/pictures.json
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const F = JSON.parse(readFileSync(join(HERE, '..', 'faces.json'), 'utf8'));
const DATA = JSON.parse(readFileSync(join(HERE, '..', 'pictures.json'), 'utf8'));
const FRAME = 3 / 4;

export function cropFor([fx, top, fh], w, h) {
  const a = w / h;
  const sx = a > FRAME ? FRAME / a : 1, sy = a > FRAME ? 1 : a / FRAME;
  // zoom only for a small face (whole figures): the face ~11% of the window's height, never under 1.1 or over 1.8
  const z = Math.min(1.8, Math.max(1.1, 0.11 * sy / Math.max(fh, 0.01)));
  const vx = sx / z, vy = sy / z;
  const axis = (start, v) => (v >= 1 ? 50 : Math.round(Math.min(100, Math.max(0, (start / (1 - v)) * 100)) * 10) / 10);
  const tY = Math.min(Math.max(0, top - 0.03), 1 - vy);
  const tX = Math.min(Math.max(0, fx - vx / 2), 1 - vx);
  return { x: axis(tX, vx), y: axis(tY, vy), z: Math.round(z * 100) / 100 };
}

let n = 0;
for (const p of DATA.pictures) {
  if (F.keep[p.key]) { p.crop = F.keep[p.key]; p.cropAuto = false; continue; }
  const f = F.faces[p.key];
  if (!f) continue;
  p.crop = cropFor(f, p.orig.w, p.orig.h);
  p.cropAuto = false; p.cropFrom = 'faces';
  n++;
}
writeFileSync(join(HERE, '..', 'pictures.json'), JSON.stringify(DATA, null, 1) + '\n');
console.log(n + ' crops from faces');
