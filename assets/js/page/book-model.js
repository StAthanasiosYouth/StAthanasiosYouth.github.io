/**
 * ONLINE BOOKING — pure model (docs/EVENTS.md §6, §7.1, §9;
 * worker/BOOKING-API.md)
 *
 * No DOM, no network, no storage: runs in the browser and in Node (tests).
 *  - the live state (GET /v1/book/state) → what the booking area says
 *  - the steps of the visitor's flow, the phone check, the request key
 *  - the draft (localStorage athanasios.book.v1:<slug>) and «حجوزاتي»
 *    (athanasios.bookings.v1): their shapes, checked on every read
 *  - the status token from the address fragment (#b/<token>)
 *  - the API's error codes → a step, a field and words for the visitor
 *  - the status view's words
 * The counts and money come from model.js (the same arithmetic as the
 * Phase 3 counter): startCounts, stepCount, totalOf, seatsOf, money.
 */

import { formatStamp, arabicDigits } from '../words.js';
import { totalOf, seatsOf, money, line } from './model.js';

export const DRAFT_PREFIX = 'athanasios.book.v1:';
export const MINE_KEY = 'athanasios.bookings.v1';
export const DRAFT_LIFE_MS = 7 * 24 * 3600 * 1000;
export const MINE_MAX = 20;
export const PROOFS_MAX = 3;
export const NOTE_MAX = 300;
export const NAME_MAX = 60;

const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const KEY = /^[A-Za-z0-9_.:-]{8,100}$/;
const PROOF_ID = /^prf-[a-z2-7]{8}$/;
const REF = /^B-[A-Z0-9]{3,12}$/;
const TOKEN = /^bk1\.[A-Za-z0-9_-]{2,400}\.[A-Za-z0-9_-]{8,200}$/;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])$/;
const STEPS = ['a', 'b', 'c'];

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const stamp = value => (typeof value === 'string' && STAMP.test(value) ? value : '');

export const draftKey = slug => `${DRAFT_PREFIX}${slug}`;


/* =========================================================
   LIVE STATE (§7.1 step 1, §9)
========================================================= */

/** «فاضل مكان واحد», «فاضل مكانين», «فاضل ٥ أماكن», «فاضل ١٢ مكان» */
export function leftText(left) {
  if (!Number.isInteger(left) || left <= 0) return '';
  if (left === 1) return 'فاضل مكان واحد';
  if (left === 2) return 'فاضل مكانين';
  return `فاضل ${arabicDigits(left)} ${left <= 10 ? 'أماكن' : 'مكان'}`;
}

/**
 * The state reply → what the booking area shows:
 *   { live: 'open'|'not_open'|'closed'|'full'|'fallback', chip, line, left, opensAt, revision }
 * 'fallback' (API down, booking switched off, an odd reply): the Phase 3
 * display (the servants' WhatsApp) stays as it is.
 */
export function liveState(reply, booking = null) {

  const fallback = { live: 'fallback', chip: '', line: '', left: null, opensAt: '', revision: '' };
  if (!isObject(reply) || reply.ok === false || typeof reply.open !== 'boolean') return fallback;

  const left = Number.isInteger(reply.left) && reply.left >= 0 ? reply.left : null;
  const opensAt = stamp(reply.opensAt) || (booking && stamp(booking.opensAt)) || '';
  const revision = typeof reply.revision === 'string' ? reply.revision.slice(0, 80) : '';
  // the Worker's Turnstile site key: the send step shows the check (turnstile.js)
  const turnstile = typeof reply.turnstile === 'string' && /^[0-9A-Za-z_-]{10,80}$/.test(reply.turnstile) ? reply.turnstile : '';
  const base = { left, opensAt, revision, turnstile };

  if (reply.open) {
    if (left === 0) return { ...base, live: 'full', chip: 'اكتمل العدد', line: 'اكتمل العدد. لو حد اعتذر هيفضى مكان.' };
    return { ...base, live: 'open', chip: 'الحجز مفتوح', line: leftText(left) };
  }
  if (reply.reason === 'not_open') return { ...base, live: 'not_open', chip: 'لسه ما فتحش', line: opensAt ? `الحجز يفتح ${formatStamp(opensAt)}` : 'الحجز لسه ما فتحش' };
  if (reply.reason === 'closed') return { ...base, live: 'closed', chip: 'الحجز اتقفل', line: '' };
  if (reply.reason === 'full') return { ...base, left: 0, live: 'full', chip: 'اكتمل العدد', line: 'اكتمل العدد. لو حد اعتذر هيفضى مكان.' };
  return fallback;

}


