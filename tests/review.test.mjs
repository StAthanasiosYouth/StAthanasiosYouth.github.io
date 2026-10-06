// The review before publishing (Review.gs): what will change, in plain
// words, grouped the way the admin thinks (الاجتماع، الأخبار، المسابقات…),
// with "يظهر …" for scheduled things and no noise for things that simply
// ended on time.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGs } from '../tools/lib/gs.mjs';

const gs = loadGs();
const plain = value => JSON.parse(JSON.stringify(value));
const NOW = '2026-10-06T12:00';

const LAYOUT = [
  { key: 'meeting', kind: 'meeting', title: 'ركن الاجتماع' },
  { key: 'news', kind: 'news', title: 'جديد الأسرة' },
  { key: 'competitions', kind: 'items', title: 'المسابقات' },
  { key: 'social', kind: 'links', title: 'تابعنا' }
];

function base() {
  return {
    site: { name: 'أسرة البابا أثناسيوس' },
    meeting: { title: 'اجتماع الشباب', day: 0, time: '20:00' },
    location: null,
    announcement: null,
    featured: [],
    sections: [{ key: 'social', title: 'تابعنا', links: [{ id: 'fb', title: 'فيسبوك', url: 'https://facebook.com/x' }] }],
    contacts: [],
    sessions: [],
    news: [],
    games: [],
    notifications: [],
    activities: [],
    types: [{ key: 'competition', label: 'مسابقة' }, { key: 'trip', label: 'رحلة' }],
    layout: LAYOUT.map(s => ({ ...s }))
  };
}

const describe = (before, after, now = NOW) => plain(gs.describeChanges(before, after, now));
const texts = entries => entries.map(e => e.text);


test('nothing changed: nothing to say', () => {
  assert.deepEqual(describe(base(), base()), []);
});

test('the meeting topic, in the words the admin uses, with when it appears', () => {
  const after = base();
  after.sessions = [{ date: '2026-10-11', topic: 'حياة التسليم', status: 'normal', visibleFrom: '2026-10-08T20:00' }];
  assert.deepEqual(describe(base(), after), [{
    group: 'meeting', tone: 'add',
    text: 'موضوع الاجتماع (الأحد ١١ أكتوبر): حياة التسليم',
    when: 'يظهر الخميس ٨ أكتوبر، ٨:٠٠ م'
  }]);
});

test('a cancelled meeting and one that comes back', () => {
  const before = base();
  before.sessions = [{ date: '2026-10-11', topic: '', status: 'normal' }, { date: '2026-10-18', topic: '', status: 'cancelled' }];
  const after = base();
  after.sessions = [{ date: '2026-10-11', topic: '', status: 'cancelled' }, { date: '2026-10-18', topic: '', status: 'normal' }];
  assert.deepEqual(texts(describe(before, after)), ['إلغاء اجتماع الأحد ١١ أكتوبر', 'الاجتماع راجع الأحد ١٨ أكتوبر']);
});

test('the weekly time, said plainly', () => {
  const after = base();
  after.meeting = { ...after.meeting, day: 5, time: '19:30' };
  assert.deepEqual(texts(describe(base(), after)), ['معاد الاجتماع بقى: كل الجمعة، ٧:٣٠ م']);
});

test('competitions and activities are named as such, with their type', () => {
  const after = base();
  after.activities = [
    { id: 'act-1', type: 'competition', section: 'competitions', title: 'مسابقة الكتاب المقدس', startAt: '2026-10-07T18:00' },
    { id: 'act-2', type: 'trip', section: 'activities', title: 'رحلة الغردقة', startAt: '2026-10-20T07:00', visibleFrom: '' }
  ];
  const entries = describe(base(), after);
  assert.deepEqual(entries.map(e => [e.group, e.text, e.when]), [
    ['competitions', 'مسابقة جديدة: مسابقة الكتاب المقدس', 'يبدأ الأربعاء ٧ أكتوبر، ٦:٠٠ م'],
    ['activities', 'فعالية جديدة (رحلة): رحلة الغردقة', 'يبدأ الثلاثاء ٢٠ أكتوبر، ٧:٠٠ ص']
  ]);
});

