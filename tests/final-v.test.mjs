// final/v: scene videos in the Media Library and in a link's
// «صور وفيديوهات المشهد» — upload checks (Media.gs uploadVideo_), «من رابط»
// (apiFetchMediaUrl), gallery tokens (img-… / vid-…@start-end), the
// published shape (Content.gs), publish (video + poster in the commit), the
// site's re-validation (content.js cleanVideo) and the trimmer's pure parts
// (AdminTrim.html A.clip). The trimmer itself: tests/final-v.e2e.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import { createWorld } from './fakes/gas.mjs';
import { ROOT } from '../tools/lib/gs.mjs';

// icons.js builds a <template> at import time
globalThis.document = globalThis.document || { createElement: () => ({ content: {} }) };

const { sanitizeContent, cleanVideo } = await import('../assets/js/content.js');

const ADMIN = 'menazakmena@gmail.com';
const plain = value => JSON.parse(JSON.stringify(value));

const webp = fill => Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x20, 0, 0, 0]), Buffer.from('WEBPVP8L'), Buffer.alloc(40, fill)]);
const mp4 = (fill = 1, size = 64) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(Math.max(0, size - 12), fill)]);
const webm = (fill = 1) => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(60, fill)]);
const jpeg = fill => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, fill)]);

function world(options = {}) {
  const w = createWorld(options);
  w.as(ADMIN).gs.setup();
  return w;
}

function image(gs, fill = 7) {
  return plain(gs.apiUploadMedia({ full: webp(fill).toString('base64'), thumb: webp(fill).toString('base64'), mime: 'image/webp', width: 1200, height: 1500, alt: 'صورة ' + fill })).media;
}

const videoInput = (extra = {}) => ({
  kind: 'video',
  video: mp4(3).toString('base64'),
  mime: 'video/mp4',
  poster: webp(9).toString('base64'),
  posterMime: 'image/webp',
  tiny: webp(9).toString('base64'),
  tinyMime: 'image/webp',
  color: '#224466',
  name: 'رحلة الغردقة',
  width: 540,
  height: 960,
  duration: 6,
  alt: 'الشباب على البحر',
  ...extra
});

function video(gs, extra = {}) {
  return plain(gs.apiUploadMedia(videoInput(extra))).media;
}

const socialLink = gs => plain(gs.apiState()).draft.links.find(l => l.icon === 'instagram');


/* ---------------- upload ---------------- */

test('a video clip is stored like an image: vid- id, its own paths, poster as the thumb, a fingerprint', () => {
  const w = world();
  const gs = w.as(ADMIN).gs;
  const media = video(gs);
  assert.match(media.id, /^vid-[a-z0-9]{8}$/);
  assert.match(media.path, /^media\/\d{4}\/vid-[a-z0-9]{8}\.mp4$/);
  assert.equal(media.thumb, media.path.replace('.mp4', '-480.webp'), 'the poster: WebP, whatever the video');
  assert.equal(media.kind, 'video');

  const row = plain(gs.readTable_('Media')).find(r => r.id === media.id);
  assert.equal(row.mime, 'video/mp4');
  assert.equal(Number(row.bytes), mp4(3).length);
  assert.match(row.hash, /^[0-9a-f]{64}$/);
  assert.equal(Object.keys(row).includes('duration'), false, 'no new column');
  // Drive holds the clip and the poster, byte for byte
  const files = [...w.drive.files.values()].filter(f => f.meta.name && f.meta.name.startsWith(media.id));
  assert.deepEqual(files.map(f => f.meta.name).sort(), [`${media.id}-480.webp`, `${media.id}.mp4`]);
  assert.deepEqual(Buffer.from(files.find(f => f.meta.name.endsWith('.mp4')).bytes.map(b => (b < 0 ? b + 256 : b))), mp4(3));

  // the same clip twice: stored once
  const again = plain(gs.apiUploadMedia(videoInput()));
  assert.equal(again.duplicate, true);
  assert.equal(again.media.id, media.id);

  // WebM and a JPEG poster (Safari) keep their own extensions
  const other = video(gs, { video: webm(5).toString('base64'), mime: 'video/webm', poster: jpeg(4).toString('base64'), posterMime: 'image/jpeg', tiny: '' });
  assert.match(other.path, /\.webm$/);
  assert.match(other.thumb, /-480\.jpg$/);
});

