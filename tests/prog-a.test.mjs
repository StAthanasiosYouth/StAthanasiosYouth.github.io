// Program A (public side), pure parts:
//   - sessions[].program and layout[].surface / surfaceMobile are
//     re-validated in the browser (content.js): strict whitelist, garbage
//     never crashes and never gets through
//   - live.json is re-validated too (program.js cleanLive)
//   - programAt: the stage on now by Cairo wall time, the live.json
//     override for its own date only, the polling window, the end

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// icons.js builds a <template> at import time
globalThis.document = { createElement: () => ({ content: {} }) };

const { sanitizeContent } = await import('../assets/js/content.js');
const { meetingStatus, zonedNow, cairoInstant } = await import('../assets/js/schedule.js');
const { programAt, cleanLive, PROGRAM_LEAD } = await import('../assets/js/program.js');
const seed = JSON.parse(readFileSync(new URL('../content.json', import.meta.url), 'utf8'));

const D = '2026-10-11';
const PROGRAM = [
  { title: 'تسبحة', start: `${D}T20:00`, end: `${D}T20:30` },
  { title: 'الكلمة', start: `${D}T20:30`, end: `${D}T21:15` },
  { title: 'ترانيم', start: `${D}T21:15`, end: `${D}T21:45` },
  { title: 'الختام', start: `${D}T21:45`, end: `${D}T22:00` }
];
const session = { date: D, time: '20:00', topic: 'x', status: 'normal', durationMinutes: 120, program: PROGRAM };

const withSessions = sessions => sanitizeContent({ ...seed, sessions });


/* ---------------- content.js ---------------- */

test('a valid program passes unchanged; no program = null', () => {
  const c = withSessions([session, { date: '2026-10-18', time: '20:00' }]);
  assert.deepEqual(c.sessions[0].program, PROGRAM);
  assert.equal(c.sessions[1].program, null);
});

test('program garbage is dropped stage by stage, never crashes', () => {
  const bad = [
    'nope',
    null,
    { title: '', start: `${D}T19:00`, end: `${D}T19:30` },                  // no title
    { title: 'x'.repeat(80), start: `${D}T20:00`, end: `${D}T20:30` },      // trimmed to 40
    { title: 'سهم', start: `${D}T20:10`, end: `${D}T20:40` },                // overlaps the one before
    { title: 'مقلوب', start: `${D}T21:00`, end: `${D}T20:50` },             // ends before it starts
    { title: 'تاريخ غلط', start: '2026-10-11 21:00', end: `${D}T21:30` },   // wrong format
    { title: '<b>كلمة</b>', start: `${D}T20:30`, end: `${D}T21:00`, extra: 'x' }
  ];
  const c = withSessions([{ ...session, program: bad }]);
  assert.deepEqual(c.sessions[0].program, [
    { title: 'x'.repeat(40), start: `${D}T20:00`, end: `${D}T20:30` },
    { title: '<b>كلمة</b>', start: `${D}T20:30`, end: `${D}T21:00` }
  ], 'only whitelisted keys; text stays text');
  for (const program of [undefined, null, 'x', 42, {}, [], [[]]]) {
    assert.equal(withSessions([{ ...session, program }]).sessions[0].program, null);
  }
});

test('surfaces: whitelist only, on any section; missing = default', () => {
  const layout = [
    { key: 'social', kind: 'links', surface: 'glass', surfaceMobile: 'none' },
    { key: 'meeting', kind: 'meeting', surface: 'dark' },
    { key: 'location', kind: 'location', surface: 'filled', surfaceMobile: 'glass' },
    { key: 'share', kind: 'share', surface: 'blur(99px)', surfaceMobile: { x: 1 } },
    { key: 'contacts', kind: 'contacts' }
  ];
  const c = sanitizeContent({ ...seed, layout });
  assert.deepEqual(c.layout.map(s => [s.key, s.surface, s.surfaceMobile]), [
    ['social', 'glass', 'none'],
    ['meeting', 'dark', ''],
    ['location', 'filled', 'glass'],
    ['share', '', ''],
    ['contacts', '', '']
  ]);
});

test('live.json: only the frozen shape gets through', () => {
  assert.deepEqual(cleanLive({ schema: 1, date: D, stage: 2, updatedAt: '2026-10-11T18:31:00Z' }), { date: D, stage: 2, updatedAt: '2026-10-11T18:31:00Z' });
  assert.deepEqual(cleanLive({ schema: 1, date: D, stage: null }), { date: D, stage: null, updatedAt: '' });
  assert.equal(cleanLive({ schema: 1, date: D, stage: -1 }).stage, null);
  assert.equal(cleanLive({ schema: 1, date: D, stage: 1.5 }).stage, null);
  assert.equal(cleanLive({ schema: 1, date: D, stage: '2' }).stage, null);
  for (const raw of [null, 'x', [], {}, { schema: 2, date: D, stage: 1 }, { schema: 1, date: '11/10/2026', stage: 1 }, { schema: 1, stage: 1 }]) {
    assert.equal(cleanLive(raw), null, JSON.stringify(raw));
  }
});


/* ---------------- programAt ---------------- */

test('programAt: the stage the Cairo clock is in, -1 before, null after', () => {
  assert.equal(programAt(session, `${D}T19:00`).index, -1);
  assert.equal(programAt(session, `${D}T19:00`).window, false, 'too early to ask live.json');
  assert.equal(programAt(session, `${D}T19:${60 - PROGRAM_LEAD}`).window, true, 'the window opens a little before');
  assert.equal(programAt(session, `${D}T20:00`).index, 0);
  assert.equal(programAt(session, `${D}T20:29`).index, 0);
  assert.equal(programAt(session, `${D}T20:30`).index, 1);
  assert.equal(programAt(session, `${D}T21:59`).index, 3);
  assert.equal(programAt(session, `${D}T22:00`), null, 'ended');
  assert.equal(programAt({ ...session, program: null }, `${D}T20:40`), null);
  assert.equal(programAt(null, `${D}T20:40`), null);
});

test('programAt: live.json wins for its own date, a valid stage only', () => {
  const at = live => programAt(session, `${D}T20:40`, live);
  assert.deepEqual([at({ date: D, stage: 3 }).index, at({ date: D, stage: 3 }).manual], [3, true]);
  assert.deepEqual([at({ date: D, stage: 0 }).index, at({ date: D, stage: 0 }).manual], [0, true]);
  assert.equal(at({ date: D, stage: null }).index, 1, 'null = automatic');
  assert.equal(at({ date: '2026-10-04', stage: 3 }).index, 1, 'another date = automatic');
  assert.equal(at({ date: D, stage: 4 }).index, 1, 'out of range = automatic');
  assert.equal(at(null).index, 1);
  // the leader started early
  assert.equal(programAt(session, `${D}T19:55`, { date: D, stage: 0 }).index, 0);
});

test('the live meeting carries its program (meetingStatus → session)', () => {
  const c = withSessions([session]);
  const now = zonedNow('Africa/Cairo', new Date(cairoInstant(`${D}T20:40`)));
  const status = meetingStatus(c.meeting, now, c.sessions);
  assert.equal(status.state, 'live');
  assert.equal(programAt(status.session, `${D}T20:40`).stages[1].title, 'الكلمة');
});
