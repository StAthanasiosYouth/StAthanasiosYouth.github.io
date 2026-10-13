/**
 * POINTS SEASONS (docs/COMPETITIONS.md §18.6)
 *
 * Exactly one season is active. Every ledger row and every request belongs to
 * a season (`seasonId`; an empty one = «الموسم الأول», `sea-first`, created
 * the first time the wallet needs a season). A competition's points land in
 * ITS season (Competitions.seasonId; empty = the active one). Balance = the
 * active season's rows. Nothing is ever deleted:
 *
 *   close: allowed only when the season has no pending / approved request;
 *   writes a frozen SeasonTotals row per participant (one batch); the season
 *   becomes `closed`; the next (planned, or a new one) becomes active, so every
 *   balance starts again at 0. A closed season never changes again: a regrade
 *   of its competitions writes nothing, no refund can land in it, and points
 *   only move to the new season by an explicit, logged «تحويل» (kind transfer).
 *
 * No cap: the admin sees the season's theoretical maximum (Σ the gradable
 * points of its wallet competitions; best attempt only) to price prizes.
 */

var SEASON_FIRST = 'sea-first';
var SEASON_ID = /^sea-[0-9a-z]{4,12}$/;
var SEASON_NAME_MAX = 60;

/* this execution's active season (read once) */
var SEASON_ACTIVE_ = null;


/* =========================================================
   READ
========================================================= */

function seasonHasTab_() {

  try {
    return !!compSpreadsheet_(false) && !!compSpreadsheet_(false).getSheetByName('Seasons');
  }
  catch (ignored) {
    return false;
  }

}

function seasonRows_() {

  return seasonHasTab_() ? compRows_(compSheet_('Seasons')) : [];

}

/* the active season row; «الموسم الأول» is made the first time one is needed (a short lock) */
function seasonActive_() {

  if (SEASON_ACTIVE_) return SEASON_ACTIVE_;

  // no competitions spreadsheet yet: the first season, not written (nothing can belong to it yet)
  if (!compSpreadsheet_(false)) {
    return { id: SEASON_FIRST, name: 'الموسم الأول', startAt: '', endAt: '', status: 'active', notifyDays: '', closedAt: '', closedBy: '' };
  }

  var active = seasonRows_().filter(function (s) { return s.status === 'active'; })[0];

  if (!active) {

    var stamp = compNow_().stamp;
    var lock = LockService.getScriptLock();
    var mine = false;

    try {
      mine = lock.tryLock(10000);
    }
    catch (ignored) {
      mine = false;
    }

    try {
      active = seasonRows_().filter(function (s) { return s.status === 'active'; })[0];
      if (!active) {
        active = { id: SEASON_FIRST, name: 'الموسم الأول', startAt: '', endAt: '', status: 'active', notifyDays: '', closedAt: '', closedBy: '', createdAt: stamp, updatedAt: stamp };
        compAppend_(compSheet_('Seasons'), [active]);
      }
    }
    finally {
      if (mine) lock.releaseLock();
    }

  }

  SEASON_ACTIVE_ = active;

  return active;

}

function seasonActiveId_() {

  return seasonActive_().id;

}

/* the season a row belongs to ('' = the first one) */
function seasonOf_(seasonId) {

  return seasonId ? String(seasonId) : SEASON_FIRST;

}

/* CompStoreItems.gs: may a request of this season still change? */
function walletSeasonIsActive_(seasonId) {

  return seasonOf_(seasonId) === seasonActiveId_();

}

/* { id: row } */
function seasonIndex_() {

  var index = Object.create(null);

  seasonRows_().forEach(function (s) { index[s.id] = s; });

  return index;

}

/* the season a competition's points belong to */
function seasonForComp_(comp, activeId) {

  return comp && comp.seasonId ? String(comp.seasonId) : activeId;

}

/* content.json `points.season`: { name, startAt, endAt } (T-form) */
function walletSeasonPublic_() {

  if (!seasonHasTab_()) return null;

  var active = seasonRows_().filter(function (s) { return s.status === 'active'; })[0];

  return active ? { name: active.name, startAt: shopWall_(active.startAt), endAt: shopWall_(active.endAt) } : null;

}


/* =========================================================
   THE THEORETICAL MAXIMUM
========================================================= */

