// P4 review page: every prepared picture next to its person (pictures.json from tools/prepare.mjs, plan.json = the
// proposals). Pictures come from /__p4/ (tools/serve.mjs, outside the repo). Nothing here writes anywhere.
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const AR = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
const dim = o => `<bdi dir="ltr">${AR(o.w)}×${AR(o.h)}</bdi>`;
const kb = n => '<bdi dir="ltr">' + AR(Math.round(n)) + ' KB</bdi>';
const TYPE = { ai: 'ذكاء اصطناعي', photo: 'صورة حقيقية', art: 'رسم / أيقونة' };
const CLASS = { reposed: 'متنيح', living: 'حي' };
const pic = (key, size) => '/__p4/' + key + (size ? '-' + size : '') + '.webp';

const [data, plan] = await Promise.all(['pictures.json', 'plan.json'].map(f => fetch(f, { cache: 'no-store' }).then(r => r.json())));
const P = data.pictures;
const FLAG = plan.flagText;
const people = new Map(data.persons.map(p => [p.id, p]));
const byPerson = id => P.filter(x => x.person === id);
const attention = x => x.flags.length || x.ask || x.type === 'art' || x.orig.w < 300 || x.orig.h < 300;
const params = new URLSearchParams(location.search);
const state = { f: params.get('f') || 'all', q: params.get('q') || '', cat: params.get('cat') || '' };

// the «صورة تعبيرية» label (proposal): small, on the picture's corner, for AI (and art if the owner says so)
const label = x => (x.type === 'ai' || (x.type === 'art' && state.artLabel)) ? '<span class="br-feast__ai">صورة تعبيرية</span>' : '';

// the site's real feast card markup (assets/js/bread/page.js feast()), with the picture wrapped for the label
function feastCard(x) {
  const p = people.get(x.person);
  return `<section class="widget br-card br-feast p4-feast"><h2 class="br-kicker">${p.class === 'living' ? 'مناسبات كنيستنا (شكلها في P5)' : 'نحب نفكّرك'}</h2>
    <figure class="br-feast__fig"><span class="br-feast__pic"><img class="br-feast__img" src="${pic(x.key)}" width="${x.card.w}" height="${x.card.h}" alt="${esc(p.name)}" loading="lazy" decoding="async" style="background:${x.color}">${label(x)}</span></figure>
    <p class="br-feast__name">${p.class === 'living' ? '' : 'النهارده تذكار '}${esc(p.name)}</p>
    <p>كلمة السيرة بتيجي هنا من السجل…</p></section>`;
}

const chips = x => [
  `<span class="p4-chip p4-chip--${x.type}">${TYPE[x.type]}</span>`,
  x.main && byPerson(x.person).length > 1 ? '<span class="p4-chip p4-chip--main">★ الأساسية</span>' : '',
  ...x.flags.map(f => `<span class="p4-chip p4-chip--warn">${esc(FLAG[f])}</span>`),
  (x.orig.w < 300 || x.orig.h < 300) ? `<span class="p4-chip p4-chip--warn">صغيرة (${dim(x.orig)})</span>` : ''
].join('');

function tile(x) {
  const p = people.get(x.person);
  const ratio = x.thumb.w / x.thumb.h;
  return `<button class="p4-tile${attention(x) ? ' p4-tile--att' : ''}" data-key="${x.key}" type="button">
    <span class="p4-tile__pic" style="background:${x.color}"><img src="${pic(x.key, 480)}" width="${x.thumb.w}" height="${x.thumb.h}" alt="" loading="lazy" decoding="async" style="aspect-ratio:${ratio}">${x.type === 'ai' ? '<span class="br-feast__ai">صورة تعبيرية</span>' : ''}</span>
    <span class="p4-tile__name">${esc(p.name)}</span>
    <span class="p4-tile__meta">${CLASS[p.class]} · ${esc(data.categories[p.cat] || p.cat)}</span>
    ${x.stage || x.occasion ? `<span class="p4-tile__stage">${esc([x.stage, x.occasion].filter(Boolean).join(' · '))}</span>` : ''}
    <span class="p4-tile__chips">${chips(x)}</span>
    <span class="p4-tile__file" dir="auto">${esc(x.src.split('/').pop())}</span>
  </button>`;
}

