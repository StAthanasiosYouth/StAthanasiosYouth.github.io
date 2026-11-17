/*
 * «خبزنا اليومي» — W1 member prototype: every member screen and state, as a layer on the live site's CSS
 * (assets/css/main.css + nav.css, the site's real top bar / widgets / buttons / tab bar markup) + w1/bread.css.
 *
 *   ?s=today      the reading page (default)
 *       &acct=none|eligible|guest   &refl=empty|typing|sent|edit|locked   &read=1   &t=<topic 0–6>
 *       &late=19 (a late joiner)    &look=dawn   &size=1–4   &plain=1 (no tashkeel)   &share=1   &signin=1
 *   ?s=reminders  «إشعاراتي»      &rem=off|on|denied|ios
 *   ?s=empty      the program is over / no program yet
 *   ?s=notif      the notification on Android, iPhone and a computer
 *   &intro=1      play the intro first (&sound=a|b|off, &hold=<ms> freezes it for a screenshot)
 *   &lab=1        the review panel: replay the intro, pick the sound, try the entry rules
 * Nothing here talks to a server. Sample content: ../prototype/data.js (the study's; Scripture typed for preview only).
 */
import { PROGRAM, TOPICS } from '../prototype/data.js';
import { iconSvg } from '../../../assets/js/icons.js';
import { bi } from './icons-bread.js';
import { playIntro, shouldPlayOnLoad } from './intro.js';
import { SAMPLES } from './sound.js';

const q = new URLSearchParams(location.search);
const html = document.documentElement;
const S = {
  s: q.get('s') || 'today',
  acct: q.get('acct') || 'eligible',
  refl: q.get('refl') || 'empty',
  read: q.get('read') === '1',
  t: +(q.get('t') || 0) % TOPICS.length,
  late: +(q.get('late') || 0),
  rem: q.get('rem') || 'on',
  sound: q.get('sound') || 'a',
  plain: q.get('plain') === '1',
  size: q.get('size') || '2'
};
if (q.get('look')) html.dataset.look = q.get('look');
html.dataset.size = S.size;
html.dataset.motion = q.get('motion') || 'full';
html.dataset.tint = 'gold';
html.classList.add('has-tabbar');

const AR = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
const strip = s => s.replace(/[ً-ْٰ]/g, '');
const topic = TOPICS[S.t];
const DAY = PROGRAM.day, DAYS = PROGRAM.days;
const NAME = 'مارك';
const IMG = { mark: 'identity/png/icon-192.png', logo: 'identity/svg/logo-b-family.svg', pushImg: 'identity/png/push-image-1024x512.png', badge: 'identity/png/push-badge-96.png' };
const app = document.getElementById('app');
const si = n => iconSvg(n);

/* ---------------- chrome: the site's own top bar and tab bar ---------------- */

function topbar() {
  return `<header class="topbar" id="topbar"><div class="topbar__inner">
    <a class="br-brand" href="../../../index.html" aria-label="خبزنا اليومي — ارجع للموقع">
      <span class="br-brand__back" aria-hidden="true">${bi('back')}</span>
      <img class="br-brand__mark" id="brand-mark" src="${IMG.mark}" width="38" height="38" alt="">
      <span><span class="br-brand__name">خبزنا اليومي</span><span class="br-brand__sub">كلمة من الإنجيل تقوّيك كل يوم</span></span>
    </a>
    <div class="topbar__actions">
      <button class="topbar__btn" type="button" aria-pressed="true" aria-label="أصوات الواجهة: شغالة">${bi('sound')}</button>
      <a class="topbar__btn" href="?s=reminders" data-nav="reminders" aria-label="إشعاراتي">${bi('remind')}</a>
      <a class="acct-badge topbar__btn" href="#" aria-label="حسابي"><span class="acct-badge__face">${S.acct === 'none' ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1-4.4 4-6 8-6s7 1.6 8 6"></path></svg>' : `<b class="br-acct-i">${NAME[0]}</b>`}</span></a>
    </div>
  </div></header>`;
}