/* { seasonId: { max, expected, competitions } } from the draft (cached) */
function seasonMaxima_() {

  var draft = typeof compDraft_ === 'function' ? compDraft_() : null;
  var out = Object.create(null);

  if (!draft || draft.error) return out;

  var activeId = seasonActiveId_();
  var points = Object.create(null);

  (draft.questions || []).forEach(function (q) {
    if (q.type === 'info' || String(q.enabled) === '' && q.enabled !== undefined && q.enabled !== '1') return;
    points[q.compId] = (points[q.compId] || 0) + (Number(q.points) || 0);
  });

  (draft.comps || []).forEach(function (c) {
    if (c.wallet !== '1' || c.scoring !== '1' || c.archived === '1') return;
    var sid = seasonForComp_(c, activeId);
    var entry = out[sid] = out[sid] || { max: 0, expected: 0, competitions: 0 };
    entry.competitions++;
    if (c.liveVersion) entry.max += points[c.id] || 0;
    else entry.expected += points[c.id] || 0;
  });

  return out;

}


/* =========================================================
   ADMIN
========================================================= */

function seasonView_(s, maxima, balances) {

  var m = maxima[s.id] || { max: 0, expected: 0, competitions: 0 };
  var view = {
    id: s.id, name: s.name, startAt: s.startAt, endAt: s.endAt, status: s.status, notifyDays: s.notifyDays,
    closedAt: s.closedAt, closedBy: s.closedBy, maxTheoretical: m.max, expected: m.expected, competitions: m.competitions
  };

  if (s.status === 'active' && balances) {
    var values = Object.keys(balances).map(function (k) { return balances[k]; });
    view.topBalance = values.length ? Math.max.apply(null, values) : 0;
    view.participants = values.filter(function (v) { return v !== 0; }).length;
  }

  return view;

}

/* { active, seasons: [...] } (§18.6) */
function apiSeasons() {

  assertAdmin_();
  walletRequireOn_();

  var active = seasonActive_();
  var maxima = seasonMaxima_();
  var balances = walletBalances_();

  return {
    active: active.id,
    seasons: seasonRows_().map(function (s) { return seasonView_(s, maxima, s.status === 'active' ? balances : null); })
  };

}

/* a Cairo stamp from the admin ('' allowed) */
function seasonStampIn_(value, field, label, endOfDay) {

  var text = String(value === undefined || value === null ? '' : value).trim();

  if (!text) return '';

  var wall = contentDateTime_(text.replace('T', ' '), endOfDay);

  if (!wall) throw appError_(label + ' مش مكتوب صح.', 'مثلاً: 2026-12-31 23:59', '', field);

  return wall.replace('T', ' ');

}

function seasonValidate_(input, existing) {

  input = input || {};

  var pick = function (key) { return input[key] !== undefined ? input[key] : existing ? existing[key] : ''; };
  var name = contentLine_(pick('name'));

  if (!name) throw appError_('اكتب اسم الموسم.', 'مثلاً: موسم الصيف ٢٠٢٦', '', 'name');
  if (name.length > SEASON_NAME_MAX) throw appError_('اسم الموسم أطول من ' + SEASON_NAME_MAX + ' حرف.', '', '', 'name');

  var startAt = seasonStampIn_(pick('startAt'), 'startAt', 'بداية الموسم', false);
  var endAt = seasonStampIn_(pick('endAt'), 'endAt', 'نهاية الموسم', true);

  if (startAt && endAt && endAt <= startAt) throw appError_('نهاية الموسم لازم تكون بعد بدايته.', '', '', 'endAt');

  var days = pick('notifyDays');
  var notifyDays = days === '' || days === null || days === undefined ? '' : compInt_(days, 1, 30, NaN);

  if (notifyDays !== '' && isNaN(notifyDays)) throw appError_('التنبيه قبل نهاية الموسم بين يوم و٣٠ يوم.', '', '', 'notifyDays');

  return { name: name, startAt: startAt, endAt: endAt, notifyDays: notifyDays === '' ? '' : String(notifyDays) };

}

/* input: { id?, name, startAt, endAt, notifyDays } — a new one is `planned`; a closed one never changes */
function apiSeasonSave(input) {

  var email = assertAdmin_();
  walletRequireOn_();

  input = input || {};
  seasonActive_();

  var created = null;

  withScriptLock_(20000, function () {

    var t = compSheet_('Seasons');
    var stamp = compNow_().stamp;

    if (input.id) {
      var rowNumber = compFindRow_(t, 'id', String(input.id));
      var row = rowNumber ? compRowAt_(t, rowNumber) : null;
      if (!row) throw appError_('الموسم ده مش موجود.', '');
      if (row.status === 'closed') throw appError_('الموسم ده اتقفل، ومينفعش يتعدل.', 'المواسم اللي فاتت محفوظة زي ما هي.');
      var patch = seasonValidate_(input, row);
      patch.updatedAt = stamp;
      compUpdate_(t, rowNumber, patch, row);
      created = Object.assign({}, row, patch);
      activityNote_({ action: 'update', type: 'points', id: row.id, title: patch.name, changes: { season: true } });
    }
    else {
      var clean = seasonValidate_(input, null);
      created = Object.assign({ id: 'sea-' + compRandomHex_(4), status: 'planned', closedAt: '', closedBy: '', createdAt: stamp, updatedAt: stamp }, clean);
      compAppend_(t, [created]);
      activityNote_({ action: 'create', type: 'points', id: created.id, title: created.name, changes: { season: true } });
    }

  });

  seasonFlushNotes_(email);

  if (typeof pushScheduleSyncSeasons_ === 'function') pushScheduleSyncSeasons_();

  SEASON_ACTIVE_ = null;

  return { season: created, seasons: apiSeasons().seasons };

}

