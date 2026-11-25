/*
 * «خبزنا اليومي» P5 — «مناسبات كنيستنا»: the markup, as approved (docs/daily-bread/saints/p5/, owner 2026-11-25).
 * The card at the top of the day, the «كنيستنا» tab, the full praise, the pictures viewer. Styles: bread.css «P5».
 * The page's CSP refuses style attributes: a picture's framing is data-x / data-y, set by paintFrames() after render.
 */
import { iconSvg } from '../icons.js';
import { bi } from './icons.js';
import { AR, dateText } from './model.js';
import { yearsOf, copticDay, occasionKey, upcoming, isOn, nextDate } from './occasions.js';
import { MONTHS } from './coptic.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const si = n => iconSvg(n);
const GM = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const ICON = { patron: 'cross', family: 'book', diocese: 'church', fathers: 'church', church: 'church', local: 'star' };
const frame = p => (p && p.crop ? ` data-x="${p.crop.x}" data-y="${p.crop.y}"` : '');
const dayLine = iso => `${copticDay(iso, AR)} · ${AR(+iso.slice(8))} ${GM[+iso.slice(5, 7) - 1]}`;
const paras = (text, medText) => medText(text);

/* the CSP-safe framing: object-position from data-x / data-y */
export function paintFrames(root) {
  root.querySelectorAll('img[data-x]').forEach(i => { i.style.objectPosition = `${i.dataset.x}% ${i.dataset.y}%`; });
}

const arch = (p, i, label = true) => `<button class="oc-arch" type="button" data-view="${i}" aria-label="${esc(p.caption || 'الصورة')}"><img src="${esc(p.img)}" alt=""${frame(p)} loading="lazy" decoding="async">${p.ai && label ? '<span class="oc-arch__ai">صورة تعبيرية</span>' : ''}</button>`;
function pics(o) {
  const ps = o.pictures;
  if (!ps.length) return '';
  if (o.names.length > 1 && ps.length > 1) return `<div class="oc__pics oc__pics--duo">${ps.slice(0, 2).map((p, i) => `<figure>${arch(p, i)}<figcaption class="oc-arch__name">${esc(o.names[i] || '')}</figcaption></figure>`).join('')}</div>`;
  if (ps.length > 1) return `<div class="oc__pics oc__pics--stack">${ps.slice(0, 3).map((p, i) => arch(p, i, i === 0)).join('')}<button class="oc__more-pics" type="button" data-view="0">${si('photos')}${AR(ps.length)} صور</button></div>`;
  return `<div class="oc__pics">${arch(ps[0], 0)}</div>`;
}

/* a patron's days of the year, today marked */
export function patronDays(p, iso) {
  return `<div class="oc__days">${p.days.map(d => { const cur = isOn(d, iso); const at = nextDate(d, iso); return `<div class="oc__day"${cur ? ' aria-current="date"' : ''}><b>${esc(d.kind)}</b>${d.coptic ? `${AR(+d.coptic.split('-')[1])} ${MONTHS[+d.coptic.split('-')[0] - 1]} · ` : ''}${cur ? 'النهارده' : at ? esc(dateText(at).replace(/^\S+ /, '')) : ''}</div>`; }).join('')}</div>`;
}
/* the praise in a card: its first verse and «اقرا التمجيد كامل» (the full one on our own page, owner 2026-11-25) */
function praiseTeaser(p) {
  const pr = p.praise;
  if (!pr) return '';
  const first = pr.verses.length ? [...pr.verses[0], ...(pr.refrain ? [pr.refrain] : [])] : pr.text.split('\n');
  return `<blockquote class="oc__praise"><p class="oc__praise-title">${esc(pr.title || 'من التمجيد')}</p><p class="oc__praise-text">${first.map(esc).join('<br>')}</p>
    ${pr.verses.length ? `<button class="oc__praise-go" type="button" data-praise="${esc(p.id)}">${bi('reading')}اقرا التمجيد كامل <small>${AR(pr.verses.length)} مقطع</small></button>` : `<p class="br-med__by"><a href="${esc(pr.source)}" target="_blank" rel="noopener">التمجيد كامل</a></p>`}</blockquote>`;
}