function tabbar(on) {
  const tab = (key, icon, word, href) => `<a class="tabbar__tab" href="${href}" data-tab="${key}" ${key === on ? 'aria-current="page"' : ''}>${icon}<span class="tabbar__word">${word}</span></a>`;
  return `<nav class="tabbar" aria-label="أقسام خبزنا اليومي"><span class="tabbar__lens" aria-hidden="true"></span><div class="tabbar__slots">
    ${tab('today', bi('bread'), 'النهارده', '?s=today')}${tab('reminders', bi('remind'), 'إشعاراتي', '?s=reminders')}${tab('site', bi('home'), 'الموقع', '../../../index.html')}
  </div><a class="acct-badge tabbar__tab tabbar__fixed" href="#" data-tab="account"><span class="acct-badge__face">${S.acct === 'none' ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1-4.4 4-6 8-6s7 1.6 8 6"></path></svg>' : `<b class="br-acct-i">${NAME[0]}</b>`}</span><span class="tabbar__word">حسابي</span></a></nav>`;
}

function placeLens() {
  const bar = document.querySelector('.tabbar'), cur = bar && bar.querySelector('[aria-current]'), lens = bar && bar.querySelector('.tabbar__lens');
  if (!cur || !lens) return;
  const b = bar.getBoundingClientRect(), c = cur.getBoundingClientRect();
  Object.assign(lens.style, { width: c.width + 'px', height: c.height + 'px', transform: `translate(${c.left - b.left - 1}px, ${c.top - b.top - 1}px)`, opacity: 1 });
}

const HILLS = `<svg class="br-dawn__hills" viewBox="0 0 1000 96" preserveAspectRatio="none" aria-hidden="true">
  <path d="M0,40 C120,10 220,22 300,34 C380,8 460,12 540,32 C640,6 760,10 1000,36 V96 H0 Z" fill="#5d5a73" opacity=".55"/>
  <path class="h2" d="M0,70 C160,44 300,58 420,68 C560,50 720,46 1000,62 V96 H0 Z"/>
  <path class="h3" d="M0,86 C200,74 800,74 1000,86 V96 H0 Z"/></svg>`;

/* ---------------- the reading page ---------------- */

function dateText() {
  const d = new Date(2026, 10, 12 + DAY);
  return ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'][d.getDay()] + ' ' + AR(d.getDate()) + ' نوفمبر';
}

function dawn() {
  const verse = S.plain ? strip(topic.verse) : topic.verse;
  return `<section class="br-dawn" aria-labelledby="br-title">
    <span class="br-dawn__rays" aria-hidden="true"></span>
    <p class="br-day" style="--d:0">${dateText()} <i></i> اليوم ${AR(S.late ? 1 : DAY)} من ${AR(S.late || DAYS)}</p>
    <h1 class="br-title" id="br-title" style="--d:1">${topic.title}</h1>
    <p class="br-verse" style="--d:2"><q>${verse}</q></p>
    <p class="br-ref" style="--d:3">${topic.verseRef}</p>
    <div class="br-dawn__acts" style="--d:4">
      <button class="btn btn--small br-glass" type="button" data-act="share">${si('share')}شارك الآية</button>
      <button class="btn btn--small br-glass" type="button" data-act="copy">${si('copy')}انسخ</button>
    </div>
    ${HILLS}
  </section>`;
}

function paper() {
  const verseNum = +(topic.verseRef.match(/[٠-٩]+$/) || ['0'])[0].replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  const body = topic.reading.map(([n, text]) => {
    const t = S.plain ? strip(text) : text;
    return `<sup>${AR(n)}</sup>${n === verseNum && topic.reading.length > 1 ? `<mark>${t}</mark>` : t} `;
  }).join('');
  const psalm = /^مزمور ٢٣/.test(topic.readingRef) ? '<span class="br-psalm">مزمور ٢٢ في الأجبية</span>' : /^مزمور ١١٩/.test(topic.readingRef) ? '<span class="br-psalm">مزمور ١١٨ في الأجبية</span>' : '';
  return `<article class="br-paper" style="--d:1" aria-labelledby="br-reading">
    <header class="br-paper__head">
      <span class="br-paper__label">${bi('reading')}<span><small>القراءة</small><b id="br-reading">${topic.readingRef}</b></span></span>
      <span class="br-tools">
        <span class="br-tool br-tool--size" role="group" aria-label="حجم الخط"><span class="s" role="button" tabindex="0" data-act="smaller" aria-label="صغّر الخط">أ</span><span class="l" role="button" tabindex="0" data-act="bigger" aria-label="كبّر الخط">أ</span></span>
        <button class="br-tool" type="button" data-act="plain" aria-pressed="${S.plain}" title="من غير تشكيل" aria-label="من غير تشكيل">${bi('tashkeel')}</button>
        <button class="br-tool" type="button" data-act="look" aria-pressed="${html.dataset.look === 'dawn'}" title="شكل الفجر الفاتح" aria-label="شكل الفجر الفاتح">${bi(html.dataset.look === 'dawn' ? 'moon' : 'sun')}</button>
      </span>
    </header>
    <p class="br-reading">${body}</p>
    <footer class="br-paper__foot">${psalm}<span>ترجمة فاندايك</span><span class="sp"></span><a href="https://st-takla.org/" target="_blank" rel="noopener">التفسير في موقع الأنبا تكلا ${si('external')}</a></footer>
  </article>`;
}

