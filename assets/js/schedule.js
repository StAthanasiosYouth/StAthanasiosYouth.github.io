/**
 * SCHEDULE
 *
 * Everything time-related on the public site, in Cairo wall-clock time,
 * whatever the visitor's own timezone. Pure functions (no DOM) so tests can
 * run them in Node.
 *
 * - The visitor's device clock can be wrong. setServerTime() takes the Date
 *   header that GitHub Pages sends with content.json and corrects for it.
 * - Day arithmetic uses UTC dates built from Cairo calendar dates, so
 *   daylight saving changes never shift a day count.
 * - Times in content.json are Cairo wall times "YYYY-MM-DDTHH:MM" and are
 *   compared as strings.
 */

const DAY_MS = 86400000;

const formatterCache = new Map();

let clockOffsetMs = 0;


/* =========================================================
   CLOCK
========================================================= */

/** Corrects the device clock with the server's Date header (ignored if unusable). */
export function setServerTime(dateHeader, receivedAt = Date.now()) {

  const server = Date.parse(dateHeader || '');

  if (Number.isFinite(server)) {
    clockOffsetMs = server - receivedAt;
  }

  return clockOffsetMs;

}


export function clockOffset() {

  return clockOffsetMs;

}


/* Current Cairo wall-clock time as numbers. */
export function zonedNow(timeZone = 'Africa/Cairo', date = new Date(Date.now() + clockOffsetMs)) {

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
    iso: `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
    dayNumber
  };

}


export function dayNumberOf(iso) {

  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);

  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);

}


function pad(n) {

  return String(n).padStart(2, '0');

}


export function parseTime(text) {

  const match = /^(\d{2}):(\d{2})$/.exec(text || '');

  return match ? Number(match[1]) * 60 + Number(match[2]) : null;

}


/* =========================================================
   WALL-CLOCK ARITHMETIC ("YYYY-MM-DDTHH:MM")
========================================================= */

export function stampToMinutes(value) {

  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value || '');

  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000 : null;

}


export function minutesToStamp(minutes) {

  const d = new Date(minutes * 60000);

  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;

}


export function addMinutes(value, minutes) {

  const base = stampToMinutes(value);

  return base === null ? '' : minutesToStamp(base + minutes);

}


export function minutesBetween(from, to) {

  const a = stampToMinutes(from);
  const b = stampToMinutes(to);

  return a === null || b === null ? null : b - a;

}


/* =========================================================
   MEETING
========================================================= */

/**
 * Where we are relative to the next meeting, combining the weekly rule
 * (content.meeting) with dated sessions (content.sessions): a session can
 * add a topic, change the time, cancel a week, or add an extra meeting on
 * another day. Sessions count only once their visibleFrom has passed.
 *
 * Returns null when there is no usable meeting, otherwise:
 * {
 *   state: 'live'     -> happening now (only when the duration is known)
 *        | 'today'    -> later today
 *        | 'started'  -> started today, duration unknown, so we don't claim it is live
 *        | 'upcoming' -> a later day
 *   daysUntil, date (fromDayNumber), startMinutes, endMinutes (or null),
 *   minutesUntil (today only), skipped: [iso dates skipped before the next one],
 *   session: the visible session for that date (topic, speaker…) or null
 * }
 */
export function meetingStatus(meeting, now, sessions = []) {

  const nowStamp = stamp(now);
  const weekday = meeting && Number.isInteger(meeting.day) ? meeting.day : null;
  const defaultStart = meeting ? parseTime(meeting.time) : null;
  const duration = meeting && Number.isFinite(meeting.durationMinutes) && meeting.durationMinutes > 0
    ? meeting.durationMinutes
    : null;
  const skipDates = new Set((meeting && meeting.skipDates) || []);

  const byDate = new Map();

  for (const session of sessions || []) {
    if (!session.visibleFrom || session.visibleFrom <= nowStamp) {
      byDate.set(session.date, session);
    }
  }

  if (weekday === null && !byDate.size) {
    return null;
  }

  /* What happens on a date: null (nothing), cancelled, or a meeting. */
  function occurrence(date) {
    const session = byDate.get(date.iso) || null;
    const regular = weekday !== null && date.weekday === weekday && defaultStart !== null;
    if (!regular && !session) return null;
    if ((session && session.status === 'cancelled') || skipDates.has(date.iso)) {
      return regular || session ? { cancelled: true } : null;
    }
    const start = session && session.time ? parseTime(session.time) : defaultStart;
    if (start === null) return null;
    return { start, end: duration === null ? null : start + duration, session };
  }

  const skipped = [];

  // a meeting that started yesterday and runs past midnight
  const yesterday = fromDayNumber(now.dayNumber - 1);
  const late = occurrence(yesterday);

  if (late && !late.cancelled && late.end !== null && late.end > 1440 && now.minutes < late.end - 1440) {
    return {
      state: 'live',
      daysUntil: -1,
      date: yesterday,
      startMinutes: late.start,
      endMinutes: late.end,
      minutesUntil: 0,
      skipped,
      session: late.session
    };
  }

  // look up to a year ahead in case many dates are skipped
  for (let offset = 0; offset <= 371; offset++) {

    const date = fromDayNumber(now.dayNumber + offset);
    const occ = occurrence(date);

    if (!occ) {
      continue;
    }

    if (occ.cancelled) {
      skipped.push(date.iso);
      continue;
    }

    const base = {
      daysUntil: offset,
      date,
      startMinutes: occ.start,
      endMinutes: occ.end,
      minutesUntil: null,
      skipped,
      session: occ.session
    };

    if (offset > 0) {
      return { ...base, state: 'upcoming' };
    }

    if (now.minutes < occ.start) {
      return { ...base, state: 'today', minutesUntil: occ.start - now.minutes };
    }

    if (occ.end === null) {
      return { ...base, state: 'started' };
    }

    if (now.minutes < occ.end) {
      return { ...base, state: 'live', minutesUntil: 0 };
    }

    // today's meeting is over; keep looking
  }

  return null;

}


/** The next few dated sessions with something to say (topic/speaker), visible now. */
export function upcomingSessions(sessions, nowStamp, limit = 4) {

  const today = nowStamp.slice(0, 10);

  return (sessions || [])
    .filter(s => s.date >= today && (!s.visibleFrom || s.visibleFrom <= nowStamp))
    .slice(0, limit);

}


/* =========================================================
   VISIBILITY WINDOWS
========================================================= */

/* Links: startAt / endAt. */
export function isWithinWindow(item, nowStamp) {

  if (item.startAt && nowStamp < item.startAt) {
    return false;
  }

  if (item.endAt && nowStamp > item.endAt) {
    return false;
  }

  return true;

}


/* News and notifications: publishAt / expireAt. */
export function isPublished(item, nowStamp) {

  if (item.publishAt && nowStamp < item.publishAt) {
    return false;
  }

  if (item.expireAt && nowStamp > item.expireAt) {
    return false;
  }

  return true;

}


/* =========================================================
   GAMES
   hidden -> soon ("قريبًا") -> open ("جاهزة دلوقتي") -> ended -> hidden
========================================================= */

export function gameState(game, nowStamp) {

  if (game.visibleFrom && nowStamp < game.visibleFrom) {
    return { state: 'hidden' };
  }

  if (nowStamp < game.startAt) {
    return { state: 'soon', minutesUntil: minutesBetween(nowStamp, game.startAt) };
  }

  if (nowStamp < game.endAt) {
    return { state: 'open', minutesLeft: minutesBetween(nowStamp, game.endAt) };
  }

  if (game.afterEnd !== 'hide' && game.endedUntil && nowStamp < game.endedUntil) {
    return { state: 'ended' };
  }

  return { state: 'hidden' };

}


/* =========================================================
   CALENDAR
========================================================= */

/* Next occurrence as Google Calendar "dates" values in Cairo local time. */
export function calendarDates(status) {

  const { date, startMinutes, endMinutes } = status;

  const at = (dayOffset, minutes) => {
    const d = fromDayNumber(dayNumberOf(date.iso) + dayOffset);
    return `${d.year}${pad(d.month)}${pad(d.day)}T${pad(Math.floor(minutes / 60))}${pad(minutes % 60)}00`;
  };

  const end = endMinutes === null ? startMinutes : endMinutes;

  return `${at(0, startMinutes)}/${at(Math.floor(end / 1440), end % 1440)}`;

}
