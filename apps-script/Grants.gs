/* =========================================================
   ADMIN PERMISSIONS (Phase 1.5 step 2)
   docs/BOOKING-PHASE1-COMPLETION-PLAN.md §4.3
   ---------------------------------------------------------
   D1 owns admins + grants (worker/src/lib/perms.js). This file:

   - pulls the signed snapshot POST /v1/sync/grants, keeps it 60 s in the
     script cache and a last-good copy in the Script Property GRANTS_LAST_GOOD
     (used when the Worker can't be reached; never thrown away for its age);
   - assertCan_(perm): the one check. The Primary Admin holds everything.
     PERMS_ENFORCE on (in the snapshot) → the admin's grants only. Off, or no
     snapshot at all → every admin on the allowlist holds everything except
     the Primary-Admin defaults (account management, notification settings,
     participants.manage), exactly like the Worker;
   - API_PERMS: one api* function → permission table. doPost (Api.gs) checks
     it for every call; a function missing here is refused (default-deny;
     tests/grants.test.mjs checks the table against apiFunctions_());
   - the ADMIN_EMAILS mirror: D1 owns the accounts («الصلاحيات»); when its
     active admins differ from ADMIN_EMAILS, D1's list is written there, so the
     login gate (isAdmin_) is unchanged. Whoever left loses their name, admin
     push devices and trusted devices (adminCleanup_, Auth.gs). Never empty,
     never without the Primary Admin, never over MAX_ADMINS.
========================================================= */

var GRANTS_CACHE_KEY = 'grants:v1';
var GRANTS_CACHE_S = 60;
var GRANTS_MISS = 'miss';                         // the Worker didn't answer: last-good until the next minute
var GRANTS_LAST_GOOD_KEY = 'GRANTS_LAST_GOOD';
var GRANTS_PRIMARY_DEFAULT = ['accounts.manage', 'notifications.manage', 'participants.manage'];
var ANY_ADMIN_PERM = '*';

