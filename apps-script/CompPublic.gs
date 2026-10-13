/**
 * COMPETITIONS: THE PUBLIC API (no admin token). docs/COMPETITIONS.md §5.
 *
 * doPost (Api.gs) sends every /^(comp|portal|shop)[A-Z]\w*$/ action here
 * BEFORE the admin token check, like route / pushSubscribe:
 *
 *   compStart  { slug, clientKey, fields?, ptoken?, hp? }
 *   compSubmit { token, clientKey, answers }
 *   compResult { receipt } | { ptoken, submissionId }
 *
 * and, when their modules are installed and switched on (Phase 2 / 3),
 * compCode, portalMe, portalReview, shopRedeem: COMP_MODULE_ACTIONS names
 * the global function each one calls (defined by CompRegistry.gs /
 * CompWallet.gs / CompStoreItems.gs). Until then they answer `disabled`.
 *
 * Replies: { ok: true, … } or { ok: false, code, message } (Arabic). Every
 * value is type / length checked; unknown keys are ignored; nothing the
 * browser sends is ever taken as a score. The server clock decides every
 * window. Grading happens BEFORE the live lock; inside it: the row as it
 * is now, the limits, one row write.
 */

var COMP_PUBLIC_MAX_BODY = 64 * 1024;
/* budgets per family of actions (a minute, CacheService), counted only after the cheap shape check */
var COMP_FAMILIES = {
  compStart: 'play', compSubmit: 'play', compResult: 'play',
  compCode: 'code',
  portalMe: 'portal', portalReview: 'portal', shopRedeem: 'portal', shopCancel: 'portal'
};
var COMP_FAMILY_PER_MINUTE = { play: 600, code: 120, portal: 300 };
/* starts a minute for one competition (a flood on one slug can't starve the others) */
var COMP_STARTS_PER_SLUG_MINUTE = 200;
/* unsent attempts (in_progress, still within their 48 h) one competition may hold */
var COMP_MAX_OPEN_ATTEMPTS = 3000;
/* failed code checks a minute (39-bit codes: decades to hit any of a few hundred); then a pause each */
var COMP_FAIL_PER_MINUTE = 60;
var COMP_FAIL_PAUSE_MS = 300;
var COMP_TOKEN_HOURS = 48;
var COMP_DEADLINE_SLACK_MS = 60000;
/* from this close to the time limit on, a submit is the page's automatic one: what was
   answered goes in, unanswered required questions included (the page's clock may run a
   little ahead of the server's) */
var COMP_TIMEUP_EARLY_MS = 15000;
var COMP_FAST_SECONDS = 2;
var COMP_CLIENT_KEY = /^[A-Za-z0-9_-]{16,64}$/;
var COMP_SUBMITTED = ['submitted', 'pending_review', 'graded'];

var COMP_MESSAGES = {
  bad: 'الطلب مش مفهوم. حدّث الصفحة وجرّب تاني.',
  not_found: 'المسابقة دي مش موجودة.',
  disabled: 'الخدمة دي مش متاحة دلوقتي.',
  not_open: 'المسابقة لسه مبدأتش.',
  closed: 'المسابقة خلصت.',
  busy: 'فيه ضغط دلوقتي. استنى ثواني وهنحاول تاني.',
  limit: 'وصلت للحد المسموح في المسابقة دي.',
  expired: 'وقت المحاولة خلص.',
  invalid: 'في حاجة محتاجة تتراجع.',
  code: 'الكود ده مش صحيح.',
  session: 'محتاج تدخل بالكود بتاعك تاني.',
  insufficient: 'نقاطك مش كفاية.',
  stock: 'الحاجة دي خلصت.',
  per_person: 'خدت أقصى عدد مسموح من الحاجة دي.',
  shop_closed: 'المتجر مقفول دلوقتي. طلباتك محفوظة.',
  not_allowed: 'مينفعش تلغي الطلب ده دلوقتي.'
};

