// Content center (Items.gs), media pipeline (Media.gs) and publishing with
// images, against the fake Apps Script world (Sheet, Drive, GitHub).

import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './fakes/gas.mjs';

const ADMIN = 'menazakmena@gmail.com';
const STRANGER = 'someone@gmail.com';
const plain = value => JSON.parse(JSON.stringify(value));

// smallest byte strings that pass the server's file-signature checks
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x20, 0, 0, 0]), Buffer.from('WEBPVP8L'), Buffer.alloc(40, 7)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 3)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(40, 1)]);

function world() {
  const w = createWorld();
  w.as(ADMIN).gs.setup();
  w.properties.set('GITHUB_TOKEN', 'test-token');
  w.properties.set('GITHUB_REPO', 'StAthanasiosYouth/stathanasiosyouth.github.io');
  w.properties.set('SITE_URL', 'https://stathanasiosyouth.github.io/');
  return w;
}

function upload(gs, overrides = {}) {
  return plain(gs.apiUploadMedia({
    full: WEBP.toString('base64'),
    thumb: WEBP.toString('base64'),
    mime: 'image/webp',
    width: 1200,
    height: 1500,
    alt: 'بوستر الرحلة',
    ...overrides
  }));
}

const notificationIds = state => state.draft.notifications.map(n => n.id).sort();


/* ---------------- access ---------------- */

test('content-center and media functions refuse non-admins', () => {
  const w = world().as(STRANGER);
  const calls = {
    apiSaveItem: ['news', { title: 'x' }],
    apiDeleteItem: ['news', 'news-1'],
    apiSetItemEnabled: ['games', 'game-1', false],
    apiUploadMedia: [{}],
    apiMediaPreview: ['img-ab12cd34'],
    apiSetMediaAlt: ['img-ab12cd34', 'x']
  };
  for (const [name, args] of Object.entries(calls)) {
    assert.throws(() => w.gs[name](...args), /مش مسموح/, name);
  }
});

test('unknown kinds are refused (no prototype tricks)', () => {
  const gs = world().as(ADMIN).gs;
  for (const kind of ['__proto__', 'constructor', 'Links', 'settings']) {
    assert.throws(() => gs.apiSaveItem(kind, {}), /نوع مش معروف/, kind);
  }
});


/* ---------------- media ---------------- */

test('upload: stored privately in Drive, row in Media, no Drive ids sent to the page', () => {
  const w = world();
  const result = upload(w.gs);
  assert.match(result.media.id, /^img-[0-9a-f]{8}$/);
  assert.match(result.media.path, /^media\/\d{4}\/img-[0-9a-f]{8}\.webp$/);
  assert.match(result.media.thumb, /-480\.webp$/);
  assert.equal(w.drive.files.size, 3, 'folder + full + thumb');
  assert.ok(w.properties.get('MEDIA_FOLDER_ID'));
  upload(w.gs, { mime: 'image/jpeg', full: JPEG.toString('base64'), thumb: JPEG.toString('base64') });
  assert.equal(w.drive.files.size, 5, 'folder created once');
  assert.ok(!JSON.stringify(result.state).includes('driveId'), 'Drive ids stay on the server');
  assert.equal(result.state.draft.media.length, 1);
});

test('upload: wrong type, fake signature, oversize and bad sizes are refused', () => {
  const gs = world().as(ADMIN).gs;
  assert.throws(() => upload(gs, { mime: 'image/png' }), /WebP أو JPEG/);
  assert.throws(() => upload(gs, { full: PNG.toString('base64') }), /مش صورة WebP/);
  assert.throws(() => upload(gs, { mime: 'image/jpeg', full: WEBP.toString('base64'), thumb: JPEG.toString('base64') }), /مش صورة JPEG/);
  assert.throws(() => upload(gs, { full: 'not base64 !!' }), /مش سليمة/);
  const huge = Buffer.concat([WEBP, Buffer.alloc(1700 * 1024)]);
  assert.throws(() => upload(gs, { full: huge.toString('base64') }), /حجمها كبير/);
  assert.throws(() => upload(gs, { width: 0 }), /مقاسات/);
  assert.throws(() => upload(gs, { height: 9000 }), /مقاسات/);
});

test('draft preview comes back from Drive as a data URL; alt text editable', () => {
  const w = world();
  const { media } = upload(w.gs);
  const preview = w.gs.apiMediaPreview(media.id);
  assert.equal(preview, 'data:image/webp;base64,' + WEBP.toString('base64'));
  const state = plain(w.gs.apiSetMediaAlt(media.id, 'وصف جديد'));
  assert.equal(state.draft.media[0].alt, 'وصف جديد');
});


/* ---------------- sessions ---------------- */

