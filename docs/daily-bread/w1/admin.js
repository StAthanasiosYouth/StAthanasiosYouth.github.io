/*
 * «خبزنا اليومي» — W1 admin prototype «الآيات والقراءات اليومية», inside the LIVE admin shell.
 * The shell (rail, top bar, dock, sub-tabs) is the real /admin/ markup captured from the panel itself
 * (tools/capture-admin.mjs → admin-shell.json) and styled by the real admin/admin.css; the screens use the panel's own
 * components (.p8-card, .chipico, .btn, .stepper, .p8-table, .setcard/.setrow, .switch, .kpi, .modal, .menu--bell)
 * plus bread-admin.css (ba-*). W4 builds this as apps-script/AdminBread.html.
 *
 *   ?s=programs   &st=running|ending7|ending3|ending1|empty|muted          (default: running, with the next one scheduled)
 *   ?s=new        &step=1|2|3|4   step 3: &err=0 (a clean file) &day=<n> · step 4: &mode=after|now &confirm=1
 *   ?s=stats      ?s=reflections (&perm=0: no permission)      ?s=settings
 *   &bell=1       the bell's menu open, with the module's alerts         &mode=light  the panel's light mode
 */
import { PROGRAM, TOPICS } from '../prototype/data.js';
import { BREAD_ICONS } from './icons-bread.js';

const q = new URLSearchParams(location.search);
const S = { s: q.get('s') || 'programs', st: q.get('st') || 'running', step: +(q.get('step') || 1), err: q.get('err') !== '0', mode: q.get('mode') || 'after', day: +(q.get('day') || 3) };
const AR = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
const html = document.documentElement;

/* the panel's own icon set (apps-script/AdminIcons.html, generated from assets/js/icons.js) + the module's */
const ICONS = await fetch('../../../apps-script/AdminIcons.html').then(r => r.text()).then(t => JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)));
const ic = (n, cls) => {
  const s = ICONS[n] || (BREAD_ICONS[n] ? `<svg class="icon icon--line" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${BREAD_ICONS[n]}</svg>` : ICONS.info);
  return cls ? `<span class="${cls}" aria-hidden="true">${s}</span>` : s;
};

/* ---------- the live shell ---------- */
const SHELL = await fetch('admin-shell.json').then(r => r.json());
const attrs = SHELL.desktop.htmlAttrs;
for (const [k, v] of Object.entries(attrs)) if (k !== 'class') html.setAttribute(k, v);
if (q.get('mode') === 'light') { html.dataset.mode = 'light'; html.dataset.theme = 'light'; }

const TITLE = 'الآيات والقراءات اليومية';
const TABS = [['programs', 'البرامج'], ['new', 'برنامج جديد'], ['stats', 'الإحصائيات'], ['reflections', 'التأملات'], ['settings', 'الإعدادات']];

function shell(view) {
  let s = SHELL.desktop.shell.replaceAll('"../assets/', '"../../../assets/');
  // the module's place in the rail: «الشغل», after «الفعاليات والصفحات»
  s = s.replace('aria-current="page" data-area="home"', 'data-area="home"');
  s = s.replace(/(<button class="navlink" type="button" data-area="pages"[\s\S]*?<\/button>)/, `$1<button class="navlink" type="button" aria-current="page" data-area="bread" title="${TITLE}"><span class="navlink__icon">${ic('bread')}</span><span class="navlink__label">${TITLE}</span></button>`);
  // phones: the dock's «المزيد» holds it
  s = s.replace(/(<button class="dockbtn" type="button") aria-current="page"( data-area="home")/, '$1$2').replace(/--active: 0;/, '--active: 4;').replace(/(<button class="dockbtn dockbtn--more"[^>]*?)(>)/, '$1 aria-current="page"$2');
  s = s.replace('<p class="topbar__crumb" id="crumb">لوحة التحكم</p>', '<p class="topbar__crumb" id="crumb">خبزنا اليومي</p>')
    .replace('<h1 class="topbar__heading" id="page-title">الرئيسية</h1>', `<h1 class="topbar__heading" id="page-title">${TITLE}</h1>`)
    .replace('class="status status--dirty"', 'class="status status--clean"').replace('title="في تغييرات مش منشورة"', 'title="الموقع متحدث"')
    .replace('<span class="status__text">في تغييرات مش منشورة</span>', '<span class="status__text">الموقع متحدث</span>');
  if (q.get('bell') === '1') s = s.replace('<span class="topbar__dot">١</span>', '<span class="topbar__dot">٢</span>');
  s = s.replace('<nav class="tabs" id="subtabs" aria-label="الأقسام الفرعية" hidden=""></nav>',
    `<nav class="tabs" id="subtabs" aria-label="الأقسام الفرعية">${TABS.map(([k, w]) => `<button class="tab" type="button" data-go="?s=${k}" ${k === S.s ? 'aria-current="page"' : ''}>${w}</button>`).join('')}</nav>`);
  const a = s.indexOf('<main class="view"'), b = s.indexOf('</main>', a) + 7;
  return s.slice(0, a) + `<main class="view" id="view" data-area="bread"><div class="ba" style="--i: 0;">${view}</div></main>` + s.slice(b);
}

