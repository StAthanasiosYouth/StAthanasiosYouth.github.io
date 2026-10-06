// Builds the reference example for docs/ADMIN-GUIDE.md:
//   docs/examples/content.example.json   what publishing produces
//   docs/examples/sheet.example.md       the same data as rows in the Sheet tabs
//
// It runs the real publish code (Content.gs + Hub.gs) on a realistic draft
// with a fixed "now", so the example always matches what the system does.
// Usage: node tools/build-example.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { loadGs, sha256, ROOT } from './lib/gs.mjs';

const gs = loadGs();

// Thursday 8 October 2026, 12:00 Cairo
const NOW = '2026-10-08T12:00';

const draft = JSON.parse(JSON.stringify(gs.seedDraft()));

draft.settings['meeting.durationMinutes'] = 120;

draft.media = [
  { id: 'img-topic011', path: 'media/2026/img-topic011.webp', thumb: 'media/2026/img-topic011-480.webp', width: 1200, height: 1500, alt: 'بوستر موضوع حياة التسليم', mime: 'image/webp' },
  { id: 'img-trip2026', path: 'media/2026/img-trip2026.webp', thumb: 'media/2026/img-trip2026-480.webp', width: 1200, height: 1500, alt: 'بوستر رحلة الغردقة', mime: 'image/webp' },
  { id: 'img-explore1', path: 'media/2026/img-explore1.webp', thumb: 'media/2026/img-explore1-480.webp', width: 1600, height: 900, alt: 'بوستر رحلة الاستكشاف في الكنيسة', mime: 'image/webp' }
];

draft.sessions = [
  {
    date: '2026-10-11', enabled: true, time: '', status: 'normal',
    topic: 'حياة التسليم', speaker: 'أبونا أنطوني عياد',
    description: 'إزاي نسلّم حياتنا لربنا في كل تفصيلة، من غير خوف ولا قلق.',
    image: 'img-topic011', note: '', visibleFrom: '2026-10-08 20:00'
  },
  {
    date: '2026-10-18', enabled: true, time: '', status: 'cancelled',
    topic: '', speaker: '', description: '', image: '', note: 'علشان مؤتمر الشباب', visibleFrom: ''
  }
];

draft.news = [
  {
    id: 'news-trip2026', enabled: true, featured: true, pinned: false, tone: 'info',
    title: 'رحلة الغردقة',
    summary: 'يوم كامل على البحر — سجّل اسمك قبل الخميس',
    body: 'الرحلة يوم الجمعة ١٦ أكتوبر.\nالتجمع ٧ الصبح عند الكنيسة.\n\nالاشتراك ٢٠٠ جنيه شاملة الأكل والمواصلات.',
    image: 'img-trip2026', linkUrl: 'https://forms.gle/your-form-id', linkLabel: 'سجّل هنا', badge: 'جديد',
    publishAt: '2026-10-08 20:00', expireAt: '2026-10-15'
  },
  {
    id: 'news-nomeeting18', enabled: true, featured: false, pinned: true, tone: 'alert',
    title: 'مفيش اجتماع الأحد ١٨ أكتوبر',
    summary: 'علشان مؤتمر الشباب — نتقابل الأحد اللي بعده',
    body: '', image: '', linkUrl: '', linkLabel: '', badge: '',
    publishAt: '2026-10-12 10:00', expireAt: '2026-10-18'
  }
];

draft.games = [
  {
    id: 'game-explore', enabled: true,
    title: 'رحلة الاستكشاف في الكنيسة',
    description: 'دوّر على الأماكن المخفية في الكنيسة وجاوب على الأسئلة قبل الوقت ما يخلص.',
    image: 'img-explore1',
    url: 'https://example.com/church-explorer',
    buttonLabel: 'ابدأ اللعب',
    visibleFrom: '2026-10-11 21:00',
    startAt: '2026-10-11 22:00',
    endAt: '2026-10-11 23:30',
    afterEnd: 'show'
  }
];

