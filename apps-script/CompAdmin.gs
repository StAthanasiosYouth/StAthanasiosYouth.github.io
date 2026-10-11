/**
 * COMPETITIONS: THE ADMIN API (engine). docs/COMPETITIONS.md §10.
 *
 * Every function starts with assertAdmin_() and is listed in apiFunctions_
 * (Api.gs). They do NOT go through mutate_ (which answers with the whole
 * panel state): each returns its own data. Draft writes (Competitions,
 * Questions, the module switches, the linked card) run under the script
 * lock (compWrite_); live writes (grading, regrade, void) under compLock_
 * (compLiveWrite_) and only from the official admin (/admin/): the
 * recovery admin runs as the visiting admin, whose user lock is not the
 * public's. Activity rows are noted during the change and written after
 * it succeeded (activityNote_, same guarantees as mutate_); never a phone,
 * a code or an answer in them. Edit lock: comp:<id> (Presence.gs).
 */

var COMP_IMPORT_MAX_ROWS = 300;
var COMP_IMPORT_MAX_TEXT = 400 * 1024;
var COMP_PAGE = 50;
var COMP_PAGE_MAX = 200;
var COMP_STATUS_LABELS = { in_progress: 'لسه بيحل', submitted: 'اتبعتت', pending_review: 'محتاجة مراجعة', graded: 'اتصححت', void: 'ملغية' };


/* =========================================================
   HELPERS
========================================================= */

function compValidId_(value, pattern, label) {

  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error((label || 'المعرّف') + ' مش صحيح');
  }

  return value;

}

/* a draft change under the script lock; Activity notes written after it succeeded */
function compWrite_(label, change) {

  var email = currentEmail_();
  var lock = LockService.getScriptLock();
  var result;

  lock.waitLock(20000);

  try {
    takeActivityNotes_();
    result = change(email);
    compDropDraft_();
    log_(email, 'comp.' + label, typeof result === 'string' ? result : '');
    takeActivityNotes_().forEach(function (entry) { activity_(entry); });
  }
  finally {
    takeActivityNotes_();
    lock.releaseLock();
  }

  return result;

}

/* a live change (Submissions) under compLock_, from the official admin only */
function compLiveWrite_(label, change) {

  if (!API_REQUEST_ || !API_REQUEST_.email) {
    throw appError_('تصحيح المسابقات من لوحة التحكم الرسمية بس.', 'افتح لوحة التحكم (/admin/) وكمّل من هناك.');
  }

  var email = currentEmail_();
  var lock = compLock_(20000);
  var result;

  if (!lock) {
    throw appError_('فيه ضغط على المسابقات دلوقتي.', 'استنى ثواني وجرّب تاني.');
  }

  try {
    takeActivityNotes_();
    result = change(email);
    log_(email, 'comp.' + label, typeof result === 'string' ? result : '');
    takeActivityNotes_().forEach(function (entry) { activity_(entry); });
  }
  finally {
    takeActivityNotes_();
    lock.releaseLock();
  }

  return result;

}

/* the library's usable image ids → mediaOk(id) */
function compMediaOk_() {

  var ids = Object.create(null);

  readOptionalTable_('Media').forEach(function (row) {
    if (/^img-[a-z0-9]{8}$/.test(row.id) && !row.deletedAt) ids[row.id] = true;
  });

  return function (id) { return !!ids[id]; };

}

function compMediaIndex_() {

  return mediaIndex_(readOptionalTable_('Media'));

}

/* the competition's row (fresh), or an error */
function compFindComp_(id) {

  compValidId_(id, COMP_ID, 'معرّف المسابقة');

  if (!compSpreadsheet_(false)) throw new Error('المسابقة مش موجودة');

  var row = compRows_(compSheet_('Competitions')).filter(function (r) { return r.id === id; })[0];

  if (!row) throw new Error('المسابقة مش موجودة');

  return row;

}

function compQuestionsOf_(compId) {

  return compRows_(compSheet_('Questions')).filter(function (r) { return r.compId === compId; });

}

function compSiteUrl_() {

  return safeHttpsUrl(PropertiesService.getScriptProperties().getProperty('SITE_URL') || '') || COMP_SITE_URL;

}

function compPresetsFor_(modules) {

  return Object.keys(COMP_PRESETS).filter(function (key) {
    var needs = COMP_PRESETS[key].needs;
    return !needs || modules[needs];
  }).map(function (key) {
    var p = COMP_PRESETS[key];
    return { key: key, label: p.label, participation: p.participation, scoring: p.scoring === '1', resultShow: p.resultShow, answersShow: p.answersShow, wallet: p.wallet === '1' };
  });

}

/* the draft definition of one competition (enabled questions, the library's images) and its version */
function compDraftDefinition_(compRow, questionRows, media) {

  var comp = compParseComp_(compRow);
  var questions = questionRows.map(compParseQuestion_);
  var def = compDefinition_(comp, questions, media || compMediaIndex_());

  return {
    comp: comp,
    questions: questions,
    def: def,
    version: compVersion_(def, sha256Hex_),
    problems: compPublishProblems_(comp, questions, compModules_(), media || compMediaIndex_())
  };

}

/* the row as the builder edits it */
function compAdminComp_(row) {

  var c = compParseComp_(row);

  return {
    id: c.id, slug: c.slug, title: c.title, shortTitle: c.shortTitle, description: c.description, instructions: c.instructions,
    ctaLabel: c.ctaLabel, banner: c.banner, icon: c.icon, theme: c.theme,
    startAt: row.startAt || '', endAt: row.endAt || '', participation: c.participation, scoring: c.scoring,
    resultShow: c.resultShow, resultsAt: row.resultsAt || '', answersShow: c.answersShow, answersAt: row.answersAt || '',
    showPoints: c.showPoints, wallet: c.wallet, attempts: c.attempts, layout: c.layout, shuffleQ: c.shuffleQ, shuffleC: c.shuffleC,
    timeLimit: c.timeLimit, maxSubmissions: c.maxSubmissions, uniquePhone: c.uniquePhone, fields: c.fields, successText: c.successText,
    enabled: c.enabled, cardId: c.cardId, liveVersion: c.liveVersion, publishedAt: c.publishedAt, closedAt: row.closedAt || '',
    finalizedAt: c.finalizedAt, archived: c.archived, createdBy: c.createdBy, createdAt: c.createdAt, updatedAt: c.updatedAt
  };

}

/* a question as the editor gets it (with the key: admins only) */
function compAdminQuestion_(row, scoring) {

  var q = compParseQuestion_(row);

  return {
    id: q.id, order: q.order, type: q.type, text: q.text, help: q.help, media: q.media, choices: q.choices, correct: q.correct,
    points: q.points, required: q.required, explanation: q.explanation, explanationMedia: q.explanationMedia, review: q.review,
    enabled: q.enabled, problems: compQuestionProblems_(q, scoring)
  };

}

/* submissions per competition: { compId: { total, done, pending, inProgress, void } } */
function compSubmissionCounts_() {

  var counts = Object.create(null);

  compColumns_(compSheet_('Submissions'), ['compId', 'status']).forEach(function (row) {
    var c = counts[row.compId] = counts[row.compId] || { total: 0, done: 0, pending: 0, inProgress: 0, void: 0 };
    c.total++;
    if (COMP_SUBMITTED.indexOf(row.status) !== -1) c.done++;
    if (row.status === 'pending_review') c.pending++;
    if (row.status === 'in_progress') c.inProgress++;
    if (row.status === 'void') c.void++;
  });

  return counts;

}

function compSummary_(row, questions, counts, draft, now) {

  var c = compParseComp_(row);
  var stats = counts[c.id] || { total: 0, done: 0, pending: 0, inProgress: 0, void: 0 };
  var publishing = c.enabled && !c.archived;

  return {
    id: c.id,
    slug: c.slug,
    title: c.title,
    shortTitle: c.shortTitle,
    status: compStatus_(c, null, now.wall),
    startAt: row.startAt || '',
    endAt: row.endAt || '',
    participation: c.participation,
    scoring: c.scoring,
    wallet: c.wallet,
    enabled: c.enabled,
    archived: c.archived,
    liveVersion: c.liveVersion,
    draftVersion: draft ? draft.version : '',
    // «فيه تعديلات لسه متنشرتش» for this one (or it disappears with the next publish)
    hasChanges: publishing ? !!draft && draft.version !== c.liveVersion : !!c.liveVersion,
    problems: draft ? draft.problems.length : 0,
    publishedAt: c.publishedAt,
    closedAt: row.closedAt || '',
    finalizedAt: c.finalizedAt,
    cardId: c.cardId,
    questionCount: questions.filter(function (q) { return q.type !== 'info' && compFlag_(q.enabled) === '1'; }).length,
    submissions: stats.done,
    pending: stats.pending,
    inProgress: stats.inProgress,
    updatedAt: c.updatedAt,
    url: compSiteUrl_() + 'competition/' + c.slug + '/'
  };

}


/* =========================================================
   COMPETITIONS
========================================================= */

