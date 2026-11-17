// «خبزنا اليومي» W2 — the Van Dyck text files (assets/bible/vd, built by tools/build-bible.mjs),
// the tashkeel / Agpeya helpers (assets/js/bread/text.js) and the reference parser (assets/js/bread/refs.js).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const { BOOKS, parseRef, checkRef, versesOf, taklaUrl } = await import('../assets/js/bread/refs.js');
const { stripTashkeel, agpeyaPsalm } = await import('../assets/js/bread/text.js');
const { parseUsfm, readZip } = await import('../tools/build-bible.mjs');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = `${ROOT}assets/bible/vd/`;
const raw = name => readFileSync(DIR + name, 'utf8');
const cache = new Map();
const book = code => cache.get(code) || cache.set(code, JSON.parse(raw(`${code}.json`))).get(code);
const verse = (code, ch, v) => book(code).chapters[ch - 1][v - 1];
const sha256 = s => createHash('sha256').update(s).digest('hex');

// ---------- the files ----------

test('all 66 books are there, and nothing else', () => {
  assert.equal(BOOKS.length, 66);
  const files = readdirSync(DIR).sort();
  assert.deepEqual(files, [...BOOKS.map(b => `${b[0]}.json`), 'SOURCE.json'].sort());
  for (const [code, name] of BOOKS) {
    assert.equal(book(code).id, code);
    assert.equal(book(code).name, name);
    assert.ok(book(code).title, `${code} has its Arabic title`);
  }
});

test('no deuterocanonical books (decision 5)', () => {
  for (const code of ['TOB', 'JDT', 'WIS', 'SIR', 'BAR', '1MA', '2MA', 'PS2']) assert.ok(!readdirSync(DIR).includes(`${code}.json`));
});

test('chapter count of every book', () => {
  // the standard Protestant / Van Dyck counts, written out here on purpose (not read from refs.js)
  const expected = {
    GEN: 50, EXO: 40, LEV: 27, NUM: 36, DEU: 34, JOS: 24, JDG: 21, RUT: 4, '1SA': 31, '2SA': 24, '1KI': 22, '2KI': 25,
    '1CH': 29, '2CH': 36, EZR: 10, NEH: 13, EST: 10, JOB: 42, PSA: 150, PRO: 31, ECC: 12, SNG: 8, ISA: 66, JER: 52,
    LAM: 5, EZK: 48, DAN: 12, HOS: 14, JOL: 3, AMO: 9, OBA: 1, JON: 4, MIC: 7, NAM: 3, HAB: 3, ZEP: 3, HAG: 2, ZEC: 14, MAL: 4,
    MAT: 28, MRK: 16, LUK: 24, JHN: 21, ACT: 28, ROM: 16, '1CO': 16, '2CO': 13, GAL: 6, EPH: 6, PHP: 4, COL: 4, '1TH': 5,
    '2TH': 3, '1TI': 6, '2TI': 4, TIT: 3, PHM: 1, HEB: 13, JAS: 5, '1PE': 5, '2PE': 3, '1JN': 5, '2JN': 1, '3JN': 1, JUD: 1, REV: 22
  };
  assert.equal(Object.keys(expected).length, 66);
  for (const [code, n] of Object.entries(expected)) {
    assert.equal(book(code).chapters.length, n, code);
    assert.equal(BOOKS.find(b => b[0] === code)[2], n, `refs.js ${code}`);
  }
});

test('verse counts of some chapters, and the total', () => {
  const counts = { 'PSA 119': 176, 'PSA 117': 2, 'PSA 23': 6, 'JHN 21': 25, 'JHN 3': 36, 'MAL 4': 6, 'JOL 3': 21, '3JN 1': 15, 'OBA 1': 21, 'GEN 1': 31, 'REV 22': 21 };
  for (const [key, n] of Object.entries(counts)) {
    const [code, ch] = key.split(' ');
    assert.equal(book(code).chapters[ch - 1].length, n, key);
  }
  const total = BOOKS.reduce((a, [c]) => a + book(c).chapters.reduce((s, ch) => s + ch.length, 0), 0);
  assert.equal(total, 31104);
});