/* api* function → the permission it needs (ANY_ADMIN_PERM: any admin on the allowlist) */
var API_PERMS = {
  // the panel itself, the admin's own session, name, devices and push
  apiState: '*', apiSessionStart: '*', apiSessionResume: '*', apiHeartbeat: '*', apiSessionEnd: '*',
  apiSetAdminName: '*', apiAdminPushSubscribe: '*', apiAdminPushUnsubscribe: '*', apiAdminPushDevices: '*',
  apiAdminPushRemoveDevice: '*', apiTrustDevice: '*', apiForgetDevice: '*',
  apiBadges: '*',                                 // the menu's numbers (AdminPlatform.gs), what the heartbeat brought before
  apiWorkerSession: '*',                          // the Worker checks its own routes (ROUTE_PERMS)

  // content, home, pages
  apiReview: 'content.view', apiPreview: 'content.view', apiPages: 'content.view', apiPage: 'content.view', apiPagePreview: 'content.view',
  apiSaveLink: 'content.edit', apiSetLinkEnabled: 'content.edit', apiMoveLink: 'content.edit',
  apiSaveSection: 'content.edit', apiSetSectionEnabled: 'content.edit', apiMoveSection: 'content.edit',
  apiSaveContact: 'content.edit', apiMoveContact: 'content.edit', apiSaveSettings: 'content.edit', apiResolveMapsUrl: 'content.edit',
  apiSaveItem: 'content.edit', apiImportPreview: 'content.edit', apiImportApply: 'content.edit', apiSetLiveStage: 'content.edit',
  apiSetItemArchived: 'content.edit', apiDuplicateItem: 'content.edit', apiSetItemEnabled: 'content.edit', apiHomeOrder: 'content.edit',
  apiPageSave: 'content.edit', apiPageSetEnabled: 'content.edit', apiPageArchive: 'content.edit', apiPageMediaSave: 'content.edit', apiPageMediaOrder: 'content.edit',
  apiDeleteLink: 'content.delete', apiDeleteSection: 'content.delete', apiDeleteContact: 'content.delete', apiDeleteItem: 'content.delete',
  apiPageDelete: 'content.delete', apiPageMediaDelete: 'content.delete',
  apiPublish: 'publish.publish', apiPublishRefresh: 'content.view',

  // media
  apiCheckMedia: 'media.view', apiMediaLibrary: 'media.view', apiMediaPreview: 'media.view',
  apiUploadMedia: 'media.add', apiUpdateMedia: 'media.add', apiSetMediaAlt: 'media.add', apiFetchMediaUrl: 'media.add', apiRestoreMedia: 'media.add',
  apiDeleteMedia: 'media.delete', apiPurgeMedia: 'media.delete',

  // system, accounts, activity, push
  apiCheckGithub: 'system.view', apiPlanMigration: 'system.manage', apiMigrate: 'system.manage',
  apiAdmins: 'accounts.view', apiAddAdmin: 'accounts.manage', apiRemoveAdmin: 'accounts.manage',
  apiActivity: 'activity.view',
  apiPushState: 'push.view', apiPushCheck: 'push.view', apiPushSchedule: 'push.view',
  apiSendPush: 'push.manage', apiPushAuto: 'push.manage', apiPushScheduleCancel: 'push.manage',

  // events, servants, payment numbers (§4.7: numbers = finance.manage; approval stays Primary-only in PayDest)
  apiEvents: 'events.view', apiEvent: 'events.view', apiServants: 'events.view',
  apiEventSave: 'events.edit', apiEventSetEnabled: 'events.edit', apiEventArchive: 'events.edit', apiServantSetActive: 'events.edit',
  apiEventDelete: 'events.delete',
  apiServantSave: 'finance.manage', apiPayMethodsSave: 'finance.manage', apiServantPayApprove: 'finance.manage',

  // competitions, seasons, age rules
  apiComps: 'competitions.view', apiComp: 'competitions.view', apiCompPreviewGrade: 'competitions.view', apiCompPreviewDefinition: 'competitions.view',
  apiCompSubmissions: 'competitions.view', apiCompSubmission: 'competitions.view', apiCompReviewQueue: 'competitions.view', apiCompResults: 'competitions.view',
  apiSeasons: 'competitions.view', apiSeasonClosePreview: 'competitions.view', apiAgeRules: 'competitions.view',
  apiCompCreate: 'competitions.add', apiCompDuplicate: 'competitions.add',
  apiCompSave: 'competitions.edit', apiCompSettings: 'competitions.edit', apiCompArchive: 'competitions.edit', apiCompClose: 'competitions.edit',
  apiCompQuestionSave: 'competitions.edit', apiCompQuestionDuplicate: 'competitions.edit', apiCompQuestionsReorder: 'competitions.edit',
  apiCompImportPreview: 'competitions.edit', apiCompImportApply: 'competitions.edit', apiSeasonSave: 'competitions.edit', apiAgeRulesSave: 'competitions.edit',
  apiCompDelete: 'competitions.delete', apiCompQuestionDelete: 'competitions.delete',
  apiCompFinalize: 'competitions.approve', apiCompGrade: 'competitions.approve', apiCompGradeGroup: 'competitions.approve',
  apiCompRegrade: 'competitions.approve', apiCompVoid: 'competitions.approve', apiSeasonClose: 'competitions.approve',
  apiCompExport: 'exports.export',

  // competition registry (participants.manage stays with the Primary Admin: nothing here needs it)
  apiParticipants: 'participants.view', apiParticipant: 'participants.view',
  apiParticipantsImportPreview: 'participants.add', apiParticipantsImportApply: 'participants.add', apiParticipantsUndoImport: 'participants.add',
  apiParticipantSave: 'participants.edit', apiParticipantSetActive: 'participants.edit', apiParticipantsAssign: 'participants.edit',
  apiParticipantCode: 'participants.edit', apiParticipantCodes: 'participants.edit', apiParticipantResetCode: 'participants.edit', apiParticipantsResetCodes: 'participants.edit',

  // points (wallet) and store
  apiWallet: 'points.view', apiWalletParticipant: 'points.view',
  apiWalletAdjust: 'points.edit', apiWalletSync: 'points.edit',
  apiShopItems: 'store.view', apiShopRedemptions: 'store.view', apiShopSchedule: 'store.view',
  apiShopItemSave: 'store.edit', apiShopScheduleSave: 'store.edit',
  apiShopItemDelete: 'store.delete',
  apiShopRedemptionStatus: 'store.approve'
};


