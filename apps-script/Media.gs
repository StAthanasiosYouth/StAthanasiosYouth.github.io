/**
 * MEDIA (posters and images)
 *
 * 1. The admin page resizes the photo in the browser (WebP or JPEG, max
 *    1600px, plus a 480px thumbnail) and sends both here.
 * 2. They are checked and stored as private drafts in a Drive folder the
 *    script creates itself. The "drive.file" scope means the script can
 *    only see files it created, not the rest of the admin's Drive.
 * 3. On publish, the images the published content uses are added to the
 *    same GitHub commit as content.json (Publish.gs), under media/YYYY/.
 *
 * Drive is used through its REST API (UrlFetchApp) because the built-in
 * DriveApp service requires full Drive access.
 */

var DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
var DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

var MEDIA_LIMITS = {
  fullBytes: 1600 * 1024,
  thumbBytes: 300 * 1024,
  tinyBytes: 24 * 1024,
  maxSide: 4000
};


/* =========================================================
   DRIVE REST
========================================================= */

function drive_(method, url, options) {

  options = options || {};

  var request = {
    method: method,
    muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
  };

  if (options.payload !== undefined) {
    request.contentType = options.contentType;
    request.payload = options.payload;
  }

  var response = UrlFetchApp.fetch(url, request);
  var code = response.getResponseCode();

  if (code < 200 || code >= 300) {
    throw driveError_(code, response.getContentText());
  }

  return response;

}


/**
 * Google's own answer, kept (it names the real cause: API disabled,
 * missing permission, folder gone, quota...), plus Arabic for the admin.
 */
function driveError_(code, text) {

  var reason = '';
  var message = '';

  try {
    var body = JSON.parse(text || '{}').error || {};
    message = String(body.message || '');
    reason = String((body.errors && body.errors[0] && body.errors[0].reason) || body.status || '');
  }
  catch (error) {
    message = String(text || '').slice(0, 300);
  }

  var details = 'Google Drive ' + code + (reason ? ' ' + reason : '') + (message ? ': ' + message : '');
  var disabled = /accessNotConfigured|SERVICE_DISABLED|has not been used|is disabled/i.test(reason + ' ' + message);

  var known =
    disabled ? ['خدمة Google Drive مش مفعّلة لمشروع لوحة التحكم.', 'ده إعداد في مشروع Apps Script نفسه، مش في الصورة. ابعت التفاصيل التقنية للدعم الفني.'] :
    code === 401 || reason === 'insufficientPermissions' || reason === 'authError' ? ['حسابك لسه مدّاش لوحة التحكم صلاحية حفظ الصور في Drive.', 'اقفل لوحة التحكم وافتحها تاني، ووافق على الصلاحيات لو اتطلبت.'] :
    code === 404 ? ['فولدر الصور في Drive مش موجود أو اتمسح.', 'جرّب ترفع الصورة تاني: هيتعمل فولدر جديد لوحده.'] :
    /storageQuotaExceeded|quotaExceeded/i.test(reason) ? ['مساحة Google Drive خلصت.', 'فضّي مساحة في Drive وجرّب تاني.'] :
    code === 429 || code >= 500 || /rateLimit/i.test(reason) ? ['Google Drive مشغول دلوقتي.', 'استنى دقيقة وجرّب تاني.'] :
    ['Google Drive رفض حفظ الصورة.', 'جرّب تاني بعد شوية. لو اتكررت، ابعت التفاصيل التقنية للدعم الفني.'];

  var error = appError_(known[0], known[1], details);
  error.driveCode = code;

  return error;

}


function mediaFolderId_() {

  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('MEDIA_FOLDER_ID');

  if (id) {
    return id;
  }

  var response = drive_('post', DRIVE_FILES + '?fields=id', {
    contentType: 'application/json',
    payload: JSON.stringify({
      name: 'أسرة البابا أثناسيوس – صور الموقع',
      mimeType: 'application/vnd.google-apps.folder'
    })
  });

  id = JSON.parse(response.getContentText()).id;
  props.setProperty('MEDIA_FOLDER_ID', id);

  return id;

}