/* activity notes made inside withScriptLock_ (no mutate_ here): written once the change landed */
function seasonFlushNotes_() {

  takeActivityNotes_().forEach(function (entry) { activity_(entry); });

}

/* { pid: { earned, spent, adjusted, final } } of one season, from its ledger rows */
function seasonTotals_(seasonId) {

  var totals = Object.create(null);

  if (!walletHasTab_()) return totals;

  compColumns_(walletSheet_(), ['participantId', 'amount', 'kind', 'seasonId']).forEach(function (l) {
    if (!l.participantId || seasonOf_(l.seasonId) !== seasonId) return;
    var t = totals[l.participantId] = totals[l.participantId] || { earned: 0, spent: 0, adjusted: 0, final: 0 };
    var amount = Number(l.amount) || 0;
    if (l.kind === 'competition' || l.kind === 'correction') t.earned += amount;
    else if (l.kind === 'redeem' || l.kind === 'refund') t.spent -= amount;
    else t.adjusted += amount;
    t.final += amount;
  });

  return totals;

}

/* the requests of a season that still need the admin (pending / approved) */
function seasonOpenRequests_(seasonId) {

  if (typeof shopRedemptionRows_ !== 'function') return [];

  return shopRedemptionRows_().filter(function (r) {
    return (r.status === 'pending' || r.status === 'approved') && seasonOf_(r.seasonId) === seasonId;
  });

}

function seasonConfirmKey_(seasonId, totals) {

  var sum = 0;
  var count = 0;

  Object.keys(totals).forEach(function (pid) { sum += totals[pid].final; count++; });

  return sha256Hex_(seasonId + '|' + count + '|' + sum).slice(0, 12);

}

/* { season, totals: [{ pid, name, group, earned, spent, adjusted, final }], openRequests, canClose, confirmKey } */
function apiSeasonClosePreview(id) {

  assertAdmin_();
  walletRequireOn_();

  var season = seasonIndex_()[String(id || '')];

  if (!season) throw appError_('الموسم ده مش موجود.', '');

  var totals = seasonTotals_(season.id);
  var people = typeof shopPeople_ === 'function' ? shopPeople_() : {};
  var open = seasonOpenRequests_(season.id);

  return {
    season: season,
    totals: Object.keys(totals).map(function (pid) {
      var person = people[pid] || {};
      return { pid: pid, name: person.name || '', group: person.group || '', earned: totals[pid].earned, spent: totals[pid].spent, adjusted: totals[pid].adjusted, final: totals[pid].final };
    }).sort(function (a, b) { return b.final - a.final; }),
    openRequests: open.map(function (r) { return { id: r.id, participantId: r.participantId, name: (people[r.participantId] || {}).name || '', itemName: r.itemName, cost: Number(r.cost) || 0, status: r.status, requestedAt: r.requestedAt }; }),
    canClose: season.status === 'active' && !open.length,
    confirmKey: seasonConfirmKey_(season.id, totals)
  };

}

/*
 * Closes the active season. next: a planned season's id, or { name, startAt, endAt, notifyDays }.
 * Refused while the season has open requests or when the totals moved since the preview.
 */
