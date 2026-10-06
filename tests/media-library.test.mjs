// The media library (Media.gs): one copy per picture, where each is used,
// removal that never breaks content, banners on sections.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './fakes/gas.mjs';

const ADMIN = 'menazakmena@gmail.com';
const plain = value => JSON.parse(JSON.stringify(value));

const webp = fill => Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x20, 0, 0, 0]), Buffer.from('WEBPVP8L'), Buffer.alloc(40, fill)]);

function world() {
  const w = createWorld();
  w.as(ADMIN).gs.setup();
  return w;
}

function upload(gs, fill = 7, extra = {}) {
  return plain(gs.apiUploadMedia({
    full: webp(fill).toString('base64'),
    thumb: webp(fill).toString('base64'),
    tiny: webp(fill).toString('base64'),
    tinyMime: 'image/webp',
    color: '#1D3557',
    name: 'بوستر ' + fill,
    mime: 'image/webp',
    width: 1200,
    height: 1500,
    alt: 'وصف',
    ...extra
  }));
}


test('upload keeps name, tiny thumbnail, colour, size and a fingerprint', () => {
  const gs = world().as(ADMIN).gs;
  const { media } = upload(gs);
  const row = plain(gs.readTable_('Media')).find(r => r.id === media.id);
  assert.equal(row.name, 'بوستر 7');
  assert.equal(row.color, '#1d3557');
  assert.match(row.hash, /^[0-9a-f]{64}$/);
  assert.equal(Number(row.bytes), webp(7).length);
  assert.ok(row.tiny.length > 10);
  // the state carries no tiny thumbnails and no Drive ids
  const state = plain(gs.apiState());
  const m = state.draft.media.find(x => x.id === media.id);
  assert.equal(m.tiny, undefined);
  assert.equal(m.driveId, undefined);
  assert.equal(m.name, 'بوستر 7');
});

test('the same picture twice is stored once', () => {
  const w = world();
  const gs = w.as(ADMIN).gs;
  const first = upload(gs).media;
  const filesBefore = w.drive.files.size;
  const second = upload(gs);
  assert.equal(second.duplicate, true);
  assert.equal(second.media.id, first.id);
  assert.equal(w.drive.files.size, filesBefore, 'nothing new in Drive');
  assert.equal(gs.readTable_('Media').length, 1);
  assert.notEqual(upload(gs, 8).media.id, first.id, 'a different picture is new');
});

test('the library lists every image with where it is used', () => {
  const gs = world().as(ADMIN).gs;
  const poster = upload(gs, 1).media;
  const banner = upload(gs, 2).media;
  upload(gs, 3);
  gs.apiSaveItem('news', { title: 'رحلة', summary: 'x', image: poster.id });
  gs.apiSaveItem('sessions', { date: '2099-10-11', topic: 'موضوع', image: poster.id });
  gs.apiSaveSection({ key: 'news', title: 'جديد الأسرة', banner: banner.id });

  const lib = plain(gs.apiMediaLibrary());
  assert.equal(lib.items.length, 3);
  const byId = Object.fromEntries(lib.items.map(i => [i.id, i]));
  assert.deepEqual(byId[poster.id].usage.map(u => u.area).sort(), ['news', 'sessions']);
  assert.deepEqual(byId[banner.id].usage.map(u => u.area), ['sections']);
  assert.match(byId[poster.id].tiny, /^data:image\/webp;base64,/);
  assert.equal(lib.items.find(i => !i.usage.length).name, 'بوستر 3');
});

test('an image in use cannot be removed; the error says where', () => {
  const gs = world().as(ADMIN).gs;
  const poster = upload(gs).media;
  gs.apiSaveItem('news', { title: 'رحلة الغردقة', summary: 'x', image: poster.id });
  assert.throws(() => gs.apiDeleteMedia(poster.id), error => {
    const info = JSON.parse(error.message);
    return /مستخدمة/.test(info.message) && /رحلة الغردقة/.test(info.hint);
  });
  assert.equal(gs.readTable_('Media')[0].deletedAt, '');
});