function filtered() {
  const q = state.q.trim();
  return P.filter(x => {
    const p = people.get(x.person);
    if (state.f === 'att' && !attention(x)) return false;
    if (['ai', 'photo', 'art'].includes(state.f) && x.type !== state.f) return false;
    if (state.f === 'living' && p.class !== 'living') return false;
    if (state.cat && p.cat !== state.cat) return false;
    if (q && !p.name.includes(q) && !x.src.includes(q)) return false;
    return true;
  });
}

function grid() {
  const list = filtered();
  const groups = Object.keys(data.categories).map(c => [c, list.filter(x => people.get(x.person).cat === c)]).filter(g => g[1].length);
  return `<p class="p4-count">${AR(list.length)} صورة</p>` + groups.map(([c, xs]) =>
    `<section class="p4-group"><h3>${esc(data.categories[c])} <small>${AR(xs.length)}</small></h3><div class="p4-grid">${xs.map(tile).join('')}</div></section>`).join('');
}

function theophilus() {
  const xs = byPerson('theophilus').sort((a, b) => b.main - a.main || !!b.occasion - !!a.occasion);
  return `<section class="p4-block" id="theophilus"><h2>الأنبا ثاؤفيلس: الـ٧ صور كلهم</h2>
    <p class="p4-lead">المرحلة والمناسبة مقترحين من شكل الصورة، و<b>محتاجين تأكيدك</b>. الكارت بيختار صورة المناسبة (يوم رسامته ← صور «تذكار رسامته»، يوم نياحته ← صور «نياحته»)، ولو أكتر من صورة لنفس المناسبة بتتبدّل كل سنة. الصور اللي من غير مناسبة بتفضل في الألبوم ولـ«مناسبات كنيستنا» (P5).</p>
    <div class="p4-theo">${xs.map(x => `<button class="p4-theo__row" data-key="${x.key}" type="button">
      <img src="${pic(x.key, 480)}" width="${x.thumb.w}" height="${x.thumb.h}" alt="" loading="lazy" style="background:${x.color}">
      <span><b>${x.main ? '★ ' : ''}${esc(x.stage || 'المرحلة؟')}</b><br>المناسبة: ${esc(x.occasion || '—')}<br><span class="p4-ask">${esc(x.ask)}</span><br>${chips(x)}</span></button>`).join('')}</div></section>`;
}

function decisions() {
  const art = P.filter(x => x.type === 'art').length;
  const wm = P.filter(x => x.flags.includes('watermark') || x.flags.includes('text') || x.flags.includes('collage')).length;
  const smooth = P.filter(x => x.card.smooth).length;
  const ab = plan.pending.find(x => x.person === 'abraam');
  return `<section class="p4-block p4-ask-box"><h2>محتاج قرارك (٥)</h2><ol>
    <li><b>${AR(art)} صورة في فولدر «صور حقيقية» طلعت رسم أو أيقونة</b>، مش صورة فوتوغرافية (زي حبيب جرجس، وسيدهم بشاي، والمعلم إبراهيم الجوهري). اقتراحي: نوع جديد «رسم» (<code>art</code>)، وعليه كمان «صورة تعبيرية». <a href="?f=art#grid">شوفهم</a></li>
    <li><b>${AR(wm)} صورة عليها علامة St-Takla.org أو كتابة</b>. تفضل زي ما هي، ولا أقصّ العلامة لو على الطرف؟ <a href="?f=att#grid">شوفهم</a></li>
    <li><b>الأنبا ثاؤفيلس:</b> المراحل والمناسبات المقترحة، و٣ صور جماعية محتاج تقولي هو فين فيها. <a href="#theophilus">شوفهم</a></li>
    <li><b>الأنبا إبرآم أسقف الفيوم:</b> ${esc(ab ? ab.note : '')} هل أدوّر في مكان تاني، ولا تبعتلي صورة عندك؟</li>
    <li><b>الحجم:</b> صورة الكارت ٨٤٠ بكسل (ضعف أكبر مقاس للكارت على الموبايل). ${AR(smooth)} صورة ذكاء اصطناعي فيها «حبيبات» الرسم والدهبي كانت هتطلع أكبر من ١٠٠ KB، فاتنعّمت حبة صغيرة (الوشوش والخطوط زي ما هي). لو حاسس إن فيه صورة باهتة، قولي اسمها.</li>
  </ol></section>`;
}

