// The gate's world (site redesign W3, owner 2026-11-13: «اقعد حوالي 4 دقائق من غير ما ألاقي تكرار»):
// the meeting's own EDITED videos and posters only (owner: never raw footage) as one wall of tiles flowing from the top-left to the bottom-right, where every tile
// plays a chain of different moments (7–11 s each, cross-faded), so for about four minutes nothing comes back.
//   · the whole film loops with no cut: the rows are rings that travel one ring per 14 s (17 rings = the film),
//     and every tile's last moment cross-fades into its first;
//   · each moment is used once while the footage lasts; when it runs out, a moment comes back only after
//     2 minutes or more (round the loop too), and framed differently;
//   · the same video is kept out of the rows next to it at the same time;
//   · no colour bars, no screen that is mostly one pure colour (the purple and green cards), nothing dark or blank.
// Steps: scan every video (4 frames a second) → cut the clean stretches into moments → plan the tiles → render
// each tile's chain (small, lossless enough) → compose the moving wall → one MP4 per screen shape.
// Run: cd tools && node build-gate-world.mjs <videos.json: the edited videos and the posters, .png = a slow zoom> [--wide]
//   → assets/img/intro/gate-world.mp4 (portrait) / gate-world-wide.mp4

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from './lib/gs.mjs';

const files = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const WIDE = process.argv.includes('--wide');
const OUT = join(ROOT, `assets/img/intro/gate-world${WIDE ? '-wide' : ''}.mp4`);
const CACHE = join(ROOT, 'tools/.cache/gate-world');
mkdirSync(CACHE, { recursive: true });

const FPS = 20;
const TW = 300, TH = 188, GAP = 14, PW = TW + GAP, PH = TH + GAP;
const K = 5, ROWS = 6, N = K * ROWS;          // tiles per ring (one ring ≈ the screen's width, so no footage is spent off screen), rings
const L = 14;                                  // one ring of travel, s (the flow's speed)
let T = L * 17;                                // the film: at most 238 s ≈ 4 minutes; shorter if the footage would repeat
const XF = 0.8;                                // cross-fade between moments in a tile
const ANGLE = 22;
const OW = WIDE ? 1280 : 960, OH = WIDE ? 720 : 960;
const SCAN = 4;                                // frames a second when scanning

const run = (args, opts = {}) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { maxBuffer: 1 << 28, ...opts });
const isImage = f => /\.(png|jpe?g|webp)$/i.test(f);
const dur = f => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());

/* ---------- one frame, 8 × 8: is it a moment worth showing? ---------- */
function hueOf(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx - mn < 1) return 0;
  return Math.round(mx === r ? ((g - b) / (mx - mn) + 6) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4) % 6;
}
function frameOk(px) {
  let sum = 0, sq = 0, pure = 0;
  const buckets = new Array(6).fill(0);
  for (let k = 0; k < px.length; k += 3) {
    const r = px[k], g = px[k + 1], b = px[k + 2];
    for (const v of [r, g, b]) { sum += v; sq += v * v; }
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx > 150 && mn < 100 && mx - mn > 100) { pure++; buckets[hueOf(r, g, b)]++; }
  }
  const n = px.length, mean = sum / n, sd = Math.sqrt(sq / n - mean * mean), cells = px.length / 3;
  if (mean < 10 || mean > 220 || sd < 8) return false;                               // dark, white, blank
  if (pure >= cells * 0.3 && buckets.filter(c => c >= 2).length >= 3) return false;  // colour bars
  if (Math.max(...buckets) >= cells * 0.4) return false;                             // mostly one pure colour (purple / green cards)
  return true;
}