/* =========================================================
   THE FLOW (§7.1)
========================================================= */

/** a free event (every price 0) skips the servant/method step (§3) */
export const isFree = booking => booking.pricing.categories.every(c => !c.price);

/** the steps a visitor goes through: who → (servant and method) → proof and send */
export function stepsFor(booking) {
  return isFree(booking) ? ['a', 'c'] : ['a', 'b', 'c'];
}

/** the people a booking counts (every category, seat or not) */
export function peopleCount(booking, counts) {
  return booking.pricing.categories.reduce((sum, c) => sum + (counts[c.key] || 0), 0);
}

/** counts → { adult, child, companion, total } (the Worker's people()) */
export function peopleOf(booking, counts) {
  const out = { adult: 0, child: 0, companion: 0, total: 0 };
  for (const c of booking.pricing.categories) {
    const n = counts[c.key] || 0;
    out[c.group] += n;
    out.total += n;
  }
  return out;
}

/** counts as the visitor left them, back inside each category's limits */
export function cleanCounts(booking, raw) {
  const counts = {};
  for (const c of booking.pricing.categories) {
    const n = isObject(raw) && Number.isInteger(raw[c.key]) ? raw[c.key] : c.min;
    counts[c.key] = Math.min(c.max, Math.max(c.min, n));
  }
  // over the seats of one booking: back to the minimum
  if (seatsOf(booking, counts) > booking.perBookingMax) for (const c of booking.pricing.categories) counts[c.key] = c.min;
  return counts;
}

/** Egyptian mobile, any way it's written → '+201xxxxxxxxx', or '' (the Worker's normPhone) */
export function normPhone(value) {
  const text = String(value == null ? '' : value)
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[‎‏؜‪-‮⁦-⁩﻿]/g, '')
    .replace(/[\s \-‐-―.()/]/g, '');
  const plus = text.charAt(0) === '+';
  let digits = plus ? text.slice(1) : text;
  if (!/^\d+$/.test(digits)) return '';
  if (plus) {
    if (!digits.startsWith('20')) return '';
    digits = digits.slice(2);
  }
  else if (digits.startsWith('0020')) digits = digits.slice(4);
  else if (digits.startsWith('20') && digits.length >= 11) digits = digits.slice(2);
  if (digits.charAt(0) === '0') digits = digits.slice(1);
  return /^1[0125]\d{8}$/.test(digits) ? `+20${digits}` : '';
}

/**
 * Step a's fields → { field: words } for each problem ({} = fine).
 * Gentle: the Worker checks again and has the last word.
 */
export function checkWho(booking, { name, phone, counts, names }, left = null) {
  const problems = {};
  const clean = line(name, NAME_MAX);
  if (clean.length < 2) problems.name = 'اكتب اسمك (حرفين على الأقل).';
  if (!normPhone(phone)) problems.phone = 'اكتب رقم موبايل مصري صح، زي 01012345678';
  const seats = seatsOf(booking, counts);
  if (seats > booking.perBookingMax) problems.counts = `أقصى عدد في الحجز الواحد ${arabicDigits(booking.perBookingMax)}.`;
  else if (Number.isInteger(left) && seats > left) problems.counts = left > 0 ? `${leftText(left)} بس. قلّل العدد.` : 'اكتمل العدد.';
  if (booking.collectNames) {
    const want = peopleCount(booking, counts);
    const given = (names || []).slice(0, want).map(n => line(n, NAME_MAX));
    if (given.length < want || given.some(n => n.length < 2)) problems.names = 'اكتب اسم كل واحد جاي.';
  }
  return problems;
}

/** step b: a servant of this event, one of that servant's methods, and (installments) «كامل» or «قسط» */
export function checkPay(booking, { servantId, method, payPlan, payAmount, counts }) {
  const servant = booking.servants.find(s => s.id && s.id === servantId && onlineMethodsOf(booking, s).length);
  if (!servant) return { servantId: 'اختار الخادم اللي هتدفع له.' };
  if (!servant.methods.includes(method)) return { method: 'اختار طريقة الدفع.' };
  if (!methodOnline(booking.methods.find(m => m.key === method))) return { method: 'الطريقة دي بتتدفع مع الخادم نفسه: كلّمه وهو هيسجّل حجزك.' };
  const total = totalOf(booking, counts || {});
  if (partAllowed(booking, total)) {
    // nothing picked = «دفع كامل» (preselected)
    if (payPlan && payPlan !== 'full' && payPlan !== 'part') return { payPlan: 'اختار: هتدفع المبلغ كله ولا قسط؟' };
    if (payPlan === 'part') {
      const problem = partProblem(booking, total, payAmount);
      if (problem) return { payAmount: problem };
    }
  }
  return {};
}

