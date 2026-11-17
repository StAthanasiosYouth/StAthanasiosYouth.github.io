// W1: the family logo (tools/source/logo.png, 848 × 858, the largest original in the repo) traced to a real vector SVG.
// No redesign: every shape is traced from the pixels. Nothing is downloaded (no potrace/vtracer): this script does it.
//
//   1. upscale ×SCALE (Lanczos) so edges trace smooth;  2. quantize colours (k-means in Lab) → K flat colours;
//   3. clean speckles (3×3 majority, then merge regions < MIN px into their neighbour);
//   4. "stacked" layers: colours sorted by area, layer i = every pixel of colour rank ≥ i (no hairline gaps);
//   5. trace each layer's boundary on the pixel lattice, simplify (Douglas–Peucker), smooth to cubic Béziers,
//      keeping sharp corners sharp;  6. write SVG (one <path> per colour, named groups), viewBox = the PNG's pixels.
//
// Usage: node docs/daily-bread/w1/tools/vectorize-family.mjs [K=56] [SCALE=4] [HARD px=2] [SOFT px=50] [SOFT_DE=12] [PASSES=0] [EPS=0.3]  (the W1 result)
//   → docs/daily-bread/w1/identity/family/family-logo.svg  (+ quantized.png: what the tracer saw)
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', '..');
const OUT = join(HERE, '..', 'identity', 'family');
mkdirSync(OUT, { recursive: true });
const MOD = [join(ROOT, 'tools'), 'D:/private_projects/athanasios-links/tools'].find(d => existsSync(join(d, 'node_modules', 'sharp')));
const sharp = createRequire(join(MOD, 'package.json'))('sharp');

const K = +(process.argv[2] || 56);
const SCALE = +(process.argv[3] || 4);
const HARD = Math.round(+(process.argv[4] || 2) * SCALE * SCALE);   // specks under this (original px) always merge
const SOFT = Math.round(+(process.argv[5] || 50) * SCALE * SCALE);  // under this, merge only into a near colour
const SOFT_DE = +(process.argv[6] || 12);                          // «near» = ΔE under this (eyes, cracks, reins stay)
const MIN = HARD;
const BLUR = 0;
const EPS = +(process.argv[8] || 0.3) * SCALE;     // Douglas–Peucker tolerance (original px × SCALE)
const SRC = join(ROOT, 'tools/source/logo.png');

const meta = await sharp(SRC).metadata();
const W0 = meta.width, H0 = meta.height, W = W0 * SCALE, H = H0 * SCALE;
const { data } = await sharp(SRC).ensureAlpha().resize(W, H, { kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true });
const N = W * H;