// what the checkboxes in the editors create
draft.notifications = [
  { id: 'notif-session-2026-10-11', enabled: true, type: 'meeting', title: 'موضوع الاجتماع الجاي', message: 'حياة التسليم — أبونا أنطوني عياد', target: 'meeting', image: 'img-topic011', publishAt: '2026-10-08 20:00', expireAt: '2026-10-11 23:59' },
  { id: 'notif-news-trip2026', enabled: true, type: 'news', title: 'رحلة الغردقة', message: 'يوم كامل على البحر — سجّل اسمك قبل الخميس', target: 'news:news-trip2026', image: 'img-trip2026', publishAt: '2026-10-08 20:00', expireAt: '2026-10-15' },
  { id: 'notif-game-explore-soon', enabled: true, type: 'game', title: 'استعدوا 👀', message: 'تحدي «رحلة الاستكشاف في الكنيسة» هيبدأ بعد ١٥ دقيقة', target: 'game:game-explore', image: '', publishAt: '2026-10-11 21:45', expireAt: '2026-10-11 23:30' },
  { id: 'notif-game-explore-start', enabled: true, type: 'game', title: '🔥 اللعبة جاهزة!', message: '«رحلة الاستكشاف في الكنيسة» — ادخل دلوقتي وابدأ التحدي', target: 'game:game-explore', image: '', publishAt: '2026-10-11 22:00', expireAt: '2026-10-11 23:30' }
];

const result = gs.buildPublicContent(draft, { now: NOW, hash: sha256, publishedAt: '2026-10-08T09:00:00.000Z' });

if (result.errors.length) {
  console.error(result.errors);
  process.exit(1);
}

mkdirSync(`${ROOT}docs/examples`, { recursive: true });
writeFileSync(`${ROOT}docs/examples/content.example.json`, JSON.stringify(result.content, null, 2) + '\n');


/* the same draft, as Sheet rows */
function table(rows, columns) {
  const cell = value => String(value === undefined || value === null ? '' : value).replace(/\n/g, '⏎ ').replace(/\|/g, '\\|');
  return [
    `| ${columns.join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${columns.map(c => cell(row[c])).join(' | ')} |`)
  ].join('\n');
}

const settings = gs.SETTINGS_SPEC
  .filter(([key]) => /^meeting\.|^location\.|^site\./.test(key))
  .map(([key]) => ({ key, value: draft.settings[key] }));

const md = `# مثال: البيانات زي ما هي في الشيت

ملف متولّد من \`tools/build-example.mjs\` — ده نفس المحتوى اللي في
[content.example.json](content.example.json)، بس على هيئة صفوف في تبويبات الشيت.
الخانة اللي فيها ⏎ معناها سطر جديد جوه نفس الخانة.

## Settings (الإعدادات — المهم منها)

${table(settings, ['key', 'value'])}

## Sessions (الاجتماعات)

${table(draft.sessions, gs.TABLES ? gs.TABLES.Sessions.columns : ['date', 'enabled', 'time', 'topic', 'speaker', 'description', 'image', 'status', 'note', 'visibleFrom'])}

## News (الأخبار)

${table(draft.news, ['id', 'enabled', 'featured', 'pinned', 'tone', 'title', 'summary', 'body', 'image', 'linkUrl', 'linkLabel', 'badge', 'publishAt', 'expireAt'])}

## Games (الألعاب)

${table(draft.games, ['id', 'enabled', 'title', 'description', 'image', 'url', 'buttonLabel', 'visibleFrom', 'startAt', 'endAt', 'afterEnd'])}

## Notifications (الإشعارات)

${table(draft.notifications, ['id', 'enabled', 'type', 'title', 'message', 'target', 'image', 'publishAt', 'expireAt'])}

## Media (الصور)

${table(draft.media, ['id', 'path', 'thumb', 'width', 'height', 'alt'])}
`;

writeFileSync(`${ROOT}docs/examples/sheet.example.md`, md);

console.log(`docs/examples written (revision ${result.content.revision}, ${result.warnings.length} warnings)`);
