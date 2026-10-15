// The admin's actions stay fast (call budgets measured on the fake world, the
// same counts tools/profile-admin.mjs reports) and the speed-ups never show
// stale data: the state after an action is current, a hand edit in the Sheet
// shows on the next panel load, a table copy read under an older version is
// never used, and the publish asks GitHub only what it must.

import test from 'node:test';
import assert from 'node:assert/strict';
import { compWorld, adminApi } from './fakes/comp.mjs';
import { PROFILE } from './fakes/gas.mjs';

function counted(fn) {
  PROFILE.reads = 0; PROFILE.writes = 0; PROFILE.formats = 0; PROFILE.fetches = {};
  const value = fn();
  return { value, reads: PROFILE.reads, writes: PROFILE.writes, formats: PROFILE.formats, github: PROFILE.fetches['api.github.com'] || 0 };
}

function world() {
  const w = compWorld();
  const call = adminApi(w);
  for (let i = 0; i < 6; i++) call('apiSaveItem', 'news', { title: 'خبر ' + i, summary: 'م', body: 'ت' });
  call('apiState');
  return { w, call };
}

const newsIds = w => w.spreadsheet.getSheetByName('News').data.slice(1).filter(r => r[0]).map(r => String(r[0]));

test('a save is one row write, not one per cell; the state after it is read mostly from the copies', () => {
  const { w, call } = world();
  const add = counted(() => call('apiSaveItem', 'news', { title: 'خبر جديد', summary: 'ملخص', body: 'تفاصيل' }));
  // (the other admins' push is sent after the reply, by a heartbeat: not counted here)
  assert.ok(add.writes <= 3, `add: ${add.writes} writes (was 21: one per cell, then 4)`);
  assert.ok(add.formats <= 2, `add: ${add.formats} format calls (was 12)`);
  assert.ok(add.reads <= 4, `add: ${add.reads} reads (was 22: every tab again, then 8)`);
  const id = newsIds(w).pop();
  const edit = counted(() => call('apiSaveItem', 'news', { id, title: 'خبر متعدل', summary: 'ملخص', body: 'تفاصيل' }));
  assert.ok(edit.writes <= 4 && edit.reads <= 5, JSON.stringify(edit));
  // and the state is current
  const state = edit.value;
  const json = JSON.stringify(state);
  assert.match(json, /خبر متعدل/);
  assert.doesNotMatch(json, /"title":"خبر جديد"/);
});

test('the copies are never stale: delete shows at once; a hand edit in the Sheet shows on the next panel load', () => {
  const { w, call } = world();
  const id = newsIds(w)[0];
  const after = call('apiDeleteItem', 'news', id);
  assert.ok(!after.draft.news.some(n => n.id === id), 'gone from the state at once');
  // someone edits the Sheet by hand
  const sheet = w.spreadsheet.getSheetByName('News');
  const titleCol = sheet.data[0].indexOf('title');
  const row = sheet.data.findIndex((r, i) => i > 0 && r[0]);
  sheet.data[row][titleCol] = 'عنوان من الشيت';
  assert.match(JSON.stringify(call('apiState')), /عنوان من الشيت/, 'a panel load reads the Sheet itself');
});

test('a copy written under an older version is never used (a read racing a write)', () => {
  const { w, call } = world();
  call('apiState');
  const cache = w.cache;
  const entry = JSON.parse(cache.get('tbl:News').value);
  // a slow reader stored an old copy tagged with an old version after a write moved the version on
  cache.set('tbl:News', { ...cache.get('tbl:News'), value: JSON.stringify({ v: 'old-version', rows: entry.rows.map(r => ({ ...r, title: 'قديم' })) }) });
  const state = call('apiSaveItem', 'notifications', { title: 'تنبيه', message: 'م' });
  assert.ok(!state.draft.news.some(n => n.title === 'قديم'), 'the old copy was ignored');
});

test('review and publish read the Sheet itself; the publish asks GitHub only what it must', () => {
  const { w, call } = world();
  const first = call('apiReview');
  call('apiPublish', first.revision);
  call('apiSaveItem', 'news', { title: 'خبر للنشر', summary: 'م', body: 'ت' });
  const review = counted(() => call('apiReview'));
  assert.equal(review.github, 0, 'the review compares with what was last published (kept), no GitHub call');
  const publish = counted(() => call('apiPublish', review.value.revision));
  assert.ok(publish.value.commit, 'it lands');
  assert.ok(publish.github <= 4, `publish: ${publish.github} GitHub calls (was 7)`);
  assert.match(JSON.parse(w.github.files()['content.json']).news.map(n => n.title).join('|'), /خبر للنشر/);
  // nothing changed: no commit, no tree work
  const again = counted(() => call('apiPublish', call('apiReview').revision));
  assert.equal(again.value.unchanged, true);
  assert.equal(again.github, 0);
});

test('the session\'s first state carries the competitions\' switches (no apiComps just for the sub-tabs)', () => {
  const w = compWorld();
  const call = adminApi(w);
  call('apiCompSettings', { registry: true, wallet: true, shop: false });
  const token = w.issueToken({ email: 'menazakmena@gmail.com', exp: String(Math.floor(w.now() / 1000) + 3600) });
  const started = w.post({ fn: 'apiSessionStart', args: [{ device: 'test', force: true }], token });
  assert.equal(started.ok, true, started.error);
  assert.deepEqual({ ...started.result.state.modules }, { registry: true, wallet: true, shop: false });
});
