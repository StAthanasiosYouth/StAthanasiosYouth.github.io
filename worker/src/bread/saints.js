/*
 * «خبزنا اليومي» — the saints and church people registry: ONE rulebook for the Worker (P3 admin routes, the feasts
 * tab), the tools (tools/lib/saints.mjs adds the file reads) and the tests. Pure: no fs, no D1.
 *
 * Schema 2 (P2, 2026-11-24; P3 additions marked). A person:
 *   class    'reposed' (the «النهارده تذكار…» card) | 'living' («مناسبات كنيستنا» only, never the saints card)
 *   status   'complete' | 'incomplete', with `missing` = the fields still empty ('feasts', 'album'). Computed from the
 *            data (withStatus), never typed by hand. Nobody is removed for missing data: a person without a day stays,
 *            but never reaches the automatic feasts or notifications until a day with its source is added.
 *   feasts   [{ kind, coptic: 'M-D' | gregorian: 'MM-DD', year?, source, more?: [url], title?, note? }] — yearly days
 *   milestones? [{ kind, date | month | year (until?), source | 'owner', status: confirmed|film|conflict|pending, note? }]
 *   sources? [url] · pending? [{ field, need, checked: [url], note? }] · praise? { text, source, title? } · word?
 *   album    [{ src?, media?, type: 'ai' | 'photo' | 'art', main?, stage?, occasion?, caption?, credit?, crop?: { x, y, z } }]
 *            type (P4, owner 2026-11-24): ai = AI illustration, photo = a real photograph, art = a painted / drawn portrait
 *            or icon (not AI, not a photograph). ai and art show «صورة تعبيرية» on the site (labelOf).
 *            src = the owner's picture file (P2, internal); media = the site's media library path (P4); crop (P3, owner
 *            2026-11-24): the point kept in view (% of the picture) and the zoom (1–3) for the admin's small frames.
 * Top level `occasions`: church days that are not a person: { id, name, kind?, coptic | gregorian, year?, repeat?:
 * 'yearly' | 'once' (P3), date? (once: 'YYYY-MM-DD'), source, more?, note? }. «مناسبات كنيستنا» only.
 * P5 (docs/daily-bread/saints/P5-PLAN.md, approved 2026-11-25) adds to an occasion:
 *   from?    { person, feast }  its day (and source) is that person's day in the registry, never typed twice
 *   covers?  [{ person, feast }] people's days the same day that this card stands for (never shown again that day)
 *   type     'patron' | 'family' | 'diocese' | 'fathers' | 'church' | 'local'      look? 'pope' | 'bishop' | 'memorial'
 *   badge?, honor? («مثلث الرحمات»), people? [id], headline, lead, pictures? [{ person?, media, caption? }]
 *   notify?  reserved for P6 (the automatic notifications), ignored in P5
 * And a praise may carry its full text (owner 2026-11-25: every praise in full on our own page):
 *   praise { text, source, title?, refrain?, verses?: [[line…]…] }   text = the short excerpt the card shows
 * P5b (owner 2026-11-25): each day may carry its own words for «نحب نفكّرك» (feasts[].word), and a person may have
 * several praises — the ones actually sung, not any madih with the name — one main, others for a day or a season:
 *   praises? [{ id, type: tamgeed|madih|tasbeha|doxology|psali|lahn, title, source, more?, status: confirmed|candidate,
 *              main?, days? [feast kind], context?, opening?, author?, refrain?, verses? [[line…]…], note? }]
 *   candidate = in the admin only, never on the site; confirmed needs its text. The legacy `praise` stays the card's
 *   praise until a confirmed one exists (nothing is replaced before the owner confirms).
 */
import { daysOfMonth, monthDays, toCoptic, seasonsOn, SEASONS } from './coptic.js';
const SEASON_IDS = SEASONS.map(s => s[0]);

