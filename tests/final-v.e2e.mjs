// final/v in a real browser (headless Chrome, WebCodecs): the official
// admin (/admin/, static) cuts a short clip out of a local video with the
// trimmer (AdminTrim.html + admin/vendor/mediabunny.js) and uploads ONLY the
// clip; then a link's «صور وفيديوهات المشهد» takes it with «من» / «لحد»
// (checked live, save blocked while wrong) and ↑ / ↓ ordering. The recovery
// admin (HtmlService) has no trimmer and says so.
//
// The test video is made at test time with ffmpeg (H.264 + AAC, 10 s,
// 25 fps) in a temp folder; without ffmpeg the trimmer test is skipped.
//
// Run: cd tools && node --test --test-concurrency=1 ../tests/final-v.e2e.mjs

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';
import { createAdminServer, createSiteServer, interceptGoogle, TEST_API, TEST_CLIENT, TEST_FALLBACK } from '../tools/lib/admin-server.mjs';
import { createWorld } from './fakes/gas.mjs';

const require = createRequire(`${ROOT}tools/package.json`);
const puppeteer = require('puppeteer-core');
const sharp = require('sharp');

const PORT = 4560;
const RECOVERY_PORT = 4561;
const LOCAL = `http://127.0.0.1:${PORT}`;
const SITE = 'https://stathanasiosyouth.github.io';
const BASE = `${SITE}/`;
const ADMIN_URL = `${BASE}admin/`;
const ADMIN = 'menazakmena@gmail.com';
const DESKTOP = { width: 1366, height: 900 };

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find(existsSync);

/* ffmpeg (and ffprobe next to it): FFMPEG, else the PATH */
function findTool(name) {
  const fromEnv = name === 'ffmpeg' ? process.env.FFMPEG : process.env.FFPROBE;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  try {
    const found = execFileSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/)[0].trim();
    return found && existsSync(found) ? found : '';
  }
  catch {
    if (name === 'ffprobe' && process.env.FFMPEG) {
      const next = join(dirname(process.env.FFMPEG), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
      return existsSync(next) ? next : '';
    }
    return '';
  }
}

// screenshots for review (not compared): tools/.cache/review/v/
const SHOTS = `${ROOT}tools/.cache/review/v/`;
const shot = (page, name) => page.screenshot({ path: `${SHOTS}${name}.png` }).catch(() => {});

const FFMPEG = findTool('ffmpeg');
const FFPROBE = findTool('ffprobe');

let world;
let server;
let browser;
let dir;
let source;
let bodies;
let imageId;

test.before(async () => {
  world = createWorld({ executeAs: 'USER_DEPLOYING' });
  world.as(ADMIN).gs.setup();
  world.properties.set('GITHUB_TOKEN', 'test-token');
  world.properties.set('GITHUB_REPO', 'StAthanasiosYouth/StAthanasiosYouth.github.io');
  world.properties.set('SITE_URL', BASE);
  world.properties.set('ADMIN_CLIENT_ID', TEST_CLIENT);
  const picture = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#7a3b1d' } }).webp().toBuffer();
  imageId = world.gs.apiUploadMedia({ full: picture.toString('base64'), thumb: picture.toString('base64'), mime: 'image/webp', width: 300, height: 300, alt: 'بوستر' }).media.id;
  world.gs.SESSION_STALE_SECONDS = 0;
  world.as('');

  bodies = [];
  server = createSiteServer({
    world: { issueToken: c => world.issueToken(c), get github() { return world.github; } },
    config: () => ({ apiUrl: TEST_API, clientId: TEST_CLIENT, fallbackUrl: TEST_FALLBACK }),
    claims: () => ({ email: ADMIN })
  });
  await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });

  mkdirSync(SHOTS, { recursive: true });
  dir = mkdtempSync(join(tmpdir(), 'final-v-'));
  if (FFMPEG) {
    source = join(dir, 'رحلة_الغردقة.mp4');
    execFileSync(FFMPEG, ['-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
      '-t', '10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-c:a', 'aac', '-shortest', source]);
  }
});