function driveUpload_(bytes, mime, name) {

  try {
    return driveUploadOnce_(bytes, mime, name);
  }
  catch (error) {
    // the staging folder was deleted by hand: make a new one, once
    if (error.driveCode === 404 && PropertiesService.getScriptProperties().getProperty('MEDIA_FOLDER_ID')) {
      PropertiesService.getScriptProperties().deleteProperty('MEDIA_FOLDER_ID');
      return driveUploadOnce_(bytes, mime, name);
    }
    throw error;
  }

}


function driveUploadOnce_(bytes, mime, name) {

  var boundary = 'athanasios' + Utilities.getUuid().replace(/-/g, '');

  var head = '--' + boundary + '\r\n' +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify({ name: name, parents: [mediaFolderId_()] }) + '\r\n' +
    '--' + boundary + '\r\n' +
    'Content-Type: ' + mime + '\r\n\r\n';

  var tail = '\r\n--' + boundary + '--';

  var payload = Utilities.newBlob(head).getBytes()
    .concat(bytes)
    .concat(Utilities.newBlob(tail).getBytes());

  var response = drive_('post', DRIVE_UPLOAD + '?uploadType=multipart&fields=id', {
    contentType: 'multipart/related; boundary=' + boundary,
    payload: payload
  });

  return JSON.parse(response.getContentText()).id;

}


function driveDownloadBase64_(fileId) {

  if (!/^[\w-]{10,200}$/.test(fileId || '')) {
    throw new Error('ملف الصورة مش موجود في Drive');
  }

  var response = drive_('get', DRIVE_FILES + '/' + encodeURIComponent(fileId) + '?alt=media');

  return Utilities.base64Encode(response.getContent());

}


/* =========================================================
   CHECKS
========================================================= */

/** base64 -> bytes, refusing anything that isn't really a JPEG/WebP of a sane size. */
function decodeImage_(base64, mime, maxBytes, label) {

  if (typeof base64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error(label + ': بيانات الصورة مش سليمة');
  }

  var bytes = Utilities.base64Decode(base64);

  if (bytes.length > maxBytes) {
    throw new Error(label + ': حجمها كبير (' + Math.round(bytes.length / 1024) + ' KB)');
  }

  var b = function (i) { return bytes[i] & 0xff; };
  var ascii = function (from, to) {
    var out = '';
    for (var i = from; i < to; i++) out += String.fromCharCode(b(i));
    return out;
  };

  var ok = mime === 'image/jpeg'
    ? bytes.length > 3 && b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff
    : bytes.length > 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';

  if (!ok) {
    throw new Error(label + ': الملف مش صورة ' + (mime === 'image/jpeg' ? 'JPEG' : 'WebP'));
  }

  return bytes;

}


/* =========================================================
   API
========================================================= */

/**
 * input = { full: base64, thumb: base64, mime: 'image/webp'|'image/jpeg',
 *           width, height, alt }
 * Returns { media: { id, path, thumb, width, height, alt }, state }.
 */