test('news: new (already visible = no "when"), edited, taken down', () => {
  const before = base();
  before.news = [{ id: 'n1', title: 'قديم' }, { id: 'n2', title: 'هيتشال', expireAt: '2026-12-01T00:00' }];
  const after = base();
  after.news = [{ id: 'n1', title: 'قديم', summary: 'تفاصيل' }, { id: 'n3', title: 'رحلة', publishAt: '2026-10-01T10:00' }];
  assert.deepEqual(describe(before, after).map(e => [e.tone, e.text, e.when]), [
    ['change', 'تعديل خبر: قديم', ''],
    ['add', 'خبر جديد: رحلة', ''],
    ['remove', 'خبر هيختفي: هيتشال', '']
  ]);
});

test('things that simply ended on time are not reported as removed', () => {
  const before = base();
  before.news = [{ id: 'n1', title: 'انتهى', expireAt: '2026-10-05T23:59' }];
  before.games = [{ id: 'g1', title: 'لعبة خلصت', endAt: '2026-10-04T22:00' }];
  before.sessions = [{ date: '2026-10-04', topic: 'فات', status: 'normal' }];
  before.notifications = [{ id: 'x', title: 'قديم', expireAt: '2026-10-06T11:00' }];
  assert.deepEqual(describe(before, base()), []);
});

test('sections: shown, hidden, moved, restyled', () => {
  const before = base();
  const after = base();
  after.layout = [
    { key: 'news', kind: 'news', title: 'جديد الأسرة', theme: 'ember' },
    { key: 'meeting', kind: 'meeting', title: 'ركن الاجتماع' },
    { key: 'social', kind: 'links', title: 'تابعنا' },
    { key: 'activities', kind: 'items', title: 'الفعاليات', visibleFrom: '2026-10-10T09:00' }
  ];
  assert.deepEqual(describe(before, after).map(e => [e.text, e.when]), [
    ['تعديل قسم: جديد الأسرة', ''],
    ['قسم هيظهر: الفعاليات', 'يظهر السبت ١٠ أكتوبر، ٩:٠٠ ص'],
    ['قسم هيختفي: المسابقات', ''],
    ['ترتيب أقسام الصفحة اتغير', '']
  ]);
});

test('the first publish after the upgrade: one line for the new page layout', () => {
  const before = base();
  delete before.layout;
  delete before.activities;
  delete before.types;
  const lines = texts(describe(before, base()));
  assert.ok(lines.includes('شكل الصفحة الجديد: ترتيب الأقسام وألوانها وظهورها'));
  assert.ok(!lines.some(l => l.startsWith('قسم هيظهر')), 'not every section listed as new');
});

test('groups come in the review order, each with its icon', () => {
  const after = base();
  after.news = [{ id: 'n3', title: 'رحلة' }];
  after.sessions = [{ date: '2026-10-11', topic: 'حياة التسليم', status: 'normal' }];
  after.notifications = [{ id: 'notif-1', title: 'خبر جديد' }];
  const groups = plain(gs.groupChanges_(gs.describeChanges(base(), after, NOW)));
  assert.deepEqual(groups.map(g => [g.key, g.title, g.icon, g.items.length]), [
    ['meeting', 'الاجتماع', 'church', 1],
    ['news', 'الأخبار', 'megaphone', 1],
    ['notifications', 'الجرس', 'bell', 1]
  ]);
});

test('a game visible later says يظهر; a type going public with its first item is not news', () => {
  const after = base();
  after.games = [{ id: 'g', title: 'لعبة', visibleFrom: '2026-10-09T20:00', startAt: '2026-10-09T21:00', endAt: '2026-10-09T22:00' }];
  after.types = after.types.concat({ key: 'party', label: 'حفلة' });
  assert.deepEqual(describe(base(), after).map(e => [e.text, e.when]), [['لعبة جديدة: لعبة', 'يظهر الجمعة ٩ أكتوبر، ٨:٠٠ م']]);
});

test('plain lines carry the "when"', () => {
  const after = base();
  after.news = [{ id: 'n3', title: 'رحلة', publishAt: '2026-10-08T12:00' }];
  assert.deepEqual(plain(gs.summarizeChanges(base(), after, NOW)), ['خبر جديد: رحلة — يظهر الخميس ٨ أكتوبر، ١٢:٠٠ م']);
  assert.deepEqual(plain(gs.summarizeChanges(null, after)), ['أول نشر للموقع']);
});
