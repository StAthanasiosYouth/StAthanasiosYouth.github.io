/*
 * «الآيات والقراءات اليومية» — admin prototype (study only; saves nothing, sends nothing).
 * URL: admin.html?s=<programs|upload|stats|reflections|settings>&alert=<none|7|3|1|out>&step=<1-4>&perm=<1|0>
 * The Excel template and the upload use the admin's own reader/writer (admin/xlsx.js), as the real section will.
 */
import { readXlsx, writeXlsx, download, firstDataSheet } from '../../../admin/xlsx.js';
import { parseRef, COLUMNS } from './refs.js';
import { TOPICS, PROGRAM, ar } from './data.js';

const q = new URLSearchParams(location.search);
const S = { s: q.get('s') || 'programs', alert: q.get('alert') || '3', step: +(q.get('step') || 1), perm: q.get('perm') !== '0', rows: null, file: '', sel: 0, mode: 'after', muted: false };
const $ = (sel, el = document) => el.querySelector(sel);
const root = document.getElementById('root');
const days = n => ar(n) + (n >= 3 && n <= 10 ? ' أيام' : ' يوم');
const toast = t => { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2400); };

const I = {
  bread: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 6c-2-1.5-5-2-8-1v13c3-1 6-.5 8 1 2-1.5 5-2 8-1V5c-3-1-6-.5-8 1z"/><path d="M12 6v13"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 11l8-7 8 7v9H4z"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.5 3-6 6-6s6 2.5 6 6M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2 .8 3 3 3 6"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 19a2 2 0 0 0 4 0"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>',
  page: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/></svg>',
  dl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12 16V5M7 10l5-5 5 5"/><path d="M5 15v4h14v-4"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>'
};

const TABS = [['programs', 'البرامج'], ['upload', 'رفع برنامج'], ['stats', 'الإحصائيات'], ['reflections', 'التأملات'], ['settings', 'الإعدادات']];

function shell(inner) {
  return `<div class="shell">
    <nav class="rail" aria-label="أقسام اللوحة">
      <div class="who"><img src="../../../admin/icon-192.png" alt=""><div><b>لوحة الأسرة</b><small>مينا زكريا · الأدمن الأساسي</small></div></div>
      <a href="#">${I.home}الرئيسية</a>
      <h6>المحتوى</h6>
      <a href="#">${I.page}الصفحات والفعاليات</a>
      <a href="#">${I.cal}الاجتماعات</a>
      <a href="#" class="on">${I.bread}الآيات والقراءات اليومية<span class="new">جديد</span></a>
      <h6>الناس</h6>
      <a href="#">${I.users}الحسابات</a>
      <a href="#">${I.bell}الإشعارات</a>
      <h6>النظام</h6>
      <a href="#">${I.gear}الإعدادات</a>
    </nav>
    <div>
      <header class="top"><h1><img src="../logo/mark-c.svg" alt="">الآيات والقراءات اليومية</h1><span class="pill ok">«خبزنا اليومي» شغال</span></header>
      <div class="content">
        <nav class="tabs">${TABS.map(([k, t]) => `<a href="#" data-s="${k}" class="${S.s === k ? 'on' : ''}">${t}</a>`).join('')}</nav>
        ${inner}
      </div>
    </div>
  </div>
  <nav class="dock"><a href="#">${I.home}الرئيسية</a><a href="#">${I.page}المحتوى</a><a href="#" class="on">${I.bread}خبزنا</a><a href="#">${I.users}الناس</a><a href="#">${I.gear}المزيد</a></nav>`;
}

