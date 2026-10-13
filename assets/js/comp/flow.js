/**
 * COMPETITION FLOW (pure: no DOM, no storage, no network — tested in Node)
 *
 * Everything the engine decides: what the published files may contain
 * (re-validated like content.js does for content.json), which phase a
 * competition is in by Cairo time, the participant form and answer rules,
 * the step machine, the result wording and the retry timing.
 *
 * Contract: docs/COMPETITIONS.md §3.3, §4.3, §5, §13.
 */

import { arabicDigits, formatStamp, untilText } from '../words.js';

export const SLUG = /^[a-z0-9-]{2,40}$/;

const STAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/;

/* images are always this site's own published files (content.js MEDIA_PATH) */
export const MEDIA_PATH = /^media\/\d{4}\/img-[a-z0-9]{8}(-480)?\.(webp|jpg)$/;

export const THEMES = ['gold', 'ember', 'azure', 'rose', 'emerald', 'night'];

export const QUESTION_TYPES = ['single', 'multi', 'truefalse', 'short', 'long', 'number', 'info'];

const FIELD_KEYS = ['name', 'phone', 'age', 'church', 'group', 'custom1', 'custom2', 'custom3'];

const FIELD_LABELS = { name: 'الاسم', phone: 'رقم الموبايل', age: 'السن', church: 'الكنيسة', group: 'المرحلة', custom1: 'سؤال إضافي', custom2: 'سؤال إضافي', custom3: 'سؤال إضافي' };

export const DEFAULT_FIELDS = [
  { key: 'name', label: 'الاسم', type: 'text', mode: 'required', options: [] },
  { key: 'phone', label: 'رقم الموبايل', type: 'phone', mode: 'required', options: [] }
];

export const LIMITS = { short: 200, long: 3000, number: 40, field: 80 };


/* =========================================================
   PRIMITIVES
========================================================= */

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

const flag = value => value === true || value === 1 || value === '1';

const int = (value, min, max, fallback) => {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

const cleanId = value => (typeof value === 'string' && /^[\w-]{1,60}$/.test(value) ? value : '');

/** Cairo wall stamp in the content.json form "YYYY-MM-DDTHH:MM" ('' when absent or malformed). */
export function cleanStamp(value) {
  return typeof value === 'string' && STAMP.test(value.trim()) ? value.trim().replace(' ', 'T') : '';
}

/** Arabic-Indic and Persian digits → ASCII. */
export function normalizeDigits(value) {
  return String(value == null ? '' : value)
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0));
}


/* =========================================================
   SLUG AND URLS
========================================================= */

/**
 * The competition this page shows: <html data-slug> (generated stubs) or
 * ?s=<slug> (the shell). Anything that isn't a valid slug → ''.
 */
export function slugFrom({ dataSlug = '', search = '' } = {}) {

  const fromData = typeof dataSlug === 'string' ? dataSlug.trim() : '';

  if (fromData) return SLUG.test(fromData) ? fromData : '';

  let fromQuery = '';
  try {
    fromQuery = new URLSearchParams(search).get('s') || '';
  }
  catch {
    fromQuery = '';
  }

  return SLUG.test(fromQuery) ? fromQuery : '';

}

/** comp.json of a slug, relative to the site root (cache-busted with ?v when known). */
export function compJsonPath(slug, v = '') {
  if (!SLUG.test(slug || '')) return '';
  const version = typeof v === 'string' && /^[\w.-]{1,40}$/.test(v) ? `?v=${v}` : '';
  return `competition/${slug}/comp.json${version}`;
}

/** The competition page of a slug, relative to the site root. */
export function compPagePath(slug) {
  return SLUG.test(slug || '') ? `competition/${slug}/` : '';
}


/* =========================================================
   PUBLISHED FILES (re-validated; the publisher already did it once)
========================================================= */

