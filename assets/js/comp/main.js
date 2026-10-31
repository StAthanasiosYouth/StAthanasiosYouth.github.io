/**
 * COMPETITION ENGINE — boot (competition/index.html and its generated stubs)
 *
 * One page for every competition. The slug comes from <html data-slug>
 * (stubs at competition/<slug>/) or ?s=<slug> (the shell). URLs are built
 * from this module's own address (import.meta.url), never from the page's,
 * so the same code works at /competition/ and /competition/<slug>/.
 *
 *  live      comp.json (static, same origin) → intro by Cairo time → the
 *            public API (api.js) for start / submit / result / code
 *  ?preview  the admin's preview frame: the draft arrives by postMessage
 *            from the same-origin parent; no network, no storage
 *            (protocol: docs/COMPETITIONS.md §13)
 */

import { COMP_CONFIG } from './config.js';
import { createApi } from './api.js';
import { accountsOn, createWorkerApi, accountSummary, goSignIn, accountSession } from './accounts.js';
import { createSave, memoryStorage, browserStorage } from './save.js';
import * as F from './flow.js';
import { createView } from './view.js';
import { zonedNow, stamp, setServerTime, setClockOffset, clockOffset, cairoInstant, realMinutesBetween } from '../schedule.js';
import { soundToggle, uiSounds, cue } from '../ui-sound.js';
import { accountBadge } from '../account/link.js';
import { fetchPublished } from '../content-source.js';

/* the mount points (a stub made from an older shell may only have its own <main>) */
function mount(id, make) {
  let el = document.getElementById(id);
  if (!el) {
    el = make();
    el.id = id;
    document.body.appendChild(el);
  }
  return el;
}

(function ensureMounts() {
  const legacy = document.getElementById('comp-app');
  if (legacy && !document.getElementById('comp-main')) {
    legacy.id = 'comp-main';
    legacy.className = 'comp';
    legacy.removeAttribute('aria-live');
    legacy.tabIndex = -1;
  }
  mount('comp-main', () => Object.assign(document.createElement('main'), { className: 'comp', tabIndex: -1 }));
  mount('comp-live', () => Object.assign(document.createElement('p'), { className: 'visually-hidden' })).setAttribute('aria-live', 'polite');
})();

const ROOT = new URL('../../../', import.meta.url);
const html = document.documentElement;
const PREVIEW = new URLSearchParams(location.search).has('preview');
const FRAMED = window.parent !== window;

/* the admin preview's not-yet-published pictures (blob: URLs of this origin only) */
let previewImages = {};

function mediaUrl(src) {
  const swapped = previewImages[src];
  if (typeof swapped === 'string' && swapped.startsWith(`blob:${location.origin}/`)) return swapped;
  return new URL(src, ROOT).href;
}

const view = createView({
  main: document.getElementById('comp-main'),
  live: document.getElementById('comp-live'),
  timer: document.getElementById('comp-timer'),
  net: document.getElementById('comp-net'),
  rootUrl: ROOT,
  mediaUrl
});

const nowStamp = () => stamp(zonedNow('Africa/Cairo'));
const nowMs = () => Date.now() + clockOffset();

