// «خبزنا اليومي» W2 — builds docs/daily-bread/w2/review.html: 25 readings for a servant to compare with St-Takla.
//
//   node docs/daily-bread/w2/build-review.mjs
//
// Our text comes from assets/bible/vd (Public Domain Van Dyck). St-Takla gets a link to the same chapter only:
// nothing is fetched or copied from there.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseRef, checkRef, versesOf, taklaUrl } from '../../../assets/js/bread/refs.js';
import { stripTashkeel, agpeyaPsalm } from '../../../assets/js/bread/text.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OUT = fileURLToPath(new URL('./review.html', import.meta.url));

// written the way a servant would type them in the Excel template (short names, Arabic digits, ranges)
const READINGS = [
  'تك ١: ١-٥', 'خروج ١٤: ١٣-١٤', 'تث ٦: ٤-٩', 'راعوث ١: ١٦-١٧', '1صم ١٧: ٤٥-٤٧', 'أيوب ١٩: ٢٥-٢٧',
  'مزمور ٢٣: ١-٦', 'مز ٥١: ١-١٢', 'أم ٣: ١-٨', 'إش ٥٢: ١٣ - ٥٣: ٦', 'إرميا ٣١: ٣١-٣٤', 'دانيال ٣: ١٦-١٨', 'يونان ١: ١٧ - ٢: ٢',
  'مت ٥: ٤٣ - ٦: ٤', 'مر ١٠: ١٣-١٦', 'لو ١٥: ١١-٢٤', 'يو ٦: ٣٢-٣٥', 'أع ٢: ١-٤', 'رو ٨: ٢٨-٣٩', '1كو ١٣: ١-١٣',
  'غل ٥: ٢٢-٢٣', 'في ٤: ٤-٩', 'عب ١١: ١-٦', '1يو ٤: ٧-١٢', 'رؤ ٢١: ١-٥'
];

const ar = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const books = new Map();
const bookOf = code => books.get(code) || books.set(code, JSON.parse(readFileSync(`${ROOT}assets/bible/vd/${code}.json`, 'utf8'))).get(code);
const source = JSON.parse(readFileSync(`${ROOT}assets/bible/vd/SOURCE.json`, 'utf8'));

