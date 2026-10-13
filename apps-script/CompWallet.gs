/**
 * COMPETITIONS: THE POINTS WALLET (Phase 3). docs/COMPETITIONS.md §8.
 *
 * Switch: COMP_WALLET = '1' (needs the registry; apiCompSettings keeps the
 * chain). Tab: PointsLedger — append-only, never edited; every append and
 * every balance check runs under compLock_(). A balance is the sum of a
 * participant's rows (cached per participant as wal:bal:<id>, dropped on
 * every write to them; checks inside the lock always sum the tab).
 *
 * Competition points follow the grade: walletReconcile_(submissionId)
 * (called through compAfterGrade_ after the auto grade at submit, a manual
 * grade, a group grade, a regrade, void / unvoid) computes
 *   target  = (the competition's wallet is on AND the submission is graded) ? score : 0
 *   current = Σ ledger rows with refType 'submission' and refId = the submission
 * and, when they differ, appends ONE row (kind competition for the first,
 * correction after) with idemKey sub:<id>:<n> (n = rows it already has).
 * Running it again adds nothing. Only registered submissions (participantId)
 * count; with the wallet switched off it does nothing. When the live lock
 * is busy the ids wait in wal:retry and the next reconcile takes them along.
 *
 * Admin: apiWallet, apiWalletParticipant, apiWalletAdjust (manual rows,
 * idemKey adj:<participantId>:<key>, a deduction never below zero, logged points.adjust).
 */

var WALLET_KINDS = ['competition', 'correction', 'manual', 'redeem', 'refund', 'transfer'];
var WALLET_KIND_LABELS = { competition: 'مسابقة', correction: 'تعديل نتيجة', manual: 'تعديل من الخدام', redeem: 'جايزة', refund: 'استرجاع', transfer: 'تحويل من موسم فات' };
var WALLET_MAX_ADJUST = 1000000;
var WALLET_NOTE_MAX = 200;
var WALLET_ADJUST_KEY = /^[A-Za-z0-9_-]{8,64}$/;
var WALLET_BALANCE_SECONDS = 21600;
var WALLET_PORTAL_LEDGER = 200;
var WALLET_RETRY_MAX = 300;

/* this execution: competition id → wallet on (read once) */
var WALLET_COMP_FLAGS_ = null;
var WALLET_RECONCILING_ = false;


/* =========================================================
   MODULE
========================================================= */

function compWalletReady_() {

  return true;

}

function walletRequireOn_() {

  if (!compModules_().wallet) {
    throw appError_('«المحفظة والنقاط» مش متفعّلة.', 'فعّلها من إعدادات المسابقات الأول.');
  }

}


/* =========================================================
   THE LEDGER
========================================================= */

function walletSheet_() {

  return compSheet_('PointsLedger');

}

/* does the ledger tab exist yet (public reads never make it) */
function walletHasTab_() {

  var ss = compSpreadsheet_(false);

  return !!(ss && ss.getSheetByName('PointsLedger'));

}

/* every ledger row (text cells), oldest first */
function walletLedger_() {

  return walletHasTab_() ? compColumns_(walletSheet_(), COMP_TABLES.PointsLedger) : [];

}

/* { participantId: balance } over the whole ledger (one read) */
function walletBalances_() {

  var sums = Object.create(null);

  if (!walletHasTab_()) return sums;

  var season = walletSeasonNow_();

  compColumns_(walletSheet_(), ['participantId', 'amount', 'seasonId']).forEach(function (r) {
    if (r.participantId && walletInSeason_(r, season)) sums[r.participantId] = (sums[r.participantId] || 0) + (Number(r.amount) || 0);
  });

  return sums;

}

/* the active season's id ('' when seasons aren't installed: every row counts) */
function walletSeasonNow_() {

  return typeof seasonActiveId_ === 'function' ? seasonActiveId_() : '';

}

