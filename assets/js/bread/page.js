/*
 * «خبزنا اليومي» — the member's page /daily-bread/ (docs/daily-bread/PLAN.md W5). The approved W1 design
 * (docs/daily-bread/w1/member.js + bread.css) on real data: the site's own CSS (main.css, nav.css) + assets/css/bread.css.
 *
 *   Screens (in-page, history.pushState: never the intro):  today (default) · ?s=reminders «إعداداتي»
 *   States:  not open yet (BREAD_MODULE off: nothing of the section shows) · no program / finished / the next one
 *            waiting · today · a late joiner · the reflection: no account / eligible / guest / sent (20 min) / edit / locked
 *   The intro (decision 15): every load of the page (a push, the home card, the menu, a link), and a back-button
 *   return from the bfcache (pageshow persisted); never with ?from=signin (the return after signing in) and never on
 *   in-page navigation. It waits only for the section to be known open (a dark cover meanwhile, see index.html).
 *   Stored on this device: bread.seed (the random device id), bread.look, bread.size, bread.plain, bread.joined.<p>,
 *   bread.read (the day «قريت» was pressed), bread.draft (an unsent reflection), bread.on (seen open).
 */
import { iconSvg } from '../icons.js';
import { bi } from './icons.js';
import { playIntro, logoSvg } from './intro.js';
import { stripTashkeel, agpeyaPsalm } from './text.js';
import { parseRef, taklaUrl } from './refs.js';
import { AR, cairoDay, programsOn, dayOf, dateText, clock, bareName, mmss, newSeed, SEED, dayDiff, feastOn, TAKLA_URL as TAKLA } from './model.js';
import { loadIndex, loadDay, loadFeasts, loadOccasions, loadPraises, beacon, session, me, reflect, reflectEdit, reflectDelete, saveLook } from './api.js';
import { occasionsOnDay, feastHidden, nextDate, cleanOccasions, praiseOf, seasonPraise } from './occasions.js';
import { seasonsOn, SEASON_NAME } from './coptic.js';
import { occasionCard, churchScreen, praiseSheet, viewerHtml, paintFrames, PRAISE_TYPE } from './occasions-view.js';
import { readFace, RETURN_KEY, FROM_KEY } from '../account/link.js';
import { soundEnabled, setSoundEnabled } from '../sound.js';

const ROOT = new URL('../../../', import.meta.url);
const html = document.documentElement;
const app = document.getElementById('app');
const q0 = new URLSearchParams(location.search);
const ASSET = p => new URL(p, ROOT).href;
const IMG = { mark: ASSET('assets/img/bread/mark-128.webp'), mark192: ASSET('assets/img/bread/mark-192.png'), logo: ASSET('assets/img/bread/logo-b-512.webp'), logoSvg: ASSET('assets/img/bread/logo-b.svg') };
const SOUND = [ASSET('assets/media/bread/intro-a.m4a'), ASSET('assets/media/bread/intro-a.opus')];
const LIMIT = 1000;
const EDIT_MS = 20 * 60000;

/* ---------------- this device ---------------- */

const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* fine */ } } };
const ss = { get: k => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch { /* fine */ } } };
let deviceSeed = ls.get('bread.seed');
if (!deviceSeed || !SEED.test(deviceSeed)) { deviceSeed = newSeed(); ls.set('bread.seed', deviceSeed); }

const reducedQ = matchMedia('(prefers-reduced-motion: reduce)');
function tier() {
  const cores = navigator.hardwareConcurrency || 8, mem = navigator.deviceMemory || 8, save = navigator.connection && navigator.connection.saveData;
  return reducedQ.matches ? 'reduced' : (cores <= 4 && mem <= 4) || mem <= 2 || save ? 'lite' : 'full';
}
html.dataset.tint = 'gold';
html.dataset.motion = tier();
html.classList.add('has-tabbar');
const savedSize = ls.get('bread.size');
html.dataset.size = /^[1-4]$/.test(savedSize || '') ? savedSize : '2';
const setLookAttr = v => { if (v === 'dawn') html.dataset.look = 'dawn'; else delete html.dataset.look; };
setLookAttr(ls.get('bread.look'));

/* ---------------- state ---------------- */

const S = {
  screen: q0.get('s') === 'reminders' ? 'reminders' : q0.get('s') === 'church' ? 'church' : 'today',
  occ: null,               // P5: «مناسبات كنيستنا» (the clean occasions file), null while off
  view: 'boot',            // boot | closed | rest | today
  day: cairoDay(),
  program: null, next: null, last: null,
  info: null, topic: null, seed: deviceSeed,
  plain: ls.get('bread.plain') === '1',
  read: false,
  acct: session() ? 'pending' : 'none',   // none | pending | eligible | guest
  refl: null,              // the sent reflection { id, text, createdMs, editableUntil }
  editing: false,
  sheet: null,             // share | signin
  rem: { status: null, times: null, max: 3, defaultTime: '08:00', busy: false },
  clockSkew: 0
};
const face = () => { try { return readFace(localStorage, sessionStorage); } catch { return null; } };
const firstName = () => (face() && face().firstName) || '';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const si = n => iconSvg(n);
const draftKey = () => (S.program && S.info ? `bread.draft.${S.program.id}.${S.info.n}` : 'bread.draft');
const draft = () => ls.get(draftKey()) || '';

/* ---------------- chrome: the site's own top bar and tab bar ---------------- */