test('known verses, exact with tashkeel', () => {
  // compared in NFC: the source writes some marks in a different (non-canonical) order, e.g. shadda before fatha; same text
  const equal = (a, b) => assert.equal(a.normalize('NFC'), b.normalize('NFC'));
  equal(verse('GEN', 1, 1), 'فِي ٱلْبَدْءِ خَلَقَ ٱللهُ ٱلسَّمَاوَاتِ وَٱلْأَرْضَ.');
  equal(verse('JHN', 3, 16), 'لِأَنَّهُ هَكَذَا أَحَبَّ ٱللهُ ٱلْعَالَمَ حَتَّى بَذَلَ ٱبْنَهُ ٱلْوَحِيدَ، لِكَيْ لَا يَهْلِكَ كُلُّ مَنْ يُؤْمِنُ بِهِ، بَلْ تَكُونُ لَهُ ٱلْحَيَاةُ ٱلْأَبَدِيَّةُ.');
  equal(verse('JHN', 11, 35), 'بَكَى يَسُوعُ.');
  equal(verse('PSA', 23, 1), 'ٱلرَّبُّ رَاعِيَّ فَلَا يُعْوِزُنِي شَيْءٌ.');
  equal(verse('PHP', 4, 13), 'أَسْتَطِيعُ كُلَّ شَيْءٍ فِي ٱلْمَسِيحِ ٱلَّذِي يُقَوِّينِي.');
  equal(verse('REV', 22, 21), 'نِعْمَةُ رَبِّنَا يَسُوعَ ٱلْمَسِيحِ مَعَ جَمِيعِكُمْ. آمِينَ.');
  equal(verse('MAT', 6, 9), '«فَصَلُّوا أَنْتُمْ هَكَذَا: أَبَانَا ٱلَّذِي فِي ٱلسَّمَاوَاتِ، لِيَتَقَدَّسِ ٱسْمُكَ.');
});

test('known verses, as commonly printed without tashkeel', () => {
  assert.equal(stripTashkeel(verse('JHN', 3, 16)), 'لأنه هكذا أحب الله العالم حتى بذل ابنه الوحيد، لكي لا يهلك كل من يؤمن به، بل تكون له الحياة الأبدية.');
  assert.equal(stripTashkeel(verse('PSA', 51, 10)), 'قلبا نقيا اخلق في يا الله، وروحا مستقيما جدد في داخلي.');
  assert.equal(stripTashkeel(verse('ROM', 8, 28)), 'ونحن نعلم أن كل الأشياء تعمل معا للخير للذين يحبون الله، الذين هم مدعوون حسب قصده.');
  assert.equal(stripTashkeel(verse('ISA', 53, 5)), 'وهو مجروح لأجل معاصينا، مسحوق لأجل آثامنا. تأديب سلامنا عليه، وبحبره شفينا.');
});

test('psalm superscriptions and the Psalm 119 letters are kept; section headings are not', () => {
  const psa = book('PSA');
  assert.notEqual(stripTashkeel(psa.titles['3']), psa.titles['3'], 'titles keep their tashkeel');
  assert.match(stripTashkeel(psa.titles['3']), /^مزمور لداود حينما هرب من وجه أبشالوم ابنه/);
  assert.match(stripTashkeel(psa.titles['56']), /الحمامة البكماء.*مذهبة لداود/, 'two-line title kept whole');
  assert.equal(psa.titles['1'], undefined);
  assert.equal(psa.letters['119']['1'], 'أ');
  assert.equal(Object.keys(psa.letters['119']).length, 22);
  // the editorial heading «البدء» before Genesis 1 is not part of the text
  assert.ok(!raw('GEN.json').includes('البدء"'));
});

test('every verse is clean text', () => {
  for (const [code] of BOOKS) for (const [c, verses] of book(code).chapters.entries()) for (const [v, t] of verses.entries()) {
    assert.ok(t && t === t.trim() && !/[A-Za-z0-9\\|*‎‏]|\s{2}/.test(t), `${code} ${c + 1}:${v + 1}`);
  }
});