/* does a ledger row belong to the season? (an empty seasonId = the first season) */
function walletInSeason_(row, season) {

  return !season || (row.seasonId || 'sea-first') === season;

}

/* one participant's balance: the cache, else the tab (fresh = always the tab) */
function walletBalance_(pid, fresh) {

  var season = walletSeasonNow_();
  var key = 'wal:bal:' + (season ? season + ':' : '') + pid;

  if (!fresh) {
    try {
      var cached = CacheService.getScriptCache().get(key);
      if (cached !== null && cached !== undefined && cached !== '' && isFinite(Number(cached))) return Number(cached);
    }
    catch (ignored) {
      // the tab then
    }
  }

  var sum = 0;

  if (walletHasTab_()) {
    compColumns_(walletSheet_(), ['participantId', 'amount', 'seasonId']).forEach(function (r) {
      if (r.participantId === pid && walletInSeason_(r, season)) sum += Number(r.amount) || 0;
    });
  }

  try {
    CacheService.getScriptCache().put(key, String(sum), WALLET_BALANCE_SECONDS);
  }
  catch (ignored) {
    // only a shortcut
  }

  return sum;

}

function walletDropBalance_(pid) {

  try {
    CacheService.getScriptCache().remove('wal:bal:' + pid);
  }
  catch (ignored) {
    // the next fresh read fixes it
  }

}

/* appends ledger rows in one block (call under compLock_) → the records with their ids */
function walletAppend_(records) {

  if (!records.length) return [];

  var stamp = compNow_().stamp;

  records.forEach(function (r) {
    r.id = r.id || 'l-' + compRandomHex_(6);
    r.createdAt = r.createdAt || stamp;
    r.actor = r.actor || '';
    r.note = r.note || '';
    r.compId = r.compId || '';
    r.refType = r.refType || '';
    r.refId = r.refId || '';
    r.seasonId = r.seasonId || walletSeasonNow_();
  });

  compAppend_(walletSheet_(), records);

  records.forEach(function (r) { walletDropBalance_(r.participantId); });

  return records;

}

/* totals of a set of ledger rows: { balance, earned, adjusted, spent, entries, lastAt } */
function walletTotals_(rows) {

  var t = { balance: 0, earned: 0, adjusted: 0, spent: 0, entries: rows.length, lastAt: '' };

  rows.forEach(function (r) {
    var amount = Number(r.amount) || 0;
    t.balance += amount;
    if (r.kind === 'competition' || r.kind === 'correction') t.earned += amount;
    else if (r.kind === 'manual') t.adjusted += amount;
    else if (r.kind === 'redeem' || r.kind === 'refund') t.spent -= amount;
    if (r.createdAt > t.lastAt) t.lastAt = r.createdAt;
  });

  return t;

}


/* =========================================================
   COMPETITION POINTS (walletReconcile_)
========================================================= */

/* is the competition's wallet on (its live definition; else the version the row was served) */
function walletCompOn_(compId, version) {

  if (!WALLET_COMP_FLAGS_) {
    WALLET_COMP_FLAGS_ = Object.create(null);
    compColumns_(compSheet_('Competitions'), ['id', 'liveVersion']).forEach(function (c) {
      WALLET_COMP_FLAGS_[c.id] = { live: String(c.liveVersion || '').trim() };
    });
  }

  var entry = WALLET_COMP_FLAGS_[compId] || (WALLET_COMP_FLAGS_[compId] = { live: '' });
  var key = 'on:' + (entry.live || version);

  if (entry[key] === undefined) {
    var def = compDefinitionFor_(compId, entry.live || version) || compDefinitionFor_(compId, version);
    entry[key] = !!(def && def.wallet && def.scoring);
  }

  return entry[key];

}

