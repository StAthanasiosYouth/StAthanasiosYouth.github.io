/*
 * «خبزنا اليومي» — reading a Bible reference written by a servant in Excel.
 * (Moved from docs/daily-bread/prototype/refs.js in W2; parseRef behaves exactly as in the prototype.)
 *
 *   parseRef('يو ٦: ٣٢-٣٥') → { ok: true, book: 'JHN', name: 'يوحنا', ch: 6, from: 32, to: 35, text: 'يوحنا ٦: ٣٢–٣٥' }
 *   parseRef('يوحنا 30: 1')  → { ok: false, error: 'يوحنا فيه ٢١ أصحاح بس' }
 *
 * Accepts Arabic or Western digits, ":" or "،" between chapter and verse, "-" "–" "إلى" for a range,
 * a range across chapters ("متى 5: 1 - 6: 4"), with or without «سفر/إنجيل/رسالة», with or without «ال», and the common
 * short names (مت، مر، لو، يو، أع، رو، 1كو…).
 *
 * The verses are then checked against the verified Van Dyck book file (assets/bible/vd/<BOOK>.json, built by
 * tools/build-bible.mjs): checkRef(ref, book) and versesOf(ref, book). Nothing on the site loads these yet (W4/W5).
 */
export const BOOKS = [
  ['GEN', 'التكوين', 50, 'تك'], ['EXO', 'الخروج', 40, 'خر'], ['LEV', 'اللاويين', 27, 'لا'], ['NUM', 'العدد', 36, 'عد'], ['DEU', 'التثنية', 34, 'تث'],
  ['JOS', 'يشوع', 24, 'يش'], ['JDG', 'القضاة', 21, 'قض'], ['RUT', 'راعوث', 4, 'را'], ['1SA', 'صموئيل الأول', 31, '1صم'], ['2SA', 'صموئيل الثاني', 24, '2صم'],
  ['1KI', 'الملوك الأول', 22, '1مل'], ['2KI', 'الملوك الثاني', 25, '2مل'], ['1CH', 'أخبار الأيام الأول', 29, '1أخ'], ['2CH', 'أخبار الأيام الثاني', 36, '2أخ'],
  ['EZR', 'عزرا', 10, 'عز'], ['NEH', 'نحميا', 13, 'نح'], ['EST', 'أستير', 10, 'أس'], ['JOB', 'أيوب', 42, 'أي'], ['PSA', 'المزامير', 150, 'مز', 'مزمور'],
  ['PRO', 'الأمثال', 31, 'أم'], ['ECC', 'الجامعة', 12, 'جا'], ['SNG', 'نشيد الأنشاد', 8, 'نش'], ['ISA', 'إشعياء', 66, 'إش'], ['JER', 'إرميا', 52, 'إر'],
  ['LAM', 'مراثي إرميا', 5, 'مرا'], ['EZK', 'حزقيال', 48, 'حز'], ['DAN', 'دانيال', 12, 'دا'], ['HOS', 'هوشع', 14, 'هو'], ['JOL', 'يوئيل', 3, 'يؤ'],
  ['AMO', 'عاموس', 9, 'عا'], ['OBA', 'عوبديا', 1, 'عو'], ['JON', 'يونان', 4, 'يون'], ['MIC', 'ميخا', 7, 'مي'], ['NAM', 'ناحوم', 3, 'نا'], ['HAB', 'حبقوق', 3, 'حب'],
  ['ZEP', 'صفنيا', 3, 'صف'], ['HAG', 'حجي', 2, 'حج'], ['ZEC', 'زكريا', 14, 'زك'], ['MAL', 'ملاخي', 4, 'ملا'],
  ['MAT', 'متى', 28, 'مت'], ['MRK', 'مرقس', 16, 'مر'], ['LUK', 'لوقا', 24, 'لو'], ['JHN', 'يوحنا', 21, 'يو'], ['ACT', 'أعمال الرسل', 28, 'أع', 'أعمال'],
  ['ROM', 'رومية', 16, 'رو'], ['1CO', 'كورنثوس الأولى', 16, '1كو'], ['2CO', 'كورنثوس الثانية', 13, '2كو'], ['GAL', 'غلاطية', 6, 'غل'], ['EPH', 'أفسس', 6, 'أف'],
  ['PHP', 'فيلبي', 4, 'في'], ['COL', 'كولوسي', 4, 'كو'], ['1TH', 'تسالونيكي الأولى', 5, '1تس'], ['2TH', 'تسالونيكي الثانية', 3, '2تس'],
  ['1TI', 'تيموثاوس الأولى', 6, '1تي'], ['2TI', 'تيموثاوس الثانية', 4, '2تي'], ['TIT', 'تيطس', 3, 'تي'], ['PHM', 'فليمون', 1, 'فل'], ['HEB', 'العبرانيين', 13, 'عب'],
  ['JAS', 'يعقوب', 5, 'يع'], ['1PE', 'بطرس الأولى', 5, '1بط'], ['2PE', 'بطرس الثانية', 3, '2بط'], ['1JN', 'يوحنا الأولى', 5, '1يو'], ['2JN', 'يوحنا الثانية', 1, '2يو'],
  ['3JN', 'يوحنا الثالثة', 1, '3يو'], ['JUD', 'يهوذا', 1, 'يه'], ['REV', 'الرؤيا', 22, 'رؤ', 'سفر الرؤيا']
];