function badgeFace() {
  const name = firstName();
  return S.acct !== 'none' && name ? `<b class="br-acct-i">${esc(Array.from(name)[0])}</b>` : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1-4.4 4-6 8-6s7 1.6 8 6"></path></svg>';
}
function topbar() {
  const on = soundEnabled();
  return `<header class="topbar" id="topbar"><div class="topbar__inner">
    <a class="br-brand" href="${ROOT.href}" aria-label="خبزنا اليومي — ارجع للموقع">
      <span class="br-brand__back" aria-hidden="true">${bi('back')}</span>
      <img class="br-brand__mark" id="brand-mark" src="${IMG.mark}" width="38" height="38" alt="">
      <span><span class="br-brand__name">خبزنا اليومي</span><span class="br-brand__sub">كلمة من الإنجيل تقوّيك كل يوم</span></span>
    </a>
    <div class="topbar__actions">
      <button class="topbar__btn" type="button" data-act="sound" aria-pressed="${on}" aria-label="أصوات الواجهة: ${on ? 'شغالة' : 'مقفولة'}">${bi(on ? 'sound' : 'soundOff')}</button>
      ${S.occ && S.view !== 'closed' ? `<a class="topbar__btn br-church-top" href="?s=church" data-nav="church" ${S.screen === 'church' ? 'aria-current="page"' : ''} aria-label="كنيستنا">${si('church')}<span>كنيستنا</span></a>` : ''}
      ${S.view === 'closed' ? '' : `<a class="topbar__btn" href="?s=reminders" data-nav="reminders" aria-label="إعداداتي">${bi('remind')}</a>`}
      <a class="acct-badge topbar__btn" href="${ROOT.href}account/" data-acct aria-label="${S.acct === 'none' ? 'سجّل دخولك' : 'حسابي'}"><span class="acct-badge__face">${badgeFace()}</span></a>
    </div>
  </div></header>`;
}
function tabbar(on) {
  const tab = (key, icon, word, href) => `<a class="tabbar__tab" href="${href}" data-tab="${key}" ${key === on ? 'aria-current="page"' : ''}>${icon}<span class="tabbar__word">${word}</span></a>`;
  return `<nav class="tabbar" aria-label="أقسام خبزنا اليومي"><span class="tabbar__lens" aria-hidden="true"></span><div class="tabbar__slots">
    ${tab('today', bi('bread'), 'النهارده', '?')}${S.occ && S.view !== 'closed' ? tab('church', si('church'), 'كنيستنا', '?s=church') : ''}${S.view === 'closed' ? '' : tab('reminders', bi('remind'), 'إعداداتي', '?s=reminders')}${tab('site', bi('home'), 'الموقع', ROOT.href)}
  </div><a class="acct-badge tabbar__tab tabbar__fixed" href="${ROOT.href}account/" data-acct data-tab="account"><span class="acct-badge__face">${badgeFace()}</span><span class="tabbar__word">حسابي</span></a></nav>`;
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

const tx = s => (S.plain ? stripTashkeel(s) : s);

function dawn() {
  const t = S.topic, i = S.info;
  return `<section class="br-dawn" aria-labelledby="br-title">
    <span class="br-dawn__rays" aria-hidden="true"></span>
    ${occTop()}
    <p class="br-day" data-d="0">${dateText(S.day)} <i></i> اليوم ${AR(i.dayNo)} من ${AR(i.ofDays)}</p>
    <h1 class="br-title" id="br-title" data-d="1">${esc(t.title)}</h1>
    <p class="br-verse" data-d="2"><q>${esc(tx(t.verse))}</q></p>
    <p class="br-ref" data-d="3">${esc(t.verseRef)}${t.verseNote ? ` <small>${esc(t.verseNote)}</small>` : ''}</p>
    <div class="br-dawn__acts" data-d="4">
      <button class="btn btn--small br-glass" type="button" data-act="share">${si('share')}شارك الآية</button>
      <button class="btn btn--small br-glass" type="button" data-act="copy">${si('copy')}انسخ</button>
    </div>
    ${HILLS}
  </section>`;
}

function paper() {
  const t = S.topic;
  // the day's verse is marked inside the reading, when the reading has more than it
  const v = parseRef(S.topic.verseRef);
  const total = t.reading.reduce((n, p) => n + p.verses.length, 0);
  const body = t.reading.map(part => part.verses.map(([n, text]) => {
    const hit = total > 1 && v.ok && part.chapter >= v.ch && part.chapter <= v.ch2 && (part.chapter > v.ch || n >= v.from) && (part.chapter < v.ch2 || n <= v.to);
    return `<sup>${AR(n)}</sup>${hit ? `<mark>${esc(tx(text))}</mark>` : esc(tx(text))} `;
  }).join('')).join('');
  const ref = parseRef(t.readingRef);
  const code = ref.ok ? ref.book : null;
  const ch = ref.ok ? ref.ch : null;
  const ag = code === 'PSA' ? agpeyaPsalm(ch, ref.from || 1) : null;
  const psalm = ag && ag !== ch ? `<span class="br-psalm">مزمور ${AR(ag)} في الأجبية</span>` : '';
  const takla = (code && taklaUrl(code, ch)) || 'https://st-takla.org/';
  return `<article class="br-paper" data-d="1" aria-labelledby="br-reading">
    <header class="br-paper__head">
      <span class="br-paper__label">${bi('reading')}<span><small>القراءة</small><b id="br-reading">${esc(t.readingRef)}</b></span></span>
      <span class="br-tools">
        <span class="br-tool br-tool--size" role="group" aria-label="حجم الخط"><span class="s" role="button" tabindex="0" data-act="smaller" aria-label="صغّر الخط">أ</span><span class="l" role="button" tabindex="0" data-act="bigger" aria-label="كبّر الخط">أ</span></span>
        <button class="br-tool" type="button" data-act="plain" aria-pressed="${S.plain}" title="من غير تشكيل" aria-label="من غير تشكيل">${bi('tashkeel')}</button>
        <button class="br-tool" type="button" data-act="look" aria-pressed="${html.dataset.look === 'dawn'}" title="شكل الفجر الفاتح" aria-label="شكل الفجر الفاتح">${bi(html.dataset.look === 'dawn' ? 'moon' : 'sun')}</button>
      </span>
    </header>
    <p class="br-reading">${body}</p>
    <footer class="br-paper__foot">${psalm}<span>ترجمة فاندايك</span><span class="sp"></span><a href="${esc(takla)}" target="_blank" rel="noopener">التفسير في موقع الأنبا تكلا ${si('external')}</a></footer>
  </article>`;
}

function meditation() {
  const src = S.topic.source;
  const by = src && TAKLA.test(src.url)
    ? `<p class="br-med__by br-med__src">بمساعدة <a href="${esc(src.url)}" target="_blank" rel="noopener">موقع الأنبا تكلا</a>${src.refs ? ` · ${esc(src.refs)}` : ''}</p>`
    : '<p class="br-med__by">من خدام الأسرة</p>';
  return `<section class="widget br-card br-med" data-d="0"><h2 class="br-kicker">${bi('lantern')}تأمل النهارده</h2>${medText(S.topic.meditation)}${by}</section>`;
}

/*
 * W7: a saint's feast or a church feast on today's DATE (not the program day), from the month's feasts file.
 * Shown after the reflection (the owner's order: verse, reading, meditation, the youth's own words, then the feast).
 */
/* P5: today's «مناسبات كنيستنا» (one card; the first leads) */
const occToday = () => occasionsOnDay(S.occ, S.day);
/* a patron's Synaxarium word: the feasts file's word for that day, as «نحب نفكّرك» would have shown it */
function patronWord(list) {
  const o = list[0], f = S.feast;
  if (!o || !f || (o.type !== 'patron' && o.type !== 'family')) return null;
  return feastHidden(f, [o]) ? f.word : null;
}
function occTop() {
  const list = occToday();
  return list.length ? occasionCard(list, S.day, { file: S.occ, word: patronWord(list), medText }) : '';
}

function feast() {
  const f = S.feast;
  if (!f) return seasonCard();
  // P5: a day «مناسبات كنيستنا» stands for is never repeated here
  if (S.occ && feastHidden(f, occToday())) return '';
  // one picture, lazy; an AI or painted one carries a small «صورة تعبيرية» (P4, owner 2026-11-24). Never a photographer's name.
  const pic = f.img ? `<figure class="br-feast__fig"><span class="br-feast__pic"><img class="br-feast__img" src="${esc(f.img)}" alt="${esc(f.name)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">${f.imgAi ? '<span class="br-feast__ai">صورة تعبيرية</span>' : ''}</span></figure>` : '';
  // the saint's own praise (tamgeed / madih) from the registry, always with its source (owner, 2026-11-19)
  const praise = feastPraise(f);
  const praiseLink = !praise && f.praise ? ` · <a href="${esc(f.praise)}" target="_blank" rel="noopener">التمجيد</a>` : '';
  const src = TAKLA.test(f.url) ? 'سنكسار موقع الأنبا تكلا' : 'المصدر';
  // P5 (owner 2026-11-25): the reposed popes keep a papal touch here
  const pope = /^(القديس )?البابا /.test(f.name);
  return `<section class="widget br-card br-feast${pope ? ' br-feast--pope' : ''}" data-d="0"><h2 class="br-kicker">${bi('sun')}نحب نفكّرك${pope ? `<span class="br-feast__badge">${si('cross')}من بطاركة كنيستنا</span>` : ''}</h2>${pic}<p class="br-feast__name">النهارده تذكار ${esc(f.name)}</p>${f.title && f.title !== f.name ? `<p class="br-feast__title">${esc(f.title)}</p>` : ''}${medText(f.word)}${praise}<p class="br-med__by br-med__src">من <a href="${esc(f.url)}" target="_blank" rel="noopener">${src}</a>${praiseLink}</p></section>`;
}

/*
 * W7: a meditation taken from St-Takla.org keeps their own links as [words](url) (their terms, FAQ 043).
 * Only https://st-takla.org links become links; everything else stays text. Blank lines = paragraphs.
 */
function medText(text) {
  const link = s => esc(s).replace(/\[([^\]\n]{1,200})\]\(([^)\s]{1,400})\)/g, (m, words, url) => {
    const raw = url.replace(/&amp;/g, '&');
    return TAKLA.test(raw) ? `<a href="${esc(raw)}" target="_blank" rel="noopener">${words}</a>` : words;
  });
  return String(text || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).map(p => `<p>${link(p)}</p>`).join('');
}

