// Unused Sheet rows must never become records.
//
// setup() puts checkboxes down whole columns, and Google Sheets stores FALSE
// in every empty checkbox cell (the fake does the same). Those rows used to be
// read as records: 997 "section without a key" errors, ids stamped into ~2000
// empty Links/Contacts rows on every panel load, and new rows written past the
// end of the sheet.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './fakes/gas.mjs';

const ADMIN = 'menazakmena@gmail.com';
const plain = value => JSON.parse(JSON.stringify(value));

const TABLES = ['Settings', 'Sections', 'Links', 'Contacts', 'Sessions', 'News', 'Games', 'Notifications', 'Media', 'Activities', 'Types', 'Log'];

function world() {
  const w = createWorld();
  w.as(ADMIN).gs.setup();
  w.properties.set('GITHUB_TOKEN', 'test-token');
  w.properties.set('GITHUB_REPO', 'StAthanasiosYouth/StAthanasiosYouth.github.io');
  w.properties.set('SITE_URL', 'https://stathanasiosyouth.github.io/');
  return w;
}

const tab = (w, name) => w.spreadsheet.getSheetByName(name);
const col = (w, name, column) => tab(w, name).data[0].indexOf(column) + 1;

// what older versions did on every panel load: an id in every "record" without one
function stampOldIds(w, name, prefix) {
  const sheet = tab(w, name);
  let n = 0;
  for (let row = 2; row <= sheet.getMaxRows(); row++) {
    const id = sheet.getRange(row, 1).getValue();
    if (!id) sheet.set(row, 1, `${prefix}-${(n++).toString(16).padStart(8, '0')}`);
  }
  return n;
}


test('the fake behaves like Sheets: empty checkbox rows hold FALSE down to row 1000', () => {
  const w = world();
  const sections = tab(w, 'Sections');
  assert.equal(sections.getMaxRows(), 1000);
  assert.equal(sections.getLastRow(), 1000, 'checkbox FALSE values reach the bottom');
  assert.equal(sections.getRange(500, col(w, 'Sections', 'enabled')).getValue(), false);
  assert.equal(sections.getRange(500, col(w, 'Sections', 'key')).getValue(), '');
});

test('Sections returns only its real rows, not 999', () => {
  const w = world();
  const rows = plain(w.gs.readTable_('Sections'));
  // 2 seed link groups, then the 10 built-in page sections added by the upgrade
  assert.deepEqual(rows.slice(0, 2).map(r => r.key), ['social', 'links']);
  assert.equal(rows.length, 12);
  assert.deepEqual(rows.map(r => r.__row), Array.from({ length: 12 }, (_, i) => i + 2));
});

test('no phantom rows in any table', () => {
  const w = world();
  const expected = {
    Settings: w.gs.SETTINGS_SPEC.length, Sections: 12, Links: 5, Contacts: 2,
    Sessions: 0, News: 0, Games: 0, Notifications: 0, Media: 0,
    Activities: 0, Types: w.gs.SEED_TYPES.length, Log: 2
  };
  for (const name of TABLES) {
    assert.equal(w.gs.readTable_(name).length, expected[name], name);
  }
});

test('the admin status has no errors and the panel gets only real rows', () => {
  const w = world();
  const state = plain(w.as(ADMIN).gs.apiState());
  assert.deepEqual(state.status.errors, []);
  assert.equal(state.draft.sections.length, 12);
  assert.equal(state.draft.links.length, 5);
  assert.equal(state.draft.contacts.length, 2);
  for (const kind of ['sessions', 'news', 'games', 'notifications', 'media']) {
    assert.equal(state.draft[kind].length, 0, kind);
  }
});

test('loading the panel writes nothing and stays small', () => {
  const w = world();
  w.gs.openSpreadsheet_ = null;  // a new request
  Object.assign(w.spreadsheet.stats, { cellsRead: 0, writes: 0, opens: 0 });
  const payload = JSON.stringify(w.as(ADMIN).gs.apiState());
  const { writes, opens } = w.spreadsheet.stats;
  assert.equal(writes, 0, 'no ids stamped into empty rows');
  assert.equal(opens, 1, 'the spreadsheet is opened once per request');
  assert.ok(payload.length < 20000, `payload ${payload.length} bytes`);
});

test('rows damaged by older versions (an id and nothing else) stay ignored', () => {
  const w = world();
  assert.equal(stampOldIds(w, 'Links', 'link'), 994);
  assert.equal(stampOldIds(w, 'Contacts', 'contact'), 997);
  const state = plain(w.as(ADMIN).gs.apiState());
  assert.equal(state.draft.links.length, 5);
  assert.equal(state.draft.contacts.length, 2);
  assert.deepEqual(state.status.errors, []);
});

