/*
 * «خبزنا اليومي» P5 — «مناسبات كنيستنا» on the member page: the clickable preview.
 * The page is the LIVE /daily-bread/ markup (tools/capture-page.mjs → page-shell.json: the real page on the real Worker
 * code, W1's sample program), styled by the real assets/css/main.css + bread.css; the new card is p5.css (oc-*).
 * Data: the REAL published registry (daily-bread/data/saints.json: names, days, album pictures from the media library),
 * the proposed list (occasions.json), Coptic ⇄ Gregorian by the site's own code (worker/src/bread/coptic.js).
 * Nothing is saved, nothing is sent.
 *
 *   ?d=YYYY-MM-DD   the day shown (default: the next occasion)      &v=today|rest     a program today, or none
 *   &w=desktop|phone  the captured markup (default: by width)        &look=dawn        the light look
 *   &open=1           «اقرا…» open                                     &pics=1           the pictures viewer open
 */
import { iconSvg } from '../../../../assets/js/icons.js';
import { bi } from '../../../../assets/js/bread/icons.js';
import { MONTHS, toCoptic, toGregorian, monthDays } from '../../../../worker/src/bread/coptic.js';

const q = new URLSearchParams(location.search);
const html = document.documentElement;
const app = document.getElementById('app');
const AR = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const si = n => iconSvg(n);
const GM = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const WD = ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'];
const TODAY = '2026-11-24';
const ROOT = '../../../../';

const [SHELL, REG, OCC, PRAISE] = await Promise.all(['page-shell.json', ROOT + 'daily-bread/data/saints.json', 'occasions.json', 'praise-mercurius.json'].map(u => fetch(u).then(r => r.json())));
const byId = id => REG.people.find(p => p.id === id);

/* ---------- days ---------- */
const gDay = iso => { const [y, m, d] = iso.split('-').map(Number); return { y, m, d, w: new Date(Date.UTC(y, m - 1, d)).getUTCDay() }; };
const dateText = iso => { const g = gDay(iso); return `${WD[g.w]} ${AR(g.d)} ${GM[g.m - 1]}`; };
const copticText = iso => { const c = toCoptic(iso); return `${AR(c.d)} ${MONTHS[c.m - 1]}`; };
const dayOf = o => {
  if (o.from) { const p = byId(o.from.person); const f = p && p.feasts.find(x => x.kind === o.from.feast); return f ? { ...f, person: p } : null; }
  return o;
};
function isOn(f, iso) {
  if (f.repeat === 'once') return f.date === iso;
  if (f.gregorian) return f.gregorian === iso.slice(5);
  const [m, d] = f.coptic.split('-').map(Number);
  const c = toCoptic(iso);
  return c.m === m && (c.d === d || (m === 13 && d === 6 && c.d === 5 && monthDays(c.y, 13) === 5));
}
const nextDate = (f, from) => { for (let k = 0; k < 400; k++) { const iso = new Date(Date.parse(from + 'T00:00:00Z') + k * 864e5).toISOString().slice(0, 10); if (isOn(f, iso)) return iso; } return null; };
/* the occasions of a day: one card (two occasions the same day share it: the first leads) */
const occasionsOn = iso => OCC.occasions.filter(o => { const f = dayOf(o); return f && isOn(f, iso); });

const day = q.get('d') || occasionsOn(TODAY).length && TODAY || OCC.occasions.map(o => nextDate(dayOf(o), TODAY)).sort()[0];
const view = q.get('v') === 'rest' ? 'rest' : 'today';
const size = q.get('w') || (innerWidth <= 640 ? 'phone' : 'desktop');
const cap = SHELL.sizes[size][view];