/** The list: { ready, comps: [summary], modules, presets, limits, types, now, siteUrl }. */
function apiComps() {

  assertAdmin_();

  var modules = compModules_();
  var now = compNow_();
  var result = {
    ready: false,
    comps: [],
    modules: modules,
    // which module's code is in this version (a switch can be turned on only then; «الإعدادات» says so)
    installed: { registry: typeof compRegistryReady_ === 'function', wallet: typeof compWalletReady_ === 'function', shop: typeof compShopReady_ === 'function' },
    presets: compPresetsFor_(modules),
    limits: COMP_LIMITS,
    types: COMP_TYPE_LABELS,
    statuses: COMP_STATUS_LABELS,
    now: now.wall,
    siteUrl: compSiteUrl_()
  };

  if (!compSpreadsheet_(false)) {
    return result;
  }

  var comps = compRows_(compSheet_('Competitions'));
  var questions = compRows_(compSheet_('Questions'));
  var counts = compSubmissionCounts_();
  var media = compMediaIndex_();
  var byComp = Object.create(null);

  questions.forEach(function (q) { (byComp[q.compId] = byComp[q.compId] || []).push(q); });

  result.ready = true;
  result.comps = comps.map(function (row) {
    var mine = byComp[row.id] || [];
    return compSummary_(row, mine, counts, compDraftDefinition_(row, mine, media), now);
  });

  return result;

}


/** One competition for the builder: everything, with the key. */
function apiComp(id) {

  assertAdmin_();

  var row = compFindComp_(id);
  var questionRows = compQuestionsOf_(id);
  var draft = compDraftDefinition_(row, questionRows);
  var comp = compParseComp_(row);
  var counts = compSubmissionCounts_();
  var now = compNow_();
  var card = null;

  if (comp.cardId) {
    var cardRow = readOptionalTable_('Activities').filter(function (r) { return r.id === comp.cardId; })[0];
    card = cardRow ? { id: cardRow.id, enabled: contentBool_(cardRow.enabled), title: cardRow.title } : null;
  }

  return {
    comp: compAdminComp_(row),
    questions: compSortQuestions_(questionRows.map(compParseQuestion_)).map(function (q) {
      return compAdminQuestion_(questionRows.filter(function (r) { return r.id === q.id; })[0], comp.scoring);
    }),
    summary: compSummary_(row, questionRows, counts, draft, now),
    problems: draft.problems,
    draftVersion: draft.version,
    liveVersion: comp.liveVersion,
    card: card,
    modules: compModules_(),
    limits: COMP_LIMITS,
    types: COMP_TYPE_LABELS,
    now: now.wall
  };

}


/** «مسابقة جديدة»: input { preset?, …fields } → apiComp of the new one. */
function apiCompCreate(input) {

  assertAdmin_();

  input = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

  var modules = compModules_();
  var preset = typeof input.preset === 'string' && Object.prototype.hasOwnProperty.call(COMP_PRESETS, input.preset) ? COMP_PRESETS[input.preset] : null;

  if (preset && preset.needs && !modules[preset.needs]) {
    throw appError_('النوع ده محتاج جزء لسه مش متفعّل.', 'فعّله من إعدادات المسابقات الأول، أو اختار نوع تاني.');
  }

  var merged = {};

  if (preset) {
    ['participation', 'scoring', 'resultShow', 'answersShow', 'wallet'].forEach(function (key) { merged[key] = preset[key]; });
  }

  Object.keys(input).forEach(function (key) {
    if (COMP_EDITABLE.indexOf(key) !== -1) merged[key] = input[key];
  });

  if (!compLine_(merged.slug)) merged.slug = 'comp-' + compRandomHex_(3);

  var id = compWrite_('create', function (email) {

    compSpreadsheet_(true);

    var t = compSheet_('Competitions');
    var slugs = compRows_(t).map(function (r) { return r.slug; });
    var checked = compValidateComp_(merged, { existing: null, modules: modules, slugs: slugs, mediaOk: compMediaOk_() });

    if (checked.problems.length) fail_(checked.problems);

    var now = compNow_();
    var record = checked.record;

    record.id = 'cmp-' + compRandomHex_(4);
    record.cardId = '';
    record.liveVersion = '';
    record.publishedAt = '';
    record.closedAt = '';
    record.finalizedAt = '';
    record.archived = '';
    record.createdBy = email;
    record.createdAt = now.stamp;
    record.updatedAt = now.stamp;

    compAppend_(t, [record]);

    activityNote_({ action: 'create', type: 'competition', id: record.id, title: record.title });

    return record.id;

  });

  return apiComp(id);

}


/**
 * Saves the builder's fields (anything left out keeps its value).
 * input.card: true = «اعرض كارت في قسم المسابقات» (creates / updates the
 * linked Activities card), false = hide it.
 */
function apiCompSave(id, input) {

  assertAdmin_();
  compValidId_(id, COMP_ID, 'معرّف المسابقة');

  input = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

  compWrite_('save', function () {

    assertUnlocked_('comp:' + id);

    var t = compSheet_('Competitions');
    var rows = compRows_(t);
    var row = rows.filter(function (r) { return r.id === id; })[0];

    if (!row) throw new Error('المسابقة مش موجودة');

    var fields = {};

    Object.keys(input).forEach(function (key) {
      if (COMP_EDITABLE.indexOf(key) !== -1) fields[key] = input[key];
    });

    var checked = compValidateComp_(fields, {
      existing: row,
      modules: compModules_(),
      slugs: rows.filter(function (r) { return r.id !== id; }).map(function (r) { return r.slug; }),
      mediaOk: compMediaOk_()
    });

    if (checked.problems.length) fail_(checked.problems);

    var record = checked.record;

    record.updatedAt = compNow_().stamp;

    if (input.card === true || input.card === false) {
      record.cardId = compSyncCard_(Object.assign({}, row, record), input.card === true);
    }

    compUpdate_(t, row.__row, record, row);

    activityNote_({ action: 'update', type: 'competition', id: id, title: record.title, changes: activityDiff_(compStrip_(row), record) });

    return id;

  });

  return apiComp(id);

}


/* the linked card (Activities, type competition): created / updated / hidden → its id */
function compSyncCard_(comp, wanted) {

  ensureTable_('Activities');

  var cardId = compLine_(comp.cardId);
  var exists = cardId ? !!findRow_('Activities', 'id', cardId) : false;

  if (!wanted) {
    if (exists) upsertRow_('Activities', 'id', { id: cardId, enabled: false, updatedAt: nowStamp_() });
    return exists ? cardId : '';
  }

  compEnsureCompetitionType_();

  var record = {
    id: exists ? cardId : 'act-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8),
    enabled: true,
    type: 'competition',
    title: compLine_(comp.title).slice(0, ACTIVITY_LIMITS.title),
    subtitle: compLine_(comp.description).slice(0, ACTIVITY_LIMITS.subtitle),
    image: compLine_(comp.banner),
    ctaLabel: compLine_(comp.ctaLabel).slice(0, ACTIVITY_LIMITS.cta),
    url: '',
    startAt: compLine_(comp.startAt),
    endAt: compLine_(comp.endAt),
    competition: comp.id,
    updatedAt: nowStamp_()
  };

  if (!exists) {
    record.order = nextOrder_(readOptionalTable_('Activities'), function () { return true; });
  }

  lazyColumns_('Activities', record);
  upsertRow_('Activities', 'id', record);

  return record.id;

}

/* the card's type exists (from the seed list) */
function compEnsureCompetitionType_() {

  ensureTable_('Types');

  if (findRow_('Types', 'key', 'competition')) return;

  var seed = SEED_TYPES.filter(function (t) { return t.key === 'competition'; })[0];

  upsertRow_('Types', 'key', {
    key: seed.key, enabled: true, label: seed.label, section: seed.section, icon: seed.icon, theme: seed.theme,
    banner: '', ctaDefault: seed.ctaDefault, notifyTemplate: seed.notifyTemplate,
    order: nextOrder_(readOptionalTable_('Types'), function () { return true; }), updatedAt: nowStamp_()
  });

}


/** «استخدم تاني»: a hidden copy with its questions → { id, comp } */
function apiCompDuplicate(id) {

  assertAdmin_();
  compValidId_(id, COMP_ID, 'معرّف المسابقة');

  var copyId = compWrite_('duplicate', function (email) {

    var t = compSheet_('Competitions');
    var rows = compRows_(t);
    var row = rows.filter(function (r) { return r.id === id; })[0];

    if (!row) throw new Error('المسابقة مش موجودة');

    var slugs = rows.map(function (r) { return r.slug; });
    var now = compNow_();
    var copy = compStrip_(row);
    var base = String(row.slug || 'comp').slice(0, 30).replace(/-+$/, '');
    var slug = '';

    do {
      slug = base + '-' + compRandomHex_(2);
    } while (slugs.indexOf(slug) !== -1);

    copy.id = 'cmp-' + compRandomHex_(4);
    copy.slug = slug;
    copy.title = (String(row.title || '').slice(0, 70) + ' (نسخة)').slice(0, COMP_LIMITS.title);
    copy.enabled = '';
    copy.cardId = '';
    copy.liveVersion = '';
    copy.publishedAt = '';
    copy.closedAt = '';
    copy.finalizedAt = '';
    copy.archived = '';
    copy.createdBy = email;
    copy.createdAt = now.stamp;
    copy.updatedAt = now.stamp;

    compAppend_(t, [copy]);

    var questions = compQuestionsOf_(id).map(function (q) {
      var c = compStrip_(q);
      c.id = 'q-' + compRandomHex_(4);
      c.compId = copy.id;
      c.updatedAt = now.stamp;
      return c;
    });

    compAppend_(compSheet_('Questions'), questions);

    activityNote_({ action: 'duplicate', type: 'competition', id: id, title: row.title, changes: { copy: copy.id } });

    return copy.id;

  });

  return { id: copyId, comp: apiComp(copyId) };

}


