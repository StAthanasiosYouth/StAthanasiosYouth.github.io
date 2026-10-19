// InstaPay / wallet destinations (apps-script/PayDest.gs, plan rev. 4 §4.7):
// optional own numbers per servant, the phone as the fallback, the PRIMARY
// admin's approval of the exact number (any change = not approved), the signed
// sync of the approved set to the Worker (checked with the Worker's own code),
// and «online» payment methods (cash is servant-assisted).

import test from 'node:test';
import assert from 'node:assert/strict';
import { compWorld, adminApi, ADMIN, SECOND } from './fakes/comp.mjs';
import { signSync } from '../worker/src/lib/sync.js';

const PAY_URL = 'https://athanasios-api.menazak-lab.workers.dev/v1/sync/pay-dest';
const SECRET = 'p'.repeat(48);

function world() {
  const w = compWorld();
  w.properties.set('WORKER_SYNC_SECRET', SECRET);
  w.web[PAY_URL] = { status: 200, body: JSON.stringify({ ok: true, approved: 0 }) };
  return { w, call: adminApi(w, ADMIN), second: adminApi(w, SECOND) };
}

const payload = call => JSON.parse(Buffer.from(call.options.payload.map(b => (b < 0 ? b + 256 : b))).toString('utf8'));
const syncs = w => w.webRequests.filter(r => r.url === PAY_URL);
const lastSync = w => payload(syncs(w).at(-1));
const pay = (servant, method) => servant.pay.find(p => p.method === method);

test('pay dest: own number or the phone; nothing shows before the primary admin approves it', () => {
  const { w, call } = world();
  const s = call('apiServantSave', null, { name: 'مينا عادل', phone: '01012345678', instapayNumber: '٠١١ ٢٢٢٣ ٣٣٤٤', payName: 'Mina Adel' }).servant;
  assert.equal(s.instapayNumber, '01122233344', 'stored as a mobile, shown in the local form');
  assert.deepEqual(pay(s, 'instapay'), { method: 'instapay', number: '01122233344', source: 'own', approved: false, approvedAt: 0, approvedBy: '', problem: 'لسه محتاج اعتماد الأدمن الرئيسي' });
  assert.equal(pay(s, 'wallet').number, '01012345678');
  assert.equal(pay(s, 'wallet').source, 'phone', 'empty wallet number → the phone (still needs approval)');
  assert.deepEqual(lastSync(w), { dests: [] }, 'synced, but nothing approved yet');
  assert.throws(() => call('apiServantSave', null, { name: 'رقم غلط', instapayNumber: '12345' }), /موبايل مصري صحيح/);
  const none = call('apiServantSave', null, { name: 'من غير أرقام' }).servant;
  assert.equal(pay(none, 'instapay').number, '');
  assert.match(pay(none, 'instapay').problem, /مفيش رقم صحيح/);
});

