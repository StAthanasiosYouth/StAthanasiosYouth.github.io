#!/usr/bin/env node
/*
 * «خبزنا اليومي» — the words of «نحب نفكّرك» for the saints' days, written by the owner's GPT (owner 2026-11-25:
 * «انتا هتديني برمت … اديه لgpt هو اليكتب الكلام»). This makes the prompts; tools/bread-texts-import.mjs reads GPT's
 * answer back.
 *
 *   node tools/bread-texts-prompt.mjs [--size=20]   → D:/private_projects/khobzna-work/p5b/prompts/batch-NN.md
 *
 * One self-contained file per batch (the rules + ~20 days): the owner pastes one into GPT, gets one JSON file back.
 * Each day carries only what the registry KNOWS (the published daily-bread/data/saints.json): the name, the day and
 * what it is, the Synaxarium's own title for it, the Coptic and Gregorian dates (computed here), the years and the
 * confirmed milestones. GPT is told never to add a date, a place or an event that is not there.
 * Days that a «مناسبات كنيستنا» card stands for are left out (the owner wrote those himself).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MONTHS } from '../worker/src/bread/coptic.js';
import { hidesOf, dayOfOccasion } from '../worker/src/bread/saints.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.P5B_DIR || 'D:/private_projects/khobzna-work/p5b';
const SIZE = Number((process.argv.find(a => a.startsWith('--size=')) || '--size=20').slice(7));
const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'daily-bread', 'data', 'saints.json'), 'utf8'));
const GM = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const AR = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);

const covered = new Set((reg.occasions || []).flatMap(hidesOf).map(([p, k]) => p + '|' + k));
const dayText = f => {
  if (f.coptic) { const [m, d] = f.coptic.split('-').map(Number); return `${AR(d)} ${MONTHS[m - 1]} (بالتقويم القبطي)`; }
  const [m, d] = f.gregorian.split('-').map(Number);
  return `${AR(d)} ${GM[m - 1]}${f.year ? ' ' + AR(f.year) : ''} (بالتقويم الميلادي)`;
};
const msText = m => `${m.kind}${m.date ? ' (' + m.date + ')' : m.month ? ' (' + m.month + ')' : m.year ? ' (' + m.year + (m.until ? '–' + m.until : '') + ')' : ''}`;

const items = [];
for (const p of reg.people) {
  if (p.class === 'living' || !p.feasts.length) continue;
  for (const f of p.feasts) {
    if (covered.has(p.id + '|' + f.kind)) continue;
    items.push({
      id: p.id, kind: f.kind, name: p.name, group: reg.categories[p.cat] || '',
      day: dayText(f), title: f.title || '', year: f.year || null,
      others: p.feasts.filter(x => x !== f).map(x => x.kind),
      milestones: (p.milestones || []).map(msText)
    });
  }
}

const RULES = `أنا خادم في «أسرة البابا أثناسيوس الرسولي للشباب» بكنيسة الشهيد العظيم أبي سيفين بسفاجا (إيبارشية البحر الأحمر، الكنيسة القبطية الأرثوذكسية).
عندنا على موقع الأسرة قسم اسمه «خبزنا اليومي»، وكل يوم فيه تذكار قديس أو شخصية كنسية بيظهر للشباب كارت اسمه «نحب نفكّرك».
عايزك تكتب الكلام اللي بيظهر في الكارت ده، لكل يوم من الأيام اللي تحت.

مين اللي هيقرا: شباب وخدام الأسرة (من ١٥ لـ٣٥ سنة تقريبًا)، على الموبايل غالبًا.

الأسلوب:
- عربي كنسي بسيط ودافي (فصحى سهلة، من غير تعقيد)، زي كلام المعايدة في الكنيسة.
- يبدأ بـ«في مثل هذا اليوم، الموافق [اليوم]، تحتفل كنيستنا بتذكار …» أو بداية قريبة منها.
- بعدها فقرة أو اتنين عن القديس والمناسبة، وبعدها تأمل قصير للشباب (فضيلة نتعلمها منه)، وبعدها صلاة أو طلب شفاعة قصير.
- آخر سطر معايدة قصيرة، زي «كل عام وأنتم بخير، وبشفاعة [الاسم] محفوظين.»
- الطول: من ٩٠ لـ١٦٠ كلمة. من ٣ لـ٥ فقرات قصيرة. من غير عناوين، ومن غير نقط أو ترقيم.
- من غير إيموجي.

قواعد مهمة جدًا:
- متكتبش أي تاريخ، أو سنة، أو مكان، أو اسم شخص، أو حدث، مش مكتوب في المعلومات اللي جنب كل يوم، إلا لو حاجة مشهورة جدًا ومعروفة في السنكسار القبطي عن القديس ده بالذات وإنت متأكد منها 100%. لو مش متأكد، اكتب تأمل روحي عام بدل المعلومة.
- اليوم القبطي مكتوب جنب كل يوم: استعمله زي ما هو.
- متخلطش بين قديسين ليهم نفس الاسم (فيه أكتر من أنبا مكاريوس وأكتر من أثناسيوس، وهكذا).
- المناسبة (نياحته، استشهاده، تذكار رسامته، نقل جسده…) لازم تبان في الكلام.
- لو الشخص قمص أو أب كاهن معاصر متنيح، متقولش عليه «القديس» إلا لو اسمه في الخانة مكتوب بيها.

شكل الرد (مهم):
- رجّعلي الرد كملف JSON واحد أقدر أحمّله، اسمه khobzna-texts-batch-{N}.json
- الملف = قايمة (array)، عنصر لكل يوم، بنفس ترتيب الأيام اللي تحت، وكل عنصر بالشكل ده بالظبط:
  {"id": "...", "kind": "...", "text": "..."}
- انقل id و kind زي ما هما بالحرف من المعلومات. text = الكلام، والفقرات بينها سطر فاضي (\\n\\n).
- متضيفش أي مفاتيح تانية، ومتسيبش أي يوم.`;

fs.mkdirSync(path.join(OUT, 'prompts'), { recursive: true });
const batches = [];
for (let i = 0; i < items.length; i += SIZE) batches.push(items.slice(i, i + SIZE));
batches.forEach((b, k) => {
  const n = String(k + 1).padStart(2, '0');
  const list = b.map((x, i) => [
    `${AR(i + 1)}) id: ${x.id} | kind: ${x.kind}`,
    `   الاسم: ${x.name}${x.group ? ' — ' + x.group : ''}`,
    `   المناسبة: ${x.kind}، يوم ${x.day}${x.year ? '، سنة الحدث ' + AR(x.year) : ''}`,
    x.title ? `   عنوان اليوم في السنكسار: ${x.title}` : null,
    x.others.length ? `   أيامه التانية في السنة: ${x.others.join('، ')}` : null,
    x.milestones.length ? `   محطات مؤكدة من حياته: ${x.milestones.join('؛ ')}` : null
  ].filter(Boolean).join('\n')).join('\n\n');
  fs.writeFileSync(path.join(OUT, 'prompts', `batch-${n}.md`), `${RULES.replace('{N}', n)}\n\nالدفعة ${AR(k + 1)} من ${AR(batches.length)} — ${AR(b.length)} يوم:\n\n${list}\n`);
});
fs.writeFileSync(path.join(OUT, 'days.json'), JSON.stringify(items.map(x => ({ id: x.id, kind: x.kind, name: x.name })), null, 1));
console.log(`${items.length} days (left out: ${covered.size} that «مناسبات كنيستنا» stands for) → ${batches.length} batches in ${OUT}/prompts`);