/*
 * «دفع قسط»: only when the event takes installments. The first part is at least
 * the event's minimum (never the whole total) and less than the total — the same
 * rule as the Worker (worker/src/book/model.js payClaim / minPart).
 */
export function partAllowed(booking, total) {
  return !!(booking.payment && booking.payment.mode === 'installments' && total > 1);
}

export function minPart(booking, total) {
  return Math.max(1, Math.min((booking.payment && booking.payment.minFirst) || 1, total - 1));
}

/** the amount typed (Arabic digits too) → a whole number, or NaN */
export function partAmount(value) {
  const text = String(value == null ? '' : value).trim().replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  return /^\d{1,7}$/.test(text) ? Number(text) : NaN;
}

export function partProblem(booking, total, value) {
  const n = partAmount(value);
  const min = minPart(booking, total);
  if (!Number.isInteger(n)) return 'اكتب المبلغ اللي هتحوّله بالأرقام.';
  if (n < min) return `أقل قسط ${money(min)}.`;
  if (n >= total) return `ده المبلغ كله (${money(total)}): اختار «دفع كامل».`;
  return '';
}

/*
 * May a visitor pay this way on the site? (event.json `online`; cash is
 * servant-assisted — shown for information, registered by the servant.)
 * An event.json from before the flag: a method that needs a proof is online.
 * The same rule as the Worker (worker/src/book/model.js methodOnline).
 */
export function methodOnline(m) {
  if (!m) return false;
  if (m.online === true || m.online === false) return m.online;
  return m.needsProof === true;
}

/** the servant's methods a visitor can pick on the site */
export function onlineMethodsOf(booking, servant) {
  return servant ? servant.methods.filter(k => methodOnline(booking.methods.find(m => m.key === k))) : [];
}

/** the servants who take a method visitors can't pay online (cash): the «كاش مع الخادم» card */
export function offlineServants(booking) {
  const offline = new Set(booking.methods.filter(m => !methodOnline(m)).map(m => m.key));
  return booking.servants.filter(s => s.id && s.methods.some(k => offline.has(k)))
    .map(s => ({ ...s, offline: s.methods.filter(k => offline.has(k)) }));
}

/*
 * A payment number as apps take it when pasted: ASCII digits only, local
 * form 01XXXXXXXXX — no +20, no spaces, no Arabic-Indic digits, no bidi
 * marks (InstaPay's and the wallets' «mobile number» fields). '' if not a mobile.
 */
export function payCopyText(value) {
  const e164 = normPhone(value);
  return e164 ? '0' + e164.slice(3) : '';
}

/** '01012345678' → '010 1234 5678' (for reading only; the copy is the plain digits) */
export function payGrouped(local) {
  const t = payCopyText(local);
  return t ? `${t.slice(0, 3)} ${t.slice(3, 7)} ${t.slice(7)}` : '';
}

/** the cash card's WhatsApp text: this event, this visitor, cash with the servant */
export function cashMessage(event, servant, { name, counts }) {
  const booking = event.booking;
  const who = line(name, NAME_MAX);
  const lines = [`سلام يا ${servant.name}، ${who ? `أنا ${who} و` : ''}عايز أحجز في «${event.title}» وأدفع كاش.`];
  for (const c of booking.pricing.categories) {
    const n = (counts && counts[c.key]) || 0;
    if (n) lines.push(`- ${c.label}: ${arabicDigits(n)}`);
  }
  if (counts && Object.keys(counts).some(k => counts[k])) lines.push(`الإجمالي: ${money(totalOf(booking, counts))}`);
  lines.push('ممكن تسجّل حجزي لما أدفعلك؟');
  return lines.join('\n');
}

/** does this method need a proof picture (§6: needsProof → 1–3) */
export function needsProof(booking, method) {
  const m = booking.methods.find(x => x.key === method);
  return !!(m && m.needsProof);
}

