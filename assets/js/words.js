/**
 * WORDS
 *
 * Arabic (Egyptian) wording for times, days and countdowns. Pure functions.
 */

export const DAY_NAMES = ['الأحد', 'الإتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'];

export const DAY_SHORT = ['أحد', 'إتنين', 'تلات', 'أربع', 'خميس', 'جمعة', 'سبت'];

export const MONTH_NAMES = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
];


export function arabicDigits(value) {

  return String(value).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);

}


/* 20:00 -> "٨ بالليل", 19:30 -> "٧:٣٠ بالليل", 10:00 -> "١٠ الصبح" */
export function formatTime(minutesOfDay) {

  const total = ((minutesOfDay % 1440) + 1440) % 1440;
  const hour = Math.floor(total / 60);
  const minute = total % 60;

  let period;

  if (hour >= 5 && hour < 12) {
    period = 'الصبح';
  }
  else if (hour >= 12 && hour < 15) {
    period = 'الضهر';
  }
  else if (hour >= 15 && hour < 18) {
    period = 'العصر';
  }
  else {
    period = 'بالليل';
  }

  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  const clock = minute === 0 ? `${hour12}` : `${hour12}:${String(minute).padStart(2, '0')}`;

  return `${arabicDigits(clock)} ${period}`;

}


/* 3 -> "٣ أيام", 2 -> "يومين", 1 -> "يوم", 11 -> "١١ يوم" */
export function countDays(n) {

  if (n === 1) {
    return 'يوم';
  }

  if (n === 2) {
    return 'يومين';
  }

  return `${arabicDigits(n)} ${n >= 3 && n <= 10 ? 'أيام' : 'يوم'}`;

}


/* minutes -> "ساعتين و١٠ دقايق", "٤٥ دقيقة" */
export function countMinutes(total) {

  const hours = Math.floor(total / 60);
  const minutes = total % 60;

  const hourText = hours === 0 ? '' :
    hours === 1 ? 'ساعة' :
      hours === 2 ? 'ساعتين' :
        `${arabicDigits(hours)} ${hours <= 10 ? 'ساعات' : 'ساعة'}`;

  const minuteText = minutes === 0 ? '' :
    minutes === 1 ? 'دقيقة' :
      minutes === 2 ? 'دقيقتين' :
        `${arabicDigits(minutes)} ${minutes <= 10 ? 'دقايق' : 'دقيقة'}`;

  if (hourText && minuteText) {
    return `${hourText} و${minuteText}`;
  }

  return hourText || minuteText || 'دقيقة';

}


/* 1 -> "ساعة", 2 -> "ساعتين", 6 -> "٦ ساعات", 20 -> "٢٠ ساعة" */
export function countHours(n) {

  return n === 1 ? 'ساعة' : n === 2 ? 'ساعتين' : `${arabicDigits(n)} ${n <= 10 ? 'ساعات' : 'ساعة'}`;

}


/* real minutes -> "يوم و٦ ساعات", "يومين و٣ ساعات", "يومين" (a day or more) */
export function countDuration(minutes) {

  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);

  if (days === 0) return countMinutes(minutes);

  return hours ? `${countDays(days)} و${countHours(hours)}` : countDays(days);

}


export function formatDate(date, withWeekday = true) {

  const text = `${arabicDigits(date.day)} ${MONTH_NAMES[date.month - 1]}`;

  return withWeekday ? `${DAY_NAMES[date.weekday]} ${text}` : text;

}


/**
 * The countdown for the meeting widget, from meetingStatus() and the real
 * minutes left (meetingJourney().remaining):
 *   فاضل ٤ أيام             3 calendar days or more
 *   فاضل يوم و٦ ساعات      tomorrow / the day after, a day or more away
 *   فاضل ٢٠ ساعة            tomorrow, less than a day away
 *   الاجتماع النهارده        later today (with the hours left)
 *   فاضل ٤٥ دقيقة           the last hour
 *   الاجتماع بدأ             started (live while within its duration)
 */