/* ── البرامج ── */
function alertBox() {
  if (S.muted) return '';
  if (S.alert === 'out') return `<div class="alert bad"><span class="ic">!</span><div class="grow"><b>المحتوى خلص النهارده</b><p>الموقع بيعرض «قريب قوي…» للمشتركين، ومفيش إشعارات بتتبعت لحد ما ترفع برنامج جديد. التنبيه ده بيتبعت مرة واحدة.</p>
    <div class="row" style="margin-top:10px"><a class="btn" href="#" data-s="upload">${I.up}ارفع برنامج جديد</a><button class="btn ghost" data-act="mute">كتم لحد ما أرفع برنامج</button></div></div></div>`;
  if (S.alert === 'none') return '';
  const n = +S.alert;
  return `<div class="alert warn"><span class="ic">${ar(n)}</span><div class="grow"><b>${n === 1 ? 'بكره آخر يوم في البرنامج' : `فاضل ${ar(n)} أيام على نهاية البرنامج`}</b><p>${S.next ? 'البرنامج الجاي جاهز وهيبدأ لوحده بعد ما ده يخلص.' : 'مفيش برنامج جاي متجهّز. لو مترفعش حاجة، المشتركين هيشوفوا «قريب قوي…» بعد ما يخلص.'}</p></div>
    ${S.next ? '' : `<a class="btn" href="#" data-s="upload">${I.up}جهّز البرنامج الجاي</a>`}</div>`;
}

function programs() {
  const left = S.alert === 'out' ? 0 : S.alert === 'none' ? 18 : +S.alert;
  const day = PROGRAM.days - left;
  const pct = (day / PROGRAM.days * 100).toFixed(0);
  const active = S.alert === 'out'
    ? `<section class="card"><h2>مفيش برنامج شغال دلوقتي</h2><p class="muted">آخر برنامج «${PROGRAM.name}» خلص النهارده. القراءات اللي اتبعتت فيه مبتتنقلش لبرنامج جديد.</p></section>`
    : `<section class="card active"><div class="row" style="align-items:center;gap:18px">
        <div class="ring" style="--p:${pct}%"><b>${ar(day)}<small>من ${ar(PROGRAM.days)} يوم</small></b></div>
        <div class="grow"><span class="pill ok">شغال للكل</span><h2 style="margin-top:6px;font-size:21px">${PROGRAM.name}</h2>
          <dl class="kv"><dt>بدأ</dt><dd>الاتنين ١٠ نوفمبر ٢٠٢٦</dd><dt>بيخلص</dt><dd>الثلاثاء ٩ ديسمبر ٢٠٢٦ · فاضل ${ar(left)} يوم</dd><dt>الإشعار</dt><dd>٨:٠٠ ص بتوقيت مصر (الافتراضي)</dd></dl></div></div>
        <div class="row" style="margin-top:14px"><button class="btn ghost" data-act="preview">عاين قراءة يوم</button><button class="btn ghost" data-act="dl-current">نزّل البرنامج Excel</button><span class="grow"></span><button class="btn danger" data-act="stop">وقّف البرنامج</button></div>
      </section>`;
  return alertBox() + `<div class="grid g-main">${active}
    <section class="card"><h2>الجاي</h2>
      ${S.next ? `<div class="tl next"><span class="dot"></span><div class="grow"><b>سلسلة «اثبتوا فيّ»</b><div class="muted">٦٠ يوم · هيبدأ الأربع ١٠ ديسمبر بعد ما الحالي يخلص</div></div><span class="pill info">متجدول</span></div>`
        : `<p class="muted">مفيش برنامج متجدول. ارفع برنامج واختار «بعد ما الحالي يخلص»، وهيبدأ لوحده من غير ما حد يقف.</p><a class="btn" href="#" data-s="upload">${I.up}ارفع برنامج</a>`}
      <h3 style="margin:18px 0 8px">اللي فات</h3>
      <div class="timeline">
        <div class="tl"><span class="dot"></span><div class="grow"><b>سلسلة «صوم الميلاد»</b><div class="muted">٤٣ يوم · خلص ٩ نوفمبر · فتح ٧١٪</div></div></div>
        <div class="tl"><span class="dot"></span><div class="grow"><b>أسبوع «الصلاة»</b><div class="muted">٧ أيام · خلص ٢٧ سبتمبر · فتح ٦٤٪</div></div></div>
      </div>
      <p class="muted" style="margin-top:10px">بيفضل الاسم والأرقام بس. محتوى البرامج اللي فاتت مش بيتعرض للمخدومين (مفيش أرشيف).</p>
    </section></div>`;
}