/** «أرشيف»: archived competitions leave the next publish (withdrawn) and the daily list. */
function apiCompArchive(id, archived) {

  assertAdmin_();
  compValidId_(id, COMP_ID, 'معرّف المسابقة');

  compWrite_('archive', function () {
    assertUnlocked_('comp:' + id);
    var row = compFindComp_(id);
    compUpdate_(compSheet_('Competitions'), row.__row, { archived: archived === true, updatedAt: compNow_().stamp }, row);
    activityNote_({ action: archived === true ? 'archive' : 'unarchive', type: 'competition', id: id, title: row.title });
    return id;
  });

  return apiComp(id);

}


/** Deletes a competition that never got a submission (its questions too; the card is unlinked and hidden). */
function apiCompDelete(id) {

  assertAdmin_();
  compValidId_(id, COMP_ID, 'معرّف المسابقة');

  compWrite_('delete', function () {

    assertUnlocked_('comp:' + id);

    var row = compFindComp_(id);
    var used = compColumns_(compSheet_('Submissions'), ['compId']).some(function (r) { return r.compId === id; });

    if (used) {
      throw appError_('المسابقة دي عليها مشاركات، ومينفعش تتمسح.', 'أرشفها بدل ما تمسحها: المشاركات والنتايج بتفضل محفوظة.');
    }

    var questions = compQuestionsOf_(id);

    compDeleteRows_(compSheet_('Questions'), questions.map(function (q) { return q.__row; }));
    compDeleteRows_(compSheet_('Competitions'), [row.__row]);

    if (row.cardId && spreadsheet_().getSheetByName('Activities') && findRow_('Activities', 'id', row.cardId)) {
      upsertRow_('Activities', 'id', { id: row.cardId, enabled: false, competition: '', updatedAt: nowStamp_() });
    }

    compDropLive_(row.slug);

    activityNote_({ action: 'delete', type: 'competition', id: id, title: row.title });

    return id;

  });

  return { deleted: true, id: id };

}


/** «اقفل دلوقتي» (honoured at once, before any publish); open === true takes it back. */
function apiCompClose(id, open) {

  assertAdmin_();
  compValidId_(id, COMP_ID, 'معرّف المسابقة');

  compWrite_('close', function () {
    var row = compFindComp_(id);
    var now = compNow_();
    compUpdate_(compSheet_('Competitions'), row.__row, { closedAt: open === true ? '' : now.stamp, updatedAt: now.stamp }, row);
    compDropLive_(row.slug);
    activityNote_({ action: 'close', type: 'competition', id: id, title: row.title, changes: open === true ? { reopen: true } : null });
    return id;
  });

  return apiComp(id);

}


/** «اعتماد النتائج» (final = true) or taking it back. */
function apiCompFinalize(id, final) {

  assertAdmin_();
  compValidId_(id, COMP_ID, 'معرّف المسابقة');

  compWrite_('finalize', function () {
    var row = compFindComp_(id);
    var now = compNow_();
    compUpdate_(compSheet_('Competitions'), row.__row, { finalizedAt: final === false ? '' : now.stamp, updatedAt: now.stamp }, row);
    compDropLive_(row.slug);
    activityNote_({ action: 'finalize', type: 'competition', id: id, title: row.title, changes: final === false ? { undo: true } : null });
    return id;
  });

  return apiComp(id);

}


/**
 * The module switches (§0): input { registry?, wallet?, shop? } booleans.
 * A module needs the one before it and its code installed. → { modules }
 */
function apiCompSettings(input) {

  assertAdmin_();

  input = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

  var props = PropertiesService.getScriptProperties();
  var now = {
    registry: String(props.getProperty('COMP_REGISTRY') || '') === '1',
    wallet: String(props.getProperty('COMP_WALLET') || '') === '1',
    shop: String(props.getProperty('COMP_SHOP') || '') === '1'
  };
  var next = {};
  var installed = { registry: typeof compRegistryReady_ === 'function', wallet: typeof compWalletReady_ === 'function', shop: typeof compShopReady_ === 'function' };
  var names = { registry: 'المشاركين بالأكواد', wallet: 'المحفظة والنقاط', shop: 'متجر الجوائز' };

  ['registry', 'wallet', 'shop'].forEach(function (key) {
    next[key] = typeof input[key] === 'boolean' ? input[key] : now[key];
    if (next[key] && !installed[key]) {
      throw appError_('«' + names[key] + '» لسه مش متركب في النسخة دي.', 'محتاج تحديث للوحة التحكم الأول.');
    }
  });

  // each one needs the one before it
  if (!next.registry) next.wallet = false;
  if (!next.wallet) next.shop = false;

  compWrite_('settings', function () {
    props.setProperties({ COMP_REGISTRY: next.registry ? '1' : '', COMP_WALLET: next.wallet ? '1' : '', COMP_SHOP: next.shop ? '1' : '' });
    var changed = Object.keys(next).filter(function (key) { return next[key] !== now[key]; });
    if (changed.length) {
      activityNote_({ action: 'settings', type: 'competition', id: 'modules', title: 'المسابقات', changes: { modules: changed.map(function (key) { return key + ':' + (next[key] ? 'on' : 'off'); }) } });
    }
    return changed.join(',');
  });

  return { modules: compModules_() };

}


/* =========================================================
   QUESTIONS
========================================================= */

/* the order column rewritten for one competition (one read of two columns, one write) */
function compRenumber_(t, compId, orderedIds) {

  var last = t.sheet.getLastRow();

  if (last < 2) return;

  var ids = t.sheet.getRange(2, t.index.id, last - 1, 1).getValues().map(function (r) { return compCellIn_(r[0]); });
  var orders = t.sheet.getRange(2, t.index.order, last - 1, 1).getValues().map(function (r) { return compCellIn_(r[0]); });

  orderedIds.forEach(function (qid, i) {
    var at = ids.indexOf(qid);
    if (at !== -1) orders[at] = String((i + 1) * 10);
  });

  compWriteColumn_(t, 'order', orders);

}

/* the comp's questions in order, as the editor shows them */
function compQuestionList_(compId, scoring) {

  var rows = compQuestionsOf_(compId);

  return compSortQuestions_(rows.map(compParseQuestion_)).map(function (q) {
    return compAdminQuestion_(rows.filter(function (r) { return r.id === q.id; })[0], scoring);
  });

}


/**
 * Saves one question (new without input.id). The editor sends the whole
 * question (compValidateQuestion_). → { question, warnings, count }
 */
function apiCompQuestionSave(compId, input) {

  assertAdmin_();
  compValidId_(compId, COMP_ID, 'معرّف المسابقة');

  input = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

  var saved = compWrite_('question.save', function () {

    assertUnlocked_('comp:' + compId);

    var comp = compFindComp_(compId);
    var t = compSheet_('Questions');
    var mine = compRows_(t).filter(function (r) { return r.compId === compId; });
    var existingId = compLine_(input.id);
    var existing = existingId ? mine.filter(function (r) { return r.id === existingId; })[0] : null;

    if (existingId && !existing) throw new Error('السؤال مش موجود');

    if (!existing && mine.length >= COMP_LIMITS.questions) {
      throw appError_('وصلت لأقصى عدد أسئلة (' + compArabicDigits_(COMP_LIMITS.questions) + ').', 'قسّم المسابقة لمسابقتين.');
    }

    var checked = compValidateQuestion_(input, { existing: existing, mediaOk: compMediaOk_(), newChoiceId: function () { return 'c-' + compRandomHex_(3); } });

    if (checked.problems.length) fail_(checked.problems);

    var now = compNow_();
    var record = checked.record;
    var id;

    record.updatedAt = now.stamp;

    if (existing) {
      id = existing.id;
      compUpdate_(t, existing.__row, record, existing);
    }
    else {
      var max = mine.reduce(function (m, r) { var o = Number(r.order) || 0; return o > m ? o : m; }, 0);
      var order = contentNumber_(input.order);
      id = 'q-' + compRandomHex_(4);
      record.id = id;
      record.compId = compId;
      record.order = String(order !== null && !isNaN(order) && order >= 0 ? order : max + 10);
      compAppend_(t, [record]);
    }

    compUpdate_(compSheet_('Competitions'), comp.__row, { updatedAt: now.stamp }, comp);
    activityNote_({ action: 'update', type: 'competition', id: compId, title: comp.title, changes: { fields: ['الأسئلة'] } });

    return { id: id, warnings: checked.warnings, scoring: compFlag_(comp.scoring) === '1', count: mine.length + (existing ? 0 : 1) };

  });

  var row = compQuestionsOf_(compId).filter(function (r) { return r.id === saved.id; })[0];

  return { question: compAdminQuestion_(row, saved.scoring), warnings: saved.warnings, count: saved.count };

}


/** A copy right after the original. → { question, questions } */
function apiCompQuestionDuplicate(compId, qid) {

  assertAdmin_();
  compValidId_(compId, COMP_ID, 'معرّف المسابقة');
  compValidId_(qid, COMP_QID, 'معرّف السؤال');

  var result = compWrite_('question.duplicate', function () {

    assertUnlocked_('comp:' + compId);

    var comp = compFindComp_(compId);
    var t = compSheet_('Questions');
    var mine = compRows_(t).filter(function (r) { return r.compId === compId; });
    var original = mine.filter(function (r) { return r.id === qid; })[0];

    if (!original) throw new Error('السؤال مش موجود');
    if (mine.length >= COMP_LIMITS.questions) throw appError_('وصلت لأقصى عدد أسئلة.', 'قسّم المسابقة لمسابقتين.');

    var now = compNow_();
    var copy = compStrip_(original);

    copy.id = 'q-' + compRandomHex_(4);
    copy.updatedAt = now.stamp;
    compAppend_(t, [copy]);

    var ordered = compSortQuestions_(mine.map(compParseQuestion_)).map(function (q) { return q.id; });
    ordered.splice(ordered.indexOf(qid) + 1, 0, copy.id);
    compRenumber_(t, compId, ordered);

    activityNote_({ action: 'update', type: 'competition', id: compId, title: comp.title, changes: { fields: ['الأسئلة'] } });

    return { id: copy.id, scoring: compFlag_(comp.scoring) === '1' };

  });

  var questions = compQuestionList_(compId, result.scoring);

  return { question: questions.filter(function (q) { return q.id === result.id; })[0], questions: questions };

}


