/* =========================================================
   COMPETITIONS IN THE WORKER'S PUBLISH (Phase 4, docs/CONTENT-MIGRATION-PLAN.md §8)
   ---------------------------------------------------------
   Owner decision 2026-10-27 (hybrid, one button): after the Phase 4 cutover
   the Worker builds and publishes the site, but the competitions stay here
   until Phase 5–6 (their draft, their secret, Snapshots, liveVersion). So:

   - compSigPush_: after an admin call, when the competitions' draft changed,
     its signature goes to the Worker (POST /v1/sync/comp-sig, signed). The
     Worker asks for a new competitions part only then (or when a time the
     part depends on has passed) — every other publish never waits for here.
   - doPost { fn: 'workerSync' } (Api.gs): the Worker's signed questions —
       compPackage { mode: 'review' | 'prepare', now, media }
         → the competitions part of the build (compBuildPublic_ with the
           Worker's library), their files, the review words; 'prepare' also
           writes the Snapshots this publish makes live
       compCommit { live: { id: version }, withdrawn: [{ id, slug }], stamp }
         → what went live (compAfterCommit_)
   Off until the owner sets CONTENT_WRITER = 'worker' (ContentExport.gs).
========================================================= */

var WORKER_SYNC_SKEW_MS = 5 * 60 * 1000;
var COMP_SIG_SENT_KEY = 'worker:comp-sig';
// columns a publish itself writes: the signature ignores them (else every publish would ask again)
var COMP_SIG_SKIP = ['liveVersion', 'publishedAt', 'updatedAt'];

function contentWriterWorker_() {

  return PropertiesService.getScriptProperties().getProperty('CONTENT_WRITER') === 'worker';

}

/*
 * One writer (BACKEND-MIGRATION §22): after the cutover the content drafts are the Worker's, so a
 * content change or a publish from here (an old open panel, the recovery admin) is refused — the
 * Sheets are a frozen copy then. The Worker runs this same code without the property: never refused there.
 */
function contentWriterGuard_() {

  if (contentWriterWorker_()) {
    throw apiError_('moved', 'المحتوى بقى بيتحفظ على السيرفر الجديد.', 'اعمل Refresh للصفحة وكمّل من هناك.');
  }

}

/* the competitions' draft as the build reads it, without what a publish writes → hex */
function compPackageSig_() {

  var draft = compDraft_();

  if (!draft) return 'none';

  var strip = function (row) {
    var copy = {};
    Object.keys(row).sort().forEach(function (k) { if (COMP_SIG_SKIP.indexOf(k) === -1) copy[k] = row[k]; });
    return copy;
  };

  return sha256Hex_(JSON.stringify({
    comps: (draft.comps || []).map(strip),
    questions: (draft.questions || []).map(strip),
    items: (draft.items || []).map(strip),
    modules: draft.modules || {},
    points: draft.points || null,
    error: draft.error || ''
  }));

}

/*
 * What the content side reads of the competitions (no answers, no secret): the picture uses
 * (Media.gs mediaUsage_ — a picture a competition uses is never purged) and the slugs
 * (Items.gs: a notification may open a competition). Sent with the signature.
 */
function compView_() {

  var draft = compDraft_();

  if (!draft || draft.error) return null;

  return {
    comps: (draft.comps || []).map(function (c) { return { id: c.id, slug: c.slug, title: c.title, banner: c.banner, icon: c.icon }; }),
    questions: (draft.questions || []).map(function (q) { return { compId: q.compId, media: q.media, explanationMedia: q.explanationMedia }; }),
    items: (draft.items || []).map(function (i) { return { id: i.id, name: i.name, image: i.image }; })
  };

}

/* after an admin call (Api.gs), outside every lock; never throws */
function compSigPush_() {

  try {
    if (!contentWriterWorker_()) return false;
    var sig = compPackageSig_();
    var cache = CacheService.getScriptCache();
    if (cache.get(COMP_SIG_SENT_KEY) === sig) return false;
    contentWorkerPost_('/v1/sync/comp-sig', { sig: sig, view: compView_() });
    cache.put(COMP_SIG_SENT_KEY, sig, 21600);
    return true;
  }
  catch (error) {
    console.warn('comp sig: not sent: ' + ((error && error.message) || error));
    return false;
  }

}

/* the earliest competition time still ahead (a wall stamp): the part must be built again after it */
function compStableUntil_(draft, now) {

  var next = '';

  (draft && draft.comps || []).forEach(function (row) {
    var comp = compParseComp_(row);
    if (!comp.id || !comp.enabled || comp.archived) return;
    [comp.startAt, comp.endAt, comp.answersAt, comp.resultsAt].forEach(function (t) {
      var at = String(t || '').replace(' ', 'T');
      if (at && at > now && (!next || at < next)) next = at;
    });
  });

  return next;

}

/*
 * The competitions part, built here with the Worker's library rows (media: the
 * mediaIndex_ map the Worker's own build made). 'prepare' writes the snapshots.
 */