test('video upload checks: type, real bytes, 8 MB, duration, poster, sizes; images keep img-', () => {
  const gs = world().as(ADMIN).gs;
  const refused = (extra, pattern) => assert.throws(() => gs.apiUploadMedia(videoInput(extra)), pattern, JSON.stringify(Object.keys(extra)));

  refused({ mime: 'video/quicktime' }, /MP4 أو WebM/);
  refused({ mime: 'image/webp' }, /MP4 أو WebM/);
  refused({ video: webm(1).toString('base64') }, /مش فيديو MP4/);
  refused({ video: mp4(1).toString('base64'), mime: 'video/webm' }, /مش فيديو WebM/);
  refused({ video: Buffer.from('<html>not a video</html>').toString('base64') }, /مش فيديو/);
  refused({ video: 'not base64!!' }, /مش سليمة/);
  refused({ video: mp4(1, 8 * 1024 * 1024 + 10).toString('base64') }, /أكبر من 8 MB/);
  refused({ duration: 0 }, /أقل من ١٠ دقايق/);
  refused({ duration: 601 }, /أقل من ١٠ دقايق/);
  refused({ duration: 'x' }, /أقل من ١٠ دقايق/);
  refused({ poster: mp4(2).toString('base64') }, /صورة غلاف الفيديو/);
  refused({ poster: Buffer.alloc(301 * 1024, 1).toString('base64') }, /صورة غلاف الفيديو/);
  refused({ width: 5000 }, /مقاسات الفيديو/);
  refused({ height: 0 }, /مقاسات الفيديو/);
  refused({ name: 'x'.repeat(81) }, /اسم الفيديو/);
  assert.equal(gs.readTable_('Media').length, 0, 'nothing stored');

  // exactly 8 MB is fine
  assert.match(video(gs, { video: mp4(1, 8 * 1024 * 1024).toString('base64') }).id, /^vid-/);
  assert.match(image(gs).id, /^img-/);
  assert.throws(() => world().as('someone@gmail.com').gs.apiUploadMedia(videoInput()), /مش مسموح/);
});

test('the library lists videos (kind, poster tiny) and previews their poster, never the clip', () => {
  const w = world();
  const gs = w.as(ADMIN).gs;
  const clip = video(gs);
  const picture = image(gs);
  const lib = plain(gs.apiMediaLibrary());
  const byId = Object.fromEntries(lib.items.map(i => [i.id, i]));
  assert.equal(byId[clip.id].kind, 'video');
  assert.equal(byId[picture.id].kind, 'image');
  assert.match(byId[clip.id].tiny, /^data:image\/webp;base64,/, 'the poster\'s type, not video/mp4');
  assert.equal(gs.apiMediaPreview(clip.id), 'data:image/webp;base64,' + webp(9).toString('base64'));
});


/* ---------------- «من رابط» ---------------- */

