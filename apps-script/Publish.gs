/**
 * PUBLISHING
 *
 * Draft (Sheet) -> buildPublicContent() -> one commit to GitHub containing
 * content.json and meeting.ics -> GitHub Pages redeploys (about a minute).
 * Competitions (CompPublish.gs) add their stubs and comp.json files to the
 * same commit; their private definitions go to the Snapshots tab first.
 *
 * Script Properties used (Project Settings > Script Properties):
 *   GITHUB_TOKEN   fine-grained token, this repository only,
 *                  "Contents: Read and write". Never sent to the browser.
 *   GITHUB_REPO    "owner/repo": StAthanasiosYouth/StAthanasiosYouth.github.io
 *   GITHUB_BRANCH  default "main"
 *   SITE_URL       public address, e.g. https://stathanasiosyouth.github.io/
 *
 * Written by the publisher:
 *   PUBLISHED_REVISION, PUBLISHED_AT, PUBLISHED_COMMIT
 */

var GITHUB_API = 'https://api.github.com';


/* =========================================================
   CONFIG
========================================================= */

function githubConfig_() {

  var props = PropertiesService.getScriptProperties();
  var repo = String(props.getProperty('GITHUB_REPO') || '').trim();

  return {
    token: String(props.getProperty('GITHUB_TOKEN') || '').trim(),
    repo: /^[\w.-]+\/[\w.-]+$/.test(repo) ? repo : '',
    branch: String(props.getProperty('GITHUB_BRANCH') || 'main').trim(),
    siteUrl: safeHttpsUrl(props.getProperty('SITE_URL') || '')
  };

}


/** Safe summary for the admin page (no token). */
function publicConfig_() {

  var config = githubConfig_();

  return {
    repo: config.repo,
    branch: config.branch,
    siteUrl: config.siteUrl,
    tokenSet: !!config.token,
    sheetUrl: spreadsheet_().getUrl()
  };

}


/* =========================================================
   GITHUB API
========================================================= */

function github_(method, path, body) {

  var config = githubConfig_();

  if (!config.token || !config.repo) {
    throw new Error('إعدادات GitHub ناقصة: لازم GITHUB_TOKEN و GITHUB_REPO في Script Properties.');
  }

  var options = {
    method: method,
    muteHttpExceptions: true,
    headers: {
      Authorization: 'Bearer ' + config.token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  };

  if (body !== undefined) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(body);
  }

  var response = UrlFetchApp.fetch(GITHUB_API + '/repos/' + config.repo + path, options);
  var code = response.getResponseCode();
  var text = response.getContentText();

  if (code >= 200 && code < 300) {
    return text ? JSON.parse(text) : null;
  }

  var detail = '';

  try {
    detail = JSON.parse(text).message || '';
  }
  catch (error) {
    detail = '';
  }

  var error = new Error(githubErrorMessage_(code, detail));
  error.status = code;
  throw error;

}


function githubErrorMessage_(code, detail) {

  if (code === 401) {
    return 'GitHub رفض التوكن (401). ممكن يكون انتهى أو اتكتب غلط.';
  }

  if (code === 403) {
    return 'التوكن مالوش صلاحية الكتابة على الريبو (403). لازم Contents: Read and write.';
  }

  if (code === 404) {
    return 'الريبو أو الفرع مش موجود أو التوكن مش شايفه (404).';
  }

  if (code === 409 || code === 422) {
    return 'GitHub رفض التعديل (' + code + '): ' + detail;
  }

  return 'خطأ من GitHub (' + code + ')' + (detail ? ': ' + detail : '');

}


/**
 * One commit with several files (Git Data API), so content.json,
 * meeting.ics and any new images always change together. Text files go
 * inline; binaries ({ path: base64 }) are uploaded as blobs first.
 * Returns the commit, or null when the files are already identical.
 */