const PRIV = `<p class="br-priv">${bi('shield')}<span>تأملك بيوصل لخدام الأسرة بس، ومش بيظهر لحد تاني. تقدر تعدّله أو تمسحه أول ٢٠ دقيقة.</span></p>`;
function field(value, label, placeholder = 'اكتب تأملك هنا…') {
  return `<label class="br-field"><textarea maxlength="${LIMIT}" ${placeholder ? `placeholder="${placeholder}"` : ''} aria-label="${label}">${esc(value)}</textarea><span class="br-field__count">${AR(value.length)} / ${AR(LIMIT)}</span></label>`;
}
function hello(small) {
  const name = firstName();
  const initial = name ? esc(Array.from(name)[0]) : bi('pen');
  if (S.acct === 'guest') return `<div class="br-hello"><span class="br-arch">${initial}</span><div><b>أهلاً بيك${name ? ' يا ' + esc(name) : ''} 🤍 <span class="br-tag br-tag--guest">ضيف</span></b><small>${small || 'مبسوطين إنك معانا. تأملك بيوصل لخدام الأسرة بس.'}</small></div></div>`;
  return `<div class="br-hello"><span class="br-arch">${initial}</span><div><b>أهلاً${name ? ' يا ' + esc(name) : ''} 👋</b><small>${small || 'اكتب اللي جه في بالك، ولو سطر واحد.'}</small></div></div>`;
}
const now = () => Date.now() + S.clockSkew;
function ring(left) {
  const p = Math.max(0, Math.min(1, left / EDIT_MS));
  return `<span class="br-ring" data-p="${p.toFixed(3)}"><svg viewBox="0 0 52 52"><circle class="t" cx="26" cy="26" r="22" pathLength="100"/><circle class="v" cx="26" cy="26" r="22" pathLength="100"/></svg><b data-clock>${mmss(left)}</b></span>`;
}
/* «٩:٣٨ ص», Cairo time */
function sentTime(ms) {
  let hhmm;
  try { hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms)); }
  catch { hhmm = new Date(ms + 2 * 3600000).toISOString().slice(11, 16); }
  return clock(hhmm).join(' ');
}
function reflectState() {
  if (S.acct === 'none') {
    return `${field(draft(), 'تأملك')}
      ${PRIV}<div class="br-acts"><button class="btn btn--primary" type="button" data-act="signin">${bi('lock')}ادخل بحسابك وابعت</button></div>
      <p class="br-keep">القراءة مش محتاجة حساب. الحساب بس علشان تبعت تأملك، واللي كتبته هيفضل محفوظ لحد ما ترجع.</p>`;
  }
  if (S.acct === 'pending') return `<p class="br-keep" role="status">لحظة…</p>`;
  const r = S.refl;
  if (r) {
    const left = r.editableUntil - now();
    if (S.editing && left > 0) {
      return `${hello()}${field(r.text, 'عدّل تأملك', '')}
        <div class="br-timer">${ring(left)}<p class="br-timer__txt">بتعدّل تأملك. فاضل <b data-mins>${AR(Math.ceil(left / 60000))} دقيقة</b> على قفل التعديل.</p></div>
        <div class="br-acts br-gap"><button class="btn btn--primary" type="button" data-act="save">${si('check')}احفظ التعديل</button><button class="btn btn--small" type="button" data-act="cancel">إلغاء</button></div>`;
    }
    const locked = left <= 0;
    return `${hello(locked ? 'تأملك وصل لخدام الأسرة 🤍' : 'وصل تأملك 🤍 ربنا يباركك')}
      <div class="br-sent"><p>${esc(r.text)}</p><p class="br-sent__meta"><span class="ok">${si('check')}اتبعت</span> · النهارده ${esc(sentTime(r.createdMs))} · لخدام الأسرة بس</p></div>
      ${locked ? `<p class="br-locked">${bi('lock')}<span>عدّت الـ٢٠ دقيقة، فالتأمل اتقفل ومبقاش ينفع يتعدّل أو يتمسح.</span></p>`
      : `<div class="br-timer">${ring(left)}<p class="br-timer__txt"><b>تقدر تعدّل أو تمسح</b><br>لمدة <span data-mins>${AR(Math.ceil(left / 60000))} دقيقة</span>، وبعدها بيتقفل.</p></div>
        <div class="br-acts br-gap"><button class="btn btn--small" type="button" data-act="edit">${bi('pen')}عدّل</button><button class="btn btn--small btn--ghost-danger" type="button" data-act="delete">${bi('trash')}امسح</button></div>`}`;
  }
  const d = draft();
  return `${hello()}${field(d, 'تأملك')}
    ${PRIV}<div class="br-acts"><button class="btn btn--primary" type="button" data-act="send" ${d.trim() ? '' : 'disabled'}>${si('arrow')}ابعت تأملك</button></div>`;
}
function question() {
  const t = S.topic;
  const head = t.question
    ? `<h2 class="br-kicker">${bi('question')}سؤال النهارده<small>اختياري</small></h2><p class="br-q__text">${esc(t.question)}</p><p class="br-q__hint">فكّر فيه طول اليوم… ولو حابب، اكتب تأملك.</p><div class="br-sep"></div>`
    : `<h2 class="br-kicker">${bi('pen')}تأملك النهارده<small>اختياري</small></h2>`;
  return `<section class="widget br-card br-q" id="reflect" data-d="1">${head}<div id="reflect-body">${reflectState()}</div></section>`;
}

function firstTime() {
  const t = S.rem.times && S.rem.times[0];
  return t ? clock(t).join(' ') : '';
}
function done() {
  const next = S.rem.status && S.rem.status.on && firstTime() ? ' ' + firstTime() : '';
  return `<button class="br-done" type="button" data-act="read" aria-pressed="${S.read}" data-d="2"><span class="br-done__bloom"></span>
    <span class="br-done__ic">${si('check')}</span><span>${S.read ? `<b>ربنا يباركك 🤍</b><small>قريت قراءة النهارده · نشوفك بكره${next}</small>` : '<b>قريت قراءة النهارده</b><small>دوس لما تخلّص. ده بس بيفرّحنا، مفيش عدّاد.</small>'}</span></button>`;
}

function remOn() { return !!(S.rem.status && S.rem.status.on && S.rem.times && S.rem.times.length); }
function remindTeaser() {
  if (remOn()) return `<section class="widget br-card" data-d="3"><div class="br-remind"><span class="br-remind__ic">${bi('remind')}</span><div><b>فكّرني كل يوم</b><small>بنفكّرك ${esc(firstTime())} ·<a href="?s=reminders" data-nav="reminders" class="br-link">غيّر المواعيد</a></small></div><button class="br-switch" role="switch" aria-checked="true" aria-label="فكّرني كل يوم" data-act="remind"></button></div></section>`;
  return `<section class="widget br-card" data-d="3"><div class="br-remind"><span class="br-remind__ic">${bi('remind')}</span><div><b>فكّرني كل يوم</b><small>إشعار واحد الصبح بكلمة النهارده. تقدر تغيّر الميعاد بعدين.</small></div><button class="br-switch" role="switch" aria-checked="false" aria-label="فكّرني كل يوم" data-act="remind"></button></div></section>`;
}

function signature() {
  return `<footer class="br-sig"><img src="${IMG.logo}" width="92" height="92" alt="خبزنا اليومي"><p><b>إعداد وإشراف أسرة البابا أثناسيوس الرسولي للشباب</b><br>كنيسة أبي سيفين بسفاجا</p></footer>`;
}

