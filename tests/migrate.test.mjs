// The schema-3 data upgrade (Migrate.gs), run against a Sheet shaped like
// the live one before the upgrade: old columns, no built-in section rows,
// no Activities/Types tabs, real content in it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyWorld, schema3World, OLD_COLUMNS } from './fakes/legacy.mjs';

const ADMIN = 'menazakmena@gmail.com';
const plain = value => JSON.parse(JSON.stringify(value));

/* every tab's cells, to prove what did or didn't change */
const snapshot = world => Object.fromEntries(world.spreadsheet.getSheets().map(s => [s.name, JSON.stringify(s.data)]));

const visibleContent = world => {
  const built = plain(world.gs.buildPublicContent(world.gs.readDraft_(), { now: '2026-10-08T12:00' }));
  const { schema, layout, revision, ...rest } = built.content;
  return { rest, errors: built.errors };
};


test('the legacy fixture really is the old shape', () => {
  const w = legacyWorld();
  const header = w.spreadsheet.getSheetByName('Sections').data[0].filter(Boolean);
  assert.deepEqual(header, OLD_COLUMNS.Sections);
  assert.equal(w.spreadsheet.getSheetByName('Activities'), null);
  assert.equal(w.gs.readTable_('Sections').length, 2);
  assert.equal(w.gs.readTable_('Links').length, 4);
});

test('planMigration only reads, and lists exactly the approved steps', () => {
  const w = legacyWorld();
  const before = snapshot(w);
  const plan = plain(w.as(ADMIN).gs.apiPlanMigration());
  assert.deepEqual(snapshot(w), before, 'nothing written');
  assert.equal(plan.pending, true);
  assert.deepEqual([plan.current, plan.target], [2, 4]);
  const steps = Object.fromEntries(plan.steps.map(s => [s.id, s]));
  assert.deepEqual(Object.keys(steps), ['tabs', 'columns', 'sections', 'whatsapp']);
  assert.match(steps.tabs.detail, /Activities، Types/);
  assert.match(steps.columns.detail, /Sections: kind, subtitle, icon, theme, banner, visibleFrom, visibleUntil/);
  assert.match(steps.columns.detail, /Links: experience, gallery/);
  assert.match(steps.columns.detail, /Contacts: image, intro, reply/);
  assert.match(steps.columns.detail, /News: archived/);
  assert.equal(steps.sections.detail.split('، ').length, 10);
  assert.ok(plan.backups.includes('Settings') && plan.backups.includes('Links'));
  assert.match(w.gs.planMigration(), /هيتعمل: أقسام الصفحة الأساسية/);
});

