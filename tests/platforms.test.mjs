// The link-experience registry (assets/js/platforms.js): which scene a link
// opens, the same on the site and in the publisher (Platforms.gs, generated),
// and the schema-4 fields (contact cards, a scene's own photos).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROOT } from '../tools/lib/gs.mjs';
import { platformsGs } from '../tools/lib/platforms-gs.mjs';
import { PLATFORMS, SCENES, resolveExperience, experienceKey } from '../assets/js/platforms.js';
import { createWorld } from './fakes/gas.mjs';

const ADMIN = 'menazakmena@gmail.com';
const plain = value => JSON.parse(JSON.stringify(value));


test('Platforms.gs is generated from platforms.js (run: npm run sync)', () => {
  assert.equal(readFileSync(`${ROOT}apps-script/Platforms.gs`, 'utf8').replace(/\r\n/g, '\n'), platformsGs());
});

test('every platform names a known scene and valid hosts', () => {
  for (const [key, p] of Object.entries(PLATFORMS)) {
    assert.equal(experienceKey(key), key, key);
    assert.ok(SCENES.includes(p.scene), `${key}: scene ${p.scene}`);
    assert.ok(p.label && p.cta, `${key}: words`);
    for (const host of p.hosts) assert.match(host, /^[a-z0-9.-]+(\/[a-z0-9/-]+)?$/, `${key}: ${host}`);
  }
});

test('auto: explicit choice, then icon, then URL; plain websites stay direct', () => {
  const cases = [
    [{ experience: 'none', icon: 'facebook', url: 'https://facebook.com/x' }, ''],
    [{ experience: 'telegram', icon: 'link', url: 'https://example.com' }, 'telegram'],
    [{ experience: 'web', url: 'https://example.com' }, 'web'],
    [{ experience: 'future-app', url: 'https://example.com' }, 'future-app'],
    [{ experience: 'auto', icon: 'telegram', url: 'https://example.com' }, 'telegram'],
    [{ icon: 'telegram', url: 'https://example.com' }, 'telegram'],
    [{ icon: 'voice', url: 'https://stathanasiosyouth.github.io/your-voice-matters/' }, 'voice'],
    [{ icon: 'link', url: 'https://stathanasiosyouth.github.io/your-voice-matters/' }, 'voice'],
    [{ icon: 'link', url: 'https://t.me/ourchannel' }, 'telegram'],
    [{ icon: 'link', url: 'https://www.youtube.com/@x' }, 'youtube'],
    [{ icon: 'link', url: 'https://m.youtube.com/watch?v=1' }, 'youtube'],
    [{ icon: 'link', url: 'https://youtu.be/abc' }, 'youtube'],
    [{ icon: 'link', url: 'https://www.google.com/maps/place/x' }, 'maps'],
    [{ icon: 'link', url: 'https://www.google.com/search?q=maps' }, ''],
    [{ icon: 'link', url: 'https://maps.app.goo.gl/abc' }, 'maps'],
    [{ icon: 'link', url: 'https://notfacebook.com/x' }, ''],
    [{ icon: 'form', url: 'https://forms.gle/abc' }, ''],
    [{ icon: 'link', url: 'https://example.com' }, ''],
    [{ icon: 'link', url: 'javascript:alert(1)' }, ''],
    [{ experience: 'BAD KEY!', icon: 'whatsapp', url: 'https://example.com' }, 'whatsapp']
  ];
  for (const [link, expected] of cases) {
    assert.equal(resolveExperience(link), expected, JSON.stringify(link));
  }
});