/*
 * The card of a day. list = that day's occasions (the first leads), iso = the day, file = the clean file,
 * word = the Synaxarium word for a patron's day (the feasts file's word that day, as «نحب نفكّرك» would show it),
 * medText = the page's paragraph maker. sheet = shown from the «كنيستنا» tab for another day (no «النهارده»).
 */
export function occasionCard(list, iso, { file, word = null, medText, sheet = false, open = false }) {
  if (!list.length) return '';
  const o = list[0];
  const title = sheet ? o.headline.replace(/^النهارده /, '') : o.headline;
  const key = occasionKey(o, iso);
  const src = o.source ? `<p class="oc__src">${o.type === 'patron' || o.type === 'family' ? 'من ' : 'المصدر: '}<a href="${esc(o.source)}" target="_blank" rel="noopener">${/st-takla\.org/.test(o.source) ? 'سنكسار موقع الأنبا تكلا' : esc(new URL(o.source).hostname.replace(/^www\./, ''))}</a></p>` : '';
  const more = list.slice(1).map(x => `<p class="oc__also">${si(ICON[x.type])}<span><b>${esc(x.headline.replace(/^النهارده /, ''))}</b>${x.who ? ' · ' + esc(x.who) : ''}</span></p>`).join('');
  if (o.type === 'family' && file.patrons.family) {
    const p = file.patrons.family;
    return `<section class="oc oc--family" aria-labelledby="oc-title" data-occasion="${esc(o.id)}" data-key="${key}">
      <div class="oc__pics"><button class="oc-seal" type="button" data-view="0" aria-label="${esc(p.name)}"><img src="${esc(p.img || (o.pictures[0] || {}).img || '')}" alt=""${frame(p)}>${p.ai ? '<span class="oc-arch__ai">صورة تعبيرية</span>' : ''}</button><img class="oc-seal__logo" src="${new URL('../../img/logo-128.webp', import.meta.url).href}" alt="شعار الأسرة" width="46" height="46"></div>
      <div class="oc__body">
        <p class="oc__kicker"><span class="oc__family">${si('book')}شفيع أسرتنا</span><span class="oc__tag">أسرة البابا أثناسيوس الرسولي للشباب</span><span class="oc__date">${dayLine(iso)}</span></p>
        <h2 class="oc__title" id="oc-title">${esc(title)}</h2>${o.who ? `<p class="oc__who">${esc(o.who)}</p>` : ''}<p class="oc__lead">${esc(o.lead)}</p>
        <details class="oc__more"${open ? ' open' : ''}><summary><span class="oc__open">اقرا سيرته وأعياده</span><span class="oc__close">اقفل</span>${si('chevron')}</summary>
          <div class="oc__more-body">${word ? paras(word, medText) : ''}${praiseTeaser(p)}<p class="oc__praise-title oc__days-h">أعياد شفيع أسرتنا في السنة</p>${patronDays(p, iso)}</div></details>
        ${more}${src}</div></section>`;
  }
  const patron = o.type === 'patron' ? file.patrons.patron : null;
  const kicker = patron ? `<span class="oc__crown">${si('cross')}شفيع كنيستنا</span><span class="oc__tag">مناسبات كنيستنا</span>`
    : o.badge ? `<span class="oc__badge">${si(o.look === 'memorial' ? 'star' : o.look === 'pope' ? 'cross' : 'church')}${esc(o.badge)}</span><span class="oc__tag">مناسبات كنيستنا</span>`
    : `<span class="oc__tag">${si(ICON[o.type])}مناسبات كنيستنا${file.types[o.type] ? ' · ' + esc(file.types[o.type]) : ''}</span>`;
  const y = yearsOf(o, iso);
  const facts = !patron && y > 0 ? `<div class="oc__facts"><span class="oc__fact">${si('calendar')}الذكرى الـ<b>${AR(y)}</b></span></div>` : '';
  const det = patron ? `<details class="oc__more"${open ? ' open' : ''}><summary><span class="oc__open">اقرا السنكسار والتمجيد</span><span class="oc__close">اقفل</span>${si('chevron')}</summary>
      <div class="oc__more-body">${word ? paras(word, medText) : ''}${praiseTeaser(patron)}<p class="oc__praise-title oc__days-h">أعياد شفيع كنيستنا في السنة</p>${patronDays(patron, iso)}</div></details>` : '';
  return `<section class="oc oc--${o.type}${o.look ? ' oc--' + o.look : ''}" aria-labelledby="oc-title" data-occasion="${esc(o.id)}" data-key="${key}">
    ${pics(o)}
    <div class="oc__body">
      <p class="oc__kicker">${kicker}<span class="oc__date">${dayLine(iso)}</span></p>
      <h2 class="oc__title" id="oc-title">${esc(title)}</h2>${o.who ? `<p class="oc__who">${esc(o.who)}</p>` : ''}${o.lead ? `<p class="oc__lead">${esc(o.lead)}</p>` : ''}
      ${facts}${det}${more}${src}
    </div></section>`;
}