test('from a URL: a direct image or video file comes back as base64 (redirects followed, nothing stored)', () => {
  const big = Buffer.concat([jpeg(1), Buffer.alloc(1024)]);
  const w = world({ web: {
    'https://cdn.example.org/photos/%D8%B1%D8%AD%D9%84%D8%A9.jpg': { headers: { 'Content-Type': 'image/jpeg' }, body: big },
    'https://cdn.example.org/clip.mp4?x=1': { headers: { 'content-type': 'video/mp4' }, body: mp4(2, 2048) },
    'https://files.example.org/download': { headers: { 'Content-Type': 'application/octet-stream' }, body: webm(3) }
  } });
  const gs = w.as(ADMIN).gs;
  const rows = gs.readTable_('Media').length;

  const photo = plain(gs.apiFetchMediaUrl('https://cdn.example.org/photos/%D8%B1%D8%AD%D9%84%D8%A9.jpg'));
  assert.deepEqual([photo.mime, photo.name, photo.bytes], ['image/jpeg', 'رحلة', big.length]);
  assert.deepEqual(Buffer.from(photo.base64, 'base64'), big);

  const clip = plain(gs.apiFetchMediaUrl(' https://cdn.example.org/clip.mp4?x=1 '));
  assert.deepEqual([clip.mime, clip.name], ['video/mp4', 'clip']);
  assert.equal(plain(gs.apiFetchMediaUrl('https://files.example.org/download')).mime, 'video/webm', 'octet-stream: the bytes decide');

  const options = w.webRequests[0].options;
  assert.equal(options.followRedirects, true);
  assert.equal(options.muteHttpExceptions, true);
  assert.equal(options.headers, undefined, 'no credentials sent');
  assert.equal(gs.readTable_('Media').length, rows, 'nothing stored by fetching');
});

test('from a URL: https only, no pages, no credentials, the right types and sizes, clear Arabic errors', () => {
  const w = world({ web: {
    'https://example.org/page': { headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: '<html></html>' },
    'https://example.org/doc.pdf': { headers: { 'Content-Type': 'application/pdf' }, body: Buffer.from('%PDF-1.7 xxxxxxxx') },
    'https://example.org/fake.jpg': { headers: { 'Content-Type': 'image/jpeg' }, body: Buffer.from('this is not a jpeg at all') },
    'https://example.org/big.mp4': { headers: { 'Content-Type': 'video/mp4' }, body: mp4(1, 8 * 1024 * 1024 + 1) },
    'https://example.org/big.jpg': { headers: { 'Content-Type': 'image/jpeg' }, body: Buffer.concat([jpeg(1), Buffer.alloc(15 * 1024 * 1024)]) },
    'https://example.org/gone.jpg': { status: 404, headers: {}, body: '' },
    'https://example.org/a.heic': { headers: { 'Content-Type': 'image/heic' }, body: Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(40)]) }
  } });
  const gs = w.as(ADMIN).gs;
  const message = url => {
    try { gs.apiFetchMediaUrl(url); }
    catch (error) {
      try { return JSON.parse(error.message).message; } catch { return error.message; }
    }
    return 'accepted';
  };

  for (const url of ['http://example.org/a.jpg', 'ftp://example.org/a.jpg', 'example.org/a.jpg', '', null, 'https://']) {
    assert.match(message(url), /https:\/\//, String(url));
  }
  for (const url of ['https://user:pass@example.org/a.jpg', 'https://127.0.0.1/a.jpg', 'https://localhost/a.jpg', 'https://intranet/a.jpg']) {
    assert.match(message(url), /مش مقبول/, url);
  }
  for (const url of ['https://www.tiktok.com/@x/video/123', 'https://youtu.be/abc', 'https://www.youtube.com/watch?v=abc', 'https://www.facebook.com/x/videos/1', 'https://www.instagram.com/reel/x/']) {
    assert.match(message(url), /صفحة، مش ملف/, url);
  }
  assert.equal(w.webRequests.length, 0, 'none of those was fetched');

  assert.match(message('https://example.org/page'), /صفحة، مش ملف/);
  assert.match(message('https://example.org/doc.pdf'), /مش لصورة أو فيديو/);
  assert.match(message('https://example.org/fake.jpg'), /مش صورة أو فيديو/);
  assert.match(message('https://example.org/big.mp4'), /أكبر من 8 MB/);
  assert.match(message('https://example.org/big.jpg'), /أكبر من 15 MB/);
  assert.match(message('https://example.org/gone.jpg'), /404/);
  assert.match(message('https://example.org/a.heic'), /مش صورة أو فيديو/);
  assert.throws(() => world().as('someone@gmail.com').gs.apiFetchMediaUrl('https://example.org/a.jpg'), /مش مسموح/);
});


