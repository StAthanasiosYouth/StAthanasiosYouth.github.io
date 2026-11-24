/*
 * «خبزنا اليومي» — P3 admin prototype: سجل الشخصيات والمناسبات, inside the LIVE admin shell.
 * The shell (rail, top bar, dock, sub-tabs) is the real /admin/ markup captured with «الأعياد» open
 * (tools/capture-admin.mjs → admin-shell.json), styled by the real admin/admin.css; the screens use the panel's own
 * components (.p8-card, .chipico, .btn, .kpi, .seg, .p8-search, .ycard, .media-tile, .modal--form, .ba-alert, .ba-cols,
 * .p8-tag, .chip, .field) plus p3-admin.css (sa-*). Step B builds this into apps-script/AdminBread.html.
 *
 * Data: the REAL P2 registry (daily-bread/saints/registry.json, 108 people); Coptic ⇄ Gregorian by tools/lib/coptic.mjs.
 * Nothing is saved: edits live in this tab only.
 *
 *   ?s=people   (&f=incomplete|living|reposed|nophoto|nopraise &q=…)      the list
 *   ?s=person&id=<id>   (&m=day&i=<n> | &m=newday | &m=ms&i=<n> | &m=photo | &m=delete)
 *   ?s=occasions   (&m=new)
 *   ?s=publish   (&demo=complete: a person completed, to show «هيدخل الأعياد» · &done=1: published)
 *   &dirty=1  two unpublished changes (the bar)      &mode=light  the panel's light mode
 */
import { MONTHS, toGregorian, toCoptic, monthDays } from '../../../../tools/lib/coptic.mjs';

const q = new URLSearchParams(location.search);
const html = document.documentElement;
const AR = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TODAY = '2026-11-24';
const GM = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const WD = ['الحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'];

const SHELL = await fetch('admin-shell.json').then(r => r.json());
const REG = await fetch('../../../../daily-bread/saints/registry.json').then(r => r.json());
const ICONS = SHELL.desktop.icons;
/* the owner's pictures, read only through tools/serve.mjs (thumbnails); without it, letters */
const PICS = await fetch('/__pic-status').then(r => r.ok ? r.json() : {}).then(j => !!j.pictures).catch(() => false);
const ic = (n, cls) => { const s = ICONS[n] || ICONS.info; return cls ? `<span class="${cls}" aria-hidden="true">${s}</span>` : s; };

for (const [k, v] of Object.entries(SHELL.desktop.htmlAttrs)) if (k !== 'class') html.setAttribute(k, v);
if (q.get('mode') === 'light') { html.dataset.mode = 'light'; html.dataset.theme = 'light'; }

/* ---------- state (this tab only) ---------- */
const S = {
  s: q.get('s') || 'people', id: q.get('id') || '', m: q.get('m') || '', i: +(q.get('i') || 0),
  f: q.get('f') || '', cls: '', stat: q.get('f') === 'incomplete' ? 'incomplete' : '', photo: '', praise: '', cat: '', q: q.get('q') || '',
  done: q.get('done') === '1',
  // the list's look, like a folder in Windows: كبيرة / متوسطة / قايمة / تفاصيل, grouped by المجموعة or not (kept on this device)
  v: q.get('v') || localStorage.getItem('sa-view') || 'large',
  g: q.get('g') != null ? q.get('g') : (localStorage.getItem('sa-group') ?? 'cat')
};
if (S.f === 'living' || S.f === 'reposed') S.cls = S.f;
if (S.f === 'nophoto') S.photo = 'no';
if (S.f === 'nopraise') S.praise = 'no';
const people = structuredClone(REG.people);
const occasions = structuredClone(REG.occasions || []);
const published = new Map(REG.people.map(p => [p.id, JSON.stringify(p)]));
const changed = new Set();
const missingOf = p => [...(!p.feasts.length ? ['feasts'] : []), ...(!(p.album || []).length ? ['album'] : [])];
const MISS = { feasts: 'يوم التذكار', album: 'الصور' };
const byId = id => people.find(p => p.id === id);

/* demo drafts (owner facts only: Fr Isaac Nabih became hegumen in August 2019; Anba Abraam: a real photo first) */
function demoDirty() {
  const isaac = byId('isaacnabih');
  const ms = (isaac.milestones || []).find(m => /قمص/.test(m.kind));
  if (ms) ms.note = 'اليوم بالظبط لسه مش معروف (صاحب المشروع، 2026-11-24). صفحة كنيستنا في الأنبا تكلا لسه كاتبة «القس».';
  changed.add('isaacnabih');
  const abraam = byId('abraam');
  if (abraam) { abraam.album.forEach(a => { a.main = false; }); abraam.album.unshift({ src: 'صورة حقيقية للأنبا إبرآم (من P4).webp', type: 'photo', main: true }); changed.add('abraam'); }
}
let demoComplete = false;
if (q.get('dirty') === '1' || S.s === 'publish') demoDirty();
if (q.get('demo') === 'complete') {
  demoComplete = true;
  const mar = byId('isaacsyrian');
  mar.feasts.push({ kind: 'نياحته (مثال للمعاينة)', coptic: '4-17', source: 'https://st-takla.org/', demo: true });
  changed.add('isaacsyrian');
}