/* ── رفع برنامج ── */
const DEMO = () => [
  COLUMNS,
  ...TOPICS.map((t, i) => [i + 1, t.title, t.verseRef, t.readingRef, t.meditation, t.question]),
  [8, 'نور العالم', 'يو ٨: ١٢', 'يوحنا ٨: ١٢-٢٠', 'تأمل تجريبي…', ''],
  [9, 'الابن الضال', 'لو ١٥: ٢٠', 'لوقا 15: 11–32', 'تأمل تجريبي…', 'إمتى رجعت لربنا آخر مرة؟'],
  [10, 'المحبة', '1كو 13: 4', 'كورنثوس الأولى 13: 4-7', '', ''],
  [11, 'الكرمة', 'يوحنا 30: 1', 'يوحنا 15: 1-8', 'تأمل تجريبي…', ''],
  [12, '', 'متى ٥ ١٤', 'متى 5: 13-16', 'تأمل تجريبي…', '']
];

function validate(rows) {
  const head = rows[0].map(String);
  const col = name => head.findIndex(h => h.trim().startsWith(name));
  const c = { n: col('رقم'), title: col('العنوان'), verse: col('مرجع الآية'), reading: col('مرجع القراءة'), med: col('التأمل'), q: col('السؤال') };
  const out = [];
  for (const r of rows.slice(1)) {
    if (!r.some(v => String(v ?? '').trim())) continue;
    const v = k => String(c[k] >= 0 ? r[c[k]] ?? '' : '').trim();
    const verse = parseRef(v('verse')), reading = parseRef(v('reading'));
    const errs = [], warns = [];
    if (!v('title')) errs.push('العنوان فاضي');
    if (!verse.ok) errs.push('مرجع الآية: ' + verse.error);
    if (!reading.ok) errs.push('مرجع القراءة: ' + reading.error);
    if (!v('med')) errs.push('التأمل فاضي');
    if (verse.ok && reading.ok && (verse.book !== reading.book || verse.ch < reading.ch || verse.ch > reading.ch2)) warns.push('الآية مش جوه القراءة (مسموح، بس اتأكد)');
    if (verse.ok && verse.psalm) warns.push('ترقيم المزامير عبري (فاندايك)؛ في الأجبية الرقم أقل بواحد غالبًا');
    out.push({ n: v('n') || out.length + 1, title: v('title'), verse, reading, med: v('med'), q: v('q'), errs, warns });
  }
  return out;
}

