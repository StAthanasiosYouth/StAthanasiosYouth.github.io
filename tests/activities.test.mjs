// Activities + Types (competitions, trips, plays...), the archive and
// «استخدم تاني», end to end through the admin API and the publish build.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './fakes/gas.mjs';

const ADMIN = 'menazakmena@gmail.com';
const plain = value => JSON.parse(JSON.stringify(value));

function world() {
  const w = createWorld();
  w.as(ADMIN).gs.setup();
  return w;
}

const build = (gs, now = '2026-10-08T12:00') => plain(gs.buildPublicContent(gs.readDraft_(), { now }));

const BIBLE = {
  type: 'competition', title: 'مسابقة الكتاب المقدس', subtitle: 'سفر أعمال الرسل',
  url: 'https://forms.gle/bible', startAt: '2026-10-09 18:00', endAt: '2026-10-16 23:00',
  notify: { publish: true, start: true }
};

const TRIP = {
  type: 'trip', title: 'رحلة الغردقة', subtitle: 'يوم كامل على البحر', url: 'https://forms.gle/trip',
  location: 'الغردقة', startAt: '2026-10-16 07:00', visibleFrom: '2026-10-05 10:00', notify: { publish: true }
};


test('the seeded types: competitions apart, everything else in activities', () => {
  const gs = world().as(ADMIN).gs;
  const types = plain(gs.readTable_('Types'));
  assert.deepEqual(types.filter(t => t.section === 'competitions').map(t => t.key), ['competition']);
  assert.ok(['trip', 'play', 'black-theatre', 'mime', 'conference', 'retreat', 'party', 'occasion', 'activity', 'other'].every(k => types.some(t => t.key === k && t.section === 'activities')));
});

test('a competition and a trip are published in their own sections, with notifications', () => {
  const gs = world().as(ADMIN).gs;
  gs.apiSaveItem('activities', BIBLE);
  gs.apiSaveItem('activities', TRIP);
  const { content, errors } = build(gs);
  assert.deepEqual(errors, []);

  const bible = content.activities.find(a => a.title === 'مسابقة الكتاب المقدس');
  assert.equal(bible.section, 'competitions');
  assert.deepEqual(bible.cta, { label: 'ابدأ المسابقة', url: 'https://forms.gle/bible' });
  assert.equal(bible.visibleUntil, '2026-10-16T23:00', 'shows until its end by default');
  const trip = content.activities.find(a => a.title === 'رحلة الغردقة');
  assert.equal(trip.section, 'activities');
  assert.equal(trip.cta.label, 'سجّل في الرحلة');
  assert.deepEqual(content.types.map(t => t.key).sort(), ['competition', 'trip']);

  const ids = content.notifications.map(n => n.id);
  assert.ok(ids.includes(`notif-${bible.id}`) && ids.includes(`notif-${bible.id}-start`));
  const published = content.notifications.find(n => n.id === `notif-${bible.id}`);
  assert.equal(published.type, 'competition');
  assert.equal(published.title, 'المسابقة الجديدة بدأت: مسابقة الكتاب المقدس');
  assert.deepEqual(published.target, { kind: 'activity', id: bible.id });
  assert.equal(content.notifications.find(n => n.id === `notif-${trip.id}`).title, 'التسجيل للرحلة فتح: رحلة الغردقة');
});

test('a new type works without touching code', () => {
  const gs = world().as(ADMIN).gs;
  gs.apiSaveItem('types', { isNew: true, key: 'bazaar', label: 'بازار', section: 'activities', icon: 'gift', theme: 'rose', ctaDefault: 'شوف المعروضات' });
  gs.apiSaveItem('activities', { type: 'bazaar', title: 'بازار الخدمة', url: 'https://example.org/bazaar' });
  const { content, errors } = build(gs);
  assert.deepEqual(errors, []);
  assert.equal(content.activities[0].cta.label, 'شوف المعروضات');
  assert.deepEqual(content.types[0], { key: 'bazaar', label: 'بازار', icon: 'gift', theme: 'rose', banner: null });
  assert.throws(() => gs.apiSaveItem('types', { isNew: true, key: 'bazaar', label: 'x', section: 'activities' }), /نفس المفتاح/);
  assert.throws(() => gs.apiSaveItem('types', { isNew: true, key: 'x2', label: 'x', section: 'news' }), /قسم مسابقات أو فعاليات/);
  assert.throws(() => gs.apiDeleteItem('types', 'bazaar'), /عليه فعاليات/);
});

