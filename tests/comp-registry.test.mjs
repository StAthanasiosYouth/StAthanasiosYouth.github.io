// Competitions Phase 2 (CompRegistry.gs): Egyptian phones, codes (format,
// hash, encrypted copy), the registry admin, code view / export / reset
// (logged, never in Activity), the bulk import (every classification,
// fingerprints, undo, 500 rows), compCode and its brute-force budget, a
// registered competition end to end, and the module switches.

import test from 'node:test';
import assert from 'node:assert/strict';
import { compWorld, adminApi, pub, clientKey, plain } from './fakes/comp.mjs';
import { regWorld, addPerson, codeOf, login, codedComp, play, answersFor, activityRows, tab, phone } from './fakes/reg.mjs';

const CODE = /^ATH-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}$/;


/* ---------------- pure: phones, names, codes ---------------- */

test('normPhoneEg_: every usual Egyptian form → +201XXXXXXXXX; precise reasons otherwise', () => {
  const { gs } = compWorld();
  const ok = {
    '01012345678': '+201012345678',
    '0101 234 5678': '+201012345678',
    '010-1234-5678': '+201012345678',
    '(010) 1234.5678': '+201012345678',
    '+201012345678': '+201012345678',
    '+20 101 234 5678': '+201012345678',
    '+20 01012345678': '+201012345678',
    '00201012345678': '+201012345678',
    '201012345678': '+201012345678',
    '1012345678': '+201012345678',               // the 0 a spreadsheet dropped
    '٠١٠١٢٣٤٥٦٧٨': '+201012345678',             // Arabic digits
    '۰۱۲۲۳۴۵۶۷۸۹': '+201223456789',             // Persian digits
    '‏0111 234 5678‎': '+201112345678', // bidi marks
    '01512345678': '+201512345678',
    '01212345678': '+201212345678'
  };
  for (const [input, expected] of Object.entries(ok)) {
    const out = gs.normPhoneEg_(input);
    assert.equal(out.problem, '', input);
    assert.equal(out.phone, expected, input);
    assert.equal(out.norm, expected.slice(3), input);
    assert.equal(out.local, '0' + expected.slice(3), input);
  }
  const bad = {
    '': 'رقم الموبايل ناقص',
    '0101234567': 'رقم الموبايل ناقص رقم (١٠ أرقام بدل ١١)',
    '010123456': 'رقم الموبايل ناقص ٢ أرقام (٩ أرقام بدل ١١)',
    '010123456789': 'رقم الموبايل زيادة رقم (١٢ رقم بدل ١١)',
    '01312345678': 'الرقم مش رقم موبايل مصري',
    '0223456789': 'الرقم مش رقم موبايل مصري',
    '+447911123456': 'الرقم مش رقم موبايل مصري',
    '0101234567x': 'رقم الموبايل فيه حروف أو رموز',
    'مفيش': 'رقم الموبايل فيه حروف أو رموز'
  };
  for (const [input, reason] of Object.entries(bad)) {
    const out = gs.normPhoneEg_(input);
    assert.equal(out.problem, reason, input);
    assert.equal(out.phone, '', input);
  }
});

test('normName_: hamza, ة/ه, ى/ي, tashkeel, spaces and case are forgiven', () => {
  const { gs } = compWorld();
  assert.equal(gs.normName_('  أحمـد   إبراهيم  '), gs.normName_('احمد ابراهيم'));
  assert.equal(gs.normName_('مَرْيَم زكريّا'), gs.normName_('مريم زكريا'));
  assert.equal(gs.normName_('هدى فاطمة'), gs.normName_('هدي فاطمه'));
  assert.equal(gs.normName_('Mina  ADEL'), 'mina adel');
});