function uuid() {
  if (globalThis.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('').replace(/^(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-');
}

const MESSAGES = {
  network: 'النت فاصل أو ضعيف. اتأكد إنك متصل وجرّب تاني.',
  busy: 'فيه ضغط كبير دلوقتي، جرّب كمان شوية.',
  closed: 'المسابقة خلصت.',
  not_open: 'المسابقة لسه مبدأتش.',
  limit: 'إنت شاركت في المسابقة دي قبل كده.',
  invalid: 'راجع البيانات وجرّب تاني.',
  session: 'سجّل دخولك تاني.',
  disabled: 'المسابقة دي مش متاحة دلوقتي.',
  not_found: 'المسابقة دي مش متاحة دلوقتي.',
  code: 'الكود ده مش صح، راجع الحروف والأرقام.',
  expired: 'الوقت خلص قبل ما الإجابات توصل.',
  bad: 'حصلت مشكلة، جرّب تاني.'
};

const message = reply => (reply && typeof reply.message === 'string' && reply.message.trim() && reply.code !== 'network' ? reply.message.trim() : MESSAGES[reply && reply.code] || MESSAGES.bad);


/* =========================================================
   STATE
========================================================= */

const S = {
  slug: '',
  def: null,
  defRaw: null,
  forcePhase: '',
  state: { name: 'loading' },
  questions: [],
  answers: {},
  comp: null,
  attempt: null,
  token: '',
  clientKey: '',
  ptoken: '',
  fields: {},
  fieldValues: {},
  fieldErrors: {},
  codeValue: '',
  hp: '',
  result: null,
  receipt: '',
  resultLoading: false,
  resultNote: '',
  confirming: false,
  busy: false,
  noPoints: false,      // §19.3: a code outside the age range (the attempt counts, no points)
  queueReason: '',
  online: navigator.onLine !== false,
  warnedMinute: false, timeUpSent: false
};

let api = null;
let save = createSave('', null);
let retryTimer = 0;

function phaseNow() {
  if (S.forcePhase && S.forcePhase !== 'auto') return S.forcePhase;
  return F.compPhase(S.def, nowStamp());
}

function ctx() {
  return { def: S.def, layout: (S.comp && S.comp.layout) || (S.def && S.def.layout) || 'paged', count: S.questions.length };
}

function remaining() {
  return S.attempt && S.attempt.deadlineMs ? F.remainingMs(S.attempt.deadlineMs, nowMs()) : Infinity;
}

function model() {
  const left = remaining();
  const def = S.def || { title: '' };
  return {
    def,
    state: S.state,
    questions: S.questions,
    answers: S.answers,
    comp: S.comp,
    fieldValues: S.fieldValues,
    fieldErrors: S.fieldErrors,
    codeValue: S.codeValue,
    busy: S.busy,
    confirming: S.confirming,
    result: S.result,
    resultLoading: S.resultLoading,
    resultNote: S.resultNote,
    receipt: S.receipt,
    noPoints: S.noPoints,
    canRetry: !PREVIEW ? !!(S.def && S.def.attempts > 1 && phaseNow() === 'open' && S.result && S.result.status !== 'void') : !!(S.def && S.def.attempts > 1),
    nowStamp: nowStamp(),
    startsIn: S.def && S.def.startAt ? realMinutesBetween(nowStamp(), S.def.startAt) : undefined,
    clock: Number.isFinite(left) ? F.formatClock(left) : null,
    clockLow: left < 60000,
    online: S.online,
    queueReason: S.queueReason,
    retryLoad: S.state.name === 'error' && !S.def,
    actions
  };
}

function render(options = {}) {
  // accounts on: there is no code screen: the signed-in account goes straight on (§18)
  if (accountsMode && S.state.name === 'code') {
    enterWithAccount();
    return;
  }
  view.render({ ...model(), ...options });
}

let accountsMode = false;
let entering = false;

async function enterWithAccount() {
  if (entering) return;
  entering = true;
  const account = accountSession() ? await accountSummary() : null;
  entering = false;
  if (!account) {
    goSignIn(new URL('../../../', import.meta.url));
    return;
  }
  const eligible = account.eligible !== false;
  S.ptoken = '';
  S.noPoints = !eligible;
  go({ type: 'code-ok', participant: { name: String(account.firstName || '').slice(0, 80), group: '', eligible, noPoints: !eligible } });
  go({ type: 'confirm' });
}

/** a step change through the machine (+ its side effects) */
function go(event) {
  const before = S.state;
  S.state = F.transition(S.state, event, ctx());
  if (S.state === before) return;
  S.confirming = false;
  const step = F.stepKey(S.state);
  if (step && S.token) save.write({ step });
  render();
  if (S.state.name === 'starting') start();
  if (S.state.name === 'submitting') submit();
}


/* =========================================================
   ACTIONS (from the view)
========================================================= */

const actions = {

  begin: () => go({ type: 'begin' }),

  back: () => {
    S.fieldErrors = {};
    go({ type: 'back' });
  },

  fieldsSubmit(values, hp) {
    const guest = !!S.state.guest;
    const fields = F.visibleFields(S.def, { guest });
    const check = F.validateFields(fields, values);
    S.fieldValues = values;
    S.hp = typeof hp === 'string' ? hp : '';
    if (!check.ok) {
      S.fieldErrors = check.errors;
      S.state = { name: 'identity', error: 'راجع الخانات اللي عليها علامة.', ...(guest && { guest: true }) };
      render();
      const first = document.querySelector('[aria-invalid="true"]');
      if (first) first.focus();
      return;
    }
    S.fieldErrors = {};
    S.fields = check.clean;
    save.write({ fields: check.clean, clientKey: ensureClientKey() });
    go({ type: 'fields-ok' });
  },

  async codeSubmit(raw) {
    S.codeValue = String(raw || '').slice(0, 20);
    const code = F.normalizeCode(raw);
    if (!code) {
      S.state = { name: 'code', error: 'الكود ٨ حروف وأرقام، زي ATH-K7P2-9QXM.' };
      render();
      return;
    }
    S.busy = true;
    S.state = { name: 'code' };
    render();
    const reply = await api.call('compCode', { code: F.formatCode(code) });
    S.busy = false;
    if (reply.ok && reply.participant && typeof reply.ptoken === 'string') {
      S.ptoken = reply.ptoken;
      S.codeValue = '';
      const participant = { name: String(reply.participant.name || '').slice(0, 80), group: String(reply.participant.group || '').slice(0, 60), ...F.eligibility(reply) };
      S.noPoints = participant.eligible === false;
      go({ type: 'code-ok', participant });
      return;
    }
    if (reply.code === 'disabled' || reply.code === 'not_found') {
      S.state = { name: 'unavailable', error: message(reply) };
      render();
      return;
    }
    S.state = { name: 'code', error: reply.code === 'busy' ? 'محاولات كتير، استنى شوية وجرّب تاني.' : message(reply) };
    render();
  },

  confirm: () => go({ type: 'confirm' }),

  // §19.2: «شارك من غير كود» (only when the competition allows guests)
  guest: () => {
    S.ptoken = '';
    S.noPoints = false;
    S.fieldErrors = {};
    go({ type: 'guest' });
  },

  answer(qid, value) {
    S.answers = { ...S.answers, [qid]: value };
    save.write({ answers: S.answers });
    view.update(model());
  },

  next() {
    if (S.state.name !== 'question') return;
    const q = S.questions[S.state.index];
    const error = F.answerError(q, S.answers[q.id]);
    if (error) {
      S.state = { name: 'question', index: S.state.index, error };
      render();
      return;
    }
    go({ type: 'next' });
  },

  prev: () => go({ type: 'prev' }),

  jump: index => go({ type: 'jump', index }),

  review() {
    const invalid = F.invalidAnswers(S.questions, S.answers)[0];
    if (invalid && S.state.name === 'single') {
      S.state = { name: 'single', focus: invalid.index, error: invalid.error };
      render();
      return;
    }
    go({ type: 'review' });
  },

  submit() {
    const invalid = F.invalidAnswers(S.questions, S.answers)[0];
    if (invalid) {
      go({ type: 'jump', index: invalid.index });
      S.state = { ...S.state, error: invalid.error };
      render();
      return;
    }
    if (F.missingRequired(S.questions, S.answers).length) {
      S.state = { name: 'review', error: 'لسه فيه أسئلة مطلوبة متجاوبتش. دوس على السؤال علشان تجاوبه.' };
      render();
      const first = document.querySelector('.review__item.is-required');
      if (first) first.focus();
      return;
    }
    S.confirming = true;
    render();
    const box = document.getElementById('confirm-t');
    if (box) box.focus();
  },

  cancelSubmit() {
    S.confirming = false;
    render();
    const button = document.querySelector('[data-submit]');
    if (button) button.focus();
  },

  confirmSubmit: () => go({ type: 'submit' }),

  retrySubmit: () => go({ type: 'online' }),

  again() {
    S.clientKey = uuid();
    S.token = '';
    S.attempt = null;
    S.questions = [];
    S.answers = {};
    S.comp = null;
    S.result = null;
    S.warnedMinute = false;
    save.write({ clientKey: S.clientKey, token: '', questions: [], answers: {}, step: '', pending: false, attempt: null, def: null });
    go({ type: 'again' });
  },

  retryLoad: () => boot()

};

function ensureClientKey() {
  if (!S.clientKey) S.clientKey = uuid();
  return S.clientKey;
}


/* =========================================================
   START / SUBMIT / RESULT
========================================================= */

async function start() {

  const arg = { slug: S.def.slug || S.slug, clientKey: ensureClientKey() };

  if (S.def.participation === 'registered' && !S.state.guest) arg.ptoken = S.ptoken;
  else {
    arg.fields = S.fields;
    arg.hp = S.hp || '';
  }

  save.write({ clientKey: S.clientKey });

  const reply = await api.call('compStart', arg);

  if (S.state.name !== 'starting') return;

  const attempt = reply.ok ? F.cleanAttempt(reply.attempt) : null;

  // the server's own clock (ms): finer than the Date header for the time limit
  if (reply.ok && reply.attempt && Number.isFinite(reply.attempt.serverNow) && reply.attempt.serverNow > 0) {
    setClockOffset(reply.attempt.serverNow - Date.now());
  }

  // this attempt was already sent (e.g. the reply was lost): show its result
  if (reply.ok && typeof reply.receipt === 'string' && reply.receipt && reply.result) {
    S.receipt = reply.receipt;
    S.result = F.sanitizeResult(reply.result) || { status: 'submitted' };
    S.token = '';
    S.attempt = null;
    save.afterSubmit(S.receipt, S.result.submittedAt);
    S.state = { name: 'result' };
    render();
    return;
  }
  const questions = reply.ok ? F.cleanQuestions(reply.questions) : [];

  if (!reply.ok || !attempt || !questions.length) {
    const code = reply.ok ? 'bad' : reply.code;
    if (code === 'not_open' && reply.startAt) S.def = { ...S.def, startAt: F.cleanStamp(reply.startAt) || S.def.startAt };
    go({ type: 'start-failed', code, message: message(reply.ok ? { code: 'bad' } : reply), field: reply.field });
    return;
  }

  // another device started this attempt (same participant): continue it with its key
  if (typeof reply.attempt.clientKey === 'string' && /^[\w-]{8,64}$/.test(reply.attempt.clientKey)) S.clientKey = reply.attempt.clientKey;

  S.attempt = attempt;
  S.token = attempt.token;
  S.questions = questions;
  S.comp = F.cleanStartComp(reply.comp, S.def);
  // a resumed attempt (same clientKey) keeps what was typed so far
  S.answers = attempt.resumed ? F.cleanSavedAnswers(questions, S.answers) : {};
  S.warnedMinute = false;
  S.timeUpSent = false;

  save.write({
    clientKey: S.clientKey, token: S.token, receipt: '', answers: S.answers, step: '',
    v: S.def.v, fields: S.fields, ptoken: S.ptoken, participant: S.state.participant ? { ...S.state.participant, noPoints: S.noPoints } : null,
    attempt: { id: attempt.id, startedAt: attempt.startedAt, deadlineMs: attempt.deadlineMs },
    comp: S.comp, questions, pending: false, def: S.defRaw
  });

  go({ type: 'started' });

}


async function submit() {

  clearTimeout(retryTimer);

  const answers = F.answersPayload(S.questions, S.answers);

  save.write({ pending: true, answers: S.answers });

  if (!PREVIEW && navigator.onLine === false) {
    S.queueReason = 'offline';
    go({ type: 'offline' });
    return;
  }

  const reply = await api.call('compSubmit', { token: S.token, clientKey: S.clientKey, answers }, { shouldStop: () => navigator.onLine === false });

  if (S.state.name !== 'submitting') return;

  if (reply.ok) {
    S.receipt = typeof reply.receipt === 'string' ? reply.receipt : '';
    S.result = F.sanitizeResult(reply.result) || { status: 'submitted' };
    S.resultNote = '';
    save.afterSubmit(S.receipt, S.result.submittedAt);
    S.token = '';
    S.attempt = null;
    go({ type: 'submitted' });
    view.announce('إجاباتك وصلت');
    cue('success');
    return;
  }

  if (reply.code === 'network' || reply.code === 'busy') {
    S.queueReason = reply.code === 'busy' ? 'busy' : 'offline';
    go({ type: 'offline' });
    retryTimer = setTimeout(() => { if (S.state.name === 'queued') go({ type: 'online' }); }, 20000);
    return;
  }

  save.write({ pending: false });

  if (reply.code === 'expired' || reply.code === 'closed') {
    save.clear();
    S.token = '';
    S.attempt = null;
  }

  const index = reply.qid ? S.questions.findIndex(q => q.id === reply.qid) : -1;

  go({ type: 'submit-failed', code: reply.code, message: message(reply), index: index >= 0 ? index : undefined });

}


async function loadResult() {

  S.resultLoading = true;
  S.state = { name: 'result' };
  render();

  const reply = await api.call('compResult', { receipt: S.receipt }, { retries: 2 });

  S.resultLoading = false;

  if (reply.ok) {
    S.result = F.sanitizeResult(reply.result) || { status: 'submitted' };
    S.resultNote = '';
  }
  else {
    S.result = S.result || { status: 'submitted' };
    S.resultNote = reply.code === 'network' ? 'مش قادرين نجيب النتيجة دلوقتي (النت). افتح الصفحة تاني بعدين.' : '';
  }

  render({ focus: false });

}


/* =========================================================
   CLOCK (1 s): the time limit, the scheduled countdown, open → closed
========================================================= */

function tick() {

  if (!S.def) return;

  const name = S.state.name;
  const left = remaining();

  if (Number.isFinite(left) && ['question', 'single', 'review'].includes(name)) {
    // once per attempt: if that automatic send is refused, the person can still send by hand
    if (left <= 0 && !S.timeUpSent) {
      S.timeUpSent = true;
      go({ type: 'time-up' });
      return;
    }
    if (left <= 60000 && !S.warnedMinute) {
      S.warnedMinute = true;
      view.announce('باقي أقل من دقيقة');
      cue('important', { passive: true });
    }
  }

  if (name === 'scheduled' || name === 'intro' || name === 'closed') {
    const phase = phaseNow();
    const want = F.firstStep(S.def, phase).name;
    if (want !== name && !S.state.error) {
      go({ type: 'phase', phase });
      return;
    }
  }

  view.update(model());

}


/* =========================================================
   CONNECTION
========================================================= */

addEventListener('online', () => {
  S.online = true;
  view.update(model());
  if (S.state.name === 'queued') go({ type: 'online' });
});

addEventListener('offline', () => {
  S.online = false;
  view.update(model());
});


/* =========================================================
   BOOT (live)
========================================================= */

async function fetchDefinition(slug) {

  const url = new URL(F.compJsonPath(slug, html.dataset.v || ''), ROOT);

  for (const cache of ['no-cache', 'force-cache']) {
    try {
      // no onNewer: a competition is never swapped under the player (a later edit shows on the next load)
      const response = await fetchPublished(url, { cache, credentials: 'same-origin' }, { kind: 'comp', slug });
      if (response.status === 404) return { missing: true };
      if (!response.ok) continue;
      // GitHub Pages' (or the Worker's) clock corrects a wrong device clock (countdown, windows)
      if (cache === 'no-cache') setServerTime(response.headers.get('Date'));
      const raw = await response.json();
      return { raw };
    }
    catch {
      // offline: try the browser's copy next, then the autosave's
    }
  }

  return { failed: true };

}

function applyDefinition(raw) {
  const def = F.sanitizeDefinition(raw);
  if (!def || (def.slug && def.slug !== S.slug)) return false;
  // §18: with accounts on, every competition needs one: no form, no guests, whatever an older definition says
  S.def = accountsMode ? { ...def, participation: 'registered', allowGuests: false } : def;
  S.defRaw = def.withdrawn ? null : raw;
  if (def.theme) html.dataset.theme = def.theme;
  if (!def.withdrawn) document.title = `${def.title} – مسابقات أسرة البابا أثناسيوس`;
  return true;
}

async function boot() {

  S.slug = F.slugFrom({ dataSlug: html.dataset.slug || '', search: location.search });
  accountsMode = await accountsOn();
  api = accountsMode ? createWorkerApi() : createApi({ url: COMP_CONFIG.apiUrl });
  save = createSave(S.slug, browserStorage);

  if (!S.slug) {
    S.state = { name: 'unavailable' };
    render();
    return;
  }

  S.state = { name: 'loading' };
  render({ focus: false });

  const record = save.read();
  const loaded = await fetchDefinition(S.slug);

  if (loaded.missing || (loaded.raw && !applyDefinition(loaded.raw))) {
    S.def = null;
    S.state = { name: 'unavailable' };
    render({ focus: false });
    return;
  }

  if (loaded.failed) {
    if (!(record && record.def && applyDefinition(record.def))) {
      S.state = { name: 'error', error: 'مش قادرين نحمّل المسابقة. اتأكد من النت وجرّب تاني.' };
      render({ focus: false });
      return;
    }
  }

  if (S.def.withdrawn) {
    S.state = { name: 'unavailable' };
    render({ focus: false });
    return;
  }

  S.clientKey = record && record.clientKey ? record.clientKey : '';
  S.fields = record ? record.fields : {};
  S.fieldValues = { ...S.fields };
  S.ptoken = record ? record.ptoken : '';
  S.noPoints = !!(record && record.participant && record.participant.noPoints);

  // an attempt in progress on this phone: continue where it was left
  if (record && record.token && record.questions.length) {
    S.token = record.token;
    S.attempt = record.attempt || { deadlineMs: 0 };
    S.questions = record.questions;
    S.answers = record.answers;
    S.comp = record.comp || F.cleanStartComp(null, S.def);
    S.defRaw = S.defRaw || record.def;
    if (record.pending) {
      S.state = { name: 'submitting' };
      render({ focus: false });
      submit();
    }
    else {
      S.state = F.answeringStep(S.comp.layout, S.questions, record.step);
      render({ focus: false });
      tick();
    }
    return;
  }

  // already submitted here: the result as the server shows it now
  if (record && record.receipt) {
    S.receipt = record.receipt;
    await loadResult();
    return;
  }

  S.state = F.firstStep(S.def, phaseNow());
  render({ focus: false });

}


/* =========================================================
   PREVIEW (admin): docs/COMPETITIONS.md §13
========================================================= */

function previewApi() {

  const waiting = new Map();

  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.type !== 'athanasios:comp-preview-result' || !waiting.has(data.id)) return;
    const resolve = waiting.get(data.id);
    waiting.delete(data.id);
    resolve(data.result);
  });

  return {
    async call(fn, arg) {
      if (fn === 'compCode') return { ok: true, participant: { name: 'مشارك تجريبي', group: '' }, ptoken: 'preview' };
      if (fn === 'compStart') {
        const questions = S.def.questions || [];
        return {
          ok: true,
          attempt: { token: 'preview', id: 'preview', startedAt: nowStamp(), deadlineMs: S.def.timeLimit ? nowMs() + S.def.timeLimit * 60000 : 0, resumed: false },
          comp: { v: S.def.v, layout: S.def.layout, showPoints: S.def.showPoints, timeLimit: S.def.timeLimit, total: questions.length },
          questions
        };
      }
      if (fn === 'compSubmit') {
        const id = uuid();
        const result = await new Promise(resolve => {
          waiting.set(id, resolve);
          window.parent.postMessage({ type: 'athanasios:comp-preview-submit', answers: arg.answers, id }, location.origin);
          setTimeout(() => { if (waiting.delete(id)) resolve(null); }, 30000);
        });
        return result && typeof result === 'object'
          ? { ok: true, receipt: '', result }
          : { ok: false, code: 'bad', message: 'المعاينة مستلمتش نتيجة من لوحة التحكم.' };
      }
      return { ok: false, code: 'not_found', message: '' };
    }
  };

}

