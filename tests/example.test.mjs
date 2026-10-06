// The reference example in docs/examples (used by docs/ADMIN-GUIDE.md)
// must stay valid, and the game timeline the guide describes must be true.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

globalThis.document = { createElement: () => ({ content: {} }) };

const { sanitizeContent } = await import('../assets/js/content.js');
const { gameState, meetingStatus, zonedNow, stamp } = await import('../assets/js/schedule.js');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = () => JSON.parse(readFileSync(`${ROOT}docs/examples/content.example.json`, 'utf8'));

test('the example is what the publish code produces today', () => {
  const before = readFileSync(`${ROOT}docs/examples/content.example.json`, 'utf8');
  execFileSync(process.execPath, [`${ROOT}tools/build-example.mjs`], { stdio: 'pipe' });
  const after = readFileSync(`${ROOT}docs/examples/content.example.json`, 'utf8');
  assert.equal(after.replace(/\r\n/g, '\n'), before.replace(/\r\n/g, '\n'), 'run: node tools/build-example.mjs');
});

test('the browser keeps every part of the example', () => {
  const raw = read();
  const clean = sanitizeContent(raw);
  assert.equal(clean.sessions.length, raw.sessions.length);
  assert.equal(clean.news.length, raw.news.length);
  assert.equal(clean.notifications.length, raw.notifications.length);
  const game = clean.games[0];
  assert.equal(game.url, 'https://example.com/church-explorer');
  assert.equal(game.buttonLabel, 'ابدأ اللعب');
  assert.deepEqual(game.image, raw.games[0].image);
});

test('the game timeline in the guide', () => {
  const game = sanitizeContent(read()).games[0];
  const at = time => gameState(game, time).state;
  assert.equal(at('2026-10-11T20:59'), 'hidden');
  assert.equal(at('2026-10-11T21:00'), 'soon');
  assert.equal(gameState(game, '2026-10-11T21:15').minutesUntil, 45);
  assert.equal(at('2026-10-11T22:00'), 'open');
  assert.equal(at('2026-10-11T23:30'), 'ended');
  assert.equal(at('2026-10-12T11:30'), 'hidden');
});

test('the meeting in the example: topic on the 11th, the 18th cancelled', () => {
  const content = sanitizeContent(read());
  const cairo = iso => {
    for (const offset of [2, 3]) {
      const date = new Date(`${iso}:00Z`);
      date.setUTCHours(date.getUTCHours() - offset);
      if (stamp(zonedNow('Africa/Cairo', date)) === iso) return zonedNow('Africa/Cairo', date);
    }
    throw new Error(iso);
  };
  const thursday = meetingStatus(content.meeting, cairo('2026-10-08T20:30'), content.sessions);
  assert.equal(thursday.date.iso, '2026-10-11');
  assert.equal(thursday.session.topic, 'حياة التسليم');
  const monday = meetingStatus(content.meeting, cairo('2026-10-12T10:00'), content.sessions);
  assert.equal(monday.date.iso, '2026-10-25', 'the 18th is skipped');
  assert.deepEqual(monday.skipped, ['2026-10-18']);
});