export function describeMeeting(status, remaining = status.minutesUntil) {

  const time = formatTime(status.startMinutes);
  const day = status.daysUntil > 6 ? formatDate(status.date) : DAY_NAMES[status.date.weekday];
  const left = Math.max(1, Math.round(remaining ?? 0));

  switch (status.state) {

    case 'live':
      return {
        headline: 'الاجتماع بدأ',
        detail: status.endMinutes === null ? 'شغال دلوقتي' : `شغال دلوقتي، لحد ${formatTime(status.endMinutes)}`
      };

    case 'started':
      return {
        headline: 'الاجتماع بدأ',
        detail: `من الساعة ${time}`
      };

    case 'today':
      return left <= 60
        ? { headline: `فاضل ${countMinutes(left)}`, detail: `الاجتماع النهارده، الساعة ${time}` }
        : { headline: 'الاجتماع النهارده', detail: `الساعة ${time}، فاضل ${countMinutes(left)}` };

    default: {

      // the meeting already happened today: say so first
      if (status.endedToday) {
        return {
          headline: 'الاجتماع خلص ✓ نشوفكم الجاي',
          detail: `${day}، الساعة ${time} (فاضل ${countDays(status.daysUntil)})`
        };
      }

      if (status.daysUntil === 1) {
        // under a day: whole hours read better than "١٩ ساعة و٣٧ دقيقة"
        const hoursOnly = left >= 60 ? Math.floor(left / 60) * 60 : left;
        return {
          headline: `فاضل ${left < 1440 ? countMinutes(hoursOnly) : countDuration(left)}`,
          detail: `بكره، الساعة ${time}`
        };
      }

      if (status.daysUntil === 2) {
        return {
          headline: `فاضل ${countDuration(left)}`,
          detail: `بعد بكره، ${day} الساعة ${time}`
        };
      }

      return {
        headline: `فاضل ${countDays(status.daysUntil)}`,
        detail: `${day}، الساعة ${time}`
      };

    }

  }

}


/* =========================================================
   STAMPS ("YYYY-MM-DDTHH:MM", Cairo wall time)
========================================================= */

function stampParts(value) {

  const [date, time] = value.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = (time || '00:00').split(':').map(Number);
  const dayNumber = Math.round(Date.UTC(y, m - 1, d) / 86400000);

  return {
    date: { year: y, month: m, day: d, weekday: new Date(dayNumber * 86400000).getUTCDay() },
    dayNumber,
    minutes: hh * 60 + mm
  };

}


/* "الأحد ١١ أكتوبر الساعة ٨ بالليل" */
export function formatStamp(value, { withTime = true } = {}) {

  const p = stampParts(value);
  const date = formatDate(p.date);

  return withTime ? `${date} الساعة ${formatTime(p.minutes)}` : date;

}


/* Bell history groups. */
export function dayGroup(value, nowStamp) {

  const diff = stampParts(nowStamp).dayNumber - stampParts(value).dayNumber;

  if (diff <= 0) return 'النهارده';
  if (diff === 1) return 'امبارح';
  if (diff < 7) return 'الأسبوع ده';
  return 'أقدم';

}


/* "دلوقتي", "من ١٠ دقايق", "من ساعتين", "امبارح ٨ بالليل", "الأحد ٤ أكتوبر" */
export function relativeTime(value, nowStamp) {

  const then = stampParts(value);
  const now = stampParts(nowStamp);
  const minutes = (now.dayNumber - then.dayNumber) * 1440 + now.minutes - then.minutes;

  if (minutes < 1) return 'دلوقتي';
  if (minutes < 60) return `من ${countMinutes(minutes)}`;
  if (now.dayNumber === then.dayNumber) return `من ${countMinutes(Math.floor(minutes / 60) * 60)}`;
  if (now.dayNumber - then.dayNumber === 1) return `امبارح ${formatTime(then.minutes)}`;

  return formatDate(then.date);

}


/* Countdown to a start: "بعد ٤٥ دقيقة", "بعد ساعتين و١٠ دقايق", "بعد ٣ أيام" */
export function untilText(minutes) {

  if (minutes < 1) return 'خلال لحظات';
  if (minutes < 24 * 60) return `بعد ${countMinutes(minutes)}`;

  return `بعد ${countDays(Math.round(minutes / 1440))}`;

}
