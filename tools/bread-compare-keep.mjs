// «خبزنا اليومي» W5: keeps the side-by-side comparisons (tools/.cache/bread-compare/, from bread-compare.mjs) in the
// record as WebP: docs/daily-bread/w5/compare/<state>-<size>.webp (left W1, right the real page) + an index page.
//   node tools/bread-compare-keep.mjs
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { ROOT } from './lib/gs.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const sharp = require('sharp');
const IN = `${ROOT}tools/.cache/bread-compare/`;
const OUT = `${ROOT}docs/daily-bread/w5/compare/`;
mkdirSync(OUT, { recursive: true });
// the record keeps the two sizes W1 was shot at (390, 1440); all six are in the run's cache
const files = readdirSync(IN).filter(f => /-(390|1440).png$/.test(f)).sort();
for (const f of files) {
  const img = sharp(IN + f);
  const { width } = await img.metadata();
  await img.resize({ width: Math.min(width, 1800) }).webp({ quality: 72 }).toFile(OUT + f.replace(/\.png$/, '.webp'));
}
const rows = files.map(f => f.replace(/\.png$/, '')).map(n => `<figure><figcaption>${n}</figcaption><img loading="lazy" src="${n}.webp" alt="${n}"></figure>`).join('\n');
writeFileSync(OUT + 'index.html', `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>W5 — المقارنة بـW1</title>
<style>body{margin:0;padding:16px;background:#0b1220;color:#eee;font-family:system-ui}figure{margin:0 0 28px}figcaption{font:600 14px system-ui;margin-bottom:6px;direction:ltr;text-align:left}img{max-width:100%;border:1px solid #333}</style></head>
<body><h1>خبزنا اليومي — W5: الشمال صورة W1، اليمين الصفحة الحقيقية</h1>
${rows}
</body></html>
`);
console.log(files.length, 'kept in', OUT);