/* what the ledger should hold for one submission row on its own (before the one-attempt rule) */
function walletTarget_(row) {

  if (!row.participantId || row.status !== 'graded') return 0;
  // decided when the attempt started (the age rule at that time): never changes later (§19.3)
  if (String(row.flags || '').split(',').indexOf('noPoints') !== -1) return 0;

  return walletCompOn_(row.compId, row.version) ? Math.max(0, Math.round(Number(row.score) || 0)) : 0;

}

/*
 * ONE attempt per (participant, competition) earns: the best graded score,
 * ties → the earliest submitted (then the earlier row). Every other attempt's
 * target is 0, so when the best one changes (a regrade, a void, a review) the
 * points move with correction rows. rows: ALL of a group's submissions.
 * → { submissionId: target }
 */
function walletTargets_(rows) {

  var targets = Object.create(null);
  var best = Object.create(null);

  rows.forEach(function (row) {
    targets[row.id] = 0;
    if (!row.participantId || walletTarget_(row) <= 0) return;
    var group = row.participantId + '|' + row.compId;
    var current = best[group];
    var score = walletTarget_(row);
    var better = !current ||
      score > current.score ||
      (score === current.score && (Number(row.submittedMs) || Infinity) < (Number(current.row.submittedMs) || Infinity)) ||
      (score === current.score && (Number(row.submittedMs) || Infinity) === (Number(current.row.submittedMs) || Infinity) && row.__row < current.row.__row);
    if (better) best[group] = { row: row, score: score };
  });

  Object.keys(best).forEach(function (group) { targets[best[group].row.id] = best[group].score; });

  return targets;

}

function walletQueue_(ids) {

  try {
    var cache = CacheService.getScriptCache();
    var list = compJson_(cache.get('wal:retry'), []) || [];
    ids.forEach(function (id) { if (list.indexOf(id) === -1) list.push(id); });
    cache.put('wal:retry', JSON.stringify(list.slice(-WALLET_RETRY_MAX)), 21600);
  }
  catch (ignored) {
    // a later regrade heals it
  }

}

function walletTakeQueue_() {

  try {
    var cache = CacheService.getScriptCache();
    var list = compJson_(cache.get('wal:retry'), []) || [];
    if (list.length) cache.remove('wal:retry');
    return Array.isArray(list) ? list.filter(function (id) { return typeof id === 'string' && COMP_SUBMISSION_ID.test(id); }) : [];
  }
  catch (ignored) {
    return [];
  }

}

/**
 * The ledger follows the grade of each submission (one lock, one read of each tab, one block).
 * → { appended, checked }. Throws when the live lock is busy (the ids are queued for the next time).
 */