export const CLASSES = ['reposed', 'living'];
export const MISSABLE = ['feasts', 'album'];
export const MILESTONE_STATUS = ['confirmed', 'film', 'conflict', 'pending'];
export const OWNER = 'owner';
export const ALBUM_TYPES = ['ai', 'photo', 'art'];
// the media library's own picture path (P4): the card copy, and the small 480 copy beside it
export const SITE_MEDIA_IMG = /^\/media\/\d{4}\/[a-z]{3}-[a-z0-9]{8}\.(?:webp|jpg)$/;
export const IMG_DIR = 'assets/img/saints/';
export const ID_RE = /^[a-z0-9]+$/;
export const LIMITS = { name: 120, kind: 120, title: 200, note: 1500, need: 400, praise: 1500, word: 2000, stage: 80, caption: 200, src: 300, album: 40, feasts: 12, milestones: 40, sources: 20, more: 10, headline: 160, lead: 700, badge: 60, pictures: 12, covers: 6, verses: 150, verse: 6, line: 200, praiseFull: 20000, praises: 12 };
export const PRAISE_TYPES = ['tamgeed', 'madih', 'tasbeha', 'doxology', 'psali', 'lahn'];
export const PRAISE_STATUS = ['confirmed', 'candidate'];
export const OCC_TYPES = ['patron', 'family', 'diocese', 'fathers', 'church', 'local'];
export const OCC_LOOKS = ['pope', 'bishop', 'memorial'];
export const OCC_TYPE_NAMES = { patron: 'شفيع كنيستنا', family: 'شفيع أسرتنا', diocese: 'إيبارشيتنا وآباؤها الأساقفة', fathers: 'آباء كنيستنا', church: 'تاريخ كنيستنا', local: 'تذكار عندنا' };
const URL_RE = /^https:\/\/[^\s<>"']+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MEDIA_RE = /^media\/\d{4}\/[a-z]{3}-[a-z0-9]{8}\.(?:webp|jpg)$/;
const realDate = s => typeof s === 'string' && DATE_RE.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;

/* what a person still lacks: the rule status/missing follow */
export function missingOf(p) {
  const out = [];
  if (!Array.isArray(p.feasts) || !p.feasts.length) out.push('feasts');
  if (!Array.isArray(p.album) || !p.album.length) out.push('album');
  return out;
}

/* the person with status/missing computed from its data (P3: the Worker writes them, the admin never types them) */
export function withStatus(p) {
  const missing = missingOf(p);
  return { ...p, status: missing.length ? 'incomplete' : 'complete', missing };
}

/* may this person reach the automatic days (feasts card, occasions, notifications)? Only with a day. */
export const scheduled = p => Array.isArray(p.feasts) && p.feasts.length > 0 && Array.isArray(p.missing) && !p.missing.includes('feasts');

const text = (v, max) => typeof v === 'string' && v.trim() !== '' && v.length <= max;
const optText = (v, max) => v == null || (typeof v === 'string' && v.length <= max);

function checkDay(f, e, { occasion = false } = {}) {
  const who = `«${f && f.kind || (f && f.name) || '?'}»`;
  if (!f || typeof f !== 'object') { e('يوم مش مفهوم.'); return; }
  if (!occasion && !text(f.kind, LIMITS.kind)) e('يوم من غير نوع (kind).');
  if (occasion && f.kind != null && !optText(f.kind, LIMITS.title)) e(`${who}: وصف المناسبة طويل.`);
  // a link, or 'owner' = «معلومة من الكنيسة أو شخصية، من غير مصدر مكتوب» (owner 2026-11-25: a father's birthday): no link on the site
  if (f.source !== OWNER && (typeof f.source !== 'string' || !URL_RE.test(f.source))) e(`${who}: المصدر لازم رابط https، أو «من غير مصدر مكتوب».`);
  if (f.more != null && (!Array.isArray(f.more) || f.more.length > LIMITS.more)) e(`${who}: المصادر الزيادة لازم قايمة (لحد ${LIMITS.more}).`);
  for (const u of Array.isArray(f.more) ? f.more : []) if (typeof u !== 'string' || !URL_RE.test(u)) e(`${who}: رابط زيادة مش https.`);
  if (!optText(f.title, LIMITS.title) || !optText(f.note, LIMITS.note)) e(`${who}: العنوان أو الملحوظة طويلين.`);
  if (f.year != null && !(Number.isInteger(f.year) && f.year > 0 && f.year < 2100)) e(`${who}: السنة «${f.year}» مش صح.`);
  if (occasion && f.repeat != null && f.repeat !== 'yearly' && f.repeat !== 'once') e(`${who}: التكرار لازم كل سنة أو مرة واحدة.`);
  if (occasion && f.repeat === 'once') {
    // one time: a full date (P3); shown in its own year only
    if (!realDate(f.date)) e(`${who}: المناسبة اللي مرة واحدة لازم ليها تاريخ كامل (YYYY-MM-DD).`);
    if (f.coptic != null || f.gregorian != null) e(`${who}: المرة الواحدة بتاريخها بس.`);
    return;
  }
  if (f.date != null) e(`${who}: التاريخ الكامل للمناسبة اللي مرة واحدة بس.`);
  const c = f.coptic, g = f.gregorian;
  if ((c == null) === (g == null)) { e(`${who}: لازم coptic أو gregorian (واحد بس).`); return; }
  if (c != null) {
    const m = /^(\d{1,2})-(\d{1,2})$/.exec(c);
    if (!m || +m[1] < 1 || +m[1] > 13 || +m[2] < 1 || +m[2] > (+m[1] === 13 ? 6 : 30)) e(`${who}: اليوم القبطي «${c}» مش صح.`);
  } else if (typeof g !== 'string' || !/^\d{2}-\d{2}$/.test(g) || !realDate(`2028-${g}`)) e(`${who}: اليوم الميلادي «${g}» مش صح.`);
  else if (f.year != null && g !== '02-29' && !realDate(`${f.year}-${g}`)) e(`${who}: ${f.year}-${g} مش تاريخ.`);
}

function checkAlbumItem(a, e, opts) {
  if (!a || typeof a !== 'object') { e('album: صورة مش مفهومة.'); return; }
  const hasSrc = a.src != null, hasMedia = a.media != null;
  if (!hasSrc && !hasMedia) e('album: الصورة لازم ليها ملف (src) أو صورة من المكتبة (media).');
  if (hasSrc && (typeof a.src !== 'string' || !a.src.trim() || a.src.includes('..') || a.src.length > LIMITS.src)) e('album: src فاضي أو غلط.');
  if (hasMedia && (typeof a.media !== 'string' || !MEDIA_RE.test(a.media))) e('album: الصورة لازم من مكتبة الصور (media/YYYY/…).');
  if (!ALBUM_TYPES.includes(a.type)) e(`album: النوع «${a.type}» لازم ai أو photo أو art.`);
  if (a.main != null && typeof a.main !== 'boolean') e('album: «الأساسية» لازم آه أو لأ.');
  if (!optText(a.stage, LIMITS.stage) || !optText(a.occasion, LIMITS.kind) || !optText(a.caption, LIMITS.caption) || !optText(a.credit, LIMITS.caption)) e('album: المرحلة أو المناسبة أو الوصف طويل.');
  if (a.crop != null) {
    const c = a.crop, n = v => typeof v === 'number' && isFinite(v);
    if (typeof c !== 'object' || !n(c.x) || !n(c.y) || !n(c.z) || c.x < 0 || c.x > 100 || c.y < 0 || c.y > 100 || c.z < 1 || c.z > 3) e('album: ظبط الصورة مش صح (x و y من ٠ لـ ١٠٠، والتكبير من ١ لـ ٣).');
  }
  if (hasSrc && opts.pictureExists && !opts.pictureExists(a.src)) e(`album: الملف «${a.src}» مش موجود في فولدر الصور.`);
}

/* one person's problems, as plain sentences (empty = fine). cats = the categories map. */
export function checkPerson(p, { cats = {}, imageExists = null, pictureExists = null, statusTyped = true } = {}) {
  const errs = [];
  const who = (p && p.id) || '?';
  const e = m => errs.push(`${who}: ${m}`);
  if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !ID_RE.test(p.id) || p.id.length > 40) { e('id لازم حروف إنجليزي صغيرة وأرقام بس.'); return errs; }
  if (!text(p.name, LIMITS.name)) e('الاسم فاضي أو طويل.');
  if (!cats[p.cat]) e(`المجموعة «${p.cat}» مش في categories.`);
  if (!CLASSES.includes(p.class)) e(`class لازم ${CLASSES.join(' أو ')}.`);
  if (!Array.isArray(p.feasts) || p.feasts.length > LIMITS.feasts) { e(`feasts لازم قايمة (ممكن تبقى فاضية، لحد ${LIMITS.feasts}).`); return errs; }
  for (const f of p.feasts) { checkDay(f, e); if (!optText(f.word, LIMITS.word)) e(`«${f.kind}»: كلام «نحب نفكّرك» طويل (لحد ${LIMITS.word} حرف).`); }
  if (statusTyped) {
    const want = missingOf(p);
    if (!Array.isArray(p.missing) || p.missing.join() !== want.join()) e(`missing لازم [${want.join(', ')}].`);
    if (p.status !== (want.length ? 'incomplete' : 'complete')) e(`status لازم «${want.length ? 'incomplete' : 'complete'}».`);
  }
  if (p.milestones != null && (!Array.isArray(p.milestones) || p.milestones.length > LIMITS.milestones)) e('milestones لازم قايمة.');
  for (const m of Array.isArray(p.milestones) ? p.milestones : []) {
    if (!m || !text(m.kind, LIMITS.title)) e('محطة من غير نوع (kind).');
    if (m && m.source === OWNER) { if (m.status !== 'pending') e(`محطة «${m.kind}»: اللي من صاحب المشروع حالتها pending لحد ما يبقى ليها مصدر.`); }
    else if (!m || typeof m.source !== 'string' || !URL_RE.test(m.source)) e(`محطة «${m && m.kind}»: المصدر لازم رابط https.`);
    for (const u of (m && m.more) || []) if (typeof u !== 'string' || !URL_RE.test(u)) e(`محطة «${m.kind}»: رابط زيادة مش https.`);
    if (!MILESTONE_STATUS.includes(m && m.status)) e(`محطة «${m && m.kind}»: status لازم ${MILESTONE_STATUS.join('/')}.`);
    if (m && m.date != null && !realDate(m.date)) e(`محطة «${m.kind}»: التاريخ «${m.date}» مش صح.`);
    if (m && m.month != null && !(/^\d{4}-(0[1-9]|1[0-2])$/.test(m.month))) e(`محطة «${m.kind}»: الشهر «${m.month}» مش صح (YYYY-MM).`);
    if (m && m.year != null && !(Number.isInteger(m.year) && m.year > 0 && m.year < 2100)) e(`محطة «${m.kind}»: السنة مش صح.`);
    if (m && m.until != null && !(Number.isInteger(m.until) && m.until > 0 && m.until < 2100)) e(`محطة «${m.kind}»: «لحد سنة» مش صح.`);
    if (m && [m.date, m.month, m.year].filter(x => x != null).length > 1) e(`محطة «${m.kind}»: date أو month أو year، واحد بس.`);
    if (m && !optText(m.note, LIMITS.note)) e(`محطة «${m.kind}»: الملحوظة طويلة.`);
  }
  if (p.sources != null && (!Array.isArray(p.sources) || p.sources.length > LIMITS.sources)) e('sources لازم قايمة.');
  for (const u of Array.isArray(p.sources) ? p.sources : []) if (typeof u !== 'string' || !URL_RE.test(u)) e('sources: رابط مش https.');
  for (const q of Array.isArray(p.pending) ? p.pending : []) {
    if (!q || !MISSABLE.concat('milestones').includes(q.field) || !text(q.need, LIMITS.need)) e('pending: لازم field و need.');
    for (const u of (q && q.checked) || []) if (typeof u !== 'string' || !URL_RE.test(u)) e('pending: رابط مش https.');
  }
  if (!Array.isArray(p.album) || p.album.length > LIMITS.album) e(`album لازم قايمة (لحد ${LIMITS.album}).`);
  for (const a of Array.isArray(p.album) ? p.album : []) checkAlbumItem(a, e, { pictureExists });
  if (Array.isArray(p.album) && p.album.filter(a => a && a.main).length > 1) e('album: صورة أساسية واحدة بس.');
  if (p.praises != null) {
    if (!Array.isArray(p.praises) || p.praises.length > LIMITS.praises) e(`التماجيد لازم قايمة (لحد ${LIMITS.praises}).`);
    const kinds = new Set(p.feasts.map(f => f.kind));
    const ids = new Set();
    for (const q of Array.isArray(p.praises) ? p.praises : []) {
      const w = `تمجيد «${(q && q.title) || '?'}»`;
      if (!q || typeof q.id !== 'string' || !ID_RE.test(q.id) || ids.has(q.id)) { e(w + ': id مش صح أو متكرر.'); continue; }
      ids.add(q.id);
      if (!PRAISE_TYPES.includes(q.type)) e(w + ': النوع مش معروف.');
      if (!text(q.title, LIMITS.title)) e(w + ': العنوان فاضي أو طويل.');
      if (typeof q.source !== 'string' || !URL_RE.test(q.source)) e(w + ': المصدر لازم رابط https.');
      for (const u of q.more || []) if (typeof u !== 'string' || !URL_RE.test(u)) e(w + ': رابط زيادة مش https.');
      if (!PRAISE_STATUS.includes(q.status)) e(w + ': الحالة لازم مؤكد أو مرشح.');
      if (q.main != null && typeof q.main !== 'boolean') e(w + ': «الأساسي» لازم آه أو لأ.');
      if (q.days != null && (!Array.isArray(q.days) || !q.days.every(k => kinds.has(k)))) e(w + ': أيام مش موجودة عند الشخص.');
      // owner 2026-11-25: a whole season (صوم العذراء، كيهك…), coptic.js SEASONS
      if (q.seasons != null && (!Array.isArray(q.seasons) || q.seasons.length > SEASON_IDS.length || !q.seasons.every(s => SEASON_IDS.includes(s)))) e(w + ': فترة مش معروفة.');
      if (!optText(q.context, LIMITS.title) || !optText(q.opening, LIMITS.line) || !optText(q.author, LIMITS.name) || !optText(q.refrain, LIMITS.line) || !optText(q.note, LIMITS.note)) e(w + ': خانة طويلة.');
      if (q.verses != null) {
        const ok = Array.isArray(q.verses) && q.verses.length <= LIMITS.verses && q.verses.every(v => Array.isArray(v) && v.length > 0 && v.length <= LIMITS.verse && v.every(l => text(l, LIMITS.line)));
        if (!ok) e(w + `: النص لازم مقاطع (لحد ${LIMITS.verses})، وكل مقطع من ١ لـ${LIMITS.verse} أبيات.`);
        else if (q.verses.flat().join('').length > LIMITS.praiseFull) e(w + ': النص طويل.');
      }
      if (q.status === 'confirmed' && !(Array.isArray(q.verses) && q.verses.length)) e(w + ': المؤكد لازم يبقى معاه النص.');
    }
    if (Array.isArray(p.praises) && p.praises.filter(q => q && q.main && q.status === 'confirmed').length > 1) e('التماجيد: تمجيد أساسي واحد بس.');
  }
  if (p.praise != null) {
    const q = p.praise;
    if (!q || !text(q.text, LIMITS.praise)) e('التمجيد: النص فاضي أو طويل (لحد ١٥٠٠ حرف).');
    if (!q || typeof q.source !== 'string' || !URL_RE.test(q.source)) e('التمجيد: المصدر لازم رابط https.');
    // P5: the full praise (owner 2026-11-25), verses of 1–6 lines, and its response (المرد)
    if (q && q.refrain != null && !optText(q.refrain, LIMITS.line)) e('التمجيد: المرد طويل.');
    if (q && q.verses != null) {
      const ok = Array.isArray(q.verses) && q.verses.length <= LIMITS.verses && q.verses.every(v => Array.isArray(v) && v.length > 0 && v.length <= LIMITS.verse && v.every(l => text(l, LIMITS.line)));
      if (!ok) e(`التمجيد الكامل: لازم مقاطع (لحد ${LIMITS.verses})، وكل مقطع من ١ لـ${LIMITS.verse} أبيات، وكل بيت لحد ${LIMITS.line} حرف.`);
      else if (q.verses.flat().join('').length > LIMITS.praiseFull) e('التمجيد الكامل طويل.');
    }
  }
  if (!optText(p.word, LIMITS.word)) e('الكلمة طويلة.');
  if (p.image != null) {
    const im = p.image;
    if (!im || typeof im.file !== 'string' || !im.file.startsWith(IMG_DIR) || !/\.(webp|jpg|png)$/.test(im.file)) e(`الصورة لازم ملف تحت ${IMG_DIR}.`);
    else if (imageExists && !imageExists(im.file)) e(`الصورة ${im.file} مش موجودة.`);
    if (!im || typeof im.source !== 'string' || !URL_RE.test(im.source)) e('الصورة: مصدرها لازم رابط https.');
    if (!im || !text(im.license, 200)) e('الصورة: الرخصة مش مكتوبة.');
  }
  return errs;
}