function renderToday() {
  const i = S.info;
  const late = i.late && i.firstDay ? `<p class="br-note" data-d="0"><span class="br-note__ic">${bi('sun')}</span><span><b>أهلاً بيك في «${esc(bareName(S.program.name))}» 🤍</b><br>البرنامج بدأ من ${AR(i.lateBy)} يوم، فهتشارك في الـ${AR(i.ofDays)} يوم الباقيين. كل يوم كلمة جديدة ليك إنت.</span></p>` : '';
  return `${topbar()}<main id="main">${dawn()}<div class="br-main"><div class="br-side br-side--read">${late}${paper()}</div><div class="br-side">${meditation()}${question()}${done()}${feast()}${remindTeaser()}</div></div>${signature()}</main>${tabbar('today')}`;
}

/* ---------------- P5: the «كنيستنا» tab, the pictures, the full praise ---------------- */

function renderChurch() {
  const list = occToday();
  const today = list.length ? occasionCard(list, S.day, { file: S.occ, word: patronWord(list), medText }) : '';
  return `${topbar()}${churchScreen(S.occ, S.day, { todayCard: today })}${tabbar('church')}`;
}
function dialog(cls, label, inner) {
  document.querySelectorAll('dialog.' + cls).forEach(d => d.remove());
  const d = document.createElement('dialog');
  d.className = cls;
  d.setAttribute('aria-label', label);
  d.innerHTML = inner;
  document.body.append(d);
  paintFrames(d);
  d.addEventListener('close', () => d.remove());
  d.showModal();
  return d;
}
function openViewer(id, at) {
  const o = S.occ && S.occ.occasions.find(x => x.id === id);
  const fam = S.occ && S.occ.patrons.family;
  const ps = o && o.type === 'family' && fam ? [{ img: fam.img, ai: fam.ai, caption: fam.name }] : o ? o.pictures : [];
  if (!ps.length) return;
  let i = Math.max(0, Math.min(ps.length - 1, at || 0));
  const d = dialog('oc-view', 'صور المناسبة', viewerHtml(ps, i));
  d.addEventListener('click', e => {
    const st = e.target.closest('[data-step]');
    if (st) { i = (i + +st.dataset.step + ps.length) % ps.length; d.innerHTML = viewerHtml(ps, i); return; }
    if (e.target === d || e.target.closest('[data-close-view]')) d.close();
  });
}
function openPraise(id) {
  const k = S.occ && Object.keys(S.occ.patrons).find(x => S.occ.patrons[x].id === id);
  const p = k && S.occ.patrons[k];
  if (!p || !p.praise || !p.praise.verses.length) return;
  const d = dialog('pr', p.praise.title || p.name, praiseSheet({ ...p, kind: k }));
  d.setAttribute('aria-labelledby', 'pr-title');
  d.addEventListener('click', e => {
    const z = e.target.closest('.pr__btn[data-size]');   // not <html data-size>
    if (z) { setSize(+z.dataset.size); return; }
    if (e.target === d || e.target.closest('[data-pr-close]')) d.close();
  });
}
/*
 * P5b (owner 2026-11-25): the day's praise — تمجيد، مديح، تسبحة… — shown whole inside «نحب نفكّرك», no button.
 * Its text is in praises.json, read right after the page shows (the first lines stand in until then); if that file
 * can't come, the first lines stay with a link to the source.
 */
function feastPraise(f) {
  const q = S.feastPraise;
  if (q && q !== 'none') {
    const kind = [PRAISE_TYPE[q.type] || 'تمجيد', q.context].filter(Boolean).join(' · ');
    const host = new URL(q.source).hostname.replace(/^www\./, '');
    return `<blockquote class="br-feast__praise br-feast__praise--full"><p class="br-feast__praise-title">${esc(q.title)}<small>${esc(kind)}</small></p>${q.verses.map(v => `<p class="br-feast__st">${v.map(esc).join('<br>')}${q.refrain ? `<br><span class="br-feast__ref">${esc(q.refrain)}</span>` : ''}</p>`).join('')}<p class="br-med__by">المصدر: <a href="${esc(q.source)}" target="_blank" rel="noopener">${esc(host)}</a></p></blockquote>`;
  }
  const lines = f.praiseText ? f.praiseText.split('\n').map(l => l.trim()).filter(Boolean) : [];
  if (!lines.length) return '';
  const link = !f.praiseId || q === 'none' ? `<p class="br-med__by"><a href="${esc(f.praise)}" target="_blank" rel="noopener">التمجيد كامل</a></p>` : '';
  return `<blockquote class="br-feast__praise"><p class="br-feast__praise-title">${esc(f.praiseTitle || 'من التمجيد')}</p><p class="br-feast__praise-text">${lines.map(esc).join('<br>')}</p>${link}</blockquote>`;
}
/*
 * P5b (owner 2026-11-25): a day with no saint's card, in a season with a praise set for it (صوم العذراء، كيهك…):
 * «نحب نفكّرك» carries that praise, whole. Read only on such a day (praises.json).
 */
function seasonCard() {
  const z = S.season;
  if (!z || (S.occ && occToday().length)) return '';
  const q = z.praise;
  const kind = [PRAISE_TYPE[q.type] || 'تمجيد', z.name].filter(Boolean).join(' · ');
  const host = new URL(q.source).hostname.replace(/^www\./, '');
  return `<section class="widget br-card br-feast br-feast--season" data-d="0"><h2 class="br-kicker">${bi('sun')}نحب نفكّرك</h2><p class="br-feast__name">إحنا في ${esc(SEASON_NAME[z.season])}</p><blockquote class="br-feast__praise br-feast__praise--full"><p class="br-feast__praise-title">${esc(q.title)}<small>${esc(kind)}</small></p>${q.verses.map(v => `<p class="br-feast__st">${v.map(esc).join('<br>')}${q.refrain ? `<br><span class="br-feast__ref">${esc(q.refrain)}</span>` : ''}</p>`).join('')}<p class="br-med__by">المصدر: <a href="${esc(q.source)}" target="_blank" rel="noopener">${esc(host)}</a></p></blockquote></section>`;
}
async function fillSeason() {
  if (S.feast || S.season || !S.topic) return;
  const seasons = seasonsOn(S.day);
  if (!seasons.length) return;
  S.season = seasonPraise(await loadPraises(), seasons);
  if (S.season && S.view === 'today' && !app.querySelector('.br-feast')) render();
}
async function fillFeastPraise() {
  const f = S.feast;
  if (!f || !f.praiseId || S.feastPraise) return;
  S.feastPraise = praiseOf(await loadPraises(), f.person, f.praiseId) || 'none';
  const old = app.querySelector('.br-feast .br-feast__praise');
  if (old) old.outerHTML = feastPraise(f);
}
function openOccasion(id, at) {
  const o = S.occ && S.occ.occasions.find(x => x.id === id);
  if (!o) return;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(at || '') ? at : nextDate(o, S.day);
  const d = dialog('ch-sheet', o.headline, `<button class="oc-view__btn ch-sheet__x" type="button" data-sheet-close aria-label="اقفل">${si('close')}</button><p class="ch-sheet__when">${esc(dateText(day))}</p>${occasionCard([o], day, { file: S.occ, medText, sheet: day !== S.day })}`);
  d.addEventListener('click', e => {
    const v = e.target.closest('[data-view]'); if (v) { openViewer(o.id, +v.dataset.view); return; }
    const pr = e.target.closest('[data-praise]'); if (pr) { openPraise(pr.dataset.praise); return; }
    if (e.target === d || e.target.closest('[data-sheet-close]')) d.close();
  });
}

/* ---------------- no reading today: finished / waiting / nothing yet / not open ---------------- */