test('pay dest: the primary admin approves the exact number; the Worker gets it signed; any change needs a new approval', async () => {
  const { w, call } = world();
  const s = call('apiServantSave', null, { name: 'مينا عادل', phone: '01012345678', payName: 'Mina Adel' }).servant;
  const list = call('apiServantPayApprove', s.id, 'wallet', '01012345678');
  assert.equal(list.payAdmin, true);
  const approved = pay(list.servants.find(x => x.id === s.id), 'wallet');
  assert.equal(approved.approved, true);
  assert.equal(approved.approvedBy, ADMIN);

  const call1 = syncs(w).at(-1);
  const body = Buffer.from(call1.options.payload.map(b => (b < 0 ? b + 256 : b))).toString('utf8');
  assert.equal(call1.options.headers['x-sync-signature'], await signSync(SECRET, call1.options.headers['x-sync-ts'], body), 'the Worker accepts it');
  const sent = JSON.parse(body).dests;
  assert.equal(sent.length, 1);
  assert.deepEqual({ ...sent[0], approvedAt: 0 }, { servantId: s.id, method: 'wallet', number: '01012345678', name: 'Mina Adel', source: 'phone', approvedAt: 0, approvedBy: ADMIN });

  // the phone changes while it is the fallback → not approved any more, gone from the Worker
  call('apiServantSave', s.id, { name: 'مينا عادل', phone: '01099999999', payName: 'Mina Adel' });
  const after = pay(call('apiServants').servants.find(x => x.id === s.id), 'wallet');
  assert.equal(after.approved, false);
  assert.match(after.problem, /محتاج اعتماد تاني/);
  assert.deepEqual(lastSync(w), { dests: [] });

  // a stale screen can't approve a number it didn't show
  assert.throws(() => call('apiServantPayApprove', s.id, 'wallet', '01012345678'), /الرقم اتغيّر/);
  call('apiServantPayApprove', s.id, 'wallet', '01099999999');
  assert.equal(lastSync(w).dests.length, 1);
  // taken back
  call('apiServantPayApprove', s.id, 'wallet', '', false);
  assert.deepEqual(lastSync(w), { dests: [] });
  // inactive servants leave the page
  call('apiServantPayApprove', s.id, 'wallet', '01099999999');
  call('apiServantSetActive', s.id, false);
  assert.deepEqual(lastSync(w), { dests: [] });

  // the audit never holds the number
  const rows = w.spreadsheet.getSheetByName('Activity').data;
  assert.ok(rows.some(r => r.includes('pay.approve')));
  assert.doesNotMatch(JSON.stringify(rows.filter(r => r.includes('pay.approve'))), /010\d{8}|\+20/);
});

test('pay dest: another admin can neither approve nor change the numbers (Phase 1: primary only); other edits still work', () => {
  const { call, second } = world();
  const s = call('apiServantSave', null, { name: 'مينا عادل', phone: '01012345678', instapayNumber: '01122233344' }).servant;
  assert.throws(() => second('apiServantPayApprove', s.id, 'instapay', '01122233344'), /للأدمن الرئيسي بس/);
  assert.throws(() => second('apiServantSave', s.id, { name: 'مينا عادل', phone: '01012345678', instapayNumber: '01555555555' }), /الأدمن الرئيسي بس/);
  const renamed = second('apiServantSave', s.id, { name: 'مينا عادل جرجس', phone: '01012345678', instapayNumber: '01122233344' }).servant;
  assert.equal(renamed.name, 'مينا عادل جرجس');
  assert.equal(renamed.instapayNumber, '01122233344', 'kept');
  assert.equal(second('apiServants').payAdmin, false);
});

test('pay dest: a failed send is marked and the booking tick sends it again', () => {
  const { w, call } = world();
  const s = call('apiServantSave', null, { name: 'مينا', phone: '01012345678' }).servant;
  w.web[PAY_URL] = { status: 503, body: 'down' };
  call('apiServantPayApprove', s.id, 'instapay', '01012345678');
  assert.equal(w.properties.get('PAY_DEST_DIRTY'), '1');
  w.web[PAY_URL] = { status: 200, body: JSON.stringify({ ok: true }) };
  const n = syncs(w).length;
  w.gs.payDestRetry_();
  assert.equal(syncs(w).length, n + 1);
  assert.equal(w.properties.get('PAY_DEST_DIRTY'), undefined);
  assert.equal(lastSync(w).dests.length, 1);
});

test('pay methods: «online» saved explicitly; blank rows follow the proof rule; the seed keeps cash offline', () => {
  const { w, call } = world();
  const seed = call('apiServants').methods;
  assert.deepEqual(seed.map(m => [m.key, m.online]), [['cash', false], ['instapay', true], ['wallet', true]]);
  const saved = call('apiPayMethodsSave', [
    { key: 'cash', label: 'كاش', needsProof: false, online: false },
    { key: 'instapay', label: 'إنستاباي', needsProof: true, online: true },
    { key: 'wallet', label: 'محفظة', needsProof: true }
  ]).methods;
  assert.deepEqual(saved.map(m => [m.key, m.online]), [['cash', false], ['instapay', true], ['wallet', true]]);
  assert.equal(w.gs.bookMethodOnline_({ needsProof: '1', online: '' }), true);
  assert.equal(w.gs.bookMethodOnline_({ needsProof: '', online: '' }), false);
  assert.equal(w.gs.bookMethodOnline_({ needsProof: '1', online: '0' }), false);
});