/* ---------- small builders (the panel's own markup) ---------- */
const card = (icon, title, hint, acts, body, cls = '', tone = '') =>
  `<section class="card p8-card ${cls}"><div class="p8-card__head"><span class="chipico${tone ? ' chipico--' + tone : ''}" aria-hidden="true">${ic(icon)}</span><div class="p8-card__titles"><h2 class="card__title">${title}</h2>${hint ? `<p class="card__hint">${hint}</p>` : ''}</div>${acts ? `<div class="p8-card__acts">${acts}</div>` : ''}</div>${body}</section>`;
const btn = (label, icon, kind = '', attrs = '') => `<button class="btn${kind ? ' ' + kind : ''}" type="button" ${attrs}>${icon ? ic(icon) : ''}${label}</button>`;
const tag = (t, tone = 'info') => `<span class="p8-tag p8-tag--${tone}">${t}</span>`;
const sw = (on, label) => `<label class="switch switch--bare"><input type="checkbox" ${on ? 'checked' : ''} aria-label="${label || ''}"><span class="switch__track" aria-hidden="true"></span></label>`;
const setrow = (label, hint, ctl) => `<div class="setrow"><div class="setrow__text"><b class="setrow__label">${label}</b>${hint ? `<small class="setrow__hint">${hint}</small>` : ''}</div><div class="setrow__ctl">${ctl}</div></div>`;
const setcard = (icon, title, hint, rows, act = '') => `<section class="card setcard"><div class="setcard__head"><span class="chipico" aria-hidden="true">${ic(icon)}</span><div class="setcard__titles"><h2 class="card__title">${title}</h2>${hint ? `<p class="card__hint">${hint}</p>` : ''}</div>${act}</div>${rows}</section>`;
const kpi = (icon, label, value, hint) => `<div class="kpi"><small>${ic(icon, 'ico-sm')}${label}</small><b>${value}</b>${hint ? `<small class="kpi__hint">${hint}</small>` : ''}</div>`;

