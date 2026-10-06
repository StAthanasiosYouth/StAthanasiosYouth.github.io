// The one visibility rule, in its three homes: the public site
// (schedule.js), the publish check (Hub.gs) and the admin (AdminScript).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { visibilityState, isWithinWindow, isPublished } from '../assets/js/schedule.js';
import { loadGs, ROOT } from '../tools/lib/gs.mjs';

const gs = loadGs();

// the admin's copy, run on its own (it only needs A.wallMinutes/formatWall/cairoNow)
function adminVisibility() {
  const source = readFileSync(`${ROOT}apps-script/AdminScript.html`, 'utf8');
  const body = /A\.visibility = function[\s\S]*?\n {2}};/.exec(source)[0];
  const A = {
    wallMinutes(value, endOfDay) {
      const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(String(value || ''));
      if (!m) return null;
      const hh = m[4] === undefined ? (endOfDay ? 23 : 0) : +m[4];
      const mm = m[5] === undefined ? (endOfDay ? 59 : 0) : +m[5];
      return Date.UTC(+m[1], +m[2] - 1, +m[3], hh, mm) / 60000;
    },
    formatWall: value => String(value),
    cairoNow: () => '2026-10-08 20:00'
  };
  vm.runInNewContext(body, { A });
  return (enabled, from, until, now) => A.visibility(enabled, from, until, A.wallMinutes(now)).state;
}

const NOW = '2026-10-08T20:00';

// [enabled, from, until, expected]
const CASES = [
  [false, '', '', 'off'],
  [false, '2026-10-01T00:00', '2026-12-01T00:00', 'off'],
  [true, '', '', 'live'],
  [true, '2026-10-08T20:00', '', 'live'],
  [true, '2026-10-08T20:01', '', 'scheduled'],
  [true, '', '2026-10-08T20:00', 'live'],
  [true, '', '2026-10-08T19:59', 'ended'],
  [true, '2026-10-01T00:00', '2026-10-09T00:00', 'live'],
  [true, '2026-10-09T00:00', '2026-10-01T00:00', 'scheduled']
];

test('public site: visibilityState', () => {
  for (const [enabled, from, until, expected] of CASES) {
    assert.equal(visibilityState({ enabled, from, until }, NOW), expected, JSON.stringify({ enabled, from, until }));
  }
  assert.equal(visibilityState({}, NOW), 'live', 'no window, enabled by default');
});

test('publish check (Hub.gs) agrees with the site', () => {
  for (const [enabled, from, until, expected] of CASES) {
    assert.equal(gs.visibilityState_(enabled, from, until, NOW), expected);
  }
});

test('admin agrees too ("live" and "always" both mean showing)', () => {
  const admin = adminVisibility();
  for (const [enabled, from, until, expected] of CASES) {
    const state = admin(enabled, from.replace('T', ' '), until.replace('T', ' '), NOW.replace('T', ' '));
    assert.equal(state === 'always' ? 'live' : state, expected, JSON.stringify({ enabled, from, until }));
  }
  // a date alone as "until" means the end of that day
  assert.equal(admin(true, '', '2026-10-08', '2026-10-08 23:30'), 'live');
  assert.equal(admin(true, '', '2026-10-08', '2026-10-09 00:00'), 'ended');
});

test('links and news windows still behave as before', () => {
  assert.equal(isWithinWindow({ startAt: '2026-10-09T00:00' }, NOW), false);
  assert.equal(isWithinWindow({ endAt: '2026-10-08T20:00' }, NOW), true);
  assert.equal(isPublished({ publishAt: '2026-10-08T20:00', expireAt: '' }, NOW), true);
  assert.equal(isPublished({ publishAt: '', expireAt: '2026-10-08T19:00' }, NOW), false);
});