/* a snapshot is usable when it has the shape the Worker sends */
function grantsValid_(s) {

  return !!s && s.v === 1 && Array.isArray(s.perms) && Array.isArray(s.admins) &&
    s.admins.every(function (a) { return a && typeof a.email === 'string' && typeof a.g === 'string' && a.g.length === s.perms.length; });

}

/* POST /v1/sync/grants, signed → the snapshot, or null on any doubt (never throws) */
function grantsFetch_() {

  try {

    var secret = workerSyncSecret_();
    if (!secret) return null;

    var body = '{"v":1}';
    var ts = String(Date.now());
    var response = UrlFetchApp.fetch(WORKER_API_URL + '/v1/sync/grants', {
      method: 'post',
      contentType: 'application/json; charset=utf-8',
      payload: Utilities.newBlob(body).getBytes(),
      headers: { 'x-sync-ts': ts, 'x-sync-signature': 'v1=' + hmacHex_(secret, ts + '.' + body) },
      muteHttpExceptions: true,
      followRedirects: false
    });

    if (response.getResponseCode() !== 200) {
      console.warn('grants: HTTP ' + response.getResponseCode());
      return null;
    }

    var reply = JSON.parse(response.getContentText());
    var snapshot = reply && reply.ok === true ? reply.data || reply : null;
    if (snapshot) delete snapshot.ok;
    return grantsValid_(snapshot) ? snapshot : null;

  }
  catch (error) {
    console.warn('grants: not fetched');
    return null;
  }

}

/*
 * The current snapshot: this request's copy → the 60-s cache → the Worker →
 * the last-good copy → null (then the allowlist alone decides, as before).
 */
function grantsSnapshot_() {

  if (API_REQUEST_ && API_REQUEST_.grants !== undefined) return API_REQUEST_.grants;

  var snapshot = grantsFresh_();

  if (!snapshot) {
    try {
      var last = JSON.parse(PropertiesService.getScriptProperties().getProperty(GRANTS_LAST_GOOD_KEY) || 'null');
      snapshot = grantsValid_(last) ? last : null;
    }
    catch (ignored) {
      snapshot = null;
    }
  }

  if (API_REQUEST_) API_REQUEST_.grants = snapshot;
  return snapshot;

}

/* this minute's snapshot: the 60-s cache, else the Worker (kept + mirrored); never the last-good copy */
function grantsFresh_() {

  var snapshot = null;
  var cache = CacheService.getScriptCache();
  var cached = cache.get(GRANTS_CACHE_KEY);

  if (cached && cached !== GRANTS_MISS) {
    try { snapshot = JSON.parse(cached); } catch (ignored) { snapshot = null; }
  }

  if (!snapshot && cached !== GRANTS_MISS) {
    if (!workerSyncSecret_()) return null;      // not set up: nothing to ask, nothing to remember as a miss
    snapshot = grantsFetch_();
    var props = PropertiesService.getScriptProperties();
    if (snapshot) {
      var text = JSON.stringify(snapshot);
      try { cache.put(GRANTS_CACHE_KEY, text, GRANTS_CACHE_S); } catch (ignored) { /* next call fetches again */ }
      try { if (props.getProperty(GRANTS_LAST_GOOD_KEY) !== text) props.setProperty(GRANTS_LAST_GOOD_KEY, text); } catch (ignored) { console.warn('grants: last-good not kept'); }
      grantsMirror_(snapshot);
    }
    else {
      try { cache.put(GRANTS_CACHE_KEY, GRANTS_MISS, GRANTS_CACHE_S); } catch (ignored) { /* fine */ }
    }
  }

  return snapshot;

}

var GRANTS_RECHECK_KEY = 'grants:recheck';

/*
 * ADMIN_EMAILS ← D1 now, whoever is asking. The mirror used to run only when a
 * non-primary admin's call needed a permission (the Primary never pulls), so
 * an account added in «الصلاحيات» could stay unknown here: refused at sign-in,
 * «مش في القايمة» on rename. Called where a missing email matters (the sign-in
 * gate, the rename, the admins list). force: skip the 60-s cache, at most once
 * a minute (a stranger signing in again and again costs one pull a minute).
 * Only a fresh snapshot counts, never the last-good copy (it could bring back
 * someone already removed). True when ADMIN_EMAILS changed.
 */