function apiSeasonClose(id, confirmKey, next) {

  var email = assertAdmin_();
  walletRequireOn_();

  var result = null;
  var lock = compLock_(30000);

  if (!lock) throw appError_('فيه ضغط دلوقتي.', 'جرّب تاني بعد دقيقة.');

  try {

    SEASON_ACTIVE_ = null;

    var t = compSheet_('Seasons');
    var rowNumber = compFindRow_(t, 'id', String(id || ''));
    var season = rowNumber ? compRowAt_(t, rowNumber) : null;

    if (!season) throw appError_('الموسم ده مش موجود.', '');
    if (season.status !== 'active') throw appError_('الموسم ده مش هو الموسم الحالي.', '');

    if (seasonOpenRequests_(season.id).length) {
      throw appError_('لازم تخلّص طلبات الجوايز اللي في الموسم ده الأول.', 'سلّمها أو الغيها (النقاط هترجع في نفس الموسم)، وبعدين اقفله.');
    }

    var totals = seasonTotals_(season.id);

    if (String(confirmKey || '') !== seasonConfirmKey_(season.id, totals)) {
      throw appError_('الأرقام اتغيرت من وقت المراجعة.', 'افتح «قفل الموسم» تاني وراجع.');
    }

    var stamp = compNow_().stamp;
    var nextRow = null;
    var nextNumber = 0;

    if (typeof next === 'string' && next) {
      nextNumber = compFindRow_(t, 'id', next);
      nextRow = nextNumber ? compRowAt_(t, nextNumber) : null;
      if (!nextRow || nextRow.status !== 'planned') throw appError_('اختار موسم جاي (متخطط) أو اعمل واحد جديد.', '');
    }
    else {
      var clean = seasonValidate_(next || {}, null);
      nextRow = Object.assign({ id: 'sea-' + compRandomHex_(4), status: 'planned', closedAt: '', closedBy: '', createdAt: stamp, updatedAt: stamp }, clean);
    }

    // 1. the frozen totals (one batch; written once)
    var already = compRows_(compSheet_('SeasonTotals')).some(function (r) { return r.seasonId === season.id; });

    if (!already) {
      compAppend_(compSheet_('SeasonTotals'), Object.keys(totals).map(function (pid) {
        var x = totals[pid];
        return { seasonId: season.id, pid: pid, earned: String(x.earned), spent: String(x.spent), adjusted: String(x.adjusted), final: String(x.final), closedAt: stamp };
      }));
    }

    // 2. closed, then the next one active
    compUpdate_(t, rowNumber, { status: 'closed', closedAt: stamp, closedBy: email, updatedAt: stamp }, season);

    if (nextNumber) compUpdate_(t, nextNumber, { status: 'active', updatedAt: stamp }, nextRow);
    else compAppend_(t, [Object.assign({}, nextRow, { status: 'active' })]);

    SEASON_ACTIVE_ = null;

    result = { closed: season.id, active: nextRow.id, participants: Object.keys(totals).length };

  }
  finally {
    lock.releaseLock();
  }

  activity_({ action: 'finalize', type: 'points', id: result.closed, title: 'قفل الموسم', changes: { season: true, participants: result.participants, next: result.active } });

  if (typeof pushScheduleSyncSeasons_ === 'function') pushScheduleSyncSeasons_();

  return Object.assign(result, apiSeasons());

}


/* =========================================================
   PORTAL AND NOTICES
========================================================= */

/* portalMe: { season: { id, name, startAt, endAt, earned, maxTheoretical }, seasons: [closed, newest first] } */
function seasonPortal_(pid) {

  var active = seasonActive_();
  var totals = seasonTotals_(active.id)[pid] || { earned: 0 };
  var maxima = seasonMaxima_();
  var index = seasonIndex_();
  var history = (seasonHasTab_() ? compRows_(compSheet_('SeasonTotals')) : []).filter(function (r) { return r.pid === pid; })
    .map(function (r) {
      var s = index[r.seasonId] || {};
      return { id: r.seasonId, name: s.name || '', startAt: shopWall_(s.startAt), endAt: shopWall_(s.endAt), final: Number(r.final) || 0, earned: Number(r.earned) || 0, spent: Number(r.spent) || 0, closedAt: r.closedAt };
    })
    .sort(function (a, b) { return a.closedAt < b.closedAt ? 1 : -1; });

  return {
    season: { id: active.id, name: active.name, startAt: shopWall_(active.startAt), endAt: shopWall_(active.endAt), earned: totals.earned, maxTheoretical: (maxima[active.id] || {}).max || 0 },
    seasons: history
  };

}

/* CompSchedule.gs: «الموسم بيخلص بعد … يوم» for the active / planned seasons that ask for it */
function walletSeasonNotices_() {

  if (!seasonHasTab_()) return [];

  return seasonRows_().filter(function (s) { return s.status !== 'closed' && s.notifyDays && s.endAt; }).map(function (s) {
    var end = shopWall_(s.endAt);
    var days = Number(s.notifyDays) || 1;
    var sendAt = wallAdd_(end, -days * 1440);
    return {
      kind: 'season-end', refId: s.id, notifId: 'notif-season-end-' + s.id.replace(/^sea-/, '') + '-' + sendAt.replace(/\D/g, ''),
      sendAt: sendAt, expireAt: end,
      title: '🏁 ' + s.name + ' بيخلص بعد ' + days + (days === 1 ? ' يوم' : days === 2 ? ' يوم' : ' أيام'),
      message: 'النقاط بتتقفل ' + pushWhen_(end) + '. لو عايز تطلب جايزة، اطلبها قبلها.'
    };
  });

}