/** step c: the proofs (paid events only) and the terms */
export function checkSend(booking, { method, proofs, agreed, uploading = 0, captcha = null }, terms = '') {
  const problems = {};
  if (uploading) problems.proofs = 'استنى الصور لحد ما تترفع.';
  else if (!isFree(booking)) {
    const n = (proofs || []).length;
    if (n > PROOFS_MAX) problems.proofs = 'لحد ٣ صور بس.';
    else if (!n && needsProof(booking, method)) problems.proofs = 'ارفع صورة التحويل (سكرين شوت).';
  }
  if (terms && !agreed) problems.agreed = 'لازم توافق على الشروط الأول.';
  // captcha: { required, token } — the Turnstile check is still running (or failed)
  if (captcha && captcha.required && !captcha.token) problems.turnstile = 'استنى علامة التأكيد تخلص، أو اضغط عليها.';
  return problems;
}

/** a request key: made once at step a, kept in the draft (a repeat never books twice) */
export function newRequestKey(bytes) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = 'web.';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

/** POST /v1/book/submit's body */
/*
 * «كل فرد باسمه وسنه»: the same rule as the Worker (worker/src/book/model.js):
 * the first category after the first whose age range holds the age, else the
 * first (the normal price). Only to SHOW the total — the server prices it.
 */
export function categoryForAge(booking, age) {
  const cats = booking.pricing.categories;
  const hit = cats.slice(1).find(c => (c.ageMin != null || c.ageMax != null) && (c.ageMin == null || age >= c.ageMin) && (c.ageMax == null || age <= c.ageMax));
  return hit || cats[0];
}

/** the people list → counts (someone without a valid age yet counts at the normal price) */
export function peopleCounts(booking, people) {
  const counts = Object.fromEntries(booking.pricing.categories.map(c => [c.key, 0]));
  for (const p of people || []) {
    const age = Number(p && p.age);
    const known = p && String(p.age).trim() !== '' && Number.isInteger(age);
    counts[(known ? categoryForAge(booking, age) : booking.pricing.categories[0]).key]++;
  }
  return counts;
}

/** how many people this booking may hold (the per-booking limit, and the places left when known) */
export function peopleRoom(booking, left = null) {
  const cap = booking.perBookingMax || 10;
  return left === null || left === undefined ? cap : Math.max(0, Math.min(cap, left));
}

/** step a, participants mode → { people: message } or {} */
export function checkPeople(booking, people, left = null) {
  const list = people || [];
  if (!list.length) return { participants: 'زوّد فرد واحد على الأقل.' };
  if (list.length > peopleRoom(booking, left)) {
    return { participants: left !== null && left !== undefined && left < (booking.perBookingMax || 10) ? `فاضل ${arabicDigits(Math.max(0, left))} مكان بس.` : `أقصى عدد في الحجز الواحد ${arabicDigits(booking.perBookingMax || 10)}.` };
  }
  const at = personProblemAt(list);
  return at ? { participants: at.message } : {};
}

/*
 * Event age eligibility (docs/BOOKING-PHASE1-COMPLETION-PLAN.md §4.9), the same rules as
 * worker/src/book/age.js — here only for a fast message; the server decides.
 */
const rangeText = (min, max) => (min != null && max != null ? `من ${arabicDigits(min)} لـ ${arabicDigits(max)} سنة` : min != null ? `من ${arabicDigits(min)} سنة وأكبر` : `لحد ${arabicDigits(max)} سنة`);
export const AGE_WORDS = {
  dob: 'اكتب تاريخ ميلادك صح.',
  companion: 'السن ده مش مسموح للمرافقين في الفعالية دي — كلّم الخادم المسؤول.',
  category: 'الفئة دي مش متاحة في الفعالية دي — كلّم الخادم المسؤول.',
  booker: (min, max) => `الفعالية دي للسن ${rangeText(min, max)}.`
};

/** { d, m, y } (numbers or strings) → 'YYYY-MM-DD' for a real date, else '' */
/* the date-of-birth selects as kept in the draft: digits only */
function cleanDob(v) {
  const pick = (x, n) => (/^\d{1,4}$/.test(String(x == null ? '' : x)) ? String(x).slice(0, n) : '');
  return { d: pick(v && v.d, 2), m: pick(v && v.m, 2), y: pick(v && v.y, 4) };
}

export function dobText(dob) {
  const d = Number(dob && dob.d), m = Number(dob && dob.m), y = Number(dob && dob.y);
  if (!Number.isInteger(d) || !Number.isInteger(m) || !Number.isInteger(y)) return '';
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return '';
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** full years on the event's start day ('YYYY-MM-DD…' Cairo wall date) */
export function ageOnDay(dob, startAt) {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob || '');
  const s = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(startAt || ''));
  if (!a || !s) return null;
  const [y, m, d] = [+a[1], +a[2], +a[3]];
  return +s[1] - y - (+s[2] < m || (+s[2] === m && +s[3] < d) ? 1 : 0);
}