export function cleanImage(raw) {

  if (!raw || typeof raw !== 'object' || !MEDIA_PATH.test(raw.src || '')) return null;

  const w = Number(raw.w);
  const h = Number(raw.h);

  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1 || w > 10000 || h > 10000) return null;

  const image = {
    src: raw.src,
    thumb: MEDIA_PATH.test(raw.thumb || '') ? raw.thumb : raw.src,
    w: Math.round(w),
    h: Math.round(h),
    alt: text(raw.alt, 140)
  };

  if (typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color)) image.color = raw.color;

  return image;

}


export function cleanFields(raw) {

  if (!Array.isArray(raw)) return DEFAULT_FIELDS.map(f => ({ ...f }));

  const seen = new Set();
  const fields = [];

  for (const f of raw) {
    if (!f || typeof f !== 'object' || !FIELD_KEYS.includes(f.key) || seen.has(f.key)) continue;
    seen.add(f.key);
    const options = Array.isArray(f.options) ? f.options.map(o => text(o, 40)).filter(Boolean).slice(0, 12) : [];
    let type = f.key === 'name' ? 'text' : f.key === 'phone' ? 'phone' : f.key === 'age' ? 'number' : (f.type === 'select' ? 'select' : 'text');
    if (type === 'select' && options.length < 1) type = 'text';
    fields.push({
      key: f.key,
      label: text(f.label, 40) || FIELD_LABELS[f.key],
      type,
      mode: ['required', 'optional', 'hidden'].includes(f.mode) ? f.mode : 'hidden',
      options: type === 'select' ? options : []
    });
  }

  return fields;

}


/**
 * One public question (compStart PublicQuestion, or the admin preview's
 * draft question). Private parts (correct, explanation, review) are never
 * kept even if a file carried them.
 */
export function cleanQuestion(raw) {

  if (!raw || typeof raw !== 'object') return null;

  const id = cleanId(raw.id);
  const type = QUESTION_TYPES.includes(raw.type) ? raw.type : '';
  const body = text(raw.text, type === 'info' ? 2000 : 600);

  if (!id || !type || !body) return null;

  let choices = [];
  if (type === 'single' || type === 'multi') {
    const ids = new Set();
    choices = (Array.isArray(raw.choices) ? raw.choices : [])
      .map(c => (c && typeof c === 'object' ? { id: cleanId(c.id), text: text(c.text, 200) } : null))
      .filter(c => c && c.id && c.text && !ids.has(c.id) && ids.add(c.id))
      .slice(0, 8);
    if (choices.length < 2) return null;
  }

  const points = Number(raw.points);

  return {
    id,
    type,
    text: body,
    help: text(raw.help, 300),
    media: cleanImage(raw.media),
    choices,
    required: type !== 'info' && flag(raw.required),
    points: type !== 'info' && raw.points !== undefined && raw.points !== null && raw.points !== '' && Number.isFinite(points) && points >= 0 && points <= 10000 ? Math.round(points) : null
  };

}


export function cleanQuestions(list) {

  const ids = new Set();

  return (Array.isArray(list) ? list : [])
    .slice(0, 300)
    .map(cleanQuestion)
    .filter(q => q && !ids.has(q.id) && ids.add(q.id));

}


/**
 * comp.json → the definition the page uses; { withdrawn: true, slug } for
 * an unpublished one; null for anything unusable.
 * withQuestions: the admin preview's draft (questions inline).
 */
