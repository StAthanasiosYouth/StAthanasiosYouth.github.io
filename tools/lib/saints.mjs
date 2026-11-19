/*
 * «خبزنا اليومي» — the fixed saints registry (daily-bread/saints/registry.json), read once a month by
 * tools/bread-takla.mjs. No name matching, no search: who, which days, which picture and which praise are written
 * in the file by hand and checked here (owner, 2026-11-19).
 *
 * A feast is { kind, coptic: 'M-D' } (1 توت … 13 النسيء, turned into a Gregorian date by code) or
 * { kind, gregorian: 'MM-DD' } (modern events not in the synaxarium), and always a `source` link.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { daysOfMonth, monthDays } from './coptic.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REGISTRY = path.join(ROOT, 'daily-bread', 'saints', 'registry.json');
export const IMG_DIR = 'assets/img/saints/';

export function load(file = REGISTRY) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const URL_RE = /^https:\/\/[^\s<>"']+$/;

/* every problem in the registry, as plain sentences (empty = fine) */
export function check(reg, { root = ROOT } = {}) {
  const errs = [];
  if (!reg || reg.schema !== 1 || !Array.isArray(reg.people)) return ['الملف مش بالشكل المتوقع (schema 1, people[]).'];
  const cats = reg.categories || {};
  const ids = new Set();
  for (const p of reg.people) {
    const who = (p && p.id) || '?';
    const e = m => errs.push(`${who}: ${m}`);
    if (!p || typeof p.id !== 'string' || !/^[a-z0-9]+$/.test(p.id)) { e('id لازم حروف إنجليزي صغيرة وأرقام بس.'); continue; }
    if (ids.has(p.id)) e('id متكرر.');
    ids.add(p.id);
    if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 120) e('الاسم فاضي أو طويل.');
    if (!cats[p.cat]) e(`المجموعة «${p.cat}» مش في categories.`);
    if (!Array.isArray(p.feasts) || !p.feasts.length) e('مفيش ولا يوم.');
    for (const f of p.feasts || []) {
      if (!f || typeof f.kind !== 'string' || !f.kind.trim()) e('يوم من غير نوع (kind).');
      if (!f || typeof f.source !== 'string' || !URL_RE.test(f.source)) e(`«${f && f.kind}»: المصدر لازم رابط https.`);
      const c = f && f.coptic, g = f && f.gregorian;
      if ((c == null) === (g == null)) { e(`«${f && f.kind}»: لازم coptic أو gregorian (واحد بس).`); continue; }
      if (c != null) {
        const m = /^(\d{1,2})-(\d{1,2})$/.exec(c);
        if (!m || +m[1] < 1 || +m[1] > 13 || +m[2] < 1 || +m[2] > (+m[1] === 13 ? 6 : 30)) e(`«${f.kind}»: اليوم القبطي «${c}» مش صح.`);
      } else {
        const m = /^(\d{2})-(\d{2})$/.exec(g);
        if (!m || isNaN(Date.parse(`2028-${g}T00:00:00Z`)) || new Date(`2028-${g}T00:00:00Z`).toISOString().slice(5, 10) !== g) e(`«${f.kind}»: اليوم الميلادي «${g}» مش صح.`);
      }
    }
    if (p.praise != null) {
      const q = p.praise;
      if (typeof q.text !== 'string' || !q.text.trim() || q.text.length > 1500) e('التمجيد: النص فاضي أو طويل (لحد ١٥٠٠ حرف).');
      if (typeof q.source !== 'string' || !URL_RE.test(q.source)) e('التمجيد: المصدر لازم رابط https.');
    }
    if (p.image != null) {
      const im = p.image;
      if (typeof im.file !== 'string' || !im.file.startsWith(IMG_DIR) || !/\.(webp|jpg|png)$/.test(im.file)) e(`الصورة لازم ملف تحت ${IMG_DIR}.`);
      else if (!fs.existsSync(path.join(root, im.file))) e(`الصورة ${im.file} مش موجودة.`);
      if (typeof im.source !== 'string' || !URL_RE.test(im.source)) e('الصورة: مصدرها لازم رابط https.');
      if (typeof im.license !== 'string' || !im.license.trim()) e('الصورة: الرخصة مش مكتوبة.');
    }
  }
  return errs;
}

/*
 * The feasts of a Gregorian month: [{ date, person, feast, others }] — one a day, the first in the registry's order
 * (the owner's order: St Mary and the angels first …); `others` = the other people on that day, for the admin.
 */
export function feastsOfMonth(reg, ym) {
  const out = [];
  for (const day of daysOfMonth(ym)) {
    const mmdd = day.date.slice(5);
    const hits = [];
    for (const p of reg.people) {
      for (const f of p.feasts) {
        let on = false;
        if (f.gregorian) on = f.gregorian === mmdd;
        else {
          const [m, d] = f.coptic.split('-').map(Number);
          // 6 النسيء in a year that has only 5 → kept on 5 النسيء
          on = day.m === m && (day.d === d || (m === 13 && d === 6 && day.d === 5 && monthDays(day.y, 13) === 5));
        }
        if (on) { hits.push({ person: p, feast: f }); break; }
      }
    }
    if (hits.length) out.push({ date: day.date, coptic: { m: day.m, d: day.d }, person: hits[0].person, feast: hits[0].feast, others: hits.slice(1).map(h => h.person.name) });
  }
  return out;
}