function summary() {
  const n = t => P.filter(x => x.type === t).length;
  const med = k => { const a = P.map(x => x[k].kb).sort((a, b) => a - b); return a[a.length >> 1]; };
  const max = k => Math.max(...P.map(x => x[k].kb));
  return `<header class="p4-head"><p class="p4-kicker">خبزنا اليومي · P4 · قبل أي استيراد</p>
    <h1>مراجعة صور القديسين</h1>
    <p class="p4-lead">كل صورة جنب اسم صاحبها ونوعها ومرحلتها. لو فيه صورة على اسم غلط أو نوع غلط، قولي اسمها. <b>مفيش حاجة اتستوردت لسه:</b> الصور جاهزة برّه الريبو، ومستنية موافقتك.</p>
    <dl class="p4-stats">
      <div><dt>صور</dt><dd>${AR(P.length)}</dd></div>
      <div><dt>ذكاء اصطناعي</dt><dd>${AR(n('ai'))}</dd></div>
      <div><dt>حقيقية</dt><dd>${AR(n('photo'))}</dd></div>
      <div><dt>رسم / أيقونة</dt><dd>${AR(n('art'))}</dd></div>
      <div><dt>أشخاص</dt><dd>${AR(new Set(P.map(x => x.person)).size)}</dd></div>
      <div><dt>صورة الكارت</dt><dd>${kb(med('card'))}<small>متوسط · أقصى ${kb(max('card'))}</small></dd></div>
      <div><dt>النسخة الصغيرة ٤٨٠</dt><dd>${kb(med('thumb'))}<small>متوسط · أقصى ${kb(max('thumb'))}</small></dd></div>
    </dl></header>`;
}

function samples() {
  const pick = k => P.find(x => x.key === k);
  const xs = [pick('mercurius-1') || P.find(x => x.type === 'ai'), pick('cyril6-1') || P.find(x => x.type === 'photo'), P.find(x => x.type === 'art')].filter(Boolean);
  return `<section class="p4-block"><h2>كده هتبان في كارت «نحب نفكّرك»</h2>
    <p class="p4-lead">الكارت الحقيقي بتاع الموقع (نفس الـCSS)، والصورة كاملة من غير قص (قرار W7). <b>«صورة تعبيرية»</b> صغيرة على طرف الصورة، على صور الذكاء الاصطناعي بس. اسم المصور مبيظهرش خالص.</p>
    <div class="p4-samples">${xs.map(x => `<div><p class="p4-samp-t">${TYPE[x.type]}</p>${feastCard(x)}</div>`).join('')}</div></section>`;
}

function bar() {
  const f = [['all', 'الكل'], ['att', 'محتاج انتباه'], ['ai', 'ذكاء اصطناعي'], ['photo', 'حقيقية'], ['art', 'رسم / أيقونة'], ['living', 'الأحياء']];
  return `<div class="p4-bar" id="grid"><div class="p4-seg">${f.map(([k, t]) => `<button type="button" data-f="${k}" aria-pressed="${state.f === k}">${t}${k === 'att' ? ` <small>${AR(P.filter(attention).length)}</small>` : ''}</button>`).join('')}</div>
    <input type="search" id="q" placeholder="دوّر بالاسم أو اسم الملف" value="${esc(state.q)}"></div>`;
}