test.after(async () => {
  await browser?.close();
  await new Promise(resolve => (server ? server.close(resolve) : resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function openAdmin() {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', message => { if (/Content Security Policy|Refused to/i.test(message.text())) problems.push(`csp: ${message.text()}`); });
  page.on('dialog', async dialog => { problems.push(`native ${dialog.type()}`); await dialog.dismiss(); });
  await interceptGoogle(page, { post: body => { bodies.push(body); return world.post(body); } }, { site: { origin: SITE, local: LOCAL } });
  await page.setViewport(DESKTOP);
  await page.goto(ADMIN_URL, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.gis-stub');
  await page.click('.gis-stub');
  await page.waitForFunction(() => window.A && A.state && !document.getElementById('shell').hidden, { timeout: 15000 });
  return { page, problems, close: () => context.close() };
}

const setValue = (page, selector, value) => page.$eval(selector, (input, v) => {
  input.value = v;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}, value);

/* the uploaded clip in the fake Drive */
function driveBytes(name) {
  const file = [...world.drive.files.values()].find(f => f.meta.name === name);
  return file ? Buffer.from(file.bytes.map(b => (b < 0 ? b + 256 : b))) : null;
}

let clipId = '';

test('the trimmer cuts 4 s out of a local video and uploads only that clip (H.264, silent, 540×960, faststart, poster)', { skip: !FFMPEG && 'ffmpeg not found' }, async () => {
  const { page, problems, close } = await openAdmin();
  await page.evaluate(() => A.go('media'));
  await page.waitForSelector('.media-view');
  assert.ok(await page.evaluate(() => A.trimmerAvailable()), 'the official admin has the trimmer');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('script')].some(s => /vendor/.test(s.src))), false, 'not loaded yet');

  const input = await page.$('.card input[type=file]');
  assert.equal(await input.evaluate(n => n.accept), 'image/*,video/*');
  await input.uploadFile(source);

  await page.waitForSelector('dialog.trim[open]');
  await page.waitForFunction(() => !document.querySelector('dialog.trim .modal__actions .btn--primary').disabled, { timeout: 30000 });
  const facts = await page.$eval('dialog.trim .trim__facts', n => n.textContent);
  assert.match(facts, /0:10/);
  assert.match(facts, /1280×720/);
  assert.match(facts, /H\.264/);
  assert.equal(await page.evaluate(() => performance.getEntriesByType('resource').some(e => /admin\/vendor\/mediabunny\.js$/.test(e.name))), true, 'loaded on demand');

  // a wrong clip: the make button waits, the message says why
  await setValue(page, 'dialog.trim input[aria-label="من"]', '0:06');
  await setValue(page, 'dialog.trim input[aria-label="لحد"]', '0:02');
  assert.match(await page.$eval('dialog.trim .trim__msg', n => n.textContent), /بعد «من»/);
  assert.equal(await page.$eval('dialog.trim .modal__actions .btn--primary', n => n.disabled), true);
  await setValue(page, 'dialog.trim input[aria-label="لحد"]', '0:45');
  assert.match(await page.$eval('dialog.trim .trim__msg', n => n.textContent), /بيخلص عند 0:10/);

  await setValue(page, 'dialog.trim input[aria-label="من"]', '2');
  await setValue(page, 'dialog.trim input[aria-label="لحد"]', '0:06');
  assert.match(await page.$eval('dialog.trim .trim__msg', n => n.textContent), /0:04/);
  assert.equal(await page.$eval('dialog.trim input[value="tall"]', n => n.checked), true, 'portrait by default');
  await page.evaluate(() => { const v = document.querySelector('dialog.trim video'); v.currentTime = 2.5; });
  await new Promise(resolve => setTimeout(resolve, 300));
  await shot(page, '01-trimmer');

  const before = bodies.length;
  await page.click('dialog.trim .modal__actions .btn--primary');
  await page.waitForFunction(() => !document.querySelector('dialog.trim'), { timeout: 90000 });
  await page.waitForFunction(() => /المقطع اترفع/.test(document.querySelector('.upload__label')?.textContent || ''), { timeout: 30000 });

  const row = world.gs.readTable_('Media').find(r => /^vid-/.test(r.id));
  assert.ok(row, 'a vid- item in the library');
  clipId = row.id;
  assert.equal(row.mime, 'video/mp4');
  assert.deepEqual([Number(row.width), Number(row.height)], [540, 960]);
  assert.equal(row.name, 'رحلة الغردقة', 'a clean name');

  const clip = driveBytes(`${row.id}.mp4`);
  const poster = driveBytes(row.thumb.split('/').pop());
  assert.ok(clip && clip.length < 8 * 1024 * 1024);
  assert.equal(clip.subarray(4, 8).toString('latin1'), 'ftyp');
  assert.ok(clip.indexOf('moov') < clip.indexOf('mdat'), 'faststart: moov first');
  assert.ok(poster && poster.subarray(0, 4).toString('latin1') === 'RIFF' && poster.subarray(8, 12).toString('latin1') === 'WEBP', 'a WebP poster');

  // only the clip went to the server: never the original
  const original = readFileSync(source);
  const sent = bodies.slice(before);
  const middle = Math.floor(original.length / 6) * 3;
  const probe = original.subarray(middle, middle + 3000).toString('base64');
  assert.ok(!sent.some(body => body.includes(probe)), 'no part of the original was sent');
  assert.ok(!sent.some(body => body.includes(original.subarray(0, 600).toString('base64'))), 'not even its header');
  assert.notDeepEqual(clip, original);

  if (FFPROBE) {
    const file = join(dir, 'clip.mp4');
    writeFileSync(file, clip);
    const info = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { encoding: 'utf8' }));
    const videos = info.streams.filter(s => s.codec_type === 'video');
    assert.equal(videos.length, 1);
    assert.equal(info.streams.filter(s => s.codec_type === 'audio').length, 0, 'silent');
    assert.equal(videos[0].codec_name, 'h264');
    assert.deepEqual([videos[0].width, videos[0].height], [540, 960]);
    assert.ok(Math.abs(Number(info.format.duration) - 4) < 0.2, `duration ${info.format.duration}`);
    assert.match(videos[0].r_frame_rate, /^30\/1$/);
  }

  // the tile: the poster with a play mark
  await page.waitForSelector(`.media-tile.is-video .media-tile__play`);
  await shot(page, '02-library');
  assert.deepEqual(problems, []);
  await close();
});