/* ---------- البرامج ---------- */
const DAY = { running: 5, ending7: 23, ending3: 27, ending1: 29 };
function track(day, n = PROGRAM.days) {
  let t = '';
  for (let i = 1; i <= n; i++) t += `<i class="${i < day ? 'is-done' : i === day ? 'is-today' : ''}${i > n - 3 && i > day ? ' is-last' : ''}" title="اليوم ${AR(i)}"></i>`;
  return `<div class="ba-track" style="--n:${n}" aria-label="اليوم ${AR(day)} من ${AR(n)}">${t}</div><div class="ba-track__legend"><span>بدأ الاتنين ١٠ نوفمبر</span><span>بيخلص الأربع ٩ ديسمبر</span></div>`;
}
function alertFor(st) {
  if (!/ending/.test(st)) return '';
  const left = { ending7: 7, ending3: 3, ending1: 1 }[st];
  const tone = left === 1 ? 'danger' : 'warn';
  return `<div class="ba-alert ba-alert--${tone}" role="status"><span class="chipico chipico--${tone === 'danger' ? 'danger' : 'warn'}" aria-hidden="true">${ic('alert')}</span>
    <div class="ba-alert__text"><b>${left === 1 ? 'بكره آخر يوم في «خبز الحياة»' : `فاضل ${AR(left)} أيام على نهاية «خبز الحياة»`}، ومفيش برنامج بعده</b>
    <small>من غير برنامج جاي، الشباب هيلاقوا «خلّصنا 🤍» ومش هتوصلهم إشعارات. التنبيه ده بيوصل لكل اللي عندهم صلاحية «محتوى خبزنا اليومي».</small></div>
    <span class="ba-steps-left" aria-hidden="true"><span class="${left === 7 ? 'is-on' : ''}">٧</span><span class="${left === 3 ? 'is-on' : ''}">٣</span><span class="${left === 1 ? 'is-on' : ''}">١</span></span>
    ${btn('ارفع البرنامج الجاي', 'upload', 'btn--primary')}</div>`;
}
function past() {
  const rows = [['سلسلة «أمثال المسيح»', '٢١ يوم', '١٬٨٤٠', '١٬٢٢٠', '٣١٢'], ['«صلوات قصيرة» — أسبوع الصوم', '٧ أيام', '٦٩٠', '٥٠٢', '٨٨']];
  return card('history', 'البرامج اللي فاتت', 'الاسم والأرقام بس. المحتوى والتأملات بيتمسحوا بعد ٩٠ يوم من النهاية.', '',
    `<ul class="p8-list">${rows.map(r => `<li class="p8-item ba-past"><div class="p8-item__main"><b>${r[0]}</b><span class="ba-nums"><span>${r[1]}</span><span>فتح <b>${r[2]}</b></span><span>قروا <b>${r[3]}</b></span><span>تأملات <b>${r[4]}</b></span></span></div></li>`).join('')}</ul>`);
}
function next(st) {
  if (st === 'running') return card('calendar', 'البرنامج الجاي', 'بيبدأ لوحده لما الحالي يخلص', btn('شوف المواضيع', 'eye', 'btn--sm'),
    `<div class="ba-next"><span class="ba-date"><b>١٠</b><small>ديسمبر</small></span><div><b style="font-size:1.05rem">سلسلة «النور»</b><div class="ba-nums"><span><b>٢١</b> يوم</span><span>بيبدأ الخميس ١٠ ديسمبر</span><span>رفعه مينا · ١٥ نوفمبر</span></div></div></div>`);
  return card('calendar', 'البرنامج الجاي', '', '', `<div class="p8-empty empty-state"><span class="chipico" aria-hidden="true">${ic('calendar')}</span><b>مفيش برنامج جاي لسه</b><small>ارفعه دلوقتي وهيبدأ لوحده بعد «خبز الحياة»، من غير ما حد يستنى.</small>${btn('برنامج جديد', 'plus', 'btn--primary btn--sm')}</div>`);
}
function programs() {
  const st = S.st;
  if (st === 'empty' || st === 'muted') {
    const muted = st === 'muted';
    return `${muted ? '' : `<div class="ba-alert ba-alert--danger" role="status"><span class="chipico chipico--danger" aria-hidden="true">${ic('alert')}</span><div class="ba-alert__text"><b>المحتوى خلص: مفيش برنامج شغال دلوقتي</b><small>«خبز الحياة» خلص امبارح. الشباب شايفين «خلّصنا 🤍»، والإشعارات واقفة لحد ما يترفع برنامج.</small></div>${btn('كتم التنبيه ده', 'bell', 'btn--sm')}${btn('ارفع برنامج', 'upload', 'btn--primary')}</div>`}
      <div class="ba-cols"><div class="ba-stack">${card('bread', 'البرنامج الشغال', '', '', `<div class="p8-empty empty-state"><span class="chipico" aria-hidden="true">${ic('bread')}</span><b>مفيش برنامج شغال</b><small>${muted ? 'التنبيه مكتوم لحد ما يترفع برنامج جديد. الشباب شايفين «خلّصنا 🤍».' : 'ارفع برنامج جديد، وأول ما تفعّله الشباب هيلاقوا كلمة النهارده.'}</small>${btn('برنامج جديد', 'plus', 'btn--primary')}</div>`)}
      ${card('bell', 'تنبيه «المحتوى خلص»', 'تنبيه واحد للأدمنز لما مايبقاش فيه برنامج شغال', '', setrow('كتم التنبيه', muted ? 'مكتوم. بيرجع لوحده أول ما يترفع برنامج.' : 'بيظهر في الجرس وعلى أجهزة الأدمنز', sw(muted, 'كتم التنبيه')))}</div>
      <div class="ba-stack">${next('none')}${past()}</div></div>`;
  }
  const day = DAY[st] || 5, left = PROGRAM.days - day;
  const hero = card('bread', 'البرنامج الشغال', '', `${btn('المواضيع', 'eye', 'btn--sm')}<button class="p8-iconbtn p8-iconbtn--lg" type="button" aria-label="المزيد: إيقاف البرنامج">${ic('dots')}</button>`,
    `<p class="ba-name">سلسلة «خبز الحياة» ${tag('شغال', 'ok')}<small>${AR(PROGRAM.days)} يوم · كل شاب ليه ترتيب مختلف · رفعه مينا</small></p>
     <div class="ba-days"><div class="ba-days__head"><b>${AR(day)}</b><span>من ${AR(PROGRAM.days)} يوم</span><span class="sp"></span>${tag(`فاضل ${AR(left)} يوم`, left <= 3 ? 'danger' : left <= 7 ? 'warn' : 'info')}</div>${track(day)}</div>
     <div class="ba-mini"><div><small>فتحوا النهارده</small><b>١٤٢</b></div><div><small>قروا</small><b>٩٨</b></div><div><small>تأملات النهارده</small><b>١٢</b></div><div><small>مشتركين في الإشعارات</small><b>٢١٠</b></div></div>`, 'ba-hero card--glow');
  return `${alertFor(st)}<div class="ba-cols"><div class="ba-stack">${hero}${past()}</div><div class="ba-stack">${next(st === 'running' ? 'running' : 'none')}
    ${card('info', 'إزاي بيشتغل', '', '', `<ul class="ba-rules"><li>${ic('check')}<span><b>برنامج واحد شغال للكل</b>، وكل شاب بياخد المواضيع بترتيب عشوائي ثابت خاص بيه، من غير تكرار.</span></li><li>${ic('check')}<span>اللي يشترك متأخر بياخد <b>الأيام الباقية بس</b>.</span></li><li>${ic('check')}<span>هتوصلك تنبيهات قبل النهاية بـ<b>٧ و٣ ويوم</b>، علشان البرنامج الجاي يبقى جاهز.</span></li></ul>`)}</div></div>`;
}

