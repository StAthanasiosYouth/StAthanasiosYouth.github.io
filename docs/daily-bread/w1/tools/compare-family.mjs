// W1: how close is the traced family logo to the PNG?  Renders identity/family/family-logo.svg in Chrome at the PNG's
// own size, measures the colour difference per pixel (CIE76 ΔE in Lab) and writes a review sheet: the whole logo side by
// side + zoomed crops of the hardest parts (face, ring lettering, the Greek name, the horse, the feather).
// Needs docs/daily-bread/tools/static.mjs on 4340.   Usage: node docs/daily-bread/w1/tools/compare-family.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', '..');
const DIR = join(HERE, '..', 'identity', 'family');
const MOD = [join(ROOT, 'tools'), 'D:/private_projects/athanasios-links/tools'].find(d => existsSync(join(d, 'node_modules', 'sharp')));
const req = createRequire(join(MOD, 'package.json'));
const sharp = req('sharp'), puppeteer = req('puppeteer-core');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const SRC = join(ROOT, 'tools/source/logo.png');
const { width: W, height: H } = await sharp(SRC).metadata();

async function render(scale) {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true });
  const p = await b.newPage();
  await p.setViewport({ width: Math.max(W * scale, 800), height: Math.max(H * scale, 600) });
  await p.goto('http://localhost:4340/docs/daily-bread/w1/tools/blank.html');
  await p.setContent(`<html><body style="margin:0;background:transparent"><img src="http://localhost:4340/docs/daily-bread/w1/identity/family/family-logo.svg?${Date.now()}" style="display:block;width:${W * scale}px;height:${H * scale}px"></body></html>`, { waitUntil: 'networkidle0' });
  const buf = await p.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: W * scale, height: H * scale } });
  await b.close();
  return buf;
}
const svgPng = await render(1);
const A = await sharp(SRC).ensureAlpha().raw().toBuffer();
const B = await sharp(svgPng).ensureAlpha().raw().toBuffer();

const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
function lab(r, g, b) {
  const R = lin(r), G = lin(g), Bl = lin(b);
  let x = (R * 0.4124 + G * 0.3576 + Bl * 0.1805) / 0.95047, y = R * 0.2126 + G * 0.7152 + Bl * 0.0722, z = (R * 0.0193 + G * 0.1192 + Bl * 0.9505) / 1.08883;
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  x = f(x); y = f(y); z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
let n = 0, sum = 0, over10 = 0, over20 = 0;
const heat = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) {
  if (A[i * 4 + 3] < 200) continue;
  const a = lab(A[i * 4], A[i * 4 + 1], A[i * 4 + 2]), b = B[i * 4 + 3] < 128 ? [0, 0, 0] : lab(B[i * 4], B[i * 4 + 1], B[i * 4 + 2]);
  const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  n++; sum += d; if (d > 10) over10++; if (d > 20) over20++;
  const v = Math.min(255, d * 8);
  heat[i * 4] = v; heat[i * 4 + 1] = 0; heat[i * 4 + 2] = 255 - v; heat[i * 4 + 3] = 255;
}
const stats = { meanDeltaE: +(sum / n).toFixed(2), over10: +(100 * over10 / n).toFixed(2) + '%', over20: +(100 * over20 / n).toFixed(2) + '%', svgKB: Math.round(readFileSync(join(DIR, 'family-logo.svg')).length / 1024) };
writeFileSync(join(DIR, 'compare.json'), JSON.stringify(stats, null, 1) + '\n');
console.log(stats);

/* the review sheet: PNG | SVG, then the crops zoomed ×3 (PNG on the right, SVG on the left: Arabic reading order) */
const big = await render(3);
const CROPS = [['الوش', 290, 165, 110, 110], ['الكتابة على الحلقة', 360, 40, 200, 90], ['الاسم اليوناني', 296, 520, 52, 120], ['الفارس والحصان', 555, 225, 150, 150], ['الريشة والدواية', 560, 430, 130, 270]];
const parts = [];
const bg = { r: 2, g: 9, b: 20, alpha: 1 };
const whole = 600;
parts.push({ input: await sharp(SRC).resize(whole).toBuffer(), left: whole + 40, top: 20 });
parts.push({ input: await sharp(svgPng).resize(whole).toBuffer(), left: 20, top: 20 });
let y = whole * H / W + 50;
for (const [, x, cy, w, h] of CROPS) {
  const z = Math.min(3, 560 / w);
  const s = Math.round(w * z), t = Math.round(h * z);
  parts.push({ input: await sharp(SRC).extract({ left: x, top: cy, width: w, height: h }).resize(s, t, { kernel: 'nearest' }).toBuffer(), left: whole + 40, top: Math.round(y) });
  parts.push({ input: await sharp(big).extract({ left: x * 3, top: cy * 3, width: w * 3, height: h * 3 }).resize(s, t).toBuffer(), left: 20, top: Math.round(y) });
  y += t + 30;
}
await sharp({ create: { width: whole * 2 + 60, height: Math.round(y), channels: 4, background: bg } }).composite(parts).webp({ quality: 88 }).toFile(join(DIR, 'compare.webp'));
await sharp(heat, { raw: { width: W, height: H, channels: 4 } }).png().toFile(join(DIR, 'difference.png'));