const NT = new Set(['MAT', 'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO', 'GAL', 'EPH', 'PHP', 'COL', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAS', '1PE', '2PE', '1JN', '2JN', '3JN', 'JUD', 'REV']);

const rows = READINGS.map((typed, i) => {
  const ref = parseRef(typed);
  if (!ref.ok) throw new Error(`${typed}: ${ref.error}`);
  const book = bookOf(ref.book);
  const check = checkRef(ref, book);
  if (!check.ok) throw new Error(`${typed}: ${check.error}`);
  const verses = versesOf(ref, book);
  const tags = [NT.has(ref.book) ? 'عهد جديد' : 'عهد قديم'];
  if (ref.ch2 !== ref.ch) tags.push('من أصحاح لأصحاح');
  let note = '';
  if (ref.psalm) {
    tags.push('مزمور');
    note = `<p class="note">ترقيم فاندايك. في الأجبية: <b>مزمور ${ar(agpeyaPsalm(ref.ch, ref.from))}</b>. لو رقم المزمور عند الأنبا تكلا مختلف، اكتبه في الملاحظات.</p>`;
  }
  const title = ref.psalm && ref.from === 1 && book.titles && book.titles[ref.ch]
    ? `<p class="ptitle" data-t="${esc(book.titles[ref.ch])}">${esc(book.titles[ref.ch])}</p>` : '';
  let lastCh = null;
  const text = verses.map(v => {
    const head = ref.ch2 !== ref.ch && v.ch !== lastCh ? `<span class="chap">أصحاح ${ar(v.ch)}</span>` : '';
    lastCh = v.ch;
    return `${head}<span class="v"><sup>${ar(v.v)}</sup><span data-t="${esc(v.text)}">${esc(v.text)}</span></span>`;
  }).join(' ');
  const links = [];
  for (let c = ref.ch; c <= ref.ch2; c++) {
    links.push(`<a href="${taklaUrl(ref.book, c)}" target="_blank" rel="noopener noreferrer">${esc(ref.psalm ? 'مزمور' : ref.name)} ${ar(c)} ↗</a>`);
  }
  return `
  <tr id="r${i + 1}">
    <td class="n">${ar(i + 1)}</td>
    <td class="ref"><b>${esc(ref.text)}</b><span class="typed">اتكتب كده: «${esc(typed)}»</span><span class="tags">${tags.map(t => `<i>${t}</i>`).join('')}</span><span class="count">${ar(verses.length)} عدد</span></td>
    <td class="text">${title}${text}${note}</td>
    <td class="link">${links.join('<br>')}</td>
    <td class="ok"><label><input type="checkbox" data-k="ok${i + 1}"> مطابق</label><textarea data-k="note${i + 1}" rows="2" placeholder="ملاحظات (لو فيه فرق: رقم العدد والكلمة)"></textarea></td>
  </tr>`;
}).join('');

const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>مراجعة نص فاندايك</title>
<style>
  :root { --ink: #1d2433; --muted: #5d6677; --line: #d9dce3; --paper: #fbf8f1; --navy: #1f2d4d; --ok: #2f7d4f; --bg: #f1f2f5; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.7 "Segoe UI", Tahoma, "Noto Naskh Arabic", "Amiri", serif; }
  header, main, footer { max-width: 1200px; margin: 0 auto; padding: 0 16px; }
  header { padding-top: 24px; }
  h1 { margin: 0 0 4px; font-size: 26px; color: var(--navy); }
  .lead { margin: 0 0 12px; color: var(--muted); }
  .how { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 12px 18px; margin: 12px 0; }
  .how ol { margin: 6px 0; padding-inline-start: 22px; }
  .bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 12px 0; }
  .bar button { font: inherit; border: 1px solid var(--navy); background: #fff; color: var(--navy); border-radius: 999px; padding: 4px 14px; cursor: pointer; }
  .bar button[aria-pressed="true"] { background: var(--navy); color: #fff; }
  .bar .progress { margin-inline-start: auto; color: var(--muted); }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
  th, td { border-bottom: 1px solid var(--line); padding: 10px; vertical-align: top; text-align: start; }
  th { background: var(--navy); color: #fff; font-weight: 600; position: sticky; top: 0; }
  td.n { width: 36px; color: var(--muted); }
  td.ref { width: 170px; }
  td.ref b { display: block; font-size: 17px; }
  .typed, .count { display: block; color: var(--muted); font-size: 13px; }
  .tags i { display: inline-block; font-style: normal; font-size: 12px; background: #eef1f7; color: var(--navy); border-radius: 999px; padding: 0 8px; margin: 4px 0 0 4px; }
  td.text { background: var(--paper); font-size: 19px; line-height: 2; font-family: "Amiri", "Noto Naskh Arabic", "Traditional Arabic", serif; }
  .v sup { color: #9a6b1f; font-size: 12px; margin-inline-end: 3px; font-family: "Segoe UI", Tahoma, sans-serif; }
  .chap { display: block; margin: 6px 0 2px; font: 600 14px "Segoe UI", Tahoma, sans-serif; color: var(--navy); }
  .ptitle { margin: 0 0 6px; font-size: 16px; color: var(--muted); }
  .note { margin: 8px 0 0; font: 13px/1.6 "Segoe UI", Tahoma, sans-serif; color: var(--muted); }
  td.link { width: 150px; white-space: nowrap; }
  td.link a { color: var(--navy); }
  td.ok { width: 190px; }
  td.ok label { display: flex; gap: 6px; align-items: center; font-weight: 600; color: var(--ok); }
  td.ok input { width: 20px; height: 20px; }
  td.ok textarea { width: 100%; margin-top: 6px; font: 13px "Segoe UI", Tahoma, sans-serif; border: 1px solid var(--line); border-radius: 8px; padding: 4px 6px; }
  tr.done td.n { color: var(--ok); font-weight: 700; }
  .sign { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px; margin: 18px 0; }
  .sign .fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
  .sign label { display: grid; gap: 4px; color: var(--muted); }
  .sign input { font: inherit; border: 0; border-bottom: 1px solid var(--ink); padding: 4px 2px; background: transparent; }
  footer { color: var(--muted); font-size: 13px; padding-bottom: 32px; }
  footer code { direction: ltr; unicode-bidi: embed; }
  @media (max-width: 760px) {
    table, tbody, tr, td { display: block; width: 100% !important; }
    thead { display: none; }
    tr { border-bottom: 6px solid var(--bg); }
    td { border: 0; }
    td.link { white-space: normal; }
  }
  @media print {
    body { background: #fff; font-size: 12px; }
    .bar, .how button { display: none; }
    th { position: static; }
    tr { break-inside: avoid; }
    td.text { font-size: 15px; }
  }
</style>
</head>
<body>
<header>
  <h1>مراجعة نص فاندايك — ٢٥ قراءة</h1>
  <p class="lead">«خبزنا اليومي» · موجة W2 · النص اللي هيظهر للمخدومين جنب لينك نفس الأصحاح على موقع الأنبا تكلا.</p>
  <div class="how">
    <b>المطلوب من الخادم:</b>
    <ol>
      <li>لكل قراءة: افتح لينك الأنبا تكلا، وقارن الكلام <b>عدد بعدد</b> (الكلام والترقيم، مش شكل الصفحة).</li>
      <li>لو مطابق علّم «مطابق». لو فيه فرق اكتب في الملاحظات رقم العدد والكلمة.</li>
      <li>التشكيل ممكن يختلف حاجات صغيرة بين النسخ؛ لو الفرق في التشكيل بس اكتبه برضه في الملاحظات، وزرار «من غير تشكيل» بيساعد تقارن الحروف.</li>
      <li>في الآخر اكتب اسمك والتاريخ ومضي، واطبع الصفحة (أو احفظها PDF) وابعتها.</li>
    </ol>
  </div>
  <div class="bar">
    <button type="button" id="tashkeel" aria-pressed="false">من غير تشكيل</button>
    <button type="button" onclick="print()">طباعة / PDF</button>
    <span class="progress" id="progress"></span>
  </div>
</header>
<main>
  <table>
    <thead><tr><th>#</th><th>القراءة</th><th>النص عندنا (فاندايك)</th><th>الأنبا تكلا</th><th>المراجعة</th></tr></thead>
    <tbody>${rows}
    </tbody>
  </table>
  <section class="sign">
    <b>توقيع المراجعة</b>
    <p>أنا قارنت الـ٢٥ قراءة اللي فوق بموقع الأنبا تكلا، واللي مش متعلّم عليه «مطابق» مكتوب فرقه في الملاحظات.</p>
    <div class="fields">
      <label>اسم الخادم <input data-k="sign-name" autocomplete="off"></label>
      <label>التاريخ <input data-k="sign-date" autocomplete="off"></label>
      <label>التوقيع <input data-k="sign-sig" autocomplete="off"></label>
    </div>
  </section>
</main>
<footer>
  <p>المصدر: ${esc(source.text)} — ${esc(source.license)} — <code>${esc(source.source.url)}</code> (eBible ${esc(source.source.ebibleGenerated || '')}، ملفات المصدر ${esc(source.source.sourceFilesDated || '')})،
  sha256 <code>${esc(source.source.sha256.slice(0, 16))}…</code>. النص اتبنى بـ<code>tools/build-bible.mjs</code> والصفحة دي بـ<code>docs/daily-bread/w2/build-review.mjs</code>.
  من موقع الأنبا تكلا لينكات بس، مفيش أي حاجة متنسوخة منه.</p>
</footer>
<script>
(() => {
  const KEY = 'bread-w2-review';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { saved = {}; }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) {} };
  const fields = document.querySelectorAll('[data-k]');
  const progress = () => {
    const boxes = document.querySelectorAll('td.ok input');
    let n = 0;
    boxes.forEach(b => { b.closest('tr').classList.toggle('done', b.checked); if (b.checked) n++; });
    document.getElementById('progress').textContent = 'مطابق: ' + n.toLocaleString('ar-EG') + ' من ' + boxes.length.toLocaleString('ar-EG');
  };
  fields.forEach(el => {
    const k = el.dataset.k;
    if (el.type === 'checkbox') el.checked = !!saved[k]; else if (saved[k]) el.value = saved[k];
    el.addEventListener('input', () => { saved[k] = el.type === 'checkbox' ? el.checked : el.value; save(); progress(); });
  });
  progress();
  // same rule as stripTashkeel() in assets/js/bread/text.js
  const strip = s => s.replace(/[\\u064B-\\u065F\\u0670\\u06D6-\\u06ED]/g, '').replace(/\\u0671/g, '\\u0627');
  const btn = document.getElementById('tashkeel');
  btn.addEventListener('click', () => {
    const off = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(off));
    btn.textContent = off ? 'بالتشكيل' : 'من غير تشكيل';
    document.querySelectorAll('[data-t]').forEach(el => { el.textContent = off ? strip(el.dataset.t) : el.dataset.t; });
  });
})();
</script>
</body>
</html>
`;

writeFileSync(OUT, html);
console.log(`review.html: ${READINGS.length} readings`);
