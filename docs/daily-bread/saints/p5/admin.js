/*
 * «خبزنا اليومي» P5 — «مناسبات كنيستنا» in the admin: the clickable preview of the «المناسبات» tab after P5.
 * Inside the LIVE admin shell (../p3/admin-shell.json, captured from /admin/ itself), styled by the real admin/admin.css,
 * P3's approved layer (../p3/p3-admin.css, sa-*) and p5-admin.css (oc-* in the admin: the same components only).
 * Data: the REAL published registry (daily-bread/data/saints.json) + the proposed list (occasions.json). Nothing is saved.
 *
 *   ?s=occasions                  the tab            &f=patron|diocese|fathers   one type
 *   &m=edit&id=<id>               an occasion        &m=new                      a new one (from a person's day)
 *   &mode=light                   the panel's light mode
 */
import { MONTHS, toCoptic, toGregorian, monthDays } from '../../../../worker/src/bread/coptic.js';

const q = new URLSearchParams(location.search);
const html = document.documentElement;
const AR = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TODAY = '2026-11-25';
const ROOT = '../../../../';
const GM = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const WD = ['الحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'];

const [SHELL, REG, OCC] = await Promise.all(['../p3/admin-shell.json', ROOT + 'daily-bread/data/saints.json', 'occasions.json'].map(u => fetch(u).then(r => r.json())));
const ICONS = SHELL.desktop.icons;
const ic = (n, cls) => { const s = ICONS[n] || ICONS.info; return cls ? `<span class="${cls}" aria-hidden="true">${s}</span>` : s; };
for (const [k, v] of Object.entries(SHELL.desktop.htmlAttrs)) if (k !== 'class') html.setAttribute(k, v);
if (q.get('mode') === 'light') { html.dataset.mode = 'light'; html.dataset.theme = 'light'; }

const S = { m: q.get('m') || '', id: q.get('id') || '', f: q.get('f') || '' };
const byId = id => REG.people.find(p => p.id === id);
const TYPES = OCC.types;
const TYPE_TONE = { patron: 'warn', diocese: 'info', fathers: 'ok', church: 'acc', local: 'acc' };

/* ---------- days ---------- */
const gText = (iso, wd = false) => { const [y, m, d] = iso.split('-').map(Number); const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); return `${wd ? WD[w] + ' ' : ''}${AR(d)} ${GM[m - 1]} ${AR(y)}`; };
const cText = (m, d, y) => `${AR(d)} ${MONTHS[m - 1]}${y ? ' ' + AR(y) : ''}`;
const dayOf = o => { if (o.from) { const p = byId(o.from.person); const f = p && p.feasts.find(x => x.kind === o.from.feast); return f ? { ...f, person: p } : null; } return o; };
function isOn(f, iso) {
  if (f.repeat === 'once') return f.date === iso;
  if (f.gregorian) return f.gregorian === iso.slice(5);
  const [m, d] = f.coptic.split('-').map(Number); const c = toCoptic(iso);
  return c.m === m && (c.d === d || (m === 13 && d === 6 && c.d === 5 && monthDays(c.y, 13) === 5));
}
const addDays = (iso, k) => new Date(Date.parse(iso + 'T00:00:00Z') + k * 864e5).toISOString().slice(0, 10);
const nextOf = (f, from = TODAY) => { for (let k = 0; k < 400; k++) { const iso = addDays(from, k); if (isOn(f, iso)) return iso; } return null; };
const inDays = iso => Math.round((Date.parse(iso) - Date.parse(TODAY)) / 864e5);
const dayLabel = f => f.coptic ? cText(...f.coptic.split('-').map(Number)) : (() => { const [m, d] = f.gregorian.split('-').map(Number); return `${AR(d)} ${GM[m - 1]}`; })();
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const soonText = n => n === 0 ? 'النهارده' : n === 1 ? 'بكره' : `بعد ${AR(n)} يوم`;

