/**
 * Which competitions /competitions/ lists (site redesign S4, PLAN §1 decision 6): the published ones, open or
 * coming, and the ones that ended in the last RECENT_DAYS. Pure (no DOM): list.js draws them, home.js shows the
 * «المسابقات» shortcut only while there is one (tests/comp-list.test.mjs).
 */

import { realMinutesBetween } from '../schedule.js';

export const RECENT_DAYS = 30;

/** which competitions the page lists, and in what state (pure: tests/comp-list.test.mjs) */
export function listOf(competitions, now, recentDays = RECENT_DAYS) {
  const out = [];
  for (const c of competitions || []) {
    if (!c || !c.slug) continue;
    const state = c.startAt && now < c.startAt ? 'soon' : c.endAt && now >= c.endAt ? 'done' : 'open';
    if (state === 'done') {
      const since = realMinutesBetween(c.endAt, now);
      if (since === null || since > recentDays * 1440) continue;
    }
    out.push({ ...c, state });
  }
  const rank = { open: 0, soon: 1, done: 2 };
  return out.sort((a, b) => rank[a.state] - rank[b.state]
    || (a.state === 'open' ? (a.endAt || '9').localeCompare(b.endAt || '9')
      : a.state === 'soon' ? a.startAt.localeCompare(b.startAt)
        : b.endAt.localeCompare(a.endAt)));
}

/** true when the page has something to show (the home's shortcut) */
export const hasCompetitions = (competitions, now) => listOf(competitions, now).length > 0;
