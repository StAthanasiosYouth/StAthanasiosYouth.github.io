/**
 * LOCAL AUTOSAVE (§13)
 *
 * localStorage['athanasios.comp.v1:<slug>'] =
 *   { clientKey, token, receipt, answers, at, step,          ← the contract's keys
 *     v, fields, ptoken, participant, attempt, comp, questions, pending, submittedAt }
 *
 * Written on every change; read back on reload / reopen, so a participant
 * continues on the same question with the same answers (the questions the
 * server served are kept too: a reload works offline). After a confirmed
 * submit everything is cleared except the receipt (to re-check the result
 * later). Every storage access is wrapped: private mode, a full disk or a
 * blocked storage just means "nothing remembered". The admin preview uses
 * memoryStorage() (nothing touches the real site's storage).
 */

import { cleanQuestions, cleanSavedAnswers, cleanStartComp, sanitizeDefinition, SLUG } from './flow.js';

export const PREFIX = 'athanasios.comp.v1:';

export const storageKey = slug => `${PREFIX}${slug}`;

export function memoryStorage() {
  const data = new Map();
  return {
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: key => { data.delete(key); }
  };
}

/* window.localStorage itself can throw (blocked site data) */
export function browserStorage() {
  try {
    return globalThis.localStorage || null;
  }
  catch {
    return null;
  }
}

const str = (value, max) => (typeof value === 'string' && value.length <= max ? value : '');

/** A stored record → a usable one (anything malformed is dropped, never trusted). */
export function cleanRecord(raw) {

  if (!raw || typeof raw !== 'object') return null;

  const questions = cleanQuestions(raw.questions);
  const record = {
    clientKey: /^[\w-]{8,64}$/.test(raw.clientKey || '') ? raw.clientKey : '',
    token: str(raw.token, 4000),
    receipt: str(raw.receipt, 4000),
    answers: cleanSavedAnswers(questions, raw.answers),
    at: Number.isFinite(raw.at) ? raw.at : 0,
    step: /^(q:\d{1,3}|single|review)$/.test(raw.step || '') ? raw.step : '',
    v: str(raw.v, 40),
    fields: {},
    ptoken: str(raw.ptoken, 4000),
    participant: raw.participant && typeof raw.participant === 'object' && typeof raw.participant.name === 'string'
      ? { name: raw.participant.name.slice(0, 80), group: typeof raw.participant.group === 'string' ? raw.participant.group.slice(0, 60) : '' }
      : null,
    attempt: null,
    comp: raw.comp ? cleanStartComp(raw.comp) : null,
    questions,
    pending: raw.pending === true,
    submittedAt: str(raw.submittedAt, 40),
    // the published comp.json the attempt started with (a reload works offline)
    def: raw.def && typeof raw.def === 'object' && !Array.isArray(raw.def) && sanitizeDefinition(raw.def) && JSON.stringify(raw.def).length < 20000 ? raw.def : null
  };

  if (raw.fields && typeof raw.fields === 'object') {
    for (const [key, value] of Object.entries(raw.fields)) {
      if (/^(name|phone|age|church|group|custom[123])$/.test(key) && typeof value === 'string') record.fields[key] = value.slice(0, 80);
    }
  }

  if (raw.attempt && typeof raw.attempt === 'object') {
    const deadline = Number(raw.attempt.deadlineMs);
    record.attempt = {
      id: str(raw.attempt.id, 60),
      startedAt: str(raw.attempt.startedAt, 40),
      deadlineMs: Number.isFinite(deadline) && deadline > 0 ? deadline : 0
    };
  }

  // an attempt in progress needs its token and its questions
  if (!record.token || !record.questions.length) {
    record.token = '';
    record.questions = [];
    record.answers = {};
    record.step = '';
    record.attempt = null;
    record.pending = false;
    record.def = null;
  }

  return record;

}

/**
 * createSave(slug, storage) → { read, write, afterSubmit, clear }
 * storage: a Storage-like object (or a function returning one), or null.
 */
export function createSave(slug, storage = browserStorage(), now = () => Date.now()) {

  const key = SLUG.test(slug || '') ? storageKey(slug) : '';
  const store = () => {
    try {
      return typeof storage === 'function' ? storage() : storage;
    }
    catch {
      return null;
    }
  };

  let memo = null;

  function read() {
    if (!key) return null;
    try {
      const raw = store() && store().getItem(key);
      memo = raw ? cleanRecord(JSON.parse(raw)) : null;
    }
    catch {
      memo = null;
    }
    return memo;
  }

  function put(record) {
    memo = record;
    if (!key) return false;
    try {
      const s = store();
      if (!s) return false;
      s.setItem(key, JSON.stringify(record));
      return true;
    }
    catch {
      return false;
    }
  }

  /** merge a patch into the record and write it (every change) */
  function write(patch) {
    const base = memo || read() || {};
    return put({ ...base, ...patch, at: now() });
  }

  /** a confirmed submit: only the receipt (and when) stays */
  function afterSubmit(receipt, submittedAt = '') {
    return put({ receipt: typeof receipt === 'string' ? receipt : '', submittedAt, at: now() });
  }

  function clear() {
    memo = null;
    if (!key) return;
    try {
      const s = store();
      if (s) s.removeItem(key);
    }
    catch {
      // nothing to do
    }
  }

  return { read, write, afterSubmit, clear, get record() { return memo; } };

}