/* ---------- dates ---------- */
const gText = (iso, wd = false) => {
  const [y, m, d] = iso.split('-').map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${wd ? WD[w] + ' ' : ''}${AR(d)} ${GM[m - 1]} ${AR(y)}`;
};
const cText = (m, d, y) => `${AR(d)} ${MONTHS[m - 1]}${y ? ' ' + AR(y) : ''}`;
/* the next Gregorian date of a yearly day, from today */
function nextOf(f, from = TODAY) {
  if (f.gregorian) {
    const y = +from.slice(0, 4);
    let iso = `${y}-${f.gregorian}`;
    if (iso < from) iso = `${y + 1}-${f.gregorian}`;
    return iso;
  }
  const [m, d] = f.coptic.split('-').map(Number);
  let cy = toCoptic(from).y;
  const at = y => toGregorian(y, m, m === 13 ? Math.min(d, monthDays(y, 13)) : d);
  let iso = at(cy);
  if (iso < from) iso = at(cy + 1);
  return iso;
}
const dayLabel = f => f.coptic ? cText(...f.coptic.split('-').map(Number)) : (() => { const [m, d] = f.gregorian.split('-').map(Number); return `${AR(d)} ${GM[m - 1]}`; })();
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const msDate = m => m.date ? gText(m.date) : m.month ? `${GM[+m.month.slice(5) - 1]} ${AR(m.month.slice(0, 4))}` : m.year ? AR(m.year) + (m.until ? '–' + AR(m.until) : '') : 'من غير تاريخ';
const MS_STATUS = { confirmed: ['مؤكد', 'ok'], film: ['من الفيلم', 'info'], conflict: ['فيه اختلاف', 'warn'], pending: ['مستني مصدر', 'warn'] };

/* ---------- the live shell ---------- */
const TITLE = 'الآيات والقراءات اليومية';
const TABS = [['breadprograms', 'البرامج'], ['breadnew', 'برنامج جديد'], ['breadfeasts', 'الأعياد'], ['people', 'الشخصيات'], ['occasions', 'المناسبات'], ['breadstats', 'الإحصائيات'], ['breadrefl', 'التأملات'], ['breadsettings', 'الإعدادات']];
function shell(view) {
  let s = SHELL.desktop.shell.replaceAll('"../assets/', '"../../../../assets/');
  const cur = S.s === 'person' || S.s === 'publish' ? 'people' : S.s;
  s = s.replace(/<nav class="tabs" id="subtabs"[\s\S]*?<\/nav>/, `<nav class="tabs" id="subtabs" aria-label="الأقسام الفرعية">${TABS.map(([k, w]) => `<button class="tab" type="button" data-go="${k}" ${k === cur ? 'aria-current="page"' : ''}>${w}</button>`).join('')}</nav>`);
  const a = s.indexOf('<main class="view"'), b = s.indexOf('</main>', a) + 7;
  return s.slice(0, a) + `<main class="view" id="view" data-area="bread"><div class="ba sa" style="--i: 0;">${view}</div></main>` + s.slice(b);
}

/* ---------- the panel's own markup ---------- */
const card = (icon, title, hint, acts, body, cls = '', tone = '') =>
  `<section class="card p8-card ${cls}"><div class="p8-card__head"><span class="chipico${tone ? ' chipico--' + tone : ''}" aria-hidden="true">${ic(icon)}</span><div class="p8-card__titles"><h2 class="card__title">${title}</h2>${hint ? `<p class="card__hint">${hint}</p>` : ''}</div>${acts ? `<div class="p8-card__acts">${acts}</div>` : ''}</div>${body}</section>`;
const btn = (label, icon, kind = '', attrs = '') => `<button class="btn${kind ? ' ' + kind : ''}" type="button" ${attrs}>${icon ? ic(icon) : ''}${label}</button>`;
const tag = (t, tone = 'info') => `<span class="p8-tag p8-tag--${tone}">${t}</span>`;
const chip = (t, tone = '') => `<span class="chip${tone ? ' chip--' + tone : ''}">${t}</span>`;
const kpi = (icon, label, value, f, tone = '') => `<button class="kpi${tone ? ' kpi--' + tone : ''}${S.f === f ? ' is-on' : ''}" type="button" data-f="${f}" aria-label="${label}: ${value}"><small><span class="ico-sm" aria-hidden="true">${ic(icon)}</span>${label}</small><b>${value}</b></button>`;
const seg = (name, label, opts, val) => `<div class="seg p8-filter" role="radiogroup" aria-label="${label}">${opts.map(([v, t]) => `<label class="seg__opt"><input type="radio" name="${name}" value="${v}" ${v === val ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>`;
const field = (label, input, hint = '', cls = '') => `<label class="field ${cls}"><span class="field__label">${label}</span>${input}${hint ? `<span class="field__hint">${hint}</span>` : ''}</label>`;
const input = (v, attrs = '') => `<input class="input" value="${esc(v)}" ${attrs}>`;
const note = (icon, text) => `<p class="ba-note">${ic(icon)}<span>${text}</span></p>`;
const TITLES = /^(القديس(ة)?|الشهيد(ة)?|البابا|الأنبا|القمص|القس|أبونا|مار|السيدة|رئيس الملائكة|الملاك|العظيم)\s+/;
const letter = p => { let n = p.name.trim(); for (let k = 0; k < 3 && TITLES.test(n); k++) n = n.replace(TITLES, ''); return esc(n.charAt(0)); };
const mainOf = p => (p.album || []).find(a => a.main) || (p.album || [])[0] || null;
const picUrl = (src, w) => PICS && src ? `/__pic/${w}/${src.split('/').map(encodeURIComponent).join('/')}` : '';
const picImg = (p, w, cls) => { const a = mainOf(p); const u = a && picUrl(a.src, w); return u ? `<img class="${cls}" src="${u}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''; };
const face = (p, big = false) => { const img = picImg(p, big ? 360 : 160, 'ycard__photo'); return `<span class="ycard__face${img ? ' has-photo' : ''}${big ? ' sa-face--big' : ''}" aria-hidden="true"><span class="ycard__letter">${letter(p)}</span>${img}<i class="ycard__dot ycard__dot--${p.status === 'incomplete' ? 'warn' : 'ok'}"></i></span>`; };

/* the bar: what is saved and not published yet */
function dirtyBar() {
  if (!changed.size || S.s === 'publish') return '';
  return `<div class="ba-alert ba-alert--info sa-dirty" role="status"><span class="chipico" aria-hidden="true">${ic('edit')}</span><div class="ba-alert__text"><b>${changed.size === 1 ? 'فيه تعديل واحد' : `فيه ${AR(changed.size)} تعديلات`} محفوظ ومش منشور</b><small>محفوظ في المسودة. الموقع والأعياد مش بيشوفوه غير بعد «انشر».</small></div>${btn('راجع وانشر', 'send', 'btn--primary', 'data-go="publish"')}</div>`;
}

/* ---------- الشخصيات ---------- */
function filtered() {
  const t = S.q.trim();
  return people.filter(p => (!S.cls || p.class === S.cls) && (!S.stat || p.status === S.stat) && (!S.cat || p.cat === S.cat)
    && (!S.photo || (S.photo === 'yes') === !!p.album.length) && (!S.praise || (S.praise === 'yes') === !!p.praise)
    && (!t || p.name.includes(t)));
}
function personRow(p) {
  const days = p.feasts;
  const next = days.length ? days.map(f => ({ f, at: nextOf(f) })).sort((a, b) => a.at < b.at ? -1 : 1)[0] : null;
  const line = next ? `${ic('calendar', 'ycard__ic')}<span><b class="sa-left${daysTo(next.at) <= 7 ? ' is-soon' : ''}">${inWords(daysTo(next.at))}</b> · <b>${dayLabel(next.f)}</b>${next.f.coptic ? ` = ${gText(next.at)}` : ` ${AR(next.at.slice(0, 4))}`} · ${esc(next.f.kind)}</span>` : `${ic('alert', 'ycard__ic')}<span>من غير يوم تذكار: مش بيدخل الأعياد ولا الإشعارات</span>`;
  return `<article class="ycard sa-pcard" data-open="${p.id}"><button class="ycard__open" type="button" data-open="${p.id}" aria-label="افتح ${esc(p.name)}"></button>${face(p)}<div class="ycard__main"><bdi class="ycard__name">${esc(p.name)}</bdi><span class="ycard__chips">${p.class === 'living' ? chip('حي · مناسبات كنيستنا', 'gold') : ''}${chip(esc(REG.categories[p.cat] || p.cat), 'off')}${p.status === 'incomplete' ? chip('ناقص: ' + p.missing.map(m => MISS[m]).join('، '), 'warn') : ''}${days.length ? chip(days.length === 1 ? 'يوم واحد' : AR(days.length) + ' أيام', 'info') : ''}${p.praise ? chip('تمجيد', 'info') : ''}${p.album.length ? chip(AR(p.album.length) + ' صور', 'off') : ''}${changed.has(p.id) ? chip('مش منشور', 'warn') : ''}</span><span class="ycard__phone sa-next">${line}</span></div><span class="ycard__go" aria-hidden="true">${ic('chevron')}</span></article>`;
}
/* how far the next day is: «النهارده» / «بكره» / «بعد يومين» / «بعد ٥ أيام» / «بعد ١٢ يوم» */
const daysTo = iso => Math.round((Date.parse(iso + 'T00:00:00Z') - Date.parse(TODAY + 'T00:00:00Z')) / 864e5);
const inWords = n => n === 0 ? 'النهارده' : n === 1 ? 'بكره' : n === 2 ? 'بعد يومين' : n <= 10 ? `بعد ${AR(n)} أيام` : `بعد ${AR(n)} يوم`;
const nextDay = p => p.feasts.length ? p.feasts.map(f => ({ f, at: nextOf(f) })).sort((x, y) => x.at < y.at ? -1 : 1)[0] : null;
/* the picture whole: contained on a soft blurred copy of itself, never cut (owner 2026-11-24: «ميكونش وشه مقصوص») */
const wholePic = (p, w, cls) => { const a = mainOf(p); const u = a && picUrl(a.src, w); return u ? `<span class="sa-whole ${cls}"><img class="sa-whole__bg" src="${u}" alt="" aria-hidden="true" loading="lazy" onerror="this.parentNode.remove()"><img class="sa-whole__img" src="${u}" alt="" loading="lazy" decoding="async" onerror="this.parentNode.remove()"></span>` : ''; };
/* «كبيرة» / «متوسطة»: the whole picture first, the name in a band under it; the status and «بعد كام يوم» under the card */
function personTile(p) {
  const img = wholePic(p, S.v === 'large' ? 360 : 160, '');
  const a = mainOf(p);
  const n = nextDay(p);
  const when = n ? `${dayLabel(n.f)} · ${esc(n.f.kind)}` : p.class === 'living' ? 'مناسبات كنيستنا' : 'من غير يوم تذكار';
  const left = n ? daysTo(n.at) : null;
  const status = [
    n ? `<span class="sa-left${left <= 7 ? ' is-soon' : ''}">${ic('clock', 'ico-sm')}${inWords(left)}</span>` : '',
    p.class === 'living' ? chip('حي', 'gold') : '',
    p.status === 'incomplete' ? chip('ناقص: ' + p.missing.map(m => MISS[m]).join('، '), 'warn') : '',
    changed.has(p.id) ? chip('مش منشور', 'warn') : ''
  ].join('');
  return `<button class="sa-ptile${p.status === 'incomplete' ? ' is-incomplete' : ''}${p.class === 'living' ? ' is-living' : ''}" type="button" data-open="${p.id}" aria-label="افتح ${esc(p.name)}">
    <span class="sa-ptile__frame"><span class="sa-ptile__pic">${img || `<span class="sa-ptile__letter" aria-hidden="true">${letter(p)}</span>`}${img && a && a.type === 'ai' ? '<i class="sa-ptile__ai">صورة تعبيرية</i>' : ''}</span>
      <span class="sa-ptile__name"><b>${esc(p.name)}</b>${S.v === 'large' ? `<small>${when}</small>` : ''}</span></span>
    <span class="sa-ptile__status">${status}</span></button>`;
}
/* «تفاصيل»: one row each, sortable columns in step B */
function detailsTable(list) {
  return `<div class="p8-tablewrap sa-tablewrap"><table class="p8-table sa-table"><thead><tr><th></th><th>الاسم</th><th>المجموعة</th><th>النوع</th><th>الأيام</th><th>الجاي</th><th>الصور</th><th>الحالة</th></tr></thead><tbody>${list.map(p => {
    const n = p.feasts.length ? p.feasts.map(f => ({ f, at: nextOf(f) })).sort((x, y) => x.at < y.at ? -1 : 1)[0] : null;
    return `<tr data-open="${p.id}"><td>${face(p)}</td><td><b>${esc(p.name)}</b></td><td>${esc(REG.categories[p.cat])}</td><td>${p.class === 'living' ? chip('حي', 'gold') : 'متنيح'}</td><td>${AR(p.feasts.length)}</td><td>${n ? `${dayLabel(n.f)} <span class="sa-left${daysTo(n.at) <= 7 ? ' is-soon' : ''}">${inWords(daysTo(n.at))}</span>` : '—'}</td><td>${AR(p.album.length)}</td><td>${p.status === 'incomplete' ? chip('ناقص', 'warn') : chip('كاملة', 'ok')}${changed.has(p.id) ? chip('مش منشور', 'warn') : ''}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function listBody(list) {
  if (!list.length) return `<div class="p8-empty empty-state"><span class="chipico" aria-hidden="true">${ic('users')}</span><b>مفيش حد بالفلتر ده.</b></div>`;
  const draw = l => S.v === 'list' ? `<div class="comp-list ycards sa-list">${l.map(personRow).join('')}</div>` : S.v === 'details' ? detailsTable(l) : `<div class="sa-ptiles sa-ptiles--${S.v}">${l.map(personTile).join('')}</div>`;
  if (S.g !== 'cat') return draw(list);
  return Object.entries(REG.categories).map(([k, name]) => { const l = list.filter(p => p.cat === k); return l.length ? `<section class="sa-group"><h3 class="sa-group__head"><span>${name}</span><small>${AR(l.length)}</small></h3>${draw(l)}</section>` : ''; }).join('');
}
const VIEWS = [['large', 'grid', 'كبيرة'], ['medium', 'photos', 'متوسطة'], ['list', 'layers', 'قايمة'], ['details', 'sheet', 'تفاصيل']];
/* the bar that stays under the top bar while the long list scrolls (owner 2026-11-24): search, the view, grouped or not,
   «شخص جديد», «راجع وانشر» when something is saved, and «لفوق» */
function viewBar() {
  return `<div class="sa-viewbar" data-sticky><label class="p8-search sa-vsearch">${ic('search')}<input class="p8-search__input" type="search" placeholder="دوّر بالاسم…" aria-label="بحث" value="${esc(S.q)}" data-q></label>
    <div class="seg p8-filter sa-views" role="radiogroup" aria-label="شكل العرض">${VIEWS.map(([v, i, t]) => `<label class="seg__opt" title="${t}"><input type="radio" name="view" value="${v}" ${S.v === v ? 'checked' : ''}><span>${ic(i, 'ico-sm')}<em>${t}</em></span></label>`).join('')}</div>
    <div class="seg p8-filter sa-groupseg" role="radiogroup" aria-label="التجميع"><label class="seg__opt"><input type="radio" name="group" value="cat" ${S.g === 'cat' ? 'checked' : ''}><span><em class="sa-lg">بالمجموعة</em><em class="sa-sm">مجمّع</em></span></label><label class="seg__opt"><input type="radio" name="group" value="" ${S.g !== 'cat' ? 'checked' : ''}><span>كلهم</span></label></div>
    <span class="sa-viewbar__end">${changed.size ? btn(`راجع وانشر (${AR(changed.size)})`, 'send', 'btn--sm', 'data-go="publish"') : ''}${btn('شخص جديد', 'plus', 'btn--primary btn--sm', 'data-act="new"')}${btn('', 'chevron-up', 'btn--sm btn--ghost btn--icon sa-totop', 'data-act="top" aria-label="لفوق" title="لفوق"')}</span></div>`;
}
function viewPeople() {
  const inc = people.filter(p => p.status === 'incomplete');
  const n = { all: people.length, reposed: people.filter(p => p.class === 'reposed').length, living: people.filter(p => p.class === 'living').length, inc: inc.length };
  const kpis = `<div class="media8-kpis sa-kpis">${kpi('users', 'الكل', AR(n.all), '')}${kpi('cross', 'متنيحين · كارت التذكار', AR(n.reposed), 'reposed')}${kpi('church', 'أحياء · مناسبات كنيستنا', AR(n.living), 'living')}${kpi('alert', 'بيانات ناقصة', AR(n.inc), 'incomplete', 'warn')}</div>`;
  const miss = inc.length ? card('alert', 'بيانات ناقصة', 'محفوظين بصورهم وكل المعروف عنهم، بس مش بيدخلوا الأعياد ولا الإشعارات التلقائية لحد ما اليوم يتكتب بمصدره', '', `<ul class="sa-miss">${inc.map(p => {
    const pend = (p.pending || []).find(x => x.field === 'feasts') || (p.pending || [])[0];
    return `<li class="sa-miss__row">${face(p)}<div class="sa-miss__main"><b>${esc(p.name)}</b><span class="ycard__chips">${p.missing.map(m => chip('ناقص: ' + MISS[m], 'warn')).join('')}${pend && pend.checked ? chip(`اتدوّر في ${AR(pend.checked.length)} مصادر`, 'off') : ''}</span>${pend ? `<small>${esc(pend.need)}</small>` : ''}</div>${btn('كمّل', 'edit', 'btn--sm', `data-open="${p.id}"`)}</li>`;
  }).join('')}</ul>`, 'sa-misscard', 'warn') : '';
  const list = filtered();
  const cats = Object.entries(REG.categories);
  const filters = `<div class="p8-card__filters sa-filters">
    ${seg('cls', 'النوع', [['', 'الكل'], ['reposed', 'متنيحين'], ['living', 'أحياء']], S.cls)}
    ${seg('stat', 'البيانات', [['', 'الكل'], ['complete', 'كاملة'], ['incomplete', 'ناقصة']], S.stat)}
    ${seg('photo', 'الصور', [['', 'الصور: الكل'], ['yes', 'فيها صور'], ['no', 'من غير']], S.photo)}
    ${seg('praise', 'التمجيد', [['', 'التمجيد: الكل'], ['yes', 'فيه تمجيد'], ['no', 'من غير']], S.praise)}
    <select class="input sa-cat" aria-label="المجموعة" data-cat><option value="">كل المجموعات</option>${cats.map(([k, v]) => `<option value="${k}" ${S.cat === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>`;
  const body = `${viewBar()}${filters}<p class="sa-count">${list.length === people.length ? `${AR(list.length)} شخص، بترتيب السجل (اللي قبل بيكسب لو اتنين في نفس اليوم)` : `${AR(list.length)} من ${AR(people.length)}`}${PICS ? '' : ' · الصور بتظهر بعد P4'}</p>${listBody(list)}`;
  return dirtyBar() + kpis + miss + card('users', 'سجل الشخصيات', 'القديسين والمتنيحين والآباء. اضغط على أي حد تفتحه وتعدّل أيامه ومصادره وصوره', '', body, 'sa-regcard');
}

/* ---------- الشخص ---------- */
function feastRow(f, i) {
  const at = nextOf(f);
  const conv = f.coptic ? `${gText(at, true)} <small>(السنة دي)</small>` : `${cText(toCoptic(at).m, toCoptic(at).d)} <small>(السنة دي)</small>`;
  return `<li class="sa-day"><span class="sa-day__date"><b>${dayLabel(f)}</b><small>${f.coptic ? 'قبطي' : 'ميلادي'}${f.year ? ' · من ' + AR(f.year) : ''}</small></span><span class="sa-day__main"><b>${esc(f.kind)}</b><span class="sa-conv">${ic('swap')}<span>${conv}</span></span><span class="sa-src">${ic('link')}<span>${esc(host(f.source))}${f.more && f.more.length ? ` + ${AR(f.more.length)}` : ''}</span></span>${f.demo ? tag('مثال للمعاينة', 'warn') : ''}</span>${btn('عدّل', 'edit', 'btn--sm btn--ghost', `data-m="day" data-i="${i}"`)}</li>`;
}
function msRow(m, i) {
  const [t, tone] = MS_STATUS[m.status] || ['؟', 'info'];
  return `<li class="sa-ms"><span class="sa-ms__dot sa-ms__dot--${tone}" aria-hidden="true"></span><span class="sa-ms__date">${msDate(m)}</span><span class="sa-ms__main"><b>${esc(m.kind)}</b><span class="sa-src">${ic('link')}<span>${m.source === 'owner' ? 'صاحب المشروع (مستني مصدر مكتوب)' : esc(host(m.source))}</span></span></span>${tag(t, tone)}${btn('', 'edit', 'btn--sm btn--ghost btn--icon', `data-m="ms" data-i="${i}" aria-label="عدّل"`)}</li>`;
}
function albumTile(a, i, p) {
  const name = a.src.split('/').pop().replace(/\.\w+$/, '');
  return `<div class="media-tile sa-tile${a.main ? ' is-main' : ''}">${picUrl(a.src, 360) ? `<span class="media-tile__frame"><span class="sa-whole"><img class="sa-whole__bg" src="${picUrl(a.src, 360)}" alt="" aria-hidden="true" loading="lazy"><img class="sa-whole__img" src="${picUrl(a.src, 360)}" alt="" loading="lazy" onerror="this.parentNode.remove()"></span></span>` : `<span class="media-tile__frame sa-tile__frame">${ic('photos')}<small>مستني P4</small></span>`}<span class="media-tile__name">${esc(name)}</span><span class="media-tile__meta">${a.type === 'ai' ? chip('صورة تعبيرية', 'gold') : chip('صورة حقيقية', 'info')}${a.main ? chip('الأساسية', 'ok') : ''}</span><span class="sa-tile__acts">${btn('', 'edit', 'btn--sm btn--ghost btn--icon', `data-m="photo" data-i="${i}" aria-label="عدّل الصورة"`)}${btn('', 'trash', 'btn--sm btn--ghost btn--icon', 'aria-label="شيل من الألبوم"')}</span></div>`;
}
function viewPerson() {
  const p = byId(S.id) || people[0];
  const living = p.class === 'living';
  const where = living
    ? `بيظهر في «مناسبات كنيستنا» بس${p.feasts.length ? ': ' + p.feasts.map(f => `${dayLabel(f)} (${esc(f.kind)})`).join('، ') : ''}. عمره ما بيظهر في كارت «النهارده تذكار…».`
    : p.feasts.length ? `بيدخل كارت «النهارده تذكار…» لوحده كل سنة: ${p.feasts.map(f => `<b>${dayLabel(f)}</b>`).join(' و')}.` : 'مش بيدخل الأعياد ولا الإشعارات التلقائية لحد ما يتكتب يوم تذكار بمصدره.';
  const head = `<div class="sa-back">${btn('رجوع للشخصيات', 'arrow', 'btn--ghost btn--small', 'data-go="people"')}</div>
  <section class="card p8-card sa-hero">${wholePic(p, 720, 'sa-hero__pic') || face(p, true)}<div class="sa-hero__main"><h2 class="sa-hero__name">${esc(p.name)}</h2><span class="ycard__chips">${living ? chip('حي · مناسبات كنيستنا', 'gold') : chip('متنيح · كارت التذكار', 'info')}${chip(esc(REG.categories[p.cat]), 'off')}${p.status === 'incomplete' ? chip('بيانات ناقصة', 'warn') : chip('كاملة', 'ok')}${changed.has(p.id) ? chip('محفوظ ومش منشور', 'warn') : ''}</span><p class="sa-hero__where">${ic(living ? 'church' : p.feasts.length ? 'check' : 'alert', 'ico-sm')}<span>${where}</span></p></div><div class="sa-hero__acts">${btn('شيل', 'trash', 'btn--ghost btn--sm sa-danger', 'data-m="delete"')}${btn('احفظ', 'check', 'btn--primary', 'data-act="save"')}</div></section>`;
  const missing = p.status === 'incomplete' ? `<div class="ba-alert ba-alert--warn sa-missalert" role="status"><span class="chipico chipico--warn" aria-hidden="true">${ic('alert')}</span><div class="ba-alert__text"><b>بيانات ناقصة: ${p.missing.map(m => MISS[m]).join('، ')}</b><small>الشخص محفوظ ومش هيتشال. أول ما تضيف يوم بمصدره وتنشر، بيدخل الأعياد التلقائية لوحده، من غير كود ولا استيراد.</small></div>${p.missing.includes('feasts') ? btn('ضيف يوم', 'plus', 'btn--primary', 'data-m="newday"') : ''}</div>` : '';
  const basics = card('user', 'البيانات الأساسية', '', '', `<div class="ba-dayform">${field('الاسم', input(p.name, 'maxlength="120"'), 'زي ما بيظهر للشباب في الكارت')}
    <div class="ba-dayform__two">${field('النوع', seg('pcls', 'النوع', [['reposed', 'متنيح'], ['living', 'حي']], p.class), living ? '«مناسبات كنيستنا» بس، بصوره الحقيقية' : 'كارت «النهارده تذكار…»')}${field('المجموعة', `<select class="input">${Object.entries(REG.categories).map(([k, v]) => `<option ${k === p.cat ? 'selected' : ''}>${v}</option>`).join('')}</select>`)}</div>
    ${field('مصادر السيرة', `<div class="sa-links">${(p.sources || []).map(u => `<span class="sa-link">${ic('link')}<bdi>${esc(host(u))}</bdi></span>`).join('') || '<small class="muted">مفيش لسه</small>'}${btn('ضيف رابط', 'plus', 'btn--sm btn--ghost')}</div>`, 'روابط https بس. للإدارة، مش بتظهر للشباب')}</div>`);
  const days = card('calendar', living ? 'أيام المناسبات' : 'أيام التذكار', 'بتتكرر كل سنة. القبطي بيتحوّل للميلادي بالكود، ولكل يوم مصدره', btn('ضيف يوم', 'plus', 'btn--sm', 'data-m="newday"'),
    p.feasts.length ? `<ul class="sa-days">${p.feasts.map(feastRow).join('')}</ul>` : `<div class="p8-empty empty-state sa-empty"><span class="chipico chipico--warn" aria-hidden="true">${ic('calendar')}</span><b>مفيش يوم لسه</b><small>اكتب اليوم بمصدره، وبعد النشر بيدخل الأعياد لوحده.</small></div>`);
  const ms = card('clock', 'محطات العمر', 'بتحصل مرة واحدة (للخط الزمني في P7)، ومش بتعمل عيد. يوم أو شهر أو سنة، على قد المعروف', btn('ضيف محطة', 'plus', 'btn--sm', 'data-m="ms" data-i="-1"'),
    (p.milestones || []).length ? `<ul class="sa-mss">${p.milestones.map(msRow).join('')}</ul>` : `<p class="muted sa-pad">مفيش محطات.</p>`);
  const album = card('photos', 'الألبوم', 'الصورة بتتختار حسب المرحلة والمناسبة. التعبيرية عليها «صورة تعبيرية» صغيرة', btn('ضيف صورة', 'plus', 'btn--sm', 'data-m="photo" data-i="-1"'),
    `${p.album.length ? `<div class="media-grid sa-album">${p.album.map((a, i) => albumTile(a, i, p)).join('')}</div>` : `<p class="muted sa-pad">مفيش صور.</p>`}${note('info', 'الصور متسجلة من فولدرك (P2)، وبتدخل مكتبة الصور في P4. بعدها بتظهر هنا، وأي صورة جديدة بتترفع أو تتختار من المكتبة.')}`);
  const praise = card('music', 'التمجيد', p.praise ? '' : 'اختياري', p.praise ? btn('عدّل', 'edit', 'btn--sm btn--ghost') : btn('ضيف تمجيد', 'plus', 'btn--sm'),
    p.praise ? `<blockquote class="sa-praise">${esc(p.praise.text.split('\n').slice(0, 4).join('\n'))}${p.praise.text.split('\n').length > 4 ? '\n…' : ''}</blockquote><p class="sa-src">${ic('link')}<span>${esc(host(p.praise.source))}</span></p>` : `<p class="muted sa-pad">${living ? 'الآباء الأحياء مالهمش تمجيد.' : 'من غير تمجيد. الكارت بيظهر عادي.'}</p>`);
  const pend = (p.pending || []).length ? card('search', 'لسه بندوّر على', 'اللي ناقص والمصادر اللي اتشافت', '', `<ul class="sa-pend">${p.pending.map(x => `<li><b>${esc(x.need)}</b>${x.checked ? `<small>اتشاف: ${x.checked.map(u => esc(host(u))).join('، ')}</small>` : ''}${x.note ? `<small>${esc(x.note)}</small>` : ''}</li>`).join('')}</ul>`, '', 'warn') : '';
  return dirtyBar() + head + missing + `<div class="ba-cols sa-cols"><div class="ba-stack">${days}${ms}${basics}</div><div class="ba-stack">${album}${praise}${pend}</div></div>`;
}

/* ---------- المناسبات ---------- */
function occRow(o, i) {
  const once = o.repeat === 'once';
  const at = once ? o.date : nextOf(o);
  return `<li class="sa-day"><span class="sa-day__date"><b>${once ? gText(o.date) : dayLabel(o)}</b><small>${once ? 'مرة واحدة' : (o.coptic ? 'قبطي' : 'ميلادي') + ' · كل سنة'}${o.year && !once ? ' · من ' + AR(o.year) : ''}</small></span><span class="sa-day__main"><b>${esc(o.name)}</b><small class="sa-kind">${esc(o.kind || '')}</small><span class="sa-conv">${ic('swap')}<span>${once ? cText(toCoptic(o.date).m, toCoptic(o.date).d, toCoptic(o.date).y) : o.coptic ? gText(at, true) : cText(toCoptic(at).m, toCoptic(at).d)} <small>${once ? '' : '(السنة دي)'}</small></span></span><span class="sa-src">${ic('link')}<span>${esc(host(o.source))}${o.more ? ` + ${AR(o.more.length)}` : ''}</span></span></span>${tag(once ? 'مرة واحدة' : 'كل سنة', once ? 'acc' : 'info')}${btn('عدّل', 'edit', 'btn--sm btn--ghost', `data-m="new" data-i="${i}"`)}</li>`;
}
function monthOcc(ym) {
  const [y, mo] = ym.split('-').map(Number);
  const out = [];
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  for (let d = 1; d <= last; d++) {
    const date = `${ym}-${String(d).padStart(2, '0')}`;
    const c = toCoptic(date);
    const on = f => f.gregorian ? f.gregorian === date.slice(5) : f.coptic === `${c.m}-${c.d}`;
    for (const p of people) if (p.class === 'living' && p.status === 'complete') for (const f of p.feasts) if (on(f)) out.push({ date, who: p.name, what: f.kind });
    for (const o of occasions) if (o.repeat === 'once' ? o.date === date : on(o)) out.push({ date, who: o.name, what: o.kind });
  }
  return out;
}
function viewOccasions() {
  const living = people.filter(p => p.class === 'living');
  const church = card('church', 'مناسبات الكنيسة', 'أيام مش لشخص: الإيبارشية، والكنيسة، وأي مناسبة. كل سنة أو مرة واحدة', btn('مناسبة جديدة', 'plus', 'btn--primary', 'data-m="new" data-i="-1"'),
    `<ul class="sa-days">${occasions.map(occRow).join('')}</ul>`);
  const fathers = card('users', 'أيام الآباء الأحياء', 'بتتعدّل من صفحة كل أب. بتظهر هنا علشان تشوف المناسبات كلها مع بعض', '',
    `<ul class="sa-days">${living.flatMap(p => p.feasts.map(f => `<li class="sa-day"><span class="sa-day__date"><b>${dayLabel(f)}</b><small>${f.coptic ? 'قبطي' : 'ميلادي'}${f.year ? ' · من ' + AR(f.year) : ''}</small></span><span class="sa-day__main"><b>${esc(p.name)}</b><small class="sa-kind">${esc(f.kind)}</small></span>${btn('افتح', 'chevron', 'btn--sm btn--ghost', `data-open="${p.id}"`)}</li>`)).join('')}</ul>`);
  const months = ['2026-12', '2027-01'].map(ym => { const l = monthOcc(ym); return `<div class="sa-month"><b>${GM[+ym.slice(5) - 1]} ${AR(ym.slice(0, 4))}</b>${l.length ? `<ul>${l.map(x => `<li><span>${gText(x.date).replace(/ \S+$/, '')}</span><span>${esc(x.who)}<small>${esc(x.what)}</small></span></li>`).join('')}</ul>` : '<small class="muted">مفيش مناسبات</small>'}</div>`; }).join('');
  const soon = card('calendar', 'الجاي', 'اللي هيظهر في «مناسبات كنيستنا» (P5) بعد النشر', '', `<div class="sa-months">${months}</div>`);
  return dirtyBar() + `<div class="ba-cols sa-cols"><div class="ba-stack">${church}${fathers}</div><div class="ba-stack">${soon}${note('info', 'أيام الآباء الأحياء ومناسبات الكنيسة مكانها «مناسبات كنيستنا» بس، وعمرها ما بتظهر في كارت القديسين.')}</div></div>`;
}

/* ---------- راجع وانشر ---------- */
function diffOf(p) {
  const before = published.has(p.id) ? JSON.parse(published.get(p.id)) : null;
  if (!before) return [['جديد', 'شخص جديد في السجل']];
  const out = [];
  if (before.name !== p.name) out.push(['الاسم', `${before.name} ← ${p.name}`]);
  if (before.feasts.length !== p.feasts.length) out.push(['أيام التذكار', `${before.feasts.length ? before.feasts.map(dayLabel).join('، ') : '—'} ← ${p.feasts.map(dayLabel).join('، ')}`]);
  (p.milestones || []).forEach((m, i) => { const b = (before.milestones || [])[i]; if (b && msDate(b) !== msDate(m)) out.push(['محطة «' + m.kind + '»', `${msDate(b)} ← ${msDate(m)}`]); else if (b && b.note !== m.note) out.push(['محطة «' + m.kind + '»', 'الملحوظة اتعدّلت']); });
  if (JSON.stringify(before.album) !== JSON.stringify(p.album)) out.push(['الألبوم', 'الصورة الأساسية ← ' + ((p.album.find(a => a.main) || {}).type === 'photo' ? 'صورة حقيقية' : 'صورة تعبيرية')]);
  return out.length ? out : [['تعديل', 'تفاصيل']];
}
function viewPublish() {
  const list = [...changed].map(byId).filter(Boolean);
  const joins = list.filter(p => p.class === 'reposed' && p.feasts.length && JSON.parse(published.get(p.id) || '{"feasts":[]}').feasts.length === 0);
  const back = `<div class="sa-back">${btn('رجوع للشخصيات', 'arrow', 'btn--ghost btn--small', 'data-go="people"')}</div>`;
  if (S.done) {
    return back + `<div class="ba-alert ba-alert--info sa-ok" role="status"><span class="chipico chipico--ok" aria-hidden="true">${ic('check')}</span><div class="ba-alert__text"><b>اتنشر السجل ✓ النسخة ${AR(4)}</b><small>الموقع بيقراه دلوقتي، وGitHub بياخده في دقيقة. تبويب «الأعياد» بيحسب منه على طول، وترشيح الأنبا تكلا الجاي (يوم ٢٠) بيقراه لوحده.</small></div>${btn('شوف الأعياد', 'calendar', '', 'data-go="breadfeasts"')}</div>` + history(true);
  }
  const changes = card('edit', 'التغييرات من آخر نشرة', `${AR(list.length)} ${list.length === 1 ? 'شخص' : 'أشخاص'} · محفوظين في المسودة ومحدش شافهم`, '', `<ul class="sa-changes">${list.map(p => `<li class="sa-change">${face(p)}<div class="sa-change__main"><b>${esc(p.name)}</b>${diffOf(p).map(([k, v]) => `<span class="sa-diff"><small>${esc(k)}</small><span>${esc(v)}</span></span>`).join('')}</div>${btn('رجّع', 'retry', 'btn--sm btn--ghost', 'aria-label="رجّع التعديل ده"')}</li>`).join('')}</ul>`);
  const auto = card('calendar', 'الأعياد التلقائية', 'اللي بيتغيّر في كارت «النهارده تذكار…» بعد النشر', '', joins.length
    ? `<ul class="sa-joins">${joins.map(p => `<li>${ic('plus', 'ico-sm')}<span><b>${esc(p.name)}</b> هيدخل: ${p.feasts.map(f => `${dayLabel(f)} = ${gText(nextOf(f))}`).join('، ')}</span>${p.feasts.some(f => f.demo) ? tag('مثال', 'warn') : ''}</li>`).join('')}</ul>`
    : `<p class="muted sa-pad">مفيش حد هيدخل أو يخرج من الأعياد في النشرة دي. التعديلات في التفاصيل بس.</p>`, '', 'ok');
  const checks = card('shield', 'الفحص', 'نفس قواعد السجل: كل يوم ليه مصدر https، والتاريخ القبطي بالكود', '', `<ul class="sa-checks">${['كل يوم ليه نوع ومصدر https', 'التواريخ القبطية والميلادية صح', '«بيانات ناقصة» متحسوبة من البيانات', 'الأحياء بره كارت القديسين'].map(t => `<li>${ic('check', 'ico-sm')}<span>${t}</span></li>`).join('')}</ul>`, '', 'ok');
  const go = `<section class="card p8-card sa-go"><div class="sa-go__text"><b>انشر السجل</b><small>بيتنشر كله مرة واحدة كنسخة جديدة. الموقع بيقراه على طول، والرجوع لأي نسخة قبلها بدوسة.</small></div>${btn('انشر', 'send', 'btn--primary', 'data-act="publish"')}</section>`;
  return back + `<div class="ba-cols sa-cols"><div class="ba-stack">${changes}${auto}</div><div class="ba-stack">${checks}${go}${history(false)}</div></div>`;
}
function history(now) {
  const rows = [[4, 'النهارده ٧:٤٠ م', 'مينا', 'تعديلين'], [3, '٢٠ نوفمبر', 'مينا', 'أول نشرة من الأدمن'], [2, '٢٠ نوفمبر', 'الاستيراد', '١٠٨ شخص من P2']].slice(now ? 0 : 1);
  return card('history', 'النشرات اللي فاتت', 'أي نسخة ترجع بدوسة، وبتتنشر تاني كنسخة جديدة، والمسودة بترجع زيها', '', `<ul class="p8-list">${rows.map(([n, at, by, what], i) => `<li class="p8-item sa-hist"><div class="p8-item__main"><b>النسخة ${AR(n)}${i === 0 ? ' ' + tag('على الموقع', 'ok') : ''}</b><small>${at} · ${by} · ${what}</small></div>${i ? btn('رجّع النسخة دي', 'retry', 'btn--sm btn--ghost') : ''}</li>`).join('')}</ul>`);
}

/* ---------- modals ---------- */
function modal({ icon, title, body, ok = 'احفظ', tone = 'info', danger = false }) {
  const d = document.createElement('dialog');
  d.className = `modal modal--${tone} modal--form sa-modal`;
  d.innerHTML = `<span class="modal__icon" aria-hidden="true">${ic(icon)}</span><h2 class="modal__title">${title}</h2>${body}<div class="modal__actions"><button class="btn" type="button" data-close>إلغاء</button><button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" type="button" data-close>${ok}</button></div>`;
  document.body.appendChild(d);
  d.showModal();
  d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-close]')) { d.close(); d.remove(); S.m = ''; } });
  return d;
}
const monthSel = (val, cop) => `<select class="input" data-mon>${(cop ? MONTHS : GM).map((n, i) => `<option value="${i + 1}" ${i + 1 === val ? 'selected' : ''}>${cop ? AR(i + 1) + ' · ' : ''}${n}</option>`).join('')}</select>`;
const daySel = (val, max) => `<select class="input" data-day>${Array.from({ length: max }, (_, i) => `<option value="${i + 1}" ${i + 1 === val ? 'selected' : ''}>${AR(i + 1)}</option>`).join('')}</select>`;
/* the live line under a day: Coptic → this year's / next year's Gregorian; Gregorian (+ year) → Coptic */
function convLine(cal, m, d, y) {
  if (cal === 'coptic') {
    const f = { coptic: `${m}-${d}` };
    const a = nextOf(f);
    const nxt = nextOf(f, (() => { const t = new Date(a + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); })());
    return `<b>${cText(m, d)}</b> = ${gText(a, true)}<small>واللي بعدها ${gText(nxt)}${y ? ` · سنة الحدث: ${cText(m, d, y)} = ${gText(toGregorian(y, m, d))}` : ''}</small>`;
  }
  const mm = String(m).padStart(2, '0'), dd = String(d).padStart(2, '0');
  const at = nextOf({ gregorian: `${mm}-${dd}` });
  const c = toCoptic(at);
  const ev = y ? toCoptic(`${y}-${mm}-${dd}`) : null;
  return `<b>${AR(d)} ${GM[m - 1]}</b> = ${cText(c.m, c.d)} <small>السنة دي (${gText(at, true)})${ev ? ` · سنة الحدث: ${AR(d)} ${GM[m - 1]} ${AR(y)} = ${cText(ev.m, ev.d, ev.y)}` : ''}</small>`;
}
function dayModal(p, i) {
  const f = i >= 0 ? p.feasts[i] : { kind: '', coptic: '1-1', source: '' };
  const cal = f.gregorian ? 'gregorian' : 'coptic';
  const [m, d] = (f.coptic || f.gregorian).split('-').map(Number);
  const body = `<div class="ba-dayform sa-dayform" data-cal="${cal}">
    ${field('النوع', input(f.kind, 'placeholder="نياحته، استشهاده، تذكار رسامته…"'))}
    ${field('التقويم', seg('cal', 'التقويم', [['coptic', 'قبطي (زي السنكسار)'], ['gregorian', 'ميلادي (حدث حديث)']], cal))}
    <div class="sa-three">${field('الشهر', monthSel(m, cal === 'coptic'))}${field('اليوم', daySel(d, cal === 'coptic' ? (m === 13 ? 6 : 30) : 31))}${field('سنة الحدث', input(f.year || '', 'inputmode="numeric" placeholder="اختياري" data-year'))}</div>
    <p class="sa-live" data-live>${convLine(cal, m, d, f.year)}</p>
    ${field('المصدر', `<input class="input input--ltr" dir="ltr" value="${esc(f.source)}" placeholder="https://…">`, 'لازم رابط https. التاريخ من غير مصدر مبيتحفظش')}
    ${field('مصادر زيادة', `<input class="input input--ltr" dir="ltr" value="${esc((f.more || []).join(' '))}" placeholder="اختياري، رابط في كل سطر">`)}
    ${cal === 'coptic' ? field('عنوانه في السنكسار', input(f.title || '', 'placeholder="اختياري: علشان كلمة الأنبا تكلا تتجاب صح"')) : ''}
    ${field('ملحوظة', `<textarea class="input" rows="2" placeholder="اختياري: لو المصادر مختلفة">${esc(f.note || '')}</textarea>`)}</div>`;
  const dlg = modal({ icon: i >= 0 ? 'edit' : 'plus', title: (i >= 0 ? 'يوم ' : 'يوم جديد · ') + esc(p.name), body });
  wireDate(dlg);
}
function wireDate(dlg) {
  const box = dlg.querySelector('[data-cal]');
  const redraw = () => {
    const cal = box.querySelector('input[name=cal]:checked').value;
    const ms = box.querySelector('[data-mon]'), ds = box.querySelector('[data-day]');
    const wasCop = box.dataset.cal === 'coptic';
    if ((cal === 'coptic') !== wasCop) { ms.outerHTML = monthSel(+ms.value > 12 ? 12 : +ms.value, cal === 'coptic'); box.dataset.cal = cal; }
    const m = +box.querySelector('[data-mon]').value;
    const max = cal === 'coptic' ? (m === 13 ? 6 : 30) : new Date(Date.UTC(2028, m, 0)).getUTCDate();
    const cur = Math.min(+box.querySelector('[data-day]').value, max);
    box.querySelector('[data-day]').outerHTML = daySel(cur, max);
    const y = +(box.querySelector('[data-year]') || {}).value || 0;
    box.querySelector('[data-live]').innerHTML = convLine(cal, m, cur, y || null);
  };
  box.addEventListener('change', redraw);
  box.addEventListener('input', e => { if (e.target.matches('[data-year]')) redraw(); });
}
function msModal(p, i) {
  const m = i >= 0 ? p.milestones[i] : { kind: '', status: 'confirmed', source: '' };
  const prec = m.date ? 'date' : m.month ? 'month' : 'year';
  const val = m.date || m.month || (m.year ? String(m.year) : '');
  const body = `<div class="ba-dayform">${field('المحطة', input(m.kind, 'placeholder="الرهبنة، القسيسية، القمصية…"'))}
    ${field('الدقة', seg('prec', 'الدقة', [['date', 'يوم'], ['month', 'شهر'], ['year', 'سنة']], prec), 'على قد المعروف. مفيش تخمين: لو اليوم مش معروف، شهر أو سنة بس')}
    <div class="ba-dayform__two">${field('التاريخ (ميلادي)', `<input class="input input--ltr" dir="ltr" value="${esc(val)}" placeholder="${prec === 'date' ? '1978-01-03' : prec === 'month' ? '2019-08' : '1980'}">`)}${field('لحد سنة', input(m.until || '', 'placeholder="اختياري (فترة)"'))}</div>
    ${m.date ? `<p class="sa-live">${ic('swap')}<span>${gText(m.date, true)} = ${cText(toCoptic(m.date).m, toCoptic(m.date).d, toCoptic(m.date).y)}</span></p>` : ''}
    ${field('الحالة', seg('mst', 'الحالة', [['confirmed', 'مؤكد'], ['film', 'من الفيلم'], ['conflict', 'فيه اختلاف'], ['pending', 'مستني مصدر']], m.status))}
    ${field('المصدر', `<input class="input input--ltr" dir="ltr" value="${esc(m.source === 'owner' ? '' : m.source)}" placeholder="https://…">`, m.source === 'owner' ? 'من صاحب المشروع: بيفضل «مستني مصدر» لحد ما يتكتب رابط' : 'رابط https، أو علّم «من صاحب المشروع»')}
    <label class="sa-check"><input type="checkbox" ${m.source === 'owner' ? 'checked' : ''}><span>من صاحب المشروع (لسه مش مكتوب في أي مكان)</span></label>
    ${field('ملحوظة', `<textarea class="input" rows="2">${esc(m.note || '')}</textarea>`)}</div>`;
  modal({ icon: i >= 0 ? 'edit' : 'plus', title: (i >= 0 ? 'محطة · ' : 'محطة جديدة · ') + esc(p.name), body });
}
function photoModal(p, i) {
  const a = i >= 0 ? p.album[i] : null;
  const lib = ['media/2026/img-10f7918b-480.webp'];
  const tiles = Array.from({ length: 8 }, (_, k) => `<button class="media-tile is-picking sa-pick" type="button" aria-pressed="${k === 0 ? 'true' : 'false'}"><span class="media-tile__frame">${k < lib.length ? `<img class="media-tile__img" src="../../../../${lib[k]}" alt="">` : `<span class="sa-tile__frame">${ic('photos')}</span>`}</span><span class="media-tile__name">${k < lib.length ? 'صورة من المكتبة' : 'بعد P4'}</span></button>`).join('');
  const feasts = p.feasts.map(f => `<option>${esc(f.kind)} · ${dayLabel(f)}</option>`).join('');
  const body = `<div class="ba-dayform">${a ? `<p class="sa-file">${ic('photos')}<bdi>${esc(a.src.split('/').pop())}</bdi></p>` : `<div class="sa-picker"><label class="p8-search">${ic('search')}<input class="p8-search__input" type="search" placeholder="دوّر في مكتبة الصور…"></label>${btn('ارفع صورة', 'upload', 'btn--sm')}</div><div class="media-grid sa-pickgrid">${tiles}</div>`}
    ${field('النوع', seg('ptype', 'النوع', [['ai', 'صورة تعبيرية (AI)'], ['photo', 'صورة حقيقية']], a ? a.type : 'photo'), 'التعبيرية بيتكتب عليها «صورة تعبيرية» صغيرة على الموقع')}
    <div class="ba-dayform__two">${field('المرحلة', input(a && a.stage || '', 'placeholder="اختياري: الرهبنة، الأسقفية…"'))}${field('المناسبة', `<select class="input"><option>أي مناسبة</option>${feasts}</select>`)}</div>
    <label class="sa-check"><input type="checkbox" ${a && a.main ? 'checked' : ''}><span>الصورة الأساسية (بتظهر لو مفيش صورة للمرحلة أو المناسبة)</span></label>
    ${field('مصدر الصورة', `<input class="input input--ltr" dir="ltr" placeholder="اختياري · للإدارة بس، مش بيظهر">`)}</div>`;
  modal({ icon: a ? 'edit' : 'plus', title: (a ? 'صورة في ألبوم ' : 'ضيف صورة لـ') + esc(p.name), body, ok: a ? 'احفظ' : 'ضيفها' });
}
function occModal(i) {
  const o = i >= 0 ? occasions[i] : { name: '', kind: '', coptic: '1-1', source: '', repeat: 'yearly' };
  const cal = o.gregorian ? 'gregorian' : 'coptic';
  const [m, d] = (o.coptic || o.gregorian).split('-').map(Number);
  const body = `<div class="ba-dayform sa-dayform" data-cal="${cal}">${field('الاسم', input(o.name, 'placeholder="زي «إيبارشية البحر الأحمر»"'))}${field('المناسبة', input(o.kind || '', 'placeholder="ذكرى إيه بالظبط"'))}
    ${field('بتتكرر؟', seg('rep', 'التكرار', [['yearly', 'كل سنة'], ['once', 'مرة واحدة']], o.repeat || 'yearly'), 'مرة واحدة: بتظهر في سنتها بس (زي احتفال أو زيارة)')}
    ${field('التقويم', seg('cal', 'التقويم', [['coptic', 'قبطي'], ['gregorian', 'ميلادي']], cal))}
    <div class="sa-three">${field('الشهر', monthSel(m, cal === 'coptic'))}${field('اليوم', daySel(d, cal === 'coptic' ? 30 : 31))}${field('السنة', input(o.year || '', 'inputmode="numeric" placeholder="لازم في «مرة واحدة»" data-year'))}</div>
    <p class="sa-live" data-live>${convLine(cal, m, d, o.year)}</p>
    ${field('المصدر', `<input class="input input--ltr" dir="ltr" value="${esc(o.source)}" placeholder="https://…">`, 'لازم رابط https')}
    ${field('ملحوظة', `<textarea class="input" rows="3">${esc(o.note || '')}</textarea>`, 'للإدارة بس')}</div>`;
  const dlg = modal({ icon: i >= 0 ? 'edit' : 'plus', title: i >= 0 ? 'مناسبة · ' + esc(o.name) : 'مناسبة جديدة', body });
  wireDate(dlg);
}
function deleteModal(p) {
  modal({ icon: 'trash', tone: 'danger', danger: true, ok: 'شيل', title: 'تشيل «' + esc(p.name) + '» من السجل؟',
    body: `<p class="modal__text">بيتشال من المسودة، ومن الموقع والأعياد بعد النشر. ممكن يرجع بـ«رجّع» قبل النشر، أو برجوع نسخة قديمة بعده. البيانات الناقصة مش سبب للشيل: الشخص بيفضل محفوظ.</p><label class="field modal__typed-field"><span class="field__label">اكتب «شيل» علشان تأكد</span><input class="input modal__typed" placeholder="شيل"></label>` });
}

/* ---------- render + events ---------- */
function view() {
  if (S.s === 'person') return viewPerson();
  if (S.s === 'occasions') return viewOccasions();
  if (S.s === 'publish') return viewPublish();
  return viewPeople();
}
/* the sticky bar sits right under the panel's own top bar, whatever its height on this screen */
function stickTop() {
  const t = document.querySelector('.topbar');
  html.style.setProperty('--sa-top', (t && getComputedStyle(t).position === 'sticky' ? Math.round(t.getBoundingClientRect().height) : 0) + 'px');
}
addEventListener('resize', stickTop);
function render(keepScroll = false) {
  const y = window.scrollY;
  document.body.innerHTML = shell(view());
  html.classList.remove('is-intro');
  stickTop();
  if (keepScroll) window.scrollTo(0, y);
  const p = byId(S.id);
  if (S.m === 'day' && p) dayModal(p, S.i);
  if (S.m === 'newday' && p) dayModal(p, -1);
  if (S.m === 'ms' && p) msModal(p, S.i);
  if (S.m === 'photo' && p) photoModal(p, S.i);
  if (S.m === 'delete' && p) deleteModal(p);
  if (S.m === 'new' && S.s === 'occasions') occModal(S.i);
}
const LIVE = { breadprograms: 1, breadnew: 1, breadfeasts: 1, breadstats: 1, breadrefl: 1, breadsettings: 1 };
document.addEventListener('click', e => {
  const t = e.target.closest('[data-go],[data-open],[data-m],[data-f],[data-act]');
  if (!t || t.closest('dialog')) return;
  if (t.dataset.go) {
    if (LIVE[t.dataset.go]) { location.href = 'index.html#live'; return; }
    Object.assign(S, { s: t.dataset.go, m: '', done: false }); render(); window.scrollTo(0, 0); return;
  }
  if (t.dataset.open) { Object.assign(S, { s: 'person', id: t.dataset.open, m: '' }); render(); window.scrollTo(0, 0); return; }
  if (t.dataset.m) { S.m = t.dataset.m; S.i = +(t.dataset.i || 0); render(true); return; }
  if (t.dataset.f !== undefined) {
    const f = t.dataset.f;
    S.f = S.f === f ? '' : f;
    S.cls = ['living', 'reposed'].includes(S.f) ? S.f : '';
    S.stat = S.f === 'incomplete' ? 'incomplete' : '';
    render(true); return;
  }
  if (t.dataset.act === 'top') { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  if (t.dataset.act === 'save') { changed.add(S.id); render(true); return; }
  if (t.dataset.act === 'publish') { S.done = true; render(); window.scrollTo(0, 0); return; }
});
document.addEventListener('change', e => {
  const r = e.target;
  if (r.closest('dialog')) return;
  if (r.name && ['cls', 'stat', 'photo', 'praise'].includes(r.name)) { S[r.name] = r.value; S.f = ''; render(true); }
  if (r.matches('[data-cat]')) { S.cat = r.value; render(true); }
  if (r.name === 'view') { S.v = r.value; localStorage.setItem('sa-view', S.v); render(true); }
  if (r.name === 'group') { S.g = r.value; localStorage.setItem('sa-group', S.g); render(true); }
});
let typing;
document.addEventListener('input', e => {
  if (!e.target.matches('[data-q]')) return;
  clearTimeout(typing);
  typing = setTimeout(() => { S.q = e.target.value; render(true); const i = document.querySelector('[data-q]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250);
});
render();
window.__ready = true;
