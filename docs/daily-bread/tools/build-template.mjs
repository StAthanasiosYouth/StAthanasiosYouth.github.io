// The Excel template the admin downloads (same book the prototype's button writes), saved for the study.
// Usage: node docs/daily-bread/tools/build-template.mjs → docs/daily-bread/template/khobzna-template.xlsx
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const { writeXlsx } = await import(pathToFileURL(join(ROOT, 'admin', 'xlsx.js')).href);
const { COLUMNS } = await import(pathToFileURL(join(HERE, '..', 'prototype', 'refs.js')).href);
const { TOPICS } = await import(pathToFileURL(join(HERE, '..', 'prototype', 'data.js')).href);

const book = {
  sheets: [
    { name: 'البرنامج', rtl: true, header: true, widths: [7, 26, 20, 24, 60, 40], textColumns: [2, 3],
      rows: [COLUMNS, ...TOPICS.slice(0, 3).map((t, i) => [i + 1, t.title, t.verseRef, t.readingRef, t.meditation, t.question])] },
    { name: 'إزاي تملاه', rtl: true, widths: [100],
      rows: [['إزاي تملا النموذج'],
        ['كل صف = يوم واحد. عدد الصفوف = مدة البرنامج (٧ أو ٣٠ أو ٦٠ أو ٩٠ أو أي عدد لحد ١٢٠).'],
        ['العنوان: اسم موضوع اليوم، قصير.'],
        ['مرجع الآية: الآية اللي هتظهر كبيرة. مثال: يوحنا ٦: ٣٥ أو يو 6:35'],
        ['مرجع القراءة: القراءة الكاملة. مثال: يوحنا ٦: ٣٢-٣٥ أو متى 5: 1 - 6: 4 (من أصحاح لأصحاح)'],
        ['متكتبش نص الآية: الموقع بيجيبه من ترجمة فاندايك المعتمدة.'],
        ['التأمل: فقرة قصيرة من كتابة خدام الأسرة. لو منقول من كتاب، اكتب المصدر في آخره.'],
        ['السؤال: اختياري، ممكن يتساب فاضي.'],
        ['المزامير بترقيم فاندايك (العبري). مزمور ٢٣ = مزمور ٢٢ في الأجبية.'],
        ['الأسماء المختصرة المقبولة: مت، مر، لو، يو، أع، رو، 1كو، 2كو، غل، أف، في، كو، عب، يع، 1بط، 1يو، رؤ، تك، خر، مز، أم، إش، إر…']] }
  ]
};
const out = join(HERE, '..', 'template', 'khobzna-template.xlsx');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, writeXlsx(book));
console.log('wrote', out);