/** the booker's date of birth against the event's range → '' or the words to show */
export function bookerAgeProblem(booking, startAt, dob, now = Date.now()) {
  const r = booking && booking.bookerAge;
  if (!r) return '';
  const text = dobText(dob);
  const age = ageOnDay(text, startAt);
  if (!text || Date.parse(text) > now || age == null || age < 5 || age > 100) return AGE_WORDS.dob;
  if ((r.min != null && age < r.min) || (r.max != null && age > r.max)) return AGE_WORDS.booker(r.min, r.max);
  return '';
}

/** companions (people after the booker) against the allowed categories / strict rule → { index, message } or null */
export function companionProblemAt(booking, people) {
  const cats = booking.pricing.categories;
  const allowed = cats.filter(c => c.allowed !== false);
  const fits = (c, age) => (c.ageMin == null && c.ageMax == null) || ((c.ageMin == null || age >= c.ageMin) && (c.ageMax == null || age <= c.ageMax));
  for (const [i, p] of (people || []).entries()) {
    if (i === 0) continue;
    const age = Number(p && p.age);
    if (String(p && p.age).trim() === '' || !Number.isInteger(age)) continue;
    if (categoryForAge(booking, age).allowed === false || (booking.ageStrict && !allowed.some(c => fits(c, age)))) return { index: i, part: 'age', message: AGE_WORDS.companion };
  }
  return null;
}


/** the first person with a missing name or age: { index, part: 'name' | 'age', message }, or null */
export function personProblemAt(people) {
  for (const [i, p] of (people || []).entries()) {
    if (line(p.name, NAME_MAX).length < 2) return { index: i, part: 'name', message: `اكتب اسم الفرد ${arabicDigits(i + 1)}.` };
    const age = Number(p.age);
    if (String(p.age).trim() === '' || !Number.isInteger(age) || age < 0 || age > 120) return { index: i, part: 'age', message: `اكتب سن الفرد ${arabicDigits(i + 1)} (رقم).` };
  }
  return null;
}

export function submitBody(event, draft, { hp = '', revision = '', turnstile = '' } = {}) {
  const booking = event.booking;
  const counts = cleanCounts(booking, draft.counts);
  const body = {
    slug: event.slug,
    requestKey: draft.requestKey,
    name: line(draft.fields.name, NAME_MAX),
    phone: String(draft.fields.phone || '').trim().slice(0, 30),
    counts,
    hp,
    revision: revision || event.v || ''
  };
  if (booking.bookerAge) body.bookerDob = dobText(draft.fields.dob);
  if (booking.participants) {
    body.participants = (draft.people || []).map(p => ({ name: line(p.name, NAME_MAX), age: Number(p.age) }));
    body.counts = peopleCounts(booking, draft.people);
  }
  else if (booking.collectNames) body.names = (draft.names || []).slice(0, peopleCount(booking, counts)).map(n => line(n, NAME_MAX));
  const note = line(draft.note, NOTE_MAX);
  if (note) body.note = note;
  if (turnstile) body.turnstile = String(turnstile).slice(0, 2048);
  if (!isFree(booking)) {
    body.servantId = draft.servantId;
    body.method = draft.method;
    body.proofs = (draft.proofs || []).slice(0, PROOFS_MAX).map(p => ({ proofId: p.proofId, claim: p.claim }));
    // «دفع كامل» / «دفع قسط» (the Worker checks it again): only where installments are offered
    if (partAllowed(booking, totalOf(booking, body.counts))) {
      body.payPlan = draft.payPlan === 'part' ? 'part' : 'full';
      if (body.payPlan === 'part') body.payAmount = partAmount(draft.payAmount);
    }
  }
  return body;
}

/** the WhatsApp message to the chosen servant: the event, the visitor's name, the people and the total */
export function payMessage(event, servant, { name, counts, method }) {
  const booking = event.booking;
  const lines = [`سلام يا ${servant.name}، أنا ${line(name, NAME_MAX)} وعايز أحجز في «${event.title}».`];
  for (const c of booking.pricing.categories) {
    const n = counts[c.key] || 0;
    if (n) lines.push(`- ${c.label}: ${arabicDigits(n)}`);
  }
  lines.push(`الإجمالي: ${money(totalOf(booking, counts))}`);
  const m = booking.methods.find(x => x.key === method);
  if (m) lines.push(`هدفع ${m.label}.`);
  return lines.join('\n');
}


