#!/usr/bin/env node
/*
 * «خبزنا اليومي» — the saints registry (daily-bread/saints/registry.json): check it, see a month, see every picture.
 *
 *   npm run saints-check                      the file is right: every day has a source, every picture exists
 *   node bread-saints.mjs month 2026-12       the feasts of a month (what the monthly suggestion will take)
 *   node bread-saints.mjs sheet               tools/.cache/saints-sheet.html: every picture next to its name, to check by eye
 *
 * To add a person: copy one entry in registry.json, give it a new id, its days (coptic "M-D" from the synaxarium, or
 * gregorian "MM-DD" for a modern event) each with its source link, then run `npm run saints-check`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, check, feastsOfMonth } from './lib/saints.mjs';
import { MONTHS } from './lib/coptic.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const reg = load();
const [cmd = 'check', arg] = process.argv.slice(2);

if (cmd === 'check') {
  const errs = check(reg);
  for (const e of errs) console.error('✗ ' + e);
  const n = reg.people.length;
  const noPic = reg.people.filter(p => !p.image).length, noPraise = reg.people.filter(p => !p.praise).length;
  console.log(`${n} اسم، ${reg.people.reduce((a, p) => a + p.feasts.length, 0)} يوم. من غير صورة: ${noPic}. من غير تمجيد: ${noPraise}.`);
  if (errs.length) { console.error(`${errs.length} مشكلة.`); process.exit(1); }
  console.log('✓ الملف سليم.');
} else if (cmd === 'month') {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(arg || '')) { console.error('month YYYY-MM'); process.exit(2); }
  for (const f of feastsOfMonth(reg, arg)) {
    console.log(`${f.date}  ${f.coptic.d} ${MONTHS[f.coptic.m - 1]}  ${f.feast.kind} ${f.person.name}${f.others.length ? '  (+ ' + f.others.join('، ') + ')' : ''}`);
  }
} else if (cmd === 'sheet') {
  const cells = reg.people.map(p => {
    const im = p.image;
    const pic = im ? `<img src="../../${esc(im.file)}" alt="">` : '<div class="none">مفيش صورة</div>';
    const meta = im ? `<small>${esc(im.license)} · <a href="${esc(im.source)}">المصدر</a>${im.checked ? ' · ✓ اتشافت' : ''}</small>` : '';
    return `<figure>${pic}<figcaption><b>${esc(p.name)}</b><br>${meta}</figcaption></figure>`;
  }).join('\n');
  const html = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>صور القديسين</title><style>
body{font:14px system-ui;margin:16px;background:#f4f4f4}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}
figure{margin:0;background:#fff;border-radius:8px;padding:8px;text-align:center}img{width:100%;height:220px;object-fit:contain;background:#eee}
.none{height:220px;display:grid;place-items:center;background:#fdd;color:#900}small{color:#555}</style><main>${cells}</main></html>`;
  const out = path.join(ROOT, 'tools', '.cache', 'saints-sheet.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  console.log(out);
} else {
  console.error('check | month YYYY-MM | sheet');
  process.exit(2);
}