function apiUploadMedia(input) {

  var email = assertAdmin_();

  input = input || {};

  var mime = input.mime === 'image/jpeg' || input.mime === 'image/webp' ? input.mime : '';

  if (!mime) {
    throw new Error('نوع الصورة لازم يكون WebP أو JPEG');
  }

  var full = decodeImage_(input.full, mime, MEDIA_LIMITS.fullBytes, 'الصورة');
  var thumb = decodeImage_(input.thumb, mime, MEDIA_LIMITS.thumbBytes, 'النسخة الصغيرة');
  var tinyMime = input.tinyMime === 'image/jpeg' || input.tinyMime === 'image/webp' ? input.tinyMime : mime;
  var tiny = input.tiny ? (decodeImage_(input.tiny, tinyMime, MEDIA_LIMITS.tinyBytes, 'الصورة المصغرة'), String(input.tiny)) : '';
  var color = /^#[0-9a-f]{6}$/i.test(String(input.color || '')) ? String(input.color).toLowerCase() : '';
  var hash = bytesHash_(full);

  // the same picture was uploaded before: use it, don't store a copy
  var same = readOptionalTable_('Media').filter(function (row) { return row.hash === hash && !row.deletedAt; })[0];

  if (same) {
    return {
      media: { id: same.id, path: same.path, thumb: same.thumb, width: same.width, height: same.height, alt: same.alt },
      duplicate: true,
      state: apiStateFor_(email),
      user: email
    };
  }

  var width = Math.round(Number(input.width));
  var height = Math.round(Number(input.height));

  if (!(width >= 1 && width <= MEDIA_LIMITS.maxSide && height >= 1 && height <= MEDIA_LIMITS.maxSide)) {
    throw new Error('مقاسات الصورة مش منطقية');
  }

  var problems = [];
  var alt = input_(input.alt, HUB_LIMITS.alt, 'وصف الصورة', problems, false);
  var name = input_(input.name, 80, 'اسم الصورة', problems, false);

  if (problems.length) {
    fail_(problems);
  }

  var id = 'img-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toLowerCase();
  var year = Utilities.formatDate(new Date(), CONTENT_TIMEZONE, 'yyyy');
  var ext = mime === 'image/webp' ? 'webp' : 'jpg';

  var driveId, thumbDriveId;

  try {
    driveId = driveUpload_(full, mime, id + '.' + ext);
    thumbDriveId = driveUpload_(thumb, mime, id + '-480.' + ext);
  }
  catch (error) {
    // failures are visible in the Log tab, with Google's own reason
    log_(email, 'media.upload.failed', errorDetails_(error));
    throw error;
  }

  var record = {
    id: id,
    path: 'media/' + year + '/' + id + '.' + ext,
    thumb: 'media/' + year + '/' + id + '-480.' + ext,
    width: width,
    height: height,
    alt: alt,
    mime: mime,
    driveId: driveId,
    thumbDriveId: thumbDriveId,
    uploadedAt: nowStamp_(),
    publishedAt: '',
    name: name,
    tiny: tiny,
    color: color,
    hash: hash,
    bytes: full.length
  };

  var state = mutate_('media.upload', id, function () {
    ensureTable_('Media');
    upsertRow_('Media', 'id', record);
    return id + ' ' + Math.round(full.length / 1024) + 'KB';
  });

  return {
    media: { id: id, path: record.path, thumb: record.thumb, width: width, height: height, alt: alt },
    state: state,
    user: email
  };

}


/* =========================================================
   CHECK (run from the editor, or «اختبر رفع الصور» in Settings)
========================================================= */

/* the smallest valid WebP: 1x1 lossless */
var CHECK_WEBP_BASE64 = 'UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';


/**
 * Walks every step a poster upload takes, against the real Google Drive,
 * and reports which step fails and Google's exact reason. Leaves nothing
 * behind (the test file is deleted).
 */
function checkMedia() {

  assertAdmin_();

  var report = runMediaCheck_();
  var text = report.steps.map(function (step) {
    return (step.ok ? '✓ ' : '✗ ') + step.label + (step.detail ? ' — ' + step.detail : '');
  }).join('\n') + '\n' + (report.ok ? 'كله تمام: رفع الصور شغال.' : 'فيه مشكلة في الخطوة اللي عليها ✗');

  console.log(text);

  return text;

}


function apiCheckMedia() {

  assertAdmin_();

  return runMediaCheck_();

}


