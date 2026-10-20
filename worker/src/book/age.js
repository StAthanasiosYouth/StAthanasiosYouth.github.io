/*
 * Event age eligibility (BOOKING-PHASE1-COMPLETION-PLAN §4.9). Separate from
 * pricing: categoryForAge (model.js) still only picks each person's price.
 *
 *   booking.bookerAge = { min, max } — the main booker only (a date of birth,
 *     age at the event's start, Cairo); null = no limit.
 *   category.allowed (default true) — a companion priced into a category that
 *     is switched off is refused.
 *   booking.ageStrict — companions must fit an allowed category (its age range,
 *     or a category with no range).
 *
 * Events saved before this have none of it and behave exactly as before.
 */

export const AGE_MSG = {
  booker: (min, max) => 'الفعالية دي للسن ' + rangeText(min, max) + '.',
  dob: 'اكتب تاريخ ميلادك صح.',
  companion: 'السن ده مش مسموح للمرافقين في الفعالية دي — كلّم الخادم المسؤول.',
  category: 'الفئة دي مش متاحة في الفعالية دي — كلّم الخادم المسؤول.'
};
const ar = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
function rangeText(min, max) {
  if (min != null && max != null) return 'من ' + ar(min) + ' لـ ' + ar(max) + ' سنة';
  if (min != null) return 'من ' + ar(min) + ' سنة وأكبر';
  return 'لحد ' + ar(max) + ' سنة';
}

const intOrNull = v => (v === '' || v == null || !Number.isInteger(Number(v)) ? null : Number(v));

/* the event's booker range, from event.json (null when not set or nonsense) */
export function parseBookerAge(v) {
  if (!v || typeof v !== 'object') return null;
  const min = intOrNull(v.min);
  const max = intOrNull(v.max);
  if (min == null && max == null) return null;
  if ((min != null && (min < 0 || min > 120)) || (max != null && (max < 0 || max > 120)) || (min != null && max != null && min > max)) return null;
  return { min, max };
}

/* the rule a booking is checked against, as stored with it (null: the event has no age rule) */
export function ageRule(booking) {
  const cats = (booking && booking.pricing && booking.pricing.categories) || [];
  const off = cats.filter(c => c.allowed === false).map(c => c.key);
  const bookerAge = booking && booking.bookerAge ? booking.bookerAge : null;
  if (!bookerAge && !off.length && !(booking && booking.ageStrict)) return null;
  return { bookerAge, strict: !!(booking && booking.ageStrict), allowed: cats.filter(c => c.allowed !== false).map(c => c.key) };
}

/* 'YYYY-MM-DD' → { y, m, d } for a real past date, else null */
export function parseDob(value, now = Date.now()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  if (date.getTime() > now) return null;
  return { y, m: mo, d };
}

/* full years on the event's start day (its Cairo wall date 'YYYY-MM-DDTHH:MM'): a birthday that day counts */
export function ageAt(dob, startAt) {
  const s = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(startAt || ''));
  if (!dob || !s) return null;
  const [y, mo, d] = [Number(s[1]), Number(s[2]), Number(s[3])];
  return y - dob.y - (mo < dob.m || (mo === dob.m && d < dob.d) ? 1 : 0);
}

const inRange = (age, r) => (r.min == null || age >= r.min) && (r.max == null || age <= r.max);
const fits = (c, age) => (c.ageMin == null && c.ageMax == null) || ((c.ageMin == null || age >= c.ageMin) && (c.ageMax == null || age <= c.ageMax));

/*
 * The booker: { dob, age } or { problem: { field, message } }.
 * No booker range on the event → {} (nothing asked, nothing stored).
 */
export function checkBooker(booking, startAt, dobText, now = Date.now()) {
  const r = booking && booking.bookerAge;
  if (!r) return {};
  const dob = parseDob(dobText, now);
  const age = ageAt(dob, startAt);
  if (!dob || age == null || age < 5 || age > 100) return { problem: { field: 'bookerDob', message: AGE_MSG.dob } };
  if (!inRange(age, r)) return { problem: { field: 'bookerDob', message: AGE_MSG.booker(r.min, r.max), age }, dob: dobText, age };
  return { dob: dobText, age };
}

/*
 * Companions (people after the booker, each { age, cat }) and counts against the
 * allowed categories / strict rule → null or { field, message }.
 * Counts only (no ages): a count in a switched-off category is refused.
 */
export function checkCompanions(booking, { list = null, counts = null } = {}) {
  const cats = (booking && booking.pricing && booking.pricing.categories) || [];
  const allowed = cats.filter(c => c.allowed !== false);
  if (list) {
    for (const p of list.slice(1)) {
      const priced = cats.find(c => c.key === p.cat);
      if (priced && priced.allowed === false) return { field: 'participants', message: AGE_MSG.companion };
      if (booking.ageStrict && !allowed.some(c => fits(c, p.age))) return { field: 'participants', message: AGE_MSG.companion };
    }
    return null;
  }
  if (counts) {
    for (const c of cats) if (c.allowed === false && Number(counts[c.key]) > 0) return { field: 'counts', message: AGE_MSG.category };
  }
  return null;
}