/* several GitHub requests at once (UrlFetchApp.fetchAll): [{ method, path, body }] → parsed answers, in order */
function githubAll_(requests) {

  if (!requests.length) return [];

  var config = githubConfig_();

  if (!config.token || !config.repo) {
    throw new Error('إعدادات GitHub ناقصة: لازم GITHUB_TOKEN و GITHUB_REPO في Script Properties.');
  }

  var responses = UrlFetchApp.fetchAll(requests.map(function (r) {
    var options = {
      url: GITHUB_API + '/repos/' + config.repo + r.path,
      method: r.method,
      muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + config.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
    };
    if (r.body !== undefined) {
      options.contentType = 'application/json';
      options.payload = JSON.stringify(r.body);
    }
    return options;
  }));

  return responses.map(function (response) {
    var code = response.getResponseCode();
    var text = response.getContentText();
    if (code >= 200 && code < 300) return text ? JSON.parse(text) : null;
    var detail = '';
    try { detail = JSON.parse(text).message || ''; } catch (ignored) { detail = ''; }
    var error = new Error(githubErrorMessage_(code, detail));
    error.status = code;
    throw error;
  });

}

function githubCommitFiles_(files, message, binaries) {

  var branch = githubConfig_().branch;
  var paths = Object.keys(binaries || {});

  paths.forEach(function (path) {
    if (!MEDIA_PATH.test(path) && !VIDEO_PATH.test(path) && !VIDEO_POSTER_PATH.test(path) && !AUDIO_PATH.test(path)) {
      throw new Error('مسار صورة أو ملف مش مسموح: ' + path);
    }
  });

  // blobs are content-addressed (they survive a retry below), uploaded side by side
  var blobEntries = githubAll_(paths.map(function (path) {
    return { method: 'post', path: '/git/blobs', body: { content: binaries[path], encoding: 'base64' } };
  })).map(function (blob, i) {
    return { path: paths[i], mode: '100644', type: 'blob', sha: blob.sha };
  });

  for (var attempt = 0; attempt < 2; attempt++) {

    // the branch: its head commit and that commit's tree in one answer
    var head = github_('get', '/branches/' + encodeURIComponent(branch));
    var parentSha = head.commit.sha;
    var parent = { tree: { sha: head.commit.commit.tree.sha } };

    var tree = github_('post', '/git/trees', {
      base_tree: parent.tree.sha,
      tree: Object.keys(files).map(function (path) {
        return { path: path, mode: '100644', type: 'blob', content: files[path] };
      }).concat(blobEntries)
    });

    if (tree.sha === parent.tree.sha) {
      return null;
    }

    var identity = { name: 'Athanasius Portal Admin', email: 'portal-admin@users.noreply.github.com' };

    var commit = github_('post', '/git/commits', {
      message: message,
      tree: tree.sha,
      parents: [parentSha],
      author: identity,
      committer: identity
    });

    try {
      github_('patch', '/git/refs/heads/' + encodeURIComponent(branch), { sha: commit.sha, force: false });
      return commit;
    }
    catch (error) {
      // someone pushed in between: rebuild on top of the new head once
      if (error.status !== 422 || attempt === 1) {
        throw error;
      }
    }

  }

  return null;

}


/** The content.json currently in the repository (null if none yet). */
function fetchPublishedContent_() {

  try {
    var file = github_('get', '/contents/content.json?ref=' + encodeURIComponent(githubConfig_().branch));
    var text = Utilities.newBlob(Utilities.base64Decode(String(file.content).replace(/\s/g, ''))).getDataAsString('UTF-8');
    return JSON.parse(text);
  }
  catch (error) {
    if (error.status === 404) {
      return null;
    }
    throw error;
  }

}


/* =========================================================
   BUILD + STATUS
========================================================= */

function sha256Hex_(text) {

  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(function (byte) {
      var value = (byte < 0 ? byte + 256 : byte).toString(16);
      return value.length === 1 ? '0' + value : value;
    })
    .join('');

}


function cairoNow_(date) {

  return Utilities.formatDate(date || new Date(Date.now()), CONTENT_TIMEZONE, "yyyy-MM-dd'T'HH:mm");

}


function buildDraft_() {

  return buildPublicContent(readDraft_(), {
    now: cairoNow_(),
    hash: sha256Hex_
  });

}