/* a {person, feast} link: the person exists and has that day (people = the registry's people; null = not checked) */
const linkOk = (l, people) => !!l && typeof l === 'object' && typeof l.person === 'string' && ID_RE.test(l.person) && text(l.feast, LIMITS.kind)
  && (!people || !!((people.find(p => p.id === l.person) || { feasts: [] }).feasts || []).find(f => f.kind === l.feast));

export function checkOccasion(o, { people = null } = {}) {
  const errs = [];
  const who = (o && o.id) || '?';
  const e = m => errs.push(`${who}: ${m}`);
  if (!o || typeof o.id !== 'string' || !ID_RE.test(o.id) || o.id.length > 40) { e('id لازم حروف إنجليزي صغيرة وأرقام بس.'); return errs; }
  if (!text(o.name, LIMITS.name)) e('الاسم فاضي.');
  if (o.from != null) {
    // P5: the day is a person's day in the registry (its date and source come from there)
    if (!linkOk(o.from, people)) e('«من يوم شخص»: الشخص أو اليوم مش موجود في السجل.');
    if (o.coptic != null || o.gregorian != null || o.date != null || o.repeat === 'once') e('«من يوم شخص»: التاريخ بييجي من السجل، من غير تاريخ تاني.');
    if (o.source != null && o.source !== OWNER && (typeof o.source !== 'string' || !URL_RE.test(o.source))) e('المصدر لازم رابط https.');
    if (!optText(o.note, LIMITS.note)) e('الملحوظة طويلة.');
  } else checkDay(o, e, { occasion: true });
  if (o.type != null && !OCC_TYPES.includes(o.type)) e(`النوع لازم ${OCC_TYPES.join(' أو ')}.`);
  if (o.look != null && !OCC_LOOKS.includes(o.look)) e(`الشكل لازم ${OCC_LOOKS.join(' أو ')}.`);
  if (!optText(o.badge, LIMITS.badge) || !optText(o.honor, LIMITS.badge)) e('العلامة أو اللقب طويل.');
  if (!optText(o.headline, LIMITS.headline)) e(`العنوان طويل (لحد ${LIMITS.headline} حرف).`);
  if (!optText(o.lead, LIMITS.lead)) e(`الكلام طويل (لحد ${LIMITS.lead} حرف).`);
  if (o.covers != null && (!Array.isArray(o.covers) || o.covers.length > LIMITS.covers || !o.covers.every(c => linkOk(c, people)))) e('«بتغطّي»: يوم شخص مش موجود في السجل.');
  if (o.people != null && (!Array.isArray(o.people) || o.people.length > LIMITS.covers || !o.people.every(id => typeof id === 'string' && ID_RE.test(id) && (!people || people.some(p => p.id === id))))) e('الأشخاص: حد مش موجود في السجل.');
  if (o.pictures != null) {
    if (!Array.isArray(o.pictures) || o.pictures.length > LIMITS.pictures) e(`الصور لازم قايمة (لحد ${LIMITS.pictures}).`);
    for (const x of Array.isArray(o.pictures) ? o.pictures : []) {
      if (!x || typeof x.media !== 'string' || !MEDIA_RE.test(x.media)) e('الصور لازم من مكتبة الصور (media/YYYY/…).');
      if (x && x.person != null && (typeof x.person !== 'string' || !ID_RE.test(x.person))) e('صورة: الشخص مش مفهوم.');
      if (x && !optText(x.caption, LIMITS.caption)) e('صورة: الوصف طويل.');
    }
  }
  return errs;
}