/* ---------- برنامج جديد (the wizard) ---------- */
function stepper(step) {
  const steps = ['النموذج', 'الملف', 'المراجعة', 'التفعيل'];
  return `<ol class="stepper" aria-label="خطوات البرنامج الجديد">${steps.map((l, i) => {
    const st = i + 1 < step ? 'done' : i + 1 === step ? 'current' : 'todo';
    return `<li class="stepper__step is-${st}" ${st === 'current' ? 'aria-current="step"' : ''}><span class="stepper__dot" aria-hidden="true">${st === 'done' ? ic('check') : AR(i + 1)}</span><span class="stepper__label">${l}</span></li>`;
  }).join('')}</ol>`;
}
const ROWS = [
  [1, 'أنا هو خبز الحياة', 'يوحنا ٦: ٣٥', 'يوحنا ٦: ٣٢–٣٥', true],
  [2, 'خبزنا كفافنا', 'متى ٦: ١١', 'متى ٦: ٩–١٣', true],
  [3, 'الرب راعيّ', 'مزمور ٢٣: ١', 'مزمور ٢٣: ١–٤', true, 'warn', 'ترقيم فاندايك: ده مزمور ٢٢ في الأجبية. هيظهر جنبه للشباب.'],
  [4, 'تعالوا إليّ', 'متى ١١: ٢٨', 'متى ١١: ٢٨–٣٠', false],
  [5, 'سراج لرجلي', 'مزمور ١١٩: ١٠٥', 'مزمور ١١٩: ١٠٥', true, 'warn', 'ترقيم فاندايك: ده مزمور ١١٨ في الأجبية.'],
  [6, 'اثبتوا فيّ', 'يوحنا ١٥: ٥', 'يوحنا ١٥: ٤–٥', true],
  [7, 'اطلبوا أولًا', 'متى ٦: ٣٣', 'متى ٦: ٣٣–٣٤', true],
  [8, 'نور العالم', 'يوحنا ٨: ١٢', 'يوحنا ٨: ١٢–٢٠', true],
  [9, 'الكرمة الحقيقية', 'يوحنا ١٥: ١', 'يوحنا ٦: ٧٥–٧٨', true, 'err', 'يوحنا ٦ فيه ٧١ عدد بس، فـ«٧٥–٧٨» مش موجودين. صلّح المرجع في الملف.'],
  [10, 'سلامي أعطيكم', 'يوحنا ١٤: ٢٧', 'يوحنا ١٤: ٢٥–٢٧', true],
  [11, '', 'لوقا ١٥: ٢٠', 'لوقا ١٥: ١١–٢٤', true, 'err', 'العنوان فاضي. كل يوم محتاج عنوان قصير.'],
  [12, 'الراعي الصالح', 'يوحنا ١٠: ١١', 'يوحنا ١٠: ١١–١٦', true]
];
function wizard() {
  const head = card('upload', 'برنامج جديد', 'ملف Excel واحد: كل صف يوم. النص الكتابي بيتجاب من ترجمة فاندايك المعتمدة بالمرجع، مش بيتكتب بإيد.', '', `<div class="ba-wiz-head">${stepper(S.step)}</div>`);
  if (S.step === 1) {
    return `${head}<div class="ba-cols ba-cols--even">${card('sheet', 'النموذج', 'نزّله، املاه، وارفعه في الخطوة الجاية', `${btn('نزّل النموذج (Excel)', 'download', 'btn--primary')}`,
      `<div class="ba-xl"><table><thead><tr><th>#</th><th>العنوان</th><th>مرجع الآية</th><th>القراءة</th><th>التأمل</th><th class="opt">السؤال (اختياري)</th></tr></thead><tbody>
        <tr><td>١</td><td>أنا هو خبز الحياة</td><td>يوحنا ٦: ٣٥</td><td>يوحنا ٦: ٣٢–٣٥</td><td>الجوع اللي جوانا…</td><td>إيه الحاجة اللي…</td></tr>
        <tr><td>٢</td><td>خبزنا كفافنا</td><td>متى ٦: ١١</td><td>متى ٦: ٩–١٣</td><td>كلمة «كفافنا»…</td><td></td></tr>
        <tr><td>٣</td><td>الرب راعيّ</td><td>مزمور ٢٣: ١</td><td>مزمور ٢٣: ١–٤</td><td>الراعي مش بس…</td><td>إمتى حسّيت…</td></tr></tbody></table></div>`)}
      ${card('info', 'قبل ما تملاه', '', '', `<ul class="ba-rules"><li>${ic('check')}<span><b>كل صف = يوم.</b> البرنامج أي مدة لحد ١٢٠ يوم، وعدد المواضيع = عدد الأيام.</span></li><li>${ic('check')}<span><b>اكتب المرجع بس</b> («يوحنا ٦: ٣٢–٣٥»)، والنص بييجي من فاندايك لوحده. ده بيمنع أي غلط في كلام الكتاب.</span></li><li>${ic('check')}<span><b>المزامير بترقيم فاندايك</b>، ورقم الأجبية بيظهر جنبه لوحده.</span></li><li>${ic('check')}<span><b>السؤال اختياري.</b> اليوم اللي مفيهوش سؤال بيظهر فيه «تأملك النهارده» بس.</span></li><li>${ic('check')}<span>الـ٦٦ سفر بس دلوقتي (الأسفار القانونية الثانية لسه).</span></li></ul>`)}</div>
      <div class="ba-actions">${btn('عندي الملف، كمّل', 'arrow', 'btn--primary')}</div>`;
  }
  if (S.step === 2) {
    return `${head}<div class="ba-cols ba-cols--even"><div class="ba-stack">${card('upload', 'الملف', '', '', `<div class="ba-drop"><span class="chipico" aria-hidden="true">${ic('upload')}</span><b>اسحب ملف الـExcel هنا</b><small>أو</small>${btn('اختار ملف', 'sheet', 'btn--primary')}<small>.xlsx · لحد ١٢٠ صف</small></div>
      <div class="ba-file" style="margin-top:14px"><span class="chipico" aria-hidden="true">${ic('sheet')}</span><div><b>khobzna-noor.xlsx</b><small>بيقرا الصفوف ويجيب النصوص من فاندايك… ١٨ من ٢١</small><div class="ba-bar"><i style="--v:86%"></i></div></div></div>`)}</div>
      <div class="ba-stack">${card('edit', 'اسم البرنامج', 'بيظهر للشباب أول يوم، وفي الإحصائيات', '', `<label class="field"><span class="field__label">الاسم</span><input class="input" value="سلسلة «النور»"><span class="field__hint">قصير، زي «سلسلة النور» أو «أسبوع الصلاة»</span></label>`)}
      <p class="ba-note">${ic('lock')}<span>الملف بيتقري على جهازك. اللي بيتبعت للسيرفر هو المواضيع جاهزة بعد المراجعة بس.</span></p></div></div>`;
  }
  if (S.step === 3) {
    const rows = S.err ? ROWS : ROWS.map(r => r.slice(0, 5).concat(r[5] === 'warn' ? r.slice(5) : []));
    const errs = rows.filter(r => r[5] === 'err').length, warns = rows.filter(r => r[5] === 'warn').length;
    const table = `<div class="p8-tablewrap"><table class="p8-table ba-table"><thead><tr><th scope="col">اليوم</th><th scope="col">العنوان</th><th scope="col">الآية</th><th scope="col">القراءة</th><th scope="col">سؤال</th></tr></thead><tbody>
      ${rows.map(r => `<tr class="${r[5] === 'err' ? 'is-err' : r[5] === 'warn' ? 'is-warn' : ''}${r[0] === S.day ? ' is-on' : ''}"><td>${AR(r[0])}</td><td><b>${r[1] || '<span class="ba-no">— فاضي —</span>'}</b>${r[5] ? `<div class="ba-why ba-why--${r[5]}">${ic(r[5] === 'err' ? 'alert' : 'info')}<span>${r[6]}</span></div>` : ''}</td><td class="ba-ref">${r[2]}</td><td class="ba-ref ${r[5] === 'err' && /يوحنا ٦: ٧٥/.test(r[3]) ? 'ba-ref--bad' : ''}">${r[3]}</td><td>${r[4] ? `<span class="ba-yes">${ic('check')}</span>` : '<span class="ba-no">—</span>'}</td></tr>`).join('')}
      <tr><td colspan="5" class="ba-no" style="text-align:center">… و٩ أيام كمان</td></tr></tbody></table></div>`;
    const t = TOPICS[(S.day - 1) % TOPICS.length];
    return `${head}<div class="ba-sum">${tag(`${AR(21)} يوم`, 'info')}${tag(`${AR(21 - errs - warns)} سليم`, 'ok')}${warns ? tag(`${AR(warns)} ملاحظة`, 'warn') : ''}${errs ? tag(`${AR(errs)} لازم يتصلّحوا`, 'danger') : ''}<span class="sp"></span>${btn('ارفع ملف تاني', 'upload', 'btn--sm')}${btn('التالي: التفعيل', 'arrow', 'btn--primary btn--sm', errs ? 'disabled aria-disabled="true"' : '')}</div>
      ${errs ? `<div class="ba-alert ba-alert--danger"><span class="chipico chipico--danger" aria-hidden="true">${ic('alert')}</span><div class="ba-alert__text"><b>صلّح الصفين الحمر في الملف وارفعه تاني</b><small>مفيش حاجة بتتحفظ لحد ما الملف كله يبقى سليم. الملاحظات الصفرا مش بتمنع.</small></div></div>` : ''}
      <div class="ba-cols ba-cols--review">${card('sheet', 'المراجعة', 'دوس على أي يوم تشوفه زي ما الشباب هيشوفوه', '', table)}
      ${card('phone', `معاينة يوم ${AR(S.day)}`, t.title, '', `<div class="ba-phone"><div class="ba-phone__screen"><iframe src="member.html?s=today&intro=0&t=${(S.day - 1) % TOPICS.length}&acct=none" title="معاينة" loading="lazy" tabindex="-1"></iframe></div></div>
        <div class="ba-cmp">${btn('قارن بالأنبا تكلا', 'external', 'btn--sm')}${btn('اليوم الجاي', 'arrow', 'btn--sm')}</div>`)}</div>`;
  }
  // step 4: activation
  const now = S.mode === 'now';
  const body = `<div class="ba-choices">
    <label class="ba-choice"><input type="radio" name="when" ${now ? '' : 'checked'}><span class="ba-choice__top"><span class="ba-radio"></span><b>بعد البرنامج الحالي</b>${tag('المقترح', 'acc')}</span>
      <p>«النور» يبدأ لوحده <b>الخميس ١٠ ديسمبر</b>، اليوم اللي بعد نهاية «خبز الحياة». مفيش حد هيفوّت يوم.</p><span class="ba-timeline"><i class="a"></i><i class="b"></i></span></label>
    <label class="ba-choice ba-choice--danger"><input type="radio" name="when" ${now ? 'checked' : ''}><span class="ba-choice__top"><span class="ba-radio"></span><b>استبدال دلوقتي</b></span>
      <p>«خبز الحياة» يقف <b>النهارده</b> عند اليوم ٥، والكل يبدأ «النور» من بكره. الأيام اللي فاضلة من الحالي مش هتترحّل.</p><span class="ba-timeline"><i class="a" style="flex:1"></i><i class="x"></i><i class="b"></i></span></label></div>`;
  const facts = `<div class="ba-facts" style="margin-top:16px"><div><small class="muted">البرنامج</small><b>سلسلة «النور» · ٢١ يوم</b></div><div><small class="muted">بيبدأ</small><b>${now ? 'بكره، الأربع ١٨ نوفمبر' : 'الخميس ١٠ ديسمبر'}</b></div><div><small class="muted">الإشعارات</small><b>في مواعيد كل شاب، زي ما هي</b></div></div>`;
  return `${head}${card('check', 'التفعيل', 'إمتى البرنامج الجديد يبدأ؟', '', body + facts)}<div class="ba-actions">${btn('رجوع', '', 'btn--sm')}${btn(now ? 'استبدل وفعّل' : 'فعّل البرنامج', 'check', now ? 'btn--danger' : 'btn--primary')}</div>`;
}
function typedConfirm() {
  return `<dialog class="modal modal--danger" id="confirm" aria-labelledby="mt"><span class="modal__icon" aria-hidden="true">${ic('alert')}</span><h2 class="modal__title" id="mt">استبدال «خبز الحياة» دلوقتي؟</h2>
    <p class="modal__text">البرنامج الحالي هيقف النهارده عند اليوم ٥، و«النور» يبدأ للكل من بكره. الخطوة دي مبترجعش.</p>
    <label class="field modal__typed-field"><span class="field__label">اكتب «استبدال» علشان تأكد</span><input class="input modal__typed" type="text" placeholder="استبدال" value="استبد"></label>
    <div class="modal__actions"><button class="btn" type="button">إلغاء</button><button class="btn btn--danger" type="button" disabled>استبدل</button></div></dialog>`;
}