/* the full praise, on our own page (P5b: also a saint's day praise, with its own kicker) */
export const PRAISE_TYPE = { tamgeed: 'تمجيد', madih: 'مديح', tasbeha: 'تسبحة', doxology: 'ذكصولوجية', psali: 'إبصالية', lahn: 'لحن' };
export function praiseSheet(p) {
  const pr = p.praise;
  return `<header class="pr__head">
      ${p.img ? `<span class="pr__face"><img src="${esc(p.img)}" alt=""${frame(p)}></span>` : '<span></span>'}
      <div><p class="pr__kicker">${esc(p.kicker || (p.kind === 'family' ? 'شفيع أسرتنا' : 'شفيع كنيستنا'))}</p><h2 class="pr__title" id="pr-title">${esc(pr.title || p.name)}</h2>
        <p class="pr__meta">${AR(pr.verses.length)} مقطع${pr.refrain ? ' · المرد: ' + esc(pr.refrain) : ''}</p></div>
      <div class="pr__tools"><button class="pr__btn pr__btn--sm" type="button" data-size="-1" aria-label="صغّر الخط">أ</button><button class="pr__btn pr__btn--lg" type="button" data-size="1" aria-label="كبّر الخط">أ</button><button class="pr__btn" type="button" data-pr-close aria-label="اقفل">${si('close')}</button></div>
    </header>
    <div class="pr__body">
      <ol class="pr__list">${pr.verses.map(v => `<li class="pr__st">${v.map(l => `<span>${esc(l)}</span>`).join('')}${pr.refrain ? `<span class="pr__ref">${esc(pr.refrain)}</span>` : ''}</li>`).join('')}</ol>
      <footer class="pr__end"><span>المصدر: <a href="${esc(pr.source)}" target="_blank" rel="noopener">${esc(new URL(pr.source).hostname.replace(/^www\./, ''))}</a></span><button class="pr__done" type="button" data-pr-close>${si('check')}ربنا يباركك، ارجع</button></footer>
    </div>`;
}

/* the pictures viewer: one at a time, its caption, «صورة تعبيرية» */
export function viewerHtml(ps, at) {
  const p = ps[at];
  return `<figure class="oc-view__fig"><img src="${esc(p.img)}" alt="${esc(p.caption)}">${p.ai ? '<span class="oc-view__ai">صورة تعبيرية</span>' : ''}</figure>
    <div class="oc-view__bar">${ps.length > 1 ? `<button class="oc-view__btn oc-view__btn--prev" type="button" data-step="-1" aria-label="اللي قبلها">${si('chevron')}</button>` : ''}
    <p class="oc-view__cap">${esc(p.caption)}${ps.length > 1 ? ` <span class="oc-view__n">${AR(at + 1)} / ${AR(ps.length)}</span>` : ''}</p>
    ${ps.length > 1 ? `<button class="oc-view__btn" type="button" data-step="1" aria-label="اللي بعدها">${si('chevron')}</button>` : ''}
    <button class="oc-view__btn" type="button" data-close-view aria-label="اقفل">${si('close')}</button></div>`;
}