/* every problem in the registry, as plain sentences (empty = fine) */
export function check(reg, opts = {}) {
  const errs = [];
  if (!reg || reg.schema !== 2 || !Array.isArray(reg.people)) return ['الملف مش بالشكل المتوقع (schema 2, people[]).'];
  const cats = reg.categories || {};
  const ids = new Set();
  for (const p of reg.people) {
    const pe = checkPerson(p, { ...opts, cats });
    errs.push(...pe);
    if (p && typeof p.id === 'string') { if (ids.has(p.id)) errs.push(`${p.id}: id متكرر.`); ids.add(p.id); }
  }
  if (reg.occasions != null && !Array.isArray(reg.occasions)) errs.push('occasions لازم قايمة.');
  for (const o of reg.occasions || []) {
    errs.push(...checkOccasion(o, { people: reg.people }));
    if (o && typeof o.id === 'string') { if (ids.has(o.id)) errs.push(`${o.id}: id متكرر.`); ids.add(o.id); }
  }
  return errs;
}

/* is this day on this calendar day? (6 النسيء in a year that has only 5 → kept on 5 النسيء; «once»: its own date) */
export function isOn(f, day) {
  if (f.repeat === 'once') return f.date === day.date;
  if (f.gregorian) return f.gregorian === day.date.slice(5);
  const [m, d] = f.coptic.split('-').map(Number);
  return day.m === m && (day.d === d || (m === 13 && d === 6 && day.d === 5 && monthDays(day.y, 13) === 5));
}

