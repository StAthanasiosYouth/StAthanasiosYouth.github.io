// Cairo wall-clock helpers for Node tools (the browser has its own copy in
// assets/js/schedule.js; Apps Script uses Utilities.formatDate).

export function cairoNow(date = new Date()) {

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Cairo',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    })
      .formatToParts(date)
      .map(p => [p.type, p.value])
  );

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;

}

export const utcStamp = (date = new Date()) =>
  date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