/** → { deleted, count } */
function apiCompQuestionDelete(compId, qid) {

  assertAdmin_();
  compValidId_(compId, COMP_ID, 'معرّف المسابقة');
  compValidId_(qid, COMP_QID, 'معرّف السؤال');

  return compWrite_('question.delete', function () {

    assertUnlocked_('comp:' + compId);

    var comp = compFindComp_(compId);
    var t = compSheet_('Questions');
    var mine = compRows_(t).filter(function (r) { return r.compId === compId; });
    var row = mine.filter(function (r) { return r.id === qid; })[0];

    if (!row) throw new Error('السؤال مش موجود');

    compDeleteRows_(t, [row.__row]);
    activityNote_({ action: 'update', type: 'competition', id: compId, title: comp.title, changes: { fields: ['الأسئلة'] } });

    return { deleted: true, count: mine.length - 1 };

  });

}


/** ids: every question of the competition, in the new order. → { questions } */
function apiCompQuestionsReorder(compId, ids) {

  assertAdmin_();
  compValidId_(compId, COMP_ID, 'معرّف المسابقة');

  if (!Array.isArray(ids) || ids.length > COMP_LIMITS.questions || ids.some(function (id) { return typeof id !== 'string' || !COMP_QID.test(id); })) {
    throw new Error('الترتيب مش مفهوم');
  }

  var scoring = compWrite_('question.reorder', function () {

    assertUnlocked_('comp:' + compId);

    var comp = compFindComp_(compId);
    var t = compSheet_('Questions');
    var mine = compRows_(t).filter(function (r) { return r.compId === compId; }).map(function (r) { return r.id; });
    var same = ids.length === mine.length && ids.every(function (id) { return mine.indexOf(id) !== -1; }) &&
      ids.filter(function (id, i) { return ids.indexOf(id) === i; }).length === ids.length;

    if (!same) {
      throw appError_('الأسئلة اتغيرت من بعد ما فتحتها.', 'اعمل Refresh وجرّب تاني.');
    }

    compRenumber_(t, compId, ids);
    activityNote_({ action: 'reorder', type: 'competition', id: compId, title: comp.title });

    return compFlag_(comp.scoring) === '1';

  });

  return { questions: compQuestionList_(compId, scoring) };

}


/* =========================================================
   QUESTION IMPORT (TSV / CSV text from the browser; same flow as Import.gs)
========================================================= */

var COMP_IMPORT_COLUMNS = [
  { key: 'order', names: ['order', 'ترتيب', 'الترتيب', 'م', 'رقم'] },
  { key: 'text', names: ['question', 'text', 'السؤال', 'سؤال', 'نص السؤال'] },
  { key: 'type', names: ['type', 'النوع', 'نوع', 'نوع السؤال'] },
  { key: 'correct', names: ['correct', 'answer', 'الإجابة الصحيحة', 'الاجابة الصحيحة', 'الإجابة', 'الاجابة', 'الصح'] },
  { key: 'points', names: ['points', 'score', 'الدرجة', 'درجة', 'النقط', 'النقاط'] },
  { key: 'required', names: ['required', 'إجباري', 'اجباري', 'مطلوب'] },
  { key: 'explanation', names: ['explanation', 'التوضيح', 'توضيح', 'الشرح', 'شرح'] },
  { key: 'image', names: ['image', 'صورة', 'الصورة'] },
  { key: 'review', names: ['review', 'مراجعة', 'المراجعة'] }
];

var COMP_IMPORT_TYPES = {
  single: ['single', 'اختيار واحد', 'اختيار'],
  multi: ['multi', 'multiple', 'اختيارات متعددة', 'اختيارات متعدده', 'اختيارات'],
  truefalse: ['truefalse', 'true/false', 'tf', 'صح وغلط', 'صح و غلط', 'صح او غلط', 'صح أو غلط'],
  short: ['short', 'إجابة قصيرة', 'اجابة قصيرة', 'قصيرة'],
  long: ['long', 'إجابة مفتوحة', 'اجابة مفتوحة', 'مفتوحة', 'مقالي'],
  number: ['number', 'رقم', 'عدد'],
  info: ['info', 'فقرة', 'معلومة']
};

var COMP_IMPORT_LABELS = { order: 'ترتيب', text: 'السؤال', type: 'النوع', correct: 'الإجابة الصحيحة', points: 'الدرجة', required: 'إجباري', explanation: 'التوضيح', image: 'صورة', review: 'مراجعة' };

/* a header cell → a column key ('choice3' for «اختيار ٣»), '' when unknown */
function compImportColumnOf_(cell) {

  var word = importWord_(contentDigits_(cell));

  if (!word) return '';

  var choice = /^(?:choice|option|اختيار|الاختيار)([1-8])$/.exec(word);

  if (choice) return 'choice' + choice[1];

  for (var i = 0; i < COMP_IMPORT_COLUMNS.length; i++) {
    if (COMP_IMPORT_COLUMNS[i].names.map(importWord_).indexOf(word) !== -1) return COMP_IMPORT_COLUMNS[i].key;
  }

  return '';

}

function compImportType_(value) {

  var word = compNormalizeText_(value).replace(/\s+/g, ' ');

  if (!word) return '';

  var keys = Object.keys(COMP_IMPORT_TYPES);

  for (var i = 0; i < keys.length; i++) {
    if (COMP_IMPORT_TYPES[keys[i]].map(compNormalizeText_).indexOf(word) !== -1) return keys[i];
  }

  return null;

}

/**
 * The text → rows checked against the competition (no writes).
 * ctx = { scoring, existingTexts: { normalized text: true }, existingCount, maxOrder, mediaOk }
 * → { columns, ignored, problems, rows: [{ line, status, errors, warnings, fp, input, preview }] }
 */