/* =========================================================
   THE DRAFT (§7.1): never file bytes, never past 7 days
========================================================= */

export function emptyDraft(booking, requestKey, now) {
  return {
    step: 'a',
    fields: { name: '', phone: '', dob: { d: '', m: '', y: '' } },
    counts: cleanCounts(booking, null),
    names: [],
    servantId: '',
    method: '',
    pay: '',
    payPlan: '',
    payAmount: '',
    people: [],
    note: '',
    agreed: false,
    requestKey,
    proofs: [],
    savedAt: now
  };
}

/** a stored draft (parsed JSON) → the draft, or null (missing, broken, too old) */
export function readDraft(raw, booking, now) {
  if (!isObject(raw) || !KEY.test(String(raw.requestKey || ''))) return null;
  const savedAt = Number(raw.savedAt);
  if (!Number.isFinite(savedAt) || now - savedAt > DRAFT_LIFE_MS || savedAt - now > 24 * 3600 * 1000) return null;
  const fields = isObject(raw.fields) ? raw.fields : {};
  const steps = stepsFor(booking);
  return {
    step: STEPS.includes(raw.step) && steps.includes(raw.step) ? raw.step : 'a',
    fields: { name: line(fields.name, NAME_MAX), phone: line(fields.phone, 30), dob: cleanDob(fields.dob) },
    counts: cleanCounts(booking, raw.counts),
    names: Array.isArray(raw.names) ? raw.names.slice(0, 50).map(n => line(n, NAME_MAX)) : [],
    servantId: line(raw.servantId, 60),
    method: line(raw.method, 20),
    // reached the payment card (shown) / copied the number (copied): a return from the app lands there
    pay: raw.pay === 'copied' || raw.pay === 'shown' ? raw.pay : '',
    payPlan: raw.payPlan === 'full' || raw.payPlan === 'part' ? raw.payPlan : '',
    payAmount: /^[0-9٠-٩]{0,7}$/.test(String(raw.payAmount || '')) ? String(raw.payAmount || '') : '',
    people: Array.isArray(raw.people) ? raw.people.slice(0, 50).map(p => ({ name: line(isObject(p) ? p.name : '', NAME_MAX), age: isObject(p) && /^\d{0,3}$/.test(String(p.age)) ? String(p.age) : '' })) : [],
    note: typeof raw.note === 'string' ? raw.note.slice(0, NOTE_MAX) : '',
    agreed: false,
    requestKey: raw.requestKey,
    proofs: (Array.isArray(raw.proofs) ? raw.proofs : [])
      .filter(p => isObject(p) && PROOF_ID.test(String(p.proofId)) && typeof p.claim === 'string' && p.claim.length <= 400)
      .slice(0, PROOFS_MAX)
      .map(p => ({ proofId: p.proofId, claim: p.claim })),
    savedAt
  };
}

/** what is written: the same shape, stamped now (never the pictures; «موافق» is asked again) */
export function storeDraft(draft, now) {
  return {
    step: draft.step,
    fields: { name: draft.fields.name, phone: draft.fields.phone, dob: cleanDob(draft.fields.dob) },
    counts: draft.counts,
    names: draft.names,
    servantId: draft.servantId,
    method: draft.method,
    pay: draft.pay || '',
    payPlan: draft.payPlan || '',
    payAmount: draft.payAmount || '',
    people: (draft.people || []).map(p => ({ name: p.name, age: String(p.age) })),
    note: draft.note,
    requestKey: draft.requestKey,
    proofs: draft.proofs.map(p => ({ proofId: p.proofId, claim: p.claim })),
    savedAt: now
  };
}


/* =========================================================
   «حجوزاتي» (§7.1): [{ slug, ref, token }], the newest first, ≤ 20
========================================================= */

export function readMine(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  return raw
    .filter(e => isObject(e) && SLUG.test(String(e.slug)) && REF.test(String(e.ref)) && TOKEN.test(String(e.token)))
    .filter(e => !seen.has(e.token) && seen.add(e.token))
    .slice(0, MINE_MAX)
    .map(e => ({ slug: e.slug, ref: e.ref, token: e.token }));
}

export function addMine(list, entry) {
  return readMine([entry, ...readMine(list).filter(e => e.token !== entry.token && !(e.slug === entry.slug && e.ref === entry.ref))]);
}

export function dropMine(list, token) {
  return readMine(list).filter(e => e.token !== token);
}

export const mineFor = (list, slug) => readMine(list).filter(e => e.slug === slug);


/* =========================================================
   THE STATUS LINK: /events/<slug>/#b/<token> (the token never leaves the fragment)
========================================================= */