test('validation: type required, https links, start before end', () => {
  const gs = world().as(ADMIN).gs;
  assert.throws(() => gs.apiSaveItem('activities', { title: 'x' }), /النوع مطلوب/);
  assert.throws(() => gs.apiSaveItem('activities', { type: 'trip', title: 'x', url: 'http://x.com' }), /https/);
  assert.throws(() => gs.apiSaveItem('activities', { type: 'trip', title: 'x', startAt: '2026-10-10 10:00', endAt: '2026-10-09' }), /قبل ميعاد النهاية/);
  assert.throws(() => gs.apiSaveItem('activities', { type: 'trip', title: '' }), /العنوان مطلوب/);
});

test('section wins: competitions hidden → no competition, no its notifications', () => {
  const gs = world().as(ADMIN).gs;
  gs.apiSaveItem('activities', BIBLE);
  gs.apiSaveItem('activities', TRIP);
  gs.apiSetSectionEnabled('competitions', false);
  const { content, errors } = build(gs);
  assert.deepEqual(errors, []);
  assert.deepEqual(content.activities.map(a => a.section), ['activities']);
  assert.ok(!content.notifications.some(n => n.type === 'competition'));
  assert.ok(!content.layout.some(s => s.key === 'competitions'));
});

test('ended items drop out; a type switched off hides its items', () => {
  const gs = world().as(ADMIN).gs;
  gs.apiSaveItem('activities', { ...BIBLE, startAt: '2026-09-01 10:00', endAt: '2026-09-02 10:00', notify: {} });
  let built = build(gs);
  assert.deepEqual(built.content.activities, []);
  assert.ok(built.warnings.some(w => /خلصت/.test(w.message)));

  gs.apiSaveItem('activities', TRIP);
  gs.apiSaveItem('types', { key: 'trip', label: 'رحلة', section: 'activities', enabled: false });
  built = build(gs);
  assert.ok(built.errors.some(e => /مقفول/.test(e.message)), 'the admin is told why');
});

test('archive: out of the site and the daily list; back again; «استخدم تاني» makes a hidden copy', () => {
  const gs = world().as(ADMIN).gs;
  gs.apiSaveItem('activities', TRIP);
  gs.apiSaveItem('news', { title: 'خبر قديم', summary: 'x' });
  const trip = plain(gs.readTable_('Activities'))[0];
  const news = plain(gs.readTable_('News'))[0];

  gs.apiSetItemArchived('activities', trip.id, true);
  gs.apiSetItemArchived('news', news.id, true);
  let { content } = build(gs);
  assert.deepEqual(content.activities, []);
  assert.deepEqual(content.news, []);
  assert.equal(gs.readTable_('Activities').length, 1, 'kept, not deleted');

  gs.apiSetItemArchived('news', news.id, false);
  assert.equal(build(gs).content.news.length, 1);

  const copy = plain(gs.apiDuplicateItem('activities', trip.id));
  const rows = plain(gs.readTable_('Activities'));
  const dup = rows.find(r => r.id === copy.id);
  assert.equal(dup.title, 'رحلة الغردقة (نسخة)');
  assert.equal(dup.enabled, false, 'hidden until edited');
  assert.equal(dup.archived, false);
  assert.deepEqual([dup.startAt, dup.visibleFrom], ['', ''], 'no old dates');
  assert.equal(dup.location, 'الغردقة', 'the rest is reused');
  assert.throws(() => gs.apiSetItemArchived('types', 'trip', true), /مبيتأرشفش/);
});

test('a notification can point to an activity', () => {
  const gs = world().as(ADMIN).gs;
  gs.apiSaveItem('activities', { ...TRIP, notify: {} });
  const trip = plain(gs.readTable_('Activities'))[0];
  gs.apiSaveItem('notifications', { title: 'افتكروا الرحلة', type: 'activity', target: 'activity:' + trip.id });
  assert.throws(() => gs.apiSaveItem('notifications', { title: 'x', target: 'activity:act-missing' }), /مش موجودة/);
  const { content } = build(gs);
  assert.deepEqual(content.notifications[0].target, { kind: 'activity', id: trip.id });
});

test('deleting an activity removes its linked notifications', () => {
  const gs = world().as(ADMIN).gs;
  gs.apiSaveItem('activities', BIBLE);
  const bible = plain(gs.readTable_('Activities'))[0];
  assert.equal(gs.readTable_('Notifications').length, 2);
  gs.apiDeleteItem('activities', bible.id);
  assert.equal(gs.readTable_('Notifications').length, 0);
});