test('migrate: backups first, nothing lost, everything added, same page', () => {

  const w = legacyWorld();
  const gs = w.as(ADMIN).gs;
  const oldTabs = Object.fromEntries(w.spreadsheet.getSheets().map(s => [s.name, s.data.map(line => line.slice())]));
  // header + the rows that held records (unused rows may receive new records)
  const used = Object.fromEntries(Object.keys(oldTabs).filter(n => w.gs.TABLES[n]).map(n => [n, 1 + w.gs.readTable_(n).length]));
  const pageBefore = visibleContent(w);

  const result = plain(gs.apiMigrate());
  const report = result.report;
  assert.equal(report.changed, true);

  // 1. a hidden, dated backup of every data tab, identical to what was there
  const day = w.gs.Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyyMMdd');
  for (const name of ['Settings', 'Sections', 'Links', 'Contacts', 'Sessions', 'News', 'Games', 'Notifications', 'Media', 'Log']) {
    const backup = w.spreadsheet.getSheetByName(`_backup_${day}_${name}`);
    assert.ok(backup, `backup of ${name}`);
    assert.equal(backup.isSheetHidden(), true);
    if (name !== 'Log') assert.deepEqual(backup.data, oldTabs[name], `${name} backup = the original`);
  }

  // 2. every original cell of every record is still there, in its place
  for (const [name, lines] of Object.entries(oldTabs)) {
    if (name === 'Log' || !used[name]) continue;
    const now = w.spreadsheet.getSheetByName(name).data;
    lines.slice(0, used[name]).forEach((line, r) => line.forEach((value, c) => {
      assert.deepEqual(now[r][c], value, `${name} row ${r + 1} col ${c + 1}`);
    }));
  }
  for (const [name, [before, after]] of Object.entries(report.counts)) {
    assert.ok(after >= before, `${name}: ${before} -> ${after}`);
  }

  // 3. new columns at the end, new tabs, built-in sections, WhatsApp link
  assert.deepEqual(w.spreadsheet.getSheetByName('Sections').data[0].filter(Boolean), plain(w.gs.TABLES.Sections.columns));
  assert.ok(w.spreadsheet.getSheetByName('Activities'));
  assert.equal(w.gs.readTable_('Types').length, w.gs.SEED_TYPES.length);
  const sections = plain(w.gs.readTable_('Sections'));
  assert.equal(sections.length, 12);
  assert.equal(sections.find(s => s.key === 'meeting').enabled, true);
  const whatsapp = plain(w.gs.readTable_('Links')).find(l => l.url === 'https://chat.whatsapp.com/K5CfLt5X0uM5qCgr7Z2PTt');
  assert.equal(whatsapp.section, 'social');
  assert.equal(whatsapp.icon, 'whatsapp');
  assert.equal(w.properties.get('DATA_SCHEMA'), '4');

  // 4. the page is the same (plus the WhatsApp link), in the same order
  const pageAfter = visibleContent(w);
  assert.deepEqual(pageAfter.errors, []);
  const social = pageAfter.rest.sections.find(s => s.key === 'social');
  assert.equal(social.links.at(-1).id, whatsapp.id);
  social.links.pop();
  assert.deepEqual(pageAfter.rest, pageBefore.rest);
  const order = w.gs.buildPublicContent(w.gs.readDraft_(), { now: '2026-10-08T12:00' }).content.layout.map(s => s.key);
  assert.deepEqual(plain(order), ['meeting', 'featured', 'news', 'games', 'competitions', 'activities', 'location', 'social', 'contacts', 'support', 'share']);

  // 5. logged
  assert.ok(w.spreadsheet.getSheetByName('Log').data.some(r => r[2] === 'migrate'));

});

test('migrate twice: the second run changes nothing and makes no backup', () => {
  const w = legacyWorld();
  const gs = w.as(ADMIN).gs;
  gs.apiMigrate();
  const after = snapshot(w);
  const second = plain(gs.apiMigrate()).report;
  assert.equal(second.changed, false);
  assert.deepEqual(snapshot(w), after);
  assert.equal(plain(gs.apiPlanMigration()).pending, false);
});

test('a backup never overwrites an older one with the same name', () => {
  const w = legacyWorld();
  const day = w.gs.Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyyMMdd');
  const older = w.spreadsheet.getSheetByName('Settings').copyTo(w.spreadsheet).setName(`_backup_${day}_Settings`);
  older.data[0][0] = 'older backup';
  const report = plain(w.as(ADMIN).gs.apiMigrate()).report;
  assert.equal(w.spreadsheet.getSheetByName(`_backup_${day}_Settings`).data[0][0], 'older backup');
  assert.ok(report.backups.includes(`_backup_${day}-2_Settings`), report.backups.join(','));
});

test('a switched-off meeting stays off after the upgrade', () => {
  const w = legacyWorld({ meetingEnabled: false });
  w.as(ADMIN).gs.apiMigrate();
  assert.equal(plain(w.gs.readTable_('Sections')).find(s => s.key === 'meeting').enabled, false);
  assert.equal(visibleContent(w).rest.meeting, null);
});

test('the WhatsApp link is not added twice', () => {
  const w = legacyWorld();
  const gs = w.as(ADMIN).gs;
  gs.apiSaveLink({ title: 'جروبنا', url: 'https://chat.whatsapp.com/K5CfLt5X0uM5qCgr7Z2PTt', section: 'social', icon: 'whatsapp' });
  const plan = plain(gs.apiPlanMigration());
  assert.equal(plan.steps.find(s => s.id === 'whatsapp').needed, false);
  gs.apiMigrate();
  assert.equal(plain(gs.readTable_('Links')).filter(l => l.url.includes('chat.whatsapp.com')).length, 1);
});

test('before the upgrade: the admin sees the built-in sections, editing them asks for the upgrade', () => {
  const w = legacyWorld();
  const state = plain(w.as(ADMIN).gs.apiState());
  assert.deepEqual([state.schema.data, state.schema.target], [2, 4]);
  assert.equal(state.layout.find(s => s.key === 'meeting').virtual, true);
  assert.throws(() => w.gs.apiSetSectionEnabled('meeting', false), /ترقية البيانات/);
  assert.equal(state.hubReady, true, 'the content center keeps working');
});