function walletReconcileMany_(ids) {

  var result = { appended: 0, checked: 0 };

  if (!compModules_().wallet || !compSpreadsheet_(false)) return result;

  ids = (ids || []).filter(function (id, i) { return typeof id === 'string' && COMP_SUBMISSION_ID.test(id) && ids.indexOf(id) === i; });

  var queued = WALLET_RECONCILING_ ? [] : walletTakeQueue_();

  queued.forEach(function (id) { if (ids.indexOf(id) === -1) ids.push(id); });

  if (!ids.length) return result;

  var t = compSheet_('Submissions');
  var wanted = Object.create(null);

  ids.forEach(function (id) { wanted[id] = true; });

  // before the lock: only registered submissions can hold points (an open competition stops here)
  var all = compColumns_(t, ['id', 'compId', 'version', 'participantId']);
  var groups = Object.create(null);

  all.forEach(function (r) { if (wanted[r.id] && r.participantId) groups[r.participantId + '|' + r.compId] = true; });

  // one attempt per (participant, competition) earns: the whole group is reconciled together
  var registered = all.filter(function (r) { return r.participantId && groups[r.participantId + '|' + r.compId]; });

  if (!registered.length) return result;

  // the competitions' wallet switches, read again (a publish may have happened since), outside the lock
  WALLET_COMP_FLAGS_ = null;
  registered.forEach(function (r) { walletCompOn_(r.compId, r.version); });

  wanted = Object.create(null);
  registered.forEach(function (r) { wanted[r.id] = true; });

  // seasons (CompSeasons.gs): a competition's points land in ITS season; a closed season is frozen
  var seasonNow = walletSeasonNow_();
  var seasonsById = typeof seasonIndex_ === 'function' ? seasonIndex_() : {};
  var compSeason = Object.create(null);

  if (seasonNow) {
    compColumns_(compSheet_('Competitions'), ['id', 'seasonId']).forEach(function (c) { compSeason[c.id] = c.seasonId || seasonNow; });
  }

  var lock = compLock_(20000);

  if (!lock) {
    walletQueue_(ids);
    throw new Error('wallet: busy');
  }

  WALLET_RECONCILING_ = true;

  try {

    // the rows as they are now (a grade may have moved since the caller wrote it)
    var rows = compColumns_(t, ['id', 'compId', 'version', 'participantId', 'status', 'score', 'submittedMs', 'flags'])
      .filter(function (r) { return wanted[r.id]; });
    var targets = walletTargets_(rows);
    var held = Object.create(null);
    var keys = Object.create(null);

    (walletHasTab_() ? compColumns_(walletSheet_(), ['refType', 'refId', 'amount', 'idemKey']) : []).forEach(function (l) {
      keys[l.idemKey] = true;
      if (l.refType !== 'submission' || !wanted[l.refId]) return;
      var h = held[l.refId] = held[l.refId] || { sum: 0, n: 0 };
      h.sum += Number(l.amount) || 0;
      h.n++;
    });

    var records = [];

    rows.forEach(function (row) {
      var h = held[row.id] || { sum: 0, n: 0 };
      var target = targets[row.id] || 0;
      result.checked++;
      // nothing ever registered and nothing to give: nothing to write (open competitions included)
      if (!row.participantId || target === h.sum) return;
      var season = seasonNow ? compSeason[row.compId] || seasonNow : '';
      // a closed season never changes again (§18.6)
      if (season && seasonsById[season] && seasonsById[season].status === 'closed') return;
      var key = 'sub:' + row.id + ':' + h.n;
      if (keys[key]) return;
      keys[key] = true;
      records.push({
        participantId: row.participantId,
        amount: target - h.sum,
        kind: h.n ? 'correction' : 'competition',
        refType: 'submission',
        refId: row.id,
        compId: row.compId,
        note: '',
        idemKey: key,
        actor: '',
        seasonId: season
      });
    });

    walletAppend_(records);
    result.appended = records.length;

  }
  finally {
    WALLET_RECONCILING_ = false;
    lock.releaseLock();
  }

  return result;

}

/** §8 / §16.3: after every grade change of one submission. */
function walletReconcile_(submissionId) {

  return walletReconcileMany_([submissionId]);

}

/** Result.pointsAwarded: what the ledger holds for one submission. */
function walletPointsFor_(submissionId) {

  if (!walletHasTab_()) return 0;

  var sum = 0;

  compColumns_(walletSheet_(), ['refType', 'refId', 'amount']).forEach(function (r) {
    if (r.refType === 'submission' && r.refId === submissionId) sum += Number(r.amount) || 0;
  });

  return sum;

}


/* =========================================================
   ADMIN
========================================================= */

/* competition titles by id */
function walletCompTitles_() {

  var titles = Object.create(null);

  if (compSpreadsheet_(false)) {
    compColumns_(compSheet_('Competitions'), ['id', 'title', 'shortTitle']).forEach(function (c) { titles[c.id] = c.title || c.shortTitle || ''; });
  }

  return titles;

}

/**
 * query: { q, group, status, sort: 'balance' | 'name' | 'earned' | 'spent' | 'lastAt', dir, offset, limit ≤ 200, all? }
 * (by default only participants with a ledger row or a balance; all: true = everyone)
 * → { items: [{ id, name, phone, group, status, balance, earned, adjusted, spent, entries, lastAt }], total, offset,
 *     limit, totals: { participants, balance, earned, adjusted, spent, entries }, modules }
 */