export function sanitizeDefinition(raw, { withQuestions = false } = {}) {

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const slug = typeof raw.slug === 'string' && SLUG.test(raw.slug) ? raw.slug : '';

  if (raw.withdrawn === true) return { withdrawn: true, slug };

  const title = text(raw.title, 80);

  if (!title) return null;

  const def = {
    schema: 1,
    id: cleanId(raw.id),
    slug,
    v: typeof raw.v === 'string' && /^[\w.-]{1,40}$/.test(raw.v) ? raw.v : '',
    title,
    shortTitle: text(raw.shortTitle, 30) || title.slice(0, 30),
    description: text(raw.description, 600),
    instructions: text(raw.instructions, 2000),
    ctaLabel: text(raw.ctaLabel, 24) || 'ابدأ المسابقة',
    banner: cleanImage(raw.banner),
    icon: cleanImage(raw.icon),
    theme: THEMES.includes(raw.theme) ? raw.theme : '',
    startAt: cleanStamp(raw.startAt),
    endAt: cleanStamp(raw.endAt),
    resultsAt: cleanStamp(raw.resultsAt),
    answersAt: cleanStamp(raw.answersAt),
    participation: raw.participation === 'registered' ? 'registered' : 'open',
    // §19.2: a coded competition that also takes guests (the identity form, no points)
    allowGuests: raw.participation === 'registered' && raw.allowGuests === true,
    scoring: flag(raw.scoring),
    resultShow: ['none', 'score', 'points', 'both'].includes(raw.resultShow) ? raw.resultShow : 'none',
    answersShow: ['never', 'immediately', 'afterClose', 'atDate'].includes(raw.answersShow) ? raw.answersShow : 'never',
    showPoints: flag(raw.showPoints),
    wallet: flag(raw.wallet),
    attempts: int(raw.attempts, 1, 20, 1),
    layout: raw.layout === 'single' ? 'single' : 'paged',
    timeLimit: int(raw.timeLimit, 0, 600, 0),
    fields: cleanFields(raw.fields),
    successText: text(raw.successText, 300),
    questionCount: int(raw.questionCount, 0, 300, 0),
    totalPoints: int(raw.totalPoints, 0, 3000000, 0),
    publishedAt: text(raw.publishedAt, 40)
  };

  if (withQuestions) {
    def.questions = cleanQuestions(raw.questions);
    def.questionCount = def.questions.filter(q => q.type !== 'info').length;
    def.totalPoints = def.questions.reduce((sum, q) => sum + (q.points || 0), 0);
  }

  return def;

}


/** compStart's comp part: { v, layout, showPoints, timeLimit, total }. */
export function cleanStartComp(raw, def) {

  const c = raw && typeof raw === 'object' ? raw : {};

  return {
    v: typeof c.v === 'string' ? c.v.slice(0, 40) : (def ? def.v : ''),
    layout: c.layout === 'single' || c.layout === 'paged' ? c.layout : (def ? def.layout : 'paged'),
    showPoints: c.showPoints === undefined ? !!(def && def.showPoints) : flag(c.showPoints),
    timeLimit: int(c.timeLimit, 0, 600, def ? def.timeLimit : 0),
    total: int(c.total, 0, 300, 0)
  };

}


/** compStart's attempt part. */
export function cleanAttempt(raw) {

  if (!raw || typeof raw !== 'object' || typeof raw.token !== 'string' || !raw.token || raw.token.length > 4000) return null;

  const deadline = Number(raw.deadlineMs);

  return {
    token: raw.token,
    id: text(raw.id, 60),
    startedAt: text(raw.startedAt, 40),
    deadlineMs: Number.isFinite(deadline) && deadline > 0 ? deadline : 0,
    resumed: raw.resumed === true
  };

}


const RESULT_STATUSES = ['submitted', 'pending_review', 'graded', 'void', 'in_progress'];

const num = value => (typeof value === 'number' && Number.isFinite(value) ? value : null);

function cleanAnswerValue(value) {
  if (typeof value === 'string') return value.slice(0, LIMITS.long);
  if (Array.isArray(value)) return value.filter(v => typeof v === 'string').map(v => v.slice(0, 200)).slice(0, 20);
  return null;
}