test('the publisher resolves the same way (Telegram icon -> Telegram scene)', () => {
  const w = createWorld();
  const gs = w.as(ADMIN).gs;
  gs.setup();
  gs.apiSaveLink({ title: 'تيليجرام', url: 'https://example.com/channel', section: 'social', icon: 'telegram' });
  gs.apiSaveLink({ title: 'يوتيوب', url: 'https://youtu.be/abc', section: 'social', icon: 'link' });
  gs.apiSaveLink({ title: 'فورم', url: 'https://forms.gle/abc', section: 'social', icon: 'form' });
  gs.apiSaveLink({ title: 'من غير', url: 'https://t.me/x', section: 'social', icon: 'telegram', experience: 'none' });
  const links = plain(gs.buildDraft_()).content.sections.flatMap(s => s.links);
  const by = title => links.find(l => l.title === title).experience;
  assert.equal(by('تيليجرام'), 'telegram');
  assert.equal(by('يوتيوب'), 'youtube');
  assert.equal(by('فورم'), undefined, 'a plain website opens directly');
  assert.equal(by('من غير'), undefined);
  const voice = plain(gs.buildDraft_()).content.featured.find(l => l.icon === 'voice');
  assert.equal(voice.experience, 'voice', '«صوتك يهمنا» gets its own scene');
});


/* ---------------- schema 4 fields ---------------- */

const webp = fill => Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x20, 0, 0, 0]), Buffer.from('WEBPVP8L'), Buffer.alloc(40, fill)]).toString('base64');

function upload(gs, fill) {
  return plain(gs.apiUploadMedia({ full: webp(fill), thumb: webp(fill), mime: 'image/webp', width: 256, height: 256, alt: 'صورة ' + fill })).media;
}

test('contacts: avatar, intro and reply are published; images only for published people', () => {
  const w = createWorld();
  const gs = w.as(ADMIN).gs;
  gs.setup();
  const avatar = upload(gs, 31);
  const support = plain(gs.apiState()).draft.contacts.find(c => c.kind === 'support');
  gs.apiSaveContact({ ...support, image: avatar.id, intro: 'معايا مشكلة', reply: 'أهلاً بيك 👋 ابعتلي المشكلة وأنا هساعدك.' });

  let built = plain(gs.buildDraft_());
  const card = built.content.contacts.find(c => c.kind === 'support');
  assert.equal(card.image.src, avatar.path);
  assert.equal(card.intro, 'معايا مشكلة');
  assert.equal(card.reply, 'أهلاً بيك 👋 ابعتلي المشكلة وأنا هساعدك.');
  assert.ok(built.media.includes(avatar.id), 'the avatar goes out with the publish');
  const service = built.content.contacts.find(c => c.kind === 'service');
  assert.deepEqual(['image', 'intro', 'reply'].filter(k => k in service), [], 'empty fields are left out');

  // an editor that doesn't send the new fields keeps them
  gs.apiSaveContact({ ...plain(gs.apiState()).draft.contacts.find(c => c.kind === 'support'), image: undefined, intro: undefined, reply: undefined, ...{} });
  const row = plain(gs.readTable_('Contacts')).find(c => c.kind === 'support');
  assert.equal(row.image, avatar.id);

  // the support block switched off: its avatar is not published
  gs.apiSetSectionEnabled('support', false);
  built = plain(gs.buildDraft_());
  assert.ok(!built.media.includes(avatar.id));
});

test('links: a scene\'s own photos, only for a published link with a scene', () => {
  const w = createWorld();
  const gs = w.as(ADMIN).gs;
  gs.setup();
  const a = upload(gs, 41);
  const b = upload(gs, 42);
  const link = plain(gs.apiState()).draft.links.find(l => l.icon === 'instagram');
  gs.apiSaveLink({ ...link, gallery: [a.id, b.id] });
  let built = plain(gs.buildDraft_());
  const published = built.content.sections.flatMap(s => s.links).find(l => l.id === link.id);
  assert.deepEqual(published.gallery.map(i => i.src), [a.path, b.path]);
  assert.ok(built.media.includes(a.id) && built.media.includes(b.id));

  gs.apiSaveLink({ ...plain(gs.apiState()).draft.links.find(l => l.id === link.id), enabled: false });
  built = plain(gs.buildDraft_());
  assert.ok(!built.media.includes(a.id), 'a hidden link\'s photos stay private');
});
