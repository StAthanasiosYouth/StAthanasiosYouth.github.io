/*
 * «خبزنا اليومي» P4 — the saints' pictures (docs/daily-bread/saints/P4-PROGRESS.md): the album's types (ai / photo / art),
 * the picture of a day (its occasion first, else the main one, one a year when several), «صورة تعبيرية» on AI and painted
 * pictures, the feasts tab suggesting the album's picture, the month file keeping imgAi, the internal parts unpublished.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, fakeGoogle } from './helpers.mjs';
import { forgetAccessToken } from '../src/push/fcm.js';
import { pictureFor, labelOf, checkPerson, publicFile, ALBUM_TYPES } from '../src/bread/saints.js';
import { checkFeasts } from '../src/bread/model.js';

const KEYS = { PW_PEPPER: 'pepper-test', PW_KEY: Buffer.alloc(32, 7).toString('base64'), OTP_PEPPER: 'otp-test', ACCOUNT_PAD_MS: '0' };
const P = 'p@example.com';
const M = n => `media/2026/img-${String(n).padStart(8, '0')}.webp`;

test('the album types: ai, photo and art (P4); anything else is refused', () => {
  assert.deepEqual(ALBUM_TYPES, ['ai', 'photo', 'art']);
  const person = type => ({ id: 'x', name: 'س', cat: 'c', class: 'reposed', feasts: [], album: [{ media: M(1), type }] });
  assert.deepEqual(checkPerson(person('art'), { cats: { c: 'c' }, statusTyped: false }), []);
  assert.ok(checkPerson(person('drawing'), { cats: { c: 'c' }, statusTyped: false }).some(e => /ai أو photo أو art/.test(e)));
  assert.deepEqual([labelOf({ type: 'ai' }), labelOf({ type: 'art' }), labelOf({ type: 'photo' })], [true, true, false]);
});

test('the picture of a day: its occasion first, else the main one, else the first; several take turns by year', () => {
  const p = { album: [
    { src: 'owner-only.jpg', type: 'photo' },                       // not in the library yet: never chosen
    { media: M(1), type: 'photo', stage: 'الرهبنة' },
    { media: M(2), type: 'photo', main: true },
    { media: M(3), type: 'photo', occasion: 'نياحته' },
    { media: M(4), type: 'ai', occasion: 'نياحته' }
  ] };
  assert.deepEqual(pictureFor(p, 'تذكار رسامته', '2027'), { img: '/' + M(2), ai: false }, 'no picture for that day → the main one');
  assert.deepEqual(pictureFor(p, 'نياحته', '2026'), { img: '/' + M(3), ai: false });
  assert.deepEqual(pictureFor(p, 'نياحته', '2027'), { img: '/' + M(4), ai: true }, 'the next year, the other one');
  assert.deepEqual(pictureFor({ album: [{ media: M(5), type: 'art' }] }, 'x', 2026), { img: '/' + M(5), ai: true }, 'no main → the first; art = «صورة تعبيرية»');
  assert.equal(pictureFor({ album: [{ src: 'a.jpg', type: 'ai' }] }, 'x', 2026), null, 'nothing in the library → null (the old image, if any)');
});

test('the published file: type, stage, occasion, caption and crop go out; the owner file, the credit (source and terms) never', () => {
  const reg = { categories: { c: 'c' }, occasions: [], people: [{ id: 'x', name: 'س', cat: 'c', class: 'reposed', feasts: [],
    album: [{ media: M(1), src: '02/س.jpg', type: 'art', main: true, stage: 'الأسقفية', occasion: 'نياحته', caption: 'في سفاجا', credit: 'فولدر صاحب المشروع · الحقوق غير معروفة', crop: { x: 50, y: 20, z: 1 } }] }] };
  const out = publicFile(reg).people[0].album[0];
  assert.deepEqual(out, { media: M(1), type: 'art', main: true, stage: 'الأسقفية', occasion: 'نياحته', caption: 'في سفاجا', crop: { x: 50, y: 20, z: 1 } });
});

test('the month file: a media library picture is accepted with imgAi; any other picture place is still refused', () => {
  const feast = o => ({ date: '2027-02-12', name: 'الأنبا ثاؤفيلس', word: 'كلمة', url: 'https://example.org/a', ...o });
  const ok = checkFeasts({ month: '2027-02', feasts: [feast({ img: '/media/2026/img-0000000a.webp', imgAi: true })] });
  assert.ok(ok.ok, JSON.stringify(ok.errors));
  assert.equal(JSON.parse(ok.file).feasts[0].imgAi, true);
  const real = JSON.parse(checkFeasts({ month: '2027-02', feasts: [feast({ img: '/media/2026/img-0000000a.webp', imgAi: false })] }).file).feasts[0];
  assert.equal(real.imgAi, undefined, 'a real photo: no label key at all');
  assert.equal(checkFeasts({ month: '2027-02', feasts: [feast({ img: '/media/2026/img-0000000a-480.webp' })] }).ok, false, 'the small copy is for lists, not the card');
  assert.equal(checkFeasts({ month: '2027-02', feasts: [feast({ img: 'https://example.org/x.webp' })] }).ok, false);
  assert.equal(checkFeasts({ month: '2027-02', feasts: [feast({ img: '/media/2026/img-0000000a.webp', imgAi: 'yes' })] }).ok, false);
});

test('the feasts tab suggests the album picture of the day (with imgAi) once published', async () => {
  forgetAccessToken();
  const g = await fakeGoogle();
  const h = harness({ env: { ENVIRONMENT: 'staging', ADMIN_EMAILS: '', ...KEYS } });
  await h.db.prepare(`INSERT INTO admins (email, name, role, active, created_at) VALUES ('${P}', 'P', 'primary', 1, 0)`).run();
  const admin = async (method, path, body) => h.call('/v1/admin/' + path, { method, body, headers: { authorization: 'Bearer ' + await g.sign(g.claims({ email: P, sub: 's-p' })) }, fetch: g.fetch });
  assert.equal((await admin('POST', 'bread/settings', { saints: true })).status, 200);
  const th = (await admin('GET', 'bread/saints')).body.items.find(i => i.id === 'theophilus');
  const album = [
    { media: M(11), type: 'photo', main: true, occasion: 'تذكار رسامته' },
    { media: M(12), type: 'photo', occasion: 'نياحته' },
    { media: M(13), type: 'photo', stage: 'الأسقفية', caption: 'في سفاجا' }
  ];
  const s = await admin('POST', 'bread/saints/item', { kind: 'person', rev: th.rev, item: { ...th.data, album } });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const mercurius = (await admin('GET', 'bread/saints')).body.items.find(i => i.id === 'mercurius');
  assert.equal((await admin('POST', 'bread/saints/item', { kind: 'person', rev: mercurius.rev, item: { ...mercurius.data, album: [{ media: M(21), type: 'ai', main: true }] } })).status, 200);
  const rv = await admin('GET', 'bread/saints/review');
  assert.equal((await admin('POST', 'bread/saints/publish', { expect: rv.body.expect })).status, 200);
  const feb = (await admin('GET', 'bread/saints/feasts?month=2027-02')).body.feasts.find(f => f.id === 'theophilus');
  assert.deepEqual([feb.date, feb.img, feb.imgAi], ['2027-02-12', '/' + M(12), false], 'his repose → the repose picture');
  const abiSefein = (await admin('GET', 'bread/saints/feasts?month=2026-12')).body.feasts.find(f => f.id === 'mercurius');
  assert.deepEqual([abiSefein.img, abiSefein.imgAi], ['/' + M(21), true], 'an AI picture carries the label');
});