function publishStatus_(built) {

  var props = PropertiesService.getScriptProperties();
  var published = liveRevision_();      // 'worker' mode: the Worker's (WorkerSync.gs)

  built = built || buildDraft_();

  return {
    draftRevision: built.content.revision,
    publishedRevision: published,
    publishedAt: props.getProperty('PUBLISHED_AT') || '',
    publishedCommit: props.getProperty('PUBLISHED_COMMIT') || '',
    hasChanges: built.content.revision !== published,
    errors: built.errors,
    warnings: built.warnings
  };

}


/* =========================================================
   API (called from the admin page)
========================================================= */

/** What publishing would change, compared with the live content.json. */
/*
 * The content.json this script last committed (CacheService, set by the publish), when it is
 * still the published revision; else null (then GitHub is asked). Saves the review a round trip.
 */
var LAST_PUBLISHED_KEY = 'pub:content';

function lastPublished_() {

  try {
    var text = CacheService.getScriptCache().get(LAST_PUBLISHED_KEY);
    var content = text ? JSON.parse(text) : null;
    var revision = PropertiesService.getScriptProperties().getProperty('PUBLISHED_REVISION') || '';
    return content && revision && content.revision === revision ? content : null;
  }
  catch (ignored) {
    return null;
  }

}

function rememberPublished_(content) {

  try {
    var text = JSON.stringify(content);
    if (text.length < 95000) CacheService.getScriptCache().put(LAST_PUBLISHED_KEY, text, 21600);
  }
  catch (ignored) {
    // the review asks GitHub then
  }

}

function apiReview() {

  return tableScope_(reviewNow_);

}

function reviewNow_() {

  assertAdmin_();

  // the review and the publish read the competitions spreadsheet itself, never a cached copy
  if (typeof compDropDraft_ === 'function') compDropDraft_();

  var built = buildDraft_();
  var published = null;
  var githubError = '';

  try {
    // 'worker' mode: the diff is against what the Worker serves (GitHub follows a minute later; a restore changes it)
    published = (publishMode_() === 'worker' ? workerLiveContent_(true) : null) || lastPublished_() || fetchPublishedContent_();
  }
  catch (error) {
    githubError = error.message;
  }

  var entries = published || !githubError
    ? describeChanges(published, built.content, cairoNow_(), { competitions: typeof compReviewInfo_ === 'function' ? compReviewInfo_(built.competitions) : {} })
    : [];

  return {
    revision: built.content.revision,
    changes: entries.map(function (e) { return e.text + (e.when ? ' — ' + e.when : ''); }),
    groups: groupChanges_(entries),
    errors: built.errors,
    warnings: built.warnings,
    githubError: githubError
  };

}


/**
 * The draft exactly as the public page would receive it, as of a Cairo
 * moment ("YYYY-MM-DD HH:MM", default now): for the admin's preview only.
 * Nothing is written or published. Images not on the site yet are listed
 * (id, path, thumb) so the admin can show its own previews of them.
 */
function apiPreview(at) {

  assertAdmin_();

  var when = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/.test(String(at || '')) ? String(at).replace(' ', 'T') : cairoNow_();
  var built = buildPublicContent(readDraft_(), { now: when, hash: sha256Hex_ });
  var used = built.media || [];

  // a video's preview is its poster (thumb); the admin never maps the video file itself
  var pending = readOptionalTable_('Media').filter(function (row) {
    return used.indexOf(row.id) !== -1 && !row.publishedAt;
  }).map(function (row) {
    return /^vid-/.test(row.id)
      ? { id: row.id, path: row.path, thumb: row.thumb, kind: 'video' }
      : { id: row.id, path: row.path, thumb: row.thumb || row.path };
  });

  return {
    at: when,
    content: built.content,
    pending: pending,
    errors: built.errors,
    warnings: built.warnings
  };

}


/* does a used library file still wait to go to the site (never published)? */
function mediaWaiting_(usedIds) {

  if (!usedIds || !usedIds.length) return false;

  return readOptionalTable_('Media').some(function (row) {
    return usedIds.indexOf(row.id) !== -1 && !row.publishedAt && !row.deletedAt;
  });

}