export function tokenFromHash(hash) {
  const m = /^#b\/(.+)$/.exec(typeof hash === 'string' ? hash : '');
  if (!m) return '';
  let token = m[1];
  try {
    token = decodeURIComponent(token);
  }
  catch {
    return '';
  }
  return TOKEN.test(token) ? token : '';
}

export const isToken = value => typeof value === 'string' && TOKEN.test(value);
export const isRef = value => typeof value === 'string' && REF.test(value);

export function statusHref(siteRoot, slug, token) {
  return `${new URL(`events/${slug}/`, siteRoot).href}#b/${token}`;
}


/* =========================================================
   ERRORS → a step, a field and words (BOOKING-API.md «Envelope and errors»)
========================================================= */

const FIELD_STEP = { dob: 'a', name: 'a', phone: 'a', counts: 'a', names: 'a', participants: 'a', servantId: 'b', method: 'b', payPlan: 'b', payAmount: 'b', proofs: 'c', note: 'c' };

const FIELD_WORDS = {
  name: 'الاسم مش مظبوط. اكتب اسمك (من ٢ لـ ٦٠ حرف).',
  phone: 'رقم الموبايل مش مظبوط. اكتب رقم مصري زي 01012345678',
  counts: 'العدد مش مظبوط. راجع عدد الأفراد.',
  names: 'راجع أسماء اللي جايين.',
  participants: 'راجع الأفراد: اسم كل واحد (حرفين على الأقل) وسنه.',
  servantId: 'اختار الخادم تاني.',
  method: 'اختار طريقة الدفع تاني.',
  payPlan: 'اختار تاني: دفع كامل ولا قسط.',
  payAmount: 'مبلغ القسط مش مظبوط. راجع أقل وأقصى مبلغ.',
  proofs: 'ارفع صورة التحويل (من ١ لـ ٣ صور).',
  note: 'الملاحظة طويلة شوية. خليها أقصر.'
};

/**
 * A failed reply → { action, step, field, message, left }
 *   action: 'field'    show it on that step's field
 *           'fallback' booking is off: the servants' WhatsApp
 *           'refresh'  the window moved: read the state again
 *           'retry'    the same request can be sent again (same requestKey)
 *           'stop'     nothing to do but read the words
 */
export function bookingError(reply) {
  const r = isObject(reply) ? reply : {};
  const code = typeof r.code === 'string' ? r.code : 'network';
  const left = Number.isInteger(r.left) && r.left >= 0 ? r.left : null;
  switch (code) {
    case 'invalid': {
      const field = Object.prototype.hasOwnProperty.call(FIELD_STEP, r.field) ? r.field : '';
      return field
        ? { action: 'field', step: FIELD_STEP[field], field, message: FIELD_WORDS[field], left }
        : { action: 'stop', step: '', field: '', message: 'فيه حاجة مش مظبوطة في الطلب. راجع البيانات وجرّب تاني.', left };
    }
    case 'age': {
      const field = r.field === 'bookerDob' ? 'dob' : r.field === 'counts' ? 'counts' : 'participants';
      return { action: 'field', step: 'a', field, left, message: typeof r.message === 'string' && r.message ? r.message : AGE_WORDS.dob };
    }
    case 'full':
      return { action: 'field', step: 'a', field: 'counts', left, message: left ? `مفيش أماكن كفاية: ${leftText(left)} بس. قلّل العدد.` : 'اكتمل العدد، مفيش أماكن تانية دلوقتي.' };
    case 'limit':
      return { action: 'stop', step: '', field: '', left, message: 'عندك طلبين مستنيين المراجعة للفعالية دي. استنى رد الخادم، أو الغي طلب منهم.' };
    case 'not_open':
      return { action: 'refresh', step: '', field: '', left, message: stamp(r.opensAt) ? `الحجز لسه ما فتحش. بيفتح ${formatStamp(r.opensAt)}.` : 'الحجز لسه ما فتحش.' };
    case 'closed':
      return { action: 'refresh', step: '', field: '', left, message: 'الحجز اتقفل.' };
    case 'disabled':
    case 'not_found':
      return { action: 'fallback', step: '', field: '', left, message: 'الحجز أونلاين مش متاح دلوقتي. كلّم خادم من دول على واتساب.' };
    case 'proof':
      return { action: 'field', step: 'c', field: 'proofs', left, message: 'صورة من الصور فيها مشكلة. شيلها وارفعها تاني (سكرين شوت).' };
    case 'turnstile':
      return { action: 'field', step: 'c', field: 'turnstile', left, message: 'التأكيد إنك مش روبوت ما نفعش. كمّله تاني وابعت.' };
    case 'rate':
      return { action: 'retry', step: '', field: '', left, message: 'طلبات كتير ورا بعض. استنى دقيقة وجرّب تاني.' };
    case 'toolarge':
      return { action: 'field', step: 'c', field: 'proofs', left, message: 'الصورة كبيرة قوي. ابعت سكرين شوت.' };
    case 'expired':
      return { action: 'stop', step: '', field: '', left, message: 'الرابط ده انتهى أو مش صحيح.' };
    case 'final':
      return { action: 'refresh', step: '', field: '', left, message: 'الطلب ده ماينفعش يتغير دلوقتي.' };
    case 'network':
    case 'busy':
    case 'error':
      return { action: 'retry', step: '', field: '', left, message: 'مقدرناش نوصل. اتأكد من النت وجرّب تاني.' };
    default:
      return { action: 'retry', step: '', field: '', left, message: 'حصلت مشكلة. جرّب تاني بعد شوية.' };
  }
}