test('remove → bin → restore; purge only from the bin, files and row gone', () => {
  const w = world();
  const gs = w.as(ADMIN).gs;
  const { media } = upload(gs);
  const row = () => plain(gs.readTable_('Media')).find(r => r.id === media.id);

  assert.throws(() => gs.apiPurgeMedia(media.id), /شيل الصورة الأول/);

  gs.apiDeleteMedia(media.id);
  assert.ok(row().deletedAt);
  // a removed picture can't be chosen for anything
  assert.throws(() => gs.apiSaveItem('news', { title: 'x', summary: 'x', image: media.id }), /الصورة مش موجودة/);

  gs.apiRestoreMedia(media.id);
  assert.equal(row().deletedAt, '');

  gs.apiDeleteMedia(media.id);
  const { driveId, thumbDriveId } = row();
  gs.apiPurgeMedia(media.id);
  assert.equal(row(), undefined);
  assert.ok(!w.drive.files.has(driveId) && !w.drive.files.has(thumbDriveId), 'Drive files deleted');
});

test('rename and describe', () => {
  const gs = world().as(ADMIN).gs;
  const { media } = upload(gs);
  gs.apiUpdateMedia(media.id, { name: 'بوستر الرحلة', alt: 'ناس على البحر' });
  const row = plain(gs.readTable_('Media'))[0];
  assert.deepEqual([row.name, row.alt], ['بوستر الرحلة', 'ناس على البحر']);
  assert.throws(() => gs.apiUpdateMedia(media.id, { name: 'x'.repeat(81) }), /أطول/);
});

test('a section banner is published (with its colour) and its files go in the commit', () => {
  const w = world();
  const gs = w.as(ADMIN).gs;
  w.properties.set('GITHUB_TOKEN', 'test-token');
  w.properties.set('GITHUB_REPO', 'StAthanasiosYouth/StAthanasiosYouth.github.io');
  const banner = upload(gs).media;
  gs.apiSaveItem('news', { title: 'رحلة', summary: 'x' });
  gs.apiSaveSection({ key: 'news', title: 'جديد الأسرة', theme: 'ember', banner: banner.id });

  const review = plain(gs.apiReview());
  assert.deepEqual(review.errors, []);
  gs.apiPublish(review.revision);
  const files = w.github.files();
  const news = JSON.parse(files['content.json']).layout.find(s => s.key === 'news');
  assert.equal(news.theme, 'ember');
  assert.deepEqual(news.banner, { src: banner.path, thumb: banner.thumb, w: 1200, h: 1500, alt: 'وصف', color: '#1d3557' });
  assert.ok(files[banner.path] && files[banner.thumb]);
});

test('library functions refuse non-admins', () => {
  const gs = world().as('someone@gmail.com').gs;
  for (const name of ['apiMediaLibrary', 'apiUpdateMedia', 'apiDeleteMedia', 'apiRestoreMedia', 'apiPurgeMedia']) {
    assert.throws(() => gs[name]('img-12345678', {}), /مش مسموح/, name);
  }
});


/* ---------------- the admin's preview (apiPreview) ---------------- */

test('preview: the draft as the page gets it; unpublished images listed; nothing written or sent', () => {
  const w = world();
  const gs = w.as(ADMIN).gs;
  const { media } = upload(gs, 21);
  gs.apiSaveItem('news', { title: 'خبر في المسودة', image: media.id, publishAt: '2020-01-01 00:00' });

  const writes = w.spreadsheet.stats.writes;
  const requests = w.github.requests.length;
  const preview = plain(gs.apiPreview('2030-05-01 19:30'));

  assert.equal(preview.at, '2030-05-01T19:30', 'time travel: built as of that Cairo moment');
  assert.ok(preview.content.news.some(n => n.title === 'خبر في المسودة'), 'draft content');
  assert.deepEqual(preview.pending, [{ id: media.id, path: media.path, thumb: media.thumb }]);
  assert.equal(w.spreadsheet.stats.writes, writes, 'no Sheet writes');
  assert.equal(w.github.requests.length, requests, 'nothing sent to GitHub');
  assert.deepEqual(Object.keys(w.github.files()).filter(f => f.includes(media.id)), [], 'the image stays private');

  // anything else than a Cairo moment falls back to now
  assert.match(plain(gs.apiPreview('tomorrow')).at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
});

test('preview: only the admin', () => {
  const w = world();
  assert.throws(() => w.as('someone@example.com').gs.apiPreview());
});