/* ---------- sRGB → Lab ---------- */
const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const LUT = new Float64Array(256).map((_, i) => lin(i));
function lab(r, g, b) {
  const R = LUT[r], G = LUT[g], B = LUT[b];
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, y = R * 0.2126 + G * 0.7152 + B * 0.0722, z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  x = f(x); y = f(y); z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const L = new Float32Array(N * 3), opaque = new Uint8Array(N);
for (let i = 0; i < N; i++) {
  if (data[i * 4 + 3] < 128) continue;
  opaque[i] = 1;
  const v = lab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  L[i * 3] = v[0]; L[i * 3 + 1] = v[1]; L[i * 3 + 2] = v[2];
}

/* ---------- k-means (k-means++ seeding on a fixed sample, deterministic) ---------- */
let seed = 12345;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const idx = [];
for (let i = 0; i < N; i++) if (opaque[i]) idx.push(i);
const sample = [];
for (let s = 0; s < 90000; s++) sample.push(idx[Math.floor(rnd() * idx.length)]);
const C = [];
C.push([...L.subarray(sample[0] * 3, sample[0] * 3 + 3)]);
const d2 = (i, c) => { const a = L[i * 3] - c[0], b = L[i * 3 + 1] - c[1], e = L[i * 3 + 2] - c[2]; return a * a + b * b + e * e; };
while (C.length < K) {
  const ds = sample.map(i => Math.min(...C.map(c => d2(i, c))));
  const tot = ds.reduce((a, b) => a + b, 0);
  let t = rnd() * tot, k = 0;
  while (t > ds[k]) t -= ds[k++];
  C.push([...L.subarray(sample[k] * 3, sample[k] * 3 + 3)]);
}
for (let it = 0; it < 18; it++) {
  const acc = C.map(() => [0, 0, 0, 0]);
  for (const i of sample) {
    let best = 0, bd = Infinity;
    for (let k = 0; k < K; k++) { const v = d2(i, C[k]); if (v < bd) { bd = v; best = k; } }
    const a = acc[best]; a[0] += L[i * 3]; a[1] += L[i * 3 + 1]; a[2] += L[i * 3 + 2]; a[3]++;
  }
  acc.forEach((a, k) => { if (a[3]) C[k] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
}
/* every pixel → nearest centre; the centre's colour = the mean sRGB of its pixels (true colours, not Lab round-trip) */
const lab2 = new Int16Array(N).fill(-1);
const rgbAcc = C.map(() => [0, 0, 0, 0]);
for (let i = 0; i < N; i++) {
  if (!opaque[i]) continue;
  let best = 0, bd = Infinity;
  for (let k = 0; k < K; k++) { const v = d2(i, C[k]); if (v < bd) { bd = v; best = k; } }
  lab2[i] = best;
}

/* ---------- clean: 3×3 majority (2 passes), then merge small regions ---------- */
function majority(src) {
  const out = new Int16Array(src);
  const cnt = new Int32Array(K);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x; if (src[i] < 0) continue;
    const seen = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const l = src[i + dy * W + dx]; if (l >= 0) { if (!cnt[l]) seen.push(l); cnt[l]++; } }
    let best = src[i], bc = cnt[best] || 0;
    for (const l of seen) { if (cnt[l] > bc) { bc = cnt[l]; best = l; } }
    if (bc >= 5) out[i] = best;
    for (const l of seen) cnt[l] = 0;
  }
  return out;
}
const PASSES = +(process.argv[7] || 0);              // 3×3 majority passes (each one erodes 1 px lines)
let lbl = lab2;
for (let k = 0; k < PASSES; k++) lbl = majority(lbl);
function mergeSmall(src) {
  const comp = new Int32Array(N).fill(-1);
  const stack = new Int32Array(N);
  let merged = 0;
  for (let s = 0; s < N; s++) {
    if (src[s] < 0 || comp[s] >= 0) continue;
    const l = src[s]; let sp = 0, n = 0; const px = [];
    stack[sp++] = s; comp[s] = s;
    const nb = new Map();
    while (sp) {
      const i = stack[--sp]; px.push(i); n++;
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const j = Y * W + X;
        if (src[j] === l) { if (comp[j] < 0) { comp[j] = s; stack[sp++] = j; } }
        else if (src[j] >= 0) nb.set(src[j], (nb.get(src[j]) || 0) + 1);
      }
    }
    if (n < SOFT && nb.size) {
      let best = -1, bc = 0;
      for (const [k, v] of nb) {
        const ok = n < HARD || Math.hypot(C[k][0] - C[l][0], C[k][1] - C[l][1], C[k][2] - C[l][2]) < SOFT_DE;
        if (ok && v > bc) { bc = v; best = k; }
      }
      if (best >= 0) { for (const i of px) src[i] = best; merged++; }
    }
  }
  return merged;
}
for (let p = 0; p < 6; p++) if (!mergeSmall(lbl)) break;
for (let i = 0; i < N; i++) { const l = lbl[i]; if (l < 0) continue; const a = rgbAcc[l]; a[0] += data[i * 4]; a[1] += data[i * 4 + 1]; a[2] += data[i * 4 + 2]; a[3]++; }
const used = rgbAcc.map((a, k) => ({ k, n: a[3], rgb: a[3] ? [a[0] / a[3], a[1] / a[3], a[2] / a[3]].map(Math.round) : [0, 0, 0] })).filter(c => c.n > 0).sort((a, b) => b.n - a.n);
const rank = new Int16Array(K).fill(-1);
used.forEach((c, r) => { rank[c.k] = r; });
const hex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');

// what the tracer saw (review)
const q = Buffer.alloc(W0 * H0 * 4);
for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) {
  const i = (y * SCALE + (SCALE >> 1)) * W + x * SCALE + (SCALE >> 1), o = (y * W0 + x) * 4, l = lbl[i];
  if (l >= 0) { const c = used[rank[l]].rgb; q[o] = c[0]; q[o + 1] = c[1]; q[o + 2] = c[2]; q[o + 3] = 255; }
}
await sharp(q, { raw: { width: W0, height: H0, channels: 4 } }).png().toFile(join(OUT, 'quantized.png'));

/* ---------- tracing ---------- */
function trace(mask) {
  // directed boundary edges on the pixel-corner lattice, interior on the right (clockwise, y down)
  const VW = W + 1;
  const out = new Map(); // vertex → [dir…]
  const add = (x, y, dir) => { const v = y * VW + x; const a = out.get(v); if (a) a.push(dir); else out.set(v, [dir]); };
  const at = (x, y) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!mask[y * W + x]) continue;
    if (!at(x, y - 1)) add(x, y, 0);           // top: → right
    if (!at(x + 1, y)) add(x + 1, y, 1);       // right: ↓ down
    if (!at(x, y + 1)) add(x + 1, y + 1, 2);   // bottom: ← left
    if (!at(x - 1, y)) add(x, y + 1, 3);       // left: ↑ up
  }
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
  const loops = [];
  for (const [v0] of out) {
    while (out.has(v0) && out.get(v0).length) {
      let v = v0, dir = out.get(v0)[0];
      const pts = [];
      let guard = 0;
      while (true) {
        const list = out.get(v);
        if (!list || !list.length) break;
        let pick = list.indexOf((dir + 1) & 3);           // right turn first (keeps diagonal touches apart)
        if (pick < 0) pick = list.indexOf(dir);
        if (pick < 0) pick = list.indexOf((dir + 3) & 3);
        if (pick < 0) pick = 0;
        const nd = list[pick]; list.splice(pick, 1); if (!list.length) out.delete(v);
        if (nd !== dir || !pts.length) pts.push([v % VW, (v / VW) | 0]);
        dir = nd;
        v = (((v / VW) | 0) + DY[nd]) * VW + (v % VW) + DX[nd];
        if (v === v0 && (!out.get(v) || !out.get(v).length)) break;
        if (v === v0) { /* back at start with more edges: close this loop */ break; }
        if (++guard > 4e6) break;
      }
      if (pts.length >= 3) loops.push(pts);
    }
  }
  return loops;
}