/* ---------------- gallery tokens ---------------- */

test('gallery: pictures and clips, normalised tokens, in order, at most 12', () => {
  const gs = world().as(ADMIN).gs;
  const a = image(gs, 1);
  const b = image(gs, 2);
  const clip = video(gs);
  const link = socialLink(gs);

  gs.apiSaveLink({ ...link, gallery: [clip.id + '@37.25-43', a.id, ` ${clip.id}@0-6.04 `, clip.id, b.id] });
  let row = gs.readTable_('Links').find(l => l.id === link.id);
  assert.equal(row.gallery, `${clip.id}@37.3-43,${a.id},${clip.id}@0-6,${clip.id},${b.id}`);

  // a stored string goes back unchanged (the editor sends what it got)
  gs.apiSaveLink({ ...plain(gs.apiState()).draft.links.find(l => l.id === link.id) });
  assert.equal(gs.readTable_('Links').find(l => l.id === link.id).gallery, row.gallery);
  gs.apiSaveLink({ ...link, gallery: row.gallery });
  assert.equal(gs.readTable_('Links').find(l => l.id === link.id).gallery, row.gallery);

  gs.apiSaveLink({ ...link, gallery: [a.id, b.id, ...Array.from({ length: 11 }, (_, i) => clip.id + '@' + i + '-' + (i + 1))] });
  row = gs.readTable_('Links').find(l => l.id === link.id);
  assert.equal(row.gallery.split(',').length, 12, 'the first twelve');

  // used once per link in the library, whatever the number of clips
  const usage = plain(gs.apiMediaLibrary()).items.find(i => i.id === clip.id).usage;
  assert.deepEqual(usage.map(u => u.area), ['links']);
  assert.throws(() => gs.apiDeleteMedia(clip.id), error => /الفيديو ده مستخدم/.test(JSON.parse(error.message).message));
});

test('gallery: refused — a bad clip, an unknown or removed item, nonsense, a picture with times', () => {
  const gs = world().as(ADMIN).gs;
  const picture = image(gs);
  const clip = video(gs);
  const gone = video(gs, { video: mp4(8).toString('base64') });
  gs.apiDeleteMedia(gone.id);
  const link = socialLink(gs);
  const before = gs.readTable_('Links').find(l => l.id === link.id).gallery;
  const refused = (gallery, pattern) => assert.throws(() => gs.apiSaveLink({ ...link, gallery }), pattern, JSON.stringify(gallery));

  refused([clip.id + '@10-5'], /«لحد» لازم يكون بعد «من»/);
  refused([clip.id + '@5-5'], /«لحد» لازم يكون بعد «من»/);
  refused([clip.id + '@0-0.3'], /نص ثانية/);
  refused([clip.id + '@500-601'], /قبل الدقيقة ١٠/);
  refused([clip.id + '@-1-5'], /مش مفهوم/);
  refused([clip.id + '@a-b'], /مش مفهوم/);
  refused([picture.id + '@1-5'], /مش مفهوم/);
  refused([gone.id], /الفيديو مش موجود/);
  refused(['vid-zzzzzzzz@1-3'], /الفيديو مش موجود/);
  refused(['img-zzzzzzzz'], /الصورة مش موجودة/);
  refused(['<script>'], /مش مفهوم/);
  assert.equal(gs.readTable_('Links').find(l => l.id === link.id).gallery, before, 'nothing saved');
});

test('a video never goes where a picture is expected (posters, banners, avatars)', () => {
  const gs = world().as(ADMIN).gs;
  const clip = video(gs);
  assert.throws(() => gs.apiSaveItem('news', { title: 'خبر', summary: 'x', image: clip.id }), /صورة بس، مش فيديو/);
  assert.throws(() => gs.apiSaveItem('sessions', { date: '2099-10-11', topic: 'x', image: clip.id }), /صورة بس، مش فيديو/);
  assert.throws(() => gs.apiSaveSection({ key: 'news', title: 'جديد', banner: clip.id }), /صورة بس، مش فيديو/);
  const support = plain(gs.apiState()).draft.contacts.find(c => c.kind === 'support');
  assert.throws(() => gs.apiSaveContact({ ...support, image: clip.id }), /صورة بس، مش فيديو/);
});