function meditation() {
  return `<section class="widget br-card br-med" style="--d:0"><h2 class="br-kicker">${bi('lantern')}تأمل النهارده</h2><p>${topic.meditation}</p><p class="br-med__by">من خدام الأسرة</p></section>`;
}

function reflectState() {
  const hello = S.acct === 'guest'
    ? `<div class="br-hello"><span class="br-arch">${NAME[0]}</span><div><b>أهلاً بيك يا ${NAME} 🤍 <span class="br-tag br-tag--guest">ضيف</span></b><small>مبسوطين إنك معانا. تأملك بيوصل لخدام الأسرة بس.</small></div></div>`
    : `<div class="br-hello"><span class="br-arch">${NAME[0]}</span><div><b>أهلاً يا ${NAME} 👋</b><small>اكتب اللي جه في بالك، ولو سطر واحد.</small></div></div>`;
  const draft = 'حاسس إني بدوّر على الشبع في الموبايل والسوشيال، وبعدها بحس بفراغ أكتر. محتاج أبدأ يومي بكلمة من ربنا قبل أي حاجة.';
  const priv = `<p class="br-priv">${bi('shield')}<span>تأملك بيوصل لخدام الأسرة بس، ومش بيظهر لحد تاني. تقدر تعدّله أو تمسحه أول ٢٠ دقيقة.</span></p>`;
  if (S.acct === 'none') {
    return `<label class="br-field"><textarea placeholder="اكتب تأملك هنا…" aria-label="تأملك">${S.refl === 'typing' ? draft : ''}</textarea><span class="br-field__count">${AR(S.refl === 'typing' ? draft.length : 0)} / ١٠٠٠</span></label>
      ${priv}<div class="br-acts"><button class="btn btn--primary" type="button" data-act="signin">${bi('lock')}ادخل بحسابك وابعت</button></div>
      <p class="br-keep">القراءة مش محتاجة حساب. الحساب بس علشان تبعت تأملك، واللي كتبته هيفضل محفوظ لحد ما ترجع.</p>`;
  }
  if (S.refl === 'sent' || S.refl === 'locked') {
    const locked = S.refl === 'locked';
    return `${hello.replace(/<small>.*?<\/small>/, `<small>${locked ? 'تأملك وصل لخدام الأسرة 🤍' : 'وصل تأملك 🤍 ربنا يباركك'}</small>`)}
      <div class="br-sent"><p>${draft}</p><p class="br-sent__meta"><span class="ok">${si('check')}اتبعت</span> · النهارده ${locked ? '٩:١٢ ص' : '٩:٣٨ ص'} · لخدام الأسرة بس</p></div>
      ${locked ? `<p class="br-locked">${bi('lock')}<span>عدّت الـ٢٠ دقيقة، فالتأمل اتقفل ومبقاش ينفع يتعدّل أو يتمسح.</span></p>`
      : `<div class="br-timer"><span class="br-ring" style="--p:.72"><svg viewBox="0 0 52 52"><circle class="t" cx="26" cy="26" r="22" pathLength="100"/><circle class="v" cx="26" cy="26" r="22" pathLength="100"/></svg><b>١٤:٢٠</b></span>
          <p class="br-timer__txt"><b>تقدر تعدّل أو تمسح</b><br>لمدة ١٤ دقيقة، وبعدها بيتقفل.</p></div>
        <div class="br-acts" style="margin-top:12px"><button class="btn btn--small" type="button" data-act="edit">${bi('pen')}عدّل</button><button class="btn btn--small btn--ghost-danger" type="button" data-act="delete">${bi('trash')}امسح</button></div>`}`;
  }
  if (S.refl === 'edit') {
    return `${hello}<label class="br-field"><textarea aria-label="عدّل تأملك">${draft}</textarea><span class="br-field__count">${AR(draft.length)} / ١٠٠٠</span></label>
      <div class="br-timer"><span class="br-ring" style="--p:.55"><svg viewBox="0 0 52 52"><circle class="t" cx="26" cy="26" r="22" pathLength="100"/><circle class="v" cx="26" cy="26" r="22" pathLength="100"/></svg><b>١١:٠٢</b></span><p class="br-timer__txt">بتعدّل تأملك. فاضل <b>١١ دقيقة</b> على قفل التعديل.</p></div>
      <div class="br-acts" style="margin-top:12px"><button class="btn btn--primary" type="button" data-act="save">${si('check')}احفظ التعديل</button><button class="btn btn--small" type="button" data-act="cancel">إلغاء</button></div>`;
  }
  return `${hello}<label class="br-field"><textarea placeholder="اكتب تأملك هنا…" aria-label="تأملك">${S.refl === 'typing' ? draft : ''}</textarea><span class="br-field__count">${AR(S.refl === 'typing' ? draft.length : 0)} / ١٠٠٠</span></label>
    ${priv}<div class="br-acts"><button class="btn btn--primary" type="button" data-act="send" ${S.refl === 'typing' ? '' : 'disabled'}>${si('arrow')}ابعت تأملك</button></div>`;
}