const ar = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
const digits = s => s.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
// one spelling for matching: no tashkeel/tatweel, أإآ→ا, ة→ه, ى→ي, no leading «ال», ordinals → 1/2/3
export function norm(s) {
  return digits(String(s)).replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/^(سفر|انجيل|رساله|بشاره)\s+/, '').replace(/\s+(الاولي|الاول)$/, '1').replace(/\s+(الثانيه|الثاني)$/, '2').replace(/\s+(الثالثه)$/, '3')
    .replace(/^(\d)\s*/, '$1').replace(/(^|\s)ال/g, '$1').replace(/\s+/g, '');
}
const INDEX = new Map();
for (const [code, name, chapters, ...alias] of BOOKS) {
  const entry = { code, name, chapters };
  for (const n of [name, ...alias]) INDEX.set(norm(n), entry);
  // «يوحنا الأولى» also written «1 يوحنا»
  const m = /^(.+)\s(الأول|الأولى|الثاني|الثانية|الثالثة)$/.exec(name);
  if (m) INDEX.set(norm(m[2].startsWith('الثالث') ? '3' + m[1] : (m[2].startsWith('الأول') ? '1' : '2') + m[1]), entry);
}
INDEX.set(norm('مزمور'), INDEX.get(norm('المزامير')));

export function parseRef(input) {
  const raw = digits(String(input || '')).trim().replace(/[：،,]/g, ':').replace(/\s*(?:–|—|إلى|الى)\s*/g, '-');
  if (!raw) return { ok: false, error: 'فاضي' };
  const m = /^(.+?)\s*(\d+)\s*:\s*(\d+)(?:\s*-\s*(?:(\d+)\s*:\s*)?(\d+))?$/.exec(raw);
  if (!m) return { ok: false, error: 'مش مفهوم. اكتبه كده: يوحنا ٦: ٣٢-٣٥' };
  const book = INDEX.get(norm(m[1]));
  if (!book) return { ok: false, error: `اسم السفر «${m[1].trim()}» مش معروف` };
  const ch = +m[2], from = +m[3], ch2 = m[4] ? +m[4] : ch, to = m[5] ? +m[5] : from;
  if (ch < 1 || ch > book.chapters || ch2 > book.chapters) return { ok: false, error: `${book.name} فيه ${ar(book.chapters)} أصحاح بس` };
  if (ch2 < ch || (ch2 === ch && to < from)) return { ok: false, error: 'نهاية القراءة قبل بدايتها' };
  const shown = book.code === 'PSA' ? 'مزمور' : book.name;
  const text = `${shown} ${ar(ch)}: ${ar(from)}${ch2 !== ch ? `–${ar(ch2)}: ${ar(to)}` : to !== from ? `–${ar(to)}` : ''}`;
  return { ok: true, book: book.code, name: book.name, ch, from, ch2, to, text, psalm: book.code === 'PSA' };
}