test('SOURCE.json records the source and matches every file', () => {
  const src = JSON.parse(raw('SOURCE.json'));
  assert.equal(src.source.url, 'https://ebible.org/Scriptures/arb-vd_usfm.zip');
  assert.equal(src.source.page, 'https://ebible.org/details.php?id=arb-vd');
  assert.match(src.source.sha256, /^[0-9a-f]{64}$/);
  assert.match(src.source.downloaded, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(src.license, /Public Domain/);
  assert.equal(Object.keys(src.books).length, 66);
  for (const [code, info] of Object.entries(src.books)) {
    // hashed as built (LF); a Windows checkout with core.autocrlf may hand us CRLF
    assert.equal(info.sha256, sha256(raw(`${code}.json`).replace(/\r\n/g, '\n')), `${code}.json changed after the build: run tools/build-bible.mjs again`);
    assert.match(info.usfm.sha256, /^[0-9a-f]{64}$/);
    assert.equal(info.chapters, book(code).chapters.length);
  }
});

// ---------- the builder's parser ----------

test('build: a small USFM book', () => {
  const usfm = '\\id OBA x\n\\h عُوبَدْيَا\n\\toc1 x\n\\mt1 x\n\\c 1\n\\s1 عنوان\n\\p\n\\v 1 رُؤْيَا   عُوبَدْيَا.‏\n\\v 2 إِنِّي\nقَدْ جَعَلْتُكَ.\n';
  const { book: b, headings } = parseUsfm(usfm, { code: 'OBA', name: 'عوبديا', chapters: 1 });
  assert.deepEqual(b, { id: 'OBA', name: 'عوبديا', title: 'عُوبَدْيَا', chapters: [['رُؤْيَا عُوبَدْيَا.', 'إِنِّي قَدْ جَعَلْتُكَ.']] });
  assert.equal(headings, 1);
});

test('build: refuses what it does not understand', () => {
  const base = '\\id OBA\n\\h x\n\\c 1\n\\p\n';
  const p = s => parseUsfm(base + s, { code: 'OBA', name: 'عوبديا', chapters: 1 });
  assert.throws(() => p('\\v 1 نص\n\\f + note\n'), /unknown USFM marker/);
  assert.throws(() => p('\\v 1 نص\n\\q1 + note\\f*\n'), /inline marker/);
  assert.throws(() => p('\\v 1 نص\n\\v 3 نص\n'), /verse 3 after 1/);
  assert.throws(() => p('\\v 1 text\n'), /unexpected characters/);
  assert.throws(() => p('\\v 1 نص \\w كلمة\\w*\n'), /inline marker/);
  assert.throws(() => parseUsfm(base + '\\v 1 نص\n', { code: 'OBA', name: 'عوبديا', chapters: 2 }), /1 chapters, refs.js says 2/);
  assert.throws(() => parseUsfm(base + '\\v 1 نص\n', { code: 'JON', name: 'يونان', chapters: 1 }), /expected JON/);
});

test('build: reads a zip in memory', () => {
  const entry = (name, data) => {
    const body = deflateRawSync(data), n = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28);
    return { local: Buffer.concat([local, n, body]), central, n };
  };
  const e = entry('a.usfm', Buffer.from('\\id OBA'));
  e.central.writeUInt32LE(0, 42);
  const cd = Buffer.concat([e.central, e.n]);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(e.local.length, 16);
  const files = readZip(Buffer.concat([e.local, cd, end]));
  assert.equal(files.get('a.usfm').toString(), '\\id OBA');
  assert.throws(() => readZip(Buffer.from('not a zip at all, just some bytes here')), /not a zip/);
});

// ---------- tashkeel (decision 4) and Agpeya numbers (decision 6) ----------

test('stripTashkeel hides the marks and keeps the letters', () => {
  assert.equal(stripTashkeel('فِي ٱلْبَدْءِ خَلَقَ ٱللهُ ٱلسَّمَاوَاتِ وَٱلْأَرْضَ.'), 'في البدء خلق الله السماوات والأرض.');
  assert.equal(stripTashkeel('بَكَى يَسُوعُ.'), 'بكى يسوع.');
  assert.equal(stripTashkeel('سَلَامٌ، وَرَحْمَةٌ؟ «آمِينَ»'), 'سلام، ورحمة؟ «آمين»');
  assert.equal(stripTashkeel('لا تشكيل'), 'لا تشكيل');
  assert.equal(stripTashkeel(''), '');
  assert.equal(stripTashkeel(null), '');
  // nothing left behind anywhere in the Bible
  for (const [code] of BOOKS) for (const ch of book(code).chapters) for (const t of ch) assert.ok(!/[ً-ٰٟٱ]/.test(stripTashkeel(t)), code);
});

