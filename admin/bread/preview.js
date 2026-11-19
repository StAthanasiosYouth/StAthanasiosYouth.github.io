/*
 * «خبزنا اليومي» — the admin's day preview (W4). The member page's reading top exactly as the approved W1 design
 * draws it (docs/daily-bread/w1/member.js renderToday: the site's top bar, the dawn, the paper, the side cards, the
 * tab bar), filled with one reviewed day the panel hands over: window.parent.A.bread.previewDay (same origin), and
 * again on every «bread-preview» message. Nothing here talks to a server. W5 builds the real page.
 */
import { iconSvg } from '../../assets/js/icons.js';

/* the section's own icons (docs/daily-bread/w1/icons-bread.js; W5 moves them into assets/js/icons.js) */
const BI = {
  back: '<path d="m9 6 6 6-6 6"/>',
  sound: '<path class="duo" d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5Z"/><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5ZM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  remind: '<path class="duo" d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15Z"/><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15ZM10 20.5a2 2 0 0 0 4 0M12 8.5V11l1.6 1.2"/>',
  bread: '<path class="duo" d="M12 7.6C10 6.2 6.9 5.8 4 6.4v11.2c2.9-.6 6-.2 8 1.2 2-1.4 5.1-1.8 8-1.2V6.4c-2.9-.6-6-.2-8 1.2Z"/><path d="M12 7.6C10 6.2 6.9 5.8 4 6.4v11.2c2.9-.6 6-.2 8 1.2 2-1.4 5.1-1.8 8-1.2V6.4c-2.9-.6-6-.2-8 1.2Zm0 0v11.2"/><path d="M9.5 3.6a3 3 0 0 1 5 0M12 1.6v.9M8.2 2.6l.5.6M15.8 2.6l-.5.6"/>',
  home: '<path class="duo" d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-4v-6h-5v6h-4A1.5 1.5 0 0 1 4 19Z"/><path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-4v-6h-5v6h-4A1.5 1.5 0 0 1 4 19Z"/>',
  reading: '<path class="duo" d="M4 5.5A1.5 1.5 0 0 1 5.5 4H18v14H5.5A1.5 1.5 0 0 0 4 19.5Z"/><path d="M4 19.5v-14A1.5 1.5 0 0 1 5.5 4H18v14H5.5A1.5 1.5 0 0 0 4 19.5 1.5 1.5 0 0 0 5.5 21H18v-3"/><path d="M8 8h6M8 11h4"/>',
  tashkeel: '<path d="M5 17.5c2.5 1.5 5 1.5 7 0s4.5-1.5 7 0"/><path d="M12 4.5v8"/><path d="m8.5 8 7-2"/><circle cx="17.5" cy="11.5" r="1.2" class="duo"/>',
  sun: '<circle class="duo" cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  lantern: '<path class="duo" d="M7.5 8h9l-.8 9.5a1.5 1.5 0 0 1-1.5 1.4H9.8a1.5 1.5 0 0 1-1.5-1.4Z"/><path d="M7.5 8h9l-.8 9.5a1.5 1.5 0 0 1-1.5 1.4H9.8a1.5 1.5 0 0 1-1.5-1.4ZM9 8V6.5A3 3 0 0 1 15 6.5V8M10 21h4M12 11v4.5M10 13.2h4"/>',
  question: '<path class="duo" d="M12 3a8.5 8.5 0 0 0-7.4 12.7L3.5 20.5l4.8-1.1A8.5 8.5 0 1 0 12 3Z"/><path d="M12 3a8.5 8.5 0 0 0-7.4 12.7L3.5 20.5l4.8-1.1A8.5 8.5 0 1 0 12 3Z"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.4M12 16.4v.1"/>',
  pen: '<path class="duo" d="M15.5 4.5 19.5 8.5 9 19l-5 1 1-5Z"/><path d="M15.5 4.5 19.5 8.5 9 19l-5 1 1-5ZM13.5 6.5l4 4"/>'
};
const bi = name => `<svg class="icon icon--line" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${BI[name] || ''}</svg>`;
const si = name => iconSvg(name);
const AR = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// W7: the same as the member page (assets/js/bread/page.js): St-Takla's own links stay links, the source in small type
const TAKLA = /^https:\/\/(www\.)?st-takla\.org\/[^\s<>"'()[\]]*$/;
const SAINT_IMG = /^\/assets\/img\/saints\/[a-z0-9-]+\.(?:webp|jpg|png)$/;
const medText = text => String(text || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).map(p => '<p>' + esc(p).replace(/\[([^\]\n]{1,200})\]\(([^)\s]{1,400})\)/g, (m, words, url) => {
  const raw = url.replace(/&amp;/g, '&');
  return TAKLA.test(raw) ? '<a href="' + esc(raw) + '" target="_blank" rel="noopener">' + words + '</a>' : words;
}) + '</p>').join('');
const byLine = src => (src && TAKLA.test(src.url)
  ? '<p class="br-med__by br-med__src">بمساعدة <a href="' + esc(src.url) + '" target="_blank" rel="noopener">موقع الأنبا تكلا</a>' + (src.refs ? ' · ' + esc(src.refs) : '') + '</p>'
  : '<p class="br-med__by">من خدام الأسرة</p>');
