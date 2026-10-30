/**
 * YOUTH ACCOUNT: the page's pure rules (docs/YOUTH-ACCOUNTS-PLAN.md §8, §13).
 * Everything the server decides again; this only helps before a request is
 * spent. No DOM here, so tests/account-public.test.mjs can run it in Node.
 */

export const HINTS_KEY = 'athanasios.account.hints.v1';
export const SESSION_KEY = 'athanasios.account.v1';
export const MAX_HINTS = 3;

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

/* { token, email } from this tab (shared device) first, then this device */
export function readSession(local, session) {
  for (const store of [session, local]) {
    const value = store ? read(store, SESSION_KEY) : null;
    if (value && typeof value.token === 'string' && /^as1\./.test(value.token)) return value;
  }
  return null;
}

export function writeSession(local, session, value, kind) {
  clearSession(local, session);
  try {
    (kind === 'shared' ? session : local).setItem(SESSION_KEY, JSON.stringify(value));
  }
  catch { /* the session lives for this page only */ }
}

export function clearSession(local, session) {
  for (const store of [session, local]) {
    try {
      if (store) store.removeItem(SESSION_KEY);
    }
    catch { /* nothing to clear */ }
  }
}
