// «دليل الأدمن» (owner 2026-11-13): every screen and every editor's video icon lands on its own article,
// every link and picture exists, and admin/guide.json is the build of tools/source/admin-guide.mjs.
import { readFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOT } from '../tools/lib/gs.mjs';
import { guideJson } from '../tools/build-admin.mjs';

const built = readFileSync(`${ROOT}admin/guide.json`, 'utf8').replace(/\r\n/g, '\n');
const guide = JSON.parse(built);
const ctx = new Set(guide.articles.flatMap(a => a.ctx || []));

test('admin/guide.json is current', () => {
  assert.equal(built, guideJson());
});

test('every screen of the panel opens its own article', () => {
  const screens = ['home', 'meetings', 'news', 'games', 'competitions', 'activities', 'services', 'notifications', 'push', 'comps', 'compsettings',
    'comp-questions', 'comp-results', 'svcpages', 'events', 'servants', 'bookings', 'finance', 'paymethods', 'youth', 'youth-review', 'youth-results',
    'youth-store', 'youth-seasons', 'layout', 'links', 'location', 'contacts', 'media', 'activity', 'actarchive', 'actapp',
    'settings-me', 'settings-notify', 'settings-site', 'settings-content', 'settings-publish', 'settings-team', 'settings-system', 'settings-guide'];
  assert.deepEqual(screens.filter(k => !ctx.has(k)), []);
});

test('every editor that names its help has that article', () => {
  const src = ['AdminContent', 'AdminItems', 'AdminPage', 'AdminPages', 'AdminCompQuestions'].map(f => readFileSync(`${ROOT}apps-script/${f}.html`, 'utf8')).join('\n');
  const named = [...src.matchAll(/help: '([a-z-]+)'|nextSheetHelp = '([a-z-]+)'/g)].map(m => m[1] || m[2]);
  assert.ok(named.length >= 13);
  assert.deepEqual(named.filter(k => !ctx.has('sheet:' + k)), []);
});

test('every related link and every picture exists; demo data only in the pictures list', () => {
  const ids = new Set(guide.articles.map(a => a.id));
  for (const a of guide.articles) {
    for (const r of a.related || []) assert.ok(ids.has(r), `${a.id} → ${r}`);
    for (const s of a.steps || []) if (s.shot) for (const dev of s.only ? [s.only] : ['d', 'm']) assert.ok(existsSync(`${ROOT}admin/guide/${s.shot}-${dev}.webp`), `${a.id}: ${s.shot}-${dev}`);
  }
  assert.doesNotMatch(readFileSync(`${ROOT}tools/guide-shots.mjs`, 'utf8'), /const ADMIN = 'menazakmena/);
});