/* ---------- الإحصائيات ---------- */
function stats() {
  const days = [[60, 41], [72, 50], [58, 39], [80, 61], [91, 70], [77, 52], [69, 47], [96, 71], [88, 66], [101, 79], [93, 70], [118, 85], [126, 90], [142, 98]];
  const max = 150;
  const chart = `<div class="ba-chart" role="img" aria-label="الفتح والقراءة آخر ١٤ يوم">${days.map((d, i) => `<div class="ba-chart__day${i === 13 ? ' is-today' : ''}"><div class="ba-chart__bars"><i class="o" style="--o:${d[0] / max * 100}%"></i><i class="r" style="--r:${d[1] / max * 100}%"></i></div><small>${i === 13 ? 'النهارده' : AR(4 + i)}</small></div>`).join('')}</div>`;
  const top = [['أنا هو خبز الحياة', 86], ['الرب راعيّ', 81], ['تعالوا إليّ', 74], ['اثبتوا فيّ', 69], ['خبزنا كفافنا', 63]];
  return `<div class="grid g4 kpis" aria-label="الأرقام النهارده">${kpi('eye', 'فتحوا النهارده', '١٤٢', '+١٦ عن امبارح')}${kpi('check', 'دوسوا «قريت»', '٩٨', '٦٩٪ من اللي فتحوا')}${kpi('heartchat', 'تأملات النهارده', '١٢', '')}${kpi('bell', 'مشتركين في الإشعارات', '٢١٠', 'على ٢٦٤ جهاز')}</div>
    <div class="ba-cols"><div class="ba-stack">${card('chart', 'آخر ١٤ يوم', '', `<div class="ba-legend"><span><i style="background:rgb(var(--acc-rgb)/.35)"></i>فتحوا</span><span><i style="background:var(--acc)"></i>قروا</span></div>`, chart)}
      ${card('bread', 'المواضيع الأكتر تفاعل', 'نسبة اللي دوسوا «قريت» من اللي فتحوا الموضوع', '', `<div class="ba-meter">${top.map(t => `<div class="ba-meter__row"><span>${t[0]}</span><b>${AR(t[1])}٪</b><div class="ba-bar"><i style="--v:${t[1]}%"></i></div></div>`).join('')}</div>`)}</div>
    <div class="ba-stack">${card('bell', 'إشعارات النهارده', '', '', `<div class="ba-facts ba-facts--2"><div><small class="muted">اتبعتت</small><b>٢٤١</b></div><div><small class="muted">اتفتحت من الإشعار</small><b>٩٦ · ٤٠٪</b></div><div><small class="muted">أكتر ميعاد</small><b>٨:٠٠ ص</b></div><div><small class="muted">أجهزة اتشالت (توكن قديم)</small><b>٣</b></div></div>`)}
      ${card('users', 'المشتركين', '', '', `<div class="ba-facts ba-facts--2"><div><small class="muted">بحساب</small><b>١٣٢</b></div><div><small class="muted">من غير حساب</small><b>٧٨</b></div><div><small class="muted">اشتركوا متأخر</small><b>٢٧</b></div><div><small class="muted">قفلوا الإشعارات</small><b>٩</b></div></div>`)}
      <p class="ba-note">${ic('lock')}<span>أرقام إجمالية بس. مفيش أسماء ولا «مين فتح ومين لأ»، والفتح الفردي بيتمسح بعد ٣٠ يوم.</span></p></div></div>`;
}