function grantsRefreshAllowlist_(force) {

  try {

    var cache = CacheService.getScriptCache();
    var before = adminEmails_().join(',');

    if (force && !cache.get(GRANTS_RECHECK_KEY)) {
      cache.put(GRANTS_RECHECK_KEY, '1', GRANTS_CACHE_S);
      cache.remove(GRANTS_CACHE_KEY);
    }

    var snapshot = grantsFresh_();     // a pull mirrors by itself; a cached one is mirrored here
    if (!snapshot) return false;
    if (API_REQUEST_) API_REQUEST_.grants = snapshot;
    grantsMirror_(snapshot);
    forgetAdminEmails_();
    return adminEmails_().join(',') !== before;

  }
  catch (error) {
    console.warn('grants: allowlist not refreshed');
    return false;
  }

}

/* 'all' | 'own' | '' — what `email` holds of `perm` */
function grantScope_(email, perm) {

  if (!email || !isAdmin_(email)) return '';
  if (perm === ANY_ADMIN_PERM || email === primaryAdmin_()) return 'all';

  var snapshot = grantsSnapshot_();
  var explicit = '';

  if (snapshot) {
    var index = snapshot.perms.indexOf(perm);
    var me = null;
    for (var i = 0; i < snapshot.admins.length; i++) {
      if (snapshot.admins[i].email === email) { me = snapshot.admins[i]; break; }
    }
    if (me && me.primary) return 'all';
    var letter = me && index !== -1 ? me.g.charAt(index) : '-';
    explicit = letter === 'A' ? 'all' : letter === 'O' ? 'own' : '';
    if (snapshot.enforce) return explicit;
  }

  if (explicit) return explicit;
  return GRANTS_PRIMARY_DEFAULT.indexOf(perm) === -1 ? 'all' : '';

}

/** Throws unless the signed-in admin holds `perm` (any scope); returns the scope held. */
function assertCan_(perm) {

  var email = assertAdmin_();
  var scope = grantScope_(email, perm);

  if (!scope) {
    throw apiError_('perm', 'مش مسموح لك تعمل ده.', 'الصلاحية دي مش عندك. اطلبها من الأدمن الأساسي.');
  }

  return scope;

}

/* doPost: the permission an api* call needs; unmapped = refused */
function assertApiPerm_(fn) {

  if (!Object.prototype.hasOwnProperty.call(API_PERMS, fn)) {
    throw apiError_('perm', 'مش مسموح لك تعمل ده.', 'الصلاحية دي مش عندك. اطلبها من الأدمن الأساسي.');
  }

  return assertCan_(API_PERMS[fn]);

}

/* ADMIN_EMAILS ← D1's active admins, when they differ. True when written. */
function grantsMirror_(snapshot) {

  try {

    var props = PropertiesService.getScriptProperties();
    var emails = snapshot.admins.map(function (a) { return normalizeEmail_(a.email); });
    var current = adminEmails_();
    var same = emails.length === current.length && emails.every(function (e) { return current.indexOf(e) !== -1; });

    if (same) return false;
    if (!emails.length || emails.length > MAX_ADMINS || emails.indexOf('') !== -1 || emails.indexOf(primaryAdmin_()) === -1) {
      console.warn('grants: mirror refused');
      return false;
    }

    var gone = current.filter(function (e) { return emails.indexOf(e) === -1; });
    var added = emails.filter(function (e) { return current.indexOf(e) === -1; });

    props.setProperty('ADMIN_EMAILS', emails.join(', '));
    forgetAdminEmails_();
    gone.forEach(adminCleanup_);
    // the audit row is D1's (accounts.add / accounts.remove, the unified «سجل النشاط»): none here
    console.log('grants: ADMIN_EMAILS mirrored (+' + added.length + ' −' + gone.length + ')');
    return true;

  }
  catch (error) {
    console.warn('grants: mirror failed');
    return false;
  }

}
