#!/usr/bin/env node
/*
 * «خبزنا اليومي» — the praises to review (owner 2026-11-25: «هتدور انتا ونا هراجع»): for every person of the saints
 * card (and our two patrons), the St-Takla praises whose title or subject names them (praise-catalog.json), each with
 * its first verses and its link; the one the registry has now marked. A page the owner opens, chooses on («ده هو» /
 * «مفيش»), and copies his choice from (one JSON he sends back). Nothing is chosen here.
 *
 *   node tools/bread-praise-review.mjs   → D:/private_projects/khobzna-work/p5b/praises.html (+ praise-candidates.json)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.P5B_DIR || 'D:/private_projects/khobzna-work/p5b';
const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'daily-bread', 'data', 'saints.json'), 'utf8'));
const cat = JSON.parse(fs.readFileSync(path.join(OUT, 'praise-catalog.json'), 'utf8'));

const norm = s => String(s || '').replace(/[ًٌٍَُِّْـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/[«»"()،,:.\-]/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['القديس', 'القديسه', 'الشهيد', 'الشهيده', 'البابا', 'الانبا', 'ابونا', 'القمص', 'القس', 'العظيم', 'العظيمه', 'مار', 'السيده', 'رئيس', 'الملايكه', 'الملاك', 'اسقف', 'مطران', 'الامير', 'بن', 'ابن', 'اول', 'الكبير', 'السايح', 'الاب', 'ال', 'و', 'في', 'من', 'الشهدا', 'شهدا', 'الاسقف', 'اب', 'والد', 'تمجيد', 'مديح']);
// a few people the names alone would miss (or confuse)
const ALIAS = {
  mercurius: ['ابي سيفين', 'ابوسيفين', 'ابو سيفين', 'مرقوريوس', 'فيلوباتير'], mary: ['العذراء', 'مريم', 'ام النور', 'البتول'],
  george: ['جرجس', 'جاورجيوس'], mina: ['مينا', 'مارمينا'], michael: ['ميخاييل'], athanasius: ['اثناسيوس'],
  theodore: ['تادرس الشطبي'], victor: ['بقطر'], macarius: ['مقار', 'ابومقار', 'مكاريوس الكبير'], mosesblack: ['موسي الاسود'],
  johnshort: ['يحنس القصير', 'يوحنا القصير'], karas: ['كاراس'], takla: ['تكلاهيمانوت', 'تكلا هيمانوت']
};
const keysOf = p => (ALIAS[p.id] || []).concat(norm(p.name).split(' ').filter(w => w.length >= 3 && !STOP.has(w)));

const people = reg.people.filter(p => p.class !== 'living' && p.feasts.length);
const pub = { ...Object.fromEntries((reg.occasions || []).map(o => [o.id, o])) };
void pub;
const rows = people.map(p => {
  const keys = keysOf(p).map(norm);
  const scored = cat.map(c => {
    const hay = norm(c.name + ' ' + c.about.join(' '));
    const hits = keys.filter(k => hay.includes(k));
    return { c, score: hits.length + (/تمجيد/.test(c.name) ? 0.5 : 0) + (hits.some(h => h.includes(' ')) ? 1 : 0) };
  }).filter(x => x.score >= 1.5 || (x.score >= 1 && keys.length === 1)).sort((a, b) => b.score - a.score).slice(0, 6);
  return {
    id: p.id, name: p.name, current: p.praise ? { title: p.praise.title || '', url: p.praise.source } : null,
    candidates: scored.map(({ c }) => ({ url: c.url, name: c.name, lyricist: c.lyricist, lines: c.lines.length, first: c.lines.slice(0, 8) }))
  };
});
fs.writeFileSync(path.join(OUT, 'praise-candidates.json'), JSON.stringify(rows, null, 1));
const found = rows.filter(r => r.candidates.length).length;

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>مراجعة التماجيد — خبزنا اليومي</title>
<style>
body{margin:0;font:16px/1.7 system-ui,"Segoe UI",Tahoma,sans-serif;background:#071427;color:#eef2fb}
header{position:sticky;top:0;z-index:5;background:#0b2140;padding:14px 18px;border-bottom:1px solid #2a4570;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
header h1{font-size:1.15rem;margin:0;color:#f2d28b} header p{margin:0;font-size:.85rem;color:#b9c6df;flex:1 1 300px}
button{font:inherit;cursor:pointer;border-radius:10px;border:1px solid #3b5a8c;background:#12305e;color:#eef2fb;padding:8px 14px}
button.main{background:#f2d28b;color:#1b1206;border-color:#f2d28b;font-weight:700}
main{max-width:1100px;margin:0 auto;padding:18px;display:grid;gap:14px}
.p{background:#0b1d38;border:1px solid #223c66;border-radius:16px;padding:14px 16px}
.p h2{margin:0 0 4px;font-size:1.05rem} .p small{color:#9fb0cf}
.p.done{border-color:#4caf7a} .p.none{border-color:#8a6a3a}
.c{display:grid;grid-template-columns:auto 1fr;gap:10px;margin-top:10px;padding:10px;border-radius:12px;background:#0f2849;border:1px solid transparent}
.c.on{border-color:#f2d28b;background:#1a3561}
.c b{color:#f2d28b} .c pre{margin:6px 0 0;white-space:pre-wrap;font:inherit;color:#dbe4f5;font-size:.92rem}
.c a{color:#9fc3ff;font-size:.85rem} .cur{display:inline-block;margin-inline-start:6px;padding:0 8px;border-radius:99px;background:#5a3a0a;color:#ffd98a;font-size:.75rem}
.opts{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
textarea{width:100%;min-height:90px;font:inherit;direction:ltr;background:#020914;color:#cfe;border:1px solid #2a4570;border-radius:10px;padding:8px}
.miss{color:#ffcf8a}
</style></head><body>
<header><h1>مراجعة التماجيد</h1><p>لكل شخص: اختار التمجيد المعروف اللي بيتقال، أو «مفيش». اختيارك بيتحفظ على الجهاز ده. لما تخلص دوس «انسخ اختياراتي» وابعتهالي. «الحالي» = اللي في السجل دلوقتي (ممكن يكون غلط زي أبي سيفين). لقيت مرشحين لـ${found} من ${rows.length}.</p>
<span id="count"></span><button class="main" id="copy">انسخ اختياراتي</button></header>
<main id="m"></main>
<script>
const ROWS = ${JSON.stringify(rows).replace(/</g, '\\u003c')};
const KEY = 'khobzna.praise.choice';
const pick = JSON.parse(localStorage.getItem(KEY) || '{}');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function draw() {
  document.getElementById('m').innerHTML = ROWS.map(r => {
    const ch = pick[r.id];
    return '<section class="p ' + (ch === 'none' ? 'none' : ch ? 'done' : '') + '" id="' + r.id + '"><h2>' + esc(r.name) + '</h2><small>' + (r.current ? 'الحالي: ' + esc(r.current.title) : 'مفيش تمجيد في السجل') + '</small>'
      + (r.candidates.length ? r.candidates.map(c => '<label class="c ' + (ch === c.url ? 'on' : '') + '"><input type="radio" name="' + r.id + '" value="' + esc(c.url) + '" ' + (ch === c.url ? 'checked' : '') + '><div><b>' + esc(c.name) + '</b>' + (r.current && r.current.url === c.url ? '<span class="cur">الحالي</span>' : '') + '<br><small>' + (c.lyricist ? 'كلمات: ' + esc(c.lyricist) + ' · ' : '') + c.lines + ' سطر · </small><a href="' + esc(c.url) + '" target="_blank" rel="noopener">افتح الصفحة كاملة ↗</a><pre>' + esc(c.first.join('\\n')) + '\\n…</pre></div></label>').join('') : '<p class="miss">ملقيتش تمجيد ليه في الأنبا تكلا.</p>')
      + '<div class="opts"><label><input type="radio" name="' + r.id + '" value="none" ' + (ch === 'none' ? 'checked' : '') + '> مفيش تمجيد معروف</label><label><input type="radio" name="' + r.id + '" value="other" ' + (ch && ch.startsWith && ch.startsWith('other:') ? 'checked' : '') + '> التمجيد الصح مش هنا (هبعتلك لينكه)</label></div></section>';
  }).join('');
  document.getElementById('count').textContent = Object.keys(pick).length + ' / ' + ROWS.length;
}
document.addEventListener('change', e => {
  if (e.target.type !== 'radio') return;
  let v = e.target.value;
  if (v === 'other') { const u = prompt('حط لينك التمجيد الصح (لو معاك):', ''); v = 'other:' + (u || ''); }
  pick[e.target.name] = v; localStorage.setItem(KEY, JSON.stringify(pick)); draw();
});
document.getElementById('copy').onclick = async () => {
  const t = JSON.stringify(pick);
  try { await navigator.clipboard.writeText(t); alert('اتنسخ. ابعته في الشات.'); } catch { const a = document.createElement('textarea'); a.value = t; document.body.prepend(a); a.select(); }
};
draw();
</script></body></html>`;
fs.writeFileSync(path.join(OUT, 'praises.html'), html);
console.log(`${rows.length} people; candidates found for ${found}; none for ${rows.length - found}: ${rows.filter(r => !r.candidates.length).map(r => r.id).join(', ')}`);