function compParseImport_(text, ctx) {

  var out = { columns: [], ignored: [], problems: [], rows: [] };

  if (String(text || '').length > COMP_IMPORT_MAX_TEXT) {
    out.problems.push('الملف كبير قوي (الحد ٤٠٠ كيلوبايت). قسّمه لأكتر من مرة.');
    return out;
  }

  var table = importCells_(text);

  if (!table.lines.length) {
    out.problems.push('مفيش صفوف. الصق الصفوف من إكسل أو جوجل شيت، أو اختار ملف.');
    return out;
  }

  var header = table.lines[0].cells.map(compImportColumnOf_);

  if (header.indexOf('text') === -1) {
    out.problems.push('أول صف لازم يكون العناوين وفيهم «السؤال». نزّل النموذج وامشي عليه.');
    return out;
  }

  table.lines[0].cells.forEach(function (cell, i) {
    if (!header[i] && contentLine_(cell)) out.ignored.push(contentLine_(cell));
  });

  var columns = header.map(function (key, i) { return key && header.indexOf(key) === i ? key : ''; });
  var body = table.lines.slice(1);

  out.columns = columns.filter(Boolean);

  if (body.length > COMP_IMPORT_MAX_ROWS) {
    out.problems.push('الملف فيه ' + compArabicDigits_(body.length) + ' صف، والحد ' + compArabicDigits_(COMP_IMPORT_MAX_ROWS) + ' في المرة.');
    body = body.slice(0, COMP_IMPORT_MAX_ROWS);
  }

  var seenTexts = Object.create(null);
  var room = COMP_LIMITS.questions - (ctx.existingCount || 0);
  var nth = compArabicDigits_;
  var counter = 0;

  out.rows = body.map(function (entry) {

    var raw = {};
    columns.forEach(function (key, i) { if (key) raw[key] = entry.cells[i] === undefined ? '' : String(entry.cells[i]); });

    var line = entry.line;
    var row = { line: line, status: 'ok', errors: [], warnings: [], fp: '', input: null, preview: null };
    var error = function (column, message) { row.errors.push('صف ' + nth(line) + (column ? '، ' + COMP_IMPORT_LABELS[column] : '') + ': ' + message); };
    var warn = function (column, message) { row.warnings.push('صف ' + nth(line) + (column ? '، ' + COMP_IMPORT_LABELS[column] : '') + ': ' + message); };

    var choices = [];
    for (var c = 1; c <= 8; c++) {
      var choiceText = contentLine_(raw['choice' + c]);
      if (choiceText) choices.push(choiceText);
    }

    var questionText = contentText_(raw.text);
    var typeText = contentLine_(raw.type);
    var type = compImportType_(typeText);

    if (type === '') type = choices.length >= 2 ? 'single' : null;

    if (!questionText) error('text', 'نص السؤال ناقص');

    if (type === null) {
      error('type', typeText ? '«' + typeText + '» مش نوع معروف (اختيار واحد، اختيارات متعددة، صح وغلط، إجابة قصيرة، إجابة مفتوحة، رقم، فقرة)' : 'النوع ناقص');
      type = 'single';
    }

    if ((type === 'single' || type === 'multi') && choices.length < 2) error('', 'الاختيارات: لازم اختيارين على الأقل');

    /* the key, by column */
    var correctText = contentLine_(raw.correct);
    var correct = null;

    if (type === 'single' || type === 'multi') {

      var byText = function (value) {
        var key = compNormalizeText_(value);
        for (var k = 0; k < choices.length; k++) if (compNormalizeText_(choices[k]) === key) return k;
        return -1;
      };

      var picks = [];

      if (correctText) {
        var whole = byText(correctText);
        var parts = whole !== -1 ? [correctText] : correctText.split(/[،,]/).map(contentLine_).filter(Boolean);
        parts.forEach(function (part) {
          var digits = contentDigits_(part);
          var index = /^\d+$/.test(digits) ? Number(digits) - 1 : byText(part);
          if (/^\d+$/.test(digits) && (index < 0 || index >= choices.length)) index = -1;
          if (index === -1) error('correct', '«' + part + '» مش من الاختيارات');
          else if (picks.indexOf(index) === -1) picks.push(index);
        });
      }

      if (type === 'single' && picks.length > 1) error('correct', 'السؤال «اختيار واحد»: اكتب إجابة صحيحة واحدة بس');
      if (ctx.scoring && !correctText) error('correct', type === 'multi' ? 'اكتب الاختيارات الصحيحة' : 'الإجابة الصحيحة ناقصة');

      correct = type === 'single' ? (picks.length ? picks[0] : null) : picks;

    }
    else if (type === 'truefalse') {
      var tf = compNormalizeText_(correctText);
      correct = ['صح', 'صحيح', 'true', 't', 'نعم', '1'].indexOf(tf) !== -1 ? 't' : ['غلط', 'خطا', 'false', 'f', 'لا', '0'].indexOf(tf) !== -1 ? 'f' : null;
      if (correctText && !correct) error('correct', '«' + correctText + '» لازم تكون صح أو غلط');
      if (ctx.scoring && !correctText) error('correct', 'الإجابة الصحيحة ناقصة (صح ولا غلط؟)');
    }
    else if (type === 'short') {
      correct = correctText ? correctText.split('|').map(contentLine_).filter(Boolean) : [];
    }
    else if (type === 'number') {
      correct = correctText ? compNumberText_(correctText) : '';
      if (correctText && !correct) error('correct', '«' + correctText + '» مش رقم');
      if (ctx.scoring && !correctText) error('correct', 'الإجابة الصحيحة ناقصة');
    }

    /* points, required, image, review */
    var pointsText = contentLine_(raw.points);
    var points = pointsText === '' ? COMP_DEFAULT_POINTS : compInt_(pointsText, 0, COMP_LIMITS.points, COMP_DEFAULT_POINTS);

    if (isNaN(points)) {
      error('points', '«' + pointsText + '» لازم يكون رقم صحيح من ٠ لـ ' + nth(COMP_LIMITS.points));
      points = 0;
    }

    var requiredText = compNormalizeText_(raw.required);
    var required = requiredText === '' || ['نعم', 'اه', 'ايوه', 'yes', 'y', '1', 'true', 'اجباري'].indexOf(requiredText) !== -1 ? true
      : ['لا', 'no', 'n', '0', 'false', 'اختياري'].indexOf(requiredText) !== -1 ? false : null;

    if (required === null) {
      error('required', '«' + contentLine_(raw.required) + '» لازم تكون نعم أو لا');
      required = true;
    }

    var image = contentLine_(raw.image);

    if (image && (!/^img-[a-z0-9]{8}$/.test(image) || !ctx.mediaOk(image))) error('image', '«' + image + '» مش موجودة في المكتبة');

    var reviewText = compNormalizeText_(raw.review);
    var review = 'auto';

    if (['يدوي', 'manual', 'مراجعه يدويه'].indexOf(reviewText) !== -1) review = 'manual';
    else if (['مراجعه لو مش مطابق', 'fallback', 'لو مش مطابق'].indexOf(reviewText) !== -1) review = 'fallback';
    else if (reviewText && ['تلقائي', 'auto'].indexOf(reviewText) === -1) error('review', '«' + contentLine_(raw.review) + '» مش معروفة (فاضي = تلقائي، يدوي، مراجعة لو مش مطابق)');

    if (review !== 'auto' && type !== 'short') {
      if (type !== 'long') warn('review', 'المراجعة بتنفع مع «إجابة قصيرة» بس، هتتجاهل');
      review = 'auto';
    }

    /* warnings */
    if (type === 'short' && ctx.scoring && review === 'auto' && !(correct && correct.length)) {
      warn('correct', 'مفيش إجابات مقبولة والمراجعة تلقائي: كل الإجابات هتتحسب غلط');
    }

    if (ctx.scoring && type !== 'info' && points === 0) warn('points', 'الدرجة صفر');

    var textKey = compNormalizeText_(questionText);

    if (textKey && (seenTexts[textKey] || (ctx.existingTexts && ctx.existingTexts[textKey]))) warn('text', 'السؤال ده متكرر');
    if (textKey) seenTexts[textKey] = true;

    /* order */
    var orderText = contentDigits_(raw.order);
    var order = orderText === '' ? null : Number(orderText);

    if (order !== null && !(isFinite(order) && order >= 0)) {
      error('order', '«' + contentLine_(raw.order) + '» لازم يكون رقم');
      order = null;
    }

    /* the editor's own validation, on the question as it would be saved */
    var input = {
      type: type,
      text: questionText,
      choices: choices.map(function (t) { return { text: t }; }),
      correct: correct,
      points: points,
      required: required,
      explanation: raw.explanation === undefined ? '' : contentText_(raw.explanation),
      media: image,
      review: review,
      enabled: true
    };

    if (!row.errors.length) {
      var checked = compValidateQuestion_(input, { mediaOk: ctx.mediaOk, newChoiceId: compCounterIds_('c-', 6) });
      checked.problems.forEach(function (p) { error('', p); });
    }

    if (!row.errors.length) {
      counter++;
      if (counter > room) error('', 'المسابقة هتعدّي ' + nth(COMP_LIMITS.questions) + ' سؤال');
    }

    row.status = row.errors.length ? 'error' : 'ok';
    row.input = input;
    row.order = order;
    row.fp = sha256Hex_(JSON.stringify([order, input])).slice(0, 16);
    row.preview = {
      order: order,
      type: type,
      typeLabel: COMP_TYPE_LABELS[type],
      text: questionText,
      choices: choices,
      correct: type === 'single' ? (correct === null ? '' : choices[correct] || '')
        : type === 'multi' ? (correct || []).map(function (i) { return choices[i]; })
          : type === 'truefalse' ? (correct === 't' ? 'صح' : correct === 'f' ? 'غلط' : '')
            : type === 'short' ? correct : type === 'number' ? correct : '',
      points: type === 'info' ? 0 : points,
      required: type !== 'info' && required,
      review: review,
      image: image,
      explanation: input.explanation
    };

    return row;

  });

  return out;

}

/* what the import is checked against */
function compImportContext_(comp) {

  var mine = compQuestionsOf_(comp.id);
  var texts = Object.create(null);

  mine.forEach(function (q) { texts[compNormalizeText_(q.text)] = true; });

  return {
    scoring: compFlag_(comp.scoring) === '1',
    existingTexts: texts,
    existingCount: mine.length,
    maxOrder: mine.reduce(function (m, q) { var o = Number(q.order) || 0; return o > m ? o : m; }, 0),
    mediaOk: compMediaOk_()
  };

}


/**
 * Read-only: what importing this text would add.
 * → { rows: [{ line, status: 'ok' | 'error', errors, warnings, fp, question }], counts, problems,
 *     columns, ignored, fingerprint, max }
 */
function apiCompImportPreview(compId, text) {

  assertAdmin_();

  var comp = compFindComp_(compId);
  var parsed = compParseImport_(text, compImportContext_(comp));
  var counts = { ok: 0, error: 0, warnings: 0 };

  parsed.rows.forEach(function (row) {
    counts[row.status]++;
    if (row.warnings.length) counts.warnings++;
  });

  return {
    rows: parsed.rows.map(function (row) {
      return { line: row.line, status: row.status, errors: row.errors, warnings: row.warnings, fp: row.fp, question: row.preview };
    }),
    counts: counts,
    problems: parsed.problems,
    columns: parsed.columns,
    ignored: parsed.ignored,
    fingerprint: sha256Hex_(parsed.rows.map(function (r) { return r.fp; }).join(',')).slice(0, 16),
    max: COMP_IMPORT_MAX_ROWS
  };

}


/**
 * decisions: { 'r<line>': 'add:<fp>' } — the rows the admin ticked. The text
 * is parsed again under the script lock; a row is added only when it is
 * still valid and its fingerprint still matches. All new questions in ONE
 * block. → { added, skipped, errors, rows: [{ line, result, reason }], count }
 */