/* =========================================================
   THE STATUS VIEW (§4, §7.1)
========================================================= */

export const STATUS_WORDS = {
  pending: 'قيد المراجعة',
  confirmed: 'اتأكد',
  rejected: 'اترفض',
  withdrawn: 'اتلغى بطلبك',
  cancelled: 'اتلغى'
};

export const statusWord = status => STATUS_WORDS[status] || 'غير معروف';

/** { adult, child, companion, total } → «٣ أفراد: ٢ كبار، ١ طفل» */
export function peopleText(people) {
  if (!isObject(people)) return '';
  const n = key => (Number.isInteger(people[key]) && people[key] > 0 ? people[key] : 0);
  const total = n('total') || n('adult') + n('child') + n('companion');
  if (!total) return '';
  const head = total === 1 ? 'فرد واحد' : total === 2 ? 'فردين' : `${arabicDigits(total)} ${total <= 10 ? 'أفراد' : 'فرد'}`;
  const parts = [
    n('adult') ? `${arabicDigits(n('adult'))} ${n('adult') === 1 ? 'كبير' : 'كبار'}` : '',
    n('child') ? `${arabicDigits(n('child'))} ${n('child') === 1 ? 'طفل' : 'أطفال'}` : '',
    n('companion') ? `${arabicDigits(n('companion'))} ${n('companion') === 1 ? 'مرافق' : 'مرافقين'}` : ''
  ].filter(Boolean);
  return parts.length > 1 ? `${head}: ${parts.join('، ')}` : head;
}

const amount = value => (Number.isInteger(value) && value >= 0 ? value : null);

/**
 * The status reply → the rows the status view shows:
 * { ref, status, word, rows: [[label, value]], reason, canWithdraw }
 */
export function statusView(reply) {
  if (!isObject(reply) || reply.ok === false || !isRef(reply.ref)) return null;
  const status = Object.prototype.hasOwnProperty.call(STATUS_WORDS, reply.status) ? reply.status : '';
  const rows = [];
  const people = peopleText(reply.people);
  if (people) rows.push(['الأفراد', people]);
  if (status === 'confirmed' || (status === 'cancelled' && amount(reply.paid))) {
    const due = amount(reply.amountDue);
    const paid = amount(reply.paid) ?? 0;
    if (due !== null) rows.push(['المطلوب', due ? money(due) : 'مجانًا']);
    if (due) {
      rows.push(['اتدفع', paid ? money(paid) : 'لسه']);
      const balance = Number.isInteger(reply.balance) ? reply.balance : due - paid;
      rows.push(['الباقي', balance > 0 ? money(balance) : 'مفيش']);
      if (balance > 0 && stamp(reply.finalDueAt)) rows.push(['آخر معاد للباقي', formatStamp(reply.finalDueAt)]);
    }
  }
  else if (status === 'pending' && amount(reply.quotedTotal) !== null) {
    rows.push(['الإجمالي', money(reply.quotedTotal)]);
  }
  return {
    ref: reply.ref,
    status,
    word: statusWord(status),
    firstName: line(reply.firstName, 40),
    title: isObject(reply.event) ? line(reply.event.title, 80) : '',
    rows,
    overdue: status === 'confirmed' && reply.overdue === true,
    reason: (status === 'rejected' || status === 'cancelled') ? line(reply.reason, 200) : '',
    canWithdraw: status === 'pending'
  };
}
