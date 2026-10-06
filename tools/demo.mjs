// Builds a realistic demo of the hub (sessions, news with posters, games in
// every state, notifications) through the REAL admin code: fake Sheet ->
// apiSaveItem / apiUploadMedia -> apiPublish -> fake GitHub. The published
// files land in tools/.cache/demo/, which `node tools/serve.mjs 4321 --demo`
// serves instead of the real content.json. Nothing here touches the repo.
//
// Usage: node tools/demo.mjs

import sharp from 'sharp';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createWorld } from '../tests/fakes/gas.mjs';
import { ROOT } from './lib/gs.mjs';

const OUT = `${ROOT}tools/.cache/demo/`;
const ADMIN = 'menazakmena@gmail.com';

const world = createWorld();
const gs = world.as(ADMIN).gs;

gs.setup();
world.properties.set('GITHUB_TOKEN', 'test-token');
world.properties.set('GITHUB_REPO', 'StAthanasiosYouth/athanasios-links');
world.properties.set('SITE_URL', 'https://stathanasiosyouth.github.io/');

const now = gs.cairoNow_();                       // "YYYY-MM-DDTHH:MM"
const at = minutes => gs.storedOf_(gs.wallAdd_(now, minutes));
const day = days => at(days * 1440).slice(0, 10);


/* posters: generated gradients with a title */
async function poster(title, colors, { w = 1200, h = 1500 } = {}) {

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <circle cx="${w * 0.75}" cy="${h * 0.25}" r="${w * 0.32}" fill="#fff" fill-opacity=".08"/>
    <text x="50%" y="56%" text-anchor="middle" font-family="Arial" font-weight="bold" font-size="${w / 9}" fill="#fff">${title}</text>
  </svg>`;

  const image = sharp(Buffer.from(svg));
  const full = await image.clone().webp({ quality: 80 }).toBuffer();
  const thumb = await image.clone().resize(480).webp({ quality: 78 }).toBuffer();

  return gs.apiUploadMedia({
    full: full.toString('base64'),
    thumb: thumb.toString('base64'),
    mime: 'image/webp',
    width: w,
    height: h,
    alt: 'بوستر ' + title
  }).media.id;

}

const tripPoster = await poster('TRIP', ['#0e3560', '#d7aa50']);
const confPoster = await poster('CONFERENCE', ['#3a0e2e', '#c8433a']);
const gamePoster = await poster('EXPLORE', ['#1a1a40', '#e0732f'], { w: 1600, h: 900 });
const quizPoster = await poster('QUIZ', ['#0b3f4f', '#4cc3cb']);
const topicPoster = await poster('TOPIC', ['#12385f', '#f2d28b']);

/* meetings */
const sunday = (() => { for (let d = 1; d <= 7; d++) { if (new Date(day(d) + 'T12:00Z').getUTCDay() === 0) return day(d); } return day(7); })();

gs.apiSaveItem('sessions', { date: sunday, topic: 'حياة التسليم', speaker: 'أبونا أنطوني عياد', description: 'إزاي نسلّم حياتنا لربنا في كل تفصيلة، من غير خوف ولا قلق.', image: topicPoster, visibleFrom: at(-60), notify: { topic: true } });
gs.apiSaveItem('sessions', { date: day(14), status: 'cancelled', note: 'علشان المؤتمر' });
gs.apiSaveItem('sessions', { date: day(21), topic: 'الصلاة الحقيقية', speaker: 'م. فادي يوسف' });

/* news */
gs.apiSaveItem('news', { title: 'رحلة الغردقة', summary: 'يوم كامل على البحر — سجّل اسمك قبل الخميس', body: 'الرحلة يوم الجمعة.\nالتجمع ٧ الصبح عند الكنيسة.\n\nالاشتراك ٢٠٠ جنيه شاملة الأكل والمواصلات.', image: tripPoster, linkUrl: 'https://forms.gle/example', linkLabel: 'سجّل هنا', badge: 'جديد', featured: true, publishAt: at(-120), notify: { publish: true } });
gs.apiSaveItem('news', { title: 'مؤتمر الشباب', summary: 'ثلاث أيام في بيت الخلوة', image: confPoster, publishAt: at(-2 * 1440), notify: { publish: true } });
gs.apiSaveItem('news', { title: 'صور اجتماع الأحد', summary: 'الصور كلها على الدرايف', linkUrl: 'https://photos.example.com', publishAt: at(-3 * 1440) });
gs.apiSaveItem('news', { title: 'مفيش اجتماع الأحد ده', summary: 'علشان المؤتمر — نتقابل الأحد اللي بعده', pinned: true, tone: 'alert', publishAt: at(-30), expireAt: day(14) });
gs.apiSaveItem('news', { title: 'خبر مجدول', summary: 'لسه مش وقته', publishAt: at(3 * 1440) });

/* games: one open now, one soon, one ended */
gs.apiSaveItem('games', { title: 'رحلة الاستكشاف في الكنيسة', description: 'دوّر على الأماكن المخفية في الكنيسة وجاوب على الأسئلة.', image: gamePoster, url: 'https://example.org/explore', startAt: at(-20), endAt: at(70), notify: { start: true } });
gs.apiSaveItem('games', { title: 'مسابقة الكتاب المقدس', image: quizPoster, url: 'https://example.org/quiz', startAt: at(95), endAt: at(160), notify: { soon: true } });
gs.apiSaveItem('games', { title: 'خمّن الصوت', url: 'https://example.org/sounds', startAt: at(-300), endAt: at(-200), afterEnd: 'show' });

/* notifications */
gs.apiSaveItem('notifications', { title: 'بوستر المؤتمر نزل', message: 'شوفوا المواعيد والتفاصيل', type: 'important', target: 'https://example.org/poster', publishAt: at(-10) });
gs.apiSaveItem('notifications', { title: 'شكراً على الأحد اللي فات', message: 'كان اجتماع جميل', type: 'general', publishAt: at(-4 * 1440) });

/* publish through the real path */
const review = gs.apiReview();
if (review.errors.length) {
  console.error(review.errors);
  process.exit(1);
}
gs.apiPublish(review.revision);

rmSync(OUT, { recursive: true, force: true });

for (const [path, data] of Object.entries(world.github.files())) {
  if (!/^(content\.json|meeting\.ics|media\/)/.test(path)) continue;
  mkdirSync(dirname(OUT + path), { recursive: true });
  writeFileSync(OUT + path, data);
}

console.log(`demo written to tools/.cache/demo (${review.changes.length} changes), now = ${now}`);