/** Result (§5.1), whatever the server decided to include right now. */
export function sanitizeResult(raw) {

  if (!raw || typeof raw !== 'object') return null;

  const result = {
    status: RESULT_STATUSES.includes(raw.status) ? raw.status : 'submitted',
    submittedAt: text(raw.submittedAt, 40)
  };

  for (const key of ['score', 'maxScore', 'correctCount', 'gradableCount', 'pending', 'pointsAwarded']) {
    if (num(raw[key]) !== null) result[key] = raw[key];
  }

  for (const key of ['resultsAt', 'answersAt']) {
    if (cleanStamp(raw[key])) result[key] = cleanStamp(raw[key]);
  }

  // §19.2 a guest's attempt / §19.3 a participant outside the age range: no points
  if (raw.guest === true) result.guest = true;
  if (raw.noPoints === true) result.noPoints = true;

  if (Array.isArray(raw.review)) {
    result.review = raw.review.slice(0, 300).map(item => {
      if (!item || typeof item !== 'object') return null;
      const type = QUESTION_TYPES.includes(item.type) ? item.type : '';
      const body = text(item.text, 2000);
      if (!type || !body) return null;
      return {
        id: cleanId(item.id),
        type,
        text: body,
        media: cleanImage(item.media),
        choices: (Array.isArray(item.choices) ? item.choices : [])
          .map(c => (c && typeof c === 'object' ? { id: cleanId(c.id), text: text(c.text, 200) } : null))
          .filter(c => c && c.id && c.text).slice(0, 8),
        answer: cleanAnswerValue(item.answer),
        correct: cleanAnswerValue(item.correct),
        ok: item.ok === true ? true : item.ok === false ? false : null,
        pts: num(item.pts),
        explanation: text(item.explanation, 1000),
        explanationMedia: cleanImage(item.explanationMedia)
      };
    }).filter(Boolean);
  }

  return result;

}


/* =========================================================
   PHASE (by Cairo wall time; the server re-checks everything)
========================================================= */

/**
 * 'withdrawn' | 'scheduled' | 'open' | 'closed' | 'results'
 * (closedAt / finalizedAt are not public: a start answered `closed` is
 * shown as closed whatever the dates say.)
 */
export function compPhase(def, nowStamp) {

  if (!def || def.withdrawn) return 'withdrawn';
  if (def.startAt && nowStamp < def.startAt) return 'scheduled';
  if (def.endAt && nowStamp > def.endAt) {
    return def.resultShow !== 'none' && (!def.resultsAt || nowStamp >= def.resultsAt) ? 'results' : 'closed';
  }
  return 'open';

}


/* =========================================================
   PARTICIPANT FORM (open mode, §3.3) AND CODE (registered, §7)
========================================================= */

export function visibleFields(def, { guest = false } = {}) {
  return def && (def.participation === 'open' || (guest && def.allowGuests)) ? (def.fields || []).filter(f => f.mode !== 'hidden') : [];
}

/** Egyptian mobile (01xxxxxxxxx, +20 / 0020 prefixes) or an international +number. */
export function normalizePhone(value) {
  const digits = normalizeDigits(value).replace(/[\s\-().]/g, '');
  if (/^(?:\+20|0020|20)?0?1[0125]\d{8}$/.test(digits)) return `0${digits.replace(/^(?:\+20|0020|20)?0?/, '')}`;
  if (/^\+\d{8,15}$/.test(digits)) return digits;
  return '';
}

/**
 * values: { key: string } as typed → { ok, errors: { key: message }, clean: { key: value } }
 * (only the visible fields; empty optional fields are left out)
 */
export function validateFields(fields, values = {}) {

  const errors = {};
  const clean = {};

  for (const field of fields) {
    const raw = typeof values[field.key] === 'string' ? values[field.key].trim() : '';
    if (!raw) {
      if (field.mode === 'required') errors[field.key] = field.type === 'select' ? `اختار ${field.label}` : `اكتب ${field.label}`;
      continue;
    }
    if (field.type === 'phone') {
      const phone = normalizePhone(raw);
      if (!phone) errors[field.key] = 'اكتب رقم موبايل صحيح (١١ رقم، زي 01012345678)';
      else clean[field.key] = phone;
    }
    else if (field.type === 'number') {
      const n = Number(normalizeDigits(raw));
      if (!/^\d{1,3}$/.test(normalizeDigits(raw)) || n < 1 || n > 120) errors[field.key] = `اكتب ${field.label} بالأرقام`;
      else clean[field.key] = String(n);
    }
    else if (field.type === 'select') {
      if (!field.options.includes(raw)) errors[field.key] = `اختار ${field.label} من القايمة`;
      else clean[field.key] = raw;
    }
    else if (field.key === 'name' && raw.replace(/\s+/g, '').length < 2) {
      errors[field.key] = 'اكتب اسمك كامل';
    }
    else {
      clean[field.key] = raw.replace(/\s+/g, ' ').slice(0, field.key === 'name' ? 60 : LIMITS.field);
    }
  }

  return { ok: Object.keys(errors).length === 0, errors, clean };

}