/* the later modules' public actions: the switch they need and the global function that answers */
var COMP_MODULE_ACTIONS = {
  compCode: { module: 'registry', handler: 'compCodeAction_' },
  portalMe: { module: 'registry', handler: 'portalMeAction_' },
  portalReview: { module: 'registry', handler: 'portalReviewAction_' },
  shopRedeem: { module: 'shop', handler: 'shopRedeemAction_' },
  shopCancel: { module: 'shop', handler: 'shopCancelAction_' }
};


/* =========================================================
   DISPATCH
========================================================= */

function compGlobal_() {

  return typeof globalThis !== 'undefined' ? globalThis : this;

}

function compFail_(code, message, extra) {

  var reply = { ok: false, code: code, message: message || COMP_MESSAGES[code] || COMP_MESSAGES.bad };

  Object.keys(extra || {}).forEach(function (key) { reply[key] = extra[key]; });

  return reply;

}

/* the request's object, or null */
function compArg_(arg) {

  return arg && typeof arg === 'object' && !Array.isArray(arg) ? arg : null;

}

/* one budget counter (a minute in CacheService): false when it is used up */
function compTakeCounter_(key, limit) {

  var cache = CacheService.getScriptCache();
  var full = key + ':' + Math.floor(Date.now() / 60000);
  var used = Number(cache.get(full)) || 0;

  if (used >= limit) return false;

  cache.put(full, String(used + 1), 120);

  return true;

}

/* a family's budget (play / code / portal) */
function compTakeBudget_(family) {

  return compTakeCounter_('comp:min:' + family, COMP_FAMILY_PER_MINUTE[family] || 300);

}

/* a pt1 / at1 / rc1 token's outline (no signature check: that is the handler's) */
function compTokenShape_(value) {

  return typeof value === 'string' && value.length <= COMP_TOKEN_MAX && /^[a-z]{2}\d\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);

}

/*
 * The cheap outline of a request, before anything is counted or read: a
 * malformed call never spends a budget the real ones need.
 */
function compShapeOk_(fn, arg) {

  arg = compArg_(arg);

  if (!arg) return false;

  switch (fn) {
    case 'compStart':
      return typeof arg.slug === 'string' && COMP_SLUG.test(arg.slug) && typeof arg.clientKey === 'string' && COMP_CLIENT_KEY.test(arg.clientKey);
    case 'compSubmit':
      return compTokenShape_(arg.token) && typeof arg.clientKey === 'string' && COMP_CLIENT_KEY.test(arg.clientKey);
    case 'compResult':
      return arg.receipt !== undefined ? compTokenShape_(arg.receipt)
        : typeof arg.ptoken === 'string' && arg.ptoken.length <= COMP_TOKEN_MAX && typeof arg.submissionId === 'string' && COMP_SUBMISSION_ID.test(arg.submissionId);
    case 'compCode':
      return typeof arg.code === 'string' && arg.code.length > 0 && arg.code.length <= 40;
    default:
      // portal / shop: a participant token of a sane size (its handler says `session` when it is wrong)
      return typeof arg.ptoken === 'string' && arg.ptoken.length <= COMP_TOKEN_MAX;
  }

}

/**
 * The public entry (Api.gs doPost). size: the request body's length.
 * Never throws; nothing about the request is logged. Order: size → a known
 * action → its outline → its family's budget → the module switch → the handler.
 */
function publicComp_(fn, arg, size) {

  try {

    if (Number(size) > COMP_PUBLIC_MAX_BODY) {
      return compFail_('bad', 'الإجابات كبيرة قوي.');
    }

    if (!Object.prototype.hasOwnProperty.call(COMP_FAMILIES, fn) || !compShapeOk_(fn, arg)) {
      return compFail_('bad');
    }

    if (!compTakeBudget_(COMP_FAMILIES[fn])) {
      return compFail_('busy');
    }

    if (fn === 'compStart') return compStartAction_(arg);
    if (fn === 'compSubmit') return compSubmitAction_(arg);
    if (fn === 'compResult') return compResultAction_(arg);

    var spec = COMP_MODULE_ACTIONS[fn];
    var handler = compGlobal_()[spec.handler];

    if (!compModules_()[spec.module] || typeof handler !== 'function') {
      return compFail_('disabled');
    }

    return handler(arg);

  }
  catch (error) {
    console.warn('comp: ' + String(fn).slice(0, 20) + ' failed');
    return compFail_('busy');
  }

}