function apiWallet(query) {

  assertAdmin_();

  query = query && typeof query === 'object' && !Array.isArray(query) ? query : {};

  var modules = compModules_();
  var limit = Math.max(1, Math.min(REG_LIMITS.pageMax, Math.floor(Number(query.limit)) || REG_LIMITS.page));
  var offset = Math.max(0, Math.floor(Number(query.offset)) || 0);
  var result = { items: [], total: 0, offset: offset, limit: limit, totals: { participants: 0, balance: 0, earned: 0, adjusted: 0, spent: 0, entries: 0, negative: 0 }, modules: modules };

  if (!compSpreadsheet_(false)) return result;

  // waiting reconciles first (a busy moment earlier), then the latest graded ones (a lost queue)
  if (modules.wallet) {
    try {
      walletReconcileMany_([]);
    }
    catch (ignored) {
      // still busy: they stay queued
    }
    walletSyncRecent_();
  }

  var byPerson = Object.create(null);

  walletLedger_().forEach(function (l) { (byPerson[l.participantId] = byPerson[l.participantId] || []).push(l); });

  var search = typeof query.q === 'string' ? query.q.slice(0, REG_LIMITS.search) : '';
  var nameKey = normName_(search);
  var phoneKey = regPhoneSearch_(search);
  var group = typeof query.group === 'string' ? normName_(query.group) : '';
  var status = query.status === 'active' || query.status === 'inactive' ? query.status : 'all';

  var items = regRows_().map(function (r) {
    var totals = walletTotals_(byPerson[r.id] || []);
    return {
      id: r.id, name: r.name, phone: r.phoneNorm ? '0' + r.phoneNorm : '', group: r.group || '', status: r.status === 'inactive' ? 'inactive' : 'active',
      balance: totals.balance, earned: totals.earned, adjusted: totals.adjusted, spent: totals.spent, entries: totals.entries, lastAt: totals.lastAt,
      negative: totals.balance < 0, warning: totals.balance < 0 ? 'رصيد بالسالب' : '',
      _norm: r.nameNorm || normName_(r.name), _phone: r.phoneNorm || '', _group: normName_(r.group)
    };
  });

  items.forEach(function (i) {
    if (!i.entries) return;
    result.totals.participants++;
    result.totals.balance += i.balance;
    result.totals.earned += i.earned;
    result.totals.adjusted += i.adjusted;
    result.totals.spent += i.spent;
    result.totals.entries += i.entries;
    if (i.balance < 0) result.totals.negative++;
  });

  var found = items.filter(function (i) {
    if (query.all !== true && !i.entries) return false;
    if (status !== 'all' && i.status !== status) return false;
    if (group && i._group !== group) return false;
    if (search) {
      var inName = !!nameKey && i._norm.indexOf(nameKey) !== -1;
      var inPhone = !!phoneKey && i._phone.indexOf(phoneKey) !== -1;
      if (!inName && !inPhone && i.id !== search.trim()) return false;
    }
    return true;
  });

  var dir = query.dir === 'asc' ? 1 : -1;
  var sort = ['balance', 'earned', 'spent', 'lastAt'].indexOf(query.sort) !== -1 ? query.sort : (query.sort === 'name' ? 'name' : 'balance');
  var key = sort === 'name' ? function (i) { return i._norm; } : function (i) { return i[sort]; };

  if (sort === 'name' && query.dir !== 'desc') dir = 1;

  found.sort(function (a, b) { var x = key(a); var y = key(b); return x === y ? (a._norm < b._norm ? -1 : 1) : (x < y ? -dir : dir); });

  result.total = found.length;
  result.items = found.slice(offset, offset + limit).map(function (i) {
    delete i._norm;
    delete i._phone;
    delete i._group;
    return i;
  });

  return result;

}