test('Agpeya psalm number from the Van Dyck number', () => {
  const cases = [[1, 1], [8, 8], [9, 9], [10, 9], [11, 10], [23, 22], [51, 50], [113, 112], [114, 113], [115, 113], [117, 116], [119, 118], [146, 145], [148, 148], [150, 150]];
  for (const [vd, agpeya] of cases) assert.equal(agpeyaPsalm(vd), agpeya, `Psalm ${vd}`);
  assert.equal(agpeyaPsalm(116, 1), 114);
  assert.equal(agpeyaPsalm(116, 9), 114);
  assert.equal(agpeyaPsalm(116, 10), 115);
  assert.equal(agpeyaPsalm(147, 11), 146);
  assert.equal(agpeyaPsalm(147, 12), 147);
  assert.equal(agpeyaPsalm(0), null);
  assert.equal(agpeyaPsalm(151), null);
});

// ---------- the reference parser ----------

test('parser: full names, with and without سفر/إنجيل/ال', () => {
  for (const s of ['يوحنا 6: 32-35', 'إنجيل يوحنا 6:32-35', 'انجيل يوحنا ٦: ٣٢ - ٣٥']) {
    const r = parseRef(s);
    assert.equal(r.ok, true, s);
    assert.deepEqual([r.book, r.ch, r.from, r.ch2, r.to], ['JHN', 6, 32, 6, 35], s);
  }
  assert.equal(parseRef('سفر التكوين 1: 1').book, 'GEN');
  assert.equal(parseRef('تكوين 1: 1').book, 'GEN');
  assert.equal(parseRef('أعمال الرسل 2: 1-4').book, 'ACT');
  assert.equal(parseRef('رسالة رومية 8: 28').book, 'ROM');
  assert.equal(parseRef('كورنثوس الأولى 13: 4-7').book, '1CO');
  assert.equal(parseRef('1 كورنثوس 13: 4').book, '1CO');
  assert.equal(parseRef('يوحنا الأولى 4: 8').book, '1JN');
  assert.equal(parseRef('3 يوحنا 1: 2').book, '3JN');
  assert.equal(parseRef('إشعياء 53: 5').book, 'ISA');
  assert.equal(parseRef('اشعياء 53: 5').book, 'ISA');
  assert.equal(parseRef('مزمور 23: 1-6').book, 'PSA');
  assert.equal(parseRef('المزامير 23: 1').book, 'PSA');
});

test('parser: short names', () => {
  const cases = { 'مت 5: 1': 'MAT', 'مر 1: 1': 'MRK', 'لو 2: 10': 'LUK', 'يو 6: 35': 'JHN', 'أع 2: 1': 'ACT', 'رو 12: 1': 'ROM', '1كو 13: 4': '1CO',
    '2كو 5: 17': '2CO', 'في 4: 13': 'PHP', 'عب 11: 1': 'HEB', 'يع 1: 2': 'JAS', 'رؤ 21: 4': 'REV', 'تك 1: 1': 'GEN', 'مز 23: 1': 'PSA', 'إش 9: 6': 'ISA' };
  for (const [s, code] of Object.entries(cases)) assert.equal(parseRef(s).book, code, s);
});

test('parser: Arabic and Persian digits, Arabic comma, «إلى» and dashes', () => {
  assert.deepEqual(pick(parseRef('يو ٦: ٣٢-٣٥')), ['JHN', 6, 32, 6, 35]);
  assert.deepEqual(pick(parseRef('يو ۶: ۳۲-۳۵')), ['JHN', 6, 32, 6, 35]);
  assert.deepEqual(pick(parseRef('يو ٦، ٣٢ إلى ٣٥')), ['JHN', 6, 32, 6, 35]);
  assert.deepEqual(pick(parseRef('يو 6: 32–35')), ['JHN', 6, 32, 6, 35]);
  assert.deepEqual(pick(parseRef('يو 3: 16')), ['JHN', 3, 16, 3, 16]);
  assert.equal(parseRef('يو 6: 32-35').text, 'يوحنا ٦: ٣٢–٣٥');
  assert.equal(parseRef('مز 23: 1').text, 'مزمور ٢٣: ١');
  assert.equal(parseRef('مز 23: 1').psalm, true);
});

