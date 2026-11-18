// «خبزنا اليومي» W4 — the side-by-side check (PLAN.md §2 «قاعدة المطابقة»): every admin screen of the approved W1
// design (docs/daily-bread/w1/shots/20–25) next to the real admin drawn by tests/bread-admin.e2e.mjs at the same size.
//
//   cd tools && BREAD_SHOTS=1 node --test --test-concurrency=1 ../tests/bread-admin.e2e.mjs   (→ tools/.cache/bread-admin/*.png)
//   node docs/daily-bread/w4/build-compare.mjs                                                 (→ docs/daily-bread/w4/shots/*.webp + compare.html)
import { createRequire } from 'node:module';
import { readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const sharp = createRequire(ROOT + 'tools/package.json')('sharp');
const REAL = ROOT + 'tools/.cache/bread-admin/';
const W1 = ROOT + 'docs/daily-bread/w1/shots/';
const OUT = ROOT + 'docs/daily-bread/w4/shots/';
mkdirSync(OUT, { recursive: true });

/* what each screen shows, and what differs on purpose (data, or a decision written in progress/W4.md) */
const NOTES = {
  '20-programs': 'البرنامج الشغال، الجاي، اللي فاتوا. الفرق: التواريخ (من يوم التجربة) وحالة النشر فوق (بيانات الاختبار).',
  '20-ending7': 'تنبيه «فاضل ٧ أيام» (٧ منوّرة).',
  '20-ending3': 'تنبيه «فاضل ٣ أيام».',
  '20-ending1': 'تنبيه «بكره آخر يوم» بالأحمر.',
  '20-empty': '«المحتوى خلص» + الكتم. الفرق: الكارت بيقول اسم البرنامج اللي خلص من البيانات.',
  '20-muted': 'التنبيه مكتوم.',
  '21-new-1': 'النموذج وقبل ما تملاه.',
  '21-new-2': 'الملف بيتقري («١٨ من ٢١»). الصورة متصوّرة في اللحظة دي بالظبط.',
  '21-new-3': 'المراجعة بالأخطاء والملاحظات، ومعاينة يوم ٣ من فاندايك. الفرق: نص الآية بخط احتياطي لحد ما Amiri تنزل في W5.',
  '21-new-3-ok': 'ملف سليم، ومعاينة يوم ١.',
  '21-new-4': 'التفعيل. الفرق المقصود: «استبدال دلوقتي» بيبدأ الجديد «من النهارده» (ده اللي الـWorker بيعمله)، مش «من بكره».',
  '21-new-4-now': 'تأكيد الاستبدال بالكتابة. نفس فرق «من النهارده».',
  '22-stats': 'الإحصائيات. الفرق المقصود: «الأيام الأكتر تفاعل» بدل «المواضيع» (الترتيب مختلف لكل شاب فمفيش رقم لكل موضوع)، وخانات الإشعارات والمشتركين اللي مش بتتقاس بقت أرقام بتتقاس (W4.md).',
  '23-reflections': 'التأملات (كل فتح بيتسجل في النشاط).',
  '23-noperm': 'من غير صلاحية «تأملات خبزنا اليومي».',
  '24-settings': 'الإعدادات. الفرق المقصود: نص الإشعار ثابت (قرار ٧)، فالخانة للقراية بس.',
  '25-bell': 'الجرس. الفرق: «تغييرات مستنية النشر» من بيانات الاختبار.'
};

const ids = readdirSync(W1).filter(f => /^2[0-5]-.*\.webp$/.test(f)).map(f => f.replace('.webp', '')).sort();
const rows = [];
for (const id of ids) {
  const phone = id.endsWith('-m');
  const have = existsSync(REAL + id + '.png');
  if (have) await sharp(REAL + id + '.png').resize({ width: phone ? 780 : 1440 }).webp({ quality: 82 }).toFile(OUT + id + '.webp');
  rows.push({ id, phone, have, note: NOTES[id.replace(/-[dm]$/, '')] || '' });
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>خبزنا اليومي — W4: التصميم ↔ الأدمن الحقيقي</title>
<meta name="robots" content="noindex">
<link rel="stylesheet" href="../../../assets/css/main.css">
<link rel="stylesheet" href="../w1/review.css">
<link rel="stylesheet" href="compare.css">
</head>
<body>
<main class="rv">
  <header>
    <h1>W4 — التصميم المعتمد ↔ الأدمن الحقيقي</h1>
    <p class="rv-lead">كل شاشة من «الآيات والقراءات اليومية»: <b>يمين</b> صورة W1 المعتمدة، و<b>شمال</b> الأدمن الحقيقي بنفس المقاس (كمبيوتر ١٤٤٠ × ٩٠٠، موبايل ٣٩٠ × ٨٤٤ 2x)، متصوّر من <code>tests/bread-admin.e2e.mjs</code>. الفروق المكتوبة تحت كل شاشة هي البيانات (تواريخ، أسماء، حالة النشر) أو قرارات مكتوبة في <code>progress/W4.md</code>.</p>
  </header>
  ${rows.map(r => `<section class="card rv-fig cmp${r.phone ? ' cmp--m' : ''}">
    <header><b>${esc(r.id)}</b><small>${r.phone ? 'موبايل' : 'كمبيوتر'}</small></header>
    ${r.note ? `<p>${esc(r.note)}</p>` : ''}
    <div class="cmp__pair">
      <figure><figcaption>W1 (المعتمد)</figcaption><img src="../w1/shots/${esc(r.id)}.webp" alt="W1 ${esc(r.id)}" loading="lazy"></figure>
      <figure><figcaption>W4 (الحقيقي)</figcaption>${r.have ? `<img src="shots/${esc(r.id)}.webp" alt="W4 ${esc(r.id)}" loading="lazy">` : '<p class="cmp__miss">ناقصة</p>'}</figure>
    </div>
  </section>`).join('\n  ')}
</main>
</body>
</html>
`;
writeFileSync(ROOT + 'docs/daily-bread/w4/compare.html', html);
writeFileSync(ROOT + 'docs/daily-bread/w4/compare.css', `body { background: var(--ink); color: var(--text); }
.cmp header { display: flex; gap: 10px; align-items: baseline; }
.cmp header small { color: var(--text-3); }
.cmp__pair { display: grid; gap: 14px; grid-template-columns: 1fr 1fr; align-items: start; }
.cmp--m .cmp__pair { grid-template-columns: repeat(2, minmax(0, 300px)); justify-content: start; }
.cmp figure { margin: 0; display: grid; gap: 6px; }
.cmp figcaption { font-size: .8rem; font-weight: 800; color: var(--gold-hi); }
.cmp img { display: block; width: 100%; height: auto; border-radius: 12px; box-shadow: 0 0 0 1px rgba(var(--gold-hi-rgb), .16); }
.cmp__miss { color: #ff8a7d; }
@media (max-width: 760px) { .cmp__pair, .cmp--m .cmp__pair { grid-template-columns: 1fr; } }
`);
console.log(rows.filter(r => r.have).length + ' / ' + rows.length + ' screens → docs/daily-bread/w4/compare.html');