/**
 * One participant's ledger, newest first:
 * → { participant: Person, balance, totals, entries: [{ id, amount, kind, kindLabel, note, compId, compTitle,
 *     refType, refId, redemption: { id, itemName, status } | null, actor, createdAt, balanceAfter }] }
 */
function apiWalletParticipant(id) {

  assertAdmin_();

  var person = regFind_(id);

  // their rows follow their grades even if a queued reconcile was lost (bounded, never fails the view)
  walletSyncParticipant_(id);

  var titles = walletCompTitles_();
  var redemptions = Object.create(null);

  if (typeof shopRedemptionRows_ === 'function') {
    shopRedemptionRows_().forEach(function (r) { if (r.participantId === id) redemptions[r.id] = { id: r.id, itemName: r.itemName, status: r.status }; });
  }

  var rows = walletLedger_().filter(function (l) { return l.participantId === id; });
  var running = 0;
  var entries = rows.map(function (l) {
    running += Number(l.amount) || 0;
    return {
      id: l.id,
      amount: Number(l.amount) || 0,
      kind: l.kind,
      kindLabel: WALLET_KIND_LABELS[l.kind] || l.kind,
      note: l.note,
      compId: l.compId,
      compTitle: l.compId ? titles[l.compId] || '' : '',
      refType: l.refType,
      refId: l.refId,
      redemption: l.refType === 'redemption' ? redemptions[l.refId] || null : null,
      actor: l.actor,
      createdAt: l.createdAt,
      balanceAfter: running
    };
  }).reverse();

  var totals = walletTotals_(rows);

  return { participant: regPerson_(person), balance: totals.balance, totals: totals, entries: entries };

}


/**
 * A manual row: amount (a non-zero integer, |amount| ≤ 1,000,000), note (required, ≤ 200),
 * adjustKey (the request's idempotency key, 8..64 of [A-Za-z0-9_-]; the same key again = the same
 * row back). A deduction that would leave the balance below zero is refused.
 * → { entry: { id, amount, kind, note, createdAt }, balance, replay }
 */
function apiWalletAdjust(id, amount, note, adjustKey, kind) {

  assertAdmin_();
  walletRequireOn_();
  compValidId_(id, REG_ID, 'معرّف المشترك');

  if (typeof amount !== 'number' || !isFinite(amount) || Math.round(amount) !== amount || amount === 0 || Math.abs(amount) > WALLET_MAX_ADJUST) {
    throw appError_('عدد النقاط لازم يكون رقم صحيح مش صفر (لحد مليون).', '', '', 'amount');
  }

  var text = contentLine_(note);

  if (!text) throw appError_('اكتب سبب التعديل.', 'السبب بيظهر للمشترك في «نقاطي».', '', 'note');
  if (text.length > WALLET_NOTE_MAX) throw appError_('السبب أطول من ٢٠٠ حرف.', '', '', 'note');
  if (typeof adjustKey !== 'string' || !WALLET_ADJUST_KEY.test(adjustKey)) throw new Error('الطلب مش مفهوم (adjustKey)');

  var person = regFind_(id);
  var out = {};

  compLiveWrite_('points.adjust', function (email) {

    var key = 'adj:' + id + ':' + adjustKey;
    var rows = walletLedger_();
    var same = rows.filter(function (l) { return l.idemKey === key || l.idemKey === 'adj:' + adjustKey || (l.idemKey.indexOf('adj:') === 0 && l.idemKey.slice(-(adjustKey.length + 1)) === ':' + adjustKey); })[0];

    if (same && (same.participantId !== id || Number(same.amount) !== amount)) {
      throw appError_('المفتاح ده اتستخدم قبل كده.', 'افتح نافذة التعديل من جديد وجرّب تاني.');
    }

    if (same) {
      out.entry = { id: same.id, amount: Number(same.amount) || 0, kind: same.kind, note: same.note, createdAt: same.createdAt };
      out.replay = true;
      return 'replay';
    }

    var season = walletSeasonNow_();
    var balance = rows.reduce(function (sum, l) { return l.participantId === id && walletInSeason_(l, season) ? sum + (Number(l.amount) || 0) : sum; }, 0);
    var rowKind = kind === 'transfer' ? 'transfer' : 'manual';

    if (amount < 0 && balance + amount < 0) {
      throw appError_('مينفعش الرصيد يبقى بالسالب: رصيده دلوقتي ' + regAr_(balance) + ' نقطة.', 'اخصم ' + regAr_(balance) + ' أو أقل.', '', 'amount');
    }

    var record = walletAppend_([{ participantId: id, amount: amount, kind: rowKind, note: text, idemKey: key, actor: email }])[0];

    out.entry = { id: record.id, amount: amount, kind: rowKind, note: text, createdAt: record.createdAt };
    out.replay = false;

    activityNote_({ action: 'points.adjust', type: 'points', id: id, title: person.name, changes: rowKind === 'transfer' ? { amount: amount, transfer: true } : { amount: amount } });

    return 'ok';

  });

  out.balance = walletBalance_(id, true);

  return { entry: out.entry, balance: out.balance, replay: out.replay };

}