function question() {
  const head = topic.question
    ? `<h2 class="br-kicker">${bi('question')}سؤال النهارده<small>اختياري</small></h2><p class="br-q__text">${topic.question}</p><p class="br-q__hint">فكّر فيه طول اليوم… ولو حابب، اكتب تأملك.</p><div class="br-sep"></div>`
    : `<h2 class="br-kicker">${bi('pen')}تأملك النهارده<small>اختياري</small></h2>`;
  return `<section class="widget br-card br-q" id="reflect" style="--d:1">${head}${reflectState()}</section>`;
}

function done() {
  return `<button class="br-done" type="button" data-act="read" aria-pressed="${S.read}" style="--d:2"><span class="br-done__bloom"></span>
    <span class="br-done__ic">${si('check')}</span><span>${S.read ? `<b>ربنا يباركك 🤍</b><small>قريت قراءة النهارده · نشوفك بكره ${S.rem === 'off' ? '' : '٨:٠٠ ص'}</small>` : '<b>قريت قراءة النهارده</b><small>دوس لما تخلّص. ده بس بيفرّحنا، مفيش عدّاد.</small>'}</span></button>`;
}

function remindTeaser() {
  if (S.rem !== 'off') return `<section class="widget br-card" style="--d:3"><div class="br-remind"><span class="br-remind__ic">${bi('remind')}</span><div><b>فكّرني كل يوم</b><small>بنفكّرك ٨:٠٠ ص · <a href="?s=reminders" data-nav="reminders" style="color:var(--gold-hi)">غيّر المواعيد</a></small></div><button class="br-switch" role="switch" aria-checked="true" aria-label="فكّرني كل يوم"></button></div></section>`;
  return `<section class="widget br-card" style="--d:3"><div class="br-remind"><span class="br-remind__ic">${bi('remind')}</span><div><b>فكّرني كل يوم</b><small>إشعار واحد الصبح بكلمة النهارده. تقدر تغيّر الميعاد بعدين.</small></div><button class="br-switch" role="switch" aria-checked="false" aria-label="فكّرني كل يوم"></button></div></section>`;
}

function signature() {
  return `<footer class="br-sig"><img src="${IMG.logo}" alt="خبزنا اليومي"><p><b>إعداد وإشراف أسرة البابا أثناسيوس الرسولي للشباب</b><br>كنيسة أبي سيفين بسفاجا</p></footer>`;
}