function runMediaCheck_() {

  var email = currentEmail_();
  var steps = [];
  var testId = null;

  function step(label, action) {
    if (steps.length && !steps[steps.length - 1].ok) {
      return null;
    }
    try {
      var detail = action();
      steps.push({ label: label, ok: true, detail: detail || '' });
      return true;
    }
    catch (error) {
      steps.push({ label: label, ok: false, detail: errorDetails_(error) });
      return false;
    }
  }

  step('صلاحية Drive في حسابك', function () {
    var response = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo', {
      method: 'post',
      payload: { access_token: ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    var scopes = String((JSON.parse(response.getContentText() || '{}')).scope || '');
    if (scopes.indexOf('https://www.googleapis.com/auth/drive.file') === -1) {
      throw appError_('صلاحية drive.file مش موجودة', '', 'granted scopes: ' + (scopes || '(none)'));
    }
    return 'drive.file';
  });

  step('فولدر الصور', function () {
    var id = PropertiesService.getScriptProperties().getProperty('MEDIA_FOLDER_ID');
    if (id) {
      try {
        var meta = JSON.parse(drive_('get', DRIVE_FILES + '/' + encodeURIComponent(id) + '?fields=id,trashed').getContentText());
        if (!meta.trashed) {
          return 'موجود';
        }
      }
      catch (error) {
        if (error.driveCode !== 404) {
          throw error;
        }
      }
      PropertiesService.getScriptProperties().deleteProperty('MEDIA_FOLDER_ID');
    }
    mediaFolderId_();
    return 'اتعمل فولدر جديد';
  });

  step('رفع ملف تجربة صغير', function () {
    testId = driveUpload_(Utilities.base64Decode(CHECK_WEBP_BASE64), 'image/webp', '_check-' + Utilities.getUuid().slice(0, 8) + '.webp');
    return '';
  });

  step('قراءة الملف من Drive', function () {
    if (driveDownloadBase64_(testId) !== CHECK_WEBP_BASE64) {
      throw appError_('الملف رجع مختلف عن اللي اترفع', '', 'content mismatch');
    }
    return '';
  });

  step('مسح ملف التجربة', function () {
    drive_('delete', DRIVE_FILES + '/' + encodeURIComponent(testId));
    return '';
  });

  step('شيت الصور (Media)', function () {
    ensureTable_('Media');
    return readTable_('Media').length + ' صورة';
  });

  var ok = steps.every(function (s) { return s.ok; });

  log_(email, ok ? 'media.check' : 'media.check.failed', steps.map(function (s) {
    return (s.ok ? 'ok ' : 'FAIL ') + s.label + (s.detail ? ': ' + s.detail : '');
  }).join(' | '));

  return { ok: ok, steps: steps };

}


/* =========================================================
   LIBRARY
========================================================= */

function bytesHash_(bytes) {

  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); })
    .join('');

}


/**
 * Where each image is used: { id: [{ area, key, label }] }.
 * area: sessions / news / games / notifications / activities / sections / types
 */
function mediaUsage_() {

  var usage = Object.create(null);

  function add(id, area, key, label) {
    id = contentLine_(id);
    if (!id) return;
    (usage[id] = usage[id] || []).push({ area: area, key: String(key), label: label });
  }

  readOptionalTable_('Sessions').forEach(function (r) { add(r.image, 'sessions', r.date, 'اجتماع ' + r.date + (r.topic ? ' — ' + r.topic : '')); });
  readOptionalTable_('News').forEach(function (r) { add(r.image, 'news', r.id, 'خبر: ' + r.title); });
  readOptionalTable_('Games').forEach(function (r) { add(r.image, 'games', r.id, 'لعبة: ' + r.title); });
  readOptionalTable_('Notifications').forEach(function (r) { add(r.image, 'notifications', r.id, 'إشعار: ' + r.title); });
  readOptionalTable_('Activities').forEach(function (r) { add(r.image, 'activities', r.id, 'فعالية: ' + r.title); });
  readOptionalTable_('Types').forEach(function (r) { add(r.banner, 'types', r.key, 'بانر النوع: ' + r.label); });
  readTable_('Sections').forEach(function (r) { add(r.banner, 'sections', r.key, 'بانر القسم: ' + r.title); });

  return usage;

}


/** Everything in the library (tiny thumbnails included), with where it's used. */
function apiMediaLibrary() {

  assertAdmin_();

  var usage = mediaUsage_();

  return {
    items: readOptionalTable_('Media').map(function (r) {
      return {
        id: r.id,
        name: r.name || '',
        alt: r.alt || '',
        width: r.width,
        height: r.height,
        bytes: r.bytes || '',
        color: r.color || '',
        tiny: r.tiny ? 'data:' + (r.mime || 'image/webp') + ';base64,' + r.tiny : '',
        uploadedAt: r.uploadedAt || '',
        publishedAt: r.publishedAt || '',
        deletedAt: r.deletedAt || '',
        thumbUrl: r.publishedAt ? r.thumb : '',
        usage: usage[r.id] || []
      };
    }).reverse(),
    usage: usage
  };

}