function restPage(title, text, extra = '') {
  return `${topbar()}<main id="main">
    <section class="br-dawn br-dawn--rest"><span class="br-dawn__rays" aria-hidden="true"></span>
      <div class="br-rest"><div class="br-rest__logo"><span class="br-rest__glow"></span><img src="${IMG.logo}" width="300" height="300" alt=""></div>
        <h1>${title}</h1><p>${text}</p></div>${S.view === 'rest' ? occTop() : ''}${HILLS}</section>
    <div class="br-sheet-page br-sheet-page--rest">
      ${extra}
      <a class="btn btn--block" href="${ROOT.href}">${bi('home')}ارجع للموقع</a>
    </div>${S.view === 'closed' ? '' : signature()}</main>${tabbar('today')}`;
}
function remindRest() {
  if (remOn()) return `<section class="widget br-card"><div class="br-remind"><span class="br-remind__ic">${bi('remind')}</span><div><b>إشعاراتك لسه شغالة</b><small>هتوصلك أول كلمة من البرنامج الجديد ${esc(firstTime())}</small></div><button class="br-switch" role="switch" aria-checked="true" aria-label="فكّرني" data-act="remind"></button></div></section>`;
  return `<section class="widget br-card"><div class="br-remind"><span class="br-remind__ic">${bi('remind')}</span><div><b>فكّرني لما يبدأ</b><small>إشعار واحد الصبح بكلمة النهارده أول ما البرنامج الجديد يبدأ.</small></div><button class="br-switch" role="switch" aria-checked="false" aria-label="فكّرني" data-act="remind"></button></div></section>`;
}
function renderRest() {
  if (S.view === 'closed') return restPage('«خبزنا اليومي» لسه مبدأش', 'قريب قوي هنبدأ هنا: كلمة من الإنجيل كل يوم، ليك إنت. خلّيك متابع 🤍');
  const n = S.next;
  const when = n ? (dayDiff(n.startsOn, S.day) === 1 ? 'بكره' : dateText(n.startsOn)) : '';
  if (S.last) {
    const title = `خلّصنا «${esc(bareName(S.last.name))}» 🤍`;
    const text = n ? `شكرًا إنك كنت معانا ${AR(S.last.days)} يوم. البرنامج الجديد «${esc(bareName(n.name))}» بيبدأ ${esc(when)}.` : `شكرًا إنك كنت معانا ${AR(S.last.days)} يوم. قريب قوي هيبدأ برنامج جديد، وأول ما يبدأ هنفكّرك في نفس ميعادك.`;
    return restPage(title, text, remindRest());
  }
  if (n) return restPage(`«${esc(bareName(n.name))}» قرّب 🤍`, `البرنامج بيبدأ ${esc(when)}، ${AR(n.days)} يوم، كل يوم كلمة جديدة ليك إنت.`, remindRest());
  return restPage('قريب قوي 🤍', 'لسه مفيش برنامج شغال. أول ما يبدأ برنامج جديد هتلاقي كلمة النهارده هنا.', remindRest());
}

/* ---------------- «إعداداتي» ---------------- */

const LABEL = t => { const h = +t.slice(0, 2); return h < 12 ? 'الصبح' : h < 17 ? 'الضهر' : h < 21 ? 'بالليل' : 'قبل النوم'; };
function renderReminders() {
  const st = S.rem.status || { support: 'ok', permission: 'default', on: false };
  const ios = st.support === 'ios-install' || st.support === 'ios-safari';
  const denied = st.permission === 'denied';
  const on = remOn();
  const times = S.rem.times || [];
  let body = '';
  if (denied) body = `<p class="br-hint br-hint--warn">${si('alert')}<span><b>الإشعارات مقفولة من المتصفح.</b> افتح إعدادات الموقع في المتصفح (القفل جنب العنوان) ← الإشعارات ← اسمح، وبعدها ارجع هنا.</span></p>`;
  else if (ios) body = `<p class="br-hint">${bi('phone')}<span><b>على iPhone:</b> الإشعارات بتشتغل بس لما الموقع يبقى على الشاشة الرئيسية. دوس زرار المشاركة ⬆︎ ← «إضافة إلى الشاشة الرئيسية»، وافتحه من هناك.</span></p>`;
  const t = S.topic;
  const notif = t ? `<div class="nf-a br-preview-notif"><div class="nf-a__top"><img src="${IMG.mark192}" alt="">أسرة البابا أثناسيوس · خبزنا اليومي · ${esc(clock(times[0] || S.rem.defaultTime).join(' '))}</div><div class="nf-a__body"><div><b>${esc(t.title)}</b><p>«${esc(stripTashkeel(t.verse).slice(0, 58))}…» — ${esc(t.verseRef)}</p></div><img class="nf-a__thumb" src="${IMG.mark192}" alt=""></div></div>` : '';
  return `${topbar()}<main id="main" class="br-sheet-page">
    <div class="br-h1"><span class="br-remind__ic">${bi('remind')}</span><div><h1>إعداداتي</h1><p>إشعارات «خبزنا اليومي» وشكل القراءة. بتوعك إنت بس.</p></div></div>
    <section class="widget br-card"><div class="br-remind"><div><b>فكّرني كل يوم</b><small>${on ? 'شغالة على الجهاز ده' : denied ? 'محتاجة إذن من المتصفح' : 'مقفولة دلوقتي'}</small></div><button class="br-switch" role="switch" aria-checked="${on}" aria-label="فكّرني كل يوم" data-act="remind" ${S.rem.busy ? 'aria-busy="true"' : ''}></button></div>
      ${body}
      ${on ? `<div class="br-times">${times.map((x, k) => `<div class="br-time"><span class="br-time__clock">${si('clock')}</span><div><b>${clock(x)[0]} <small class="br-time__ap">${clock(x)[1]}</small></b><small>${LABEL(x)}</small></div>${times.length > 1 ? `<button class="br-time__x" type="button" data-act="drop" data-k="${k}" aria-label="شيل الميعاد ده">${si('close')}</button>` : ''}</div>`).join('')}
        ${times.length < S.rem.max ? `<label class="br-add">${bi('plus')}ضيف ميعاد (لحد ${AR(S.rem.max)})<input class="br-add__time" type="time" step="900" aria-label="ميعاد جديد" data-act="add"></label>` : ''}</div>` : ''}
      ${!on && !denied && !ios ? `<p class="br-hint br-gap14">${si('info')}<span>لما تشغّلها، المتصفح هيسألك مرة واحدة تسمح بالإشعارات. الافتراضي ${esc(clock(S.rem.defaultTime).join(' ').replace(' ص', ' الصبح'))} بتوقيت مصر.</span></p>` : ''}
    </section>
    ${lookCard()}
    ${notif ? `<section class="widget br-card"><h2 class="br-kicker">${bi('remind')}شكل الإشعار</h2>${notif}<p class="br-hint br-gap">${si('info')}<span>كل يوم: عنوان موضوعك إنت وأول الآية. لو قريت قبل الميعاد التاني، مش هنفكّرك تاني في نفس اليوم.</span></p></section>` : ''}
  </main>${tabbar('reminders')}`;
}
function lookCard() {
  const dawnOn = html.dataset.look === 'dawn';
  const opt = (k, name, hint, on) => `<button class="br-look" type="button" role="radio" aria-checked="${on}" data-act="look-${k}"><span class="br-look__pv br-look__pv--${k}" aria-hidden="true"><i></i><b></b><em></em><em></em><em></em></span><span class="br-look__txt"><b>${name}</b><small>${hint}</small></span><span class="br-look__dot" aria-hidden="true"></span></button>`;
  return `<section class="widget br-card"><h2 class="br-kicker">${bi('sun')}شكل القراءة</h2>
    <div class="br-looks" role="radiogroup" aria-label="شكل القراءة">${opt('night', 'كحلي + ورق', 'الافتراضي: هادي بالليل، والقراءة على ورقة', !dawnOn)}${opt('dawn', 'الفجر', 'فاتح ودافي، مريح الصبح وفي الشمس', dawnOn)}</div>
    <p class="br-hint br-gap">${si('info')}<span>بيتحفظ لك: على الجهاز ده، ولو داخل بحسابك بيمشي معاك على أي جهاز. مستقل عن «لون الموقع». تقدر تبدّله كمان من زرار ☀︎ جوه القراءة.</span></p></section>`;
}

/* ---------------- sheets: share, sign-in ---------------- */

