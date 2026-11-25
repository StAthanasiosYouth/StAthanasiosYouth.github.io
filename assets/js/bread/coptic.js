/*
 * Shared by the Worker (worker/src/bread/saints.js), the tools (tools/lib/coptic.mjs re-exports it) and the admin (P3).
 *
 * The Coptic calendar ↔ Gregorian, by Julian Day Number (no table per year).
 * Coptic year Y: 12 months of 30 days, then النسيء (5 days, 6 in a year where Y % 4 === 3).
 * Epoch: 1 Tout 1 = JDN 1825030 (29 August 284, Julian).
 * Months: 1 توت · 2 بابه · 3 هاتور · 4 كيهك · 5 طوبه · 6 أمشير · 7 برمهات · 8 برموده · 9 بشنس · 10 بؤونه · 11 أبيب · 12 مسرى · 13 النسيء
 */
export const MONTHS = ['توت', 'بابه', 'هاتور', 'كيهك', 'طوبه', 'أمشير', 'برمهات', 'برموده', 'بشنس', 'بؤونه', 'أبيب', 'مسرى', 'النسيء'];
const EPOCH = 1825030;

const jdnOfCoptic = (y, m, d) => EPOCH - 1 + 365 * (y - 1) + Math.floor(y / 4) + 30 * (m - 1) + d;

function jdnOfGregorian(y, m, d) {
  const a = Math.floor((14 - m) / 12), yy = y + 4800 - a, mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}

function gregorianOfJdn(j) {
  const a = j + 32044, b = Math.floor((4 * a + 3) / 146097), c = a - Math.floor(146097 * b / 4);
  const d = Math.floor((4 * c + 3) / 1461), e = c - Math.floor(1461 * d / 4), m = Math.floor((5 * e + 2) / 153);
  return { y: 100 * b + d - 4800 + Math.floor(m / 10), m: m + 3 - 12 * Math.floor(m / 10), d: e - Math.floor((153 * m + 2) / 5) + 1 };
}

const isLeap = y => y % 4 === 3;
export const monthDays = (y, m) => (m < 13 ? 30 : isLeap(y) ? 6 : 5);

/* Coptic → 'YYYY-MM-DD' (Gregorian) */
export function toGregorian(y, m, d) {
  const g = gregorianOfJdn(jdnOfCoptic(y, m, d));
  return `${g.y}-${String(g.m).padStart(2, '0')}-${String(g.d).padStart(2, '0')}`;
}

/* 'YYYY-MM-DD' (Gregorian) → { y, m, d } Coptic */
export function toCoptic(iso) {
  const [gy, gm, gd] = iso.split('-').map(Number);
  const j = jdnOfGregorian(gy, gm, gd);
  const y = Math.floor((4 * (j - EPOCH) + 1463) / 1461);
  const start = jdnOfCoptic(y, 1, 1);
  const m = Math.floor((j - start) / 30) + 1;
  return { y, m, d: j - start - 30 * (m - 1) + 1 };
}

/*
 * The Gregorian dates of a Gregorian month on which a Coptic day-of-year falls: [{ date, m, d }].
 * A feast kept on 6 النسيء (leap years only) is kept on 5 النسيء in other years.
 */
export function daysOfMonth(ym) {
  const [y, mo] = ym.split('-').map(Number);
  const n = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const out = [];
  for (let d = 1; d <= n; d++) {
    const date = `${ym}-${String(d).padStart(2, '0')}`;
    const c = toCoptic(date);
    out.push({ date, m: c.m, d: c.d, y: c.y });
  }
  return out;
}