const app = document.getElementById('app');
const WEEKDAYS = ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'];
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const HILLS = `<svg class="br-dawn__hills" viewBox="0 0 1000 96" preserveAspectRatio="none" aria-hidden="true">
  <path d="M0,40 C120,10 220,22 300,34 C380,8 460,12 540,32 C640,6 760,10 1000,36 V96 H0 Z" fill="#5d5a73" opacity=".55"/>
  <path class="h2" d="M0,70 C160,44 300,58 420,68 C560,50 720,46 1000,62 V96 H0 Z"/>
  <path class="h3" d="M0,86 C200,74 800,74 1000,86 V96 H0 Z"/></svg>`;
const FACE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1-4.4 4-6 8-6s7 1.6 8 6"></path></svg>';

function topbar() {
  return `<header class="topbar" id="topbar"><div class="topbar__inner">
    <span class="br-brand"><span class="br-brand__back" aria-hidden="true">${bi('back')}</span>
      <img class="br-brand__mark" src="mark-192.png" width="38" height="38" alt="">
      <span><span class="br-brand__name">خبزنا اليومي</span><span class="br-brand__sub">كلمة من الإنجيل تقوّيك كل يوم</span></span></span>
    <div class="topbar__actions">
      <span class="topbar__btn" aria-hidden="true">${bi('sound')}</span>
      <span class="topbar__btn" aria-hidden="true">${bi('remind')}</span>
      <span class="acct-badge topbar__btn" aria-hidden="true"><span class="acct-badge__face">${FACE}</span></span>
    </div>
  </div></header>`;
}

function tabbar() {
  const tab = (icon, word, on) => `<span class="tabbar__tab" ${on ? 'aria-current="page"' : ''}>${icon}<span class="tabbar__word">${word}</span></span>`;
  return `<nav class="tabbar" aria-hidden="true"><span class="tabbar__lens" aria-hidden="true"></span><div class="tabbar__slots">
    ${tab(bi('bread'), 'النهارده', true)}${tab(bi('remind'), 'إعداداتي')}${tab(bi('home'), 'الموقع')}
  </div><span class="acct-badge tabbar__tab tabbar__fixed"><span class="acct-badge__face">${FACE}</span><span class="tabbar__word">حسابي</span></span></nav>`;
}

function dateText(iso) {
  // W7: the day's real date when the admin knows it (a St-Takla month), else today
  const d = iso ? new Date(iso + 'T12:00:00Z') : new Date();
  return WEEKDAYS[d.getDay()] + ' ' + AR(d.getDate()) + ' ' + MONTHS[d.getMonth()];
}

/* day = { n, days, title, verseRef, verse, readingRef, reading: [{ chapter, verses: [[v, text]] }], verseAt: [ch, v],
           psalmNote, meditation, question } */