/** ATH-XXXX-XXXX as typed → the 8 symbols ('' when it can't be a code). */
export function normalizeCode(value) {
  const s = normalizeDigits(value).toUpperCase().replace(/[\s\-_]/g, '').replace(/^ATH/, '');
  return /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/.test(s) ? s : '';
}

export const formatCode = code => (code.length === 8 ? `ATH-${code.slice(0, 4)}-${code.slice(4)}` : code);


/* =========================================================
   ANSWERS (§5.2)
========================================================= */

export function isAnswered(question, value) {

  switch (question.type) {
    case 'single':
    case 'truefalse':
      return typeof value === 'string' && value !== '';
    case 'multi':
      return Array.isArray(value) && value.length > 0;
    case 'short':
    case 'long':
    case 'number':
      return typeof value === 'string' && value.trim() !== '';
    default:
      return false;
  }

}

/** "١٢٫٥" → "12.5"; '' when it isn't a plain number. */
export function normalizeNumber(value) {
  const s = normalizeDigits(value).trim().replace(/[٫,]/g, '.').replace(/^[−–]/, '-');
  return /^-?\d{1,15}(\.\d{1,6})?$/.test(s) ? s : '';
}

/** '' when fine (or empty), else the Arabic message to show under the question. */
export function answerError(question, value) {

  if (!isAnswered(question, value)) return '';

  switch (question.type) {
    case 'single':
      return question.choices.some(c => c.id === value) ? '' : 'اختار إجابة من الاختيارات';
    case 'multi':
      return new Set(value).size === value.length && value.every(v => question.choices.some(c => c.id === v)) ? '' : 'اختار من الاختيارات بس';
    case 'truefalse':
      return value === 't' || value === 'f' ? '' : 'اختار صح أو غلط';
    case 'short':
      return value.length <= LIMITS.short ? '' : `الإجابة أطول من ${arabicDigits(LIMITS.short)} حرف`;
    case 'long':
      return value.length <= LIMITS.long ? '' : `الإجابة أطول من ${arabicDigits(LIMITS.long)} حرف`;
    case 'number':
      return normalizeNumber(value) ? '' : 'اكتب رقم بس (من غير حروف)';
    default:
      return '';
  }

}

/** Only answered, valid values, in the contract's shapes (info never). */
export function answersPayload(questions, answers = {}) {

  const out = {};

  for (const q of questions) {
    const value = answers[q.id];
    if (q.type === 'info' || !isAnswered(q, value) || answerError(q, value)) continue;
    if (q.type === 'multi') out[q.id] = q.choices.map(c => c.id).filter(id => value.includes(id));
    else if (q.type === 'short' || q.type === 'long' || q.type === 'number') out[q.id] = value.trim();
    else out[q.id] = value;
  }

  return out;

}

/** Restored answers: only known questions and well-shaped values survive. */
export function cleanSavedAnswers(questions, answers) {

  const out = {};

  if (!answers || typeof answers !== 'object') return out;

  for (const q of questions) {
    const value = answers[q.id];
    if (q.type === 'multi' && Array.isArray(value)) out[q.id] = value.filter(v => q.choices.some(c => c.id === v));
    else if ((q.type === 'single' || q.type === 'truefalse') && typeof value === 'string') out[q.id] = value;
    else if ((q.type === 'short' || q.type === 'long' || q.type === 'number') && typeof value === 'string') out[q.id] = value.slice(0, LIMITS[q.type] + 50);
  }

  return out;

}

export const gradable = questions => questions.filter(q => q.type !== 'info');

export function progress(questions, answers = {}) {
  const list = gradable(questions);
  return { answered: list.filter(q => isAnswered(q, answers[q.id])).length, total: list.length };
}