function shareSheet() {
  return `<div class="br-scrim" data-act="close"></div><div class="br-sheet" role="dialog" aria-modal="true" aria-label="شارك الآية" tabindex="-1"><div class="br-sheet__grip"></div>
    <h2>شارك الآية</h2><p>صورة مربعة بالآية ولوجو «خبزنا اليومي»، ومعاها لينك الصفحة.</p>
    <img class="br-shareimg" id="share-img" alt="صورة الآية" width="340" height="340">
    <div class="br-sheet__acts"><button class="btn btn--primary" type="button" data-act="share-img">${si('share')}شارك الصورة</button><button class="btn" type="button" data-act="save-img">${si('download')}احفظ الصورة</button><button class="btn" type="button" data-act="copy">${si('copy')}انسخ الآية</button></div></div>`;
}
function signinSheet() {
  return `<div class="br-scrim" data-act="close"></div><div class="br-sheet" role="dialog" aria-modal="true" aria-label="ادخل بحسابك" tabindex="-1"><div class="br-sheet__grip"></div>
    <h2>ادخل علشان تبعت تأملك</h2><p>اللي كتبته محفوظ على الجهاز ده. بعد ما تدخل هترجع لنفس المكان، والتأمل جاهز تبعته.</p>
    <div class="br-sheet__acts"><button class="btn btn--primary" type="button" data-act="go-signin">${si('user')}ادخل بحسابك</button><button class="btn" type="button" data-span data-act="go-signin">اعمل حساب في دقيقة</button></div>
    <p class="br-keep">مفيش حساب؟ عادي، تقدر تكمّل قراءة من غير حساب.</p></div>`;
}

/* ---------------- render ---------------- */

function view() {
  if (S.view === 'boot') return `${topbar()}<main id="main" aria-busy="true"></main>`;
  if (S.screen === 'church' && S.occ && S.view !== 'closed') return renderChurch();
  if (S.view === 'closed' || S.view === 'rest') return renderRest();
  return S.screen === 'reminders' ? renderReminders() : renderToday();
}
function render() {
  document.body.className = 'br-page';
  const focus = document.activeElement && document.activeElement.matches('.br-field textarea') ? { sel: document.activeElement.selectionStart } : null;
  app.innerHTML = `<div class="backdrop" aria-hidden="true"><div class="backdrop__glow"></div><div class="backdrop__lattice"></div></div>${view()}${S.sheet === 'share' ? shareSheet() : ''}${S.sheet === 'signin' ? signinSheet() : ''}<p class="br-toast" id="toast" role="status"></p>`;
  paintRings();
  paintFrames(app);
  requestAnimationFrame(placeLens);
  if (focus) { const ta = app.querySelector('.br-field textarea'); if (ta) { ta.focus(); try { ta.setSelectionRange(focus.sel, focus.sel); } catch { /* fine */ } } }
  if (S.sheet) app.querySelector('.br-sheet')?.focus();
  if (S.sheet === 'share') fillShare();
}
/* only the reflection card (keeps the page still while the 20 minutes run) */
function renderReflect() {
  const box = document.getElementById('reflect-body');
  if (box) { box.innerHTML = reflectState(); paintRings(); } else render();
}
/* the CSP (style-src 'self') refuses style attributes in markup: the ring's --p is set here */
function paintRings() {
  app.querySelectorAll('.br-ring[data-p]').forEach(r => r.style.setProperty('--p', r.dataset.p));
}

function toast(text) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = text; t.classList.add('is-on');
  clearTimeout(toast.k); toast.k = setTimeout(() => t.classList.remove('is-on'), 2400);
}

/* in-page screens: pushState, never the intro */
function go(screen, { replace = false } = {}) {
  S.screen = screen;
  S.sheet = null;
  const url = screen === 'reminders' ? '?s=reminders' : screen === 'church' ? '?s=church' : location.pathname;
  history[replace ? 'replaceState' : 'pushState']({ bread: screen }, '', url);
  render();
  scrollTo(0, 0);
  if (screen === 'reminders') loadReminders();
}

/* ---------------- actions ---------------- */

function setSize(delta) {
  const n = Math.max(1, Math.min(4, +html.dataset.size + delta));
  html.dataset.size = String(n);
  ls.set('bread.size', String(n));
}
function setLook(v, { save = true } = {}) {
  setLookAttr(v);
  ls.set('bread.look', v === 'dawn' ? 'dawn' : 'night');
  const s = session();
  if (save && s) saveLook(s.token, v === 'dawn' ? 'dawn' : 'night').then(r => { if (r.ok) ls.set('bread.look.synced', v === 'dawn' ? 'dawn' : 'night'); });
}
function copyVerse() {
  const t = S.topic;
  if (!t) return;
  const text = `«${tx(t.verse)}» (${t.verseRef})\n${location.origin}${location.pathname}`;
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast('اتنسخت الآية ✓'), () => toast('ما قدرناش ننسخ. علّم على الآية وانسخها.'));
}

