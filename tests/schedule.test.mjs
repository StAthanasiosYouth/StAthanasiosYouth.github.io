// Tests for assets/js/schedule.js and assets/js/words.js (public site).

import test from 'node:test';
import assert from 'node:assert/strict';
import { zonedNow, meetingStatus, meetingJourney, realMinutesBetween, cairoInstant, stamp, isWithinWindow, calendarDates } from '../assets/js/schedule.js';
import { describeMeeting, formatTime, countDays, countMinutes } from '../assets/js/words.js';

const SUNDAY_8PM = { day: 0, time: '20:00', durationMinutes: null, skipDates: [] };

/* the widget's own wording: status + the real minutes left */
const say = (meeting, iso) => {
  const now = cairo(iso);
  const status = meetingStatus(meeting, now);
  return describeMeeting(status, meetingJourney(status, now).remaining);
};

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
  assert.deepEqual(say(SUNDAY_8PM, '2026-10-05T19:30'), { headline: 'فاضل ٦ أيام', detail: 'الأحد، الساعة ٨ بالليل' });
});

test('the countdown wording, through the week', () => {
  assert.deepEqual(say(SUNDAY_8PM, '2026-10-07T12:00'), { headline: 'فاضل ٤ أيام', detail: 'الأحد، الساعة ٨ بالليل' });
  assert.equal(say(SUNDAY_8PM, '2026-10-08T12:00').headline, 'فاضل ٣ أيام');
  // Friday 14:00 -> Sunday 20:00 = 2 days 6 hours
  assert.deepEqual(say(SUNDAY_8PM, '2026-10-09T14:00'), { headline: 'فاضل يومين و٦ ساعات', detail: 'بعد بكره، الأحد الساعة ٨ بالليل' });
  // Saturday 14:00 -> 30 hours = a day and 6 hours
  assert.deepEqual(say(SUNDAY_8PM, '2026-10-10T14:00'), { headline: 'فاضل يوم و٦ ساعات', detail: 'بكره، الساعة ٨ بالليل' });
  // Saturday 23:30 -> 20 h 30: whole hours
  assert.equal(say(SUNDAY_8PM, '2026-10-10T23:30').headline, 'فاضل ٢٠ ساعة');
});

test('Sunday before the meeting: "الاجتماع النهارده", then minutes in the last hour', () => {
  const morning = meetingStatus(SUNDAY_8PM, cairo('2026-10-11T09:00'));
  assert.equal(morning.state, 'today');
  assert.deepEqual(say(SUNDAY_8PM, '2026-10-11T17:30'), { headline: 'الاجتماع النهارده', detail: 'الساعة ٨ بالليل، فاضل ساعتين و٣٠ دقيقة' });
  assert.deepEqual(say(SUNDAY_8PM, '2026-10-11T19:15'), { headline: 'فاضل ٤٥ دقيقة', detail: 'الاجتماع النهارده، الساعة ٨ بالليل' });
});

test('unknown duration: after start it is "started", never "live"', () => {
  const s = meetingStatus(SUNDAY_8PM, cairo('2026-10-11T20:30'));
  assert.equal(s.state, 'started');
  assert.deepEqual(say(SUNDAY_8PM, '2026-10-11T20:30'), { headline: 'الاجتماع بدأ', detail: 'من الساعة ٨ بالليل' });
});

test('known duration: live during, "خلص ✓" after, then next week', () => {
  const meeting = { ...SUNDAY_8PM, durationMinutes: 120 };
  const live = meetingStatus(meeting, cairo('2026-10-11T21:00'));
  assert.equal(live.state, 'live');
  assert.deepEqual(say(meeting, '2026-10-11T21:00'), { headline: 'الاجتماع بدأ', detail: 'شغال دلوقتي، لحد ١٠ بالليل' });
  const after = meetingStatus(meeting, cairo('2026-10-11T22:00'));
  assert.equal(after.state, 'upcoming');
  assert.equal(after.daysUntil, 7);
  assert.equal(say(meeting, '2026-10-11T22:00').headline, 'الاجتماع خلص ✓ نشوفكم الجاي');
  assert.equal(say(meeting, '2026-10-12T09:00').headline, 'فاضل ٦ أيام');
});