/*
 * Verse checks against a Van Dyck book file: { id, chapters: [[verse1, verse2, …], …] }.
 * parseRef only knows how many chapters a book has; this knows how many verses each chapter has.
 */
export function checkRef(ref, book) {
  if (!ref || !ref.ok) return ref || { ok: false, error: 'فاضي' };
  if (!book || book.id !== ref.book || !Array.isArray(book.chapters)) return { ok: false, error: 'ملف السفر مش مطابق للمرجع' };
  const shown = ref.book === 'PSA' ? 'مزمور' : ref.name;
  if (ref.from < 1 || ref.to < 1) return { ok: false, error: 'رقم العدد لازم يبدأ من ١' };
  for (const [ch, v] of [[ref.ch, ref.from], [ref.ch2, ref.to]]) {
    const verses = book.chapters[ch - 1];
    if (!verses) return { ok: false, error: `${ref.name} فيه ${ar(book.chapters.length)} أصحاح بس` };
    if (v > verses.length) return { ok: false, error: `${shown} ${ar(ch)} آخره عدد ${ar(verses.length)}` };
  }
  return { ok: true };
}

/* the reading's verses in order: [{ ch, v, text }]. Throws if the reference does not pass checkRef. */
export function versesOf(ref, book) {
  const check = checkRef(ref, book);
  if (!check.ok) throw new Error(check.error);
  const out = [];
  for (let ch = ref.ch; ch <= ref.ch2; ch++) {
    const verses = book.chapters[ch - 1];
    const first = ch === ref.ch ? ref.from : 1, last = ch === ref.ch2 ? ref.to : verses.length;
    for (let v = first; v <= last; v++) out.push({ ch, v, text: verses[v - 1] });
  }
  return out;
}

/*
 * Link to the same chapter on St-Takla.org (the church's review reference). Links only: nothing is copied from there.
 * Their book numbers count the deuterocanonical books too (Tobit 17, Judith 18, Wisdom 27, Sirach 28, Baruch 32,
 * Psalm 151 = 23, Maccabees 48–49), so the 66 books are not 1–66. Checked against their page titles 2026-11-17.
 */
const TAKLA = {
  GEN: 1, EXO: 2, LEV: 3, NUM: 4, DEU: 5, JOS: 6, JDG: 7, RUT: 8, '1SA': 9, '2SA': 10, '1KI': 11, '2KI': 12, '1CH': 13, '2CH': 14,
  EZR: 15, NEH: 16, EST: 19, JOB: 21, PSA: 22, PRO: 24, ECC: 25, SNG: 26, ISA: 29, JER: 30, LAM: 31, EZK: 33, DAN: 34,
  HOS: 36, JOL: 37, AMO: 38, OBA: 39, JON: 40, MIC: 41, NAM: 42, HAB: 43, ZEP: 44, HAG: 45, ZEC: 46, MAL: 47
};
BOOKS.slice(39).forEach(([code], i) => { TAKLA[code] = 50 + i; });
export function taklaUrl(code, ch) {
  const n = TAKLA[code];
  return n ? `https://st-takla.org/Bibles/BibleSearch/showChapter.php?book=${n}&chapter=${ch}` : null;
}

/* the template's columns (one row = one day's topic). Scripture text is NOT a column: it comes from the verified file. */
export const COLUMNS = ['رقم', 'العنوان', 'مرجع الآية', 'مرجع القراءة', 'التأمل', 'السؤال (اختياري)'];