/* ---------- 1. scan: the clean stretches of every video ---------- */
function scan(f, i) {
  const cache = join(CACHE, `scan-${i}.json`);
  if (existsSync(cache)) { const c = JSON.parse(readFileSync(cache, 'utf8')); if (c.file === f) return c.runs; }
  const raw = run(['-i', f, '-vf', `fps=${SCAN},scale=8:8:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const ok = [];
  for (let o = 0; o + 192 <= raw.length; o += 192) ok.push(frameOk(raw.subarray(o, o + 192)));
  // clean stretches, a little trimmed at both ends (no cut caught at the edge)
  const runs = [];
  let s = -1;
  ok.push(false);
  ok.forEach((v, k) => {
    if (v && s < 0) s = k;
    if (!v && s >= 0) { const a = s / SCAN + 0.4, b = k / SCAN - 0.4; if (b - a >= 4) runs.push([a, b]); s = -1; }
  });
  writeFileSync(cache, JSON.stringify({ file: f, runs }));
  return runs;
}

/* ---------- 2. moments: the stretches cut into 7–11 s pieces ---------- */
const rnd = (() => { let x = 2026; return () => (x = (x * 16807) % 2147483647) / 2147483647; })();
const moments = [];
files.forEach((f, vi) => {
  if (isImage(f)) {
    for (const d of [8 + rnd() * 2, 8 + rnd() * 2]) moments.push({ vi, file: f, at: 0, d, uses: 0, times: [], image: true });
    return;
  }
  const len = dur(f);
  for (const [a0, b0] of scan(f, vi)) {
    const a = Math.max(a0, len * 0.02), b = Math.min(b0, len - 0.3);
    let t = a;
    while (b - t >= 4) {
      const want = 7 + rnd() * 4;
      const d = Math.min(want, b - t);
      if (d < 4) break;
      moments.push({ vi, file: f, at: t, d, uses: 0, times: [] });
      t += d + 0.5;
    }
  }
});
{
  const sigCache = join(CACHE, 'sigs.json');
  const sigs = existsSync(sigCache) ? JSON.parse(readFileSync(sigCache, 'utf8')) : {};
  const sigOf = m => {
    const key = m.file + '@' + m.at.toFixed(2);
    if (!sigs[key]) {
      const parts = [];
      for (const k of [0.2, 0.5, 0.8]) {
        const raw = run([...(m.image ? [] : ['-ss', (m.at + m.d * k).toFixed(2)]), '-i', m.file, '-frames:v', '1', '-vf', 'scale=12:8:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
        parts.push(...raw);
        if (m.image) break;
      }
      sigs[key] = parts;
    }
    return sigs[key];
  };
  const kept = [];
  var groups = [];
  const like = (a, b) => { const n = Math.min(a.length, b.length); let d = 0; for (let i = 0; i < n; i++) d += Math.abs(a[i] - b[i]); return d / n < 12; };
  for (const m of moments) {
    m.sig = sigOf(m);
    // a poster's second (closer) look is meant to be like its first
    const twin = m.image ? null : kept.find(k => like(k.sig.slice(0, 288), m.sig.slice(0, 288)) && like(k.sig.slice(-288), m.sig.slice(-288)));
    m.group = twin ? twin.group : groups.length;
    if (!twin) groups.push({ uses: 0, times: [] });
    kept.push(m);
  }
  writeFileSync(sigCache, JSON.stringify(sigs));
  console.log('look-alike groups', groups.length, 'of', moments.length, 'moments');
}
const footage = moments.reduce((a, m) => a + m.d, 0);
T = L * 15;   // 3½ minutes: a moment, or anything that looks like it, comes back only half a film later (≥ 100 s)
const AGAIN = T / 2 - 5;
console.log('videos', files.length, 'moments', moments.length, 'footage', Math.round(footage) + ' s', 'film', T + ' s', 'needed', Math.round(N * (T + XF)), 'tile-s');

/* ---------- 3. the plan: what each tile plays, in time ---------- */
// the frame variants for a moment shown again: the whole picture, then a closer look at its left, its right
const VARIANTS = ['whole', 'left', 'right', 'centre'];
const slots = Array.from({ length: N }, () => ({ items: [], t: 0 }));
const rowOf = s => Math.floor(s / K);
const playing = (s, t0, t1) => slots[s].items.filter(it => it.start < t1 && it.start + it.d > t0);
// fill the tiles in time order, the emptiest first
while (slots.some(s => s.t < T + XF)) {
  const si = slots.reduce((best, s, i) => (s.t < slots[best].t ? i : best), 0);
  const slot = slots[si], t0 = slot.t;
  const near = [];
  for (let s = 0; s < N; s++) if (s !== si && Math.abs(rowOf(s) - rowOf(si)) <= 1) near.push(...playing(s, t0 - 2, t0 + 12).map(it => it.m.vi));
  const prev = slot.items.length ? slot.items[slot.items.length - 1].m.vi : -1;
  const recent = new Map();
  for (const sl of slots) for (const it of sl.items) if (it.start > t0 - 30) recent.set(it.m.vi, (recent.get(it.m.vi) || 0) + 1);
  let best = null, score = -Infinity;
  for (const m of moments) {
    const grp = groups[m.group];
    let used = m.uses * 5000;                      // a moment itself: once if at all possible
    let sc = -grp.uses * 1000 - used;             // looks not seen yet first
    // a look-alike: never on the wall at once, and not again within ~2 minutes (round the loop too)
    if (grp.times.some(u => { const g = Math.abs(t0 - u) % T; return Math.min(g, T - g) < AGAIN; })) sc -= 1e6;
    // never again within 2 minutes, counted round the film's loop too
    if (m.times.some(u => { const g = Math.abs(t0 - u) % T; return Math.min(g, T - g) < AGAIN; })) sc -= 1e6;
    if (near.includes(m.vi)) sc -= 400;            // not the same video in the rows beside it now
    if (m.vi === prev) sc -= 300;                  // not the same video twice in a row in one tile
    sc -= 250 * (recent.get(m.vi) || 0);           // a video seen a lot in the last 30 s waits (spread over the film)
    sc += rnd() * 50;                              // a little chance, so the wall is mixed
    if (sc > score) { score = sc; best = m; }
  }
  const variant = VARIANTS[best.uses % VARIANTS.length];
  slot.items.push({ m: best, start: t0, d: best.d, variant });
  best.uses++; best.times.push(t0); groups[best.group].uses++; groups[best.group].times.push(t0);
  slot.t = t0 + best.d - XF;
}
const reused = moments.filter(m => m.uses > 1).length, maxUse = Math.max(...moments.map(m => m.uses));
const unused = moments.filter(m => m.uses === 0).length;
console.log('plan: moments used once', moments.filter(m => m.uses === 1).length, 'again', reused, 'max uses', maxUse, 'unused', unused);
// the shortest gap between two showings of the same moment
let gap = Infinity;
for (const m of moments) {
  const ts = m.times;
  for (let a = 0; a < ts.length; a++) for (let b = a + 1; b < ts.length; b++) { const g = Math.abs(ts[a] - ts[b]) % T; gap = Math.min(gap, g, T - g); }
}
console.log('closest repeat of one moment', gap === Infinity ? 'none' : Math.round(gap) + ' s');
let ggap = Infinity, forced = 0;
for (const g of groups) for (let a = 0; a < g.times.length; a++) for (let b = a + 1; b < g.times.length; b++) { const d = Math.abs(g.times[a] - g.times[b]) % T; const c = Math.min(d, T - d); ggap = Math.min(ggap, c); if (c < AGAIN) forced++; }
if (process.argv.includes('--plan')) { const sz = new Map(); moments.forEach(m => sz.set(m.group, (sz.get(m.group) || 0) + 1)); const top = [...sz].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([g, n]) => n + '× ' + moments.find(m => m.group === g).file.split('/').slice(-2).join('/') + ' (shown ' + groups[g].uses + ')'); console.log('biggest look-alike groups: ' + top.join(' | ')); }
console.log('closest look-alike', ggap === Infinity ? 'none' : Math.round(ggap) + ' s', '| under', Math.round(AGAIN), 's:', forced);
if (process.argv.includes('--plan')) process.exit(0);

/* ---------- 4. each tile's chain, rendered small ---------- */
const look = v => ({
  whole: `scale=${TW}:${TH}:force_original_aspect_ratio=increase,crop=${TW}:${TH}`,
  left: `scale=${Math.round(TW * 1.35)}:${Math.round(TH * 1.35)}:force_original_aspect_ratio=increase,crop=${TW}:${TH}:0:(ih-${TH})/2`,
  right: `scale=${Math.round(TW * 1.35)}:${Math.round(TH * 1.35)}:force_original_aspect_ratio=increase,crop=${TW}:${TH}:iw-${TW}:(ih-${TH})/2`,
  centre: `scale=${Math.round(TW * 1.5)}:${Math.round(TH * 1.5)}:force_original_aspect_ratio=increase,crop=${TW}:${TH}`
})[v];
const PATTERN = [0, 1, 0, 2, 0, 1, 0, 0, 2, 1, 0, 2, 0, 1];
const dim = s => ['', ',eq=brightness=-0.03', ',eq=brightness=-0.08:saturation=0.9'][PATTERN[(s * 5 + rowOf(s) * 3) % PATTERN.length]];
slots.forEach((slot, si) => {
  const out = join(CACHE, `tile-${si}.mp4`);
  if (WIDE && existsSync(out)) return;          // the same tiles serve both shapes (the plan is the same: a fixed seed)
  const args = [];
  slot.items.forEach(it => (it.m.image
    ? args.push('-framerate', String(FPS), '-loop', '1', '-t', (it.d + 0.1).toFixed(2), '-i', it.m.file)
    : args.push('-ss', it.m.at.toFixed(2), '-t', (it.d + 0.1).toFixed(2), '-i', it.m.file)));
  const kb = it => {
    // a poster: a slow zoom in (or out, the second time) towards its middle
    const n = Math.round(it.d * FPS), z0 = it.variant === 'whole' ? 1 : 1.14, z1 = it.variant === 'whole' ? 1.14 : 1;
    return `scale=${TW * 2}:${TH * 2}:force_original_aspect_ratio=increase,crop=${TW * 2}:${TH * 2}:(iw-${TW * 2})/2:${it.variant === 'whole' ? '(ih-' + TH * 2 + ')/2' : '(ih-' + TH * 2 + ')/4'},zoompan=z='${z0}+(${z1 - z0})*on/${n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${TW}x${TH}:fps=${FPS}`;
  };
  const g = slot.items.map((it, i) => `[${i}:v]${it.m.image ? kb(it) : `fps=${FPS},${look(it.variant)}`},setsar=1,format=yuv420p,trim=duration=${it.d.toFixed(2)},setpts=PTS-STARTPTS[s${i}]`);
  // the chain: each moment fades into the next
  let last = 's0', acc = slot.items[0].d;
  for (let i = 1; i < slot.items.length; i++) {
    g.push(`[${last}][s${i}]xfade=transition=fade:duration=${XF}:offset=${(acc - XF).toFixed(3)}[c${i}]`);
    last = `c${i}`; acc += slot.items[i].d - XF;
  }
  // the seam: the end [T, T+XF) fades into the start [0, XF)
  g.push(`[${last}]trim=duration=${(T + XF).toFixed(3)},setpts=PTS-STARTPTS,split=3[a][b][c]`);
  g.push(`[a]trim=${XF}:${T},setpts=PTS-STARTPTS[body]`, `[b]trim=${T}:${T + XF},setpts=PTS-STARTPTS[tail]`, `[c]trim=0:${XF},setpts=PTS-STARTPTS[head]`);
  g.push(`[tail][head]xfade=transition=fade:duration=${XF}:offset=0[seam]`);
  g.push(`[seam][body]concat=n=2:v=1${dim(si)},pad=${PW}:${PH}:${GAP / 2}:${GAP / 2}:color=0x01050d[v]`);
  const graph = join(CACHE, `tile-${si}.txt`);
  writeFileSync(graph, g.join(';\n'));
  run([...args, '-/filter_complex', graph, '-map', '[v]', '-an', '-t', String(T), '-r', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', out]);
  if (si % 6 === 5) console.log('tiles', si + 1, '/', N);
});

/* ---------- 5. the wall: rings of tiles, tilted, flowing ---------- */
const RING = K * PW;
const args = [];
for (let si = 0; si < N; si++) args.push('-i', join(CACHE, `tile-${si}.mp4`));
const g = [];
for (let r = 0; r < ROWS; r++) {
  const ids = Array.from({ length: K }, (_, c) => r * K + c);
  g.push(`${ids.map(i => `[${i}:v]`).join('')}hstack=inputs=${K},split=2[r${r}a][r${r}b]`);
  const phase = ((r * 0.37) % 1) * RING;
  g.push(`[r${r}a][r${r}b]hstack=inputs=2,crop=${RING}:${PH}:x='${RING}-mod(${RING}*t/${L}+${phase.toFixed(1)}\\,${RING})':y=0[row${r}]`);
}
g.push(`${Array.from({ length: ROWS }, (_, r) => `[row${r}]`).join('')}vstack=inputs=${ROWS}[plane]`);
g.push(`[plane]rotate=${ANGLE}*PI/180:ow=${RING}:oh=${ROWS * PH}:c=0x01050d,crop=${Math.round(OW * (WIDE ? 1 : 0.95))}:${Math.round(OH * (WIDE ? 1 : 0.95))},scale=${OW}:${OH},format=yuv420p[v]`);
const graph = join(CACHE, `wall-${WIDE ? 'w' : 't'}.txt`);
writeFileSync(graph, g.join(';\n'));
run([...args, '-/filter_complex', graph, '-map', '[v]', '-an', '-t', String(T), '-r', String(FPS),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '36', '-maxrate', WIDE ? '900k' : '800k', '-bufsize', '1800k', '-profile:v', 'main', '-g', String(FPS * 2), '-movflags', '+faststart', OUT], { stdio: 'inherit' });
console.log(OUT.split(/[\\/]/).pop(), Math.round(statSync(OUT).size / 1024) + ' KB', T + ' s');