test('a new record goes right after the last record, even with old ids and ticked boxes below', () => {
  const w = world();
  const gs = w.as(ADMIN).gs;
  stampOldIds(w, 'Links', 'link');
  // someone ticked "featured" on an empty row
  tab(w, 'Links').set(7, col(w, 'Links', 'featured'), true);
  tab(w, 'Sections').set(14, col(w, 'Sections', 'enabled'), true);

  gs.apiSaveSection({ key: 'events', title: 'فعاليات' }, true);
  assert.equal(tab(w, 'Sections').getRange(14, col(w, 'Sections', 'key')).getValue(), 'events', 'row 14 = after the 12 sections');

  const state = plain(gs.apiSaveLink({ title: 'جديد', url: 'https://example.org', section: 'events' }));
  const added = state.draft.links.find(l => l.title === 'جديد');
  assert.equal(tab(w, 'Links').getRange(7, col(w, 'Links', 'title')).getValue(), 'جديد', 'row 7 = after the 5 links');
  assert.equal(added.featured, false, 'a stray ticked box does not leak into the new record');
  assert.match(added.id, /^link-/);
  assert.equal(tab(w, 'Links').getMaxRows(), 1000, 'nothing written past the end');

  for (const kind of ['news', 'games', 'notifications']) {
    const input = {
      news: { title: 'خبر', summary: 'x' },
      games: { title: 'لعبة', url: 'https://example.org/g', startAt: '2026-10-11 22:00', endAt: '2026-10-11 23:00' },
      notifications: { title: 'تنبيه', message: 'x' }
    }[kind];
    const after = plain(gs.apiSaveItem(kind, input));
    assert.equal(after.draft[kind].length, 1, kind);
  }
  const sessions = plain(gs.apiSaveItem('sessions', { date: '2026-10-11', topic: 'موضوع' }));
  assert.equal(sessions.draft.sessions.length, 1);
  assert.equal(w.gs.readTable_('Sessions')[0].__row, 2);
  assert.deepEqual(plain(gs.apiReview()).errors, []);
});

test('the sheet grows by a row when the last row is a record', () => {
  const w = world();
  const sheet = tab(w, 'Sections');
  sheet.set(1000, col(w, 'Sections', 'key'), 'last');
  sheet.set(1000, col(w, 'Sections', 'title'), 'آخر صف');
  w.as(ADMIN).gs.apiSaveSection({ key: 'more', title: 'كمان' }, true);
  assert.equal(sheet.getMaxRows(), 1001);
  assert.equal(sheet.getRange(1001, col(w, 'Sections', 'key')).getValue(), 'more');
});

test('manual editing still works: a row typed by hand counts, a lone ticked box does not', () => {
  const w = world();
  const sheet = tab(w, 'Links');
  // typed by hand further down, no id, checkbox ticked
  sheet.set(20, col(w, 'Links', 'enabled'), true);
  sheet.set(20, col(w, 'Links', 'title'), 'يدوي');
  sheet.set(20, col(w, 'Links', 'url'), 'https://example.org/manual');
  sheet.set(20, col(w, 'Links', 'section'), 'links');
  sheet.set(30, col(w, 'Links', 'enabled'), true);
  sheet.set(40, col(w, 'Links', 'title'), '   ');
  const state = plain(w.as(ADMIN).gs.apiState());
  assert.equal(state.draft.links.length, 6);
  const manual = state.draft.links.find(l => l.title === 'يدوي');
  assert.match(manual.id, /^link-[0-9a-f]{8}$/, 'gets an id');
  assert.equal(manual.enabled, true);
  assert.deepEqual(state.status.errors, []);
  // the next record goes after the hand-typed one
  w.gs.apiSaveLink({ title: 'بعده', url: 'https://example.org/b', section: 'links' });
  assert.equal(sheet.getRange(21, col(w, 'Links', 'title')).getValue(), 'بعده');
});

test('new settings rows land after the last setting', () => {
  const w = world();
  const sheet = tab(w, 'Settings');
  const keyCol = col(w, 'Settings', 'key');
  const before = w.gs.readTable_('Settings');
  const last = before[before.length - 1].__row;
  // a setting row removed by hand comes back on save
  const removed = before.find(r => r.key === 'site.tagline');
  sheet.deleteRow(removed.__row);
  w.as(ADMIN).gs.apiSaveSettings({ 'site.tagline': 'سطر' });
  assert.equal(sheet.getRange(last, keyCol).getValue(), 'site.tagline');
  assert.equal(w.gs.readTable_('Settings').find(r => r.key === 'site.tagline').value, 'سطر');
});

test('checkSheet reports per tab; clearStrayIds empties only the old automatic ids', () => {
  const w = world();
  const gs = w.as(ADMIN).gs;
  stampOldIds(w, 'Links', 'link');
  stampOldIds(w, 'Contacts', 'contact');
  // a real row with an automatic-looking id must survive
  const realId = tab(w, 'Links').getRange(2, 1).getValue();

  const report = gs.checkSheet();
  assert.match(report, /Sections: 12 صف بيانات من 1000/);
  assert.match(report, /Links: 5 صف بيانات من 1000، معرّفات زيادة في صفوف فاضية: 994/);
  assert.match(report, /Contacts: 2 صف بيانات من 1000، معرّفات زيادة في صفوف فاضية: 997/);
  assert.match(report, /أخطاء: 0/);

  const before = plain(gs.apiState()).draft;
  Object.assign(w.spreadsheet.stats, { writes: 0 });
  gs.clearStrayIds();
  assert.ok(w.spreadsheet.stats.writes <= 4, `batched writes: ${w.spreadsheet.stats.writes}`);
  assert.equal(tab(w, 'Links').getRange(2, 1).getValue(), realId);
  assert.equal(tab(w, 'Links').getRange(500, 1).getValue(), '');
  assert.equal(tab(w, 'Contacts').getRange(999, 1).getValue(), '');
  assert.match(gs.checkSheet(), /Links: 5 صف بيانات من 1000، معرّفات زيادة في صفوف فاضية: 0/);
  assert.deepEqual(plain(gs.apiState()).draft, before, 'records unchanged');
});

test('checkSheet and clearStrayIds refuse non-admins', () => {
  const w = world().as('someone@gmail.com');
  assert.throws(() => w.gs.checkSheet(), /مش مسموح/);
  assert.throws(() => w.gs.clearStrayIds(), /مش مسموح/);
});
