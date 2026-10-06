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
    throw new Error('Google Drive رفض العملية (' + code + '). جرّب تاني بعد شوية.');
  }

  return response;

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

  var width = Math.round(Number(input.width));
  var height = Math.round(Number(input.height));

  if (!(width >= 1 && width <= MEDIA_LIMITS.maxSide && height >= 1 && height <= MEDIA_LIMITS.maxSide)) {
    throw new Error('مقاسات الصورة مش منطقية');
  }

  var problems = [];
  var alt = input_(input.alt, HUB_LIMITS.alt, 'وصف الصورة', problems, false);

  if (problems.length) {
    fail_(problems);
  }

  var id = 'img-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toLowerCase();
  var year = Utilities.formatDate(new Date(), CONTENT_TIMEZONE, 'yyyy');
  var ext = mime === 'image/webp' ? 'webp' : 'jpg';

  var record = {
    id: id,
    path: 'media/' + year + '/' + id + '.' + ext,
    thumb: 'media/' + year + '/' + id + '-480.' + ext,
    width: width,
    height: height,
    alt: alt,
    mime: mime,
    driveId: driveUpload_(full, mime, id + '.' + ext),
    thumbDriveId: driveUpload_(thumb, mime, id + '-480.' + ext),
    uploadedAt: nowStamp_(),
    publishedAt: ''
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

  assertAdmin_();
  validId_(id);

  var problems = [];
  var clean = input_(alt, HUB_LIMITS.alt, 'وصف الصورة', problems, false);

  if (problems.length) {
    fail_(problems);
  }

  return mutate_('media.alt', id, function () {
    if (!findRow_('Media', 'id', id)) {
      throw new Error('الصورة مش موجودة');
    }
    upsertRow_('Media', 'id', { id: id, alt: clean });
  });

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