/* ---------- the live shell ---------- */
const TABS = [['breadprograms', 'البرامج'], ['breadnew', 'برنامج جديد'], ['breadfeasts', 'الأعياد'], ['people', 'الشخصيات'], ['occasions', 'المناسبات'], ['breadstats', 'الإحصائيات'], ['breadrefl', 'التأملات'], ['breadsettings', 'الإعدادات']];
function shell(view) {
  let s = SHELL.desktop.shell.replaceAll('"../assets/', `"${ROOT}assets/`);
  s = s.replace(/<nav class="tabs" id="subtabs"[\s\S]*?<\/nav>/, `<nav class="tabs" id="subtabs" aria-label="الأقسام الفرعية">${TABS.map(([k, w]) => `<button class="tab" type="button" ${k === 'occasions' ? 'aria-current="page"' : ''}>${w}</button>`).join('')}</nav>`);
  const a = s.indexOf('<main class="view"'), b = s.indexOf('</main>', a) + 7;
  return s.slice(0, a) + `<main class="view" id="view" data-area="bread"><div class="ba sa" style="--i: 0;">${view}</div></main>` + s.slice(b);
}
const card = (icon, title, hint, acts, body, cls = '', tone = '') =>
  `<section class="card p8-card ${cls}"><div class="p8-card__head"><span class="chipico${tone ? ' chipico--' + tone : ''}" aria-hidden="true">${ic(icon)}</span><div class="p8-card__titles"><h2 class="card__title">${title}</h2>${hint ? `<p class="card__hint">${hint}</p>` : ''}</div>${acts ? `<div class="p8-card__acts">${acts}</div>` : ''}</div>${body}</section>`;