/* ---------- the live page, as captured ---------- */
for (const [k, v] of Object.entries(cap.htmlAttrs)) if (k !== 'class' && k !== 'style') html.setAttribute(k, v);
html.className = cap.htmlAttrs.class || '';
if (q.get('look') === 'dawn') html.dataset.look = 'dawn'; else delete html.dataset.look;
document.body.className = cap.bodyClass;
app.innerHTML = cap.app.replace(/http:\/\/localhost:\d+\//g, ROOT);
app.querySelectorAll('.br-note').forEach(n => n.remove());               // the capture's late-joiner note (not part of the design)
const pill = app.querySelector('.br-day');
if (pill) pill.innerHTML = `${dateText(day)} <i></i> اليوم ٥ من ٣٠`;

/* ---------- «نحب نفكّرك» (the W7/P4 card, unchanged): the day's feast, if any, and never one the occasion stands for ---------- */
const FEAST_WORDS = {
  abaskhiron: 'جندي من قلين، اعترف بالمسيح قدام الوالي ورفض يبخّر للأوثان، واستشهد.',
  severus: 'بطريرك أنطاكية، دافع عن الإيمان المستقيم واتنفى بسببه، وعاش آخر أيامه في مصر.',
  tadrosshotbi: 'الأمير تادرس الشطبي، جندي شجاع اعترف بالمسيح واستشهد.'
};
function feastOfDay(iso, hidden) {
  const people = REG.people.filter(p => p.class !== 'living' && p.feasts.length);
  const hits = [];
  for (const p of people) { const f = p.feasts.find(x => isOn(x, iso)); if (f) hits.push({ p, f }); }
  const shown = hits.filter(h => !hidden.has(h.p.id + '|' + h.f.kind));
  return shown[0] || null;
}
function feastCard(h) {
  const a = (h.p.album || []).find(x => x.main) || (h.p.album || [])[0];
  const ai = a && (a.type === 'ai' || a.type === 'art');
  const pic = a ? `<figure class="br-feast__fig"><span class="br-feast__pic"><img class="br-feast__img" src="${ROOT + a.media}" alt="${esc(h.p.name)}" loading="lazy" decoding="async">${ai ? '<span class="br-feast__ai">صورة تعبيرية</span>' : ''}</span></figure>` : '';
  const word = FEAST_WORDS[h.p.id] || 'كلمة السنكسار من «الأعياد».';
  return `<section class="widget br-card br-feast" data-d="0"><h2 class="br-kicker">${bi('sun')}نحب نفكّرك</h2>${pic}<p class="br-feast__name">النهارده تذكار ${esc(h.p.name)}</p><p>${esc(word)}</p><p class="br-med__by br-med__src">من <a href="${esc(h.f.source)}" target="_blank" rel="noopener">${/st-takla\.org/.test(h.f.source) ? 'سنكسار موقع الأنبا تكلا' : 'المصدر'}</a></p></section>`;
}

/* ---------- the «مناسبات كنيستنا» card ---------- */
const TYPE = OCC.types;
const ICON = { patron: 'cross', diocese: 'church', fathers: 'church', church: 'church', local: 'star' };
// the patron's Synaxarium word: in the build it is the feasts file's word for that day (the same St-Takla word «نحب نفكّرك» shows)
const PATRON_WORD = [
  'فيلوباتير مرقوريوس كان قائد في الجيش الروماني، وظهر له ملاك الرب وإداه سيف تاني علشان ينتصر بيه، ومن هنا اتسمّى «أبو سيفين».',
  'لما الإمبراطور ديسيوس طلب من الجنود يبخّروا للأوثان، رفض وقال إنه مسيحي، واتعذّب كتير وفضل ثابت لحد ما استشهد وهو شاب صغير.'
];
const years = (o, iso) => { const f = dayOf(o); const y = f && f.year; return y ? +iso.slice(0, 4) - y : 0; };
const pictures = o => (o.pictures || []).map(x => {
  const p = byId(x.person); const a = p && (p.album || []).find(i => i.media === x.media);
  return a ? { src: ROOT + a.media, ai: a.type === 'ai' || a.type === 'art', crop: a.crop, caption: x.caption || a.caption || p.name, name: p.name } : null;
}).filter(Boolean);
const arch = (pic, i, label = true) => `<button class="oc-arch" type="button" data-view="${i}" aria-label="${esc(pic.caption)}"><img src="${pic.src}" alt="" ${pic.crop ? `style="object-position:${pic.crop.x}% ${pic.crop.y}%"` : ''} loading="lazy" decoding="async">${pic.ai && label ? '<span class="oc-arch__ai">صورة تعبيرية</span>' : ''}</button>`;
function picsBlock(o, pics) {
  if (!pics.length) return '';
  if ((o.people || []).length > 1) return `<div class="oc__pics oc__pics--duo">${pics.map((p, i) => `<figure>${arch(p, i)}<figcaption class="oc-arch__name">${esc(shortName(p.name))}</figcaption></figure>`).join('')}</div>`;
  if (pics.length > 1) return `<div class="oc__pics oc__pics--stack">${pics.slice(0, 3).map((p, i) => arch(p, i, i === 0)).join('')}<button class="oc__more-pics" type="button" data-view="0">${si('photos')}${AR(pics.length)} صور</button></div>`;
  return `<div class="oc__pics">${arch(pics[0], 0)}</div>`;
}
const shortName = n => n.replace(/^أبونا /, 'أبونا ').replace(/ روماني$| مراد$/, m => m);
function patronDays(o, iso) {
  const p = byId('mercurius');
  return `<div class="oc__days">${p.feasts.map(f => { const at = nextDate(f, iso); const cur = isOn(f, iso); return `<div class="oc__day" ${cur ? 'aria-current="date"' : ''}><b>${esc(f.kind)}</b>${AR(+f.coptic.split('-')[1])} ${MONTHS[+f.coptic.split('-')[0] - 1]} · ${cur ? 'النهارده' : esc(dateText(at).replace(/^\S+ /, ''))}</div>`; }).join('')}</div>`;
}
/* the praise in the card: its first stanza about the saint (the first one is to the Virgin), then the full reader */
function praiseTeaser() {
  const st = PRAISE.stanzas[1];
  return `<blockquote class="oc__praise"><p class="oc__praise-title">${esc(PRAISE.title)}</p><p class="oc__praise-text">${st.map(esc).join('<br>')}</p>
    <button class="oc__praise-go" type="button" data-praise>${bi('reading')}اقرا التمجيد كامل <small>${AR(PRAISE.stanzas.length)} مقطع</small></button></blockquote>`;
}
function praiseSheet() {
  const p = byId(PRAISE.person); const a = (p.album || [])[0];
  return `<header class="pr__head">
      <span class="pr__face"><img src="${ROOT + a.media}" alt="" ${a.crop ? `style="object-position:${a.crop.x}% ${a.crop.y}%"` : ''}></span>
      <div><p class="pr__kicker">شفيع كنيستنا</p><h2 class="pr__title" id="pr-title">${esc(PRAISE.title.replace('أبوسيفين', 'أبي سيفين'))}</h2>
        <p class="pr__meta">${PRAISE.author ? 'كلمات: ' + esc(PRAISE.author) + ' · ' : ''}${AR(PRAISE.stanzas.length)} مقطع</p></div>
      <div class="pr__tools"><button class="pr__btn pr__btn--sm" type="button" data-size="-1" aria-label="صغّر الخط">أ</button><button class="pr__btn pr__btn--lg" type="button" data-size="1" aria-label="كبّر الخط">أ</button><button class="pr__btn" type="button" data-pr-close aria-label="اقفل">${si('close')}</button></div>
    </header>
    <div class="pr__body">
      <ol class="pr__list">${PRAISE.stanzas.map((st, i) => `<li class="pr__st${i === 1 ? ' pr__st--mark' : ''}">${st.map(l => `<span>${esc(l)}</span>`).join('')}</li>`).join('')}</ol>
      <footer class="pr__end"><span>من <a href="${esc(PRAISE.source)}" target="_blank" rel="noopener">موقع الأنبا تكلا</a></span><button class="pr__done" type="button" data-pr-close>${si('check')}ربنا يباركك، ارجع لليوم</button></footer>
    </div>`;
}
function occasionCard(list, iso) {
  if (!list.length) return '';
  const o = list[0];
  const patron = o.type === 'patron';
  const pics = pictures(o);
  const f = dayOf(o);
  const y = years(o, iso);
  const src = o.source || (f && f.source);
  const kicker = patron
    ? `<span class="oc__crown">${si('cross')}شفيع كنيستنا</span><span class="oc__tag">مناسبات كنيستنا</span>`
    : `<span class="oc__tag">${si(ICON[o.type])}مناسبات كنيستنا · ${esc(TYPE[o.type])}</span>`;
  const who = o.from && !patron ? byId(o.from.person).name : patron ? byId('mercurius').name : '';
  const facts = y ? `<span class="oc__fact">${si('calendar')}الذكرى الـ<b>${AR(y)}</b></span>` : '';
  const more = patron ? `<details class="oc__more" ${q.get('open') === '1' ? 'open' : ''}><summary><span class="oc__open">اقرا السنكسار والتمجيد</span><span class="oc__close">اقفل</span>${si('chevron')}</summary>
      <div class="oc__more-body">${PATRON_WORD.map(t => `<p>${esc(t)}</p>`).join('')}
        ${praiseTeaser()}
        <p class="oc__praise-title" style="margin-top:14px">أعياد شفيع كنيستنا في السنة</p>${patronDays(o, iso)}
      </div></details>` : '';
  return `<section class="oc oc--${o.type}" aria-labelledby="oc-title" data-occasion="${o.id}">
    ${picsBlock(o, pics)}
    <div class="oc__body">
      <p class="oc__kicker">${kicker}<span class="oc__date">${copticText(iso)} · ${AR(gDay(iso).d)} ${GM[gDay(iso).m - 1]}</span></p>
      <h2 class="oc__title" id="oc-title">${esc(o.headline)}</h2>
      ${who ? `<p class="oc__who">${esc(who)}</p>` : ''}
      <p class="oc__lead">${esc(o.lead)}</p>
      ${facts && !patron ? `<div class="oc__facts">${facts}</div>` : ''}
      ${more}
      ${src && !patron ? `<p class="oc__src">المصدر: <a href="${esc(src)}" target="_blank" rel="noopener">${esc(new URL(src).hostname.replace(/^www\./, ''))}</a></p>` : patron ? `<p class="oc__src">من <a href="${esc(f.source)}" target="_blank" rel="noopener">سنكسار موقع الأنبا تكلا</a></p>` : ''}
    </div>
  </section>`;
}

/* ---------- put it together ---------- */
const list = occasionsOn(day);
// what the card stands for that day: never shown again (not in «نحب نفكّرك»)
const hidden = new Set(list.flatMap(o => [...(o.from ? [o.from.person + '|' + o.from.feast] : []), ...(o.covers || []).map(c => c.person + '|' + c.feast)]));
const card = occasionCard(list, day);
const dawn = app.querySelector('.br-dawn');
if (card && dawn) {
  if (view === 'rest') dawn.querySelector('.br-rest').insertAdjacentHTML('afterend', card);
  else dawn.querySelector('.br-day').insertAdjacentHTML('beforebegin', card);
}
const feast = view === 'today' ? feastOfDay(day, hidden) : null;
const remind = app.querySelector('.br-side:not(.br-side--read) > section.widget:last-of-type');
app.querySelectorAll('.br-feast').forEach(n => n.remove());
if (feast && remind) remind.insertAdjacentHTML('beforebegin', feastCard(feast));

/* ---------- the pictures viewer ---------- */
const PICS = pictures(list[0] || {});
let at = 0;
const dlg = document.createElement('dialog');
dlg.className = 'oc-view';
dlg.setAttribute('aria-label', 'صور المناسبة');
document.body.append(dlg);
function show(i) {
  at = (i + PICS.length) % PICS.length;
  const p = PICS[at];
  dlg.innerHTML = `<figure class="oc-view__fig"><img src="${p.src}" alt="${esc(p.caption)}">${p.ai ? '<span class="oc-view__ai">صورة تعبيرية</span>' : ''}</figure>
    <div class="oc-view__bar">${PICS.length > 1 ? `<button class="oc-view__btn oc-view__btn--prev" type="button" data-step="-1" aria-label="اللي قبلها">${si('chevron')}</button>` : ''}
    <p class="oc-view__cap">${esc(p.caption)}${PICS.length > 1 ? ` <span class="oc-view__n">${AR(at + 1)} / ${AR(PICS.length)}</span>` : ''}</p>
    ${PICS.length > 1 ? `<button class="oc-view__btn" type="button" data-step="1" aria-label="اللي بعدها">${si('chevron')}</button>` : ''}
    <button class="oc-view__btn" type="button" data-close aria-label="اقفل">${si('close')}</button></div>`;
  if (!dlg.open) dlg.showModal();
}
document.addEventListener('click', e => {
  const v = e.target.closest('[data-view]'); if (v) { show(+v.dataset.view); return; }
  const s = e.target.closest('[data-step]'); if (s) { show(at + +s.dataset.step); return; }
  if (e.target.closest('[data-close]') || e.target === dlg) dlg.close();
});
if (q.get('pics') === '1' && PICS.length) show(0);

/* ---------- the full praise ---------- */
const pr = document.createElement('dialog');
pr.className = 'pr';
pr.setAttribute('aria-labelledby', 'pr-title');
document.body.append(pr);
const openPraise = () => { pr.innerHTML = praiseSheet(); pr.showModal(); pr.querySelector('.pr__body').scrollTop = 0; };
document.addEventListener('click', e => {
  if (e.target.closest('[data-praise]')) openPraise();
  else if (e.target.closest('[data-pr-close]') || e.target === pr) pr.close();
  const z = e.target.closest('.pr [data-size]');
  if (z) html.dataset.size = String(Math.max(1, Math.min(4, (+html.dataset.size || 2) + +z.dataset.size)));
});
if (q.get('size')) html.dataset.size = q.get('size');
if (q.get('praise') === '1') openPraise();
document.title = `P5 المعاينة — ${list.length ? list[0].headline : 'يوم عادي'} (${day})`;
html.dataset.ready = '1';
