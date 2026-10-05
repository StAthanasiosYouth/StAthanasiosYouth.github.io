// Tests for assets/js/schedule.js and assets/js/words.js (public site).

import test from 'node:test';
import assert from 'node:assert/strict';
import { zonedNow, meetingStatus, stamp, isWithinWindow, calendarDates } from '../assets/js/schedule.js';
import { describeMeeting, formatTime, countDays, countMinutes } from '../assets/js/words.js';

const SUNDAY_8PM = { day: 0, time: '20:00', durationMinutes: null, skipDates: [] };

// Cairo wall time -> the UTC instant, by trying both possible offsets.
function cairo(iso) {
  for (const offset of [2, 3]) {
    const date = new Date(`${iso}:00Z`);
    date.setUTCHours(date.getUTCHours() - offset);
    if (stamp(zonedNow('Africa/Cairo', date)) === iso) return zonedNow('Africa/Cairo', date);
  }
  throw new Error(`no Cairo instant for ${iso}`);
}

test('zonedNow reads Cairo wall time regardless of the machine timezone', () => {
  // 2026-10-05 is a Monday; Egypt is on summer time (UTC+3) until late October
  const now = zonedNow('Africa/Cairo', new Date('2026-10-05T16:30:00Z'));
  assert.equal(stamp(now), '2026-10-05T19:30');
  // January: UTC+2
  assert.equal(stamp(zonedNow('Africa/Cairo', new Date('2026-01-10T18:00:00Z'))), '2026-01-10T20:00');
});

test('Monday -> 6 days left', () => {
  const s = meetingStatus(SUNDAY_8PM, cairo('2026-10-05T19:30'));
  assert.equal(s.state, 'upcoming');
  assert.equal(s.daysUntil, 6);
  assert.equal(s.date.iso, '2026-10-11');
  assert.deepEqual(describeMeeting(s), { headline: 'فاضل ٦ أيام', detail: 'الأحد الساعة ٨ بالليل' });
});

test('Saturday -> tomorrow, Friday -> day after tomorrow, Thursday -> 3 days', () => {
  assert.equal(describeMeeting(meetingStatus(SUNDAY_8PM, cairo('2026-10-10T12:00'))).headline, 'بكره');
  assert.equal(describeMeeting(meetingStatus(SUNDAY_8PM, cairo('2026-10-09T12:00'))).headline, 'بعد بكره');
  assert.equal(describeMeeting(meetingStatus(SUNDAY_8PM, cairo('2026-10-08T12:00'))).headline, 'فاضل ٣ أيام');
});

test('Sunday before the meeting -> today, with a short countdown near the time', () => {
  const morning = meetingStatus(SUNDAY_8PM, cairo('2026-10-11T09:00'));
  assert.equal(morning.state, 'today');
  assert.deepEqual(describeMeeting(morning), { headline: 'النهارده', detail: 'الساعة ٨ بالليل' });
  const evening = meetingStatus(SUNDAY_8PM, cairo('2026-10-11T18:50'));
  assert.equal(describeMeeting(evening).detail, 'الساعة ٨ بالليل (بعد ساعة و١٠ دقايق)');
});

test('unknown duration: after start it is "started", never "live"', () => {
  const s = meetingStatus(SUNDAY_8PM, cairo('2026-10-11T20:30'));
  assert.equal(s.state, 'started');
  assert.deepEqual(describeMeeting(s), { headline: 'النهارده', detail: 'بدأ الساعة ٨ بالليل' });
});

test('known duration: live during, next week after', () => {
  const meeting = { ...SUNDAY_8PM, durationMinutes: 120 };
  const live = meetingStatus(meeting, cairo('2026-10-11T21:00'));
  assert.equal(live.state, 'live');
  assert.deepEqual(describeMeeting(live), { headline: 'شغال دلوقتي', detail: 'لحد ١٠ بالليل' });
  const after = meetingStatus(meeting, cairo('2026-10-11T22:00'));
  assert.equal(after.state, 'upcoming');
  assert.equal(after.daysUntil, 7);
});

test('meeting running past midnight is still live after 00:00', () => {
  const late = { day: 0, time: '23:00', durationMinutes: 120, skipDates: [] };
  const s = meetingStatus(late, cairo('2026-10-12T00:30'));
  assert.equal(s.state, 'live');
});

test('skip dates move to the following week and are reported', () => {
  const meeting = { ...SUNDAY_8PM, skipDates: ['2026-10-11'] };
  const s = meetingStatus(meeting, cairo('2026-10-05T19:30'));
  assert.equal(s.date.iso, '2026-10-18');
  assert.equal(s.daysUntil, 13);
  assert.deepEqual(s.skipped, ['2026-10-11']);
  assert.deepEqual(describeMeeting(s), { headline: 'فاضل ١٣ يوم', detail: 'الأحد ١٨ أكتوبر الساعة ٨ بالليل' });
});

test('across the October DST change the day count stays right', () => {
  // Egypt leaves summer time at the end of Thursday 2026-10-29
  const s = meetingStatus(SUNDAY_8PM, cairo('2026-10-29T23:30'));
  assert.equal(s.daysUntil, 3);
  assert.equal(s.date.iso, '2026-11-01');
});

test('invalid meetings give null', () => {
  assert.equal(meetingStatus(null, cairo('2026-10-05T10:00')), null);
  assert.equal(meetingStatus({ day: 0, time: '' }, cairo('2026-10-05T10:00')), null);
  assert.equal(meetingStatus({ day: null, time: '20:00' }, cairo('2026-10-05T10:00')), null);
});

test('visibility windows', () => {
  assert.equal(isWithinWindow({ startAt: '', endAt: '' }, '2026-10-05T10:00'), true);
  assert.equal(isWithinWindow({ startAt: '2026-10-06T00:00', endAt: '' }, '2026-10-05T10:00'), false);
  assert.equal(isWithinWindow({ startAt: '', endAt: '2026-10-05T09:59' }, '2026-10-05T10:00'), false);
  assert.equal(isWithinWindow({ startAt: '2026-10-05T10:00', endAt: '2026-10-05T23:59' }, '2026-10-05T10:00'), true);
});

test('Google Calendar dates', () => {
  const s = meetingStatus({ ...SUNDAY_8PM, durationMinutes: 120 }, cairo('2026-10-05T19:30'));
  assert.equal(calendarDates(s), '20261011T200000/20261011T220000');
  const open = meetingStatus(SUNDAY_8PM, cairo('2026-10-05T19:30'));
  assert.equal(calendarDates(open), '20261011T200000/20261011T200000');
  const late = meetingStatus({ day: 0, time: '23:00', durationMinutes: 120, skipDates: [] }, cairo('2026-10-05T19:30'));
  assert.equal(calendarDates(late), '20261011T230000/20261012T010000');
});

test('wording helpers', () => {
  assert.equal(formatTime(20 * 60), '٨ بالليل');
  assert.equal(formatTime(19 * 60 + 30), '٧:٣٠ بالليل');
  assert.equal(formatTime(10 * 60), '١٠ الصبح');
  assert.equal(formatTime(13 * 60), '١ الضهر');
  assert.equal(formatTime(0), '١٢ بالليل');
  assert.equal(countDays(2), 'يومين');
  assert.equal(countDays(11), '١١ يوم');
  assert.equal(countMinutes(45), '٤٥ دقيقة');
  assert.equal(countMinutes(120), 'ساعتين');
  assert.equal(countMinutes(5), '٥ دقايق');
});