/* staircase → straight runs: a point on every corner midpoint, then Douglas–Peucker */
function dp(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let md = 0, mi = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, ll = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / ll; if (d > md) { md = d; mi = i; } }
    if (md > eps) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function smoothLoop(raw) {
  // corner midpoints remove the 1 px stair; keep true corners (two long sides) as corners
  const n = raw.length, mids = [];
  for (let i = 0; i < n; i++) { const a = raw[i], b = raw[(i + 1) % n]; mids.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); }
  // split the closed loop at its two farthest points for DP
  let far = 0, fd = 0;
  for (let i = 1; i < mids.length; i++) { const d = Math.hypot(mids[i][0] - mids[0][0], mids[i][1] - mids[0][1]); if (d > fd) { fd = d; far = i; } }
  const A = dp(mids.slice(0, far + 1), EPS), B = dp(mids.slice(far).concat([mids[0]]), EPS);
  const p = A.slice(0, -1).concat(B.slice(0, -1));
  if (p.length < 3) return '';
  const m = p.length, f = v => (Math.round(v / SCALE * 10) / 10);
  const sharpAt = i => {
    const a = p[(i - 1 + m) % m], b = p[i], c = p[(i + 1) % m];
    const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
    const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / ((Math.hypot(...v1) * Math.hypot(...v2)) || 1);
    return cos > -0.35; // interior angle under ≈ 110°: a real corner
  };
  const S = p.map((_, i) => sharpAt(i));
  let d = `M${f(p[0][0])},${f(p[0][1])}`;
  for (let i = 0; i < m; i++) {
    const p0 = p[(i - 1 + m) % m], p1 = p[i], p2 = p[(i + 1) % m], p3 = p[(i + 2) % m];
    if (S[i] && S[(i + 1) % m]) { d += `L${f(p2[0])},${f(p2[1])}`; continue; }
    const t = 1 / 6;
    const c1 = S[i] ? p1 : [p1[0] + (p2[0] - p0[0]) * t, p1[1] + (p2[1] - p0[1]) * t];
    const c2 = S[(i + 1) % m] ? p2 : [p2[0] - (p3[0] - p1[0]) * t, p2[1] - (p3[1] - p1[1]) * t];
    d += `C${f(c1[0])},${f(c1[1])} ${f(c2[0])},${f(c2[1])} ${f(p2[0])},${f(p2[1])}`;
  }
  return d + 'Z';
}

const mask = new Uint8Array(N);
let pathCount = 0;
// stacked: layer r = every pixel of colour rank ≥ r (its own and every colour drawn above it)
const order = [];
for (let r = used.length - 1; r >= 0; r--) {
  for (let i = 0; i < N; i++) if (lbl[i] >= 0 && rank[lbl[i]] === r) mask[i] = 1;
  const loops = trace(mask);
  const d = loops.map(smoothLoop).filter(Boolean).join('');
  pathCount += loops.length;
  order.unshift({ r, d, color: hex(used[r].rgb), share: used[r].n / idx.length });
}
const groups = order.map(o => `  <path id="c${String(o.r + 1).padStart(2, '0')}" fill="${o.color}" fill-rule="evenodd" d="${o.d}"/>`).join('\n');
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W0} ${H0}" width="${W0}" height="${H0}">
  <title>شعار أسرة البابا أثناسيوس الرسولي للشباب — كنيسة أبي سيفين بسفاجا (فيكتور متتبَّع من tools/source/logo.png)</title>
  <desc>Auto-traced from the 848 × 858 original: ${used.length} flat colours, stacked layers (each colour covers the ones above it, so no gaps). No redesign.</desc>
${groups}
</svg>
`;
writeFileSync(join(OUT, 'family-logo.svg'), svg);
writeFileSync(join(OUT, 'family-logo.svgz'), (await import('node:zlib')).gzipSync(svg, { level: 9 }));
console.log(`K=${K} scale=${SCALE}: ${used.length} colours, ${pathCount} contours, ${Math.round(svg.length / 1024)} KB`);
