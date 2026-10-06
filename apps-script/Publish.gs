/**
 * PUBLISHING
 *
 * Draft (Sheet) -> buildPublicContent() -> one commit to GitHub containing
 * content.json and meeting.ics -> GitHub Pages redeploys (about a minute).
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
function githubCommitFiles_(files, message, binaries) {

  var branch = githubConfig_().branch;

  // blobs are content-addressed, so they survive a retry below
  var blobEntries = Object.keys(binaries || {}).map(function (path) {
    if (!/^media\/\d{4}\/img-[a-z0-9]{8}(-480)?\.(webp|jpg)$/.test(path)) {
      throw new Error('مسار صورة مش مسموح: ' + path);
    }
    var blob = github_('post', '/git/blobs', { content: binaries[path], encoding: 'base64' });
    return { path: path, mode: '100644', type: 'blob', sha: blob.sha };
  });

  for (var attempt = 0; attempt < 2; attempt++) {

    var ref = github_('get', '/git/ref/heads/' + encodeURIComponent(branch));
    var parentSha = ref.object.sha;
    var parent = github_('get', '/git/commits/' + parentSha);

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

  return Utilities.formatDate(date || new Date(), CONTENT_TIMEZONE, "yyyy-MM-dd'T'HH:mm");

}


function buildDraft_() {

  return buildPublicContent(readDraft_(), {
    now: cairoNow_(),
    hash: sha256Hex_
  });

}


function publishStatus_(built) {

  var props = PropertiesService.getScriptProperties();
  var published = props.getProperty('PUBLISHED_REVISION') || '';

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
function apiReview() {

  assertAdmin_();

  var built = buildDraft_();
  var published = null;
  var githubError = '';

  try {
    published = fetchPublishedContent_();
  }
  catch (error) {
    githubError = error.message;
  }

  var entries = published || !githubError ? describeChanges(published, built.content, cairoNow_()) : [];

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
 * Publishes the draft. expectedRevision is what the admin reviewed; if the
 * Sheet changed since then, publishing stops so nothing unreviewed goes live.
 */
function apiPublish(expectedRevision) {

  var email = assertAdmin_();
  var lock = LockService.getScriptLock();

  lock.waitLock(30000);

  try {

    var now = new Date();
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

    var config = githubConfig_();
    var live = fetchPublishedContent_();

    // same visible content already live: don't make an empty-change commit
    if (live && live.revision === built.content.revision) {
      PropertiesService.getScriptProperties().setProperty('PUBLISHED_REVISION', built.content.revision);
      return {
        revision: built.content.revision,
        commit: '',
        commitUrl: '',
        siteUrl: config.siteUrl,
        unchanged: true,
        state: apiStateFor_(email, built)
      };
    }

    var files = {
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

    // images used by the content that aren't on the site yet
    var media = mediaForPublish_(built.media);

    // no personal data in the public commit history
    var commit = githubCommitFiles_(
      files,
      'Publish content ' + built.content.revision + ' (' + cairoNow_(now).replace('T', ' ') + ' Cairo)',
      media.binaries
    );

    // only after the commit landed
    media.ids.forEach(function (id) {
      upsertRow_('Media', 'id', { id: id, publishedAt: nowStamp_() });
    });

    var props = PropertiesService.getScriptProperties();

    props.setProperties({
      PUBLISHED_REVISION: built.content.revision,
      PUBLISHED_AT: now.toISOString(),
      PUBLISHED_COMMIT: commit ? commit.sha : (props.getProperty('PUBLISHED_COMMIT') || '')
    });

    log_(email, 'publish', built.content.revision + (commit ? ' ' + commit.sha.slice(0, 7) : ' (no file change)'));

    return {
      revision: built.content.revision,
      commit: commit ? commit.sha : '',
      commitUrl: commit ? 'https://github.com/' + config.repo + '/commit/' + commit.sha : '',
      siteUrl: config.siteUrl,
      unchanged: !commit,
      state: apiStateFor_(email, built)
    };

  }
  finally {
    lock.releaseLock();
  }

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
