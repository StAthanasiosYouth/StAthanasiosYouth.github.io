/**
 * ONLINE BOOKING — this device's memory (docs/EVENTS.md §7.1)
 *
 *   athanasios.book.v1:<slug>   the draft (book-model.js readDraft / storeDraft)
 *   athanasios.bookings.v1      «حجوزاتي»: [{ slug, ref, token }], ≤ 20
 *
 * Storage can be missing, full or blocked (a private window): every read
 * and write is inside try and the page works without it. Never used by
 * the admin preview (main.js never loads the booking there).
 */

import { readSession, RETURN_KEY } from '../account/model.js';
import { draftKey, readDraft, storeDraft, readMine, addMine, dropMine, MINE_KEY } from './book-model.js';

function store() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  }
  catch {
    return null;
  }
}

/* the youth account signed in on this device, or null (docs/YOUTH-ACCOUNTS-PLAN.md §18.1) */
export function accountSession() {
  try {
    return readSession(store(), typeof sessionStorage === 'undefined' ? null : sessionStorage);
  }
  catch {
    return null;
  }
}

/* where to come back after signing in: this tab only */
export function keepSignInReturn(path) {
  try {
    sessionStorage.setItem(RETURN_KEY, path);
  }
  catch { /* the account page still opens */ }
}

function readJson(key) {
  try {
    const s = store();
    const text = s ? s.getItem(key) : null;
    return text ? JSON.parse(text) : null;
  }
  catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    const s = store();
    if (!s) return false;
    if (value === null) s.removeItem(key);
    else s.setItem(key, JSON.stringify(value));
    return true;
  }
  catch {
    return false;
  }
}

export function loadDraft(slug, booking, now = Date.now()) {
  const draft = readDraft(readJson(draftKey(slug)), booking, now);
  // an old or broken one: gone
  if (!draft) writeJson(draftKey(slug), null);
  return draft;
}

export const saveDraft = (slug, draft, now = Date.now()) => writeJson(draftKey(slug), storeDraft(draft, now));

export const clearDraft = slug => writeJson(draftKey(slug), null);

export const loadMine = () => readMine(readJson(MINE_KEY));

export const rememberBooking = entry => writeJson(MINE_KEY, addMine(loadMine(), entry));

export const forgetBooking = token => writeJson(MINE_KEY, dropMine(loadMine(), token));