test('the scene gallery: a clip with «من» / «لحد» checked live, save blocked while wrong, ↑ / ↓ order', { skip: !FFMPEG && 'needs the clip from the trimmer test' }, async () => {
  assert.ok(clipId, 'the clip from the trimmer test');
  const { page, problems, close } = await openAdmin();
  // a new tab: it knows the clip's length only once published, so tell it like the uploading tab would
  await page.evaluate(id => { A.videoDurations[id] = 4; }, clipId);
  const link = await page.evaluate(() => A.state.draft.links.find(l => l.icon === 'instagram'));
  await page.evaluate(id => A.editLink(A.state.draft.links.find(l => l.id === id)), link.id);
  await page.waitForSelector('dialog.sheet[open] .gallery-picker');
  assert.match(await page.$eval('dialog.sheet[open] .gallery-picker .field__label', n => n.textContent), /محتوى المشهد/);

  const addFromLibrary = async kind => {
    await page.evaluate(() => [...document.querySelectorAll('dialog.sheet[open] .gallery-picker button')].find(b => b.textContent.includes('زوّد')).click());
    await page.waitForSelector('dialog.picker-dialog[open] .media-tile');
    await page.evaluate(k => [...document.querySelectorAll('dialog.picker-dialog[open] .media-tile')].find(t => t.classList.contains('is-video') === (k === 'video')).click(), kind);
    await page.waitForFunction(() => !document.querySelector('dialog.picker-dialog'));
  };
  await addFromLibrary('image');
  await addFromLibrary('video');
  const items = () => page.$$eval('dialog.sheet[open] .gallery-picker__item', list => list.map(n => n.dataset.kind));
  assert.deepEqual(await items(), ['image', 'video']);

  const from = 'dialog.sheet[open] .gallery-picker__item[data-kind=video] input[aria-label^="من"]';
  const to = 'dialog.sheet[open] .gallery-picker__item[data-kind=video] input[aria-label^="لحد"]';
  const msg = () => page.$eval('dialog.sheet[open] .gallery-picker__item[data-kind=video] .gallery-picker__msg', n => (n.hidden ? '' : n.textContent));
  assert.match(await page.$eval('dialog.sheet[open] .gallery-picker__len', n => n.textContent), /0:04/);

  await setValue(page, from, '3');
  await setValue(page, to, '1');
  assert.match(await msg(), /بعد «من»/);
  await setValue(page, to, '0:09');
  assert.match(await msg(), /بيخلص عند 0:04/);
  await page.$eval('dialog.sheet[open] .gallery-picker', n => n.scrollIntoView({ block: 'center' }));
  await shot(page, '03-gallery-invalid');

  // save: blocked, the editor stays open, nothing sent
  const calls = bodies.length;
  await page.evaluate(() => document.querySelector('dialog.sheet[open] .sheet__foot .btn--primary').click());
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(await page.evaluate(() => document.querySelector('dialog.sheet').open), true);
  assert.ok(!bodies.slice(calls).some(b => JSON.parse(b).fn === 'apiSaveLink'), 'not sent');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-label')), 'من (الفيديو 2)');

  await setValue(page, from, '0:01');
  await setValue(page, to, '3.5');
  assert.equal(await msg(), '');

  // the video first: ↑ on the second item; the focus stays on the moved item
  await page.click('dialog.sheet[open] .gallery-picker__item:nth-child(2) [data-move="up"]');
  assert.deepEqual(await items(), ['video', 'image']);
  assert.equal(await page.evaluate(() => document.activeElement.closest('.gallery-picker__item').dataset.kind), 'video');
  assert.equal(await page.$eval('dialog.sheet[open] .gallery-picker__item:first-child [data-move="up"]', n => n.disabled), true);

  await page.evaluate(() => document.querySelector('dialog.sheet[open] .sheet__foot .btn--primary').click());
  await page.waitForFunction(() => !document.querySelector('dialog.sheet').open, { timeout: 15000 });
  const saved = world.gs.readTable_('Links').find(l => l.id === link.id);
  assert.equal(saved.gallery, `${clipId}@1-3.5,${imageId}`);

  // the published shape, ready for the scene
  world.as(ADMIN);
  const built = JSON.parse(JSON.stringify(world.gs.buildDraft_()));
  world.as('');
  const published = [...built.content.featured, ...built.content.sections.flatMap(s => s.links)].find(l => l.id === link.id);
  assert.deepEqual([published.gallery[0].type, published.gallery[0].start, published.gallery[0].end], ['video', 1, 3.5]);
  assert.ok(built.media.includes(clipId));

  // every other image field lists pictures only
  await page.evaluate(() => A.editContact(A.state.draft.contacts.find(c => c.kind === 'support')));
  await page.waitForSelector('dialog.sheet[open] .picker--avatar');
  await page.evaluate(() => [...document.querySelectorAll('dialog.sheet[open] .picker--avatar button')].find(b => b.textContent.includes('من المكتبة')).click());
  await page.waitForSelector('dialog.picker-dialog[open] .media-tile');
  assert.equal(await page.$$eval('dialog.picker-dialog[open] .media-tile.is-video', n => n.length), 0);
  assert.deepEqual(problems, []);
  await close();
});