function renderToday() {
  const late = S.late ? `<p class="br-note" style="--d:0"><span class="br-note__ic">${bi('sun')}</span><span><b>أهلاً بيك في «${PROGRAM.name.replace(/^سلسلة «|»$/g, '')}» 🤍</b><br>البرنامج بدأ من ${AR(DAYS - S.late)} يوم، فهتشارك في الـ${AR(S.late)} يوم الباقيين. كل يوم كلمة جديدة ليك إنت.</span></p>` : '';
  return `${topbar()}<main id="main">${dawn()}<div class="br-main"><div class="br-side" style="gap:16px">${late}${paper()}</div><div class="br-side">${meditation()}${question()}${done()}${remindTeaser()}</div></div>${signature()}</main>${tabbar('today')}`;
}

/* ---------------- «إشعاراتي» ---------------- */

function renderReminders() {
  const r = S.rem;
  const times = r === 'on' ? [['٨:٠٠', 'ص', 'الصبح'], ['١٠:٠٠', 'م', 'قبل النوم']] : [];
  const notif = `<div class="nf-a br-preview-notif" style="direction:rtl"><div class="nf-a__top"><img src="${IMG.mark}" alt="">أسرة البابا أثناسيوس · خبزنا اليومي · ٨:٠٠ ص</div><div class="nf-a__body"><div><b>${topic.title}</b><p>«${strip(topic.verse).slice(0, 58)}…» — ${topic.verseRef}</p></div><img class="nf-a__thumb" src="${IMG.mark}" alt=""></div></div>`;
  let body = '';
  if (r === 'denied') body = `<p class="br-hint br-hint--warn">${si('alert')}<span><b>الإشعارات مقفولة من المتصفح.</b> افتح إعدادات الموقع في المتصفح (القفل جنب العنوان) ← الإشعارات ← اسمح، وبعدها ارجع هنا.</span></p>`;
  if (r === 'ios') body = `<p class="br-hint">${bi('phone')}<span><b>على iPhone:</b> الإشعارات بتشتغل بس لما الموقع يبقى على الشاشة الرئيسية. دوس زرار المشاركة ⬆︎ ← «إضافة إلى الشاشة الرئيسية»، وافتحه من هناك.</span></p>`;
  return `${topbar()}<main id="main" class="br-sheet-page">
    <div class="br-h1"><span class="br-remind__ic">${bi('remind')}</span><div><h1>إشعاراتي</h1><p>كلمة النهارده توصلك في الميعاد اللي يناسبك.</p></div></div>
    <section class="widget br-card"><div class="br-remind"><div><b>فكّرني كل يوم</b><small>${r === 'on' ? 'شغالة على الجهاز ده' : r === 'denied' ? 'محتاجة إذن من المتصفح' : 'مقفولة دلوقتي'}</small></div><button class="br-switch" role="switch" aria-checked="${r === 'on'}" aria-label="فكّرني كل يوم"></button></div>
      ${body}
      ${r === 'on' ? `<div class="br-times">${times.map(t => `<div class="br-time"><span class="br-time__clock">${si('clock')}</span><div><b>${t[0]} <small style="display:inline;font-size:.9rem">${t[1]}</small></b><small>${t[2]}</small></div><button class="br-time__x" type="button" aria-label="شيل الميعاد ده">${si('close')}</button></div>`).join('')}
        <button class="br-add" type="button">${bi('plus')}ضيف ميعاد (لحد ٣)</button></div>` : ''}
      ${r === 'off' ? `<p class="br-hint" style="margin-top:14px">${si('info')}<span>لما تشغّلها، المتصفح هيسألك مرة واحدة تسمح بالإشعارات. الافتراضي ٨:٠٠ الصبح بتوقيت مصر.</span></p>` : ''}
    </section>
    <section class="widget br-card"><h2 class="br-kicker">${bi('remind')}شكل الإشعار</h2>${notif}<p class="br-hint" style="margin-top:12px">${si('info')}<span>كل يوم: عنوان موضوعك إنت وأول الآية. لو قريت قبل الميعاد التاني، مش هنفكّرك تاني في نفس اليوم.</span></p></section>
  </main>${tabbar('reminders')}`;
}

/* ---------------- the program is over ---------------- */

