// Poster upload diagnostics (Media.gs): Google's real reason reaches the
// admin, checkMedia() walks every step against Drive, failures are logged.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './fakes/gas.mjs';

const ADMIN = 'menazakmena@gmail.com';
const plain = value => JSON.parse(JSON.stringify(value));

const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x20, 0, 0, 0]), Buffer.from('WEBPVP8L'), Buffer.alloc(40, 7)]);

const DISABLED = {
  code: 403,
  body: {
    error: {
      code: 403,
      message: 'Google Drive API has not been used in project 1234 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=1234',
      errors: [{ reason: 'accessNotConfigured' }],
      status: 'PERMISSION_DENIED'
    }
  }
};

function world() {
  const w = createWorld();
  w.as(ADMIN).gs.setup();
  return w;
}

const uploadInput = () => ({ full: WEBP.toString('base64'), thumb: WEBP.toString('base64'), mime: 'image/webp', width: 1200, height: 1500, alt: '' });
const parsed = error => JSON.parse(error.message);
const logRows = w => w.spreadsheet.getSheetByName('Log').data.slice(1).map(r => `${r[2]} ${r[3]}`);


test('a disabled Drive API reaches the admin as Arabic + Google\'s exact reason', () => {
  const w = world();
  w.drive.failWith = DISABLED;
  let error;
  try { w.gs.apiUploadMedia(uploadInput()); } catch (e) { error = e; }
  const info = parsed(error);
  assert.equal(info.appError, 1);
  assert.match(info.message, /مش مفعّلة/);
  assert.match(info.details, /^Google Drive 403 accessNotConfigured: Google Drive API has not been used/);
  assert.ok(logRows(w).some(r => r.startsWith('media.upload.failed') && r.includes('accessNotConfigured')), 'logged');
  assert.equal(w.gs.readTable_('Media').length, 0, 'no half-made row');
});

test('other Drive answers get their own advice', () => {
  const w = world();
  const cases = [
    [{ code: 401, body: { error: { code: 401, message: 'Invalid Credentials', errors: [{ reason: 'authError' }] } } }, /صلاحية/],
    [{ code: 403, body: { error: { code: 403, message: 'quota', errors: [{ reason: 'storageQuotaExceeded' }] } } }, /مساحة/],
    [{ code: 503, body: 'Service Unavailable' }, /مشغول/]
  ];
  for (const [fail, pattern] of cases) {
    w.drive.failWith = fail;
    assert.throws(() => w.gs.apiUploadMedia(uploadInput()), error => pattern.test(parsed(error).message));
  }
});

test('a staging folder deleted by hand is recreated once', () => {
  const w = world();
  const gs = w.as(ADMIN).gs;
  gs.apiUploadMedia(uploadInput());
  const folder = w.properties.get('MEDIA_FOLDER_ID');
  w.drive.files.delete(folder);
  const other = Buffer.concat([WEBP.subarray(0, 16), Buffer.alloc(40, 9)]).toString('base64');
  const result = plain(gs.apiUploadMedia({ ...uploadInput(), full: other }));
  assert.match(result.media.id, /^img-[0-9a-f]{8}$/);
  assert.notEqual(w.properties.get('MEDIA_FOLDER_ID'), folder);
});

test('checkMedia: all steps pass and nothing is left in Drive', () => {
  const w = world();
  const report = plain(w.gs.apiCheckMedia());
  assert.equal(report.ok, true);
  assert.deepEqual(report.steps.map(s => s.ok), [true, true, true, true, true, true]);
  // only the folder remains
  assert.equal(w.drive.files.size, 1);
  assert.match(w.gs.checkMedia(), /كله تمام/);
  assert.ok(logRows(w).some(r => r.startsWith('media.check ')));
});

test('checkMedia: stops at the failing step with Google\'s reason', () => {
  const w = world();
  w.drive.failWith = DISABLED;
  const report = plain(w.gs.apiCheckMedia());
  assert.equal(report.ok, false);
  assert.equal(report.steps.length, 2, 'stops at the folder step');
  assert.equal(report.steps[1].ok, false);
  assert.match(report.steps[1].detail, /accessNotConfigured/);
  assert.ok(logRows(w).some(r => r.startsWith('media.check.failed')));
});

test('checkMedia: a token without drive.file is named', () => {
  const w = world();
  w.drive.grantedScopes = 'https://www.googleapis.com/auth/spreadsheets';
  const report = plain(w.gs.apiCheckMedia());
  assert.equal(report.steps[0].ok, false);
  assert.match(report.steps[0].detail, /drive\.file/);
});

test('technical details never carry a token', () => {
  const w = world();
  const clean = w.gs.cleanDetails_('Bearer ya29.abcDEF123 and token=xyz and ghp_' + 'a'.repeat(36));
  assert.ok(!/ya29|xyz|ghp_a/.test(clean), clean);
});

test('checkMedia refuses non-admins', () => {
  const w = world().as('someone@gmail.com');
  assert.throws(() => w.gs.checkMedia(), /مش مسموح/);
  assert.throws(() => w.gs.apiCheckMedia(), /مش مسموح/);
});
