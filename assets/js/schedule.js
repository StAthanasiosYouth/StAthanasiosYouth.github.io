/**
 * SCHEDULE
 *
 * Meeting timing in Cairo wall-clock time, whatever the visitor's own
 * timezone. Pure functions (no DOM) so tests can run them in Node.
 *
 * Day arithmetic uses UTC dates built from Cairo calendar dates, so daylight
 * saving changes never shift a day count.
 */

const DAY_MS = 86400000;

const formatterCache = new Map();


/* Current Cairo wall-clock time as numbers. */
export function zonedNow(timeZone = 'Africa/Cairo', date = new Date()) {

  let formatter = formatterCache.get(timeZone);

  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23'
    });
    formatterCache.set(timeZone, formatter);
  }

  const parts = {};

  for (const part of formatter.formatToParts(date)) {
    parts[part.type] = part.value;
  }

  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);

  return {
    year,
    month,
    day,
    minutes: hour * 60 + minute,
    dayNumber: Math.round(Date.UTC(year, month - 1, day) / DAY_MS)
  };

}


/* "YYYY-MM-DDTHH:MM", comparable as a string with content.json dates. */
export function stamp(now) {

  const date = fromDayNumber(now.dayNumber);
  const hh = Math.floor(now.minutes / 60);
  const mm = now.minutes % 60;

  return `${date.iso}T${pad(hh)}:${pad(mm)}`;

}


export function fromDayNumber(dayNumber) {

  const date = new Date(dayNumber * DAY_MS);

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday: date.getUTCDay(),
    iso: `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
  };

}


function pad(n) {

  return String(n).padStart(2, '0');

}


export function parseTime(text) {

  const match = /^(\d{2}):(\d{2})$/.exec(text || '');

  return match ? Number(match[1]) * 60 + Number(match[2]) : null;

}


/**
 * Where we are relative to the meeting.
 *
 * Returns null when there is no usable meeting, otherwise:
 * {
 *   state: 'live'     -> happening now (only when the duration is known)
 *        | 'today'    -> later today
 *        | 'started'  -> started today, duration unknown, so we don't claim it is live
 *        | 'upcoming' -> a later day
 *   daysUntil, date (fromDayNumber), startMinutes, endMinutes (or null),
 *   minutesUntil (today only), skipped: [iso dates skipped before the next one]
 * }
 */
export function meetingStatus(meeting, now) {

  if (!meeting || meeting.day === null || meeting.day === undefined) {
    return null;
  }

  const start = parseTime(meeting.time);

  if (start === null) {
    return null;
  }

  const duration = Number.isFinite(meeting.durationMinutes) && meeting.durationMinutes > 0
    ? meeting.durationMinutes
    : null;

  const end = duration === null ? null : start + duration;
  const skipDates = new Set(meeting.skipDates || []);
  const skipped = [];

  // a meeting that started yesterday and runs past midnight
  if (end !== null && end > 1440) {
    const yesterday = fromDayNumber(now.dayNumber - 1);
    if (yesterday.weekday === meeting.day && !skipDates.has(yesterday.iso) && now.minutes < end - 1440) {
      return {
        state: 'live',
        daysUntil: -1,
        date: yesterday,
        startMinutes: start,
        endMinutes: end,
        minutesUntil: 0,
        skipped
      };
    }
  }

  // look up to a year ahead in case many dates are skipped
  for (let offset = 0; offset <= 371; offset++) {

    const date = fromDayNumber(now.dayNumber + offset);

    if (date.weekday !== meeting.day) {
      continue;
    }

    if (skipDates.has(date.iso)) {
      skipped.push(date.iso);
      continue;
    }

    const base = {
      daysUntil: offset,
      date,
      startMinutes: start,
      endMinutes: end,
      minutesUntil: null,
      skipped
    };

    if (offset > 0) {
      return { ...base, state: 'upcoming' };
    }

    if (now.minutes < start) {
      return { ...base, state: 'today', minutesUntil: start - now.minutes };
    }

    if (end === null) {
      return { ...base, state: 'started' };
    }

    if (now.minutes < end) {
      return { ...base, state: 'live', minutesUntil: 0 };
    }

    // today's meeting is over; keep looking for next week
  }

  return null;

}


/* Link / announcement visibility windows ("YYYY-MM-DDTHH:MM" strings). */
export function isWithinWindow(item, nowStamp) {

  if (item.startAt && nowStamp < item.startAt) {
    return false;
  }

  if (item.endAt && nowStamp > item.endAt) {
    return false;
  }

  return true;

}


/* Next occurrence as Google Calendar "dates" values in Cairo local time. */
export function calendarDates(status) {

  const { date, startMinutes, endMinutes } = status;

  const at = (dayNumberOffset, minutes) => {
    const d = fromDayNumber(Math.round(Date.UTC(date.year, date.month - 1, date.day) / DAY_MS) + dayNumberOffset);
    return `${d.year}${pad(d.month)}${pad(d.day)}T${pad(Math.floor(minutes / 60))}${pad(minutes % 60)}00`;
  };

  const end = endMinutes === null ? startMinutes : endMinutes;

  return `${at(0, startMinutes)}/${at(Math.floor(end / 1440), end % 1440)}`;

}