/*
 * The feasts of a Gregorian month for the «النهارده تذكار…» card: [{ date, coptic, person, feast, others }] — one a
 * day, the first in the registry's order; `others` = the other people that day. Reposed people with a day only.
 */
export function feastsOfMonth(reg, ym) {
  const people = reg.people.filter(p => p.class !== 'living' && scheduled(p));
  const out = [];
  for (const day of daysOfMonth(ym)) {
    const hits = [];
    for (const p of people) {
      const f = p.feasts.find(x => isOn(x, day));
      if (f) hits.push({ person: p, feast: f });
    }
    if (hits.length) out.push({ date: day.date, coptic: { m: day.m, d: day.d }, person: hits[0].person, feast: hits[0].feast, others: hits.slice(1).map(h => h.person.name) });
  }
  return out;
}

/*
 * P4: the picture of a person's day on the card — { img: '/media/…', ai } | null (then the person's old `image`, if any).
 * The owner's rule (P3 approval, 2026-11-24): the pictures of THIS occasion (feast kind) first, else the main one, else
 * the first; several for the same occasion take turns, one a year. ai = «صورة تعبيرية» (AI or painted, labelOf).
 */
export const labelOf = a => !!a && (a.type === 'ai' || a.type === 'art');
export function pictureFor(p, kind, year) {
  const al = (p && Array.isArray(p.album) ? p.album : []).filter(a => a && a.media);
  if (!al.length) return null;
  const same = al.filter(a => kind && a.occasion === kind);
  const pool = same.length ? same : [al.find(a => a.main) || al[0]];
  const a = pool[((Number(year) || 0) % pool.length + pool.length) % pool.length];
  return { img: '/' + a.media, ai: labelOf(a) };
}