/* ---------------- published shape + publish ---------------- */

function publishedWorld() {
  const w = world();
  w.properties.set('GITHUB_TOKEN', 'test-token');
  w.properties.set('GITHUB_REPO', 'StAthanasiosYouth/StAthanasiosYouth.github.io');
  return w;
}

test('content.json: a clip is { type: video, src, poster, w, h, alt, start, end }; pictures as before', () => {
  const w = publishedWorld();
  const gs = w.as(ADMIN).gs;
  const picture = image(gs);
  const clip = video(gs);
  const link = socialLink(gs);
  gs.apiSaveLink({ ...link, gallery: [clip.id + '@37-43', picture.id, clip.id] });

  const built = plain(gs.buildDraft_());
  const published = built.content.sections.flatMap(s => s.links).find(l => l.id === link.id);
  assert.deepEqual(published.gallery[0], { type: 'video', src: clip.path, poster: clip.thumb, w: 540, h: 960, alt: 'الشباب على البحر', start: 37, end: 43 });
  assert.deepEqual(published.gallery[1], { src: picture.path, thumb: picture.thumb, w: 1200, h: 1500, alt: 'صورة 7' });
  assert.deepEqual([published.gallery[2].start, published.gallery[2].end], [0, 0], 'no times: the whole clip');
  assert.ok(built.media.includes(clip.id) && built.media.includes(picture.id));

  // hand-edited nonsense in the Sheet: a warning, never an error
  const sheet = w.spreadsheet.getSheetByName('Links');
  const col = sheet.data[0].indexOf('gallery');
  const r = sheet.data.findIndex(line => line[0] === link.id);
  sheet.data[r][col] = `${clip.id}@9-3,junk,${picture.id}@1-2,vid-zzzzzzzz`;
  const again = plain(gs.buildDraft_());
  const items = again.content.sections.flatMap(s => s.links).find(l => l.id === link.id).gallery;
  assert.deepEqual(items.map(i => [i.type || 'image', i.start, i.end]), [['video', 0, 0]]);
  assert.equal(again.errors.length, 0);
  assert.ok(again.warnings.some(x => /مش مفهوم/.test(x.message)) && again.warnings.some(x => /مش موجود/.test(x.message)));
});

test('publish: the clip and its poster go in the same commit; preview lists the poster only', () => {
  const w = publishedWorld();
  const gs = w.as(ADMIN).gs;
  const clip = video(gs);
  const link = socialLink(gs);
  gs.apiSaveLink({ ...link, gallery: [clip.id + '@1-4'] });

  const preview = plain(gs.apiPreview());
  assert.deepEqual(preview.pending.filter(p => p.id === clip.id), [{ id: clip.id, path: clip.path, thumb: clip.thumb, kind: 'video' }]);

  const review = plain(gs.apiReview());
  assert.deepEqual(review.errors, []);
  gs.apiPublish(review.revision);
  const files = w.github.files();
  assert.deepEqual(Buffer.from(files[clip.path]), mp4(3), 'the clip, byte for byte');
  assert.deepEqual(Buffer.from(files[clip.thumb]), webp(9), 'its poster');
  assert.ok(gs.readTable_('Media').find(r => r.id === clip.id).publishedAt);
  const content = JSON.parse(files['content.json']);
  assert.equal(content.sections.flatMap(s => s.links).find(l => l.id === link.id).gallery[0].src, clip.path);

  // the site takes it
  const site = sanitizeContent(content).sections.flatMap(s => s.links).find(l => l.id === link.id);
  assert.deepEqual(site.gallery[0], { type: 'video', src: clip.path, poster: clip.thumb, thumb: clip.thumb, w: 540, h: 960, alt: 'الشباب على البحر', start: 1, end: 4 });
});


