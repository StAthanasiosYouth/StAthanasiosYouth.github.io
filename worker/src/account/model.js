/*
 * Youth accounts: the pure rules (docs/YOUTH-ACCOUNTS-PLAN.md §6, §9, §16).
 * No I/O here. The phone and date rules are the booking's own (book/model.js,
 * book/age.js), so one number or date means the same everywhere.
 */

import { normPhone, localPhone } from '../book/model.js';
import { parseDob, ageAt } from '../book/age.js';
import { cairoText } from '../lib/db.js';

const DAY = 24 * 3600 * 1000;
const EMAIL_RE = /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$/;

/* a small static list (§15): throwaway inboxes are refused at registration */
const DISPOSABLE = new Set(['mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'sharklasers.com', '10minutemail.com', 'tempmail.com', 'temp-mail.org', 'yopmail.com', 'trashmail.com', 'getnada.com', 'dispostable.com', 'maildrop.cc', 'throwawaymail.com', 'fakeinbox.com']);

export const cleanEmail = value => String(value == null ? '' : value).trim().slice(0, 254);

export function validEmail(email) {
  return EMAIL_RE.test(email);
}

export function disposableEmail(email) {
  return DISPOSABLE.has(email.slice(email.lastIndexOf('@') + 1).toLowerCase());
}

/* §16.2: one mailbox, one account: gmail ignores dots and +tags, outlook ignores +tags */
export function canonEmail(value) {
  const email = cleanEmail(value).normalize('NFC').toLowerCase();
  const at = email.lastIndexOf('@');
  if (at < 1) return email;
  let local = email.slice(0, at);
  let domain = email.slice(at + 1);
  try { domain = new URL('http://' + domain).hostname; } catch { /* the shape check refuses it first */ }
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.split('+')[0].replace(/\./g, '');
  else if (['outlook.com', 'hotmail.com', 'live.com'].includes(domain)) local = local.split('+')[0];
  return local + '@' + domain;
}

/* §16.1: '01012345678' + '1012345678', or null */
export function phoneParts(value) {
  const e164 = normPhone(value);
  return e164 ? { phone: localPhone(e164), phoneNorm: e164.slice(3) } : null;
}

/* «عبد المسيح» and «أبو سيفين» count as one name (§6.2) */
export function nameParts(value) {
  const words = String(value == null ? '' : value).normalize('NFC').trim().split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < words.length; i++) {
    if (/^(عبد|أبو|ابو|إبو)$/.test(words[i]) && i < words.length - 1) out.push(words[i] + ' ' + words[++i]);
    else out.push(words[i]);
  }
  return out;
}

export function checkName(value) {
  const name = String(value == null ? '' : value).normalize('NFC').trim().replace(/\s+/g, ' ');
  if (name.length > 80) return { message: 'الاسم طويل زيادة.' };
  const parts = nameParts(name);
  if (parts.length < 3) return { message: 'اكتب اسمك ثلاثي أو رباعي.' };
  if (parts.length > 4) return { message: 'اكتب ٣ أو ٤ أسماء بس.' };
  return { name };
}

/* for the same-name flags of the admin list (§16.3): spelling variants read as one */
export function normName(value) {
  return String(value == null ? '' : value).normalize('NFC')
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .trim().replace(/\s+/g, ' ');
}

export const firstName = name => nameParts(name)[0] || '';

/* §6 step 3: a real date, not in the future, age 5–100 */
export function checkBirthDate(value, now = Date.now()) {
  const text = String(value == null ? '' : value);
  const dob = parseDob(text, now);
  if (!dob) return { message: 'اكتب تاريخ ميلادك صح.' };
  const age = ageAt(dob, cairoText(now));
  if (age < 5 || age > 100) return { message: 'اكتب تاريخ ميلادك صح.' };
  return { birthDate: text };
}

export function rulesFrom(settings) {
  const num = (v, d) => (Number.isInteger(Number(v)) && v !== '' && v != null ? Number(v) : d);
  return { min: num(settings.age_min, 18), max: num(settings.age_max, 30), warnDays: num(settings.age_warn_days, 60) };
}

/*
 * §9.1: recomputed on every request from the DOB and the CURRENT Admin range;
 * nothing stored, so nothing goes stale. → { state, source, age, soon, leavesAt }
 * state: blocked | guest | eligible. A 29 Feb birthday falls on 1 March.
 */
export function eligibility(account, rules, now = Date.now()) {
  const today = cairoText(now).slice(0, 10);
  const dob = parseDob(account.birth_date, now);
  const age = dob ? ageAt(dob, today) : null;
  if (account.status === 'blocked') return { state: 'blocked', source: 'status', age, soon: false, leavesAt: null };
  if (account.eligibility_override === 'guest' || account.eligibility_override === 'eligible') {
    return { state: account.eligibility_override, source: 'override', age, soon: false, leavesAt: null };
  }
  if (age == null || age < rules.min || age > rules.max) return { state: 'guest', source: 'auto', age, soon: false, leavesAt: null };
  const leaves = Date.UTC(dob.y + rules.max + 1, dob.m - 1, dob.d);
  const daysLeft = Math.round((leaves - Date.parse(today + 'T00:00:00Z')) / DAY);
  return { state: 'eligible', source: 'auto', age, soon: daysLeft <= rules.warnDays, leavesAt: new Date(leaves).toISOString().slice(0, 10) };
}

/* the session's device label: a family only, never the raw user agent */
export function deviceLabel(userAgent) {
  const ua = String(userAgent || '');
  const os = /android/i.test(ua) ? 'Android' : /iphone|ipad|ipod/i.test(ua) ? 'iPhone' : /windows/i.test(ua) ? 'Windows' : /mac os/i.test(ua) ? 'Mac' : /linux/i.test(ua) ? 'Linux' : '';
  const app = /edg\//i.test(ua) ? 'Edge' : /firefox|fxios/i.test(ua) ? 'Firefox' : /chrome|crios/i.test(ua) ? 'Chrome' : /safari/i.test(ua) ? 'Safari' : '';
  return (os + ' ' + app).trim() || 'جهاز';
}
