// Builds the scenes' real material (assets/media/xp/) from the service's own
// published designs, and writes the manifest the scenes read
// (assets/js/xp/library.js). Dev-only; the sources live on the author's
// machine (E: weekly posters, F: game-segment exports), read-only.
//
//   cd tools && node build-xp-media.mjs
//
// Privacy: only finished, published material: the weekly posters, and the
// game segments' own title cards / graphics (no close-ups, no raw footage,
// no phone numbers). Clips are silent, ~4 s, 360x640 H.264 (landscape
// sources sit on a blurred fill, the reel look), preload none on the site.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { ROOT } from './lib/gs.mjs';

const POSTERS_SRC = 'E:/اجتماع الشباب/';
const GAMES_SRC = 'F:/Adobe/فيديوهات فقرات ألعاب الأجتماع/';
const OUT = `${ROOT}assets/media/xp/`;
const TMP = `${ROOT}tools/.cache/xp-media/`;

/* the weekly posters (newest first): date, file, topic, guest (as printed) */
const POSTERS = [
  ['2026-10-04', '2026-10-4/بوستر.png', 'Why me?', ''],
  ['2026-09-27', '2026-9-27/بوستر.png', 'اتخاذ القرار', 'م/ أرمانيوس عزيز'],
  ['2026-09-20', '2026-9-20/بوستر.png', 'حياة التسليم', 'أبونا أنطوني عياد'],
  ['2026-09-13', '2026-9-13/بوستر.png', 'اللسان والإدانة', ''],
  ['2026-09-06', '2026-9-6/بوستر.png', 'الانطوائية', ''],
  ['2026-08-09', '2026-8-9/poster.png', 'القلق والخوف', ''],
  ['2026-08-02', '2026-8-2/بوستر.png', 'الثبات الروحي', ''],
  ['2026-07-26', '2026-7-26/بوستر.png', 'اكتشاف الذات', ''],
  ['2026-07-12', '2026-7-12/بوستر.png', 'الصداقة', 'أبونا أنجيلوس'],
  ['2026-07-05', '2026-7-5/بوستر.png', 'الصلاة', '']
];

/* game segments: [id, source, [[from, to]…], landscape?, poster at (s), caption] */
const CLIPS = [
  ['saboona', 'لعبة الصابونة و المصاصة/فيديو.mp4', [[2.4, 6.4]], true, 2.6, 'تحدي المصاصة والصابونة'],
  ['asela', 'أسئلة سريعة/أسئلة سريعة.mp4', [[87.3, 91.1]], false, 2.4, 'أسئلة سريعة'],
  ['timer', 'لعبة الTimer/Firefly Animate this image without changing, rewriting, regenerating, or moving any text.__Important.mp4', [[0.2, 4.6]], true, 1.6, 'لعبة الـTimer'],
  ['khamen', 'خمن الورقة/final bromo.mp4', [[0.9, 4.6], [37.7, 39.3]], true, 3.2, 'خمن الورقة'],
  ['metgawzeen', 'لعبة المتجوزين/final bromo.mp4', [[38.3, 42.2]], true, 1.9, 'لعبة المتجوزين'],
  ['sot', 'قلد الصوت/قلد صوت.mp4', [[202.1, 205.7]], false, 2.6, 'قلد الصوت']
];

const ff = args => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'pipe' });
const kb = file => Math.round(statSync(file).size / 102.4) / 10;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}posters`, { recursive: true });
mkdirSync(`${OUT}clips`, { recursive: true });
mkdirSync(TMP, { recursive: true });

const posters = [];
for (const [date, file, topic, guest] of POSTERS) {
  const src = POSTERS_SRC + file;
  if (!existsSync(src)) throw new Error(`missing ${src}`);
  const meta = await sharp(src).metadata();
  const wide = meta.width > meta.height;
  const [w, h] = wide ? [480, Math.round(480 * meta.height / meta.width)] : [360, Math.round(360 * meta.height / meta.width)];
  const out = `${OUT}posters/${date}.webp`;
  let quality = 64;
  do {
    await sharp(src).resize(w, h).webp({ quality, effort: 6 }).toFile(out);
    quality -= 6;
  } while (statSync(out).size > 40 * 1024 && quality > 30);
  posters.push({ src: `assets/media/xp/posters/${date}.webp`, w, h, date, topic, ...(guest ? { guest } : {}) });
  console.log(`poster ${date} ${topic}: ${w}x${h} ${kb(out)} KB`);
}

const clips = [];
for (const [id, file, parts, landscape, posterAt, caption] of CLIPS) {
  const src = GAMES_SRC + file;
  if (!existsSync(src)) throw new Error(`missing ${src}`);
  const out = `${OUT}clips/${id}.mp4`;
  // each part trimmed, joined, then framed 360x640 at 24 fps
  const trims = parts.map(([a, b], i) => `[0:v]trim=${a}:${b},setpts=PTS-STARTPTS,fps=24[p${i}]`).join(';');
  const join = parts.length > 1 ? `${parts.map((_, i) => `[p${i}]`).join('')}concat=n=${parts.length}:v=1:a=0[v]` : '[p0]null[v]';
  const frame = landscape
    ? '[v]split[a][b];[a]scale=360:640:force_original_aspect_ratio=increase,crop=360:640,boxblur=18:2,eq=brightness=-0.12:saturation=1.1[bg];[b]scale=360:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[o]'
    : '[v]scale=360:640:force_original_aspect_ratio=increase,crop=360:640,format=yuv420p[o]';
  let crf = 29;
  do {
    ff(['-i', src, '-filter_complex', `${trims};${join};${frame}`, '-map', '[o]', '-an', '-c:v', 'libx264', '-profile:v', 'main', '-preset', 'slow', '-crf', String(crf), '-maxrate', '700k', '-bufsize', '1400k', '-movflags', '+faststart', out]);
    crf += 2;
  } while (statSync(out).size > 300 * 1024 && crf < 40);
  const png = `${TMP}${id}.png`;
  ff(['-ss', String(posterAt), '-i', out, '-frames:v', '1', png]);
  const still = `${OUT}clips/${id}.webp`;
  await sharp(png).webp({ quality: 60, effort: 6 }).toFile(still);
  const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString().trim());
  clips.push({ id, src: `assets/media/xp/clips/${id}.mp4`, poster: `assets/media/xp/clips/${id}.webp`, w: 360, h: 640, duration: Math.round(duration * 10) / 10, caption });
  console.log(`clip ${id}: ${kb(out)} KB + poster ${kb(still)} KB, ${duration.toFixed(1)} s`);
}

const total = [...posters.map(p => p.src), ...clips.flatMap(c => [c.src, c.poster])].reduce((s, f) => s + statSync(ROOT + f).size, 0);
console.log(`total ${Math.round(total / 1024)} KB`);

const manifest = `/**
 * The scenes' real material (generated by tools/build-xp-media.mjs: do
 * not edit by hand). The service's own published weekly posters and short
 * silent moments of its game segments, optimised and kept in the repo.
 * Loaded with the scenes only; the files themselves load when a scene
 * shows them (videos: preload none, only while their scene is open).
 */

export const POSTERS = ${JSON.stringify(posters, null, 2)};

export const CLIPS = ${JSON.stringify(clips, null, 2)};
`;

writeFileSync(`${ROOT}assets/js/xp/library.js`, manifest.replace(/"([a-z]+)":/g, '$1:'));
readFileSync(`${ROOT}assets/js/xp/library.js`, 'utf8');