function renderEmpty() {
  return `${topbar()}<main id="main">
    <section class="br-dawn" style="padding-bottom:70px"><span class="br-dawn__rays" aria-hidden="true"></span>
      <div class="br-rest"><div class="br-rest__logo"><span class="br-rest__glow"></span><img src="${IMG.logo}" alt=""></div>
        <h1>خلّصنا «خبز الحياة» 🤍</h1><p>شكرًا إنك كنت معانا ${AR(DAYS)} يوم. قريب قوي هيبدأ برنامج جديد، وأول ما يبدأ هنفكّرك في نفس ميعادك.</p></div>${HILLS}</section>
    <div class="br-sheet-page" style="margin-top:-30px;position:relative;z-index:1">
      <section class="widget br-card"><div class="br-remind"><span class="br-remind__ic">${bi('remind')}</span><div><b>إشعاراتك لسه شغالة</b><small>هتوصلك أول كلمة من البرنامج الجديد ٨:٠٠ ص</small></div><button class="br-switch" role="switch" aria-checked="true" aria-label="فكّرني"></button></div></section>
      <a class="btn btn--block" href="../../../index.html">${bi('home')}ارجع للموقع</a>
    </div>${signature()}</main>${tabbar('today')}`;
}

/* ---------------- the notification on three systems ---------------- */

function renderNotif() {
  const title = topic.title, body = `«${strip(topic.verse).slice(0, 64)}…» — ${topic.verseRef}`;
  return `${topbar()}<main id="main"><div class="nf-stage">
    <div><p class="nf-cap">Android <small>مفتوح في الإشعارات · بصورة</small></p><div class="nf-android"><div class="nf-android__clock"><span>8:00</span><span>▾ ▴ ▮</span></div>
      <div class="nf-a"><div class="nf-a__top"><img src="${IMG.badge}" alt="" style="background:#0b2a4c;padding:3px">أسرة البابا أثناسيوس · خبزنا اليومي · دلوقتي</div><div class="nf-a__body"><div><b>${title}</b><p>${body}</p></div><img class="nf-a__thumb" src="${IMG.mark}" alt=""></div><img class="nf-a__big" src="${IMG.pushImg}" alt=""><div class="nf-a__acts"><span>اقرا دلوقتي</span><span>بعدين</span></div></div>
      <div class="nf-a"><div class="nf-a__top">رسايل · ٧:٤٢</div></div></div></div>
    <div><p class="nf-cap">iPhone <small>الموقع متثبّت على الشاشة الرئيسية (iOS 16.4+)</small></p><div class="nf-ios"><div class="nf-ios__date">الأربع ١٨ نوفمبر</div><div class="nf-ios__time">8:00</div>
      <div class="nf-i nf-i--back"></div><div class="nf-i"><img src="${IMG.mark}" alt=""><div class="nf-i__top"><span>خبزنا اليومي</span><span>الآن</span></div><b>${title}</b><p>${body}</p></div><span class="nf-ios__bar"></span></div></div>
    <div><p class="nf-cap">الكمبيوتر <small>Chrome على Windows</small></p><div class="nf-desk"><div class="nf-w"><div class="nf-w__top"><img src="${IMG.mark}" alt="">Google Chrome</div><div class="nf-w__body"><img src="${IMG.mark}" alt=""><div><b>${title}</b><p>${body}</p><p class="nf-w__site">stathanasiosyouth.github.io</p></div></div><div class="nf-w__btns"><span>اقرا دلوقتي</span><span>بعدين</span></div></div><div class="nf-desk__task"></div></div></div>
  </div><p class="br-hint" style="width:min(100% - 24px, 1200px);margin:0 auto 30px">${si('info')}<span>الضغط على الإشعار بيفتح <b>الانترو</b> وبعدين قراءة النهارده. صورة الإشعار الكبيرة على Android بس؛ iPhone والكمبيوتر بيعرضوا الأيقونة. «اقرا دلوقتي» و«بعدين» على Android والكمبيوتر بس.</span></p></main>`;
}

/* ---------------- sheets: share, sign-in ---------------- */