/* «مناسبات كنيستنا» of a Gregorian month (P5/P6): living fathers' days and the church's own days, in date order */
export function occasionsOfMonth(reg, ym) {
  const people = reg.people.filter(p => p.class === 'living' && scheduled(p));
  const out = [];
  for (const day of daysOfMonth(ym)) {
    for (const p of people) for (const f of p.feasts) if (isOn(f, day)) out.push({ date: day.date, coptic: { m: day.m, d: day.d }, person: p, occasion: f });
    for (const o of reg.occasions || []) { const f = dayOfOccasion(reg, o); if (f && isOn(f, day)) out.push({ date: day.date, coptic: { m: day.m, d: day.d }, person: null, occasion: o }); }
  }
  return out;
}

/*
 * The published file (daily-bread/data/saints.json, P3): what the site and the monthly suggestion need. Never the
 * internal parts: pending and its notes, the owner's file names (album src), picture credits, the biography
 * sources, notes, milestones not yet confirmed. Album pictures only once they are in the media library (P4).
 */
export function publicFile(reg) {
  const day = f => {
    const o = { kind: f.kind };
    if (f.coptic) o.coptic = f.coptic; else if (f.gregorian) o.gregorian = f.gregorian;
    if (f.year != null) o.year = f.year;
    if (f.title) o.title = f.title;
    if (f.word) o.word = f.word;
    o.source = f.source;
    return o;
  };
  const people = reg.people.map(p0 => {
    const p = withStatus(p0);
    const o = { id: p.id, name: p.name, cat: p.cat, class: p.class, status: p.status, missing: p.missing, feasts: p.feasts.map(day) };
    const ms = (p.milestones || []).filter(m => m.status === 'confirmed' || m.status === 'film').map(m => {
      const x = { kind: m.kind };
      for (const k of ['date', 'month', 'year', 'until']) if (m[k] != null) x[k] = m[k];
      x.source = m.source;
      return x;
    });
    if (ms.length) o.milestones = ms;
    const album = (p.album || []).filter(a => a.media).map(a => {
      const x = { media: a.media, type: a.type };
      for (const k of ['main', 'stage', 'occasion', 'caption', 'crop']) if (a[k] != null) x[k] = a[k];
      return x;
    });
    if (album.length) o.album = album;
    if (p.praise) {
      o.praise = { text: p.praise.text, source: p.praise.source, ...(p.praise.title ? { title: p.praise.title } : {}) };
      if (p.praise.refrain) o.praise.refrain = p.praise.refrain;
      if (Array.isArray(p.praise.verses)) o.praise.verses = p.praise.verses;
    }
    const sung = confirmedPraises(p).map(q => { const x = { id: q.id, type: q.type, title: q.title, source: q.source }; for (const k of ['main', 'days', 'context', 'author']) if (q[k] != null) x[k] = q[k]; return x; });
    if (sung.length) o.praises = sung;
    if (p.image) o.image = { file: p.image.file, source: p.image.source };
    if (p.word) o.word = p.word;
    return o;
  });
  const occasions = (reg.occasions || []).map(o => {
    const x = { id: o.id, name: o.name };
    if (o.kind) x.kind = o.kind;
    if (o.from) x.from = { person: o.from.person, feast: o.from.feast };
    else if (o.repeat === 'once') { x.repeat = 'once'; x.date = o.date; } else { if (o.coptic) x.coptic = o.coptic; else x.gregorian = o.gregorian; if (o.year != null) x.year = o.year; }
    if (o.source) x.source = o.source;
    for (const k of ['type', 'look', 'badge', 'honor', 'headline', 'lead', 'covers', 'people', 'pictures']) if (o[k] != null) x[k] = o[k];
    return x;
  });
  return { schema: 2, categories: reg.categories, people, occasions };
}