/* =========================================================
   FAILED CODE CHECKS (for Phase 2's compCode; kept here, generic)
   ≤ COMP_FAIL_PER_MINUTE failures a minute (then `busy`), a fixed pause
   after each. No day cap: with 39-bit codes, 60 guesses a minute need
   decades to hit any of a few hundred codes, and a day cap would only let
   anyone lock everybody out for the day.
========================================================= */

/* may another code be checked? */
function compCodeBudgetOk_() {

  var cache = CacheService.getScriptCache();
  var minute = Number(cache.get('comp:fail:' + Math.floor(Date.now() / 60000))) || 0;

  return minute < COMP_FAIL_PER_MINUTE;

}

/* a wrong code: counted (CacheService only), then a fixed pause */
function compCodeFailed_() {

  var cache = CacheService.getScriptCache();
  var key = 'comp:fail:' + Math.floor(Date.now() / 60000);

  cache.put(key, String((Number(cache.get(key)) || 0) + 1), 120);
  Utilities.sleep(COMP_FAIL_PAUSE_MS);

}


/* =========================================================
   WHAT IS SERVED (deterministic from the attempt's seed)
========================================================= */

/* FNV-1a of a string → a 32-bit seed */
function compHash32_(text) {

  var h = 0x811c9dc5;

  for (var i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }

  return h >>> 0;

}