/* ---------------- the site: content.js ---------------- */

test('content.js cleanVideo: own paths only, sane numbers, end 0 = to the end', () => {
  const ok = { type: 'video', src: 'media/2026/vid-ab12cd34.mp4', poster: 'media/2026/vid-ab12cd34-480.webp', w: 540, h: 960, alt: 'x', start: 2, end: 8 };
  assert.deepEqual(cleanVideo(ok), { ...ok, thumb: ok.poster });
  assert.equal(cleanVideo({ ...ok, src: 'media/2026/vid-ab12cd34.webm' }).src, 'media/2026/vid-ab12cd34.webm');
  assert.equal(cleanVideo({ ...ok, poster: 'media/2026/vid-ab12cd34-480.jpg' }).poster, 'media/2026/vid-ab12cd34-480.jpg');
  for (const bad of [
    { src: 'https://evil.example/x.mp4' }, { src: 'media/2026/img-ab12cd34.webp' }, { src: 'media/2026/vid-ab12cd34.mov' },
    { src: '../media/2026/vid-ab12cd34.mp4' }, { poster: 'https://evil.example/p.webp' }, { poster: '' }, { w: 0 }, { h: 'x' }
  ]) assert.equal(cleanVideo({ ...ok, ...bad }), null, JSON.stringify(bad));
  assert.deepEqual([cleanVideo({ ...ok, start: -3, end: 4 }).start, cleanVideo({ ...ok, start: -3, end: 4 }).end], [0, 4]);
  assert.deepEqual([cleanVideo({ ...ok, start: 9, end: 4 }).start, cleanVideo({ ...ok, start: 9, end: 4 }).end], [9, 0]);
  assert.equal(cleanVideo({ ...ok, end: 9999 }).end, 0);
  assert.equal(cleanVideo({ ...ok, start: 'x' }).start, 0);

  // a mixed gallery, still at most twelve
  const seed = JSON.parse(readFileSync(new URL('../content.json', import.meta.url), 'utf8'));
  const picture = { src: 'media/2026/img-ab12cd34.webp', thumb: 'media/2026/img-ab12cd34-480.webp', w: 10, h: 10, alt: '' };
  seed.featured = [{ id: 'x', title: 'x', url: 'https://example.org', icon: 'link', gallery: [ok, picture, { ...ok, src: 'bad' }, ...Array(12).fill(ok)] }];
  const gallery = sanitizeContent(seed).featured[0].gallery;
  assert.equal(gallery.length, 12);
  assert.deepEqual(gallery.slice(0, 2).map(i => i.type || 'image'), ['video', 'image']);
  assert.equal(gallery[1].type, undefined, 'pictures unchanged');
});


/* ---------------- the trimmer's pure parts (AdminTrim.html) ---------------- */

const trim = (() => {
  const html = readFileSync(`${ROOT}apps-script/AdminTrim.html`, 'utf8');
  const code = /<script>([\s\S]*)<\/script>/.exec(html)[1];
  const window = { A: {} };
  vm.runInNewContext(code, { window, URL });
  return window.A.clip;
})();

test('trimmer: times typed as m:ss, seconds, h:mm:ss or Arabic digits', () => {
  const { parseTime, formatTime } = trim;
  assert.equal(parseTime(''), null);
  assert.equal(parseTime('   '), null);
  assert.equal(parseTime('65'), 65);
  assert.equal(parseTime('1:05'), 65);
  assert.equal(parseTime('1:05.5'), 65.5);
  assert.equal(parseTime('0:37.25'), 37.3);
  assert.equal(parseTime('1:02:03'), 3723);
  assert.equal(parseTime('٠:٣٧'), 37);
  assert.equal(parseTime('١٢٫٥'), 12.5);
  assert.equal(parseTime('45:30'), 2730);
  for (const bad of ['1:75', 'abc', '-3', '1::2', '1:2:3:4', '1.5:20', '١:٧٥']) assert.ok(Number.isNaN(parseTime(bad)), bad);
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(65), '1:05');
  assert.equal(formatTime(65.5), '1:05.5');
  assert.equal(formatTime(3723), '1:02:03');
  assert.equal(formatTime(-4), '0:00');
  for (const s of [0, 7, 59.9, 60, 61.3, 600, 3599.9, 3723.4]) assert.equal(parseTime(formatTime(s)), s, String(s));
});