function shareSheet() {
  return `<div class="br-scrim" data-act="close"></div><div class="br-sheet" role="dialog" aria-label="شارك الآية"><div class="br-sheet__grip"></div>
    <h2>شارك الآية</h2><p>صورة مربعة بالآية ولوجو «خبزنا اليومي»، ومعاها لينك الصفحة.</p>
    <img class="br-shareimg" src="share/verse-${S.t}.png" alt="صورة الآية">
    <div class="br-sheet__acts"><button class="btn btn--primary" type="button">${si('share')}شارك الصورة</button><button class="btn" type="button">${si('download')}احفظ الصورة</button><button class="btn" type="button">${si('copy')}انسخ الآية</button></div></div>`;
}
function signinSheet() {
  return `<div class="br-scrim" data-act="close"></div><div class="br-sheet" role="dialog" aria-label="ادخل بحسابك"><div class="br-sheet__grip"></div>
    <h2>ادخل علشان تبعت تأملك</h2><p>اللي كتبته محفوظ على الجهاز ده. بعد ما تدخل هترجع لنفس المكان، والتأمل جاهز تبعته.</p>
    <div class="br-sheet__acts"><button class="btn btn--primary" type="button">${si('user')}ادخل بحسابك</button><button class="btn" type="button" style="grid-column:1/-1">اعمل حساب في دقيقة</button></div>
    <p class="br-keep">مفيش حساب؟ عادي، تقدر تكمّل قراءة من غير حساب.</p></div>`;
}

/* ---------------- render + in-page navigation (never replays the intro) ---------------- */

function render() {
  const V = { today: renderToday, reminders: renderReminders, empty: renderEmpty, notif: renderNotif }[S.s] || renderToday;
  document.body.className = 'br-page';
  app.innerHTML = `<div class="backdrop" aria-hidden="true"><div class="backdrop__glow"></div><div class="backdrop__lattice"></div></div>${V()}${q.get('share') === '1' ? shareSheet() : ''}${q.get('signin') === '1' ? signinSheet() : ''}<p class="br-toast" id="toast" role="status"></p>`;
  requestAnimationFrame(placeLens);
}

function toast(text) {
  const t = document.getElementById('toast');
  t.textContent = text; t.classList.add('is-on');
  clearTimeout(toast.k); toast.k = setTimeout(() => t.classList.remove('is-on'), 2200);
}

function go(params) {
  for (const [k, v] of Object.entries(params)) { if (v == null) q.delete(k); else q.set(k, v); S[k] = v; }
  history.pushState(null, '', '?' + q.toString());
  Object.assign(S, { s: q.get('s') || 'today' });
  render();
}

