// Profiles the admin's main actions on the fake world through the real API path
// (doPost: token, session, the .gs code). Counts what costs time on Apps Script:
// spreadsheet read calls, write calls, number-format calls, UrlFetch calls by host.
// Estimate = base (doPost overhead) + reads·R + writes·W + formats·F + fetches·N (rough
// Apps Script latencies), so before / after can be compared on the same model.
//
//   node profile-admin.mjs            a table
//   node profile-admin.mjs --json     machine-readable

import { compWorld, adminApi, scoredComp } from '../tests/fakes/comp.mjs';
import { PROFILE } from '../tests/fakes/gas.mjs';

const COST = { base: 700, read: 120, write: 70, format: 25, fetch: 350 };

const world = compWorld();
const call = adminApi(world);
const rows = [];

function measure(label, fn) {
  PROFILE.reads = 0; PROFILE.writes = 0; PROFILE.formats = 0; PROFILE.fetches = {};
  const value = fn();
  const fetches = Object.values(PROFILE.fetches).reduce((a, b) => a + b, 0);
  const ms = COST.base + PROFILE.reads * COST.read + PROFILE.writes * COST.write + PROFILE.formats * COST.format + fetches * COST.fetch;
  rows.push({ label, reads: PROFILE.reads, writes: PROFILE.writes, formats: PROFILE.formats, fetches, hosts: { ...PROFILE.fetches }, ms });
  return value;
}

// a realistic draft: news, meetings, a competition with questions, participants, a store
for (let i = 0; i < 12; i++) call('apiSaveItem', 'news', { title: 'خبر ' + i, summary: 'ملخص', body: 'تفاصيل الخبر رقم ' + i });
call('apiCompSettings', { registry: true, wallet: true, shop: true });
const comp = scoredComp(call);
for (let i = 0; i < 30; i++) call('apiParticipantSave', { name: 'مشارك رقم ' + i + ' اسم', phone: '0101234' + String(i).padStart(4, '0') });
const item = call('apiShopItemSave', { name: 'كوباية', cost: 10 }).item;
const firstReview = call('apiReview');
call('apiPublish', firstReview.revision);

measure('Add news', () => call('apiSaveItem', 'news', { title: 'خبر جديد', summary: 'ملخص', body: 'تفاصيل' }));
const newsSheet = world.spreadsheet.getSheetByName('News').data;
const newsId = String(newsSheet.filter(r => r[0]).pop()[0]);
measure('Edit news', () => call('apiSaveItem', 'news', { id: newsId, title: 'خبر متعدل', summary: 'ملخص', body: 'تفاصيل' }));
measure('Show/hide news', () => call('apiSetItemEnabled', 'news', newsId, false));
measure('Delete news', () => call('apiDeleteItem', 'news', newsId));
measure('Competition: save basics', () => call('apiCompSave', comp.id, { description: 'وصف جديد' }));
measure('Competition: add question', () => call('apiCompQuestionSave', comp.id, { type: 'truefalse', text: 'سؤال جديد', correct: 'صح', points: 5 }));
const tsv = ['السؤال\tالنوع\tالإجابة الصحيحة\tالدرجة'].concat(Array.from({ length: 40 }, (_, i) => `سؤال مستورد ${i}\tصح وغلط\tصح\t5`)).join('\n');
const preview = measure('Import 40 questions: preview', () => call('apiCompImportPreview', comp.id, tsv));
const decisions = Object.fromEntries((preview.rows || []).filter(r => r.status !== 'error').map(r => ['r' + r.line, (r.choices && r.choices[0] && r.choices[0].value) || 'add:' + r.fingerprint]));
measure('Import 40 questions: apply', () => call('apiCompImportApply', comp.id, tsv, decisions));
measure('Competition: close now', () => call('apiCompClose', comp.id));
measure('Competition: finalize', () => call('apiCompFinalize', comp.id, true));
measure('Participant: add', () => call('apiParticipantSave', { name: 'مشارك جديد خالص', phone: '01099999999' }));
const pid = call('apiParticipants', { all: true }).items[0].id;
measure('Points: adjust', () => call('apiWalletAdjust', pid, 5, 'مكافأة', 'profile-key-0001'));
measure('Store: save prize', () => call('apiShopItemSave', { id: item.id, name: 'كوباية كبيرة', cost: 12 }));
measure('Review («راجع»)', () => call('apiReview'));
const review = call('apiReview');
measure('Publish («انشر», small change)', () => call('apiPublish', review.revision));
call('apiSaveItem', 'news', { title: 'خبر تاني', summary: 'ملخص', body: 'تفاصيل' });
const review2 = call('apiReview');
measure('Publish again (one news)', () => call('apiPublish', review2.revision));

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(rows, null, 2));
}
else {
  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad('action', 34) + pad('reads', 7) + pad('writes', 8) + pad('formats', 9) + pad('fetches', 9) + 'est. s');
  for (const r of rows) console.log(pad(r.label, 34) + pad(r.reads, 7) + pad(r.writes, 8) + pad(r.formats, 9) + pad(r.fetches, 9) + (r.ms / 1000).toFixed(1) + '   ' + JSON.stringify(r.hosts));
}