test('sessions: save, linked topic notification, date change moves it, duplicates refused', () => {
  const gs = world().as(ADMIN).gs;
  let state = plain(gs.apiSaveItem('sessions', {
    date: '2026-10-11', topic: 'حياة التسليم', speaker: 'أبونا أنطوني عياد', visibleFrom: '2026-10-09 20:00',
    notify: { topic: true }
  }));
  assert.equal(state.draft.sessions[0].topic, 'حياة التسليم');
  const linked = state.draft.notifications.find(n => n.id === 'notif-session-2026-10-11');
  assert.equal(linked.type, 'meeting');
  assert.equal(linked.publishAt, '2026-10-09 20:00');
  assert.equal(linked.message, 'حياة التسليم — أبونا أنطوني عياد');

  assert.throws(() => gs.apiSaveItem('sessions', { date: '2026-10-11', topic: 'تاني' }), /نفس التاريخ/);
  assert.throws(() => gs.apiSaveItem('sessions', { date: '11-10-2026' }), /تاريخ الاجتماع/);

  state = plain(gs.apiSaveItem('sessions', { originalDate: '2026-10-11', date: '2026-10-12', time: '19:00', topic: 'حياة التسليم', notify: { topic: true } }));
  assert.deepEqual(state.draft.sessions.map(s => s.date), ['2026-10-12']);
  assert.deepEqual(notificationIds(state), ['notif-session-2026-10-12']);

  state = plain(gs.apiSaveItem('sessions', { originalDate: '2026-10-12', date: '2026-10-12', status: 'cancelled', note: 'علشان المؤتمر', notify: { topic: true } }));
  assert.deepEqual(notificationIds(state), [], 'cancelled meetings get no topic notification');
});


/* ---------------- news ---------------- */