/* the «كنيستنا» tab */
const soon = n => (n === 0 ? 'النهارده' : n === 1 ? 'بكره' : n < 11 ? `بعد ${AR(n)} أيام` : `بعد ${AR(n)} يوم`);
const between = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const TODAY = { iso: '' };
/*
 * The «كنيستنا» tab (owner 2026-11-25, approved): today's card, or a calm empty state; then «مناسباتنا الجاية», a
 * small card with the nearest one, that opens the nearest few. No archive, no history (that is «حول كنيستنا», P7).
 */
export const NEXT_N = 4;
const left = n => (n === 1 ? 'بكره' : n === 2 ? 'بعد يومين' : n < 11 ? `فاضل ${AR(n)} أيام` : `فاضل ${AR(n)} يوم`);
const nextOf = (file, iso) => upcoming(file, iso).filter(x => x.at !== iso).slice(0, NEXT_N);
const picOf = o => (o.type === 'family' && TODAY.fam ? TODAY.fam : o.pictures[0]);
export function churchScreen(file, iso, { todayCard }) {
  TODAY.iso = iso; TODAY.fam = file.patrons.family && file.patrons.family.img ? file.patrons.family : null;
  const today = todayCard
    ? `<h2 class="ch-h">${bi('sun')}النهارده</h2>${todayCard}`
    : `<section class="widget br-card ch-empty"><span class="ch-empty__seal" aria-hidden="true">${si('church')}</span>
        <h2 class="ch-empty__title">مفيش مناسبات خاصة بكنيستنا النهارده</h2>
        <p class="ch-empty__text">أول ما ييجي عيد لشفيع كنيستنا أو أسرتنا، أو مناسبة لإيبارشيتنا وآبائنا، هتلاقيها هنا في أول اليوم.</p></section>`;
  const first = nextOf(file, iso)[0];
  const p = first && picOf(first.o);
  const next = first ? `<button class="ch-next" type="button" data-next>
      ${p ? `<span class="oc-arch ch-next__pic"><img src="${esc(p.img)}" alt=""${frame(p)}></span>` : ''}
      <span class="ch-next__main"><small class="ch-next__k">${si('calendar')}مناسباتنا الجاية</small><b>${esc(first.o.headline.replace(/^النهارده /, ''))}</b><small>${esc(dayLine(first.at))} · ${left(between(iso, first.at))}</small></span>
      <span class="ch-next__go">${si('chevron')}</span></button>` : '';
  return `<main id="main" class="br-sheet-page ch">
    <div class="br-h1"><span class="br-remind__ic">${si('church')}</span><div><h1>كنيستنا</h1><p>مناسبات كنيستنا وإيبارشيتنا وآبائنا، في يومها.</p></div></div>
    ${today}${next}
  </main>`;
}
/* «مناسباتنا الجاية»: the nearest few, each with its picture, its day (Gregorian and Coptic) and the days left */
export function nextSheet(file, iso) {
  const rows = nextOf(file, iso).map(({ o, at }) => {
    const p = picOf(o); const n = between(iso, at);
    return `<li><button class="ch-nx${o.type === 'patron' ? ' ch-nx--patron' : ''}" type="button" data-open="${esc(o.id)}" data-at="${at}">
      <span class="oc-arch ch-nx__pic">${p ? `<img src="${esc(p.img)}" alt=""${frame(p)} loading="lazy">` : ''}</span>
      <span class="ch-nx__main"><b>${esc(o.headline.replace(/^النهارده /, ''))}</b>${o.who ? `<small>${esc(o.who)}</small>` : ''}
        <small class="ch-nx__date">${esc(dayLine(at))}</small></span>
      <span class="ch-nx__left${n <= 7 ? ' is-near' : ''}"><b>${AR(n)}</b><small>${n < 11 && n !== 1 ? 'أيام' : 'يوم'}</small></span></button></li>`;
  }).join('');
  return `<button class="oc-view__btn ch-sheet__x" type="button" data-sheet-close aria-label="اقفل">${si('close')}</button>
    <h2 class="ch-nextsheet__h">${si('calendar')}مناسباتنا الجاية</h2><p class="ch-nextsheet__sub">أقرب المناسبات اللي تخص كنيستنا</p>
    ${rows ? `<ol class="ch-nxs">${rows}</ol>` : '<p class="br-keep">مفيش مناسبات جاية.</p>'}`;
}
