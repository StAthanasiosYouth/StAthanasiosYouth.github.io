// Tests for apps-script/Hub.gs: sessions, news, games, notifications, media.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGs, sha256 } from '../tools/lib/gs.mjs';

const gs = loadGs();
const NOW = '2026-10-08T18:00'; // Thursday

const plain = value => JSON.parse(JSON.stringify(value));

const IMG = { id: 'img-ab12cd34', path: 'media/2026/img-ab12cd34.webp', thumb: 'media/2026/img-ab12cd34-480.webp', width: 1200, height: 1500, alt: 'بوستر' };

function build(mutate = () => {}, now = NOW) {
  const draft = JSON.parse(JSON.stringify(gs.seedDraft()));
  draft.media = [IMG];
  mutate(draft);
  const result = gs.buildPublicContent(draft, { now, hash: sha256 });
  return plain(result);
}

const where = (errors, text) => errors.some(e => e.message.includes(text));


test('wall-clock arithmetic ignores daylight saving and crosses months', () => {
  assert.equal(gs.wallAdd_('2026-10-29T23:30', 60), '2026-10-30T00:30');
  assert.equal(gs.wallAdd_('2026-12-31T22:00', 180), '2027-01-01T01:00');
  assert.equal(gs.wallAdd_('2026-10-08T18:00', 14 * 1440), '2026-10-22T18:00');
  assert.equal(gs.wallAdd_('nope', 5), '');
});

test('schema 3 keeps every schema-1 and schema-2 field', () => {
  const { content, errors } = build();
  assert.deepEqual(errors, []);
  assert.equal(content.schema, 3);
  for (const key of ['site', 'meeting', 'location', 'announcement', 'featured', 'sections', 'contacts']) {
    assert.ok(key in content, key);
  }
  assert.deepEqual([content.sessions, content.news, content.games, content.notifications], [[], [], [], []]);
});


/* ---------- sessions ---------- */