/* a seeded shuffle (mulberry32) */
function compShuffle_(list, seedText) {

  var a = compHash32_(seedText) || 1;
  var out = list.slice();
  var next = function () {
    a = (a + 0x6D2B79F5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  for (var i = out.length - 1; i > 0; i--) {
    var j = Math.floor(next() * (i + 1));
    var swap = out[i];
    out[i] = out[j];
    out[j] = swap;
  }

  return out;

}

function compServedOrder_(def, seed) {

  var ids = def.questions.map(function (q) { return q.id; });

  return def.shuffleQ ? compShuffle_(ids, seed + ':q') : ids;

}

function compChoiceOrder_(def, q, seed) {

  return def.shuffleC && q.choices && q.choices.length ? compShuffle_(q.choices.map(function (c) { return c.id; }), seed + ':' + q.id) : null;

}


/* =========================================================
   RESULTS (the policy at THIS moment)
========================================================= */

/* the live state for a definition (by its slug; null = withdrawn) */
function compLiveFor_(def) {

  var live = def && def.slug ? compLive_(def.slug) : null;

  return live && live.compId === def.id ? live : null;

}

/**
 * Result = { status, submittedAt, score?, maxScore?, correctCount?, gradableCount?,
 *            pending?, pointsAwarded?, resultsAt?, answersAt?, review? }
 * The questions and answers are the version the person was served (def);
 * the POLICY (what shows, from when) and the key shown are the competition
 * as it is live now: the policy at THIS moment.
 */
function compResult_(def, row, live, now) {

  var result = { status: row.status, submittedAt: contentDateTime_(row.submittedAt, false) || '' };

  if (row.status === 'void' || row.status === 'in_progress') {
    return result;
  }

  var policy = live && live.version !== row.version ? compDefinitionFor_(def.id, live.version) || def : def;
  // a withdrawn competition (live = null) is not «closed»: only its own end date ends it
  var state = { closedAt: live ? live.closedAt : '', finalizedAt: live ? live.finalizedAt : '' };
  var finalized = !!(live && live.finalizedAt);
  var shows = function (what) { return policy.scoring && (policy.resultShow === what || policy.resultShow === 'both'); };
  var visible = !policy.resultsAt || now.wall >= policy.resultsAt || finalized;

  if (shows('score')) {
    if (visible) {
      result.score = Number(row.score) || 0;
      result.maxScore = Number(row.maxScore) || 0;
      result.correctCount = Number(row.correctCount) || 0;
      result.gradableCount = Number(row.gradableCount) || 0;
      result.pending = Number(row.pendingCount) || 0;
    }
    else {
      result.resultsAt = policy.resultsAt;
    }
  }

  if (policy.wallet && shows('points') && row.status === 'graded' && visible && compModules_().wallet && typeof walletPointsFor_ === 'function') {
    try {
      result.pointsAwarded = Number(walletPointsFor_(row.id)) || 0;
    }
    catch (ignored) {
      // the rest of the result still shows
    }
  }
  else if (policy.wallet && shows('points') && !visible) {
    result.resultsAt = policy.resultsAt;
  }

  // afterClose: only once nobody can still send (the end, or «اقفل دلوقتي», + the grace + the slack)
  var allowed = compAnswersOpen_(policy, state, now.wall);

  if (allowed) {
    result.review = compReview_(def, row, policy.scoring && visible, policy);
  }
  else if (policy.answersShow === 'atDate' && policy.answersAt) {
    result.answersAt = policy.answersAt;
  }
  else if (policy.answersShow === 'afterClose' && policy.endAt) {
    result.answersAt = policy.endAt;
  }

  return result;

}

/*
 * The person's answers next to the key, in the order they were served
 * (marks only when the score shows). keyDef: the live definition, whose key
 * (after a regrade) is the one shown for questions it still has.
 */
function compReview_(def, row, marks, keyDef) {

  var answers = compJson_(row.answers, {}) || {};
  var grading = compJson_(row.grading, {}) || {};
  var byId = Object.create(null);
  var keys = Object.create(null);

  def.questions.forEach(function (q) { byId[q.id] = q; });
  (keyDef || def).questions.forEach(function (q) { keys[q.id] = q; });

  return (compJson_(row.qids, []) || []).map(function (qid) { return byId[qid]; }).filter(function (q) {
    return q && q.type !== 'info';
  }).map(function (q) {
    var g = grading[q.id] || {};
    var key = keys[q.id] || q;
    var media = key.explanationMedia && compMediaReleased_(key.explanationMedia) ? key.explanationMedia : null;
    return {
      id: q.id,
      type: q.type,
      text: q.text,
      media: q.media,
      choices: q.choices,
      answer: answers[q.id] === undefined ? null : answers[q.id],
      correct: (keyDef || def).scoring ? key.correct : null,
      ok: marks && g.ok !== undefined ? g.ok : null,
      pts: marks ? Number(g.pts) || 0 : null,
      explanation: key.explanation,
      // the picture only once it is on the site (a publish after the answers opened sends it)
      explanationMedia: media
    };
  });

}

/* after any grade change: the wallet follows (Phase 3; never fails the caller) */
function compAfterGrade_(submissionId) {

  if (!compModules_().wallet || typeof walletReconcile_ !== 'function') return;

  try {
    walletReconcile_(submissionId);
  }
  catch (error) {
    console.warn('comp: wallet not reconciled');
  }

}


/* the same for many submissions (a regrade, a group review): one lock, one ledger read */
function compAfterGradeMany_(ids) {

  if (!ids.length || !compModules_().wallet) return;

  try {
    if (typeof walletReconcileMany_ === 'function') walletReconcileMany_(ids);
    else ids.forEach(compAfterGrade_);
  }
  catch (error) {
    console.warn('comp: wallet not reconciled');
  }

}


/* =========================================================
   compStart
========================================================= */

/* the attempt as the page needs it (start, resume) */
/* cv: a registered attempt's codeVersion (from the participant's token): a code reset kills the attempt */
function compAttemptReply_(def, row, resumed, now, cv) {

  var byId = Object.create(null);

  def.questions.forEach(function (q) { byId[q.id] = q; });

  var qids = compJson_(row.qids, []) || [];
  var questions = qids.map(function (id) { return byId[id]; }).filter(Boolean).map(function (q) {
    return compPublicQuestion_(q, def.showPoints, compChoiceOrder_(def, q, row.seed));
  });
  var deadline = Number(row.deadlineMs) || 0;
  var started = Number(row.startedMs) || now.ms;
  // well past the window: the window itself (closed / expired) is decided by the server clock at submit
  var end = def.endAt ? compWallMs_(def.endAt) + (COMP_GRACE_MINUTES + 15) * 60000 : Infinity;
  var expiry = Math.min(started + COMP_TOKEN_HOURS * 3600000, end);
  var payload = { s: row.id, c: def.id, v: row.version, d: deadline, e: expiry };

  if (row.participantId) {
    payload.p = row.participantId;
    payload.cv = cv === undefined ? null : cv;
  }

  var reply = {
    ok: true,
    attempt: {
      token: compSignToken_('at1', payload),
      id: row.id,
      startedAt: contentDateTime_(row.startedAt, false) || '',
      deadlineMs: deadline,
      resumed: !!resumed,
      status: row.status,
      serverNow: now.ms
    },
    comp: { v: row.version, layout: def.layout, showPoints: def.showPoints, timeLimit: def.timeLimit, total: questions.length },
    questions: questions
  };

  // already sent from another tab / device: the receipt and the result too
  if (row.status !== 'in_progress') {
    reply.receipt = compSignToken_('rc1', { s: row.id, c: def.id });
    reply.result = compResult_(def, row, compLiveFor_(def), now);
  }

  return reply;

}

function compStartAction_(arg) {

  arg = compArg_(arg);

  if (!arg || typeof arg.slug !== 'string' || !COMP_SLUG.test(arg.slug) ||
      typeof arg.clientKey !== 'string' || !COMP_CLIENT_KEY.test(arg.clientKey)) {
    return compFail_('bad');
  }

  // the honeypot field: people never fill it
  if (arg.hp !== undefined && arg.hp !== null && arg.hp !== '') {
    return compFail_('bad');
  }

  // one competition's flood can't take every start of the minute
  if (!compTakeCounter_('comp:start:' + arg.slug, COMP_STARTS_PER_SLUG_MINUTE)) return compFail_('busy');

  if (!compSpreadsheet_(false)) return compFail_('not_found');

  var live = compLive_(arg.slug);
  var def = live ? compDefinitionFor_(live.compId, live.version) : null;

  if (!def) return compFail_('not_found');

  var now = compNow_();
  var status = compStatus_({ liveVersion: live.version, closedAt: live.closedAt, finalizedAt: live.finalizedAt }, def, now.wall, { live: true });

  if (status === 'scheduled') return compFail_('not_open', null, { startAt: def.startAt });
  if (status !== 'open') return compFail_('closed');

  /* ---- who ---- */

  var who;
  var cv;

  if (def.participation === 'registered') {
    if (!compModules_().registry || typeof compParticipantFromToken_ !== 'function') return compFail_('disabled');
    var participant = compParticipantFromToken_(arg.ptoken);
    if (!participant || !participant.id) return compFail_('session');
    var pt = compReadToken_('pt1', arg.ptoken);
    cv = pt.ok ? pt.payload.cv : undefined;
    who = { participantId: participant.id, name: String(participant.name || ''), phone: String(participant.phone || ''), fields: participant.group ? { group: String(participant.group) } : {} };
  }
  else {
    var values = compFieldValues_(def.fields, arg.fields);
    if (values.problem) return compFail_('invalid', values.problem.message, { field: values.problem.field });
    who = { participantId: '', name: values.name, phone: values.phone, fields: values.fields };
  }

  /* ---- the attempt (one row, under the live lock) ---- */

  var seed = sha256Hex_(arg.clientKey + ':' + def.id).slice(0, 12);
  var lock = compLock_();

  if (!lock) return compFail_('busy');

  var t = compSheet_('Submissions');
  var row = null;
  var resumed = false;
  var refused = null;

  try {

    var mine = compColumns_(t, ['id', 'compId', 'version', 'clientKey', 'attemptNo', 'participantId', 'phone', 'status', 'startedMs'])
      .filter(function (r) { return r.compId === def.id && r.status !== 'void'; });
    var same = mine.filter(function (r) { return r.clientKey === arg.clientKey; })[0];

    // the same attempt again (a retry, a reload): the same questions, the same order
    if (!same && who.participantId) {
      same = mine.filter(function (r) { return r.participantId === who.participantId && r.version === live.version && r.status === 'in_progress'; })[0];
    }

    if (same && who.participantId && same.participantId !== who.participantId) {
      // another participant's attempt key: never theirs to resume
      refused = compFail_('bad');
    }
    else if (same) {
      row = compRowAt_(t, same.__row);
      resumed = true;
    }
    else {

      var submitted = function (r) { return COMP_SUBMITTED.indexOf(r.status) !== -1; };
      var theirs = who.participantId
        ? mine.filter(function (r) { return r.participantId === who.participantId; })
        : who.phone ? mine.filter(function (r) { return r.phone === who.phone; }) : [];

      // unsent attempts still alive (≤ 48 h): a bounded number per competition (no sheet flood)
      var open = mine.filter(function (r) { return r.status === 'in_progress' && Number(r.startedMs) > now.ms - COMP_TOKEN_HOURS * 3600000; }).length;

      if (open >= COMP_MAX_OPEN_ATTEMPTS) {
        refused = compFail_('limit', 'المسابقة عليها ضغط كبير دلوقتي. جرّب تاني كمان شوية.');
      }
      else if (def.maxSubmissions && mine.filter(submitted).length >= def.maxSubmissions) {
        refused = compFail_('limit', 'المسابقة اكتملت ومش بتستقبل مشاركات تانية.');
      }
      else if (def.uniquePhone && who.phone && theirs.some(submitted)) {
        refused = compFail_('limit', 'الرقم ده شارك في المسابقة قبل كده.');
      }
      else if (theirs.filter(submitted).length >= def.attempts) {
        refused = compFail_('limit', def.attempts > 1 ? 'خلّصت كل المحاولات المسموحة.' : 'إنت شاركت في المسابقة دي قبل كده.');
      }
      else {
        row = {
          id: 's-' + compRandomHex_(6),
          compId: def.id,
          version: live.version,
          clientKey: arg.clientKey,
          attemptNo: String(theirs.length + 1),
          participantId: who.participantId,
          name: who.name,
          phone: who.phone,
          fields: who.fields,
          status: 'in_progress',
          startedAt: now.stamp,
          submittedAt: '',
          startedMs: String(now.ms),
          deadlineMs: String(def.timeLimit ? now.ms + def.timeLimit * 60000 : 0),
          submittedMs: '',
          durationSec: '',
          seed: seed,
          qids: compServedOrder_(def, seed),
          flags: '',
          updatedAt: now.stamp
        };
        compAppend_(t, [row]);
        row.qids = JSON.stringify(row.qids);
        row.fields = JSON.stringify(row.fields);
      }

    }

  }
  finally {
    lock.releaseLock();
  }

  if (refused) return refused;

  // an attempt from an earlier publish is answered with ITS questions
  var served = row.version === live.version ? def : compDefinitionFor_(def.id, row.version);

  var reply = compAttemptReply_(served || def, row, resumed, now, cv);

  // the same participant on another device gets that attempt back: its key comes along
  // (compSubmit checks the attempt's own clientKey)
  if (resumed && row.clientKey !== arg.clientKey) reply.attempt.clientKey = row.clientKey;

  return reply;

}


/* =========================================================
   compSubmit
========================================================= */

/*
 * Is the participant of a registered attempt still the one the token was
 * issued to: same id, still active, the same codeVersion (a reset or a
 * deactivation kills attempts in flight)? Uses the registry's row lookup.
 */
function compParticipantStill_(pid, payload) {

  if (payload.p !== pid || payload.cv === undefined || payload.cv === null) return false;
  if (!compModules_().registry || typeof regRowById_ !== 'function') return false;

  var row = regRowById_(pid);

  return !!row && row.status !== 'inactive' && String(Number(row.codeVersion) || 1) === String(payload.cv);

}

function compSubmitAction_(arg) {

  arg = compArg_(arg);

  if (!arg || typeof arg.clientKey !== 'string' || !COMP_CLIENT_KEY.test(arg.clientKey)) {
    return compFail_('bad');
  }

  var now = compNow_();
  var read = compReadToken_('at1', arg.token, now.ms);

  if (!read.ok) return compFail_(read.reason === 'expired' ? 'expired' : 'bad');

  var p = read.payload;

  if (typeof p.s !== 'string' || !COMP_SUBMISSION_ID.test(p.s) || typeof p.c !== 'string' || !COMP_ID.test(p.c)) {
    return compFail_('bad');
  }

  if (!compSpreadsheet_(false)) return compFail_('not_found');

  var t = compSheet_('Submissions');
  var rowNumber = compFindRow_(t, 'id', p.s);
  var row = rowNumber ? compRowAt_(t, rowNumber) : null;

  if (!row) return compFail_('not_found');

  if (row.compId !== p.c || row.version !== p.v || !compSafeEqual_(row.clientKey, arg.clientKey)) {
    return compFail_('bad');
  }

  var def = compDefinitionFor_(row.compId, row.version);

  if (!def) return compFail_('not_found');

  var live = compLiveFor_(def);

  // sent already: the same receipt and the result as it stands now
  if (row.status !== 'in_progress') {
    return compSubmitted_(def, row, live, now);
  }

  // a registered attempt: the participant is still active and the code was not reset since
  if (row.participantId && !compParticipantStill_(row.participantId, p)) {
    return compFail_('session');
  }

  /* ---- the window (server clock) ---- */

  if (!live) return compFail_('closed');

  var comp = { liveVersion: live.version, closedAt: live.closedAt, finalizedAt: live.finalizedAt };

  if (compStatus_(comp, def, now.wall, { live: true, graceMinutes: COMP_GRACE_MINUTES }) !== 'open') {
    return compFail_('closed');
  }

  var deadline = Number(row.deadlineMs) || 0;

  if (deadline && now.ms > deadline + COMP_DEADLINE_SLACK_MS) {
    return compFail_('expired');
  }

  var late = compStatus_(comp, def, now.wall, { live: true }) !== 'open' || (deadline && now.ms > deadline);

  /* ---- answers, graded before the lock ---- */

  var qids = compJson_(row.qids, []) || [];
  var checked = compValidateAnswers_(def, qids, arg.answers);
  var sent = arg.answers && typeof arg.answers === 'object' ? arg.answers : {};
  var problems = deadline && now.ms >= deadline - COMP_TIMEUP_EARLY_MS
    ? checked.problems.filter(function (problem) { return !(problem.qid && qids.indexOf(problem.qid) !== -1 && compEmpty_(sent[problem.qid])); })
    : checked.problems;

  if (problems.length) {
    return compFail_('invalid', problems[0].message, { qid: problems[0].qid });
  }

  var graded = compGrade_(def, checked.answers, { qids: qids, at: now.stamp });
  var duration = Math.max(0, Math.round((now.ms - (Number(row.startedMs) || now.ms)) / 1000));
  var gradable = def.questions.filter(function (q) { return q.type !== 'info' && qids.indexOf(q.id) !== -1; }).length;
  var flags = [];

  if (gradable && duration < COMP_FAST_SECONDS * gradable) flags.push('fast');
  if (late) flags.push('late');

  var update = {
    status: graded.status,
    submittedAt: now.stamp,
    submittedMs: String(now.ms),
    durationSec: String(duration),
    score: String(graded.score),
    maxScore: String(graded.maxScore),
    correctCount: String(graded.correctCount),
    gradableCount: String(graded.gradableCount),
    pendingCount: String(graded.pendingCount),
    flags: flags.join(','),
    answers: checked.answers,
    grading: graded.grading,
    updatedAt: now.stamp
  };

  /* ---- the live lock: the row as it is now, the limits, one write ---- */

  var lock = compLock_();

  if (!lock) return compFail_('busy');

  var refused = null;
  var replay = null;

  try {

    var current = compRowAt_(t, rowNumber);

    if (!current || current.id !== row.id) {
      rowNumber = compFindRow_(t, 'id', row.id);
      current = rowNumber ? compRowAt_(t, rowNumber) : null;
    }

    if (!current) {
      refused = compFail_('not_found');
    }
    else if (current.status !== 'in_progress') {
      replay = current;
    }
    else {

      var identity = current.participantId || current.phone;

      if (def.maxSubmissions || def.uniquePhone || identity) {

        var others = compColumns_(t, ['id', 'compId', 'participantId', 'phone', 'status']).filter(function (r) {
          return r.compId === current.compId && r.id !== current.id && COMP_SUBMITTED.indexOf(r.status) !== -1;
        });
        var theirs = others.filter(function (r) {
          return current.participantId ? r.participantId === current.participantId : !!current.phone && r.phone === current.phone;
        });

        if (def.maxSubmissions && others.length >= def.maxSubmissions) refused = compFail_('limit', 'المسابقة اكتملت ومش بتستقبل مشاركات تانية.');
        else if (def.uniquePhone && current.phone && theirs.length) refused = compFail_('limit', 'الرقم ده شارك في المسابقة قبل كده.');
        else if (identity && theirs.length >= def.attempts) refused = compFail_('limit', def.attempts > 1 ? 'خلّصت كل المحاولات المسموحة.' : 'إنت شاركت في المسابقة دي قبل كده.');

      }

      if (!refused) {
        compUpdate_(t, rowNumber, update, current);
      }

    }

  }
  finally {
    lock.releaseLock();
  }

  if (refused) return refused;
  if (replay) return compSubmitted_(def, replay, live, now);

  Object.keys(update).forEach(function (key) {
    row[key] = typeof update[key] === 'object' ? JSON.stringify(update[key]) : update[key];
  });

  compAfterGrade_(row.id);

  return compSubmitted_(def, row, live, now);

}

function compSubmitted_(def, row, live, now) {

  return {
    ok: true,
    receipt: compSignToken_('rc1', { s: row.id, c: row.compId }),
    result: compResult_(def, row, live, now)
  };

}


/* =========================================================
   compResult
========================================================= */

function compResultAction_(arg) {

  arg = compArg_(arg);

  if (!arg) return compFail_('bad');

  var now = compNow_();
  var id = '';
  var participant = null;

  if (arg.receipt !== undefined) {
    var read = compReadToken_('rc1', arg.receipt, now.ms);
    if (!read.ok || typeof read.payload.s !== 'string' || !COMP_SUBMISSION_ID.test(read.payload.s)) return compFail_('bad');
    id = read.payload.s;
  }
  else if (arg.ptoken !== undefined) {
    if (!compModules_().registry || typeof compParticipantFromToken_ !== 'function') return compFail_('disabled');
    participant = compParticipantFromToken_(arg.ptoken);
    if (!participant || !participant.id) return compFail_('session');
    if (typeof arg.submissionId !== 'string' || !COMP_SUBMISSION_ID.test(arg.submissionId)) return compFail_('bad');
    id = arg.submissionId;
  }
  else {
    return compFail_('bad');
  }

  if (!compSpreadsheet_(false)) return compFail_('not_found');

  var t = compSheet_('Submissions');
  var rowNumber = compFindRow_(t, 'id', id);
  var row = rowNumber ? compRowAt_(t, rowNumber) : null;

  if (!row || (participant && row.participantId !== participant.id)) return compFail_('not_found');

  var def = compDefinitionFor_(row.compId, row.version);

  if (!def) return compFail_('not_found');

  return { ok: true, result: compResult_(def, row, compLiveFor_(def), now) };

}