test('only admins can plan or run the upgrade', () => {
  const w = legacyWorld().as('someone@gmail.com');
  for (const name of ['planMigration', 'apiPlanMigration', 'migrate', 'apiMigrate']) {
    assert.throws(() => w.gs[name](), /مش مسموح/, name);
  }
});


/* ---------------- section visibility always wins ---------------- */

function migratedWorld() {
  const w = legacyWorld();
  w.as(ADMIN).gs.apiMigrate();
  w.gs.apiSaveItem('games', { title: 'لعبة', url: 'https://example.org/g', startAt: '2099-10-11 22:00', endAt: '2099-10-11 23:00', notify: { soon: true, start: true } });
  return w;
}

const build = w => plain(w.gs.buildPublicContent(w.gs.readDraft_(), { now: '2026-10-08T12:00' }));

test('meeting section off: no meeting, no sessions, no meeting notification', () => {
  const w = migratedWorld();
  assert.ok(build(w).content.meeting);
  w.gs.apiSetSectionEnabled('meeting', false);
  const { content, errors, warnings } = build(w);
  assert.deepEqual(errors, []);
  assert.equal(content.meeting, null);
  assert.deepEqual(content.sessions, []);
  assert.ok(!content.notifications.some(n => n.target && n.target.kind === 'meeting'));
  assert.ok(warnings.some(x => /مخفي/.test(x.message)), JSON.stringify(warnings));
  assert.ok(!content.layout.some(s => s.key === 'meeting'));
});

test('news / games / featured off: their items and notifications are not published', () => {
  const w = migratedWorld();
  for (const key of ['news', 'games', 'featured']) w.gs.apiSetSectionEnabled(key, false);
  const { content, errors } = build(w);
  assert.deepEqual(errors, []);
  assert.deepEqual([content.news, content.games, content.featured], [[], [], []]);
  assert.ok(!content.notifications.some(n => ['news', 'game'].includes(n.type)));
});

test('only social + one item showing: everything else off', () => {
  const w = migratedWorld();
  const gs = w.gs;
  for (const s of plain(gs.readTable_('Sections'))) {
    if (!['social', 'news'].includes(s.key)) gs.apiSetSectionEnabled(s.key, false);
  }
  const { content, errors } = build(w);
  assert.deepEqual(errors, []);
  assert.deepEqual(content.layout.map(s => s.key), ['news', 'social']);
  assert.equal(content.meeting, null);
  assert.equal(content.location, null);
  assert.deepEqual(content.contacts, []);
  assert.deepEqual(content.sections.map(s => s.key), ['social']);
});

test('a scheduled section carries its window to the site', () => {
  const w = migratedWorld();
  w.gs.apiSaveSection({ key: 'games', title: 'تحديات وألعاب', visibleFrom: '2026-10-11 18:00', visibleUntil: '2026-10-12' });
  const games = build(w).content.layout.find(s => s.key === 'games');
  assert.deepEqual([games.visibleFrom, games.visibleUntil], ['2026-10-11T18:00', '2026-10-12T23:59']);
});


/* ---------------- schema 4: the live Sheet today (schema 3) ---------------- */

test('schema 3 -> 4: only the four new columns, a backup, the same page', () => {
  const w = schema3World();
  const gs = w.as(ADMIN).gs;
  const plan = plain(gs.apiPlanMigration());
  assert.deepEqual([plan.current, plan.target], [3, 4]);
  assert.deepEqual(plan.steps.filter(s => s.needed).map(s => [s.id, s.detail]), [['columns', 'Links: gallery — Contacts: image, intro, reply']]);

  const before = plain(gs.buildDraft_()).content;
  const counts = plain(gs.tableCounts_(gs.spreadsheet_()));
  const report = plain(gs.apiMigrate()).report;
  assert.equal(report.changed, true);
  assert.ok(report.backups.some(name => /_backup_\d{8}(-\d+)?_Contacts$/.test(name)), 'Contacts backed up first');
  assert.deepEqual(plain(gs.tableCounts_(gs.spreadsheet_())), counts, 'no row added or lost');
  assert.equal(w.properties.get('DATA_SCHEMA'), '4');
  assert.deepEqual(plain(gs.buildDraft_()).content, before, 'visitors see exactly the same page');

  // again: nothing to do
  assert.equal(plain(gs.apiMigrate()).report.changed, false);
});