test('sessions: topic, speaker, poster; past ones dropped; sorted', () => {
  const { content, errors } = build(d => {
    d.sessions = [
      { enabled: true, date: '2026-10-18', topic: 'التوبة', speaker: 'أبونا مرقس', status: 'normal' },
      { enabled: true, date: '2026-10-11', time: '20:00', topic: 'حياة التسليم', speaker: 'أبونا أنطوني عياد', image: 'img-ab12cd34', visibleFrom: '2026-10-09 20:00', status: 'normal' },
      { enabled: true, date: '2026-10-04', topic: 'قديم', status: 'normal' },
      { enabled: false, date: '2026-10-25', topic: 'مخفي' }
    ];
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(content.sessions.map(s => s.date), ['2026-10-11', '2026-10-18']);
  const first = content.sessions[0];
  assert.equal(first.topic, 'حياة التسليم');
  assert.equal(first.visibleFrom, '2026-10-09T20:00');
  assert.deepEqual(first.image, { src: IMG.path, thumb: IMG.thumb, w: 1200, h: 1500, alt: 'بوستر' });
});

test('sessions: cancelled dates join the meeting skip dates', () => {
  const { content } = build(d => {
    d.sessions = [{ enabled: true, date: '2026-10-11', status: 'cancelled', note: 'علشان المؤتمر' }];
  });
  assert.deepEqual(content.meeting.skipDates, ['2026-10-11']);
  assert.equal(content.sessions[0].status, 'cancelled');
});

test('sessions: bad date, duplicate date, bad time, unknown image are errors', () => {
  const { errors } = build(d => {
    d.sessions = [
      { enabled: true, date: '11/10/2026' },
      { enabled: true, date: '2026-10-11', time: '25:00' },
      { enabled: true, date: '2026-10-11' },
      { enabled: true, date: '2026-10-18', image: 'img-zzzzzzzz' }
    ];
  });
  assert.ok(where(errors, 'بالشكل 2026-10-11'));
  assert.ok(where(errors, 'نفس التاريخ'));
  assert.ok(where(errors, 'الساعة'));
  assert.ok(where(errors, 'مش موجودة في شيت Media'));
});


/* ---------- news ---------- */

test('news: fields, newest first, expired dropped, link validated', () => {
  const { content, errors, warnings } = build(d => {
    d.news = [
      { id: 'trip', enabled: true, title: 'رحلة الغردقة', summary: 'سجّل اسمك', body: 'التفاصيل\n\n\n\nكتير', image: 'img-ab12cd34', linkUrl: 'https://forms.gle/x', linkLabel: 'سجّل', badge: 'جديد', featured: true, publishAt: '2026-10-08 12:00' },
      { id: 'banner', enabled: true, title: 'مفيش اجتماع الأحد', pinned: true, tone: 'alert', publishAt: '2026-10-09 20:00', expireAt: '2026-10-11' },
      { id: 'old', enabled: true, title: 'قديم', publishAt: '2026-09-01', expireAt: '2026-09-10' }
    ];
  });
  assert.deepEqual(errors, []);
  assert.equal(warnings.length, 1);
  assert.deepEqual(content.news.map(n => n.id), ['banner', 'trip']);
  const trip = content.news[1];
  assert.equal(trip.body, 'التفاصيل\n\nكتير');
  assert.deepEqual(trip.link, { url: 'https://forms.gle/x', label: 'سجّل' });
  assert.equal(content.news[0].expireAt, '2026-10-11T23:59');
  assert.equal(content.news[0].tone, 'alert');

  const bad = build(d => { d.news = [{ id: 'x', enabled: true, title: 'x', linkUrl: 'javascript:alert(1)' }]; });
  assert.ok(where(bad.errors, 'https'));
});


/* ---------- games ---------- */

test('games: times validated, ended-visibility window, afterEnd hide', () => {
  const ok = build(d => {
    d.games = [{ id: 'explore', enabled: true, title: 'رحلة الاستكشاف', url: 'https://example.org/game', visibleFrom: '2026-10-11 21:00', startAt: '2026-10-11 22:00', endAt: '2026-10-11 23:30', afterEnd: 'show' }];
  });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.content.games[0].endedUntil, '2026-10-12T11:30');

  const hidden = build(d => {
    d.games = [{ id: 'g', enabled: true, title: 'x', url: 'https://example.org', startAt: '2026-10-11 22:00', endAt: '2026-10-11 23:30', afterEnd: 'hide' }];
  });
  assert.equal(hidden.content.games[0].endedUntil, '2026-10-11T23:30');

  const over = build(d => {
    d.games = [{ id: 'g', enabled: true, title: 'x', url: 'https://example.org', startAt: '2026-10-01 22:00', endAt: '2026-10-01 23:00' }];
  });
  assert.deepEqual(over.content.games, []);
  assert.equal(over.warnings.length, 1);

  const bad = build(d => {
    d.games = [
      { id: 'a', enabled: true, title: 'a', url: 'http://x.com', startAt: '2026-10-11 22:00', endAt: '2026-10-11 21:00' },
      { id: 'b', enabled: true, title: 'b', url: 'https://x.com', visibleFrom: '2026-10-12', startAt: '2026-10-11 22:00', endAt: '2026-10-11 23:00' },
      { id: 'c', enabled: true, title: 'c', url: 'https://x.com' }
    ];
  });
  assert.ok(where(bad.errors, 'لينك اللعبة'));
  assert.ok(where(bad.errors, 'قبل النهاية'));
  assert.ok(where(bad.errors, 'الظهور لازم يكون قبل'));
  assert.ok(where(bad.errors, 'مطلوبين'));
});


/* ---------- notifications ---------- */

test('notifications: targets, default expiry from history days, newest first', () => {
  const { content, errors } = build(d => {
    d.news = [{ id: 'trip', enabled: true, title: 'رحلة', publishAt: '2026-10-08 12:00' }];
    d.games = [{ id: 'explore', enabled: true, title: 'لعبة', url: 'https://example.org', startAt: '2026-10-11 22:00', endAt: '2026-10-11 23:30' }];
    d.notifications = [
      { id: 'n1', enabled: true, type: 'news', title: 'رحلة جديدة', message: 'سجّل', target: 'news:trip', publishAt: '2026-10-08 12:00' },
      { id: 'n2', enabled: true, type: 'game', title: 'اللعبة جاهزة', target: 'game:explore', publishAt: '2026-10-11 22:00' },
      { id: 'n3', enabled: true, type: 'meeting', title: 'موضوع الأحد', target: 'meeting', publishAt: '2026-10-09 20:00' },
      { id: 'n4', enabled: true, type: 'important', title: 'إعلان', target: 'https://example.org/a', publishAt: '2026-10-07 10:00', expireAt: '2026-10-20' },
      { id: 'n5', enabled: true, title: 'قديم', publishAt: '2026-09-01 10:00' }
    ];
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(content.notifications.map(n => n.id), ['n2', 'n3', 'n1', 'n4']);
  assert.deepEqual(content.notifications[0].target, { kind: 'game', id: 'explore' });
  assert.deepEqual(content.notifications[1].target, { kind: 'meeting' });
  assert.deepEqual(content.notifications[3].target, { kind: 'url', url: 'https://example.org/a' });
  assert.equal(content.notifications[2].expireAt, '2026-10-22T12:00', '14 days by default');
});

test('notifications: unknown target is an error; unpublished target loses its link with a warning', () => {
  const missing = build(d => {
    d.notifications = [{ id: 'n', enabled: true, title: 'x', target: 'news:nope', publishAt: '2026-10-08 12:00' }];
  });
  assert.ok(where(missing.errors, 'مش موجودة'));

  const hiddenTarget = build(d => {
    d.news = [{ id: 'trip', enabled: false, title: 'رحلة' }];
    d.notifications = [{ id: 'n', enabled: true, title: 'x', target: 'news:trip', publishAt: '2026-10-08 12:00' }];
  });
  assert.deepEqual(hiddenTarget.errors, []);
  assert.equal(hiddenTarget.content.notifications[0].target, null);
  assert.equal(hiddenTarget.warnings.length, 1);

  const bad = build(d => {
    d.notifications = [
      { id: 'a', enabled: true, title: 'x', target: 'javascript:alert(1)', publishAt: '2026-10-08 12:00' },
      { id: 'b', enabled: true, title: 'x', type: 'spam', publishAt: '2026-10-08 12:00' },
      { id: 'c', enabled: true, title: 'x' }
    ];
  });
  assert.ok(where(bad.errors, 'الوجهة'));
  assert.ok(where(bad.errors, 'نوع الإشعار'));
  assert.ok(where(bad.errors, 'ميعاد الظهور مطلوب'));
});


/* ---------- media ---------- */

test('media: only well-formed media paths are publishable', () => {
  const index = plain(gs.mediaIndex_([
    IMG,
    { id: 'img-bad00000', path: '../../etc/passwd', width: 10, height: 10 },
    { id: 'img-bad11111', path: 'https://evil.com/x.webp', width: 10, height: 10 },
    { id: 'img-bad22222', path: 'media/2026/img-bad22222.webp', width: 0, height: 10 }
  ]));
  assert.deepEqual(Object.keys(index), ['img-ab12cd34']);
});

test('change summary covers hub items', () => {
  const before = build().content;
  const after = build(d => {
    d.news = [{ id: 'trip', enabled: true, title: 'رحلة', publishAt: '2026-10-08 12:00' }];
    d.sessions = [{ enabled: true, date: '2026-10-11', topic: 'حياة التسليم' }];
  }).content;
  const lines = plain(gs.summarizeChanges(before, after));
  assert.ok(lines.includes('خبر جديد: رحلة'));
  assert.ok(lines.includes('موضوع الاجتماع (الأحد ١١ أكتوبر): حياة التسليم'), lines.join(' | '));
});