function findMedia_(id) {

  validId_(id);

  var row = readOptionalTable_('Media').filter(function (r) { return r.id === id; })[0];

  if (!row) {
    throw new Error('الصورة مش موجودة');
  }

  return row;

}


/** Name and description. */
function apiUpdateMedia(id, input) {

  assertAdmin_();
  findMedia_(id);
  input = input || {};

  var problems = [];
  var record = { id: id };

  if (input.name !== undefined) record.name = input_(input.name, 80, 'اسم الصورة', problems, false);
  if (input.alt !== undefined) record.alt = input_(input.alt, HUB_LIMITS.alt, 'وصف الصورة', problems, false);

  if (problems.length) {
    fail_(problems);
  }

  return mutate_('media.update', id, function () {
    upsertRow_('Media', 'id', record);
  });

}


/*
 * Removing an image: refused while anything uses it (the admin sees
 * where). Otherwise it goes to the bin (deletedAt) and can come back;
 * only «امسح نهائي» removes the files from Drive. Files already on the
 * site stay there (old shared links keep working).
 */
function apiDeleteMedia(id) {

  assertAdmin_();
  findMedia_(id);

  var used = mediaUsage_()[id] || [];

  if (used.length) {
    throw appError_('الصورة دي مستخدمة، ومينفعش تتشال.', 'مستخدمة في: ' + used.map(function (u) { return u.label; }).join('، ') + '. غيّرها هناك الأول.', '', 'usage');
  }

  return mutate_('media.delete', id, function () {
    upsertRow_('Media', 'id', { id: id, deletedAt: nowStamp_() });
  });

}


function apiRestoreMedia(id) {

  assertAdmin_();
  findMedia_(id);

  return mutate_('media.restore', id, function () {
    upsertRow_('Media', 'id', { id: id, deletedAt: '' });
  });

}


/** Only from the bin, only when unused: the Drive files and the row go. */
function apiPurgeMedia(id) {

  assertAdmin_();

  var row = findMedia_(id);

  if (!row.deletedAt) {
    throw appError_('شيل الصورة الأول، وبعدين امسحها نهائي من «المحذوفة».', '');
  }

  if ((mediaUsage_()[id] || []).length) {
    throw appError_('الصورة رجعت اتستخدمت، ومينفعش تتمسح.', '');
  }

  return mutate_('media.purge', id, function () {
    [row.driveId, row.thumbDriveId].forEach(function (fileId) {
      if (!fileId) return;
      try {
        drive_('delete', DRIVE_FILES + '/' + encodeURIComponent(fileId));
      }
      catch (error) {
        // already gone from Drive is fine
        if (error.driveCode !== 404) throw error;
      }
    });
    deleteRow_('Media', 'id', id);
    return id + (row.publishedAt ? ' (الملف على الموقع فضل زي ما هو)' : '');
  });

}


/** Thumbnail of a draft image for the admin preview (data URL). */
function apiMediaPreview(id) {

  assertAdmin_();
  validId_(id);

  var row = readOptionalTable_('Media').filter(function (r) { return r.id === id; })[0];

  if (!row) {
    throw new Error('الصورة مش موجودة');
  }

  return 'data:' + (row.mime || 'image/webp') + ';base64,' + driveDownloadBase64_(row.thumbDriveId || row.driveId);

}


function apiSetMediaAlt(id, alt) {

  return apiUpdateMedia(id, { alt: alt });

}


/**
 * Files to add to the publish commit: images the content uses that aren't
 * on the site yet. Returns { binaries: { path: base64 }, ids: [mediaId] }.
 */
function mediaForPublish_(usedIds) {

  var rows = readOptionalTable_('Media');
  var binaries = {};
  var ids = [];

  (usedIds || []).forEach(function (id) {
    var row = rows.filter(function (r) { return r.id === id; })[0];
    if (!row || row.publishedAt) {
      return;
    }
    binaries[row.path] = driveDownloadBase64_(row.driveId);
    if (row.thumb && row.thumb !== row.path) {
      binaries[row.thumb] = driveDownloadBase64_(row.thumbDriveId);
    }
    ids.push(id);
  });

  return { binaries: binaries, ids: ids };

}