/* ======================================================================================================
 * P5 — «مناسبات كنيستنا» (docs/daily-bread/saints/P5-PLAN.md). The rules shared by the Worker (the published file),
 * the tools and the tests; the member page keeps the same day rule (assets/js/bread/occasions.js).
 * ====================================================================================================== */

/* the day an occasion keeps: its own, or (from) the person's day in the registry, with that day's source */
export function dayOfOccasion(reg, o) {
  if (!o || !o.from) return o;
  const p = (reg.people || []).find(x => x.id === o.from.person);
  const f = p && (p.feasts || []).find(x => x.kind === o.from.feast);
  return f ? { ...f, source: o.source || f.source } : null;
}
/* the people's days a card stands for: [[person, feast]…], never shown again that day (not in «نحب نفكّرك») */
export const hidesOf = o => [...(o.from ? [[o.from.person, o.from.feast]] : []), ...(o.covers || []).map(c => [c.person, c.feast])];
/* a living father's day that no occasion is linked to: a plain card, so nobody's day is lost */
export const autoOccasion = (p, f, i) => ({ id: 'auto' + p.id + i, auto: true, name: p.name, type: 'fathers', from: { person: p.id, feast: f.kind }, headline: `النهارده ${f.kind}`, people: [p.id] });

function withAutos(reg) {
  const linked = new Set((reg.occasions || []).flatMap(hidesOf).map(h => h.join('|')));
  const autos = (reg.people || []).filter(p => p.class === 'living' && scheduled(withStatus(p)))
    .flatMap(p => p.feasts.map((f, i) => (linked.has(p.id + '|' + f.kind) ? null : autoOccasion(p, f, i))).filter(Boolean));
  return [...(reg.occasions || []), ...autos];
}

/* the occasions of one Cairo day ('YYYY-MM-DD'), in the registry's order: the first leads the one card (P6 reads this too) */
export function occasionsOn(reg, date) {
  const c = toCoptic(date);
  const day = { date, y: c.y, m: c.m, d: c.d };
  return withAutos(reg).filter(o => { const f = dayOfOccasion(reg, o); return !!f && isOn(f, day); });
}

/*
 * The published «مناسبات كنيستنا» file (daily-bread/data/occasions.json): what the member page needs, nothing
 * internal — every occasion with its day resolved, its people's names, its pictures from the albums, what it hides;
 * and the two patrons (our church's, our family's) with their days and their full praise.
 */