/* ---------- التأملات ---------- */
function reflections() {
  if (q.get('perm') === '0') return card('lock', 'التأملات', '', '', `<div class="p8-empty empty-state"><span class="chipico" aria-hidden="true">${ic('lock')}</span><b>التأملات محتاجة صلاحية «تأملات خبزنا اليومي»</b><small>دي كلام شخصي عن الإيمان، فبتتشاف بصلاحية لوحدها. اطلبها من الأدمن الأساسي في «الفريق والصلاحيات».</small></div>`);
  const items = [
    ['النهارده', [['م', 'مارك سامي', 'eligible', '٩:٣٨ ص', 'أنا هو خبز الحياة', 'حاسس إني بدوّر على الشبع في الموبايل والسوشيال، وبعدها بحس بفراغ أكتر. محتاج أبدأ يومي بكلمة من ربنا قبل أي حاجة.', ''],
      ['ك', 'كيرلس عادل', 'guest', '٨:١٢ ص', 'الرب راعيّ', 'السنة دي كانت صعبة في الدراسة، بس فعلًا في كل مرة كنت بحس إني لوحدي كان فيه حد بيبعته ربنا.', 'اتعدّل']]],
    ['امبارح', [['م', 'مريم جرجس', 'eligible', '١٠:٤٠ م', 'تعالوا إليّ', 'الآية دي ريحتني. كنت شايلة حاجات كتير لوحدي.', '']]]
  ];
  return `<p class="ba-private">${ic('shield')}<span><b>التأملات دي خاصة.</b> بتوصل لأصحاب الصلاحية بس، وكل فتح للصفحة دي بيتسجل في «سجل النشاط». بتتمسح بعد نهاية البرنامج بـ٩٠ يوم.</span></p>
    ${card('heartchat', 'التأملات', '١٢ النهارده · ٣١٢ في البرنامج', '', `<div class="p8-card__filters"><div class="seg p8-filter filter-chips" role="group" aria-label="الموضوع"><button class="filter-chip seg__btn" type="button" aria-pressed="true">الكل</button><button class="filter-chip seg__btn" type="button" aria-pressed="false">النهارده</button><button class="filter-chip seg__btn" type="button" aria-pressed="false">بسؤال</button></div><label class="p8-search">${ic('eye')}<input class="p8-search__input" type="search" placeholder="دوّر في التأملات…" aria-label="دوّر في التأملات"></label></div>
      <div class="ba-refl">${items.map(([day, list]) => `<p class="ba-day-head">${day}</p>${list.map(r => `<article class="ba-refl-item"><span class="ba-arch" aria-hidden="true">${r[0]}</span><header><b>${r[1]}</b>${r[2] === 'guest' ? tag('ضيف', 'acc') : ''}<small>${r[3]} · ${r[4]}</small>${r[6] ? `<small class="edited">· ${r[6]}</small>` : ''}</header><p>${r[5]}</p></article>`).join('')}`).join('')}</div>`)}`;
}