app.addEventListener('click', e => {
  const nav = e.target.closest('[data-nav]');
  if (nav) { e.preventDefault(); go({ s: nav.dataset.nav }); return; }
  const tab = e.target.closest('.tabbar__tab[href^="?"]');
  if (tab) { e.preventDefault(); go({ s: new URLSearchParams(tab.getAttribute('href')).get('s') }); return; }
  const a = e.target.closest('[data-act]');
  if (!a) {
    const sw = e.target.closest('.br-switch');
    if (sw) { sw.setAttribute('aria-checked', sw.getAttribute('aria-checked') !== 'true'); toast(sw.getAttribute('aria-checked') === 'true' ? 'هنفكّرك كل يوم ٨:٠٠ ص 🔔' : 'قفلنا التذكير'); }
    return;
  }
  const act = a.dataset.act;
  if (act === 'bigger' || act === 'smaller') { const n = Math.max(1, Math.min(4, +html.dataset.size + (act === 'bigger' ? 1 : -1))); html.dataset.size = n; q.set('size', n); history.replaceState(null, '', '?' + q); }
  if (act === 'plain') { S.plain = !S.plain; q.set('plain', S.plain ? '1' : '0'); history.replaceState(null, '', '?' + q); render(); }
  if (act === 'look') { if (html.dataset.look === 'dawn') delete html.dataset.look; else html.dataset.look = 'dawn'; render(); }
  if (act === 'share') go({ share: '1' });
  if (act === 'copy') toast('اتنسخت الآية ✓');
  if (act === 'close') go({ share: null, signin: null });
  if (act === 'signin') go({ signin: '1' });
  if (act === 'send') go({ refl: 'sent' });
  if (act === 'edit') go({ refl: 'edit' });
  if (act === 'save') go({ refl: 'sent' });
  if (act === 'cancel') go({ refl: 'sent' });
  if (act === 'delete') { go({ refl: 'empty' }); toast('اتمسح التأمل'); }
  if (act === 'read') {
    S.read = !S.read; q.set('read', S.read ? '1' : '0'); history.replaceState(null, '', '?' + q);
    const btn = a; render();
    const nb = document.querySelector('.br-done');
    if (S.read && nb) {
      nb.querySelector('.br-done__bloom').animate([{ opacity: .9, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(80)' }], { duration: 900, easing: 'cubic-bezier(.22,1,.36,1)' });
      nb.querySelector('.br-done__ic').animate([{ transform: 'scale(.6)' }, { transform: 'scale(1.12)' }, { transform: 'none' }], { duration: 650, easing: 'cubic-bezier(.3,1.4,.5,1)' });
    }
    void btn;
  }
});
app.addEventListener('input', e => {
  if (e.target.matches('.br-field textarea')) {
    const c = e.target.parentElement.querySelector('.br-field__count'); if (c) c.textContent = AR(e.target.value.length) + ' / ١٠٠٠';
    const send = document.querySelector('[data-act="send"]'); if (send) send.disabled = !e.target.value.trim();
  }
});
addEventListener('popstate', () => { for (const k of ['s', 'refl', 'share', 'signin']) S[k] = new URLSearchParams(location.search).get(k) || (k === 's' ? 'today' : k === 'refl' ? 'empty' : null); render(); });
addEventListener('resize', placeLens);

/* ---------------- the intro (decision 15) ---------------- */

const SOUND = { a: 'sound/intro-a.m4a', b: 'sound/intro-b.m4a', off: null };
function intro(hold) {
  return playIntro({
    logo: IMG.logo,
    sound: SOUND[S.sound],
    target: document.getElementById('brand-mark'),
    hold,
    reduced: q.get('reduced') === '1' ? true : undefined,
    onArrive: () => { html.classList.add('br-arrive'); setTimeout(() => html.classList.remove('br-arrive'), 2200); }
  });
}

render();
if (q.get('intro') === '1' || (q.get('intro') !== '0' && q.get('lab') === '1' && shouldPlayOnLoad())) intro(q.has('hold') ? +q.get('hold') : null);
addEventListener('pageshow', e => { if (e.persisted && q.get('intro') !== '0') intro(null); });

/* ---------------- the review lab (not part of the design) ---------------- */
if (q.get('lab') === '1') {
  const lab = document.createElement('aside');
  lab.className = 'w1-lab';
  lab.innerHTML = `<b>الانترو — للمراجعة بس</b>
    <div class="w1-lab__row"><button type="button" data-l="play">▶ شغّل الانترو</button><button type="button" data-l="reduced">بتقليل الحركة</button></div>
    <div class="w1-lab__row">${Object.entries(SAMPLES).map(([k, v]) => `<button type="button" data-l="snd" data-v="${k}" aria-pressed="${S.sound === k}" title="${v.hint}">الصوت ${v.name}</button>`).join('')}<button type="button" data-l="snd" data-v="off" aria-pressed="${S.sound === 'off'}">من غير صوت</button></div>
    <div class="w1-lab__row"><a href="?s=today&lab=1&sound=${S.sound}">دخول جديد (يشتغل)</a><a href="?s=today&lab=1&from=signin&acct=eligible&refl=typing&sound=${S.sound}#reflect">رجوع بعد الدخول (ميشتغلش)</a><a href="../../../index.html">روح للموقع وارجع بـ«رجوع» (يشتغل)</a></div>`;
  document.body.appendChild(lab);
  lab.addEventListener('click', e => {
    const b = e.target.closest('[data-l]'); if (!b) return;
    if (b.dataset.l === 'play') intro(null);
    if (b.dataset.l === 'reduced') playIntro({ logo: IMG.logo, sound: SOUND[S.sound], reduced: true, target: document.getElementById('brand-mark') });
    if (b.dataset.l === 'snd') { S.sound = b.dataset.v; q.set('sound', S.sound); history.replaceState(null, '', '?' + q); lab.querySelectorAll('[data-l="snd"]').forEach(x => x.setAttribute('aria-pressed', x.dataset.v === S.sound)); intro(null); }
  });
}