/* =========================================================
   DRIFT SAFETY (a lost wal:retry queue, a reconcile that failed)
========================================================= */

var WALLET_SYNC_BATCH = 200;
var WALLET_PERSON_SYNC_MAX = 100;

/* submission ids that have competition / correction rows in the ledger: { id: true } */
function walletSubmissionRefs_(pid) {

  var refs = Object.create(null);

  if (!walletHasTab_()) return refs;

  compColumns_(walletSheet_(), ['participantId', 'refType', 'refId']).forEach(function (l) {
    if (l.refType === 'submission' && (!pid || l.participantId === pid)) refs[l.refId] = true;
  });

  return refs;

}

/*
 * The latest WALLET_SYNC_BATCH registered submissions of wallet competitions (by their last
 * change): one batch, one lock — what a lost wal:retry queue would most likely have missed.
 * Never throws.
 */
function walletSyncRecent_() {

  try {
    WALLET_COMP_FLAGS_ = null;
    var ids = compColumns_(compSheet_('Submissions'), ['id', 'compId', 'version', 'participantId', 'updatedAt'])
      .filter(function (r) { return r.participantId && walletCompOn_(r.compId, r.version); })
      .sort(function (a, b) { return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : b.__row - a.__row; })
      .slice(0, WALLET_SYNC_BATCH)
      .map(function (r) { return r.id; });
    return ids.length ? walletReconcileMany_(ids) : null;
  }
  catch (error) {
    return null;
  }

}

/* reconciles ids in batches (each batch: one compLock_) → { checked, fixed, entries } */
function walletReconcileBatches_(ids) {

  var out = { checked: 0, fixed: 0, entries: 0 };

  for (var i = 0; i < ids.length; i += WALLET_SYNC_BATCH) {
    var r = walletReconcileMany_(ids.slice(i, i + WALLET_SYNC_BATCH));
    out.checked += r.checked;
    out.entries += r.appended;
    // one row per submission per run: rows appended = submissions fixed
    out.fixed += r.appended;
  }

  return out;

}

/*
 * One participant's submissions that can hold points (graded ones of wallet
 * competitions, and every one the ledger already has rows for), newest
 * first, at most WALLET_PERSON_SYNC_MAX: cheap enough for an admin screen.
 * Never throws (a busy lock: the next look fixes it).
 */