/*
 * Publishing in three steps, so the script lock (which submissions,
 * redemptions, points and seasons share) is never held during the GitHub or
 * Drive work (docs/COMPETITIONS.md §18.1):
 *
 *   A. lock (short): build from the draft, check the reviewed revision,
 *      write the competitions' snapshots, take the publish claim; release.
 *   B. no lock: read the live site, the media bytes from Drive, the
 *      competition shell; one GitHub commit.
 *   C. lock (short): what happens only after the commit landed (media
 *      publishedAt, competitions' liveVersion, PUBLISHED_*, log, activity).
 *
 * The claim (CacheService) keeps a second publish from starting while one is
 * in step B; it dies by itself after PUBLISH_CLAIM_SECONDS.
 */

var PUBLISH_CLAIM_KEY = 'publish:claim';
var PUBLISH_CLAIM_SECONDS = 600;

/* the claim's token, or throws «a publish is running» */
function publishClaim_() {

  var cache = CacheService.getScriptCache();

  if (cache.get(PUBLISH_CLAIM_KEY)) {
    throw appError_('فيه نشر شغال دلوقتي.', 'استنى دقيقة وجرّب تاني.');
  }

  var token = Utilities.getUuid();

  cache.put(PUBLISH_CLAIM_KEY, token, PUBLISH_CLAIM_SECONDS);

  return token;

}

/* drops the claim if it is still ours */
function publishDropClaim_(token) {

  try {
    var cache = CacheService.getScriptCache();
    if (token && cache.get(PUBLISH_CLAIM_KEY) === token) cache.remove(PUBLISH_CLAIM_KEY);
  }
  catch (ignored) {
    // it expires by itself
  }

}

/* fn() under the script lock, released right after */
function withScriptLock_(ms, fn) {

  var lock = LockService.getScriptLock();

  lock.waitLock(ms);

  try {
    return fn();
  }
  finally {
    lock.releaseLock();
  }

}


/**
 * Publishes the draft. expectedRevision is what the admin reviewed; if the
 * Sheet changed since then, publishing stops so nothing unreviewed goes live.
 */
function apiPublish(expectedRevision) {

  return tableScope_(function () { return publishNow_(expectedRevision); });

}