const btn = (label, icon, kind = '', attrs = '') => `<button class="btn${kind ? ' ' + kind : ''}" type="button" ${attrs}>${icon ? ic(icon) : ''}${label}</button>`;
const tag = (t, tone = 'info') => `<span class="p8-tag p8-tag--${tone}">${t}</span>`;
const seg = (name, label, opts, val) => `<div class="seg p8-filter" role="radiogroup" aria-label="${label}">${opts.map(([v, t]) => `<label class="seg__opt"><input type="radio" name="${name}" value="${v}" ${v === val ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>`;
const field = (label, inp, hint = '', cls = '') => `<label class="field ${cls}"><span class="field__label">${label}</span>${inp}${hint ? `<span class="field__hint">${hint}</span>` : ''}</label>`;
const box = (label, inner, hint = '') => `<div class="field"><span class="field__label">${label}</span>${inner}${hint ? `<span class="field__hint">${hint}</span>` : ''}</div>`;
const input = (v, attrs = '') => `<input class="input" value="${esc(v)}" ${attrs}>`;
const note = (icon, text) => `<p class="ba-note">${ic(icon)}<span>${text}</span></p>`;

/* pictures: the album's own copies (the admin shows the 480 copy; the preview uses the card copy) */
const picOf = (x, p = byId(x.person)) => { const a = p && (p.album || []).find(i => i.media === x.media); return a ? { src: ROOT + a.media, ai: a.type === 'ai' || a.type === 'art', crop: a.crop, name: p.name, caption: x.caption || a.caption || '' } : null; };
const thumb = (pic, cls = '') => `<span class="oca-thumb ${cls}"><img src="${pic.src}" alt="" loading="lazy" ${pic.crop ? `style="object-position:${pic.crop.x}% ${pic.crop.y}%"` : ''}></span>`;

/* ---------- the tab ---------- */
const all = OCC.occasions.map(o => ({ ...o, day: dayOf(o), at: nextOf(dayOf(o)) }));
function whenBlock(o) {
  const f = o.day;
  const from = o.from ? `<small>${f.coptic ? 'قبطي' : 'ميلادي'} · من يوم في السجل</small>` : `<small>${f.repeat === 'once' ? 'مرة واحدة' : (f.coptic ? 'قبطي' : 'ميلادي') + ' · كل سنة'}${f.year ? ' · من ' + AR(f.year) : ''}</small>`;
  return `<span class="sa-day__date"><b>${f.repeat === 'once' ? gText(f.date) : dayLabel(f)}</b>${from}</span>`;
}
function row(o) {
  const pics = (o.pictures || []).map(x => picOf(x)).filter(Boolean);
  const c = toCoptic(o.at);
  const conv = o.day.coptic ? gText(o.at, true) : cText(c.m, c.d);
  const link = o.from ? `<span class="oca-chip">${ic('link', 'ico-sm')}من «${esc(o.from.feast)}» · ${esc(byId(o.from.person).name)}</span>` : '';
  const covers = (o.covers || []).filter(x => !(o.from && x.person === o.from.person)).map(x => `<span class="oca-chip oca-chip--cover">${ic('check', 'ico-sm')}بيغطّي «${esc(x.feast)}» · ${esc(byId(x.person).name)}</span>`).join('');
  return `<li class="oca-row" data-occasion="${o.id}">
    ${whenBlock(o)}
    <span class="oca-row__main"><span class="oca-row__head"><b>${esc(o.headline.replace(/^النهارده /, ''))}</b>${tag(TYPES[o.type], TYPE_TONE[o.type])}</span>
      <small class="oca-lead">${esc(o.lead)}</small>
      <span class="oca-chips">${link}${covers}<span class="oca-chip">${ic('swap', 'ico-sm')}${conv} <small>(${soonText(inDays(o.at))})</small></span></span></span>
    <span class="oca-row__pics">${pics.slice(0, 3).map(p => thumb(p)).join('')}${pics.length > 3 ? `<span class="oca-thumb oca-thumb--n">+${AR(pics.length - 3)}</span>` : ''}</span>
    <span class="oca-row__acts">${btn('شوف الكارت', 'eye', 'btn--sm btn--ghost', `data-card="${o.id}"`)}${btn('عدّل', 'edit', 'btn--sm btn--ghost', `data-edit="${o.id}"`)}</span>
  </li>`;
}
function viewOccasions() {
  const shown = all.filter(o => !S.f || o.type === S.f).sort((a, b) => a.at < b.at ? -1 : 1);
  const counts = t => all.filter(o => o.type === t).length;
  const filters = seg('f', 'النوع', [['', `الكل (${AR(all.length)})`], ...['patron', 'diocese', 'fathers'].map(t => [t, `${TYPES[t]} (${AR(counts(t))})`])], S.f);
  const list = card('church', 'مناسبات كنيستنا', 'كارت مميز فوق أول اليوم للكل. كل سنة (قبطي أو ميلادي) أو مرة واحدة، أو من يوم شخص في السجل', btn('مناسبة جديدة', 'plus', 'btn--primary', 'data-new'),
    `<div class="oca-filters">${filters}</div><ul class="oca-list">${shown.map(row).join('')}</ul>`);
  const waiting = card('clock', 'مستنية تاريخ كامل', 'مبتظهرش على الموقع لحد ما يبقى ليها يوم كامل بمصدر', '',
    `<ul class="oca-wait">${OCC.waiting.map(w => `<li><b>${esc(w.what)}</b><small>${esc(w.known)} · ${esc(w.why)}</small></li>`).join('')}</ul>`, 'oca-waitcard');
  const next = [...all].sort((a, b) => a.at < b.at ? -1 : 1).slice(0, 7);
  const soon = card('calendar', 'الجاي', 'اللي هيظهر فوق أول اليوم في «خبزنا اليومي»', '',
    `<ol class="oca-soon">${next.map(o => { const p = (o.pictures || []).map(x => picOf(x)).filter(Boolean)[0]; const n = inDays(o.at); return `<li class="${n <= 7 ? 'is-near' : ''}">${p ? thumb(p, 'oca-thumb--sm') : ''}<span><b>${esc(o.headline.replace(/^النهارده /, ''))}</b><small>${gText(o.at, true)} · ${soonText(n)}</small></span></li>`; }).join('')}</ol>`);
  const rules = card('shield', 'من غير تكرار', '', '', `<ul class="oca-rules">
    <li>${ic('check', 'ico-sm')}<span>يوم واحد = كارت واحد. لو مناسبتين في نفس اليوم بيتجمعوا في نفس الكارت.</span></li>
    <li>${ic('check', 'ico-sm')}<span>يوم الشخص اللي المناسبة «من يومه» أو «بتغطّيه» مبيظهرش في «نحب نفكّرك» اليوم ده. مثال: ١٤ يونيو = عيد الإيبارشية بس، و«نحب نفكّرك» بيكمّل بشهيد اليوم.</span></li>
    <li>${ic('check', 'ico-sm')}<span>أبي سيفين: كارت واحد كشفيع كنيستنا، فيه كلمة السنكسار والتمجيد وأيامه.</span></li>
    <li>${ic('check', 'ico-sm')}<span>الآباء الأحياء هنا بس، عمرهم ما بيظهروا في كارت القديسين.</span></li></ul>`);
  const p6 = note('bell', 'الإشعارات التلقائية للمناسبات في P6: كل مناسبة هنا هيبقى ليها ميعاد ووقف من نفس الصف.');
  return `<div class="ba-cols sa-cols oca-cols"><div class="ba-stack">${list}${waiting}</div><div class="ba-stack">${soon}${rules}${p6}</div></div>`;
}

/* ---------- the occasion form ---------- */
const monthSel = (val, cop) => `<select class="input">${(cop ? MONTHS : GM).map((n, i) => `<option value="${i + 1}" ${i + 1 === val ? 'selected' : ''}>${cop ? AR(i + 1) + ' · ' : ''}${n}</option>`).join('')}</select>`;
const daySel = (val, max) => `<select class="input">${Array.from({ length: max }, (_, i) => `<option ${i + 1 === val ? 'selected' : ''}>${AR(i + 1)}</option>`).join('')}</select>`;
function form(o) {
  const isNew = !o;
  o = o || { id: '', type: 'fathers', from: { person: 'ibrahimisravim', feast: 'عيد رسامته قس' }, headline: 'النهارده عيد ', lead: '', pictures: [] };
  const mode = o.from ? 'from' : o.repeat === 'once' ? 'once' : o.coptic ? 'coptic' : 'gregorian';
  const f = dayOf(o);
  const people = REG.people.filter(p => p.feasts.length && (p.class === 'living' || ['mercurius', 'theophilus', 'makariosqena'].includes(p.id) || (o.people || []).includes(p.id)));
  const pick = o.from
    ? `<div class="sa-three oca-two">${field('الشخص', `<select class="input">${people.map(p => `<option ${p.id === o.from.person ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`)}${field('اليوم', `<select class="input">${byId(o.from.person).feasts.map(x => `<option ${x.kind === o.from.feast ? 'selected' : ''}>${esc(x.kind)} · ${dayLabel(x)}</option>`).join('')}</select>`)}</div>
       <p class="sa-live">${ic('link')}<span>التاريخ والمصدر من السجل: <b>${dayLabel(f)}</b>${f.year ? ' من ' + AR(f.year) : ''} = ${gText(nextOf(f), true)}<small>لو اليوم اتعدّل في صفحة الشخص، المناسبة بتمشي معاه. واليوم ده مبيظهرش في «نحب نفكّرك».</small></span></p>`
    : (() => { const [m, d] = (o.coptic || o.gregorian).split('-').map(Number); const cop = !!o.coptic; const at = nextOf(o); const c = toCoptic(at); return `<div class="sa-three">${field('الشهر', monthSel(m, cop))}${field('اليوم', daySel(d, cop ? 30 : 31))}${field('سنة الحدث', input(o.year || '', 'inputmode="numeric"'))}</div>
       <p class="sa-live">${ic('swap')}<span><b>${cop ? cText(m, d) : `${AR(d)} ${GM[m - 1]}`}</b> = ${cop ? gText(at, true) : cText(c.m, c.d)}<small>السنة دي${o.year ? ` · سنة الحدث: ${gText(`${o.year}-${o.gregorian}`)} = ${cText(...Object.values(toCoptic(`${o.year}-${o.gregorian}`)).slice(1, 3), toCoptic(`${o.year}-${o.gregorian}`).y)}` : ''}</small></span></p>`; })();
  const covers = (o.covers || []).filter(x => !(o.from && x.person === o.from.person));
  const coverBox = box('بتغطّي كمان', `<div class="oca-chips">${covers.map(x => `<span class="oca-chip oca-chip--cover">${ic('check', 'ico-sm')}«${esc(x.feast)}» · ${esc(byId(x.person).name)}<button class="oca-x" type="button" aria-label="شيل">${ic('close')}</button></span>`).join('')}${btn('ضيف يوم شخص', 'plus', 'btn--sm btn--ghost')}</div>`, 'أيام أشخاص في نفس اليوم بيقولوا نفس الخبر: بتتجمع هنا، ومبتظهرش لوحدها ولا في «نحب نفكّرك».');
  const ids = [...new Set([...(o.people || []), ...(o.from ? [o.from.person] : []), ...covers.map(x => x.person)])];
  const chosen = new Map((o.pictures || []).map((x, i) => [x.media, i + 1]));
  const albumPics = ids.flatMap(id => (byId(id).album || []).map(a => ({ person: id, media: a.media, pic: picOf({ person: id, media: a.media }), a })));
  const pics = box('الصور', `<div class="oca-pick">${albumPics.map(x => `<button class="oca-pickpic ${chosen.has(x.media) ? 'is-on' : ''}" type="button" aria-pressed="${chosen.has(x.media)}">${thumb(x.pic)}${chosen.has(x.media) ? `<span class="oca-pickpic__n">${AR(chosen.get(x.media))}</span>` : ''}${x.a.type !== 'photo' ? '<span class="oca-pickpic__ai">تعبيرية</span>' : ''}<small>${esc(x.a.caption || x.a.stage || byId(x.person).name)}</small></button>`).join('')}
      <button class="oca-pickpic oca-pickpic--add" type="button">${ic('photos')}<small>من مكتبة الصور</small></button></div>`,
    'من ألبومات الأشخاص أو من مكتبة الصور. الرقم = الترتيب: الأولى قدام، والباقي ورا بعض، ودوسة بتفتحهم كلهم. صورة واحدة لكل أب لو اتنين.');
  const body = `<div class="ba-dayform sa-dayform oca-form">
    ${field('العنوان اللي بيظهر', input(o.headline), 'بيبدأ بـ«النهارده…». الكارت بيكتب تحته اسم الشخص لوحده')}
    ${box('النوع', seg('type', 'النوع', Object.entries(TYPES).map(([k, v]) => [k, v]), o.type))}
    ${box('اليوم', seg('when', 'اليوم', [['from', 'من يوم شخص في السجل'], ['coptic', 'قبطي كل سنة'], ['gregorian', 'ميلادي كل سنة'], ['once', 'مرة واحدة']], mode))}
    ${pick}
    ${coverBox}
    ${field('الكلام', `<textarea class="input" rows="3" maxlength="600">${esc(o.lead)}</textarea>`, 'بأسلوبنا، والوقائع بمصدرها بس. لحد ٦٠٠ حرف')}
    ${o.type === 'patron' ? note('info', 'كلمة السنكسار والتمجيد بيتجابوا لوحدهم: الكلمة من «الأعياد» (نفس كلمة الأنبا تكلا)، والتمجيد من صفحة أبي سيفين.') : ''}
    ${pics}
    ${o.from ? '' : field('المصدر', `<input class="input input--ltr" dir="ltr" value="${esc(o.source || '')}" placeholder="https://…">`, 'لازم رابط https')}
    ${o.from ? '' : field('مصادر زيادة', `<input class="input input--ltr" dir="ltr" value="${esc((o.more || []).join(' '))}" placeholder="اختياري">`)}
  </div>`;
  const d = document.createElement('dialog');
  d.className = 'modal modal--info modal--form sa-modal oca-modal';
  d.innerHTML = `<span class="modal__icon" aria-hidden="true">${ic(isNew ? 'plus' : 'edit')}</span><h2 class="modal__title">${isNew ? 'مناسبة جديدة' : 'مناسبة · ' + esc(o.headline.replace(/^النهارده /, ''))}</h2>${body}
    <div class="modal__actions">${isNew ? '' : btn('شيل المناسبة', 'trash', 'btn--ghost sa-danger oca-del')}${btn('شوف الكارت', 'eye', '', `data-card="${o.id || 'ibrahimpriest'}"`)}<button class="btn" type="button" data-close>إلغاء</button><button class="btn btn--primary" type="button" data-close>احفظ</button></div>`;
  document.body.append(d);
  d.showModal();
  d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-close]')) { d.close(); d.remove(); } });
}

/* ---------- «شوف الكارت»: the member page itself, on that day (the phone) ---------- */
function preview(id) {
  const o = all.find(x => x.id === id);
  const d = document.createElement('dialog');
  d.className = 'modal modal--info modal--form sa-modal oca-modal oca-modal--card';
  d.innerHTML = `<span class="modal__icon" aria-hidden="true">${ic('eye')}</span><h2 class="modal__title">هيبان كده يوم ${gText(o.at, true)}</h2>
    <div class="oca-phone"><iframe src="member.html?d=${o.at}&w=phone" title="الكارت على الموبايل" loading="lazy"></iframe></div>
    <div class="modal__actions"><button class="btn btn--primary" type="button" data-close>تمام</button></div>`;
  document.body.append(d);
  d.showModal();
  d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-close]')) { d.close(); d.remove(); } });
}

function render() {
  document.body.innerHTML = shell(viewOccasions());
  html.classList.remove('is-intro');
  if (S.m === 'edit') form(all.find(o => o.id === S.id));
  if (S.m === 'new') form(null);
  if (S.m === 'card') preview(S.id);
  html.dataset.ready = '1';
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-edit],[data-new],[data-card]');
  if (t && t.dataset.card) { document.querySelectorAll('dialog[open]').forEach(x => { x.close(); x.remove(); }); preview(t.dataset.card); }
  else if (t && t.dataset.edit) form(all.find(o => o.id === t.dataset.edit));
  else if (t && t.hasAttribute('data-new')) form(null);
});
document.addEventListener('change', e => { if (e.target.name === 'f' && e.target.closest('.oca-filters')) { S.f = e.target.value; render(); } });
render();