function apiCompImportApply(compId, text, decisions) {

  assertAdmin_();
  compValidId_(compId, COMP_ID, 'معرّف المسابقة');

  decisions = decisions && typeof decisions === 'object' && !Array.isArray(decisions) ? decisions : {};

  return compWrite_('import', function () {

    assertUnlocked_('comp:' + compId);

    var comp = compFindComp_(compId);
    var ctx = compImportContext_(comp);
    var parsed = compParseImport_(text, ctx);
    var report = { added: 0, skipped: 0, errors: 0, rows: [], count: ctx.existingCount };
    var records = [];
    var now = compNow_();
    var next = ctx.maxOrder;

    if (parsed.problems.length && !parsed.rows.length) {
      throw appError_(parsed.problems[0], '');
    }

    parsed.rows.forEach(function (row) {

      var wanted = Object.prototype.hasOwnProperty.call(decisions, 'r' + row.line) ? String(decisions['r' + row.line]) : '';

      if (row.status === 'error') {
        report.errors++;
        report.rows.push({ line: row.line, result: 'error', reason: row.errors.join('، ') });
        return;
      }

      if (wanted !== 'add:' + row.fp) {
        report.skipped++;
        report.rows.push({ line: row.line, result: 'skipped', reason: wanted ? 'الصف اتغير من بعد المعاينة' : 'مش متعلّم عليه' });
        return;
      }

      var checked = compValidateQuestion_(row.input, { mediaOk: ctx.mediaOk, newChoiceId: function () { return 'c-' + compRandomHex_(3); } });
      var record = checked.record;

      next = row.order !== null ? next : next + 10;
      record.id = 'q-' + compRandomHex_(4);
      record.compId = compId;
      record.order = String(row.order !== null ? row.order : next);
      record.updatedAt = now.stamp;
      records.push(record);
      report.rows.push({ line: row.line, result: 'added', reason: '' });

    });

    compAppend_(compSheet_('Questions'), records);

    report.added = records.length;
    report.count = ctx.existingCount + records.length;

    if (records.length) {
      compUpdate_(compSheet_('Competitions'), comp.__row, { updatedAt: now.stamp }, comp);
      activityNote_({ action: 'import', type: 'competition', id: compId, title: comp.title, changes: { added: records.length } });
    }

    return report;

  });

}


/* =========================================================
   PREVIEW (draft key; writes nothing)
========================================================= */

/** Grades answers against the DRAFT key: { problems, score, …, status, grading, review } */
function apiCompPreviewGrade(compId, answers) {

  assertAdmin_();

  var row = compFindComp_(compId);
  var draft = compDraftDefinition_(row, compQuestionsOf_(compId));
  var def = draft.def;
  var qids = def.questions.map(function (q) { return q.id; });
  var checked = compValidateAnswers_(def, qids, answers);
  var graded = compGrade_(def, checked.answers, { qids: qids, at: compNow_().stamp });

  return {
    problems: checked.problems,
    score: graded.score,
    maxScore: graded.maxScore,
    correctCount: graded.correctCount,
    gradableCount: graded.gradableCount,
    pendingCount: graded.pendingCount,
    status: graded.status,
    grading: graded.grading,
    review: def.questions.filter(function (q) { return q.type !== 'info'; }).map(function (q) {
      var g = graded.grading[q.id] || {};
      return { id: q.id, correct: q.correct, explanation: q.explanation, explanationMedia: q.explanationMedia, answer: checked.answers[q.id] === undefined ? null : checked.answers[q.id], ok: g.ok === undefined ? null : g.ok, pts: Number(g.pts) || 0 };
    })
  };

}


/** The draft as the public page would get it (comp.json + the questions WITHOUT the key) for the preview frame. */
function apiCompPreviewDefinition(compId) {

  assertAdmin_();

  var row = compFindComp_(compId);
  var draft = compDraftDefinition_(row, compQuestionsOf_(compId));
  var def = draft.def;

  return {
    comp: compPublicDef_(def, draft.version, ''),
    questions: def.questions.map(function (q) { return compPublicQuestion_(q, def.showPoints, null); }),
    v: draft.version,
    problems: draft.problems,
    status: compStatus_(draft.comp, null, compNow_().wall)
  };

}


/* =========================================================
   SUBMISSIONS
========================================================= */

var COMP_LIST_COLUMNS = ['id', 'compId', 'version', 'attemptNo', 'participantId', 'name', 'phone', 'fields', 'status', 'startedAt',
  'submittedAt', 'submittedMs', 'durationSec', 'score', 'maxScore', 'correctCount', 'gradableCount', 'pendingCount', 'flags', 'reviewedBy'];

function compListItem_(row) {

  return {
    id: row.id,
    version: row.version,
    attemptNo: Number(row.attemptNo) || 1,
    participantId: row.participantId,
    name: row.name,
    phone: row.phone,
    fields: compJson_(row.fields, {}) || {},
    status: row.status,
    startedAt: row.startedAt,
    submittedAt: row.submittedAt,
    durationSec: row.durationSec === '' ? null : Number(row.durationSec),
    score: Number(row.score) || 0,
    maxScore: Number(row.maxScore) || 0,
    correctCount: Number(row.correctCount) || 0,
    gradableCount: Number(row.gradableCount) || 0,
    pendingCount: Number(row.pendingCount) || 0,
    flags: String(row.flags || '').split(',').filter(Boolean),
    reviewedBy: row.reviewedBy || ''
  };

}

/**
 * query: { status: 'all' | 'done' | <status>, q (name / phone / id), flag, sort: 'submittedAt' | 'score' |
 *          'duration' | 'name', dir: 'asc' | 'desc', offset, limit }
 * → { items, total, offset, limit, counts: { status: n } }
 */
function apiCompSubmissions(compId, query) {

  assertAdmin_();

  var comp = compFindComp_(compId);

  query = query && typeof query === 'object' && !Array.isArray(query) ? query : {};

  var limit = Math.max(1, Math.min(COMP_PAGE_MAX, Math.floor(Number(query.limit)) || COMP_PAGE));
  var offset = Math.max(0, Math.floor(Number(query.offset)) || 0);
  var status = typeof query.status === 'string' ? query.status : 'all';
  var search = compNormalizeText_(typeof query.q === 'string' ? query.q.slice(0, 60) : '');
  var digits = search.replace(/\D/g, '');
  var flag = typeof query.flag === 'string' ? query.flag : '';
  var counts = { all: 0, done: 0, in_progress: 0, submitted: 0, pending_review: 0, graded: 0, void: 0 };

  var rows = compColumns_(compSheet_('Submissions'), COMP_LIST_COLUMNS).filter(function (r) { return r.compId === comp.id; });

  rows.forEach(function (r) {
    counts.all++;
    if (counts[r.status] !== undefined) counts[r.status]++;
    if (COMP_SUBMITTED.indexOf(r.status) !== -1) counts.done++;
  });

  var found = rows.filter(function (r) {
    if (status === 'done' && COMP_SUBMITTED.indexOf(r.status) === -1) return false;
    if (status !== 'all' && status !== 'done' && r.status !== status) return false;
    if (flag && String(r.flags || '').split(',').indexOf(flag) === -1) return false;
    if (search) {
      var inName = compNormalizeText_(r.name).indexOf(search) !== -1;
      var inPhone = digits.length >= 3 && String(r.phone).replace(/\D/g, '').indexOf(digits.replace(/^0/, '')) !== -1;
      if (!inName && !inPhone && r.id !== search) return false;
    }
    return true;
  });

  var dir = query.dir === 'asc' ? 1 : -1;
  var key = { score: function (r) { return Number(r.score) || 0; }, duration: function (r) { return Number(r.durationSec) || 0; }, name: function (r) { return compNormalizeText_(r.name); } }[query.sort] ||
    function (r) { return Number(r.submittedMs) || 0; };

  found.sort(function (a, b) { var x = key(a); var y = key(b); return x === y ? a.__row - b.__row : (x < y ? -dir : dir); });

  return {
    items: found.slice(offset, offset + limit).map(compListItem_),
    total: found.length,
    offset: offset,
    limit: limit,
    counts: counts
  };

}


/* the questions of a submission as the person saw them, next to their answers and marks */
function compSubmissionQuestions_(def, row) {

  var answers = compJson_(row.answers, {}) || {};
  var grading = compJson_(row.grading, {}) || {};
  var byId = Object.create(null);

  def.questions.forEach(function (q) { byId[q.id] = q; });

  return (compJson_(row.qids, []) || []).map(function (qid) { return byId[qid]; }).filter(Boolean).map(function (q, i) {
    var order = compChoiceOrder_(def, q, row.seed);
    var choices = order ? order.map(function (id) { return q.choices.filter(function (c) { return c.id === id; })[0]; }).filter(Boolean) : q.choices;
    var answer = answers[q.id] === undefined ? null : answers[q.id];
    var label = function (id) { var c = q.choices.filter(function (x) { return x.id === id; })[0]; return c ? c.text : ''; };
    var text = answer === null ? '' : q.type === 'single' ? label(answer) : q.type === 'multi' ? answer.map(label).join('، ')
      : q.type === 'truefalse' ? (answer === 't' ? 'صح' : 'غلط') : String(answer);
    return {
      number: i + 1, id: q.id, type: q.type, text: q.text, help: q.help, media: q.media, choices: choices, correct: q.correct,
      points: q.points, explanation: q.explanation, review: q.review, answer: answer, answerText: text,
      key: compAnswerKey_(q, answer), grade: grading[q.id] || null
    };
  });

}