test('the recovery admin (Apps Script) has no trimmer: it says to use /admin/', async () => {
  const recovery = createWorld();
  recovery.as(ADMIN).gs.setup();
  const admin = createAdminServer({ world: recovery, admin: ADMIN, latency: 10 });
  await new Promise(resolve => admin.listen(RECOVERY_PORT, '127.0.0.1', resolve));
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(error.message));
  page.on('dialog', async dialog => { problems.push(`native ${dialog.type()}`); await dialog.dismiss(); });
  try {
    await page.setViewport(DESKTOP);
    await page.goto(`http://localhost:${RECOVERY_PORT}/`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.A && A.state);
    await page.evaluate(() => A.go('media'));
    await page.waitForSelector('.media-view');
    assert.equal(await page.evaluate(() => A.trimmerAvailable()), false);
    assert.match(await page.evaluate(() => document.querySelector('.view').textContent), /لوحة التحكم الرسمية \(\/admin\/\)/);
    const file = join(dir, 'any.mp4');
    writeFileSync(file, Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(64)]));
    await (await page.$('.card input[type=file]')).uploadFile(file);
    await page.waitForSelector('.upload-error:not([hidden])');
    assert.match(await page.$eval('.upload-error', n => n.textContent), /قصّ الفيديو شغال من لوحة التحكم الرسمية بس/);
    assert.equal(await page.$('dialog.trim'), null);
    assert.deepEqual(problems, []);
  }
  finally {
    await context.close();
    await new Promise(resolve => admin.close(resolve));
  }
});