test('trimmer: clip checks (1–30 s inside the video) and the gallery\'s (½ s, before 10:00)', () => {
  const { checkClip, defaultEnd } = trim;
  const trimmer = { duration: 20, min: 1, max: 30 };
  assert.equal(checkClip(2, 8, trimmer), '');
  assert.match(checkClip(null, 8, trimmer), /اكتب وقت/);
  assert.match(checkClip(NaN, 8, trimmer), /مش مفهوم/);
  assert.match(checkClip(8, 8, trimmer), /بعد «من»/);
  assert.match(checkClip(8, 2, trimmer), /بعد «من»/);
  assert.match(checkClip(2, 2.5, trimmer), /ثانية على الأقل/);
  assert.match(checkClip(2, 21, trimmer), /بيخلص عند 0:20/);
  assert.match(checkClip(25, 26, trimmer), /مدته 0:20 بس/);
  assert.match(checkClip(0, 31, { duration: 3600, min: 1, max: 30 }), /30 ثانية بالكتير/);
  assert.equal(checkClip(0, 30, { duration: 3600, min: 1, max: 30 }), '');
  // the gallery: length unknown (a draft from another tab) — only the basics and the cap
  const gallery = { min: 0.5, cap: 600 };
  assert.equal(checkClip(100, 106, gallery), '');
  assert.match(checkClip(1, 1.2, gallery), /نص ثانية/);
  assert.match(checkClip(598, 601, gallery), /قبل 10:00/);
  assert.equal(defaultEnd(3, 0), 9);
  assert.equal(defaultEnd(3, 5.5), 5.5);
});

test('trimmer: framing — a wide source in a portrait clip gets a blurred fill; the same shape just scales', () => {
  const { framing, shapeSize } = trim;
  assert.deepEqual(plain(shapeSize('tall')), { width: 540, height: 960 });
  assert.deepEqual(plain(shapeSize('wide')), { width: 854, height: 480 });
  assert.deepEqual(plain(shapeSize('anything')), { width: 540, height: 960 }, 'portrait is the default');

  const wideInTall = framing(1920, 1080, 540, 960);
  assert.equal(wideInTall.fill, true);
  assert.deepEqual(plain(wideInTall.contain), { x: 0, y: (960 - 303.75) / 2, width: 540, height: 303.75 });
  assert.equal(wideInTall.cover.height, 960);
  assert.ok(wideInTall.cover.width > 540 && wideInTall.cover.x < 0);

  const tallInTall = framing(1080, 1920, 540, 960);
  assert.equal(tallInTall.fill, false);
  assert.deepEqual(plain(tallInTall.contain), { x: 0, y: 0, width: 540, height: 960 });

  const tallInWide = framing(1080, 1920, 854, 480);
  assert.equal(tallInWide.fill, true);
  assert.equal(tallInWide.contain.height, 480);
  assert.equal(framing(1920, 1080, 854, 480).fill, false, '16:9 in 854×480 (within 2%)');
});