function publishNow_(expectedRevision) {

  var email = assertAdmin_();
  var now = new Date(Date.now());
  var stamp = Utilities.formatDate(now, CONTENT_TIMEZONE, 'yyyy-MM-dd HH:mm');

  // A. under the lock: the draft as reviewed, the snapshots, the claim
  var prep = withScriptLock_(30000, function () {

    if (typeof compDropDraft_ === 'function') compDropDraft_();

    var built = buildPublicContent(readDraft_(), {
      now: cairoNow_(now),
      hash: sha256Hex_,
      publishedAt: now.toISOString()
    });

    if (built.errors.length) {
      throw new Error('في أخطاء لازم تتصلح قبل النشر:\n' + built.errors.map(function (e) {
        return '• ' + e.where + ': ' + e.message;
      }).join('\n'));
    }

    if (!expectedRevision || expectedRevision !== built.content.revision) {
      throw new Error('البيانات اتغيرت بعد ما راجعتها. افتح المراجعة تاني قبل النشر.');
    }

    var token = publishClaim_();
    var comps = built.competitions || null;

    // competitions (CompPublish.gs): the definitions this publish makes live
    // (content-addressed, so writing them before the commit is harmless)
    if (comps) {
      compWriteSnapshots_(comps, email, stamp);
    }

    return { built: built, comps: comps, token: token };

  });

  var built = prep.built;
  var comps = prep.comps;
  var config = githubConfig_();
  var commit = null;
  var mediaIds = [];
  var unchanged = false;
  var files = null;
  var mode = publishMode_();          // github | shadow | worker (WorkerSync.gs)
  var worker = null;                  // 'worker': the Worker's reply (live there; GitHub follows)
  var landed = false;                 // the visible content changed (a commit, or new files on the Worker)

  try {

    // B. no lock: the network work. What is live: the revision this script last published
    // (asked from GitHub only when it doesn't know; a moved branch is handled by the commit itself)
    var known = PropertiesService.getScriptProperties().getProperty('PUBLISHED_REVISION');
    // 'worker' mode: the Worker says (a restore may have changed it since this script's last publish)
    var workerLive = mode === 'worker' ? workerLiveContent_(true) : null;
    var liveRevision = workerLive ? workerLive.revision : known || ((fetchPublishedContent_() || {}).revision || '');

    // same visible content already live: no empty-change commit
    // (unless a picture still waits to go to the site: a store prize's is not in content.json)
    if (liveRevision === built.content.revision && !mediaWaiting_(built.media)) {

      unchanged = true;

    }
    else {

      files = {
        'content.json': JSON.stringify(built.content, null, 2) + '\n'
      };

      var ics = buildMeetingIcs(
        built.content,
        Utilities.formatDate(now, CONTENT_TIMEZONE, 'yyyy-MM-dd'),
        Utilities.formatDate(now, 'UTC', "yyyyMMdd'T'HHmmss'Z'"),
        config.siteUrl
      );

      if (ics) {
        files['meeting.ics'] = ics;
      }

      // competition/<slug>/index.html + comp.json (or the withdrawn comp.json): the same commit
      if (comps) {
        var compFiles = compPublishFiles_(comps, config.siteUrl, cairoNow_(now), Object.keys(comps.live).some(function (id) { return !comps.live[id].comp || comps.live[id].comp.liveVersion !== comps.live[id].version; }) ? compShellText_() : '');
        Object.keys(compFiles).forEach(function (path) { files[path] = compFiles[path]; });
      }

      // <slug>/ and events/<slug>/: stub + page.json / event.json, or the withdrawn JSON (Pages.gs)
      if (built.pages && typeof pagesPublishFiles_ === 'function') {
        var pageFiles = pagesPublishFiles_(built.pages, config.siteUrl, pagesNeedFiles_(built.pages) ? pagesShellText_() : '');
        Object.keys(pageFiles).forEach(function (path) { files[path] = pageFiles[path]; });
      }

      // images used by the content that aren't on the site yet
      var media = mediaForPublish_(built.media);

      mediaIds = media.ids;

      var message = 'Publish content ' + built.content.revision + ' (' + cairoNow_(now).replace('T', ' ') + ' Cairo)';

      if (mode === 'worker') {
        // pictures first, so the live revision never points at an image the site doesn't have yet;
        // then the Worker makes it live and commits the text files in the background (its mirror)
        if (Object.keys(media.binaries).length) {
          githubCommitFiles_({}, 'Publish media for ' + built.content.revision + ' (' + cairoNow_(now).replace('T', ' ') + ' Cairo)', media.binaries);
        }
        worker = publishToWorker_(files, built.content.revision, now.getTime(), email);
        try { CacheService.getScriptCache().remove(WORKER_LIVE_KEY); } catch (ignored) { /* 20 s */ }
      }
      else {
        // no personal data in the public commit history
        commit = githubCommitFiles_(files, message, media.binaries);
      }

    }

    landed = !!commit || !!(worker && !worker.unchanged);

    // C. under the lock: only what follows a commit that landed (or an
    // earlier publish that stopped right after its commit)
    withScriptLock_(30000, function () {

      mediaIds.forEach(function (id) {
        upsertRow_('Media', 'id', { id: id, publishedAt: nowStamp_() });
      });

      if (comps) {
        compAfterCommit_(comps, stamp);
      }

      if (built.pages && typeof pagesAfterCommit_ === 'function') {
        pagesAfterCommit_(built.pages, stamp);
      }

      var props = PropertiesService.getScriptProperties();

      if (unchanged) {
        props.setProperty('PUBLISHED_REVISION', built.content.revision);
        activity_({ action: 'publish', type: 'site', id: built.content.revision, title: '', ref: built.content.revision, changes: { unchanged: true } });
        return;
      }

      rememberPublished_(built.content);

      props.setProperties({
        PUBLISHED_REVISION: built.content.revision,
        PUBLISHED_AT: now.toISOString(),
        PUBLISHED_COMMIT: commit ? commit.sha : (props.getProperty('PUBLISHED_COMMIT') || '')
      });

      log_(email, 'publish', built.content.revision + (commit ? ' ' + commit.sha.slice(0, 7) : worker ? ' (worker)' : ' (no file change)'));
      activity_({ action: 'publish', type: 'site', id: built.content.revision, title: '', ref: built.content.revision + (commit ? ' ' + commit.sha.slice(0, 7) : ''), changes: landed ? activitySincePublish_() : { unchanged: true } });

    });

    // D. PUBLISH_MODE='shadow' (Phase 2): the same files to the Worker, still under the claim; never fails the publish
    if (commit && files) {
      publishShadow_(files, built.content.revision, now.getTime(), email);
    }

  }
  finally {
    publishDropClaim_(prep.token);
  }

  return {
    revision: built.content.revision,
    commit: commit ? commit.sha : '',
    commitUrl: commit ? 'https://github.com/' + config.repo + '/commit/' + commit.sha : '',
    siteUrl: config.siteUrl,
    unchanged: unchanged || !landed,
    // 'worker': live now; GitHub (the history and the static fallback) follows within a minute
    mirror: worker && !worker.unchanged ? 'pending' : '',
    state: apiStateFor_(email, built)
  };

}