/** What the review screen lists: unanswered questions, required ones flagged. */
export function unanswered(questions, answers = {}) {
  return questions
    .map((q, index) => ({ q, index }))
    .filter(({ q }) => q.type !== 'info' && !isAnswered(q, answers[q.id]))
    .map(({ q, index }) => ({ id: q.id, index, required: q.required }));
}

export const missingRequired = (questions, answers) => unanswered(questions, answers).filter(u => u.required);

export const invalidAnswers = (questions, answers = {}) => questions
  .map((q, index) => ({ id: q.id, index, error: answerError(q, answers[q.id]) }))
  .filter(x => x.error);


/* =========================================================
   STEP MACHINE
   state = { name, index?, error?, field?, participant?, from? }
   names: loading | unavailable | scheduled | closed | intro | identity |
          code | confirm | starting | question | single | review |
          submitting | queued | result | error
========================================================= */

export function firstStep(def, phase) {
  if (phase === 'withdrawn') return { name: 'unavailable' };
  if (phase === 'scheduled') return { name: 'scheduled' };
  if (phase === 'closed' || phase === 'results') return { name: 'closed' };
  return { name: 'intro' };
}

/** Where «ابدأ» leads. */
export function beginStep(def) {
  if (def.participation === 'registered') return { name: 'code' };
  return visibleFields(def).length ? { name: 'identity' } : { name: 'starting' };
}

/** The first answering step once questions are there (or a restored one). */
export function answeringStep(layout, questions, saved = '') {

  const match = /^q:(\d{1,3})$/.exec(saved || '');

  if (saved === 'review') return { name: 'review' };
  if (layout === 'single') return { name: 'single' };
  if (match && Number(match[1]) < questions.length) return { name: 'question', index: Number(match[1]) };

  return { name: 'question', index: 0 };

}

/** The step as one short string for the autosave (§13 `step`). */
export function stepKey(state) {
  if (state.name === 'question') return `q:${state.index}`;
  if (state.name === 'single' || state.name === 'review') return state.name;
  return '';
}

/**
 * The machine. ctx = { def, layout, count } (count = questions on screen).
 * Unknown events leave the state unchanged.
 */
