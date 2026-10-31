/**
 * YOUTH ACCOUNT: the page's pure rules (docs/YOUTH-ACCOUNTS-PLAN.md §8, §13).
 * Everything the server decides again; this only helps before a request is
 * spent. No DOM here, so tests/account-public.test.mjs can run it in Node.
 */

export const HINTS_KEY = 'athanasios.account.hints.v1';
export const MAX_HINTS = 3;

export { SESSION_KEY, RETURN_KEY, FROM_KEY, MODE_KEY, cleanReturn, readSession, writeSession, clearSession, readFace, writeFace } from './link.js';

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export const arDigits = value => String(value).replace(/\d/g, d => AR_DIGITS[d]);

export function validEmail(value) {
  return /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$/.test(String(value || '').trim());
}

const DOMAIN_TYPOS = {
  'gmial.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'gnail.com': 'gmail.com',
  'yaho.com': 'yahoo.com', 'yahoo.con': 'yahoo.com', 'yahooo.com': 'yahoo.com',
  'hotmial.com': 'hotmail.com', 'hotmail.con': 'hotmail.com', 'outlok.com': 'outlook.com', 'outlook.con': 'outlook.com'
};

/* «قصدك gmail.com؟»: the corrected address, or '' */
export function emailTypo(value) {
  const email = String(value || '').trim();
  const at = email.lastIndexOf('@');
  if (at < 1) return '';
  const fixed = DOMAIN_TYPOS[email.slice(at + 1).toLowerCase()];
  return fixed ? email.slice(0, at + 1) + fixed : '';
}

/* m•••a@gmail.com: enough to recognise, little for a passer-by (§8.5) */
export function maskEmail(value) {
  const email = String(value || '');
  const at = email.lastIndexOf('@');
  if (at < 1) return '';
  const local = email.slice(0, at);
  return (local.length < 3 ? local[0] : local[0] + '•••' + local[local.length - 1]) + email.slice(at);
}

/* the label of the one submit button (§8.2) */
export function submitLabel(state) {
  if (state.busy) return 'لحظة…';
  return state.password ? 'دخول' : 'متابعة';
}

const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
export const monthNames = () => MONTHS.slice();

/* '2003-03-12' → «١٢ مارس ٢٠٠٣» */
export function dateText(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return '';
  return arDigits(Number(m[3])) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + arDigits(m[1]);
}

export function birthDateOf(year, month, day) {
  if (!year || !month || !day) return '';
  return String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

/* the years the form offers: age 5 to 100, newest first */
export function birthYears(now = new Date()) {
  const top = now.getFullYear() - 5;
  return Array.from({ length: 96 }, (_, i) => top - i);
}

const DAYS = ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'];

/* an event's stamp → «السبت ١٤ نوفمبر، ٦:٠٠ ص»; the year only when it isn't this one */
export function whenText(stamp, now = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(stamp || ''));
  if (!m) return '';
  const day = DAYS[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()];
  let text = day + ' ' + arDigits(Number(m[3])) + ' ' + MONTHS[Number(m[2]) - 1];
  if (Number(m[1]) !== now.getFullYear()) text += ' ' + arDigits(m[1]);
  if (m[4]) {
    const hour = Number(m[4]);
    text += '، ' + arDigits(hour % 12 || 12) + ':' + arDigits(m[5]) + (hour < 12 ? ' ص' : ' م');
  }
  return text;
}

/* a time in ms → «١٢ مارس ٢٠٢٦», in Cairo */
export function msDateText(ms) {
  if (!ms) return '';
  return dateText(new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date(ms)));
}

/* «دلوقتي», «من ٣ أيام»: how long ago, for the devices list */
export function relativeText(ms, now = Date.now()) {
  const minutes = Math.floor((now - Number(ms)) / 60000);
  if (!(minutes >= 0)) return '';
  if (minutes < 2) return 'دلوقتي';
  if (minutes < 60) return 'من ' + arDigits(minutes) + ' دقيقة';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? 'من ساعة' : 'من ' + arDigits(hours) + ' ساعة';
  const days = Math.floor(hours / 24);
  if (days === 1) return 'امبارح';
  return days < 30 ? 'من ' + arDigits(days) + ' يوم' : msDateText(ms);
}

/* the nearest first; one without a date last */
export const comingFirst = list => [...list].sort((a, b) => String(a.startAt || '9').localeCompare(String(b.startAt || '9')));

/*
 * «محتاج منك»: what the summary asks of the member now, the money first, two at most.
 * Empty when nothing does, and then the page says nothing about it.
 */