var LIVE_FILE = 'live.json';

/* what the panel shows: the last live.json written from here, or null */
function liveState_() {

  var text = PropertiesService.getScriptProperties().getProperty('LIVE_STATE') || '';

  try {
    var value = text ? JSON.parse(text) : null;
    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value.date) && (value.stage === null || (typeof value.stage === 'number' && value.stage >= 0))) {
      return { schema: 1, date: value.date, stage: value.stage, updatedAt: String(value.updatedAt || '') };
    }
  }
  catch (ignored) {
    // a broken value = automatic
  }

  return null;

}


/**
 * date: the meeting ('YYYY-MM-DD'); stage: the program's stage index
 * that is happening now, or null = automatic again. Commits live.json only.
 */
function apiSetLiveStage(date, stage) {

  var email = assertAdmin_();
  var day = contentDigits_(date);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || contentDateTime_(day, false) === null) {
    throw appError_('تاريخ الاجتماع مش صحيح.', 'اعمل Refresh للصفحة.');
  }

  var index = stage === null || stage === undefined || stage === '' ? null : Number(stage);

  if (index !== null && !(isFinite(index) && index >= 0 && Math.round(index) === index && index < PROGRAM_LIMITS.stages)) {
    throw appError_('الفقرة دي مش موجودة في برنامج الاجتماع.', 'اعمل Refresh للصفحة.');
  }

  if (index !== null) {
    var session = readOptionalTable_('Sessions').filter(function (row) { return contentDigits_(row.date) === day; })[0];
    var stages = session ? programStages_(session.program).stages : [];
    if (!session || index >= stages.length) {
      throw appError_('الفقرة دي مش موجودة في برنامج الاجتماع.', 'افتح الاجتماع وراجع برنامجه، وانشر لو لسه ما اتنشرش.');
    }
  }

  var live = { schema: 1, date: day, stage: index, updatedAt: new Date().toISOString() };

  // only this one file changes (base tree = the current site). The commit is
  // made without the script lock (§18.1): two quick taps land in order
  // (githubCommitFiles_ retries once on a moved ref) and the last one wins.
  var files = {};
  files[LIVE_FILE] = JSON.stringify(live, null, 2) + '\n';

  var commit = githubCommitFiles_(files, 'Live stage ' + day + ': ' + (index === null ? 'automatic' : 'stage ' + (index + 1)));

  withScriptLock_(20000, function () {
    PropertiesService.getScriptProperties().setProperty('LIVE_STATE', JSON.stringify(live));
    log_(email, 'live.stage', day + ' ' + (index === null ? 'auto' : String(index)) + (commit ? ' ' + commit.sha.slice(0, 7) : ''));
    activity_({ action: 'live.stage', type: 'sessions', id: day, title: day, ref: commit ? commit.sha.slice(0, 7) : '', changes: { stage: index === null ? 'auto' : index + 1 } });
  });

  return { live: live, commit: commit ? commit.sha : '' };

}


/** Checks the GitHub setup without changing anything. */
function apiCheckGithub() {

  assertAdmin_();

  var config = githubConfig_();
  var repo = github_('get', '');
  var ref = github_('get', '/git/ref/heads/' + encodeURIComponent(config.branch));

  return {
    repo: repo.full_name,
    branch: config.branch,
    head: ref.object.sha.slice(0, 7),
    canPush: !repo.permissions || repo.permissions.push !== false,
    pages: repo.has_pages === true
  };

}
