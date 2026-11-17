/*
 * «خبزنا اليومي» — the member's page, prototype (study only; nothing here talks to the Worker).
 *
 * URL: app.html?s=<screen>&look=<navy|dawn|parchment>&acct=<none|eligible|guest>&post=<none|fresh|locked>&d=<day>
 *   s = notif | intro | today | settings | empty | late
 */
import { PROGRAM, TOPICS, ar } from './data.js';

const q = new URLSearchParams(location.search);
const S = {
  screen: q.get('s') || 'today',
  look: q.get('look') || 'navy',
  acct: q.get('acct') || 'none',
  post: q.get('post') || 'none',
  day: Math.max(1, Math.min(PROGRAM.days, +(q.get('d') || PROGRAM.day))),
  fs: 22,
  read: false,
  notify: true,
  times: ['08:00'],
  device: q.get('device') || 'k-7f3a91'
};
document.documentElement.dataset.look = S.look;
const app = document.getElementById('app');
const $ = (sel, el = document) => el.querySelector(sel);

/* ── the per-person order: a fixed shuffle seeded by (person or device, program) ──
 * Fisher–Yates over the program's topics with a small seeded PRNG. Same seed → same order on every device
 * and every visit; a different person → a different order; nothing repeats inside the program. */
function hash32(text) { let h = 2166136261; for (const c of text) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function orderFor(seedKey, programId, n) {
  const rnd = mulberry32(hash32(seedKey + '|' + programId));
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const ORDER = orderFor(S.device, PROGRAM.id, PROGRAM.days);
// ?t=<n> pins a topic (the gallery's shots); without it the day follows this device's own order
const topic = TOPICS[q.has('t') ? +q.get('t') % TOPICS.length : ORDER[S.day - 1] % TOPICS.length];

const ICON = {
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 19a2 2 0 0 0 4 0"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6h14v-6"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="8" y="8" width="12" height="12" rx="3"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 6c-2-1.5-5-2-8-1v13c3-1 6-.5 8 1 2-1.5 5-2 8-1V5c-3-1-6-.5-8 1z"/><path d="M12 6v13"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 11l8-7 8 7v9H4z"/></svg>',
  ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  lock: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  sound: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 10v4h4l5 4V6L8 10z"/><path d="M16 9a4 4 0 0 1 0 6"/></svg>'
};

const DAYS = ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'];
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const today = new Date(2026, 10, 9 + S.day);
const dateText = `${DAYS[today.getDay()]} ${ar(today.getDate())} ${MONTHS[today.getMonth()]}`;
const toast = text => { const t = $('#toast'); t.textContent = text; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200); };

/* ── screens ── */
function bar() {
  return `<header class="bar">
    <a class="ib" href="#" aria-label="رجوع للموقع">${ICON.back}</a>
    <div class="brand"><img src="../logo/mark-c.svg" alt=""><div><b>خبزنا اليومي</b><small>كلمة من الإنجيل تقوّيك كل يوم</small></div></div>
    <button class="ib" data-go="settings" aria-label="الإشعارات">${ICON.bell}</button>
  </header>`;
}

function verseCard(i) {
  return `<section class="card verse-card rise" style="--i:${i}">
    <span class="arch" aria-hidden="true"></span>
    <div class="day"><span class="date">${dateText}</span><span class="count">اليوم ${ar(S.day)} من ${ar(PROGRAM.days)}</span></div>
    <div class="progress" aria-hidden="true"><i style="width:${(S.day / PROGRAM.days * 100).toFixed(1)}%"></i></div>
    <h1>${topic.title}</h1>
    <blockquote>«${topic.verse}»</blockquote>
    <cite>${topic.verseRef}${topic.verseNote ? `<small>(${topic.verseNote})</small>` : ''}</cite>
    <div class="verse-actions">
      <button class="chip" data-act="share">${ICON.share} شارك الآية</button>
      <button class="chip" data-act="copy">${ICON.copy} انسخ</button>
    </div>
  </section>`;
}

function readingCard(i) {
  const text = topic.reading.map(([n, t]) => `<sup>${ar(n)}</sup>${t}`).join(' ');
  return `<section class="card reading rise" style="--i:${i}" aria-labelledby="rd">
    <header><h2 id="rd">${ICON.book.replace('<svg', '<svg width="18" height="18" style="vertical-align:-3px;margin-inline-end:6px"')}القراءة: ${topic.readingRef}</h2>
      <div class="size" role="group" aria-label="حجم الخط"><button data-fs="-2" aria-label="أصغر">أ-</button><button data-fs="2" aria-label="أكبر">أ+</button></div></header>
    <p class="scripture" style="--fs:${S.fs}px">${text}</p>
    <div class="source"><span>ترجمة فاندايك (البستاني–فاندايك)</span><a href="https://st-takla.org/" target="_blank" rel="noopener">التفسير في موقع الأنبا تكلا ${ICON.ext.replace('<svg', '<svg width="13" height="13" style="vertical-align:-2px"')}</a></div>
  </section>`;
}

function meditationCard(i) {
  return `<section class="card meditation rise" style="--i:${i}"><div class="kicker">تأمل</div><p>${topic.meditation}</p></section>
  ${topic.question ? `<section class="card question rise" style="--i:${i + 1}"><div class="kicker">سؤال لنفسك <span class="opt">(اختياري)</span></div><p>${topic.question}</p></section>` : ''}`;
}

function reflectCard(i) {
  let body;
  if (S.post === 'fresh' || S.post === 'locked') {
    const fresh = S.post === 'fresh';
    body = `<div class="posted">
      <p>حسّيت إن الشبع اللي بدوّر عليه في الموبايل والسوشيال مش بيكمّل. محتاج أبدأ يومي بكلمة منه الأول.</p>
      <div class="row">
        ${fresh ? `<span class="timer" style="--p:62%"><i></i> تقدر تعدّل أو تمسح لمدة ١٢ دقيقة</span><span class="grow"></span>
          <button class="btn ghost small" data-act="edit">تعديل</button><button class="btn ghost small" data-act="del">مسح</button>`
          : `<span class="lock">${ICON.lock} اتبعتت الساعة ٨:١٤ ص · مبقاش ينفع تتعدّل</span>`}
      </div>
    </div>
    <p class="note" style="margin:10px 0 0">تأملك بيوصل لخدام الأسرة بس، ومش بيظهر لحد تاني.</p>`;
  } else if (S.acct === 'none') {
    body = `<p class="lead">القراءة متاحة للكل. علشان تبعت تأملك للخدام محتاج تدخل بحسابك.</p>
      <textarea placeholder="اكتب اللي لمسك في قراءة النهارده…" aria-label="تأملك" data-need-acct></textarea>
      <div class="row" style="margin-top:10px"><span class="note grow">تأملك بيوصل لخدام الأسرة بس.</span><button class="btn" data-act="signin">ادخل وابعت</button></div>`;
  } else {
    const eligible = S.acct === 'eligible';
    body = `<div class="welcome"><span class="av">م</span><div><b>${eligible ? 'أهلًا يا مينا، نورت خبزنا اليومي 🤍' : 'أهلًا بيك يا مينا، ضيف عزيز علينا 🤍'}</b>
      <p>${eligible ? 'اكتب اللي لمسك، وخدام الأسرة هيقروه.' : 'إنت مش في سن خدمة الشباب، بس الكلمة للكل وتأملك يفرّحنا.'}</p></div></div>
      <textarea placeholder="اكتب اللي لمسك في قراءة النهارده…" aria-label="تأملك"></textarea>
      <div class="row" style="margin-top:10px"><span class="note grow">تقدر تعدّل أو تمسح أول ٢٠ دقيقة بس.</span><button class="btn" data-act="send">ابعت تأملي</button></div>`;
  }
  return `<section class="card reflect rise" style="--i:${i}"><h3>شاركنا تأملك</h3>${body}</section>`;
}

function sideCards(i) {
  const times = S.times.map((t, k) => `<div class="time"><b>${ar(t.replace(/^0/, ''))}</b><span>${+t.slice(0, 2) < 12 ? 'صباحًا' : 'مساءً'}${k === 0 ? ' · الأساسي' : ''}</span>${k ? `<button aria-label="امسح الميعاد" data-del="${k}">${ICON.x}</button>` : ''}</div>`).join('');
  return `<section class="card rise" style="--i:${i}">
      <div class="row"><div class="grow"><h3>فكّرني كل يوم</h3><p class="note" style="margin:0">إشعار بقراءة النهارده على الجهاز ده</p></div>
      <button class="switch" role="switch" aria-checked="${S.notify}" data-act="notify" aria-label="الإشعارات"></button></div>
      ${S.notify ? `<div class="times">${times}
        ${S.times.length < 3 ? `<button class="btn ghost small add" data-act="addtime">+ ميعاد تاني (لحد ٣)</button>` : ''}</div>
        <p class="note" style="margin:10px 0 0">بتوقيت مصر. تقدر تقفلها في أي وقت.</p>` : `<p class="note" style="margin:10px 0 0">الإشعارات مقفولة. القراءة موجودة هنا في أي وقت.</p>`}
    </section>
    <section class="card rise" style="--i:${i + 1}">
      <div class="row"><div class="prog-ring" style="--p:${(S.day / PROGRAM.days * 100).toFixed(1)}%"><b>${ar(S.day)}<small>من ${ar(PROGRAM.days)}</small></b></div>
      <div class="grow"><h3>${PROGRAM.name}</h3><p class="note" style="margin:0">ترتيب القراءات خاص بيك، ومفيش قراءة بتتكرر.</p></div></div>
      <button class="btn read-done ${S.read ? 'done' : ''}" style="margin-top:14px" data-act="read">${S.read ? '✓ قريت قراءة النهارده' : 'قريت قراءة النهارده'}</button>
    </section>`;
}

function sig() {
  return `<p class="sig">إعداد وإشراف<br><b>أسرة البابا أثناسيوس الرسولي للشباب – كنيسة أبي سيفين بسفاجا</b></p>`;
}

function dock(on) {
  return `<nav class="dock"><a href="#" class="${on === 'today' ? 'on' : ''}" data-go="today">${ICON.book}النهارده</a><a href="#" class="${on === 'settings' ? 'on' : ''}" data-go="settings">${ICON.bell}إشعاراتي</a><a href="#">${ICON.home}الموقع</a></nav>`;
}

function renderToday() {
  const wide = matchMedia('(min-width: 980px)').matches;
  app.innerHTML = bar() + `<main><div class="grid">
    <div class="grid" style="grid-template-columns:none">${verseCard(0)}${readingCard(1)}${meditationCard(2)}${reflectCard(4)}${wide ? sig() : ''}</div>
    ${wide ? `<aside class="side">${sideCards(1)}</aside>` : `<div class="grid">${sideCards(5).split('</section>')[1]}</section></div>${sig()}`}
  </div></main>` + dock('today');
}

function renderSettings() {
  app.innerHTML = bar() + `<main><div class="grid" style="grid-template-columns:none;max-width:560px;margin:0 auto">${sideCards(0)}
    <section class="card rise" style="--i:2"><h3>الإشعار هيبقى شكله كده</h3>
      <div class="notif" style="background:rgb(11 42 76 / .9);margin:10px 0 0"><img src="../logo/mark-c.svg" alt=""><div class="app"><span>خبزنا اليومي</span><span>٨:٠٠ ص</span></div><b>${topic.title}</b><p>«${topic.verse.replace(/[ً-ْ]/g, '').slice(0, 70)}…»</p></div>
    </section>${sig()}</div></main>` + dock('settings');
}

function renderEmpty(late) {
  app.innerHTML = bar() + `<main><section class="card empty rise">
    <img src="../logo/mark-c.svg" alt="">
    ${late ? `<h1>أهلًا بيك في خبزنا اليومي</h1><p>البرنامج الحالي «${PROGRAM.name}» شغال من ${ar(11)} يوم. هتشارك معانا في الـ${ar(19)} يوم الباقيين، وأول قراءة ليك مستنياك دلوقتي.</p>
      <div class="row" style="justify-content:center;margin-top:18px"><button class="btn" data-go="today">ابدأ قراءة النهارده</button></div>`
    : `<h1>قريب قوي…</h1><p>البرنامج اللي فات خلص، والخدام بيجهّزوا البرنامج الجاي. أول ما يبدأ هيوصلك إشعار لو مفعّله.</p>
      <div class="row" style="justify-content:center;margin-top:18px"><button class="btn ghost" data-go="settings">إعدادات الإشعار</button></div>`}
  </section>${sig()}</main>` + dock('today');
}

function renderNotif() {
  const body = topic.verse.replace(/[ً-ْ]/g, '');
  const wide = matchMedia('(min-width: 980px)').matches;
  if (wide) {
    app.innerHTML = `<div style="min-height:100dvh;background:linear-gradient(135deg,#1b2a44,#0c1424);position:relative">
      <p style="position:absolute;inset:40% 0 auto;text-align:center;color:#8d9db3">كمبيوتر · Chrome على Windows — اضغط على الإشعار</p>
      <div class="desk-toast" data-go="intro"><div><small>Google Chrome · stathanasiosyouth.github.io</small><b>خبزنا اليومي · ${topic.title}</b><p>«${body.slice(0, 80)}…»</p></div><img src="../logo/mark-c.svg" alt=""></div></div>`;
    return;
  }
  app.innerHTML = `<div class="lock-screen">
    <div class="clock">8:00</div><div class="date">${dateText}</div>
    <span class="os-label">Android</span>
    <div class="notif" data-go="intro"><img src="../logo/mark-c.svg" alt=""><div class="app"><span>خبزنا اليومي · الموقع</span><span>دلوقتي</span></div><b>${topic.title}</b><p>«${body.slice(0, 74)}…» — ${topic.verseRef}</p></div>
    <span class="os-label">iPhone (الموقع متثبّت على الشاشة الرئيسية)</span>
    <div class="notif ios" data-go="intro"><img src="../logo/mark-c.svg" alt=""><div class="app"><span>خبزنا اليومي</span><span>الآن</span></div><b>${topic.title}</b><p>كلمة النهارده مستنياك 🤍</p></div>
    <p style="opacity:.6;font-size:13px;margin-top:auto">اضغط على الإشعار</p>
  </div>`;
}

/* ── the intro: logo out of the dark, light, title, cross; ≈ 3.4 s; no skip; never blocks ── */
let audio;
function introSound() {
  // Prototype stand-in for the produced sound file (STUDY.md §6.4): a soft pad and one low bell, Web Audio.
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audio;
    const t0 = ctx.currentTime + 0.05;
    const out = ctx.createGain(); out.gain.value = 0.18;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
    out.connect(lp).connect(ctx.destination);
    for (const [f, d] of [[196, 0], [246.9, 0.15], [293.7, 0.3], [392, 0.45]]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = f; o.detune.value = (Math.random() - .5) * 8;
      g.gain.setValueAtTime(0, t0 + d); g.gain.linearRampToValueAtTime(0.22, t0 + d + 0.9); g.gain.linearRampToValueAtTime(0, t0 + 3.6);
      o.connect(g).connect(out); o.start(t0 + d); o.stop(t0 + 3.8);
    }
    const bell = (when, f, v) => {
      for (const [m, k] of [[1, 1], [2.76, .35], [5.4, .12]]) {
        const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f * m;
        g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(v * k, when + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, when + 2.6);
        o.connect(g).connect(out); o.start(when); o.stop(when + 2.7);
      }
    };
    bell(t0 + 1.55, 392, 0.5);
    return ctx.state === 'running';
  } catch { return false; }
}