test('parser: a range across chapters', () => {
  const r = parseRef('متى 5: 1 - 6: 4');
  assert.deepEqual(pick(r), ['MAT', 5, 1, 6, 4]);
  assert.equal(r.text, 'متى ٥: ١–٦: ٤');
  const v = versesOf(r, book('MAT'));
  assert.equal(v.length, book('MAT').chapters[4].length + 4);
  assert.deepEqual([v[0].ch, v[0].v, v.at(-1).ch, v.at(-1).v], [5, 1, 6, 4]);
  assert.equal(v.at(-1).text, verse('MAT', 6, 4));
});

test('parser: errors', () => {
  assert.equal(parseRef('').ok, false);
  assert.equal(parseRef('').error, 'فاضي');
  assert.match(parseRef('يوحنا').error, /مش مفهوم/);
  assert.match(parseRef('كلام 3: 16').error, /اسم السفر «كلام» مش معروف/);
  assert.equal(parseRef('يوحنا 30: 1').error, 'يوحنا فيه ٢١ أصحاح بس');
  assert.equal(parseRef('مت 6: 4 - 5: 1').error, 'نهاية القراءة قبل بدايتها');
  assert.equal(parseRef('يو 6: 35-32').error, 'نهاية القراءة قبل بدايتها');
  assert.equal(parseRef('طوبيا 1: 1').ok, false, 'deuterocanonical books are not in the 66');
});

test('verse checks against the book file', () => {
  assert.deepEqual(checkRef(parseRef('يو 6: 32-35'), book('JHN')), { ok: true });
  assert.deepEqual(checkRef(parseRef('يو 6: 71'), book('JHN')), { ok: true });
  assert.equal(checkRef(parseRef('يو 6: 70-72'), book('JHN')).error, 'يوحنا ٦ آخره عدد ٧١');
  assert.equal(checkRef(parseRef('مز 23: 7'), book('PSA')).error, 'مزمور ٢٣ آخره عدد ٦');
  assert.equal(checkRef(parseRef('مت 5: 1 - 6: 40'), book('MAT')).error, 'متى ٦ آخره عدد ٣٤');
  assert.equal(checkRef(parseRef('يو 6: 0'), book('JHN')).error, 'رقم العدد لازم يبدأ من ١');
  assert.equal(checkRef(parseRef('يو 6: 1'), book('MAT')).ok, false, 'wrong book file');
  assert.equal(checkRef(parseRef('كلام 1: 1'), book('JHN')).ok, false, 'a parse error passes through');
  assert.throws(() => versesOf(parseRef('يو 6: 72'), book('JHN')), /آخره عدد/);
  const ps = versesOf(parseRef('مز 23: 1-6'), book('PSA'));
  assert.equal(ps.length, 6);
  assert.equal(ps[0].text, verse('PSA', 23, 1));
});

test('St-Takla chapter links (links only)', () => {
  assert.equal(taklaUrl('GEN', 1), 'https://st-takla.org/Bibles/BibleSearch/showChapter.php?book=1&chapter=1');
  assert.equal(taklaUrl('PSA', 23), 'https://st-takla.org/Bibles/BibleSearch/showChapter.php?book=22&chapter=23');
  assert.equal(taklaUrl('DAN', 3), 'https://st-takla.org/Bibles/BibleSearch/showChapter.php?book=34&chapter=3');
  assert.equal(taklaUrl('MAL', 4), 'https://st-takla.org/Bibles/BibleSearch/showChapter.php?book=47&chapter=4');
  assert.equal(taklaUrl('MAT', 5), 'https://st-takla.org/Bibles/BibleSearch/showChapter.php?book=50&chapter=5');
  assert.equal(taklaUrl('JHN', 6), 'https://st-takla.org/Bibles/BibleSearch/showChapter.php?book=53&chapter=6');
  assert.equal(taklaUrl('REV', 22), 'https://st-takla.org/Bibles/BibleSearch/showChapter.php?book=76&chapter=22');
  for (const [code] of BOOKS) assert.ok(taklaUrl(code, 1), code);
  assert.equal(taklaUrl('TOB', 1), null);
});

function pick(r) { return [r.book, r.ch, r.from, r.ch2, r.to]; }