export function occasionsFile(reg) {
  const people = new Map((reg.people || []).map(p => [p.id, p]));
  const albumOf = media => { for (const p of people.values()) { const a = (p.album || []).find(x => x.media === media); if (a) return a; } return null; };
  const pic = x => {
    const a = albumOf(x.media);
    const o = { img: '/' + x.media, ai: labelOf(a) };
    if (a && a.crop) o.crop = a.crop;
    const cap = x.caption || (a && a.caption);
    if (cap) o.caption = cap;
    return o;
  };
  const dayOut = f => {
    const o = {};
    if (f.repeat === 'once') { o.repeat = 'once'; o.date = f.date; } else if (f.coptic) o.coptic = f.coptic; else o.gregorian = f.gregorian;
    if (f.year != null) o.year = f.year;
    return o;
  };
  const occasions = withAutos(reg).map(o => {
    const f = dayOfOccasion(reg, o);
    if (!f) return null;
    const lead = o.from ? people.get(o.from.person) : (o.people || []).length === 1 ? people.get(o.people[0]) : null;
    const names = (o.people || (o.from ? [o.from.person] : [])).map(id => people.get(id)).filter(Boolean).map(p => p.name);
    let pictures = (o.pictures || []).map(pic);
    if (!pictures.length && lead) { const a = pictureFor(lead, f.kind, 0); if (a) pictures = [{ img: a.img, ai: a.ai }]; }
    const x = { id: o.id, type: o.type || 'church', headline: o.headline || o.name, who: lead ? (o.honor ? o.honor + ' ' : '') + lead.name : names.join(' و'), ...dayOut(f) };
    for (const k of ['look', 'badge', 'lead']) if (o[k]) x[k] = o[k];
    if (names.length > 1) x.names = names;
    if (pictures.length) x.pictures = pictures;
    if (f.source) x.source = f.source;
    if (o.from) x.from = [o.from.person, o.from.feast];
    // [person, day, name]: the name too, for a feasts file published before P5 (no person id in it)
    x.hides = hidesOf(o).map(([p, k]) => [p, k, (people.get(p) || {}).name || '']);
    return x;
  }).filter(Boolean);
  const patrons = {};
  for (const o of reg.occasions || []) {
    if ((o.type !== 'patron' && o.type !== 'family') || !o.from || patrons[o.type]) continue;
    const p = people.get(o.from.person);
    if (!p) continue;
    const a = (p.album || []).find(x => x.main && x.media) || (p.album || []).find(x => x.media);
    const x = { id: p.id, name: p.name, days: p.feasts.map(f => ({ kind: f.kind, ...dayOut(f) })) };
    if (a) { x.img = '/' + a.media; x.ai = labelOf(a); if (a.crop) x.crop = a.crop; }
    const sang = praiseFor(p, null);   // P5b: the person's main confirmed praise, else the legacy excerpt
    if (sang) {
      x.praise = { title: sang.title, text: praiseTeaser(sang), source: sang.source, id: sang.id, verses: sang.verses };
      if (sang.refrain) x.praise.refrain = sang.refrain;
    } else if (p.praise) {
      x.praise = { title: p.praise.title || '', text: p.praise.text, source: p.praise.source };
      if (p.praise.refrain) x.praise.refrain = p.praise.refrain;
      if (Array.isArray(p.praise.verses)) x.praise.verses = p.praise.verses;
    }
    patrons[o.type] = x;
  }
  return { schema: 1, types: OCC_TYPE_NAMES, occasions, patrons };
}

/* ======================================================================================================
 * P5b — the praises actually sung, and the words of each day (owner 2026-11-25)
 * ====================================================================================================== */

/* the confirmed praises of a person (with their text): the only ones the site ever shows */
export const confirmedPraises = p => (Array.isArray(p && p.praises) ? p.praises : []).filter(q => q && q.status === 'confirmed' && Array.isArray(q.verses) && q.verses.length);
/*
 * The praise of one of a person's days (iso: that day's date, for the seasons). A praise set for a season shows only in
 * it. In order: set for that day and in its season · set for that day · set for the season now · the main one · the
 * only one with nothing set; none → null (the card keeps the legacy excerpt, if any, as before).
 */
export function praiseFor(p, kind, iso) {
  const now = new Set(iso ? seasonsOn(iso) : []);
  const has = (q, k) => Array.isArray(q[k]) && q[k].length > 0;
  const seasonal = q => has(q, 'seasons') && q.seasons.some(s => now.has(s));
  const forDay = q => has(q, 'days') && q.days.includes(kind);
  const list = confirmedPraises(p).filter(q => !has(q, 'seasons') || seasonal(q));
  return list.find(q => forDay(q) && seasonal(q)) || list.find(forDay) || list.find(q => seasonal(q) && !has(q, 'days')) || list.find(q => q.main)
    || (list.length === 1 && !has(list[0], 'days') ? list[0] : null);
}
/* the card's short teaser of a praise: its first verse (and its response) */
export const praiseTeaser = q => [...q.verses[0], ...(q.refrain ? [q.refrain] : [])].join('\n');

/* daily-bread/data/praises.json: the confirmed praises' text, read only when «اقرا التمجيد كامل» is pressed */
export function praisesFile(reg) {
  const people = {};
  for (const p of reg.people || []) {
    const list = confirmedPraises(p).map(q => {
      const x = { id: q.id, type: q.type, title: q.title, source: q.source };
      for (const k of ['main', 'days', 'seasons', 'context', 'author', 'refrain']) if (q[k] != null) x[k] = q[k];
      x.verses = q.verses;
      return x;
    });
    if (list.length) people[p.id] = { name: p.name, praises: list };
  }
  return { schema: 1, people };
}