function compPackage_(mode, now, media, email) {

  if (typeof compDropDraft_ === 'function') compDropDraft_();

  var sig = compPackageSig_();
  var draft = compDraft_();

  if (!draft) return { sig: sig, view: null, none: true, built: null, errors: [], warnings: [], files: {}, reviewInfo: {}, stableUntil: '' };

  var errors = [];
  var warnings = [];
  var built = compBuildPublic_(draft, {
    media: media || {},
    now: now,
    // the version hash is KEYED with this script's competitions secret, as in Content.gs (never the Worker's)
    hash: typeof compKeyedHash_ === 'function' ? compKeyedHash_ : null,
    error: function (where, message) { errors.push({ where: where, message: message }); },
    warn: function (where, message) { warnings.push({ where: where, message: message }); }
  });

  var files = {};
  if (!errors.length) {
    var needShell = Object.keys(built.live).some(function (id) { return !built.live[id].comp || built.live[id].comp.liveVersion !== built.live[id].version; });
    files = compPublishFiles_(built, githubConfig_().siteUrl, now, needShell ? compShellText_() : '');
    if (mode === 'prepare') {
      withScriptLock_(30000, function () {
        compWriteSnapshots_(built, email, Utilities.formatDate(new Date(Date.now()), CONTENT_TIMEZONE, 'yyyy-MM-dd HH:mm'));
      });
    }
  }

  return {
    sig: sig,
    view: compView_(),
    none: false,
    built: built,
    errors: errors,
    warnings: warnings,
    points: draft.points || null,
    modules: draft.modules || {},
    files: files,
    reviewInfo: compReviewInfo_(built),
    stableUntil: compStableUntil_(draft, now)
  };

}

/* what went live in the Worker's publish (the same step C as Publish.gs) */
function compCommitFromWorker_(live, withdrawn, stamp) {

  var comps = { live: {}, withdrawn: Array.isArray(withdrawn) ? withdrawn : [] };

  Object.keys(live || {}).forEach(function (id) { comps.live[id] = { version: String(live[id]) }; });

  withScriptLock_(30000, function () {
    compAfterCommit_(comps, stamp);
  });

  return { ok: true };

}

/* doPost { fn: 'workerSync', args: [{ ts, sig, payload }] }: the Worker's signed question → its answer */
function workerSyncCall_(arg) {

  var secret = workerSyncSecret_();

  if (!secret || !contentWriterWorker_()) return { ok: false, error: 'off' };

  arg = arg || {};

  var ts = Number(arg.ts);
  var payload = typeof arg.payload === 'string' ? arg.payload : '';

  if (!ts || Math.abs(Date.now() - ts) > WORKER_SYNC_SKEW_MS || !payload) return { ok: false, error: 'auth' };
  if (String(arg.sig || '') !== 'v1=' + hmacHex_(secret, ts + '.' + payload)) return { ok: false, error: 'auth' };

  // a signed question is answered once
  var cache = CacheService.getScriptCache();
  var seen = 'wsync:' + String(arg.sig).slice(3, 43);
  if (cache.get(seen)) return { ok: false, error: 'replay' };
  cache.put(seen, '1', 600);

  var body = JSON.parse(payload);

  if (body.call === 'compPackage' && (body.mode === 'review' || body.mode === 'prepare')) {
    return { ok: true, result: compPackage_(body.mode, String(body.now || cairoNow_()), body.media || {}, String(body.by || '')) };
  }

  if (body.call === 'compCommit') {
    return { ok: true, result: compCommitFromWorker_(body.live, body.withdrawn, String(body.stamp || '')) };
  }

  return { ok: false, error: 'call' };

}


/* =========================================================
   THE RUNTIME ON THE WORKER (Phase 5B, docs/PHASE5-PLAN.md P5-8)
   ---------------------------------------------------------
   The competitions run on the Worker; their definitions are written here until
   Phase 6. Each live definition (with its key: a signed call, kept private there)
   goes over when it goes live, closes or is finalized. Never fails the caller: a
   lost push is sent again by the next change, or by workerRuntimeSeed().
========================================================= */

function compRuntimeEntry_(row) {

  var def = compDefinitionFor_(row.id, row.liveVersion);

  if (!def) return null;

  return {
    slug: row.slug,
    compId: row.id,
    version: row.liveVersion,
    def: def,
    closedAt: row.closedAt ? compWall_(row.closedAt) : '',
    finalizedAt: row.finalizedAt ? compWall_(row.finalizedAt) : ''
  };

}

/* the live ones among these ids (none = all); withdrawn: [{ slug }] */
function compRuntimePush_(ids, withdrawn) {

  try {

    if (!contentWriterWorker_()) return;

    var wanted = ids ? ids.reduce(function (map, id) { map[id] = true; return map; }, Object.create(null)) : null;
    var comps = compRows_(compSheet_('Competitions')).filter(function (row) {
      return row.liveVersion && (!wanted || wanted[row.id]);
    }).map(compRuntimeEntry_).filter(Boolean);

    if (!comps.length && !(withdrawn && withdrawn.length)) return;

    contentWorkerPost_('/v1/sync/comp-live', { comps: comps, withdrawn: withdrawn || [] });

  }
  catch (error) {
    console.warn('comp: runtime push failed');
  }

}

/* once, from the editor, at the move: every live competition and the store's prizes */
function workerRuntimeSeed() {

  assertAdmin_();

  compRuntimePush_(null, []);

  contentWorkerPost_('/v1/sync/store-import', {
    items: shopItems_().map(function (i) {
      return { id: i.id, name: i.name, description: i.description, cost: i.cost, stock: i.stock, perPerson: i.perPerson, category: i.category, order: i.order, active: i.active };
    })
  });

}