/** One submission with the snapshot version the person was served. */
function apiCompSubmission(id) {

  assertAdmin_();
  compValidId_(id, COMP_SUBMISSION_ID, 'معرّف المشاركة');

  if (!compSpreadsheet_(false)) throw new Error('المشاركة مش موجودة');

  var t = compSheet_('Submissions');
  var rowNumber = compFindRow_(t, 'id', id);
  var row = rowNumber ? compRowAt_(t, rowNumber) : null;

  if (!row) throw new Error('المشاركة مش موجودة');

  var comp = compFindComp_(row.compId);
  var def = compDefinitionFor_(row.compId, row.version);

  if (!def) throw appError_('النسخة اللي اتحلت من المسابقة مش لاقيينها.', 'ده مش طبيعي: كلّم المسؤول عن الموقع.');

  return {
    submission: compListItem_(row),
    comp: { id: comp.id, title: comp.title, slug: comp.slug, scoring: compFlag_(comp.scoring) === '1', liveVersion: comp.liveVersion },
    version: row.version,
    latest: row.version === comp.liveVersion,
    questions: compSubmissionQuestions_(def, row)
  };

}


/* a grading result written back to its row */
function compGradeWrite_(t, rowNumber, totals, email, current, now) {

  compUpdate_(t, rowNumber, {
    status: totals.status,
    score: String(totals.score),
    maxScore: String(totals.maxScore),
    correctCount: String(totals.correctCount),
    gradableCount: String(totals.gradableCount),
    pendingCount: String(totals.pendingCount),
    grading: totals.grading,
    reviewedBy: email,
    updatedAt: now.stamp
  }, current);

}

/* the question's number in a competition's live order («س٧») */
function compQuestionNumber_(def, qid) {

  var at = def.questions.map(function (q) { return q.id; }).indexOf(qid);

  return at === -1 ? '' : 'س' + compArabicDigits_(at + 1);

}


/**
 * A reviewer's marks on one submission: grades { qid: true | false | points | null }.
 * → apiCompSubmission(id)
 */
function apiCompGrade(submissionId, grades) {

  assertAdmin_();
  compValidId_(submissionId, COMP_SUBMISSION_ID, 'معرّف المشاركة');

  if (!grades || typeof grades !== 'object' || Array.isArray(grades) || !Object.keys(grades).length || Object.keys(grades).length > COMP_LIMITS.questions) {
    throw new Error('التصحيح مش مفهوم');
  }

  compLiveWrite_('grade', function (email) {

    var t = compSheet_('Submissions');
    var rowNumber = compFindRow_(t, 'id', submissionId);
    var row = rowNumber ? compRowAt_(t, rowNumber) : null;

    if (!row) throw new Error('المشاركة مش موجودة');
    if (COMP_SUBMITTED.indexOf(row.status) === -1) throw appError_(row.status === 'void' ? 'المشاركة دي ملغية.' : 'المشاركة دي لسه متبعتتش.', 'رجّعها الأول لو عايز تصححها.');

    var def = compDefinitionFor_(row.compId, row.version);
    var qids = compJson_(row.qids, []) || [];
    var now = compNow_();
    var totals = { grading: compJson_(row.grading, {}) || {} };

    if (!def) throw new Error('النسخة اللي اتحلت مش لاقيينها');

    Object.keys(grades).forEach(function (qid) {
      var value = grades[qid];
      if (qids.indexOf(qid) === -1 || !(value === null || typeof value === 'boolean' || (typeof value === 'number' && isFinite(value)))) {
        throw new Error('التصحيح مش مفهوم');
      }
      var next = compApplyManual_(totals.grading, qid, value, email, def, now.stamp);
      if (!next) throw new Error('السؤال ده مبيتصححش');
      totals = next;
    });

    totals = compTotals_(def, totals.grading, qids);
    compGradeWrite_(t, rowNumber, totals, email, row, now);

    var comp = compFindComp_(row.compId);
    activityNote_({ action: 'review', type: 'competition', id: row.compId, title: comp.title, changes: { answers: Object.keys(grades).length } });

    return submissionId;

  });

  compAfterGrade_(submissionId);

  return apiCompSubmission(submissionId);

}


/**
 * One mark for every submission whose answer to qid is the same (normalized):
 * normAnswer is the group's `key` from apiCompReviewQueue. → { updated, queue }
 */
function apiCompGradeGroup(compId, qid, normAnswer, pts) {

  assertAdmin_();
  compValidId_(compId, COMP_ID, 'معرّف المسابقة');
  compValidId_(qid, COMP_QID, 'معرّف السؤال');

  if (typeof normAnswer !== 'string' || normAnswer.length > COMP_ANSWER_LIMITS.long || !(pts === null || typeof pts === 'boolean' || (typeof pts === 'number' && isFinite(pts)))) {
    throw new Error('التصحيح مش مفهوم');
  }

  var touched = [];

  compLiveWrite_('grade.group', function (email) {

    var comp = compFindComp_(compId);
    var t = compSheet_('Submissions');
    var now = compNow_();
    var defs = Object.create(null);
    var number = '';

    compColumns_(t, ['id', 'compId', 'version', 'status', 'qids', 'answers', 'grading']).forEach(function (row) {

      if (row.compId !== compId || COMP_SUBMITTED.indexOf(row.status) === -1) return;

      var def = defs[row.version] = defs[row.version] || compDefinitionFor_(compId, row.version);
      var q = def ? def.questions.filter(function (x) { return x.id === qid; })[0] : null;
      var qids = compJson_(row.qids, []) || [];

      if (!q || qids.indexOf(qid) === -1) return;

      var answers = compJson_(row.answers, {}) || {};

      if (compAnswerKey_(q, answers[qid]) !== normAnswer) return;

      var totals = compApplyManual_(compJson_(row.grading, {}) || {}, qid, pts, email, def, now.stamp);

      if (!totals) return;

      compGradeWrite_(t, row.__row, compTotals_(def, totals.grading, qids), email, null, now);
      touched.push(row.id);
      number = number || compQuestionNumber_(def, qid);

    });

    if (touched.length) {
      activityNote_({ action: 'review', type: 'competition', id: compId, title: comp.title, changes: { answers: touched.length, q: number } });
    }

    return String(touched.length);

  });

  touched.forEach(compAfterGrade_);

  return { updated: touched.length, queue: apiCompReviewQueue(compId, qid) };

}


/**
 * What still waits for a reviewer, grouped by the same (normalized) answer.
 * → { questions: [{ qid, number, text, type, points, pending }], groups: [{ qid, key, sample, count, ids }], total }
 */
function apiCompReviewQueue(compId, qid) {

  assertAdmin_();

  var comp = compFindComp_(compId);

  if (qid !== undefined && qid !== null && qid !== '') compValidId_(qid, COMP_QID, 'معرّف السؤال');

  var defs = Object.create(null);
  var latest = comp.liveVersion ? compDefinitionFor_(comp.id, comp.liveVersion) : null;
  var questions = Object.create(null);
  var groups = Object.create(null);
  var total = 0;

  compColumns_(compSheet_('Submissions'), ['id', 'compId', 'version', 'status', 'qids', 'answers', 'grading']).forEach(function (row) {

    if (row.compId !== comp.id || row.status !== 'pending_review') return;

    var def = defs[row.version] = defs[row.version] || compDefinitionFor_(comp.id, row.version);
    var grading = compJson_(row.grading, {}) || {};
    var answers = compJson_(row.answers, {}) || {};

    if (!def) return;

    def.questions.forEach(function (q) {

      if (qid && q.id !== qid) return;

      var g = grading[q.id];

      if (!g || g.ok !== null) return;

      var key = compAnswerKey_(q, answers[q.id]);
      var group = groups[q.id + '|' + key] = groups[q.id + '|' + key] || { qid: q.id, key: key, sample: answers[q.id] === undefined ? '' : answers[q.id], count: 0, ids: [] };
      var shown = latest || def;

      group.count++;
      if (group.ids.length < 100) group.ids.push(row.id);
      total++;

      questions[q.id] = questions[q.id] || { qid: q.id, number: compQuestionNumber_(shown, q.id) || compQuestionNumber_(def, q.id), text: q.text, type: q.type, points: q.points, pending: 0 };
      questions[q.id].pending++;

    });

  });

  var list = Object.keys(questions).map(function (k) { return questions[k]; });
  var place = function (id) { return list.map(function (q) { return q.qid; }).indexOf(id); };

  return {
    questions: list,
    groups: Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) {
      return a.qid === b.qid ? b.count - a.count : place(a.qid) - place(b.qid);
    }),
    total: total
  };

}


/** Grades every sent submission again with the LATEST LIVE key; a reviewer's marks are kept. → { regraded, changed } */
function apiCompRegrade(compId) {

  assertAdmin_();
  compValidId_(compId, COMP_ID, 'معرّف المسابقة');

  var touched = [];
  var report = { regraded: 0, changed: 0 };

  compLiveWrite_('regrade', function (email) {

    var comp = compFindComp_(compId);
    var def = comp.liveVersion ? compDefinitionFor_(compId, comp.liveVersion) : null;

    if (!def) throw appError_('المسابقة لسه ما اتنشرتش.', 'انشرها الأول: التصحيح بيمشي على آخر إجابات صحيحة اتنشرت.');

    var t = compSheet_('Submissions');
    var now = compNow_();

    compColumns_(t, ['id', 'compId', 'status', 'qids', 'answers', 'grading', 'score', 'pendingCount']).forEach(function (row) {

      if (row.compId !== compId || COMP_SUBMITTED.indexOf(row.status) === -1) return;

      var qids = compJson_(row.qids, []) || [];
      var grading = compJson_(row.grading, {}) || {};
      var totals = compRegrade_(def, compJson_(row.answers, {}) || {}, grading, qids, now.stamp);

      report.regraded++;

      if (JSON.stringify(totals.grading) === JSON.stringify(grading) && String(totals.score) === row.score && totals.status === row.status && String(totals.pendingCount) === row.pendingCount) return;

      compGradeWrite_(t, row.__row, totals, email, null, now);
      report.changed++;
      touched.push(row.id);

    });

    activityNote_({ action: 'regrade', type: 'competition', id: compId, title: comp.title, changes: { submissions: report.regraded, changed: report.changed } });

    return report.changed + '/' + report.regraded;

  });

  touched.forEach(compAfterGrade_);

  return report;

}