test('one week can be longer than usual (session duration)', () => {
  const meeting = { ...SUNDAY_8PM, durationMinutes: 120 };
  const sessions = [{ date: '2026-10-11', time: '', status: 'normal', visibleFrom: '', durationMinutes: 180 }];
  assert.equal(meetingStatus(meeting, cairo('2026-10-11T22:30'), sessions).state, 'live');
  assert.equal(meetingStatus(meeting, cairo('2026-10-11T22:30')).state, 'upcoming');
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
  assert.deepEqual(say(meeting, '2026-10-05T19:30'), { headline: 'فاضل ١٣ يوم', detail: 'الأحد ١٨ أكتوبر، الساعة ٨ بالليل' });
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


/* ---------------- the week as a journey ---------------- */

const journeyAt = (meeting, iso, sessions = []) => {
  const now = cairo(iso);
  return meetingJourney(meetingStatus(meeting, now, sessions), now);
};

test('the strip is the 7 days ending on the meeting day (Sunday: Monday -> Sunday)', () => {
  const j = journeyAt(SUNDAY_8PM, '2026-10-07T21:00');
  assert.deepEqual(j.days.map(d => d.iso), ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
  assert.deepEqual(j.days.map(d => d.weekday), [1, 2, 3, 4, 5, 6, 0]);
  const today = j.days.find(d => d.isToday);
  const meetingDay = j.days.find(d => d.isMeeting);
  assert.equal(today.iso, '2026-10-07');
  assert.equal(meetingDay.iso, '2026-10-11');
  assert.notEqual(today, meetingDay, 'today and the meeting day are different cells');
  assert.equal(j.days.filter(d => d.isPassed).length, 2);
});

test('the strip follows the meeting day from the settings (Wednesday: Thursday -> Wednesday)', () => {
  const wednesday = { day: 3, time: '19:00', durationMinutes: 90, skipDates: [] };
  const j = journeyAt(wednesday, '2026-10-05T10:00');
  assert.deepEqual(j.days.map(d => d.weekday), [4, 5, 6, 0, 1, 2, 3]);
  assert.equal(j.days.at(-1).isMeeting, true);
  assert.equal(j.days.at(-1).iso, '2026-10-07');
});

test('"now" moves inside the day: Wednesday 21:00 is further than 09:00', () => {
  const morning = journeyAt(SUNDAY_8PM, '2026-10-07T09:00');
  const night = journeyAt(SUNDAY_8PM, '2026-10-07T21:00');
  assert.ok(night.nowPos > morning.nowPos);
  assert.ok(Math.abs((night.nowPos - morning.nowPos) - 12 / (7 * 24)) < 1e-6, '12 hours = 12/168 of the strip');
  // Wednesday 09:00: 2 days + 9 hours into Monday..Sunday
  assert.ok(Math.abs(morning.nowPos - (2 * 24 + 9) / 168) < 1e-6);
  // the meeting marker sits at Sunday 20:00
  assert.ok(Math.abs(morning.meetingPos - (6 * 24 + 20) / 168) < 1e-6);
});

test('a week of 15-minute steps: position and energy only grow toward the meeting', () => {
  const meeting = { ...SUNDAY_8PM, durationMinutes: 120 };
  let previous = null;
  let minutes = Date.UTC(2026, 9, 5, 0, 0) / 60000; // Monday 00:00 (wall)
  const end = Date.UTC(2026, 9, 11, 19, 59) / 60000; // Sunday 19:59
  for (; minutes <= end; minutes += 15) {
    const iso = new Date(minutes * 60000).toISOString().slice(0, 16);
    const j = journeyAt(meeting, iso);
    assert.ok(j.nowPos >= 0 && j.nowPos <= 1 && j.energy >= 0 && j.energy <= 1, iso);
    assert.ok(j.nowPos < j.meetingPos, `${iso}: now before the meeting`);
    if (previous) {
      assert.ok(j.nowPos > previous.nowPos, `${iso}: position grows`);
      assert.ok(j.energy >= previous.energy, `${iso}: energy grows`);
      assert.ok(j.remaining < previous.remaining, `${iso}: time left shrinks`);
    }
    previous = j;
  }
  assert.ok(previous.energy > 0.95, 'one minute before: almost full energy');
  assert.equal(journeyAt(meeting, '2026-10-05T00:00').energy < 0.05, true, 'a week away: calm');
});

test('phases near the meeting, and live progress through it', () => {
  const meeting = { ...SUNDAY_8PM, durationMinutes: 120 };
  assert.equal(journeyAt(meeting, '2026-10-09T12:00').phase, 'near');
  assert.equal(journeyAt(meeting, '2026-10-10T12:00').phase, 'tomorrow');
  assert.equal(journeyAt(meeting, '2026-10-11T12:00').phase, 'today');
  assert.equal(journeyAt(meeting, '2026-10-11T18:30').phase, 'soon');
  assert.equal(journeyAt(meeting, '2026-10-11T19:50').phase, 'imminent');
  const live = journeyAt(meeting, '2026-10-11T21:00');
  assert.equal(live.phase, 'live');
  assert.equal(live.energy, 1);
  assert.equal(live.liveProgress, 0.5);
  assert.equal(live.remaining, 0);
  assert.equal(journeyAt(SUNDAY_8PM, '2026-10-11T20:30').phase, 'started');
});

test('a cancelled week: the strip shows the coming days, the meeting beyond it', () => {
  const meeting = { ...SUNDAY_8PM, skipDates: ['2026-10-11'] };
  const now = cairo('2026-10-07T12:00');
  const j = meetingJourney(meetingStatus(meeting, now), now, meeting.skipDates);
  assert.equal(j.far, true);
  assert.equal(j.phase, 'far');
  assert.equal(j.days[0].isToday, true);
  assert.equal(j.days.find(d => d.iso === '2026-10-11').isCancelled, true);
  assert.ok(!j.days.some(d => d.isMeeting));
});

test('real minutes across the October summer-time change (the clock goes back an hour)', () => {
  // Egypt leaves summer time at the end of Thursday 2026-10-29 (24:00 -> 23:00)
  assert.equal(realMinutesBetween('2026-10-29T12:00', '2026-10-30T12:00'), 25 * 60);
  assert.equal(realMinutesBetween('2026-10-05T12:00', '2026-10-06T12:00'), 24 * 60);
  const j = journeyAt(SUNDAY_8PM, '2026-10-29T12:00');
  // Thursday 12:00 -> Sunday 20:00 is 3 days 8 hours on the wall, plus the extra hour
  assert.equal(j.remaining, (3 * 24 + 8 + 1) * 60);
  assert.ok(cairoInstant('2026-01-10T20:00') === Date.UTC(2026, 0, 10, 18, 0));
});