test('codes: ATH-XXXX-XXXX from the 30-symbol alphabet, rejection sampling, unique, typed forms normalized', () => {
  const { gs } = compWorld();
  assert.equal(gs.REG_CODE_ALPHABET, '23456789ABCDEFGHJKMNPQRSTVWXYZ');
  assert.equal(gs.REG_CODE_ALPHABET.length, 30);
  for (const c of '01OILU') assert.ok(!gs.REG_CODE_ALPHABET.includes(c), c);
  // bytes ≥ 240 are skipped; the rest map mod 30
  assert.equal(gs.regCodeFromBytes_([240, 255, 0, 29, 30, 239, 250, 59], 8), gs.REG_CODE_ALPHABET[0] + gs.REG_CODE_ALPHABET[29] + gs.REG_CODE_ALPHABET[0] + gs.REG_CODE_ALPHABET[29] + gs.REG_CODE_ALPHABET[29]);
  assert.equal(gs.regCodeFromBytes_([-16, -1, 5], 8), gs.REG_CODE_ALPHABET[5], 'signed Apps Script bytes');
  const seen = new Set();
  const used = new Set();
  for (let i = 0; i < 3000; i++) {
    const code = gs.regNewCode_();
    assert.match(code, /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
    seen.add(code);
    for (const ch of code) used.add(ch);
  }
  assert.equal(seen.size, 3000, 'no repeats in 3000');
  assert.equal(used.size, 30, 'every symbol shows up');
  assert.match(gs.regFormatCode_('ABCD2345'), CODE);
  for (const typed of ['ATH-ABCD-2345', 'ath abcd 2345', 'abcd2345', 'ATHABCD2345', ' ATH–ABCD–2345 ', 'ABCD-٢٣٤٥']) {
    assert.equal(gs.regNormalizeCode_(typed), 'ABCD2345', typed);
  }
  for (const typed of ['ATH-ABCD-234', 'ABCD234O', 'ABCD-2341', '', 'x'.repeat(50)]) assert.equal(gs.regNormalizeCode_(typed), '', typed);
  // a code that itself starts with ATH (8 symbols) is not cut
  assert.equal(gs.regNormalizeCode_('ATHB2345'), 'ATHB2345');
});


/* ---------------- the registry ---------------- */

test('participants: add (phone normalized, code issued), duplicates, family phone, same name; edit keeps id and code; never a code in replies', () => {
  const { world, call } = regWorld();
  const saved = call('apiParticipantSave', { name: 'مينا عادل', phone: '٠١٠١٢٣٤٠٠٠١', group: 'ثانوي' });
  const mina = saved.participant;
  assert.equal(saved.created, true);
  assert.match(mina.id, /^p-[0-9a-f]{8}$/);
  assert.equal(mina.phone, '01012340001');
  assert.equal(mina.phoneIntl, '+201012340001');
  assert.equal(mina.hasCode, true);
  assert.equal(mina.codeVersion, 1);
  for (const key of ['code', 'codeHash', 'codeEnc']) assert.ok(!(key in mina), key);

  const code = codeOf(call, mina.id);
  assert.match(code, CODE);
  const row = tab(world, 'Participants')[0];
  assert.equal(row.codeHash.length, 64);
  assert.ok(row.codeEnc.startsWith('v1:'));
  assert.ok(!JSON.stringify(row).includes(code.replace(/-/g, '').slice(3)), 'the plain code is not stored');
  assert.equal(world.gs.regHash_(code.replace(/^ATH-|-/g, '')), row.codeHash, 'HMAC with CODE_PEPPER');
  assert.ok(world.properties.get('CODE_PEPPER') && world.properties.get('CODE_KEY'), 'secrets made on first use');

  // the same name + phone again: refused (hamza / spaces forgiven)
  assert.throws(() => call('apiParticipantSave', { name: ' مينا  عادل ', phone: '+20 101 234 0001' }), /متسجل قبل كده/);
  // a family phone: allowed, with a warning
  const sister = call('apiParticipantSave', { name: 'مريم عادل', phone: '01012340001' });
  assert.equal(sister.created, true);
  assert.match(sister.warnings.join(' '), /نفس الرقم متسجل كمان لـ: مينا عادل/);
  // the same name, another phone: allowed, with a warning
  const other = call('apiParticipantSave', { name: 'مينا عادل', phone: '01012340002' });
  assert.match(other.warnings.join(' '), /بنفس الاسم برقم تاني/);
  assert.throws(() => call('apiParticipantSave', { name: 'م', phone: '01012340003' }), /قصير قوي/);
  assert.throws(() => call('apiParticipantSave', { name: 'مينا الجديد', phone: '0101234000' }), /ناقص رقم/);

  // an edit keeps the id and the code; a new phone is its own Activity row
  const edited = call('apiParticipantSave', { id: mina.id, phone: '01112340001', group: 'جامعة' }).participant;
  assert.equal(edited.id, mina.id);
  assert.equal(edited.phone, '01112340001');
  assert.equal(edited.group, 'جامعة');
  assert.equal(edited.name, 'مينا عادل', 'fields left out keep their value');
  assert.equal(codeOf(call, mina.id), code, 'same code');
  const acts = activityRows(world);
  assert.ok(acts.some(r => r[5] === 'participant.phone' && r[7] === mina.id));
  assert.ok(acts.some(r => r[5] === 'update' && r[6] === 'participant'));

  // lists and details never carry a code
  const list = call('apiParticipants', {});
  const one = call('apiParticipant', mina.id);
  for (const reply of [list, one, call('apiState')]) {
    const text = JSON.stringify(reply);
    assert.ok(!text.includes(code), 'no code');
    assert.ok(!/codeHash|codeEnc/.test(text));
  }
  assert.equal(list.total, 3);
  assert.deepEqual(plain(list.counts), { all: 3, active: 3, inactive: 0 });
});

test('participants: search by normalized name or any phone form, group / status filters, sort, paging', () => {
  const { call } = regWorld();
  addPerson(call, 'أحمد إبراهيم', '01012340011', { group: 'إعدادي' });
  addPerson(call, 'مريم زكريا', '01212340012', { group: 'ثانوي' });
  const kirollos = addPerson(call, 'كيرلس سمير', '01512340013', { group: 'ثانوي' });
  call('apiParticipantSetActive', kirollos.id, false);
  const names = q => call('apiParticipants', q).items.map(p => p.name);
  assert.deepEqual(names({ q: 'احمد ابراهيم' }), ['أحمد إبراهيم']);
  assert.deepEqual(names({ q: '٠١٢١٢٣٤' }), ['مريم زكريا']);
  assert.deepEqual(names({ q: '+20 1212340012' }), ['مريم زكريا']);
  assert.deepEqual(names({ q: '40013' }), ['كيرلس سمير']);
  assert.deepEqual(names({ group: 'ثانوي' }).sort(), ['كيرلس سمير', 'مريم زكريا'].sort());
  assert.deepEqual(names({ status: 'inactive' }), ['كيرلس سمير']);
  assert.deepEqual(names({ status: 'active', sort: 'name' }), ['أحمد إبراهيم', 'مريم زكريا']);
  const page = call('apiParticipants', { limit: 1, offset: 1, sort: 'name' });
  assert.equal(page.items.length, 1);
  assert.equal(page.total, 3);
  assert.deepEqual(page.groups.map(g => [g.name, g.count]), [['ثانوي', 2], ['إعدادي', 1]]);
});


/* ---------------- codes: view, export, reset (logged, never in Activity) ---------------- */

test('codes: view (logged, merged, no push), export (logged with the count), reset (old code and old ptokens dead at once); no code or phone in any Activity / Log cell', () => {
  const { world, call } = regWorld();
  const a = addPerson(call, 'مينا عادل', phone(21), { group: 'ثانوي' });
  const b = addPerson(call, 'مريم زكريا', phone(22), { group: 'ثانوي' });
  const codeA = codeOf(call, a.id);
  codeOf(call, a.id);
  const views = activityRows(world).filter(r => r[5] === 'code.view');
  assert.equal(views.length, 1, 'two views of the same participant within 10 minutes: one row');
  assert.equal(views[0][12], 2, 'counted twice');
  assert.equal(views[0][13], '', 'no admin push for a code view');

  const exported = call('apiParticipantCodes', { all: true });
  assert.equal(exported.count, 2);
  assert.deepEqual(exported.rows.map(r => Object.keys(r).sort()), [['code', 'group', 'id', 'name', 'phone'], ['code', 'group', 'id', 'name', 'phone']]);
  assert.equal(exported.rows.find(r => r.id === a.id).code, codeA);
  const exportRow = activityRows(world).find(r => r[5] === 'code.export');
  assert.equal(JSON.parse(exportRow[10]).count, 2);
  assert.deepEqual(call('apiParticipantCodes', { ids: [b.id] }).rows.map(r => r.id), [b.id]);
  assert.throws(() => call('apiParticipantCodes', {}), /اختار مين/);

  // the old code works … until the reset
  const oldToken = login(world, codeA);
  assert.equal(pub(world, 'portalMe', { ptoken: oldToken }).ok, true);
  const reset = call('apiParticipantResetCode', a.id);
  assert.match(reset.code, CODE);
  assert.notEqual(reset.code, codeA);
  assert.equal(reset.codeVersion, 2);
  assert.equal(codeOf(call, a.id), reset.code);
  assert.equal(pub(world, 'compCode', { code: codeA }).code, 'code', 'the old code is dead');
  assert.equal(pub(world, 'portalMe', { ptoken: oldToken }).code, 'session', 'the old token is dead');
  const fresh = login(world, reset.code);
  assert.equal(pub(world, 'portalMe', { ptoken: fresh }).ok, true);
  assert.ok(activityRows(world).some(r => r[5] === 'code.reset' && r[7] === a.id));

  // nothing secret anywhere in the Activity log or the Log sheet
  const secrets = [codeA, reset.code, codeOf(call, b.id)].flatMap(c => [c, c.replace(/^ATH-|-/g, '')]).concat([a.phone, b.phone, a.phoneIntl, b.phoneIntl, a.phone.slice(1)]);
  const cells = activityRows(world).flat().concat(world.spreadsheet.getSheetByName('Log').data.flat()).map(c => String(c));
  for (const secret of secrets) assert.ok(!cells.some(c => c.includes(secret)), 'leaked ' + secret);
});

test('a participant switched off: the code and their tokens stop at once; switched on again: they work', () => {
  const { world, call } = regWorld();
  const p = addPerson(call, 'مينا عادل', phone(31));
  const code = codeOf(call, p.id);
  const ptoken = login(world, code);
  call('apiParticipantSetActive', p.id, false);
  assert.equal(pub(world, 'compCode', { code }).code, 'code');
  assert.equal(pub(world, 'portalMe', { ptoken }).code, 'session');
  call('apiParticipantSetActive', p.id, true);
  assert.equal(pub(world, 'portalMe', { ptoken }).ok, true);
  assert.ok(activityRows(world).some(r => r[5] === 'disable' && r[9].includes('وقّف المشترك')));
});


/* ---------------- compCode ---------------- */

test('compCode: the right code (any typed form) → name, group, a 3-hour pt1 token; the hash cache never refuses a new code', () => {
  const { world, call } = regWorld();
  const p = addPerson(call, 'مينا عادل', phone(41), { group: 'ثانوي' });
  const code = codeOf(call, p.id);
  const reply = pub(world, 'compCode', { code: code.toLowerCase().replace(/-/g, ' ') });
  assert.equal(reply.ok, true);
  assert.deepEqual(plain(reply.participant), { name: 'مينا عادل', group: 'ثانوي' });
  const token = world.gs.compReadToken_('pt1', reply.ptoken);
  assert.equal(token.payload.p, p.id);
  assert.equal(token.payload.cv, 1);
  assert.ok(Math.abs(token.payload.e - (world.now() + 3 * 3600000)) < 5000);
  assert.ok(!JSON.stringify(reply).includes(code), 'the code is never echoed');
  assert.ok(world.cache.get('reg:hash:n'), 'the hash map is cached');

  // a stale cache (from before a new participant): still found through the tab
  const stale = world.cache.get('reg:hash:0').value;
  const q = addPerson(call, 'مريم زكريا', phone(42));
  world.cache.set('reg:hash:n', { value: '1', until: world.now() + 600000 });
  world.cache.set('reg:hash:0', { value: stale, until: world.now() + 600000 });
  assert.equal(pub(world, 'compCode', { code: codeOf(call, q.id) }).ok, true);

  // the token expires after 3 hours
  world.advance(3 * 3600000 + 1000);
  assert.equal(pub(world, 'portalMe', { ptoken: reply.ptoken }).code, 'session');
});

test('compCode brute force: every wrong code is counted and paused; 30 a minute → busy (even for the right code); the day budget too', () => {
  const { world, call } = regWorld();
  const p = addPerson(call, 'مينا عادل', phone(51));
  const code = codeOf(call, p.id);
  let pauses = 0;
  world.gs.Utilities.sleep = ms => { pauses += ms; };
  for (let i = 0; i < 30; i++) {
    const reply = pub(world, 'compCode', { code: 'ATH-2345-' + ['6789', 'ABCD', 'EFGH'][i % 3] + (i < 3 ? '' : '') });
    assert.equal(reply.code, 'code', 'attempt ' + i);
    assert.match(reply.message, /الكود ده مش صحيح/);
  }
  assert.equal(pauses, 30 * 300, 'a fixed pause after every failure');
  const busy = pub(world, 'compCode', { code });
  assert.equal(busy.code, 'busy', 'the budget is global');
  assert.equal(pub(world, 'compCode', { code: 'garbage' }).code, 'busy');
  world.advance(61000);
  assert.equal(pub(world, 'compCode', { code }).ok, true, 'a new minute');
  // the day budget
  world.properties.set('COMP_FAIL_DAY', new Date(world.now()).toISOString().slice(0, 10) + ':1000');
  assert.equal(pub(world, 'compCode', { code }).code, 'busy');
  // malformed requests
  world.properties.delete('COMP_FAIL_DAY');
  assert.equal(pub(world, 'compCode', {}).code, 'bad');
  assert.equal(pub(world, 'compCode', { code: 'x'.repeat(41) }).code, 'bad');
});


/* ---------------- bulk import ---------------- */

const HEADER = 'الاسم بالكامل\tرقم الموبايل\tالمجموعة / الفصل\tالكنيسة\tملاحظات';

function importWorld() {
  const { world, call } = regWorld();
  const mariam = addPerson(call, 'مريم زكريا', '01011112222', { group: 'ثانوي', church: 'مارجرجس' });
  const peter = addPerson(call, 'بيتر سمير', '01033334444', { group: 'إعدادي' });
  const john = addPerson(call, 'يوحنا مجدي', '01055556666', { group: 'جامعة' });
  return { world, call, mariam, peter, john };
}

const FILE = [
  HEADER,
  'مينا عادل\t01012345678\tثانوي\tمارجرجس\t',              // 2 new
  'مريم زكريا\t01011112222\tثانوي\t\t',                     // 3 exists (same), no change
  'بيتر سمير\t1033334444\tثانوي\t\t',                        // 4 exists + update (group)
  'مينا عادل\t+20 101 234 5678\t\t\t',                       // 5 dup of row 2
  'كيرلس زكريا\t01011112222\tثانوي\t\t',                     // 6 new + sharedPhone (مريم, registered)
  'يوحنا مجدي\t01277778888\tجامعة\t\t',                     // 7 new + sameName (registered, other phone)
  'أبانوب\t01099990000\tخدام\t\t',                           // 8 new + oneWord
  '\t01000000001\t\t\t',                                      // 9 error: no name
  'م ع\t01000000002\t\t\t',                                   // 10 error: too short
  '١٢٣٤٥\t01000000003\t\t\t',                                 // 11 error: digits only
  'مارك فادي\t0100000000\t\t\t',                              // 12 error: phone missing a digit
  'سارة نبيل\t0223456789\t\t\t',                              // 13 error: not an Egyptian mobile
  'جورج ناجي\t\t\t\t',                                        // 14 error: no phone
  'ماري عادل\t01012345678\tثانوي\t\t',                        // 15 new + sharedPhone with row 2 (in-file)
  'فادي عماد\t01044445555\t\t\t',                             // 16 new + sameName in-file (row 17)
  'فادي عماد\t01044446666\t\t\t',                             // 17 new + sameName in-file (row 16)
  'ن'.repeat(81) + ' س\t01000000004\t\t\t'                     // 18 error: name too long
].join('\n');

test('import preview: every classification, warnings, reasons, choices, summary and groups', () => {
  const { call, mariam, peter, john } = importWorld();
  const preview = call('apiParticipantsImportPreview', FILE);
  assert.deepEqual(preview.problems, []);
  assert.deepEqual(preview.columns, ['name', 'phone', 'group', 'church', 'notes']);
  const at = line => preview.rows.find(r => r.line === line);
  const statuses = Object.fromEntries(preview.rows.map(r => [r.line, r.status]));
  assert.deepEqual(statuses, { 2: 'new', 3: 'exists', 4: 'exists', 5: 'dup', 6: 'new', 7: 'new', 8: 'new', 9: 'error', 10: 'error', 11: 'error', 12: 'error', 13: 'error', 14: 'error', 15: 'new', 16: 'new', 17: 'new', 18: 'error' });

  assert.equal(at(2).phone, '01012345678');
  assert.equal(at(2).ticked, true);
  assert.match(at(2).warnings.find(w => w.kind === 'sharedPhone').text, /صف ١٥/);
  assert.deepEqual(at(2).choices.map(c => c.value), ['add:' + at(2).fp]);
  assert.equal(at(3).tickable, false);
  assert.equal(at(3).match.id, mariam.id);
  assert.equal(at(4).match.id, peter.id);
  assert.deepEqual(plain(at(4).changes), [{ field: 'group', label: 'المجموعة', from: 'إعدادي', to: 'ثانوي' }]);
  assert.equal(at(4).ticked, false, 'updates wait for the admin');
  assert.deepEqual(at(4).choices.map(c => c.value), [`update:${peter.id}:${at(4).fp}`]);
  assert.equal(at(5).reason, 'نفس صف ٢');
  assert.equal(at(5).tickable, false);
  assert.match(at(6).warnings.find(w => w.kind === 'sharedPhone').text, /^نفس الرقم مع: مريم زكريا \(في السجل\)/);
  assert.equal(at(6).ticked, true, 'a family phone is fine');
  const same = at(7).warnings.find(w => w.kind === 'sameName');
  assert.match(same.text, /نفس الاسم متسجل برقم تاني: 01055556666/);
  assert.equal(same.candidates[0].id, john.id);
  assert.equal(at(7).ticked, false, 'same name: the admin decides');
  assert.deepEqual(at(7).choices.map(c => c.value), ['add:' + at(7).fp, `phone:${john.id}:${at(7).fp}`]);
  assert.ok(at(8).warnings.some(w => w.kind === 'oneWord'));
  assert.deepEqual(at(9).errors, ['الاسم ناقص']);
  assert.deepEqual(at(10).errors, ['الاسم قصير قوي (أقل من ٣ حروف)']);
  assert.deepEqual(at(11).errors, ['الاسم أرقام بس']);
  assert.deepEqual(at(12).errors, ['رقم الموبايل ناقص رقم (١٠ أرقام بدل ١١)']);
  assert.deepEqual(at(13).errors, ['الرقم مش رقم موبايل مصري']);
  assert.deepEqual(at(14).errors, ['رقم الموبايل ناقص']);
  assert.match(at(15).warnings.find(w => w.kind === 'sharedPhone').text, /صف ٢/);
  assert.match(at(16).warnings.find(w => w.kind === 'sameName').text, /نفس الاسم في صف ١٧ برقم تاني/);
  assert.match(at(18).errors[0], /أطول من ٨٠ حرف/);

  assert.deepEqual(plain(preview.summary), { total: 17, new: 7, exists: 2, update: 1, dup: 1, error: 7, ticked: 4, warnings: { sharedPhone: 3, sameName: 3, oneWord: 1 } }, 'row 2 shares its phone with row 15 too');
  assert.deepEqual(plain(preview.groups), [{ name: 'ثانوي', count: 5, isNew: false }, { name: 'جامعة', count: 1, isNew: false }, { name: 'خدام', count: 1, isNew: true }]);
  assert.ok(!JSON.stringify(preview).includes('codeHash'));
});

test('import apply: only ticked rows whose fingerprint still matches; codes for new rows, existing keep id + code; same person → new phone; one Activity row with counts; re-import → all exists', () => {
  const { world, call, peter, john, mariam } = importWorld();
  const codes = { peter: codeOf(call, peter.id), john: codeOf(call, john.id), mariam: codeOf(call, mariam.id) };
  const preview = call('apiParticipantsImportPreview', FILE);
  const at = line => preview.rows.find(r => r.line === line);
  const decisions = {};
  for (const row of preview.rows) if (row.ticked) decisions['r' + row.line] = row.choices[0].value;
  decisions.r4 = at(4).choices[0].value;              // update بيتر's group
  decisions.r7 = at(7).choices[1].value;              // يوحنا: same person, new phone
  decisions.r16 = at(16).choices[0].value;            // فادي (16) added; 17 left unticked
  decisions.r9 = 'add:' + at(2).fp;                   // an error row can't be forced

  const result = call('apiParticipantsImportApply', FILE, decisions);
  assert.equal(result.added, 5, 'rows 2, 6, 8, 15, 16');
  assert.equal(result.updated, 1);
  assert.equal(result.phoneUpdated, 1);
  assert.deepEqual(plain(result.skipped), { unticked: 1, changed: 0, error: 7, exists: 1, dup: 1 });
  assert.match(result.batch, /^imp-[0-9a-f]{8}$/);
  assert.ok(!JSON.stringify(result).includes('ATH-'));

  const people = call('apiParticipants', { limit: 200 }).items;
  assert.equal(people.length, 8);
  const added = people.filter(p => p.importBatch === result.batch);
  assert.equal(added.length, 5);
  for (const p of added) assert.match(codeOf(call, p.id), CODE);
  const peterNow = people.find(p => p.id === peter.id);
  assert.equal(peterNow.group, 'ثانوي');
  const johnNow = people.find(p => p.id === john.id);
  assert.equal(johnNow.phone, '01277778888');
  assert.equal(codeOf(call, peter.id), codes.peter, 'existing keep their code');
  assert.equal(codeOf(call, john.id), codes.john, 'same person, new phone: same id, same code');
  assert.equal(codeOf(call, mariam.id), codes.mariam);
  assert.ok(added.every(p => p.importBatch === result.batch));

  const imports = activityRows(world).filter(r => r[5] === 'import' && r[6] === 'participant');
  assert.equal(imports.length, 1);
  assert.deepEqual(JSON.parse(imports[0][10]), { added: 5, updated: 1, phone: 1 });
  assert.equal(imports[0][9], 'استورد ٥ مشترك (٢ اتعدّلوا)');

  // the same file again: nothing new to add (every valid row exists, is a dup, or waits for a decision)
  const again = call('apiParticipantsImportPreview', FILE);
  const st = Object.fromEntries(again.rows.map(r => [r.line, r.status]));
  for (const line of [2, 3, 4, 6, 7, 8, 15, 16]) assert.equal(st[line], 'exists', 'line ' + line);
  assert.equal(st[5], 'dup');
  assert.equal(st[17], 'new', 'the unticked one');
  assert.ok(again.rows.filter(r => r.status === 'exists').every(r => !r.changes.length));
});

test('import apply: a concurrent change after the preview skips that row (fingerprint), the rest still applies', () => {
  const { call, peter } = importWorld();
  const preview = call('apiParticipantsImportPreview', FILE);
  const at = line => preview.rows.find(r => r.line === line);
  // another admin edits بيتر, and registers مينا عادل by hand, after the preview
  call('apiParticipantSave', { id: peter.id, church: 'العذراء' });
  call('apiParticipantSave', { name: 'مينا عادل', phone: '01012345678' });
  const result = call('apiParticipantsImportApply', FILE, { r2: at(2).choices[0].value, r4: at(4).choices[0].value, r8: at(8).choices[0].value });
  assert.equal(result.added, 1, 'row 8 only');
  assert.equal(result.updated, 0);
  assert.equal(result.changed, 2);
  assert.match(result.rows.find(r => r.line === 4).reason, /اتغير من بعد المعاينة/);
  assert.equal(call('apiParticipants', { q: 'مينا عادل' }).total, 1, 'never a second مينا عادل');
});

test('undo import: removes the batch while nobody of it has played; refused afterwards', () => {
  const { world, call } = regWorld();
  const text = [HEADER, 'مينا عادل\t01012345678\tثانوي\t\t', 'مريم زكريا\t01011112222\tثانوي\t\t'].join('\n');
  const preview = call('apiParticipantsImportPreview', text);
  const decisions = Object.fromEntries(preview.rows.map(r => ['r' + r.line, r.choices[0].value]));
  const first = call('apiParticipantsImportApply', text, decisions);
  assert.equal(first.added, 2);
  const undone = call('apiParticipantsUndoImport', first.batch);
  assert.equal(undone.removed, 2);
  assert.equal(call('apiParticipants', {}).total, 0);
  assert.ok(activityRows(world).some(r => r[5] === 'delete' && r[9] === 'لغى استيراد ٢ مشترك'));
  assert.throws(() => call('apiParticipantsUndoImport', first.batch), /مش موجود/);

  const preview2 = call('apiParticipantsImportPreview', text);
  const second = call('apiParticipantsImportApply', text, Object.fromEntries(preview2.rows.map(r => ['r' + r.line, r.choices[0].value])));
  codedComp(world, call);
  const mina = call('apiParticipants', { q: 'مينا' }).items[0];
  play(world, login(world, codeOf(call, mina.id)));
  assert.throws(() => call('apiParticipantsUndoImport', second.batch), /شاركوا في مسابقات/);
  assert.equal(call('apiParticipants', {}).total, 2);
});

test('import: 500 rows preview + apply in one go (timed); limits 500 rows / 300 KB; no header → the template order', () => {
  const { call } = regWorld();
  const lines = [HEADER];
  for (let i = 0; i < 500; i++) lines.push(`مشترك رقم ${'أبجدهوزحطيكلمنسعفصقرشتثخذضظغ'[i % 28]}${'ابتثجحخدذرزسشصضطظعغفقكلمنهوي'[Math.floor(i / 28) % 28]} عائلة\t010${String(20000000 + i).padStart(8, '0')}\tمجموعة ${i % 7}\t\t`);
  const text = lines.join('\n');
  const t0 = Date.now();
  const preview = call('apiParticipantsImportPreview', text);
  const t1 = Date.now();
  assert.deepEqual(preview.problems, []);
  assert.equal(preview.summary.new, 500, JSON.stringify(preview.rows.find(r => r.status !== 'new')));
  const decisions = Object.fromEntries(preview.rows.map(r => ['r' + r.line, r.choices[0].value]));
  const result = call('apiParticipantsImportApply', text, decisions);
  const t2 = Date.now();
  assert.equal(result.added, 500);
  console.log(`# 500-row import: preview ${t1 - t0} ms, apply ${t2 - t1} ms`);
  assert.ok(t2 - t0 < 30000, 'well within an Apps Script run');
  const codes = call('apiParticipantCodes', { batch: result.batch });
  assert.equal(codes.count, 500);
  assert.equal(new Set(codes.rows.map(r => r.code)).size, 500, 'unique codes');

  const tooMany = call('apiParticipantsImportPreview', lines.concat([`زيادة واحد\t01099998888\t\t\t`]).join('\n'));
  assert.match(tooMany.problems[0], /٥٠١ صف، والحد ٥٠٠/);
  assert.equal(tooMany.rows.length, 500);
  assert.match(call('apiParticipantsImportPreview', 'x'.repeat(301 * 1024)).problems[0], /كبير قوي/);
  const bare = call('apiParticipantsImportPreview', 'مينا الجديد\t01087654321\tثانوي');
  assert.equal(bare.rows[0].status, 'new');
  assert.equal(bare.rows[0].group, 'ثانوي');
  assert.match(call('apiParticipantsImportPreview', 'عمود\tتاني\nx\ty').problems[0], /أول صف لازم يكون العناوين/);
  // English headers and aliases
  const english = call('apiParticipantsImportPreview', 'Name\tPhone\tGroup\tChurch\tNotes\nMina Adel\t01087654321\tA\tB\tC');
  assert.deepEqual([english.rows[0].status, english.rows[0].church, english.rows[0].notes], ['new', 'B', 'C']);
});


/* ---------------- a registered competition end to end ---------------- */

test('registered competition: code → ptoken → start (identity from the registry) → submit → result; attempts per participant; another device resumes the same attempt', () => {
  const { world, call } = regWorld();
  const p = addPerson(call, 'مينا عادل', phone(61), { group: 'ثانوي' });
  const q = addPerson(call, 'مريم عادل', phone(61), { group: 'ثانوي' });   // the same family phone
  codedComp(world, call);
  const ptoken = login(world, codeOf(call, p.id));

  // no / bad token → session; typed identity is ignored
  assert.equal(pub(world, 'compStart', { slug: 'coded-quiz', clientKey: clientKey() }).code, 'session');
  assert.equal(pub(world, 'compStart', { slug: 'coded-quiz', clientKey: clientKey(), ptoken: 'pt1.x.y' }).code, 'session');

  const keyA = clientKey();
  const a = pub(world, 'compStart', { slug: 'coded-quiz', clientKey: keyA, ptoken, fields: { name: 'حد تاني', phone: '01099999999' } });
  assert.equal(a.ok, true);
  const row = tab(world, 'Submissions').find(r => r.id === a.attempt.id);
  assert.equal(row.participantId, p.id);
  assert.equal(row.name, 'مينا عادل', 'name from the registry');
  assert.equal(row.phone, '+201012340061', 'phone from the registry');
  assert.equal(JSON.parse(row.fields).group, 'ثانوي');

  // another device (a new clientKey, a new login): the same in-progress attempt
  const ptoken2 = login(world, codeOf(call, p.id));
  const b = pub(world, 'compStart', { slug: 'coded-quiz', clientKey: clientKey(), ptoken: ptoken2 });
  assert.equal(b.attempt.id, a.attempt.id);
  assert.equal(b.attempt.resumed, true);
  assert.deepEqual(b.questions.map(x => x.id), a.questions.map(x => x.id));

  const done = pub(world, 'compSubmit', { token: b.attempt.token, clientKey: keyA, answers: answersFor(a) });
  assert.equal(done.ok, true);
  assert.equal(done.result.status, 'graded');
  assert.equal(done.result.score, 15);
  assert.equal(pub(world, 'compResult', { ptoken, submissionId: a.attempt.id }).result.score, 15);

  // one attempt per participant (not per phone: the sister can still play)
  assert.equal(pub(world, 'compStart', { slug: 'coded-quiz', clientKey: clientKey(), ptoken }).code, 'limit');
  const sister = play(world, login(world, codeOf(call, q.id)));
  assert.equal(sister.done.result.status, 'graded');
  // someone else's submission is not theirs
  assert.equal(pub(world, 'compResult', { ptoken, submissionId: sister.id }).code, 'not_found');

  // the registry switched off: registered competitions answer disabled
  call('apiCompSettings', { registry: false });
  assert.equal(pub(world, 'compStart', { slug: 'coded-quiz', clientKey: clientKey(), ptoken }).code, 'disabled');
  assert.equal(pub(world, 'compCode', { code: 'ATH-2345-6789' }).code, 'disabled');
});


/* ---------------- module switches ---------------- */

test('module switches: each needs the one before (chain enforced), logged; disabled modules answer disabled; admin writes need the switch', () => {
  const world = compWorld();
  const call = adminApi(world);
  assert.deepEqual(plain(call('apiCompSettings', { wallet: true, shop: true }).modules), { registry: false, wallet: false, shop: false }, 'no registry: nothing else');
  assert.deepEqual(plain(call('apiCompSettings', { registry: true, shop: true }).modules), { registry: true, wallet: false, shop: false }, 'no wallet: no store');
  assert.deepEqual(plain(call('apiCompSettings', { wallet: true, shop: true }).modules), { registry: true, wallet: true, shop: true });
  assert.deepEqual(plain(call('apiCompSettings', { wallet: false }).modules), { registry: true, wallet: false, shop: false }, 'the store goes with the wallet');
  assert.equal(world.properties.get('COMP_SHOP'), '');
  assert.ok(activityRows(world).filter(r => r[5] === 'settings').length >= 1);

  for (const fn of ['shopRedeem']) assert.equal(pub(world, fn, {}).code, 'disabled', fn);
  assert.throws(() => call('apiWalletAdjust', 'p-00000000', 5, 'x', 'adjust-key-1'), /المحفظة والنقاط» مش متفعّلة/);
  assert.throws(() => call('apiShopItemSave', { name: 'x', cost: 5 }), /متجر الجوائز» مش متفعّل/);
  call('apiCompSettings', { registry: false });
  for (const fn of ['compCode', 'portalMe', 'portalReview', 'shopRedeem']) assert.equal(pub(world, fn, {}).code, 'disabled', fn);
  assert.throws(() => call('apiParticipantSave', { name: 'مينا عادل', phone: phone(1) }), /المشاركين بالأكواد» مش متفعّل/);
  // reads keep working (data is kept)
  assert.equal(call('apiParticipants', {}).total, 0);
});


/* ---------------- the encrypted copy ---------------- */

test('codeEnc: decrypts to the code with CODE_KEY only; a tampered copy is refused (no code, no crash); secrets never replaced', () => {
  const { world, call } = regWorld();
  const p = addPerson(call, 'مينا عادل', phone(71));
  const code = codeOf(call, p.id);
  const sheet = world.compSpreadsheet.getSheetByName('Participants');
  const col = sheet.data[0].indexOf('codeEnc');
  const line = sheet.data.find(r => r[0] === p.id);
  const enc = String(line[col]);
  const key = world.gs.compSecretBytes_('CODE_KEY');
  assert.equal(world.gs.compDecrypt_(enc, key), code.replace(/^ATH-|-/g, ''));
  assert.equal(world.gs.compDecrypt_(enc, world.gs.compSecretBytes_('CODE_PEPPER')), null, 'another key');
  const flipped = enc.slice(0, 10) + (enc[10] === 'A' ? 'B' : 'A') + enc.slice(11);
  assert.equal(world.gs.compDecrypt_(flipped, key), null, 'tampered');

  const pepper = world.properties.get('CODE_PEPPER');
  const codeKey = world.properties.get('CODE_KEY');
  addPerson(call, 'مريم زكريا', phone(72));
  call('apiParticipantResetCode', p.id);
  assert.equal(world.properties.get('CODE_PEPPER'), pepper, 'never replaced');
  assert.equal(world.properties.get('CODE_KEY'), codeKey);

  line[col] = flipped;
  world.gs.COMP_TABS_ = {};
  assert.throws(() => call('apiParticipantCode', p.id), /مش متاح للعرض/);
});


/* ---------------- secrets never wait on a lock this execution holds ---------------- */

function recordLocks(world) {
  const calls = [];
  let held = false;
  const real = world.gs.LockService.getScriptLock;
  world.gs.LockService.getScriptLock = () => {
    const lock = real();
    return {
      waitLock(ms) { calls.push({ op: 'wait', ms, held }); lock.waitLock(ms); held = true; },
      tryLock(ms) { calls.push({ op: 'try', ms, held }); const ok = lock.tryLock(ms); if (ok) held = true; return ok; },
      releaseLock() { held = false; lock.releaseLock(); }
    };
  };
  return calls;
}

test('secrets: made eagerly before admin locks; never a blocking tryLock while the script lock is held; public creation never blocks', () => {
  const world = compWorld();
  const call = adminApi(world);
  const calls = recordLocks(world);
  call('apiCompSettings', { registry: true });
  for (const name of ['COMP_SECRET', 'CODE_PEPPER', 'CODE_KEY']) assert.equal(world.properties.get(name).length, 44, name);
  addPerson(call, 'مينا عادل', phone(81));
  assert.ok(!calls.some(c => c.op === 'try' && c.held), 'no tryLock while holding the script lock: ' + JSON.stringify(calls));

  // inside an outer script lock of this execution: created without touching the lock at all
  const before = calls.length;
  world.gs.COMP_SCRIPT_LOCK_HELD_ = true;
  world.properties.delete('CODE_KEY');
  world.scriptLock.busy = true;
  const value = world.gs.compSecret_('CODE_KEY');
  world.gs.COMP_SCRIPT_LOCK_HELD_ = false;
  assert.equal(value.length, 44);
  assert.equal(world.properties.get('CODE_KEY'), value);
  assert.equal(calls.length, before, 'the lock was not touched');

  // an existing secret is never replaced
  world.scriptLock.busy = false;
  world.gs.compEnsureSecrets_();
  assert.equal(world.properties.get('CODE_KEY'), value);
  world.properties.set('CODE_PEPPER', 'short');
  assert.equal(world.gs.compSecret_('CODE_PEPPER'), 'short', 'present = kept');

  // a public call that finds COMP_SECRET missing while someone holds the script lock: tryLock(0), created, no wait
  codedComp(world, call);
  world.properties.delete('COMP_SECRET');
  world.scriptLock.busy = true;
  const mark = calls.length;
  const reply = pub(world, 'compStart', { slug: 'coded-quiz', clientKey: clientKey(), ptoken: 'pt1.abababab.' + 'A'.repeat(43) });
  world.scriptLock.busy = false;
  assert.equal(reply.code, 'session', 'answered (token checked with the new secret)');
  assert.equal(world.properties.get('COMP_SECRET').length, 44);
  assert.ok(calls.slice(mark).every(c => c.op === 'try' && c.ms === 0), JSON.stringify(calls.slice(mark)));
});

test('failed-code day counter: one property write per counted failure, none once the day cap is reached', () => {
  const { world, call } = regWorld();
  const p = addPerson(call, 'مينا عادل', phone(82));
  const today = new Date(world.now()).toISOString().slice(0, 10);
  pub(world, 'compCode', { code: 'ATH-2345-6789' });
  assert.equal(world.properties.get('COMP_FAIL_DAY'), today + ':1');
  world.properties.set('COMP_FAIL_DAY', today + ':1000');
  let writes = 0;
  const props = world.gs.PropertiesService.getScriptProperties;
  world.gs.PropertiesService.getScriptProperties = () => { const p2 = props(); return { ...p2, setProperty: (k, v) => { writes++; p2.setProperty(k, v); } }; };
  assert.equal(pub(world, 'compCode', { code: 'ATH-2345-6789' }).code, 'busy');
  assert.equal(pub(world, 'compCode', { code: codeOf(call, p.id) }).code, 'busy');
  world.gs.compCodeFailed_();
  world.gs.PropertiesService.getScriptProperties = props;
  assert.equal(writes, 0, 'no write past the cap');
  assert.equal(world.properties.get('COMP_FAIL_DAY'), today + ':1000');
});


test('regRowById_: the row read must carry the id looked for (rows shift after an undo), else it looks again, else null', () => {
  const { world, call } = regWorld();
  const a = addPerson(call, 'مينا عادل', phone(91));
  const b = addPerson(call, 'مريم زكريا', phone(92));
  const real = world.gs.compFindRow_;
  let calls = 0;
  // the first lookup lands on the wrong row (as if a row above was deleted in between)
  world.gs.compFindRow_ = (t, column, value) => (++calls === 1 ? real(t, column, b.id) : real(t, column, value));
  assert.equal(world.gs.regRowById_(a.id).id, a.id);
  assert.equal(calls, 2, 'looked again');
  world.gs.compFindRow_ = (t, column) => real(t, column, b.id);
  assert.equal(world.gs.regRowById_(a.id), null, 'never someone else');
  world.gs.compFindRow_ = real;
});
