// Shared set-up for the registry / wallet / store tests (tests/comp-registry,
// comp-wallet, comp-shop): the modules switched on, participants with codes,
// a published competition with codes, a participant playing it.

import assert from 'node:assert/strict';
import { compWorld, adminApi, pub, clientKey, publish } from './comp.mjs';

export const phone = n => '0101234' + String(n).padStart(4, '0');

/* a world with the registry (and optionally the wallet / the store) switched on */
export function regWorld({ wallet = false, shop = false } = {}) {
  const world = compWorld();
  const call = adminApi(world);
  call('apiCompSettings', { registry: true, wallet: wallet || shop, shop });
  return { world, call };
}

export const addPerson = (call, name, number, extra = {}) => call('apiParticipantSave', { name, phone: number, ...extra }).participant;
export const codeOf = (call, id) => call('apiParticipantCode', id).code;

/* compCode → the ptoken (asserts success) */
export function login(world, code) {
  const reply = pub(world, 'compCode', { code });
  assert.equal(reply.ok, true, JSON.stringify(reply));
  return reply.ptoken;
}

/* a published registered competition: single (10) + truefalse (5), optionally a long (manual, 20) */
export function codedComp(world, call, { slug = 'coded-quiz', preset = 'coded', long = false, overrides = {} } = {}) {
  const created = call('apiCompCreate', { preset, title: 'مسابقة بأكواد ' + slug, slug, enabled: true, ...overrides });
  const id = created.comp.id;
  const q = input => call('apiCompQuestionSave', id, input).question;
  const questions = {
    single: q({ type: 'single', text: 'مين بنى الفلك؟', choices: [{ text: 'نوح', correct: true }, { text: 'موسى' }], points: 10 }),
    tf: q({ type: 'truefalse', text: 'داود قتل جليات', correct: 'صح', points: 5 })
  };
  if (long) questions.long = q({ type: 'long', text: 'اكتب تأمل', points: 20 });
  publish(world, call);
  return { id, questions };
}

/* answers for codedComp: right = everything right; 'half' = only the single question */
export function answersFor(start, right = true) {
  const answers = {};
  for (const q of start.questions) {
    if (q.type === 'single') answers[q.id] = q.choices.find(c => c.text === (right ? 'نوح' : 'موسى')).id;
    if (q.type === 'truefalse') answers[q.id] = right === true ? 't' : 'f';
    if (q.type === 'long') answers[q.id] = 'تأمل قصير';
  }
  return answers;
}

/* start + submit with a ptoken → { start, done, id } */
export function play(world, ptoken, { slug = 'coded-quiz', right = true, key = clientKey() } = {}) {
  const start = pub(world, 'compStart', { slug, clientKey: key, ptoken });
  assert.equal(start.ok, true, JSON.stringify(start));
  const done = pub(world, 'compSubmit', { token: start.attempt.token, clientKey: key, answers: answersFor(start, right) });
  assert.equal(done.ok, true, JSON.stringify(done));
  return { start, done, id: start.attempt.id };
}

export const activityRows = world => {
  const sheet = world.spreadsheet.getSheetByName('Activity');
  return sheet ? sheet.data.slice(1).filter(r => r[0]) : [];
};

export const tab = (world, name) => {
  const sheet = world.compSpreadsheet && world.compSpreadsheet.getSheetByName(name);
  if (!sheet) return [];
  const [header, ...rows] = sheet.data;
  return rows.filter(r => r.some(c => c !== '' && c !== null && c !== undefined)).map(r => Object.fromEntries(header.map((h, i) => [h, r[i] === undefined || r[i] === null ? '' : String(r[i]).replace(/^'/, '')])));
};