let shareCanvas = null;
async function fillShare() {
  const img = document.getElementById('share-img');
  if (!img || !S.topic) return;
  const { drawShare, toBlob } = await import('./share.js');
  shareCanvas ||= await drawShare({ verse: S.topic.verse, verseRef: S.topic.verseRef, plain: S.plain, mark: IMG.mark192 });
  const blob = await toBlob(shareCanvas);
  shareCanvas.blob = blob;
  if (img.src) URL.revokeObjectURL(img.src);
  img.src = URL.createObjectURL(blob);
}
async function shareImage(save) {
  if (!shareCanvas || !shareCanvas.blob) await fillShare();
  const blob = shareCanvas && shareCanvas.blob;
  if (!blob) return;
  const file = new File([blob], 'khobzna-alyawmi.png', { type: 'image/png' });
  const url = location.origin + location.pathname;
  if (!save && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], text: `«${tx(S.topic.verse)}» (${S.topic.verseRef})\n${url}` }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  if (!save && navigator.share) {
    try { await navigator.share({ title: 'خبزنا اليومي', text: `«${tx(S.topic.verse)}» (${S.topic.verseRef})`, url }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('اتحفظت الصورة ✓');
}

function signIn() {
  ss.set(RETURN_KEY, location.pathname + '?from=signin#reflect');
  location.href = ROOT.href + 'account/';
}

function apiError(r, fallback) {
  if (r.status === 0) return 'النت فاصل؟ جرّب تاني.';
  return (r.body && r.body.message) || fallback;
}

async function send() {
  const ta = app.querySelector('.br-field textarea');
  const text = (ta ? ta.value : draft()).trim();
  const s = session();
  if (!text || !s) return;
  const btn = app.querySelector('[data-act="send"]'); if (btn) btn.disabled = true;
  const r = await reflect(s.token, S.seed, text);
  if (r.ok && r.body.reflection) {
    S.refl = r.body.reflection; syncSkew(S.refl);
    ls.set(draftKey(), null);
    renderReflect(); startTicker();
    return;
  }
  if (r.status === 409 && r.body.reflection) { S.refl = r.body.reflection; syncSkew(S.refl); ls.set(draftKey(), null); renderReflect(); startTicker(); toast(apiError(r, 'انت كتبت تأمل النهارده خلاص.')); return; }
  if (r.status === 401) { S.acct = 'none'; renderReflect(); toast('ادخل بحسابك تاني علشان تبعت.'); return; }
  if (btn) btn.disabled = false;
  toast(apiError(r, 'ما قدرناش نبعت التأمل. جرّب تاني.'));
}
async function saveEdit() {
  const ta = app.querySelector('.br-field textarea');
  const text = (ta ? ta.value : '').trim();
  const s = session();
  if (!text || !s || !S.refl) return;
  const r = await reflectEdit(s.token, S.refl.id, text);
  if (r.ok) { S.refl = { ...S.refl, text }; S.editing = false; renderReflect(); toast('اتحفظ التعديل ✓'); return; }
  if (r.body && r.body.code === 'locked') { S.refl = { ...S.refl, editableUntil: now() - 1 }; S.editing = false; renderReflect(); }
  toast(apiError(r, 'ما قدرناش نحفظ التعديل.'));
}
async function remove() {
  const s = session();
  if (!s || !S.refl) return;
  const r = await reflectDelete(s.token, S.refl.id);
  if (r.ok) { S.refl = null; S.editing = false; renderReflect(); toast('اتمسح التأمل'); return; }
  if (r.body && r.body.code === 'locked') { S.refl = { ...S.refl, editableUntil: now() - 1 }; renderReflect(); }
  toast(apiError(r, 'ما قدرناش نمسح التأمل.'));
}
/* the device clock may be off: the server's createdMs is "now" at the moment the answer came */
function syncSkew(r) { if (r && r.createdMs && !syncSkew.done && Math.abs(r.createdMs - Date.now()) < 6 * 3600000 && Date.now() - r.createdMs < 5000) { S.clockSkew = r.createdMs - Date.now(); syncSkew.done = true; } }

let ticker = 0;
function startTicker() {
  clearInterval(ticker);
  if (!S.refl) return;
  ticker = setInterval(() => {
    const left = S.refl ? S.refl.editableUntil - now() : 0;
    if (left <= 0) { clearInterval(ticker); S.editing = false; renderReflect(); return; }
    const c = app.querySelector('[data-clock]'); if (c) c.textContent = mmss(left);
    const ringEl = app.querySelector('.br-ring'); if (ringEl) ringEl.style.setProperty('--p', (left / EDIT_MS).toFixed(3));
    const m = app.querySelector('[data-mins]'); if (m) m.textContent = AR(Math.ceil(left / 60000)) + ' دقيقة';
  }, 1000);
}

function markRead() {
  S.read = !S.read;
  ls.set('bread.read', S.read ? S.day : null);
  if (S.read) beacon(S.seed, 'read', S.day);
  const old = app.querySelector('.br-done');
  if (!old) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = done();
  const nb = tmp.firstElementChild;
  old.replaceWith(nb);
  nb.focus();
  if (S.read && html.dataset.motion !== 'reduced') {
    nb.querySelector('.br-done__bloom').animate([{ opacity: .9, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(80)' }], { duration: 900, easing: 'cubic-bezier(.22,1,.36,1)' });
    nb.querySelector('.br-done__ic').animate([{ transform: 'scale(.6)' }, { transform: 'scale(1.12)' }, { transform: 'none' }], { duration: 650, easing: 'cubic-bezier(.3,1.4,.5,1)' });
  }
}

/* ---------------- «فكّرني» (push.js: the site's own notifications) ---------------- */

let pushMod = null;
const push = async () => (pushMod ||= await import('../push.js'));
async function loadReminders() {
  try {
    const p = await push();
    S.rem.status = p.pushStatus();
    if (S.rem.status.on) {
      const r = await p.breadSlots(undefined, S.seed);
      if (r.ok) Object.assign(S.rem, { times: r.times, max: r.max, defaultTime: r.defaultTime });
      // W6: on by default with the site's notifications: keep the default time with this device's seed (its own topics)
      if (r.ok && r.auto) {
        const k = await p.breadSlots([r.defaultTime], S.seed);
        if (k.ok) Object.assign(S.rem, { times: k.times });
      }
    }
    else S.rem.times = [];
  }
  catch { S.rem.status = { support: 'unsupported', permission: 'default', on: false }; S.rem.times = []; }
  if (S.view !== 'boot') render();
}
async function saveTimes(times, okText) {
  if (S.rem.busy) return;
  S.rem.busy = true;
  const p = await push().catch(() => null);
  const r = p ? await p.breadSlots(times, S.seed) : { ok: false, text: 'المتصفح ده مبيدعمش الإشعارات.' };
  S.rem.busy = false;
  if (p) S.rem.status = p.pushStatus();
  if (r.ok) { Object.assign(S.rem, { times: r.times, max: r.max, defaultTime: r.defaultTime }); render(); toast(okText); return; }
  render();
  toast(r.text);
}
function toggleRemind() {
  if (remOn()) saveTimes([], 'قفلنا التذكير');
  else saveTimes([S.rem.defaultTime || '08:00'], `هنفكّرك كل يوم ${clock(S.rem.defaultTime || '08:00').join(' ')} 🔔`);
}

/* ---------------- events ---------------- */

app.addEventListener('click', e => {
  const acct = e.target.closest('[data-acct]');
  if (acct) { ss.set(RETURN_KEY, null); ss.set(FROM_KEY, location.pathname + location.search); return; }
  const nav = e.target.closest('[data-nav]');
  if (nav) { e.preventDefault(); go(nav.dataset.nav); return; }
  const tab = e.target.closest('.tabbar__tab[href^="?"]');
  if (tab) { e.preventDefault(); go(tab.dataset.tab === 'reminders' ? 'reminders' : tab.dataset.tab === 'church' ? 'church' : 'today'); return; }
  // P5: the pictures, the full praise, an occasion from the «كنيستنا» tab
  const v = e.target.closest('[data-view]');
  if (v) { const card = v.closest('.oc'); openViewer(card ? card.dataset.occasion : '', +v.dataset.view); return; }
  const pr = e.target.closest('[data-praise]');
  if (pr) { openPraise(pr.dataset.praise); return; }
  const op = e.target.closest('[data-open]');
  if (op) { openOccasion(op.dataset.open, op.dataset.at); return; }
  if (e.target.matches('.br-add__time')) { try { e.target.showPicker(); } catch { /* the field itself still works */ } return; }
  const a = e.target.closest('[data-act]');
  if (!a || a.matches('input')) return;
  const act = a.dataset.act;
  if (act === 'bigger' || act === 'smaller') setSize(act === 'bigger' ? 1 : -1);
  else if (act === 'plain') { S.plain = !S.plain; ls.set('bread.plain', S.plain ? '1' : null); shareCanvas = null; render(); }
  else if (act === 'look') { setLook(html.dataset.look === 'dawn' ? 'night' : 'dawn'); render(); toast(html.dataset.look === 'dawn' ? 'شكل الفجر ☀︎ — اتحفظ' : 'كحلي + ورق 🌙 — اتحفظ'); }
  else if (act === 'look-night' || act === 'look-dawn') { setLook(act === 'look-dawn' ? 'dawn' : 'night'); render(); toast('اتحفظ ✓'); }
  else if (act === 'sound') { setSoundEnabled(!soundEnabled()); render(); }
  else if (act === 'share') { S.sheet = 'share'; render(); }
  else if (act === 'share-img') shareImage(false);
  else if (act === 'save-img') shareImage(true);
  else if (act === 'copy') copyVerse();
  else if (act === 'close') { S.sheet = null; render(); }
  else if (act === 'signin') { const ta = app.querySelector('.br-field textarea'); if (ta) ls.set(draftKey(), ta.value || null); S.sheet = 'signin'; render(); }
  else if (act === 'go-signin') signIn();
  else if (act === 'send') send();
  else if (act === 'edit') { S.editing = true; renderReflect(); app.querySelector('.br-field textarea')?.focus(); }
  else if (act === 'save') saveEdit();
  else if (act === 'cancel') { S.editing = false; renderReflect(); }
  else if (act === 'delete') remove();
  else if (act === 'read') markRead();
  else if (act === 'remind') toggleRemind();
  else if (act === 'drop') { const k = +a.dataset.k; if (S.rem.times.length < 2) return; saveTimes(S.rem.times.filter((_, i) => i !== k), 'شيلنا الميعاد'); }
});
app.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-act]')) { e.preventDefault(); e.target.click(); }
  if (e.key === 'Escape' && S.sheet) { S.sheet = null; render(); }
});
app.addEventListener('change', e => {
  if (e.target.matches('.br-add__time') && /^\d{2}:\d{2}$/.test(e.target.value)) {
    const times = [...new Set([...(S.rem.times || []), e.target.value])].sort();
    saveTimes(times, `اتضاف ${clock(e.target.value).join(' ')} ✓`);
  }
});
app.addEventListener('input', e => {
  if (!e.target.matches('.br-field textarea')) return;
  const v = e.target.value;
  const c = e.target.parentElement.querySelector('.br-field__count'); if (c) c.textContent = AR(v.length) + ' / ' + AR(LIMIT);
  if (!S.refl) ls.set(draftKey(), v || null);
  const sendBtn = app.querySelector('[data-act="send"]'); if (sendBtn) sendBtn.disabled = !v.trim();
});
addEventListener('popstate', () => {
  const sq = new URLSearchParams(location.search).get('s');
  S.screen = sq === 'reminders' ? 'reminders' : sq === 'church' && S.occ ? 'church' : 'today';
  S.sheet = null;
  render();
  if (S.screen === 'reminders') loadReminders();
});
addEventListener('resize', placeLens);

/* ---------------- the intro (decision 15) ---------------- */

const cover = document.getElementById('br-cover');
const dropCover = () => { if (cover && cover.isConnected) { cover.classList.add('is-gone'); setTimeout(() => cover.remove(), 400); } };
function intro() {
  html.classList.remove('br-arrive');
  const p = playIntro({
    logo: IMG.logoSvg,
    sound: SOUND,
    muted: !soundEnabled(),
    target: document.getElementById('brand-mark'),
    onArrive: () => { html.classList.add('br-arrive'); setTimeout(() => html.classList.remove('br-arrive'), 2200); }
  });
  // the intro's own dark is up: the boot cover can go
  requestAnimationFrame(() => requestAnimationFrame(dropCover));
  return p;
}
const playOnLoad = q0.get('from') !== 'signin' && q0.get('intro') !== '0';
if (q0.get('from')) {
  // the flag did its job; the address stays clean (a later reload is a new entry)
  const u = new URL(location.href); u.searchParams.delete('from');
  history.replaceState(history.state, '', u.pathname + u.search + u.hash);
}
addEventListener('pageshow', e => { if (e.persisted && S.view !== 'closed' && S.view !== 'boot') intro(); });
if (playOnLoad) logoSvg(IMG.logoSvg);

/* ---------------- boot ---------------- */

async function boot() {
  render();
  const { state, index } = await loadIndex();
  if (state !== 'on') {
    S.view = 'closed';
    render();
    dropCover();
    return;
  }
  if (playOnLoad) intro(); else dropCover();
  const occP = loadOccasions();
  const { live, next, last } = programsOn(index, S.day);
  S.program = live; S.next = next; S.last = last;
  // the index lists only the live and the next program: the one this device read is remembered for «خلّصنا»
  if (live) ls.set('bread.last', JSON.stringify({ id: live.id, name: live.name, days: live.days, endsOn: live.endsOn }));
  else if (!last) {
    try {
      const seen = JSON.parse(ls.get('bread.last') || 'null');
      if (seen && typeof seen.name === 'string' && Number.isInteger(seen.days) && /^\d{4}-\d{2}-\d{2}$/.test(seen.endsOn) && seen.endsOn < S.day) S.last = seen;
    }
    catch { /* nothing remembered */ }
  }
  const s = session();
  if (live) {
    const kept = ls.get('bread.kept.' + live.id);
    if (s && kept && SEED.test(kept)) S.seed = kept;
    const jk = 'bread.joined.' + live.id;
    if (!ls.get(jk)) ls.set(jk, S.day);
    S.info = dayOf(live, S.day, S.seed, ls.get(jk));
    S.read = ls.get('bread.read') === S.day;
    const [topic, feasts] = await Promise.all([S.info ? loadDay(live.id, S.info.n) : null, loadFeasts(S.day.slice(0, 7))]);
    S.topic = topic;
    S.feast = feastOn(feasts, S.day);
  }
  S.occ = await occP;
  // a patron's day without a program: the Synaxarium word still comes from the feasts file
  if (!live && S.occ && occToday().some(o => o.type === 'patron' || o.type === 'family')) S.feast = feastOn(await loadFeasts(S.day.slice(0, 7)), S.day);
  if (S.screen === 'church' && !S.occ) S.screen = 'today';
  S.view = S.topic ? 'today' : 'rest';
  render();
  fillFeastPraise();
  fillSeason();
  if (location.hash === '#reflect') requestAnimationFrame(() => document.getElementById('reflect')?.scrollIntoView({ block: 'start' }));
  if (S.view === 'today') beacon(S.seed, 'open', S.day);
  loadReminders();
  registerOffline();
  if (s) account(s);
}

/* signed in: the account's kept seed (its topic), eligible/guest, the look, today's reflection */
async function account(s) {
  const r = await me(s.token, deviceSeed);
  if (!r.ok) {
    S.acct = r.status === 401 ? 'none' : (r.body && r.body.code === 'blocked' ? 'none' : 'eligible');
    if (S.view === 'today') renderReflect();
    return;
  }
  const b = r.body;
  S.acct = b.state === 'guest' ? 'guest' : 'eligible';
  // the look: a choice made on this device since the account last heard from it goes to the account; else the account's wins
  const mine = ls.get('bread.look'), synced = ls.get('bread.look.synced');
  if (b.look && mine && mine !== synced && mine !== b.look) setLook(mine);
  else if (b.look) {
    ls.set('bread.look.synced', b.look);
    if ((b.look === 'dawn') !== (html.dataset.look === 'dawn')) { setLook(b.look, { save: false }); if (S.view !== 'boot') render(); }
  }
  if (S.program && b.seed && SEED.test(b.seed)) {
    ls.set('bread.kept.' + S.program.id, b.seed);
    if (b.seed !== S.seed) {
      S.seed = b.seed;
      S.info = dayOf(S.program, S.day, S.seed, ls.get('bread.joined.' + S.program.id));
      const t = S.info ? await loadDay(S.program.id, S.info.n) : null;
      if (t) { S.topic = t; shareCanvas = null; }
    }
  }
  S.refl = b.reflection && !b.reflection.deleted ? b.reflection : null;
  if (S.refl) { syncSkew(S.refl); startTicker(); }
  render();
}

function registerOffline() {
  if (!('serviceWorker' in navigator) || !/^https:|^http:\/\/(localhost|127\.0\.0\.1)/.test(location.href)) return;
  // the site's one worker (push + this section offline); what this first visit loaded is sent to keep
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(() => navigator.serviceWorker.ready).then(reg => {
    const urls = [location.origin + '/daily-bread/', ...performance.getEntriesByType('resource').map(e => e.name)];
    reg.active?.postMessage({ type: 'bread:keep', urls });
  }).catch(() => { /* the reading still works online */ });
}

/*
 * P5: «شوف الكارت» in the admin (?preview=occ): the admin's draft occasion comes by postMessage from the same origin
 * only, and the card is drawn on this page's own CSS, on that day — nothing is loaded, counted or remembered.
 */
function previewMode() {
  html.classList.remove('has-tabbar');
  if (cover) cover.remove();
  app.innerHTML = '<main id="main" aria-busy="true"></main>';
  addEventListener('message', e => {
    if (e.origin !== location.origin || !e.data || e.data.type !== 'bread:occ-preview') return;
    const file = cleanOccasions(e.data.file);
    const day = /^\d{4}-\d{2}-\d{2}$/.test(e.data.day || '') ? e.data.day : S.day;
    if (!file || !file.occasions.length) return;
    S.occ = file; S.day = day; S.view = 'rest';
    app.innerHTML = `<div class="backdrop" aria-hidden="true"><div class="backdrop__glow"></div><div class="backdrop__lattice"></div></div><main id="main" class="br-preview-occ"><section class="br-dawn br-dawn--rest"><span class="br-dawn__rays" aria-hidden="true"></span>${occasionCard(file.occasions, day, { file, medText, open: true })}${HILLS}</section></main>`;
    paintFrames(app);
  });
}

if (q0.get('preview') === 'occ') previewMode(); else boot();
