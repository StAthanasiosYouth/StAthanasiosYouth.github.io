// Tests for the hub additions in assets/js/schedule.js and words.js:
// server clock, sessions, game states, publish windows, bell wording.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  zonedNow, stamp, meetingStatus, setServerTime, clockOffset, gameState,
  isPublished, addMinutes, minutesBetween, upcomingSessions
} from '../assets/js/schedule.js';
import { dayGroup, relativeTime, untilText, formatStamp } from '../assets/js/words.js';

const SUNDAY_8PM = { day: 0, time: '20:00', durationMinutes: null, skipDates: [] };

function cairo(iso) {
  for (const offset of [2, 3]) {
    const date = new Date(`${iso}:00Z`);
    date.setUTCHours(date.getUTCHours() - offset);
    if (stamp(zonedNow('Africa/Cairo', date)) === iso) return zonedNow('Africa/Cairo', date);
  }
  throw new Error(`no Cairo instant for ${iso}`);
}


test('server clock correction', () => {
  const received = Date.parse('2026-10-05T16:00:00Z');
  setServerTime('Mon, 05 Oct 2026 16:10:00 GMT', received);
  assert.equal(clockOffset(), 10 * 60000);
  const corrected = zonedNow('Africa/Cairo', new Date(received + clockOffset()));
  assert.equal(stamp(corrected), '2026-10-05T19:10');
  setServerTime('garbage', received);
  assert.equal(clockOffset(), 10 * 60000, 'a bad header keeps the last good offset');
  setServerTime(new Date(received).toUTCString(), received);
  assert.equal(clockOffset(), 0);
});

test('sessions: topic on the regular day, visibility, time override, extra meeting, cancellation', () => {
  const session = { date: '2026-10-11', time: '', topic: 'حياة التسليم', speaker: 'أبونا أنطوني عياد', status: 'normal', visibleFrom: '' };

  const s = meetingStatus(SUNDAY_8PM, cairo('2026-10-05T19:30'), [session]);
  assert.equal(s.date.iso, '2026-10-11');
  assert.equal(s.session.topic, 'حياة التسليم');

  const before = meetingStatus(SUNDAY_8PM, cairo('2026-10-05T19:30'), [{ ...session, visibleFrom: '2026-10-09T20:00' }]);
  assert.equal(before.session, null, 'topic hidden until visibleFrom');
  const after = meetingStatus(SUNDAY_8PM, cairo('2026-10-09T20:00'), [{ ...session, visibleFrom: '2026-10-09T20:00' }]);
  assert.equal(after.session.topic, 'حياة التسليم');

  const moved = meetingStatus(SUNDAY_8PM, cairo('2026-10-11T19:00'), [{ ...session, time: '18:00' }]);
  assert.equal(moved.startMinutes, 18 * 60);
  assert.equal(moved.state, 'started');

  const extra = meetingStatus(SUNDAY_8PM, cairo('2026-10-05T19:30'), [{ date: '2026-10-07', time: '19:00', topic: 'سهرة', status: 'normal', visibleFrom: '' }]);
  assert.equal(extra.date.iso, '2026-10-07');
  assert.equal(extra.session.topic, 'سهرة');

  const cancelled = meetingStatus(SUNDAY_8PM, cairo('2026-10-05T19:30'), [{ date: '2026-10-11', status: 'cancelled', visibleFrom: '' }]);
  assert.equal(cancelled.date.iso, '2026-10-18');
  assert.deepEqual(cancelled.skipped, ['2026-10-11']);

  const only = meetingStatus(null, cairo('2026-10-05T19:30'), [{ date: '2026-10-09', time: '18:00', topic: 'يوم روحي', status: 'normal', visibleFrom: '' }]);
  assert.equal(only.date.iso, '2026-10-09');
  assert.equal(meetingStatus(null, cairo('2026-10-05T19:30'), []), null);
});

test('upcoming sessions list respects visibility and drops the past', () => {
  const list = upcomingSessions([
    { date: '2026-10-04', visibleFrom: '' },
    { date: '2026-10-11', visibleFrom: '' },
    { date: '2026-10-18', visibleFrom: '2026-10-15T00:00' }
  ], '2026-10-05T10:00');
  assert.deepEqual(list.map(s => s.date), ['2026-10-11']);
});

test('game states follow Cairo time', () => {
  const game = { visibleFrom: '2026-10-11T21:00', startAt: '2026-10-11T22:00', endAt: '2026-10-11T23:30', afterEnd: 'show', endedUntil: '2026-10-12T11:30' };
  assert.deepEqual(gameState(game, '2026-10-11T20:59'), { state: 'hidden' });
  assert.deepEqual(gameState(game, '2026-10-11T21:45'), { state: 'soon', minutesUntil: 15 });
  assert.deepEqual(gameState(game, '2026-10-11T22:00'), { state: 'open', minutesLeft: 90 });
  assert.deepEqual(gameState(game, '2026-10-11T23:30'), { state: 'ended' });
  assert.deepEqual(gameState(game, '2026-10-12T11:30'), { state: 'hidden' });
  assert.deepEqual(gameState({ ...game, afterEnd: 'hide' }, '2026-10-11T23:31'), { state: 'hidden' });
  assert.equal(gameState({ ...game, visibleFrom: '' }, '2026-10-01T00:00').state, 'soon');
});

test('publish windows and wall-clock arithmetic', () => {
  assert.equal(isPublished({ publishAt: '2026-10-08T20:00', expireAt: '' }, '2026-10-08T19:59'), false);
  assert.equal(isPublished({ publishAt: '2026-10-08T20:00', expireAt: '' }, '2026-10-08T20:00'), true);
  assert.equal(isPublished({ publishAt: '', expireAt: '2026-10-08T23:59' }, '2026-10-09T00:00'), false);
  assert.equal(addMinutes('2026-10-31T23:50', 20), '2026-11-01T00:10');
  assert.equal(minutesBetween('2026-10-11T21:45', '2026-10-11T22:00'), 15);
});

test('bell wording', () => {
  const now = '2026-10-08T20:00';
  assert.equal(dayGroup('2026-10-08T09:00', now), 'النهارده');
  assert.equal(dayGroup('2026-10-07T23:00', now), 'امبارح');
  assert.equal(dayGroup('2026-10-04T10:00', now), 'الأسبوع ده');
  assert.equal(dayGroup('2026-09-20T10:00', now), 'أقدم');
  assert.equal(relativeTime('2026-10-08T20:00', now), 'دلوقتي');
  assert.equal(relativeTime('2026-10-08T19:50', now), 'من ١٠ دقايق');
  assert.equal(relativeTime('2026-10-08T17:30', now), 'من ساعتين');
  assert.equal(relativeTime('2026-10-07T20:00', now), 'امبارح ٨ بالليل');
  assert.equal(relativeTime('2026-10-04T20:00', now), 'الأحد ٤ أكتوبر');
  assert.equal(untilText(15), 'بعد ١٥ دقيقة');
  assert.equal(untilText(130), 'بعد ساعتين و١٠ دقايق');
  assert.equal(untilText(3 * 1440 + 100), 'بعد ٣ أيام');
  assert.equal(formatStamp('2026-10-11T20:00'), 'الأحد ١١ أكتوبر الساعة ٨ بالليل');
});