test('news: publish time defaults to now; linked notification follows the checkbox', () => {
  const gs = world().as(ADMIN).gs;
  let state = plain(gs.apiSaveItem('news', { title: 'رحلة الغردقة', summary: 'سجّل اسمك', linkUrl: 'https://forms.gle/x', notify: { publish: true } }));
  const item = state.draft.news[0];
  assert.match(item.id, /^news-[0-9a-f]{8}$/);
  assert.match(item.publishAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.deepEqual(notificationIds(state), ['notif-' + item.id]);
  assert.equal(state.draft.notifications[0].target, 'news:' + item.id);

  state = plain(gs.apiSaveItem('news', { ...item, pinned: true, tone: 'alert', notify: {} }));
  assert.deepEqual(notificationIds(state), [], 'unchecked removes it');

  state = plain(gs.apiSaveItem('news', { ...item, pinned: true, tone: 'alert', notify: { publish: true } }));
  assert.equal(state.draft.notifications[0].type, 'important');

  assert.throws(() => gs.apiSaveItem('news', { title: 'x', linkUrl: 'javascript:alert(1)' }), /https/);
  assert.throws(() => gs.apiSaveItem('news', { title: '' }), /العنوان مطلوب/);
  assert.throws(() => gs.apiSaveItem('news', { title: 'x', publishAt: '2026-10-10 10:00', expireAt: '2026-10-09' }), /بعد ميعاد الانتهاء/);
});


/* ---------------- games ---------------- */

test('games: validation, linked "soon" and "start" notifications keep edited wording', () => {
  const w = world();
  const gs = w.as(ADMIN).gs;
  assert.throws(() => gs.apiSaveItem('games', { title: 'x', url: 'http://x.com', startAt: '2026-10-11 22:00', endAt: '2026-10-11 23:00' }), /https/);
  assert.throws(() => gs.apiSaveItem('games', { title: 'x', url: 'https://x.com', startAt: '2026-10-11 22:00', endAt: '2026-10-11 21:00' }), /قبل النهاية/);
  assert.throws(() => gs.apiSaveItem('games', { title: 'x', url: 'https://x.com', visibleFrom: '2026-10-12', startAt: '2026-10-11 22:00', endAt: '2026-10-11 23:00' }), /الظهور/);

  let state = plain(gs.apiSaveItem('games', {
    title: 'رحلة الاستكشاف', url: 'https://example.org/explore', visibleFrom: '2026-10-11 21:00',
    startAt: '2026-10-11 22:00', endAt: '2026-10-11 23:30', notify: { soon: true, start: true }
  }));
  const game = state.draft.games[0];
  const soonId = 'notif-' + game.id + '-soon';
  const soon = state.draft.notifications.find(n => n.id === soonId);
  assert.equal(soon.publishAt, '2026-10-11 21:45');
  assert.equal(soon.expireAt, '2026-10-11 23:30');

  // admin rewords it, then moves the game: time follows, wording stays
  gs.apiSaveItem('notifications', { ...soon, message: 'جهّزوا موبايلاتكم' });
  state = plain(gs.apiSaveItem('games', { ...game, startAt: '2026-10-11 22:30', notify: { soon: true, start: true } }));
  const moved = state.draft.notifications.find(n => n.id === soonId);
  assert.equal(moved.publishAt, '2026-10-11 22:15');
  assert.equal(moved.message, 'جهّزوا موبايلاتكم');

  state = plain(gs.apiDeleteItem('games', game.id));
  assert.deepEqual(notificationIds(state), [], 'deleting the game removes its notifications');
});


/* ---------------- notifications ---------------- */

test('notifications: target must exist; https links fine; toggle and delete', () => {
  const gs = world().as(ADMIN).gs;
  assert.throws(() => gs.apiSaveItem('notifications', { title: 'x', target: 'news:nope' }), /مش موجودة/);
  assert.throws(() => gs.apiSaveItem('notifications', { title: 'x', target: 'javascript:alert(1)' }), /الوجهة/);
  let state = plain(gs.apiSaveItem('notifications', { title: 'بوستر جديد', type: 'important', target: 'https://example.org/p', publishAt: '2026-10-08 20:00' }));
  const n = state.draft.notifications[0];
  assert.equal(n.type, 'important');
  state = plain(gs.apiSetItemEnabled('notifications', n.id, false));
  assert.equal(state.draft.notifications[0].enabled, false);
  state = plain(gs.apiDeleteItem('notifications', n.id));
  assert.deepEqual(state.draft.notifications, []);
  assert.throws(() => gs.apiDeleteItem('notifications', n.id), /مش موجود/);
});


/* ---------------- publishing with images ---------------- */

test('publish: used images go in the same commit, once; unused drafts stay private', () => {
  const w = world();
  const gs = w.as(ADMIN).gs;
  const used = upload(gs).media;
  const unused = upload(gs).media;
  gs.apiSaveItem('news', { title: 'رحلة', image: used.id, publishAt: '2020-01-01 00:00' });

  const review = plain(gs.apiReview());
  assert.deepEqual(review.errors, []);
  plain(gs.apiPublish(review.revision));

  const files = w.github.files();
  assert.ok(Buffer.isBuffer(files[used.path]));
  assert.ok(files[used.path].equals(WEBP), 'bytes survive the round trip');
  assert.ok(files[used.thumb]);
  assert.equal(files[unused.path], undefined, 'drafts never reach the public repo');

  const content = JSON.parse(files['content.json']);
  assert.deepEqual(content.news[0].image, { src: used.path, thumb: used.thumb, w: 1200, h: 1500, alt: 'بوستر الرحلة' });

  const state = plain(gs.apiState());
  assert.ok(state.draft.media.find(m => m.id === used.id).publishedAt);
  assert.equal(state.draft.media.find(m => m.id === unused.id).publishedAt, '');

  // edit the news; the image is already on the site, so no new blob uploads
  const blobsBefore = w.github.requests.filter(r => r.url.endsWith('/git/blobs')).length;
  const news = state.draft.news[0];
  gs.apiSaveItem('news', { ...news, title: 'رحلة الغردقة' });
  gs.apiPublish(plain(gs.apiReview()).revision);
  assert.equal(w.github.requests.filter(r => r.url.endsWith('/git/blobs')).length, blobsBefore);
});

test('publish refuses an image path outside media/', () => {
  const w = world();
  const gs = w.as(ADMIN).gs;
  assert.throws(() => gs.githubCommitFiles_({}, 'x', { 'index.html': WEBP.toString('base64') }), /مسار صورة/);
});


/* ---------------- migration ---------------- */

test('setup moves an active announcement into pinned news, once', () => {
  const w = world();
  const gs = w.as(ADMIN).gs;
  gs.apiSaveSettings({
    'announcement.enabled': true,
    'announcement.text': 'مفيش اجتماع الأحد ده\nعلشان المؤتمر',
    'announcement.tone': 'alert',
    'announcement.expiresAt': '2026-10-12'
  });
  gs.setup();
  let state = plain(gs.apiState());
  assert.equal(state.draft.news.length, 1);
  const item = state.draft.news[0];
  assert.equal(item.title, 'مفيش اجتماع الأحد ده');
  assert.equal(item.summary, 'علشان المؤتمر');
  assert.equal(item.pinned, true);
  assert.equal(item.tone, 'alert');
  assert.equal(state.draft.settings.find(s => s.key === 'announcement.enabled').value, false);
  gs.setup();
  state = plain(gs.apiState());
  assert.equal(state.draft.news.length, 1, 'not duplicated');
});

test('setup moves future skip dates into cancelled sessions', () => {
  const w = world();
  const gs = w.as(ADMIN).gs;
  gs.apiSaveSettings({ 'meeting.skipDates': '2099-01-04, 2000-01-02' });
  gs.setup();
  const state = plain(gs.apiState());
  assert.deepEqual(state.draft.sessions.map(s => [s.date, s.status]), [['2099-01-04', 'cancelled']]);
  assert.equal(state.draft.settings.find(s => s.key === 'meeting.skipDates').value, '');
});