test('trimmer: a steady 30 fps from 25, 30, 50 or 60 fps sources (frames dropped or held, never sped up)', () => {
  const { framesFor, totalFrames } = trim;
  for (const sourceFps of [24, 25, 29.97, 30, 50, 59.94, 60]) {
    for (const [start, end] of [[0, 6], [37.2, 43.2], [1, 2]]) {
      const total = totalFrames(start, end, 30);
      let n = 0;
      // the decoder hands over every source frame from the one on screen at `start`
      let t = Math.floor(start * sourceFps) / sourceFps;
      while (t < end && n < total) {
        n += framesFor(t, t + 1 / sourceFps, n, start, 30, total);
        t += 1 / sourceFps;
      }
      assert.equal(n, total, `${sourceFps} fps ${start}–${end}`);
    }
  }
  assert.equal(totalFrames(0, 6, 30), 180);
  assert.equal(totalFrames(5, 5.01, 30), 1);
  // a frame entirely before the next output time is dropped
  assert.equal(framesFor(0, 1 / 60, 1, 0, 30, 30), 0);
});

test('trimmer: one retry at a lower bitrate when the clip is over 8 MB; the clip\'s name', () => {
  const { retryBitrate, cleanName, isVideoFile, CLIP } = trim;
  assert.equal(retryBitrate(3 * 1024 * 1024, CLIP.bitrate), 0, 'fits: no retry');
  assert.equal(retryBitrate(CLIP.maxBytes, CLIP.bitrate), 0);
  const lower = retryBitrate(12 * 1024 * 1024, CLIP.bitrate);
  assert.ok(lower > 0 && lower < CLIP.bitrate * 8 / 12, String(lower));
  assert.equal(retryBitrate(500 * 1024 * 1024, CLIP.bitrate), CLIP.minBitrate, 'never below the floor');
  assert.equal(cleanName('VID_20260412_183055.mp4'), 'VID 20260412 183055');
  assert.equal(cleanName('رحلة الغردقة.MOV'), 'رحلة الغردقة');
  assert.equal(cleanName('a\u0000b.mkv'), 'ab');
  assert.equal(cleanName('x'.repeat(200) + '.mp4').length, 80);
  assert.ok(isVideoFile({ type: 'video/quicktime', name: 'a.mov' }));
  assert.ok(isVideoFile({ type: '', name: 'MVI_0001.MP4' }));
  assert.ok(!isVideoFile({ type: 'image/jpeg', name: 'a.jpg' }));
});


/* ---------------- admin only ---------------- */

test('the video tool is admin-only: the public site never references admin/vendor', () => {
  const vendor = readFileSync(`${ROOT}admin/vendor/mediabunny.js`, 'utf8');
  assert.match(vendor.slice(0, 400), /Mediabunny [\d.]+ .*MPL-2\.0/);
  assert.match(readFileSync(`${ROOT}admin/vendor/mediabunny.LICENSE.txt`, 'utf8'), /Mozilla Public License/);
  for (const name of ['Input', 'BlobSource', 'VideoSampleSink', 'CanvasSource', 'Mp4OutputFormat', 'canEncodeVideo']) {
    assert.match(vendor, new RegExp(`\\b${name}\\b`), name);
  }

  const publicFiles = ['index.html', 'privacy/index.html', 'terms/index.html', ...readdirSync(`${ROOT}assets/js`).filter(f => f.endsWith('.js')).map(f => `assets/js/${f}`),
    ...readdirSync(`${ROOT}assets/js/xp`).filter(f => f.endsWith('.js')).map(f => `assets/js/xp/${f}`)];
  for (const file of publicFiles) {
    let text = '';
    try { text = readFileSync(`${ROOT}${file}`, 'utf8'); } catch { continue; }
    assert.doesNotMatch(text, /admin\/vendor|mediabunny/i, file);
  }

  // the admin loads it only on demand (import()), never with a <script> tag
  const admin = readFileSync(`${ROOT}admin/index.html`, 'utf8');
  assert.doesNotMatch(admin, /vendor/);
  assert.match(admin, /media-src 'self' blob:/, 'the trimmer\'s preview (a blob: URL) is allowed on the admin page');
  assert.match(readFileSync(`${ROOT}admin/admin-app.js`, 'utf8'), /import\(vendorUrl\(\)\)/);
});