export function transition(state, event, ctx = {}) {

  const count = ctx.count || 0;
  const layout = ctx.layout || (ctx.def && ctx.def.layout) || 'paged';

  switch (event.type) {

    case 'phase':
      return firstStep(ctx.def, event.phase);

    case 'begin':
      return state.name === 'intro' ? beginStep(ctx.def) : state;

    case 'back':
      // a guest's form goes back to the code screen it came from
      if (state.name === 'identity' && state.guest) return { name: 'code' };
      if (state.name === 'identity' || state.name === 'code') return { name: 'intro' };
      if (state.name === 'confirm') return { name: 'code' };
      return state;

    case 'guest':
      return state.name === 'code' && ctx.def && ctx.def.allowGuests ? { name: 'identity', guest: true } : state;

    case 'fields-ok':
      return state.name === 'identity' ? { name: 'starting', from: 'identity', ...(state.guest && { guest: true }) } : state;

    case 'code-ok':
      return state.name === 'code' ? { name: 'confirm', participant: event.participant } : state;

    case 'confirm':
      return state.name === 'confirm' ? { name: 'starting', from: 'confirm', participant: state.participant } : state;

    case 'started':
      return answeringStep(layout, { length: count }, event.step);

    case 'start-failed': {
      const code = event.code;
      if (code === 'closed') return { name: 'closed', error: event.message };
      if (code === 'not_open') return { name: 'scheduled', error: event.message };
      if (code === 'session') return { name: 'code', error: event.message };
      if (code === 'not_found' || code === 'disabled') return { name: 'unavailable', error: event.message };
      const guest = state.guest ? { guest: true } : {};
      if (code === 'invalid' && state.from === 'identity') return { name: 'identity', error: event.message, field: event.field, ...guest };
      const back = state.from === 'identity' ? 'identity' : state.from === 'confirm' ? 'code' : 'intro';
      return { name: back, error: event.message, ...(back === 'identity' ? guest : {}) };
    }

    case 'next':
      if (state.name !== 'question') return state;
      return state.index + 1 < count ? { name: 'question', index: state.index + 1 } : { name: 'review' };

    case 'prev':
      if (state.name === 'question') return state.index > 0 ? { name: 'question', index: state.index - 1 } : state;
      if (state.name === 'review') return layout === 'single' ? { name: 'single' } : { name: 'question', index: Math.max(0, count - 1) };
      return state;

    case 'jump':
      if (!['question', 'single', 'review'].includes(state.name)) return state;
      if (layout === 'single') return { name: 'single', focus: event.index };
      return Number.isInteger(event.index) && event.index >= 0 && event.index < count ? { name: 'question', index: event.index } : state;

    case 'review':
      return ['question', 'single'].includes(state.name) ? { name: 'review' } : state;

    case 'submit':
      return state.name === 'review' || state.name === 'queued' ? { name: 'submitting' } : state;

    case 'time-up':
      return ['question', 'single', 'review', 'queued'].includes(state.name) ? { name: 'submitting', timeUp: true } : state;

    case 'offline':
      return state.name === 'submitting' ? { name: 'queued', timeUp: state.timeUp } : state;

    case 'online':
      return state.name === 'queued' ? { name: 'submitting', timeUp: state.timeUp } : state;

    case 'submitted':
      return { name: 'result' };

    case 'submit-failed': {
      const code = event.code;
      if (code === 'closed') return { name: 'closed', error: event.message };
      if (code === 'expired') return { name: 'error', error: event.message || 'الوقت خلص قبل ما الإجابات توصل.', fatal: true };
      if (code === 'invalid' && Number.isInteger(event.index)) {
        return layout === 'single' ? { name: 'single', focus: event.index, error: event.message } : { name: 'question', index: event.index, error: event.message };
      }
      return { name: 'review', error: event.message };
    }

    case 'again':
      return state.name === 'result' ? { name: 'intro' } : state;

    default:
      return state;

  }

}


/* =========================================================
   WORDING
========================================================= */

export const ar = n => arabicDigits(n);

/* ١ سؤال واحد، ٢ سؤالين، ٣–١٠ أسئلة، ١١+ سؤال */
export function countQuestions(n) {
  if (n === 1) return 'سؤال واحد';
  if (n === 2) return 'سؤالين';
  return `${ar(n)} ${n >= 3 && n <= 10 ? 'أسئلة' : 'سؤال'}`;
}

/* ١ نقطة، ٢ نقطتين، ٣–١٠ نقط، ١١+ نقطة */
export function countPoints(n) {
  if (n === 1) return 'نقطة واحدة';
  if (n === 2) return 'نقطتين';
  return `${ar(n)} ${n >= 3 && n <= 10 ? 'نقط' : 'نقطة'}`;
}

export function countMinutesShort(n) {
  if (n === 1) return 'دقيقة';
  if (n === 2) return 'دقيقتين';
  return `${ar(n)} ${n >= 3 && n <= 10 ? 'دقايق' : 'دقيقة'}`;
}