export function attention(summary, { money = n => arDigits(n) + ' جنيه' } = {}) {
  const out = [];
  const A = summary.account || {};
  const state = A.eligibility || {};
  if (state.state === 'guest') out.push({ tone: 'alert', icon: 'alert', title: 'حسابك خارج النطاق العمري للخدمة', sub: 'تقدر تشارك كضيف بدون نقاط', route: summary.points.frozen ? '#me/points' : '#me/profile' });
  if (state.soon) out.push({ icon: 'clock', title: 'سنك قرب يخرج من النطاق العمري', sub: 'استخدم نقطك قبل كده', route: '#me/points' });
  for (const b of comingFirst(summary.bookings.coming)) {
    if (b.status === 'confirmed' && b.left > 0) out.push({ icon: 'clock', title: 'باقي ' + money(b.left) + ' على ' + b.event, sub: b.dueAt ? 'آخر ميعاد ' + whenText(b.dueAt) : '', route: '#me/bookings/' + encodeURIComponent(b.ref) });
  }
  for (const b of summary.bookings.rejected) out.push({ tone: 'alert', icon: 'alert', title: 'حجز ' + b.event + ' اترفض', sub: 'شوف السبب', route: '#me/bookings/' + encodeURIComponent(b.ref) });
  for (const x of summary.results.fresh) out.push({ tone: 'ok', icon: 'trophy', title: 'نتيجة ' + x.title + ' ظهرت', sub: arDigits(x.score) + ' من ' + arDigits(x.maxScore) + (x.pointsAwarded ? '، كسبت ' + arDigits(x.pointsAwarded) + ' نقطة' : ''), route: '#me/results/' + x.slug });
  for (const o of summary.orders.ready) out.push({ tone: 'ok', icon: 'gift', title: o.itemName + ' جاهزة للاستلام', sub: 'استلمها من الخدمة', route: '#me/orders/' + o.id });
  return out.slice(0, 2);
}

/* ---------- where a link was going (docs/EMAIL-DEEP-LINKS.md §3) ---------- */

export const DEST_KEY = 'athanasios.account.dest.v1';
const DEST_MS = 30 * 60000;

/* the page's own hash routes only: anything else (an address, script) is dropped */
export function cleanRoute(hash) {
  const value = String(hash || '');
  if (/^#me\/(?:security|notifications|points|bookings|results|orders|profile|support)$/.test(value)) return value;
  if (/^#me\/results\/[a-z0-9-]{2,40}$/.test(value)) return value;
  if (/^#me\/orders\/r-[0-9a-f]{10}$/.test(value)) return value;
  if (/^#me\/bookings\/[A-Z0-9-]{3,20}(?:\/payments)?$/.test(value)) return value;
  // a section this version doesn't have yet opens the account's first page
  return /^#me(?:\/[\w/-]{0,80})?$/.test(value) ? '#me' : '';
}

/* this tab only, for 30 minutes, opened once */
export function keepDest(tab, route, now = Date.now()) {
  if (!tab || !cleanRoute(route) || cleanRoute(route) === '#me') return;
  try {
    tab.setItem(DEST_KEY, JSON.stringify({ route: cleanRoute(route), at: now }));
  }
  catch { /* the account's first page opens instead */ }
}

export function takeDest(tab, now = Date.now()) {
  if (!tab) return '';
  const value = read(tab, DEST_KEY);
  try {
    tab.removeItem(DEST_KEY);
  }
  catch { /* nothing kept */ }
  if (!value || typeof value.at !== 'number' || now - value.at > DEST_MS) return '';
  return cleanRoute(value.route);
}

/* ---------- what this device remembers (never the password) ---------- */

function read(storage, key) {
  try {
    return JSON.parse(storage.getItem(key) || 'null');
  }
  catch {
    return null;
  }
}

export function readHints(storage) {
  const list = storage ? read(storage, HINTS_KEY) : null;
  if (!Array.isArray(list)) return [];
  return list.filter(h => h && validEmail(h.email) && typeof h.firstName === 'string').slice(0, MAX_HINTS);
}

/* newest first, one per email, at most 3 accounts */
export function addHint(list, hint, now = Date.now()) {
  const others = list.filter(h => h.email.toLowerCase() !== hint.email.toLowerCase());
  return [{ firstName: String(hint.firstName || '').slice(0, 40), email: hint.email, lastUsedAt: now }, ...others].slice(0, MAX_HINTS);
}

export const removeHint = (list, email) => list.filter(h => h.email.toLowerCase() !== String(email).toLowerCase());

export function writeHints(storage, list) {
  try {
    storage.setItem(HINTS_KEY, JSON.stringify(list));
  }
  catch { /* private window: nothing remembered, everything still works */ }
}