/** void = true: the submission stops counting (kept); false: it counts again. → apiCompSubmission(id) */
function apiCompVoid(submissionId, voided) {

  assertAdmin_();
  compValidId_(submissionId, COMP_SUBMISSION_ID, 'معرّف المشاركة');

  compLiveWrite_('void', function (email) {

    var t = compSheet_('Submissions');
    var rowNumber = compFindRow_(t, 'id', submissionId);
    var row = rowNumber ? compRowAt_(t, rowNumber) : null;

    if (!row) throw new Error('المشاركة مش موجودة');

    var now = compNow_();
    var status;

    if (voided !== false) {
      status = 'void';
    }
    else if (!row.submittedAt) {
      status = 'in_progress';
    }
    else {
      var def = compDefinitionFor_(row.compId, row.version);
      status = def ? compTotals_(def, compJson_(row.grading, {}) || {}, compJson_(row.qids, []) || []).status : 'submitted';
    }

    compUpdate_(t, rowNumber, { status: status, reviewedBy: email, updatedAt: now.stamp }, row);

    var comp = compFindComp_(row.compId);
    activityNote_({ action: 'review', type: 'competition', id: row.compId, title: comp.title, changes: { void: voided !== false } });

    return submissionId;

  });

  compAfterGrade_(submissionId);

  return apiCompSubmission(submissionId);

}


/* =========================================================
   RESULTS AND EXPORT
========================================================= */

/**
 * The ranking (best attempt per person: score desc, duration asc, sent
 * first) and per-question stats over every sent submission.
 */
function apiCompResults(compId) {

  assertAdmin_();

  var comp = compFindComp_(compId);
  var rows = compColumns_(compSheet_('Submissions'), ['id', 'compId', 'version', 'participantId', 'name', 'phone', 'status', 'submittedAt',
    'submittedMs', 'durationSec', 'score', 'maxScore', 'pendingCount', 'qids', 'answers', 'grading'])
    .filter(function (r) { return r.compId === comp.id && COMP_SUBMITTED.indexOf(r.status) !== -1; });
  var def = comp.liveVersion ? compDefinitionFor_(comp.id, comp.liveVersion) : null;
  var best = Object.create(null);
  var attempts = Object.create(null);
  var better = function (a, b) {
    var sa = Number(a.score) || 0, sb = Number(b.score) || 0;
    if (sa !== sb) return sa > sb;
    var da = Number(a.durationSec) || 0, db = Number(b.durationSec) || 0;
    if (da !== db) return da < db;
    return (Number(a.submittedMs) || 0) < (Number(b.submittedMs) || 0);
  };

  rows.forEach(function (r) {
    var who = r.participantId || r.phone || r.id;
    attempts[who] = (attempts[who] || 0) + 1;
    if (!best[who] || better(r, best[who])) best[who] = r;
  });

  var ranked = Object.keys(best).map(function (k) { return { who: k, row: best[k] }; }).sort(function (a, b) {
    return better(a.row, b.row) ? -1 : better(b.row, a.row) ? 1 : 0;
  });
  var ranking = [];

  ranked.forEach(function (item, i) {
    var r = item.row;
    var prev = ranking[i - 1];
    var tie = prev && prev.score === (Number(r.score) || 0) && prev.durationSec === (Number(r.durationSec) || 0);
    ranking.push({
      rank: tie ? prev.rank : i + 1,
      id: r.id,
      participantId: r.participantId,
      name: r.name,
      phone: r.phone,
      score: Number(r.score) || 0,
      maxScore: Number(r.maxScore) || 0,
      durationSec: Number(r.durationSec) || 0,
      submittedAt: r.submittedAt,
      status: r.status,
      pending: Number(r.pendingCount) || 0,
      attempts: attempts[item.who]
    });
  });

  var questions = [];

  if (def) {
    questions = def.questions.filter(function (q) { return q.type !== 'info'; }).map(function (q) {
      var stat = { qid: q.id, number: compQuestionNumber_(def, q.id), text: q.text, type: q.type, points: q.points, answered: 0, correct: 0, wrong: 0, pending: 0, rate: 0 };
      var choiceCounts = {};
      rows.forEach(function (r) {
        if ((compJson_(r.qids, []) || []).indexOf(q.id) === -1) return;
        var answers = compJson_(r.answers, {}) || {};
        var g = (compJson_(r.grading, {}) || {})[q.id] || {};
        var answer = answers[q.id];
        if (!compEmpty_(answer)) {
          stat.answered++;
          [].concat(answer).forEach(function (a) { choiceCounts[a] = (choiceCounts[a] || 0) + 1; });
        }
        if (g.ok === true) stat.correct++;
        else if (g.ok === null) stat.pending++;
        else if (!compEmpty_(answer)) stat.wrong++;
      });
      stat.rate = stat.answered ? Math.round(stat.correct * 100 / stat.answered) : 0;
      if (q.type === 'single' || q.type === 'multi') stat.choices = q.choices.map(function (c) { return { id: c.id, text: c.text, count: choiceCounts[c.id] || 0, correct: [].concat(q.correct || []).indexOf(c.id) !== -1 }; });
      if (q.type === 'truefalse') stat.choices = [{ id: 't', text: 'صح', count: choiceCounts.t || 0, correct: q.correct === 't' }, { id: 'f', text: 'غلط', count: choiceCounts.f || 0, correct: q.correct === 'f' }];
      return stat;
    });
  }

  var scores = ranking.map(function (r) { return r.score; });

  return {
    ranking: ranking,
    stats: {
      submissions: rows.length,
      participants: ranking.length,
      average: scores.length ? Math.round(scores.reduce(function (a, b) { return a + b; }, 0) * 10 / scores.length) / 10 : 0,
      top: scores.length ? Math.max.apply(null, scores) : 0,
      maxScore: def ? compTotalPoints_(def) : 0,
      pending: rows.filter(function (r) { return r.status === 'pending_review'; }).length
    },
    questions: questions,
    finalizedAt: comp.finalizedAt || ''
  };

}


/** Rows for an XLSX built in the browser: { filename, header, rows } (every submission but unfinished ones). */
function apiCompExport(compId) {

  assertAdmin_();

  var comp = compFindComp_(compId);
  var parsed = compParseComp_(comp);
  var t = compSheet_('Submissions');
  var rows = compColumns_(t, COMP_TABLES.Submissions).filter(function (r) { return r.compId === comp.id && r.status !== 'in_progress'; });
  var latest = comp.liveVersion ? compDefinitionFor_(comp.id, comp.liveVersion) : null;
  var defs = Object.create(null);
  var fields = parsed.participation === 'open' ? parsed.fields.filter(function (f) { return f.mode !== 'hidden' && f.key !== 'name' && f.key !== 'phone'; }) : [];
  var questions = latest ? latest.questions.filter(function (q) { return q.type !== 'info'; }) : [];
  var header = ['المشاركة', 'الاسم', 'الموبايل'].concat(fields.map(function (f) { return f.label; }),
    ['الحالة', 'الدرجة', 'من', 'صح', 'لسه بتتراجع', 'المدة (ثانية)', 'اتبعتت', 'المحاولة', 'ملاحظات']);

  questions.forEach(function (q, i) {
    var label = 'س' + compArabicDigits_(i + 1) + ': ' + compLine_(q.text).slice(0, 40);
    header.push(label, label + ' (صح؟)', label + ' (الدرجة)');
  });

  var out = rows.map(function (r) {
    var def = defs[r.version] = defs[r.version] || compDefinitionFor_(comp.id, r.version) || latest;
    var extra = compJson_(r.fields, {}) || {};
    var answers = compJson_(r.answers, {}) || {};
    var grading = compJson_(r.grading, {}) || {};
    var line = [r.id, r.name, r.phone].concat(fields.map(function (f) { return extra[f.key] || ''; }), [
      COMP_STATUS_LABELS[r.status] || r.status, Number(r.score) || 0, Number(r.maxScore) || 0, Number(r.correctCount) || 0,
      Number(r.pendingCount) || 0, Number(r.durationSec) || 0, r.submittedAt, Number(r.attemptNo) || 1, r.flags
    ]);
    questions.forEach(function (q) {
      var mine = def ? def.questions.filter(function (x) { return x.id === q.id; })[0] || q : q;
      var answer = answers[q.id];
      var label = function (id) { var c = mine.choices.filter(function (x) { return x.id === id; })[0]; return c ? c.text : ''; };
      var text = compEmpty_(answer) ? '' : mine.type === 'single' ? label(answer) : mine.type === 'multi' ? [].concat(answer).map(label).join('، ')
        : mine.type === 'truefalse' ? (answer === 't' ? 'صح' : 'غلط') : String(answer);
      var g = grading[q.id];
      // the answer, its mark (✓ / ✕ / ⏳ = waiting for a reviewer) and the points
      line.push(text, !g ? '' : g.ok === null ? '⏳' : g.ok ? '✓' : '✕', g ? (g.ok === null ? 'مراجعة' : Number(g.pts) || 0) : '');
    });
    return line;
  });

  return { filename: (comp.slug || 'competition') + '-results.xlsx', header: header, rows: out };

}