/* ---------- الإعدادات ---------- */
function settings() {
  const preview = `<div class="ba-push" aria-label="شكل الإشعار"><div class="ba-push__top"><img src="identity/png/icon-192.png" alt="">أسرة البابا أثناسيوس · خبزنا اليومي · ٨:٠٠ ص</div><b>أنا هو خبز الحياة</b><p>«أنا هو خبز الحياة. من يقبل إليّ فلا يجوع…» — يوحنا ٦: ٣٥</p></div>`;
  return `<div class="ba-cols ba-cols--even"><div class="ba-stack">
    ${setcard('bell', 'إشعارات الشباب', 'المواعيد بتوقيت مصر', setrow('الميعاد الافتراضي', 'أول ما حد يشغّل «فكّرني»', '<input class="input ba-time" value="٨:٠٠ ص" aria-label="الميعاد الافتراضي">') +
      setrow('أقصى عدد مواعيد لكل شخص', '', '<div class="seg" role="radiogroup" aria-label="أقصى عدد"><label class="seg__opt"><input type="radio" name="mx"><span>١</span></label><label class="seg__opt"><input type="radio" name="mx"><span>٢</span></label><label class="seg__opt"><input type="radio" name="mx" checked><span>٣</span></label></div>') +
      `<div class="setrow" style="display:block"><label class="field"><span class="field__label">نص الإشعار</span><textarea class="input ba-tpl" aria-label="نص الإشعار">{العنوان}
«{أول الآية}…» — {المرجع}</textarea><span class="field__hint">كل شاب بيوصله عنوان موضوعه هو. دوس على كلمة تحطها:</span></label><div class="ba-tokens"><span class="ba-token">{العنوان}</span><span class="ba-token">{أول الآية}</span><span class="ba-token">{المرجع}</span><span class="ba-token">{اسم البرنامج}</span></div><div style="margin-top:14px">${preview}</div></div>`)}
    </div><div class="ba-stack">
    ${setcard('alert', 'تنبيهات الأدمن', 'بتظهر في الجرس وعلى أجهزة الأدمنز اللي عندهم الصلاحية', setrow('قبل النهاية بـ٧ و٣ ويوم', 'لو مفيش برنامج جاي متجدول', sw(true, 'قبل النهاية')) + setrow('«المحتوى خلص»', 'تنبيه واحد، وتقدر تكتمه لحد ما يترفع برنامج', sw(true, 'المحتوى خلص')))}
    ${setcard('lock', 'التأملات والخصوصية', '', setrow('مين يشوف التأملات', 'صلاحية «تأملات خبزنا اليومي». دلوقتي: الأدمن الأساسي بس', btn('الفريق والصلاحيات', 'users', 'btn--small')) + setrow('بتتحفظ لحد إمتى', 'نهاية البرنامج + ٩٠ يوم، وبعدها بتتمسح لوحدها', '<span class="chip chip--info">٩٠ يوم</span>') + setrow('التعديل والمسح', 'أول ٢٠ دقيقة بعد الإرسال بس', '<span class="chip chip--info">٢٠ دقيقة</span>'))}
    ${setcard('bread', 'القسم في الموقع', '', setrow('«خبزنا اليومي» على الموقع', 'بيتفتح يوم الإطلاق (W7)، بعد تجربة Staging', '<span class="chip chip--off">مقفول</span>') + setrow('الكارت في الرئيسية واللينك في القايمة', '/daily-bread/', '<span class="chip chip--off">مع فتح القسم</span>'))}
  </div></div>`;
}

