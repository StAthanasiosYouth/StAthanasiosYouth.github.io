/**
 * «فكّرني لما تبدأ» (site redesign S4, PLAN §1 decision 7) for a competition that has not started yet.
 *
 * A calendar file (.ics) with the start time and an alarm at the start, made on the device:
 * nothing is sent anywhere. The phone's calendar does the reminding.
 */

import { cairoInstant } from '../schedule.js';

const pad = n => String(n).padStart(2, '0');

/** epoch ms → 20261108T160000Z */
const utc = ms => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
};

/* RFC 5545 text: escape \ ; , and new lines */
const esc = s => String(s || '').replace(/[\\;,]/g, m => `\\${m}`).replace(/\r?\n/g, '\\n');

/** the calendar file for { slug, title, startAt, endAt } (Cairo wall stamps); null when the start is unknown */
export function remindIcs({ slug, title, startAt, endAt }, pageUrl, now = Date.now()) {
  const start = cairoInstant(startAt);
  if (start === null) return null;
  const endMs = cairoInstant(endAt);
  const end = endMs !== null && endMs > start ? Math.min(endMs, start + 3600000) : start + 3600000;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//St Athanasios Youth//Competitions//AR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:comp-${slug || 'x'}-${start}@stathanasiosyouth.github.io`,
    `DTSTAMP:${utc(now)}`,
    `DTSTART:${utc(start)}`,
    `DTEND:${utc(end)}`,
    `SUMMARY:${esc(`بدأت: ${title}`)}`,
    `DESCRIPTION:${esc(`المسابقة بدأت. ادخل من هنا: ${pageUrl}`)}`,
    `URL:${pageUrl}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${esc(title)}`,
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
    ''
  ].join('\r\n');
}

/** downloads the file; true when it went */
export function remindMe(comp, pageUrl) {
  const ics = remindIcs(comp, pageUrl);
  if (!ics) return false;
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${comp.slug || 'competition'}.ics`;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return true;
}