/** mm:ss (or h:mm:ss) in Arabic digits, for the time-limit clock. */
export function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = x => String(x).padStart(2, '0');
  return ar(h ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`);
}

/** "تبدأ بعد ساعتين" for a scheduled competition (realMinutes from schedule.js). */
export function startsInText(realMinutes) {
  return `تبدأ ${untilText(Math.max(0, realMinutes ?? 0))}`;
}

export const stampText = value => (value ? formatStamp(value) : '');

/** «إجابتك» / «الإجابة الصح» of a review row, as words. */
export function answerText(item, value) {

  if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) return '';

  const choice = id => (item.choices.find(c => c.id === id) || {}).text || '';

  switch (item.type) {
    case 'single': return choice(value);
    case 'multi': return (Array.isArray(value) ? value : [value]).map(choice).filter(Boolean).join('، ');
    case 'truefalse': return value === 't' ? 'صح' : value === 'f' ? 'غلط' : '';
    default: return Array.isArray(value) ? value.join(' / ') : String(value);
  }

}

/** §19.3 compCode / portalMe: { eligible, notice } — eligible unless the server says false */
export const AGE_NOTICE = 'نأسف، سنك حاليًا خارج الفئة العمرية المخصصة لنظام نقاط الاجتماع. تقدر تشارك في المسابقة بدون نقاط.';

export function eligibility(reply) {
  if (!reply || reply.eligible !== false) return { eligible: true, notice: '' };
  return { eligible: false, notice: text(reply.notice, 300) || AGE_NOTICE };
}

/** «جبت ٨ من ١٠» — the final score, nothing per question */
export const scoreText = (score, maxScore) => `جبت ${ar(score)} من ${ar(maxScore)}`;

/** «جمعت ٧٠٠ نقطة» */
export const pointsText = n => `جمعت ${countPoints(n)}`;

export const GUEST_RESULT = 'دي نتيجتك — المشاركة بدون كود مفيهاش نقاط';

/**
 * What the result screen says, decided from what the server returned
 * (never more): { headline, lines: [{ kind, text }], review: [] | null }.
 * Only the simple final result: «مبروك!» + «جبت ٨ من ١٠» and / or
 * «جمعت ٧٠٠ نقطة» (whatever the server's resultShow sent), or «فيه إجابات
 * بتتراجع». Answers, marks and explanations only inside result.review
 * (the server sends it only when the admin opened the answers).
 * opts.noPoints: this attempt earns no points (a participant outside the age range).
 */
export function resultSummary(result, def = {}, { noPoints = false } = {}) {

  const r = result || { status: 'submitted' };
  const lines = [];

  if (r.status === 'void') {
    return { headline: 'المشاركة دي اتلغت', lines: [{ kind: 'hint', text: 'لو عندك سؤال كلّم الخدام.' }], review: null };
  }

  const scored = num(r.score) !== null && num(r.maxScore) !== null;
  const points = !r.guest && !r.noPoints && !noPoints && num(r.pointsAwarded) !== null && r.pointsAwarded > 0;
  const headline = def.successText || (scored || points ? 'مبروك!' : 'إجاباتك وصلت ✓ شكرًا لمشاركتك');

  if (r.guest) lines.push({ kind: 'guest', text: GUEST_RESULT });

  if (scored) lines.push({ kind: 'score', text: scoreText(r.score, r.maxScore) });

  if (points) lines.push({ kind: 'points', text: pointsText(r.pointsAwarded) });

  if ((num(r.pending) || 0) > 0 || r.status === 'pending_review') {
    lines.push({ kind: 'pending', text: 'فيه إجابات بتتراجع، والنتيجة النهائية هتظهر بعد المراجعة.' });
  }

  if (!r.guest && (r.noPoints || noPoints)) lines.push({ kind: 'hint', text: 'المشاركة دي متسجلة بالكود بتاعك من غير نقاط.' });

  if (r.resultsAt && num(r.score) === null && num(r.pointsAwarded) === null) {
    lines.push({ kind: 'hint', text: `النتيجة هتظهر ${formatStamp(r.resultsAt)}` });
  }

  if (r.answersAt && !Array.isArray(r.review)) {
    lines.push({ kind: 'hint', text: `الإجابات الصحيحة هتظهر ${formatStamp(r.answersAt)}` });
  }

  return { headline, lines, review: Array.isArray(r.review) && r.review.length ? r.review : null };

}


/* =========================================================
   TIMING
========================================================= */

/** Jittered exponential backoff: ~0.8 s, 1.6 s, 3.2 s … capped at 15 s, ×(0.5…1.5). */
export function retryDelay(attempt, random = Math.random) {
  const base = Math.min(15000, 800 * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.5 + random()));
}

/** Codes worth retrying (with the same idempotency key). */
export const RETRYABLE = new Set(['busy', 'network']);

export function remainingMs(deadlineMs, nowMs) {
  return deadlineMs > 0 ? deadlineMs - nowMs : Infinity;
}