function upload() {
  const steps = ['النموذج', 'الملف', 'المراجعة', 'التفعيل'];
  const st = `<ol class="steps">${steps.map((t, i) => `<li class="${i + 1 === S.step ? 'on' : i + 1 < S.step ? 'done' : ''}"><span>${t}</span></li>`).join('')}</ol>`;
  if (S.step === 1 || S.step === 2) {
    return st + `<div class="grid g2">
      <section class="card"><h2>١. نزّل النموذج</h2><p class="muted">ملف Excel فيه عمود لكل حاجة: الرقم، العنوان، مرجع الآية، مرجع القراءة، التأمل، والسؤال (اختياري). كل صف = يوم. عدد الصفوف هو مدة البرنامج (٧ أو ٣٠ أو ٦٠ أو ٩٠ أو أي عدد).</p>
        <p class="muted"><b style="color:var(--acc-hi)">النص نفسه مش بيتكتب:</b> بتكتب المرجع بس، والموقع بيجيب النص من نسخة فاندايك المعتمدة. كده مفيش غلط كتابة في كلام الكتاب.</p>
        <button class="btn" data-act="template">${I.dl}نزّل النموذج (xlsx)</button></section>
      <section class="card"><h2>٢. ارفع الملف</h2>
        <label class="drop" id="drop">${I.up}<p style="margin:8px 0 4px;font-weight:700">اسحب الملف هنا أو اختاره</p><p class="muted" style="margin:0">xlsx · لحد ١٢٠ يوم في الملف</p>
          <input type="file" accept=".xlsx" hidden id="file"></label>
        <div class="row" style="margin-top:12px"><span class="muted grow">مش معاك ملف؟</span><button class="btn ghost" data-act="demo">جرّب بملف تجريبي (فيه أخطاء)</button></div>
      </section></div>`;
  }
  const rows = S.rows || validate(DEMO());
  const bad = rows.filter(r => r.errs.length).length;
  const warn = rows.filter(r => !r.errs.length && r.warns.length).length;
  if (S.step === 3) {
    const sel = rows[S.sel] || rows[0];
    return st + `<div class="row" style="margin-bottom:14px"><span class="pill ${bad ? 'bad' : 'ok'}">${bad ? `${ar(bad)} ${bad === 1 ? 'صف محتاج' : 'صفوف محتاجة'} تصليح` : 'كل الصفوف سليمة'}</span>${warn ? `<span class="pill warn">${ar(warn)} ${warn === 1 ? 'ملاحظة' : 'ملاحظات'}</span>` : ''}<span class="pill dim">${days(rows.length)}</span><span class="muted grow">${S.file || 'ملف تجريبي'}</span>
      <button class="btn ghost" data-act="back">ارفع ملف تاني</button><button class="btn" data-act="next" ${bad ? 'disabled style="opacity:.45;cursor:not-allowed"' : ''}>التالي</button></div>
      ${bad ? `<p class="muted" style="margin-top:-6px">صلّح الصفوف الحمرا في الملف وارفعه تاني. مفيش حاجة بتتحفظ لحد ما الملف كله يبقى سليم.</p>` : ''}
      <div class="grid g-main"><div class="scroll"><table class="rtable"><thead><tr><th>#</th><th>العنوان</th><th>الآية</th><th>القراءة</th><th>السؤال</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr class="${r.errs.length ? 'bad' : ''} ${i === S.sel ? 'sel' : ''}" data-sel="${i}" style="cursor:pointer"><td>${ar(r.n)}</td><td>${r.title || '<span class="err">—</span>'}${r.errs.map(e => `<span class="err">✗ ${e}</span>`).join('')}${r.warns.map(e => `<span class="warnt">⚠ ${e}</span>`).join('')}</td>
        <td data-l="الآية">${r.verse.ok ? r.verse.text : '<span class="err">✗</span>'}</td><td data-l="القراءة">${r.reading.ok ? r.reading.text : '<span class="err">✗</span>'}</td><td data-l="السؤال">${r.q ? '✓' : '<span class="muted">—</span>'}</td></tr>`).join('')}
      </tbody></table></div>
      <section class="card"><h3 style="margin-bottom:10px">معاينة يوم ${ar(sel.n)}</h3><div class="phone"><div class="v"><h4>${sel.title || '…'}</h4>
        <q>${(TOPICS.find(t => t.title === sel.title) || {}).verse || 'هنا هيظهر نص الآية من فاندايك'}</q><cite>${sel.verse.ok ? sel.verse.text : '—'}</cite></div>
        <p style="font-size:13px;color:var(--text-2);margin:10px 4px 0">${sel.med ? sel.med.slice(0, 120) : '<span class="err">التأمل فاضي</span>'}</p></div>
        <p class="muted" style="text-align:center">اضغط على أي صف تشوفه هنا</p></section></div>`;
  }
  // step 4: activation
  return st + `<div class="grid g2"><section class="card"><h2>اسم البرنامج</h2>
      <div class="field"><input value="سلسلة «اثبتوا فيّ»" aria-label="اسم البرنامج"></div>
      <p class="muted">${days(rows.length)} · كل مشترك هياخد القراءات بترتيب عشوائي ثابت خاص بيه، ومفيش قراءة بتتكرر.</p>
      <h2 style="margin-top:16px">يبدأ إمتى؟</h2>
      <div class="choice">
        <label><input type="radio" name="mode" value="after" ${S.mode === 'after' ? 'checked' : ''}><div><b>بعد ما البرنامج الحالي يخلص</b><span class="muted">يبدأ لوحده الأربع ١٠ ديسمبر الساعة ١٢ بليل بتوقيت مصر.</span></div></label>
        <label><input type="radio" name="mode" value="now" ${S.mode === 'now' ? 'checked' : ''}><div><b>دلوقتي، مكان البرنامج الحالي</b><span class="muted">الحالي بيقف فورًا والكل بيبدأ الجديد من يومه الأول. مفيش ترحيل للي فات.</span></div></label>
      </div></section>
    <section class="card"><h2>قبل التأكيد</h2><dl class="kv"><dt>الأيام</dt><dd>${ar(rows.length)}</dd><dt>الإشعار</dt><dd>نفس مواعيد كل مشترك (الافتراضي ٨:٠٠ ص)</dd><dt>تنبيهات ليك</dt><dd>قبل النهاية بـ٧ و٣ ويوم</dd><dt>المصدر</dt><dd>فاندايك · كل المراجع اتأكدت</dd></dl>
      ${S.mode === 'now' ? `<div class="alert bad" style="margin:14px 0 0"><span class="ic">!</span><div><b>البرنامج الحالي هيقف</b><p>اللي فاضل منه (١٨ يوم) مش هيتعرض. ده مبيترجعش.</p></div></div>` : ''}
      <div class="row" style="margin-top:16px"><button class="btn ghost" data-act="prev">رجوع</button><span class="grow"></span><button class="btn" data-act="confirm">${S.mode === 'now' ? 'استبدل دلوقتي' : 'جدوله'}</button></div></section></div>`;
}

/* ── الإحصائيات ── */
function stats() {
  const days = [62, 58, 71, 66, 49, 54, 73, 69, 64, 77, 70, 61, 75, 72];
  const reads = [38, 35, 47, 40, 29, 33, 50, 44, 41, 52, 46, 39, 51, 48];
  const max = 100;
  return `<div class="grid g4">
    <section class="card kpi"><b>١٨٤</b><span>مشترك في الإشعارات</span><small>+١٢ الأسبوع ده</small></section>
    <section class="card kpi"><b>٧٢٪</b><span>فتحوا قراءة النهارده</span><small>من اللي وصلهم إشعار</small></section>
    <section class="card kpi"><b>٤٨</b><span>دوسوا «قريت» النهارده</span><small>متوسط ٤٣ في اليوم</small></section>
    <section class="card kpi"><b>٢٩</b><span>تأمل الأسبوع ده</span><small>من ٢١ شخص</small></section>
  </div>
  <div class="grid g-main" style="margin-top:16px">
    <section class="card"><div class="row"><h2 class="grow">آخر ١٤ يوم</h2><span class="muted">نسبة الفتح من الإشعارات</span></div>
      <div class="bars">${days.map((d, i) => `<div class="b"><div class="stack" style="height:100%"><i style="height:${d / max * 100}%"></i><i class="r" style="height:${reads[i] / max * 100}%;width:100%"></i></div><em>${ar(i + 1)}</em></div>`).join('')}</div>
      <div class="legend"><span><i style="background:var(--acc)"></i>فتح</span><span><i style="background:rgb(143 198 255 / .55)"></i>«قريت»</span></div></section>
    <section class="card"><h2>مواعيد الإشعار اللي اختاروها</h2>
      ${[['٨:٠٠ ص', 61], ['٧:٠٠ ص', 14], ['٩:٠٠ م', 12], ['٢:٠٠ م', 6], ['تانية', 7]].map(([t, p]) => `<div class="hbar"><span>${t}</span><i style="width:${p}%"></i><span class="muted">${ar(p)}٪</span></div>`).join('')}
      <p class="muted" style="margin-top:12px">٣١٪ فعّلوا أكتر من ميعاد · ٩ قفلوا الإشعارات الأسبوع ده</p></section>
  </div>
  <section class="card" style="margin-top:16px"><div class="grid g3">
    <div><h3>القراءة من غير حساب</h3><p class="muted">٤١٪ من الفتح من أجهزة من غير حساب</p></div>
    <div><h3>الأجهزة</h3><p class="muted">Android ٧٨٪ · iPhone ١٤٪ · كمبيوتر ٨٪</p></div>
    <div><h3>متوسط وقت القراءة</h3><p class="muted">دقيقتين و١٠ ثواني</p></div></div>
    <p class="privacy">🔒 كل الأرقام إجمالية. مفيش قايمة بمين فتح ومين لأ، ومفيش تتبع لشخص بعينه. عدّاد الفتح بيتمسح بعد ٣٠ يوم ويفضل المجموع بس.</p></section>`;
}

/* ── التأملات ── */
function reflections() {
  if (!S.perm) return `<section class="card" style="text-align:center;padding:40px"><h2>التأملات متاحة لأصحاب الصلاحية بس</h2><p class="muted">الصلاحية «تأملات خبزنا اليومي» بيديها الأدمن الأساسي من «الفريق والصلاحيات». الأرقام الإجمالية موجودة في «الإحصائيات».</p></section>`;
  const R = [
    ['م', 'مارينا ع.', 'مؤهل', 'أنا هو خبز الحياة', '٨:١٤ ص', 'حسّيت إن الشبع اللي بدوّر عليه في الموبايل والسوشيال مش بيكمّل. محتاج أبدأ يومي بكلمة منه الأول.', 'ok'],
    ['ب', 'بيشوي م.', 'مؤهل', 'خبزنا كفافنا', '٩:٠٢ ص', 'كنت قلقان من امتحان بكره، والآية دي هدّتني. هسلّمه لربنا.', 'ok'],
    ['ج', 'جورج ن.', 'ضيف', 'الرب راعيّ', '١٠:٣٠ م', 'الجملة «لأنك أنت معي» فكّرتني بوقت عدّيت فيه بحاجة صعبة وكنت حاسس إني لوحدي.', 'info'],
    ['ك', 'كيرلس ف.', 'مؤهل', 'تعالوا إليّ', 'امبارح', 'محتاج الراحة دي فعلًا.', 'ok']
  ];
  return `<div class="row" style="margin-bottom:14px"><select class="btn ghost" aria-label="اليوم"><option>كل الأيام</option><option>النهارده</option><option>آخر ٧ أيام</option></select><select class="btn ghost" aria-label="الموضوع"><option>كل المواضيع</option>${TOPICS.slice(0, 4).map(t => `<option>${t.title}</option>`).join('')}</select><span class="grow"></span><span class="muted">٢٩ تأمل الأسبوع ده</span></div>
    <div class="refl">${R.map(([a, n, st, t, at, p, tone]) => `<article class="rc"><header><span class="av">${a}</span><b>${n}</b><span class="pill ${tone}">${st}</span><span class="muted">على «${t}» · ${at}</span></header><p>${p}</p></article>`).join('')}</div>
    <p class="privacy">🔒 بتشوف دي علشان معاك صلاحية «تأملات خبزنا اليومي». كل فتح للصفحة دي بيتسجل في «النشاط». الاسم بيظهر مختصر، والحساب الكامل من «الحسابات» بس.</p>`;
}

/* ── الإعدادات ── */
function settings() {
  return `<div class="grid g2">
    <section class="card"><h2>الإشعارات للمشتركين</h2>
      <div class="field"><label>الميعاد الافتراضي (بتوقيت مصر)</label><input type="time" value="08:00"></div>
      <div class="field" style="margin-top:10px"><label>أقصى عدد مواعيد لكل مشترك</label><select><option>١</option><option>٢</option><option selected>٣</option></select></div>
      <div class="field" style="margin-top:10px"><label>نص الإشعار</label><select><option selected>عنوان الموضوع + أول الآية</option><option>«كلمة النهارده مستنياك» بس</option></select></div>
      <p class="muted">المشترك بيغيّر مواعيده من صفحة «خبزنا اليومي». الإشعار بيوصل لنفس الجهاز اللي فعّله.</p></section>
    <section class="card"><h2>تنبيهات ليك</h2>
      <div class="choice">
        <label><input type="checkbox" checked><div><b>قبل نهاية البرنامج بـ٧ و٣ ويوم</b><span class="muted">في الجرس وعلى أجهزة الأدمن (نفس نظام إشعارات اللوحة)</span></div></label>
        <label><input type="checkbox" checked><div><b>لما المحتوى يخلص</b><span class="muted">مرة واحدة، وتقدر تكتمه لحد ما ترفع برنامج</span></div></label>
      </div>
      <h2 style="margin-top:16px">رسايل الترحيب</h2>
      <div class="field"><label>للمؤهل لخدمة الشباب</label><textarea rows="2">أهلًا يا {الاسم}، نورت خبزنا اليومي 🤍</textarea></div>
      <div class="field" style="margin-top:8px"><label>للضيف (خارج سن الخدمة)</label><textarea rows="2">أهلًا بيك يا {الاسم}، ضيف عزيز علينا 🤍</textarea></div>
      <p class="muted">مدة التعديل والمسح بعد إرسال التأمل: ٢٠ دقيقة (ثابتة).</p></section></div>`;
}

/* ── template: the real file, written by admin/xlsx.js ── */
function templateBook() {
  return {
    sheets: [
      { name: 'البرنامج', rtl: true, header: true, filter: false, widths: [7, 26, 20, 24, 60, 40], textColumns: [2, 3],
        rows: [COLUMNS, ...TOPICS.slice(0, 3).map((t, i) => [i + 1, t.title, t.verseRef, t.readingRef, t.meditation, t.question])] },
      { name: 'إزاي تملاه', rtl: true, widths: [90],
        rows: [['إزاي تملا النموذج'], ['كل صف = يوم واحد. عدد الصفوف = مدة البرنامج (٧ أو ٣٠ أو ٦٠ أو ٩٠ أو أي عدد لحد ١٢٠).'],
          ['العنوان: اسم موضوع اليوم، قصير.'], ['مرجع الآية: الآية اللي هتظهر كبيرة. مثال: يوحنا ٦: ٣٥ أو يو 6:35'],
          ['مرجع القراءة: القراءة الكاملة. مثال: يوحنا ٦: ٣٢-٣٥ أو متى 5: 1 - 6: 4 (من أصحاح لأصحاح)'],
          ['متكتبش نص الآية: الموقع بيجيبه من ترجمة فاندايك المعتمدة.'], ['التأمل: فقرة قصيرة من كتابة خدام الأسرة. لو منقول من كتاب، اكتب المصدر في آخره.'],
          ['السؤال: اختياري، ممكن يتساب فاضي.'], ['المزامير بترقيم فاندايك (العبري). مزمور ٢٣ = مزمور ٢٢ في الأجبية.'],
          ['أسماء الأسفار المختصرة المقبولة: مت، مر، لو، يو، أع، رو، 1كو، 2كو، غل، أف، في، كو، عب، يع، 1بط، 1يو، رؤ، تك، خر، مز، أم، إش، إر…']] }
    ]
  };
}

function render() {
  root.innerHTML = shell({ programs, upload, stats, reflections, settings }[S.s]());
  const file = $('#file');
  if (file) {
    const drop = $('#drop');
    const take = async f => {
      try {
        const book = await readXlsx(new Uint8Array(await f.arrayBuffer()));
        const sheet = firstDataSheet(book, 'البرنامج');
        S.rows = validate(sheet.rows); S.file = f.name; S.step = 3; S.sel = 0; render();
      } catch (err) { toast('الملف ده مش Excel سليم'); }
    };
    drop.addEventListener('click', () => file.click());
    file.addEventListener('change', () => file.files[0] && take(file.files[0]));
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); e.dataTransfer.files[0] && take(e.dataTransfer.files[0]); });
  }
}

document.addEventListener('click', e => {
  const s = e.target.closest('[data-s]');
  if (s) { e.preventDefault(); S.s = s.dataset.s; if (S.s === 'upload') S.step = 1; render(); scrollTo(0, 0); return; }
  const sel = e.target.closest('[data-sel]');
  if (sel) { S.sel = +sel.dataset.sel; render(); return; }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  const A = {
    template: () => { download(writeXlsx(templateBook()), 'خبزنا-اليومي-نموذج.xlsx'); toast('اتنزّل النموذج'); },
    'dl-current': () => toast('هيتنزّل البرنامج الحالي بنفس شكل النموذج'),
    demo: () => { S.rows = validate(DEMO()); S.file = 'برنامج-تجريبي.xlsx'; S.step = 3; render(); },
    back: () => { S.step = 2; render(); },
    next: () => { S.step = 4; render(); },
    prev: () => { S.step = 3; render(); },
    confirm: () => { S.next = S.mode !== 'now'; S.s = 'programs'; if (S.mode === 'now') S.alert = 'none'; render(); toast(S.mode === 'now' ? 'البرنامج الجديد شغال دلوقتي للكل' : 'اتجدول: هيبدأ لوحده ١٠ ديسمبر'); },
    mute: () => { S.muted = true; render(); toast('اتكتم لحد ما ترفع برنامج'); },
    stop: () => toast('بيطلب تأكيد: «البرنامج هيقف للكل»'),
    preview: () => window.open('app.html?s=today&t=0', '_blank')
  };
  A[act]?.();
});
document.addEventListener('change', e => { if (e.target.name === 'mode') { S.mode = e.target.value; render(); } });

// a demo program for the review/activation steps when opened straight there
if (S.s === 'upload' && S.step >= 3) S.rows = validate(DEMO());
render();