async function renderIntro() {
  const logo = S.look === 'dawn' ? 'logo-a-dawn.svg' : 'logo-b-family.svg';
  const svg = await (await fetch('../logo/' + logo)).text();
  renderToday();
  const el = document.createElement('div');
  el.className = 'intro';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<div class="stage"><div class="bloom"></div>${svg.replace(/<\?xml[^>]*>/, '')}<div class="dust">${'<i></i>'.repeat(18)}</div></div>
    ${S.look === 'dawn' ? '' : '<div class="line"></div><div class="sig2"></div>'}
    <div class="sound-hint">${ICON.sound} الصوت مقفول على الجهاز ده</div>`;
  document.body.append(el);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const playing = introSound();
  if (!playing) setTimeout(() => $('.sound-hint', el)?.classList.add('show'), 600);
  const g = id => el.querySelector('#' + id);
  for (const n of el.querySelectorAll('svg g, svg circle, svg path, svg text')) { n.style.transformBox = 'fill-box'; n.style.transformOrigin = 'center'; }
  const A = (node, kf, o) => node && node.animate(kf, { fill: 'both', easing: 'cubic-bezier(.22,1,.36,1)', ...o });
  const svgEl = el.querySelector('svg');
  if (reduce) {
    A(svgEl, [{ opacity: 0 }, { opacity: 1 }], { duration: 400 });
  } else {
    A(svgEl, [{ opacity: 0, transform: 'scale(.9)', filter: 'blur(14px) brightness(.4)' }, { opacity: 1, transform: 'scale(1)', filter: 'blur(0) brightness(1)' }], { duration: 1300 });
    A($('.bloom', el), [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1)' }, { opacity: .35 }], { duration: 2400, delay: 300 });
    A(g('ring'), [{ transform: 'rotate(-14deg) scale(.96)' }, { transform: 'none' }], { duration: 1600 });
    A(g('sun-disc'), [{ transform: 'translateY(80px) scale(.6)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 1500, delay: 350 });
    A(g('rays'), [{ opacity: 0, transform: 'rotate(-8deg) scale(.8)' }, { opacity: 1, transform: 'none' }], { duration: 1800, delay: 500 });
    A(g('book'), [{ transform: 'translateY(40px) scaleY(.7)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 1100, delay: 700, easing: 'cubic-bezier(.34,1.4,.64,1)' });
    A(g('bread'), [{ transform: 'translateX(-30px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 900, delay: 1000 });
    A(g('wheat'), [{ transform: 'rotate(-10deg)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 1000, delay: 1050 });
    A(g('lantern'), [{ opacity: 0 }, { opacity: 1 }], { duration: 900, delay: 900 });
    A(g('church'), [{ opacity: 0, transform: 'translateY(20px)' }, { opacity: 1, transform: 'none' }], { duration: 900, delay: 800 });
    A(g('title'), [{ clipPath: 'inset(0 0 0 100%)', opacity: .2 }, { clipPath: 'inset(0 0 0 0)', opacity: 1 }], { duration: 1000, delay: 1150, easing: 'cubic-bezier(.65,0,.35,1)' });
    A(g('tagline'), [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 700, delay: 1700 });
    A(g('top-cross'), [{ transform: 'translateY(-60px)', opacity: 0, filter: 'drop-shadow(0 0 0 #ffe7a6)' }, { transform: 'none', opacity: 1, filter: 'drop-shadow(0 0 18px #ffe7a6)' }, { filter: 'drop-shadow(0 0 4px #ffe7a6)' }], { duration: 1400, delay: 1450, easing: 'cubic-bezier(.34,1.56,.64,1)' });
    A(g('family-seal'), [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'none' }], { duration: 800, delay: 1900, easing: 'cubic-bezier(.34,1.56,.64,1)' });
    A($('.line', el), [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 700, delay: 1900 });
    A($('.sig2', el), [{ opacity: 0 }, { opacity: 1 }], { duration: 700, delay: 2100 });
    el.querySelectorAll('.dust i').forEach((d, k) => {
      d.style.left = (10 + Math.random() * 80) + '%'; d.style.top = (30 + Math.random() * 60) + '%';
      d.animate([{ opacity: 0, transform: 'translateY(0)' }, { opacity: .8 }, { opacity: 0, transform: 'translateY(-90px)' }], { duration: 2600, delay: 500 + k * 90, fill: 'both' });
    });
  }
  const hold = q.get('hold');
  if (hold) { el.getAnimations({ subtree: true }).forEach(a => { a.pause(); a.currentTime = +hold; }); return; }
  // the hand-off: the badge shrinks toward the bar's mark while the page is already there underneath
  setTimeout(() => {
    if (!reduce) A($('.stage', el), [{ transform: 'none' }, { transform: 'translateY(-38vh) scale(.12)', opacity: .2 }], { duration: 700, easing: 'cubic-bezier(.65,0,.35,1)' });
    el.classList.add('out');
    setTimeout(() => el.remove(), 800);
  }, reduce ? 900 : 3000);
}

/* ── wiring ── */
function render() {
  document.body.style.overflow = '';
  ({ today: renderToday, settings: renderSettings, empty: () => renderEmpty(false), late: () => renderEmpty(true), notif: renderNotif, intro: renderIntro }[S.screen] || renderToday)();
  window.scrollTo(0, 0);
  // ?focus=reflect|reading|meditation: the gallery's shots of one part
  const f = q.get('focus');
  if (f) requestAnimationFrame(() => document.querySelector('.' + f)?.scrollIntoView({ block: 'center' }));
}
document.addEventListener('click', e => {
  const go = e.target.closest('[data-go]');
  if (go) { e.preventDefault(); S.screen = go.dataset.go; render(); return; }
  const fs = e.target.closest('[data-fs]');
  if (fs) { S.fs = Math.max(18, Math.min(32, S.fs + +fs.dataset.fs)); $('.scripture').style.setProperty('--fs', S.fs + 'px'); return; }
  const del = e.target.closest('[data-del]');
  if (del) { S.times.splice(+del.dataset.del, 1); render(); return; }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  if (act === 'notify') { S.notify = !S.notify; render(); toast(S.notify ? 'اتحفظ: هنفكّرك كل يوم' : 'اتقفلت الإشعارات'); }
  if (act === 'addtime') { S.times.push(S.times.length === 1 ? '21:00' : '14:00'); render(); toast('اتضاف ميعاد'); }
  if (act === 'read') { S.read = !S.read; render(); if (S.read) toast('ربنا يباركك 🤍'); }
  if (act === 'copy') toast('اتنسخت الآية مع المرجع');
  if (act === 'share') toast('هتفتح مشاركة الموبايل (صورة الآية + اللينك)');
  if (act === 'signin') signinSheet();
  if (act === 'send') { S.post = 'fresh'; render(); toast('اتبعت تأملك 🤍'); }
  if (act === 'del') { S.post = 'none'; render(); toast('اتمسح'); }
  if (act === 'edit') toast('بيفتح التأمل للتعديل (لحد ما الـ٢٠ دقيقة تخلص)');
});
document.addEventListener('focusin', e => { if (e.target.matches('[data-need-acct]')) { e.target.blur(); signinSheet(); } });

function signinSheet() {
  const bg = document.createElement('div');
  bg.className = 'sheet-bg show';
  bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sh"><h3 id="sh">علشان تبعت تأملك</h3>
    <p class="note" style="font-size:14.5px;color:var(--body-2)">ادخل بحسابك في الموقع، أو اعمل حساب في دقيقة. القراءة نفسها متاحة من غير حساب.</p>
    <div class="grid" style="margin-top:14px"><button class="btn" data-x="eligible">ادخل بحسابي</button><button class="btn ghost" data-x="guest">اعمل حساب جديد</button></div>
    <p class="note" style="margin-top:12px">بعد الدخول هترجع لنفس المكان، واللي كتبته هيفضل زي ما هو.</p></div>`;
  bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); const x = e.target.closest('[data-x]'); if (x) { S.acct = x.dataset.x; bg.remove(); render(); } });
  document.body.append(bg);
}

render();
addEventListener('resize', () => { if (S.screen === 'today' || S.screen === 'notif') render(); });
