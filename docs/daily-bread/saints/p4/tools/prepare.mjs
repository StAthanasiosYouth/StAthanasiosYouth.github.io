// P4 — prepare every album picture the way the media library stores it (admin IMAGE pipeline, AdminScript.html):
// WEBP, a card copy + the 480 small copy + a 160 tiny copy + the placeholder colour. READ ONLY on the owner's folder.
//   node docs/daily-bread/saints/p4/tools/prepare.mjs [outDir]
// outDir (default D:/private_projects/khobzna-work/p4-pictures) is OUTSIDE the repo: nothing is imported before the
// owner approves the review page. Writes <outDir>/<person>-<n>{,-480,-160}.webp and docs/daily-bread/saints/p4/pictures.json.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = normalize(join(HERE, '..', '..', '..', '..', '..'));
const OUT = process.argv[2] || 'D:/private_projects/khobzna-work/p4-pictures';
const MOD = [join(ROOT, 'tools'), 'D:/private_projects/athanasios-links/tools'].find(d => existsSync(join(d, 'node_modules', 'sharp')));
const sharp = createRequire(join(MOD, 'package.json'))('sharp');
const { load, picturesDir } = await import(pathToFileURL(join(ROOT, 'tools/lib/saints.mjs')).href);
const plan = JSON.parse(await readFile(join(HERE, '..', 'plan.json'), 'utf8'));

// card: the site's feast card is max 420 css px tall (bread.css) → 840 long side = a 2x screen.
// 60–90 KB target (owner), a quality ladder like the admin's encode(), never below 70. Never enlarged.
// The AI paintings carry a fine paint grain (gold grounds) that WEBP pays for: when the ladder still ends over the
// target, a light median(3) smooths the grain (faces and lines stay) and the ladder runs again (`smooth: true`).
const SIZES = {
  card: { side: 840, target: 90 * 1024, ladder: [84, 80, 76, 72, 70], smooth: [80, 76, 72] },
  thumb: { side: 480, target: 40 * 1024, ladder: [84, 80, 76, 72] },
  tiny: { side: 160, target: 12 * 1024, ladder: [72, 64, 56] }
};

async function encode(input, { side, target, ladder, smooth }) {
  const run = async (qs, med) => {
    let best;
    for (const q of qs) {
      let s = sharp(input).rotate().flatten({ background: '#ffffff' })
        .resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true, kernel: 'lanczos3' });
      if (med) s = s.median(3);
      const { data, info } = await s.webp({ quality: q, effort: 6, smartSubsample: true }).toBuffer({ resolveWithObject: true });
      best = { data, w: info.width, h: info.height, q, smooth: med };
      if (data.length <= target) break;
    }
    return best;
  };
  const plain = await run(ladder, false);
  if (plain.data.length <= target || !smooth) return plain;
  const soft = await run(smooth, true);
  return soft.data.length < plain.data.length ? soft : plain;
}

// the admin's dominantColor(): mean of a 12×12, saturation × 1.25
async function colour(input) {
  const { data } = await sharp(input).flatten({ background: '#ffffff' }).resize(12, 12, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 3) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
  r /= n; g /= n; b /= n;
  const m = (r + g + b) / 3;
  const hex = v => ('0' + Math.max(0, Math.min(255, Math.round(m + (v - m) * 1.25))).toString(16)).slice(-2);
  return '#' + hex(r) + hex(g) + hex(b);
}

// a suggested crop for the admin's square frames (P3 crop { x, y, z }): sharp's attention strategy, z = 1
async function suggestCrop(input, w, h) {
  const s = Math.min(w, h);
  const { info } = await sharp(input).resize(s, s, { fit: 'cover', position: sharp.strategy.attention }).toBuffer({ resolveWithObject: true });
  const left = -(info.cropOffsetLeft || 0), top = -(info.cropOffsetTop || 0);
  const x = w > s ? Math.round(((left + s / 2) / w) * 100) : 50;
  const y = h > s ? Math.round(((top + s / 2) / h) * 100) : 50;
  return { x, y, z: 1 };
}

const reg = load();
const PICS = picturesDir(reg);
if (!PICS) throw new Error('pictures folder not found');
await mkdir(OUT, { recursive: true });
const rows = [];
for (const p of reg.people) {
  const album = p.album || [];
  for (let i = 0; i < album.length; i++) {
    const a = album[i];
    const key = p.id + '-' + (i + 1);
    const pl = (plan.items && plan.items[a.src]) || {};
    const input = await readFile(join(PICS, a.src));
    const meta = await sharp(input).metadata();
    const card = await encode(input, SIZES.card);
    const thumb = await encode(input, SIZES.thumb);
    const tiny = await encode(input, SIZES.tiny);
    await writeFile(join(OUT, key + '.webp'), card.data);
    await writeFile(join(OUT, key + '-480.webp'), thumb.data);
    await writeFile(join(OUT, key + '-160.webp'), tiny.data);
    const crop = pl.crop || await suggestCrop(input, meta.width, meta.height);
    rows.push({
      key, person: p.id, name: p.name, cat: p.cat, class: p.class, src: a.src,
      type: pl.type || a.type, main: pl.main != null ? pl.main : album.length === 1,
      stage: pl.stage || '', occasion: pl.occasion || '', ask: pl.ask || '', flags: pl.flags || [],
      source: pl.source || plan.defaults[pl.type || a.type].source, terms: pl.terms || plan.defaults[pl.type || a.type].terms,
      crop, cropAuto: !pl.crop,
      orig: { w: meta.width, h: meta.height, kb: Math.round(input.length / 1024) },
      card: { w: card.w, h: card.h, kb: +(card.data.length / 1024).toFixed(1), q: card.q, smooth: card.smooth },
      thumb: { w: thumb.w, h: thumb.h, kb: +(thumb.data.length / 1024).toFixed(1), q: thumb.q },
      tiny: { w: tiny.w, h: tiny.h, kb: +(tiny.data.length / 1024).toFixed(1) },
      color: await colour(input)
    });
    process.stdout.write('.');
  }
}
for (const src of Object.keys(plan.items || {})) if (!rows.some(r => r.src === src)) throw new Error('plan.json item not in any album: ' + src);
const persons = reg.people.map(p => ({ id: p.id, name: p.name, cat: p.cat, class: p.class, feasts: (p.feasts || []).map(f => f.kind) }));
await writeFile(join(HERE, '..', 'pictures.json'), JSON.stringify({ made: new Date().toISOString(), out: OUT, categories: reg.categories, persons, pending: plan.pending || [], pictures: rows }, null, 1) + '\n');
console.log('\n' + rows.length + ' pictures → ' + OUT);