function render() {
  document.getElementById('app').innerHTML = summary() + decisions() + samples() + theophilus() + bar() + `<div id="list">${grid()}</div>` +
    `<footer class="p4-foot">الصور من <code>D:\\private_projects\\khobzna-work\\p4-pictures</code> (برّه الريبو). البيانات: <code>p4/pictures.json</code> و<code>p4/plan.json</code>. المصدر والحقوق جوه البيانات بس، ومبيتنشروش.</footer>`;
}

const bgSize = x => (x.thumb.w >= x.thumb.h ? `auto ${x.crop.z * 100}%` : `${x.crop.z * 100}% auto`);
function open(key) {
  const x = P.find(y => y.key === key);
  const p = people.get(x.person);
  const d = document.getElementById('dlg');
  const c = x.crop;
  d.innerHTML = `<div class="p4-dlg__in"><button class="p4-x" type="button" data-close aria-label="اقفل">×</button>
    <div class="p4-dlg__card">${feastCard(x)}</div>
    <div class="p4-dlg__data"><h2>${esc(p.name)}</h2><p>${CLASS[p.class]} · ${esc(data.categories[p.cat])}</p><p>${chips(x)}</p>
      <div class="p4-frames"><span class="p4-frame p4-frame--l" style="background-image:url(${pic(x.key, 480)});background-position:${c.x}% ${c.y}%;background-size:${bgSize(x)}"></span><span class="p4-frame p4-frame--s" style="background-image:url(${pic(x.key, 480)});background-position:${c.x}% ${c.y}%;background-size:${bgSize(x)}"></span><small>إطارات الأدمن المربعة (ظبط ${x.cropAuto ? 'تلقائي مقترح' : 'من P3'}: ${AR(c.x)}٪ · ${AR(c.y)}٪ · ×${AR(c.z)})</small></div>
      <table class="p4-t"><tr><th>المرحلة</th><td>${esc(x.stage || '—')}</td></tr><tr><th>المناسبة</th><td>${esc(x.occasion || '—')}</td></tr>
      ${x.ask ? `<tr><th>ملحوظة</th><td>${esc(x.ask)}</td></tr>` : ''}
      <tr><th>أيامه في السجل</th><td>${esc(p.feasts.join('، ') || '—')}</td></tr>
      <tr><th>الملف الأصلي</th><td><bdi dir="ltr">${esc(x.src)}</bdi><br>${dim(x.orig)} · ${kb(x.orig.kb)}</td></tr>
      <tr><th>الكارت</th><td>${dim(x.card)} · ${kb(x.card.kb)} · جودة ${AR(x.card.q)}${x.card.smooth ? ' · اتنعّمت حبة' : ''}</td></tr>
      <tr><th>الصغيرة</th><td>${dim(x.thumb)} · ${kb(x.thumb.kb)} — والمصغرة ${kb(x.tiny.kb)}</td></tr>
      <tr><th>المصدر (داخلي)</th><td>${esc(x.source)}</td></tr><tr><th>الحقوق (داخلي)</th><td>${esc(x.terms)}</td></tr></table></div></div>`;
  d.showModal();
}

render();
const app = document.getElementById('app');
app.addEventListener('click', e => {
  const t = e.target.closest('[data-key]');
  if (t) return open(t.dataset.key);
  const f = e.target.closest('[data-f]');
  if (f) { state.f = f.dataset.f; for (const b of app.querySelectorAll('[data-f]')) b.setAttribute('aria-pressed', b === f); document.getElementById('list').innerHTML = grid(); }
});
app.addEventListener('input', e => { if (e.target.id === 'q') { state.q = e.target.value; document.getElementById('list').innerHTML = grid(); } });
const dlg = document.getElementById('dlg');
dlg.addEventListener('click', e => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });
if (params.get('open')) open(params.get('open'));
if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