/* ---------- the bell ---------- */
function bellMenu() {
  return `<div class="menu menu--bell" popover="manual" role="menu" id="bellmenu"><p class="menu__title">اللي مستنيك</p>
    <button class="menu__item menu__item--wait" type="button" role="menuitem">${ic('bread')}<span><b>«خبز الحياة» فاضله ٣ أيام</b><small>ومفيش برنامج جاي · ارفعه دلوقتي</small></span></button>
    <button class="menu__item" type="button" role="menuitem">${ic('heartchat')}<span><b>١٢ تأمل جديد النهارده</b><small>خبزنا اليومي · التأملات</small></span></button></div>`;
}

const V = { programs, new: wizard, stats, reflections, settings }[S.s] || programs;
document.body.innerHTML = shell(V()) + (q.get('bell') === '1' ? bellMenu() : '') + (S.s === 'new' && S.step === 4 && q.get('confirm') === '1' ? typedConfirm() : '');

/* the rail's light under the current area (the panel does this in A.railLight) */
requestAnimationFrame(() => {
  const nav = document.getElementById('rail-nav'), on = nav && nav.querySelector('[data-area="bread"]'), light = nav && nav.querySelector('.rail__light');
  if (on && light) { light.style.transform = `translateY(${on.offsetTop}px)`; light.style.height = on.offsetHeight + 'px'; }
  const bm = document.getElementById('bellmenu');
  if (bm) { bm.showPopover(); const b = document.getElementById('bell-open').getBoundingClientRect(); bm.style.top = (b.bottom + 8) + 'px'; bm.style.left = Math.max(8, b.left - 10) + 'px'; }
  const c = document.getElementById('confirm'); if (c) c.showModal();
  document.documentElement.dataset.ready = '1';
});
document.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g) location.search = g.dataset.go; });