function page(day) {
  const parts = day.reading || [];
  const many = parts.reduce((s, p) => s + p.verses.length, 0) > 1;
  const body = parts.map((p, i) => (i ? `<sup>${AR(p.chapter)}:</sup>` : '') + p.verses.map(([n, text]) => {
    const on = many && day.verseAt && day.verseAt[0] === p.chapter && day.verseAt[1] === n;
    return `<sup>${AR(n)}</sup>${on ? `<mark>${esc(text)}</mark>` : esc(text)} `;
  }).join('')).join('');
  const head = day.question
    ? `<h2 class="br-kicker">${bi('question')}سؤال النهارده<small>اختياري</small></h2><p class="br-q__text">${esc(day.question)}</p><p class="br-q__hint">فكّر فيه طول اليوم… ولو حابب، اكتب تأملك.</p>`
    : `<h2 class="br-kicker">${bi('pen')}تأملك النهارده<small>اختياري</small></h2>`;
  return `${topbar()}<main id="main">
    <section class="br-dawn" aria-labelledby="br-title">
      <span class="br-dawn__rays" aria-hidden="true"></span>
      <p class="br-day">${dateText(day.date)} <i></i> اليوم ${AR(day.n)} من ${AR(day.days)}</p>
      <h1 class="br-title" id="br-title">${esc(day.title)}</h1>
      <p class="br-verse"><q>${esc(day.verse)}</q></p>
      <p class="br-ref">${esc(day.verseRef)}</p>
      <div class="br-dawn__acts">
        <span class="btn btn--small br-glass">${si('share')}شارك الآية</span>
        <span class="btn btn--small br-glass">${si('copy')}انسخ</span>
      </div>
      ${HILLS}
    </section>
    <div class="br-main"><div class="br-side">
      <article class="br-paper" aria-labelledby="br-reading">
        <header class="br-paper__head">
          <span class="br-paper__label">${bi('reading')}<span><small>القراءة</small><b id="br-reading">${esc(day.readingRef)}</b></span></span>
          <span class="br-tools">
            <span class="br-tool br-tool--size"><span class="s">أ</span><span class="l">أ</span></span>
            <span class="br-tool">${bi('tashkeel')}</span>
            <span class="br-tool">${bi('sun')}</span>
          </span>
        </header>
        <p class="br-reading">${body}</p>
        <footer class="br-paper__foot">${day.psalmNote ? `<span class="br-psalm">${esc(day.psalmNote)}</span>` : ''}<span>ترجمة فاندايك</span><span class="sp"></span><span class="br-takla">التفسير في موقع الأنبا تكلا ${si('external')}</span></footer>
      </article></div>
      <div class="br-side">
        <section class="widget br-card br-med"><h2 class="br-kicker">${bi('lantern')}تأمل النهارده</h2>${medText(day.meditation)}${byLine(day.source)}</section>
        <section class="widget br-card br-q">${head}</section>
        ${feastCard(day.feast)}
      </div></div>
  </main>${tabbar()}`;
}

/* W7: the saint's card, as the member page draws it (assets/js/bread/page.js feast()) */
function feastCard(f) {
  if (!f) return '';
  const pic = f.img && (TAKLA.test(f.img) || SAINT_IMG.test(f.img)) ? `<figure class="br-feast__fig"><img class="br-feast__img" src="${esc(f.img)}" alt="" referrerpolicy="no-referrer"></figure>` : '';
  // the saint's praise from the registry, only with its source (as the member page)
  const lines = f.praise && f.praiseText ? f.praiseText.split('\n').map(l => l.trim()).filter(Boolean) : [];
  const praise = lines.length ? `<blockquote class="br-feast__praise"><p class="br-feast__praise-title">${esc(f.praiseTitle || 'من التمجيد')}</p><p class="br-feast__praise-text">${lines.map(esc).join('<br>')}</p><p class="br-med__by"><span class="br-src">التمجيد كامل</span></p></blockquote>` : '';
  const src = !f.url || TAKLA.test(f.url) ? 'سنكسار موقع الأنبا تكلا' : 'المصدر';
  return `<section class="widget br-card br-feast"><h2 class="br-kicker">${bi('sun')}نحب نفكّرك</h2>${pic}<p class="br-feast__name">النهارده تذكار ${esc(f.name)}</p>${f.title && f.title !== f.name ? `<p class="br-feast__title">${esc(f.title)}</p>` : ''}${medText(f.word)}${praise}<p class="br-med__by br-med__src">من <span class="br-src">${src}</span></p></section>`;
}

/* W7: a feast with no topic that day (the «الأعياد» tab): the card alone, as the youth would see it under any day */
function feastOnly(day) {
  return `${topbar()}<main id="main"><div class="br-main"><div class="br-side">
    <p class="br-day br-day--plain">${dateText(day.date)}</p>
    ${feastCard(day.feast)}
  </div></div></main>${tabbar()}`;
}

function draw(day) {
  if (!day) return;
  app.innerHTML = `<div class="backdrop" aria-hidden="true"><div class="backdrop__glow"></div><div class="backdrop__lattice"></div></div>${day.feastOnly ? feastOnly(day) : page(day)}`;
  document.documentElement.dataset.ready = '1';
}

function fromParent() {
  try { return window.parent && window.parent.A && window.parent.A.bread ? window.parent.A.bread.previewDay : null; }
  catch { return null; }
}

draw(fromParent());
window.addEventListener('message', event => {
  if (event.origin !== location.origin || !event.data || event.data.type !== 'bread-preview') return;
  draw(fromParent());
});