function startPreview() {

  html.dataset.preview = '';
  api = previewApi();
  save = createSave('', memoryStorage());   // no slug key: nothing is ever stored

  const reply = message => window.parent.postMessage(message, location.origin);

  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.type !== 'athanasios:comp-preview') return;

    const def = F.sanitizeDefinition(data.definition, { withQuestions: true });
    if (!def || def.withdrawn) {
      reply({ type: 'athanasios:comp-preview-error', message: 'definition' });
      return;
    }

    previewImages = data.images && typeof data.images === 'object' ? { ...data.images } : {};
    const at = typeof data.at === 'string' ? cairoInstant(F.cleanStamp(data.at)) : null;
    setClockOffset(at === null ? 0 : at - Date.now());

    clearTimeout(retryTimer);
    Object.assign(S, {
      slug: def.slug, def, defRaw: null, forcePhase: ['scheduled', 'open', 'closed'].includes(data.state) ? data.state : 'auto',
      questions: [], answers: {}, comp: null, attempt: null, token: '', clientKey: '', ptoken: '', fields: {}, fieldValues: {}, fieldErrors: {},
      codeValue: '', hp: '', result: null, receipt: '', resultLoading: false, resultNote: '', confirming: false, busy: false, warnedMinute: false, timeUpSent: false
    });
    if (def.theme) html.dataset.theme = def.theme;
    else delete html.dataset.theme;

    S.state = F.firstStep(def, phaseNow());
    render({ focus: false });
    reply({ type: 'athanasios:comp-preview-shown', state: S.state.name });
  });

  S.state = { name: 'loading' };
  render({ focus: false });
  reply({ type: 'athanasios:comp-preview-ready' });

}


/* =========================================================
   START
========================================================= */

let sameOriginParent = false;
try {
  sameOriginParent = FRAMED && window.parent.location.origin === location.origin;
}
catch {
  sameOriginParent = false;
}

if (PREVIEW && sameOriginParent) {
  startPreview();
}
else {
  // a form people type their name into is never shown inside another site (clickjacking)
  if (FRAMED) {
    try {
      window.top.location.replace(location.href);
    }
    catch {
      // sandboxed frame: nothing more we can do
    }
  }
  if (PREVIEW) {
    S.state = { name: 'unavailable', error: 'المعاينة بتشتغل من لوحة التحكم بس.' };
    render({ focus: false });
  }
  else {
    // the site's sound: the same toggle and taps as the home page
    soundToggle(document.querySelector('.cbar'));
    accountBadge(document.querySelector('.cbar'), new URL('../../../', import.meta.url));
    uiSounds();
    boot();
  }
}

setInterval(tick, 1000);

