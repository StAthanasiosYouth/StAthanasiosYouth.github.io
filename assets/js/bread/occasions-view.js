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
function patronBox(p, kind) {
  if (!p) return '';
  if (kind === 'family') {
    return `<section class="ch-family"><span class="oc-seal ch-family__pic" aria-hidden="true"><img src="${esc(p.img || '')}" alt=""${frame(p)}>${p.ai ? '<span class="oc-arch__ai">صورة تعبيرية</span>' : ''}</span>
      <div class="ch-family__body"><p class="oc__kicker"><span class="oc__family">${si('book')}شفيع أسرتنا</span></p><h2 class="oc__title">${esc(p.name)}</h2>${patronDays(p, TODAY.iso)}${p.praise && p.praise.verses.length ? `<button class="oc__praise-go" type="button" data-praise="${esc(p.id)}">${bi('reading')}اقرا التمجيد كامل <small>${AR(p.praise.verses.length)} مقطع</small></button>` : ''}</div></section>`;
  }
  return `<section class="ch-patron"><span class="oc-arch ch-patron__pic" aria-hidden="true"><img src="${esc(p.img || '')}" alt=""${frame(p)}>${p.ai ? '<span class="oc-arch__ai">صورة تعبيرية</span>' : ''}</span>
    <div class="ch-patron__body"><p class="oc__kicker"><span class="oc__crown">${si('cross')}شفيع كنيستنا</span></p><h2 class="oc__title">${esc(p.name)}</h2>
    ${patronDays(p, TODAY.iso)}${p.praise && p.praise.verses.length ? `<button class="oc__praise-go" type="button" data-praise="${esc(p.id)}">${bi('reading')}اقرا التمجيد كامل <small>${AR(p.praise.verses.length)} مقطع</small></button>` : ''}</div></section>`;
}
const TODAY = { iso: '' };
export function churchScreen(file, iso, { todayCard }) {
  TODAY.iso = iso;
  const today = file.occasions.filter(o => isOn(o, iso));
  let month = '';
  const rows = upcoming(file, iso).filter(x => x.at !== iso).map(({ o, at }) => {
    const p = o.pictures[0]; const n = between(iso, at); const ym = at.slice(0, 7);
    const head = ym !== month ? `<li class="ch-month">${GM[+at.slice(5, 7) - 1]} ${AR(at.slice(0, 4))}</li>` : ''; month = ym;
    return head + `<li><button class="ch-row${o.type === 'patron' ? ' ch-row--patron' : ''}${o.type === 'family' ? ' ch-row--family' : ''}${o.look ? ' ch-row--' + o.look : ''}" type="button" data-open="${esc(o.id)}" data-at="${at}">
      <span class="ch-row__date"><b>${AR(+at.slice(8))}</b><small>${GM[+at.slice(5, 7) - 1]}</small></span>
      ${p ? `<span class="oc-arch ch-row__pic"><img src="${esc(p.img)}" alt=""${frame(p)} loading="lazy"></span>` : ''}
      <span class="ch-row__main"><b>${esc(o.headline.replace(/^النهارده /, ''))}</b>${o.who ? `<small>${esc(o.who)}</small>` : ''}<small class="ch-row__cop">${esc(copticDay(at, AR))}${file.types[o.type] ? ' · ' + esc(file.types[o.type]) : ''}</small></span>
      <span class="ch-row__soon${n <= 7 ? ' is-near' : ''}">${soon(n)}</span></button></li>`;
  }).join('');
  return `<main id="main" class="br-sheet-page ch">
    <div class="br-h1"><span class="br-remind__ic">${si('church')}</span><div><h1>كنيستنا</h1><p>أعياد شفيع كنيستنا وشفيع أسرتنا، ومناسبات إيبارشيتنا وآبائنا، وكل اللي جاي.</p></div></div>
    ${today.some(o => o.type === 'patron') ? '' : patronBox(file.patrons.patron, 'patron')}${today.some(o => o.type === 'family') ? '' : patronBox(file.patrons.family, 'family')}
    ${today.length ? `<h2 class="ch-h">${bi('sun')}النهارده</h2>${todayCard}` : ''}
    <section class="widget br-card ch-soon"><h2 class="br-kicker">${si('calendar')}الجاي</h2>${rows ? `<ol class="ch-list">${rows}</ol>` : '<p class="br-keep">مفيش مناسبات جاية.</p>'}</section>
  </main>`;
}