function walletSyncParticipant_(pid) {

  try {
    if (!compModules_().wallet || !compSpreadsheet_(false)) return null;
    var refs = walletSubmissionRefs_(pid);
    WALLET_COMP_FLAGS_ = null;
    var ids = compColumns_(compSheet_('Submissions'), ['id', 'compId', 'version', 'participantId', 'status', 'startedMs'])
      .filter(function (r) { return r.participantId === pid && (refs[r.id] || (r.status === 'graded' && walletCompOn_(r.compId, r.version))); })
      .sort(function (a, b) { return (Number(b.startedMs) || 0) - (Number(a.startedMs) || 0); })
      .slice(0, WALLET_PERSON_SYNC_MAX)
      .map(function (r) { return r.id; });
    return walletReconcileBatches_(ids);
  }
  catch (error) {
    return null;
  }

}

/**
 * «راجع النقاط»: reconciles EVERY registered submission of every wallet competition (and every
 * submission the ledger has rows for, so a wallet switched off on a competition is reversed),
 * in batches of 200 under compLock_, after the queued catch-up (wal:retry). Idempotent: a second
 * run fixes nothing. Logged (points.adjust, changes.sync) only when it fixed something.
 * → { checked, fixed, entries }
 */
function apiWalletSync() {

  assertAdmin_();
  walletRequireOn_();

  if (!API_REQUEST_ || !API_REQUEST_.email) {
    throw appError_('تصحيح المسابقات من لوحة التحكم الرسمية بس.', 'افتح لوحة التحكم (/admin/) وكمّل من هناك.');
  }

  var result = { checked: 0, fixed: 0, entries: 0 };

  if (!compSpreadsheet_(false)) return result;

  try {
    var queued = walletReconcileMany_([]);
    result.entries += queued.appended;
    result.fixed += queued.appended;
  }
  catch (error) {
    throw appError_('فيه ضغط على المسابقات دلوقتي.', 'استنى ثواني وجرّب تاني.');
  }

  var refs = walletSubmissionRefs_('');

  WALLET_COMP_FLAGS_ = null;

  var ids = compColumns_(compSheet_('Submissions'), ['id', 'compId', 'version', 'participantId', 'status'])
    .filter(function (r) { return r.participantId && (refs[r.id] || walletCompOn_(r.compId, r.version)); })
    .map(function (r) { return r.id; });

  var done;

  try {
    done = walletReconcileBatches_(ids);
  }
  catch (error) {
    throw appError_('فيه ضغط على المسابقات دلوقتي، والمراجعة وقفت في النص.', 'جرّب تاني بعد شوية: اللي اتصلح مش هيتكرر.');
  }

  result.checked = done.checked;
  result.fixed += done.fixed;
  result.entries += done.entries;

  try {
    log_(currentEmail_(), 'comp.wallet.sync', result.fixed + '/' + result.checked);
  }
  catch (ignored) {
    // the sync stands
  }

  if (result.fixed) {
    activity_({ action: 'points.adjust', type: 'points', id: 'sync', title: 'المحفظة', changes: { sync: result.fixed } });
  }

  return result;

}


/* =========================================================
   PORTAL PARTS (portalMe)
========================================================= */

/* { balance, ledger: [{ amount, kind, note, compTitle, createdAt }] (newest first, ≤ 200) } */
function walletPortal_(pid) {

  var season = walletSeasonNow_();
  var rows = walletLedger_().filter(function (l) { return l.participantId === pid && walletInSeason_(l, season); });
  var titles = rows.some(function (l) { return l.compId; }) ? walletCompTitles_() : {};
  var balance = rows.reduce(function (sum, l) { return sum + (Number(l.amount) || 0); }, 0);

  return {
    balance: balance,
    ledger: rows.slice(-WALLET_PORTAL_LEDGER).reverse().map(function (l) {
      return {
        amount: Number(l.amount) || 0,
        kind: WALLET_KINDS.indexOf(l.kind) !== -1 ? l.kind : 'manual',
        note: l.note || '',
        compTitle: l.compId ? titles[l.compId] || '' : '',
        createdAt: l.createdAt
      };
    })
  };

}
