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
var COMP_PUBLIC_PER_MINUTE = 300;
var COMP_FAIL_PER_MINUTE = 30;
var COMP_FAIL_PER_DAY = 1000;
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
  per_person: 'خدت أقصى عدد مسموح من الحاجة دي.'
};

/* the later modules' public actions: the switch they need and the global function that answers */
var COMP_MODULE_ACTIONS = {
  compCode: { module: 'registry', handler: 'compCodeAction_' },
  portalMe: { module: 'registry', handler: 'portalMeAction_' },
  portalReview: { module: 'registry', handler: 'portalReviewAction_' },
  shopRedeem: { module: 'shop', handler: 'shopRedeemAction_' }
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

/* every comp / portal / shop call: ≤ COMP_PUBLIC_PER_MINUTE a minute */
function compTakeBudget_() {

  var cache = CacheService.getScriptCache();
  var key = 'comp:min:' + Math.floor(Date.now() / 60000);
  var used = Number(cache.get(key)) || 0;

  if (used >= COMP_PUBLIC_PER_MINUTE) return false;

  cache.put(key, String(used + 1), 120);

  return true;

}

/**
 * The public entry (Api.gs doPost). size: the request body's length.
 * Never throws; nothing about the request is logged.
 */
function publicComp_(fn, arg, size) {

  try {

    if (Number(size) > COMP_PUBLIC_MAX_BODY) {
      return compFail_('bad', 'الإجابات كبيرة قوي.');
    }

    if (!compTakeBudget_()) {
      return compFail_('busy');
    }

    if (fn === 'compStart') return compStartAction_(arg);
    if (fn === 'compSubmit') return compSubmitAction_(arg);
    if (fn === 'compResult') return compResultAction_(arg);

    if (!Object.prototype.hasOwnProperty.call(COMP_MODULE_ACTIONS, fn)) {
      return compFail_('bad');
    }

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
========================================================= */

/* may another code be checked? (≤ 30 failures a minute, ≤ 1,000 a day) */
function compCodeBudgetOk_() {

  var cache = CacheService.getScriptCache();
  var minute = Number(cache.get('comp:fail:' + Math.floor(Date.now() / 60000))) || 0;
  var stored = String(PropertiesService.getScriptProperties().getProperty('COMP_FAIL_DAY') || '').split(':');
  var day = stored[0] === new Date(Date.now()).toISOString().slice(0, 10) ? Number(stored[1]) || 0 : 0;

  return minute < COMP_FAIL_PER_MINUTE && day < COMP_FAIL_PER_DAY;

}

/* a wrong code: counted, then a fixed pause */
function compCodeFailed_() {

  var cache = CacheService.getScriptCache();
  var key = 'comp:fail:' + Math.floor(Date.now() / 60000);
  var props = PropertiesService.getScriptProperties();
  var today = new Date(Date.now()).toISOString().slice(0, 10);
  var stored = String(props.getProperty('COMP_FAIL_DAY') || '').split(':');
  var day = stored[0] === today ? Number(stored[1]) || 0 : 0;

  cache.put(key, String((Number(cache.get(key)) || 0) + 1), 120);
  // one property write per counted failure, never past the day's cap (the budget check refuses before that)
  if (day < COMP_FAIL_PER_DAY) props.setProperty('COMP_FAIL_DAY', today + ':' + (day + 1));
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
  var comp = { liveVersion: live ? live.version : 'withdrawn', closedAt: live ? live.closedAt : '', finalizedAt: live ? live.finalizedAt : '' };
  var phase = live ? compStatus_(comp, policy, now.wall, { live: true }) : 'closed';
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

  var closed = phase === 'closed' || phase === 'results';
  var allowed = policy.answersShow === 'immediately' ||
    (policy.answersShow === 'afterClose' && closed) ||
    (policy.answersShow === 'atDate' && !!policy.answersAt && now.wall >= policy.answersAt);

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
      explanationMedia: key.explanationMedia
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
function compAttemptReply_(def, row, resumed, now) {

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

  var reply = {
    ok: true,
    attempt: {
      token: compSignToken_('at1', { s: row.id, c: def.id, v: row.version, d: deadline, e: expiry }),
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

  if (def.participation === 'registered') {
    if (!compModules_().registry || typeof compParticipantFromToken_ !== 'function') return compFail_('disabled');
    var participant = compParticipantFromToken_(arg.ptoken);
    if (!participant || !participant.id) return compFail_('session');
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

    var mine = compColumns_(t, ['id', 'compId', 'version', 'clientKey', 'attemptNo', 'participantId', 'phone', 'status'])
      .filter(function (r) { return r.compId === def.id && r.status !== 'void'; });
    var same = mine.filter(function (r) { return r.clientKey === arg.clientKey; })[0];

    // the same attempt again (a retry, a reload): the same questions, the same order
    if (!same && who.participantId) {
      same = mine.filter(function (r) { return r.participantId === who.participantId && r.version === live.version && r.status === 'in_progress'; })[0];
    }

    if (same) {
      row = compRowAt_(t, same.__row);
      resumed = true;
    }
    else {

      var submitted = function (r) { return COMP_SUBMITTED.indexOf(r.status) !== -1; };
      var theirs = who.participantId
        ? mine.filter(function (r) { return r.participantId === who.participantId; })
        : who.phone ? mine.filter(function (r) { return r.phone === who.phone; }) : [];

      if (def.maxSubmissions && mine.filter(submitted).length >= def.maxSubmissions) {
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

  return compAttemptReply_(served || def, row, resumed, now);

}


/* =========================================================
   compSubmit
========================================================= */

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
