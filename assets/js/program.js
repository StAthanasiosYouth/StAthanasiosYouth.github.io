/**
 * PROGRAM: a meeting's program while it runs. Not part of the first visit:
 * render.js loads it (with program.css) only for a meeting that has one.
 *
 * - The meeting widget: «دلوقتي» / «بعدها» (before it starts, one quiet
 *   «أول حاجة» line; after it ends, nothing), two fixed rows, so a stage
 *   change never moves the page; a soft roll in the full tier only.
 * - The meeting sheet: the whole program, the stage on now marked.
 * - live.json (the stage the leader is on): asked only from a few minutes
 *   before the program until its end, only while the tab is visible,
 *   about every 30 s (with the page's tick) and when the tab comes back.
 *   Kept in memory only; missing or broken = the program's own times.
 */

import { h } from './dom.js';
import { addMinutes, stamp, stampToMinutes, zonedNow } from './schedule.js';
import { formatTime } from './words.js';
import { swapText } from './motion.js';

export const PROGRAM_LEAD = 15;

const doc = globalThis.document;
const root = doc && doc.documentElement;


/**
 * Where a session's program is (stages: Cairo wall stamps, in order).
 * live: { date, stage } from live.json or null; it wins for its own date.
 * null = no program, or it ended; else { stages, index (-1 = not started),
 * manual, window (live.json is worth asking) }.
 */
export function programAt(session, nowStamp, live = null) {

  const stages = session && session.program;

  if (!stages || !stages.length || nowStamp >= stages[stages.length - 1].end) return null;

  const manual = !!live && live.date === session.date && Number.isInteger(live.stage) && live.stage >= 0 && live.stage < stages.length;
  let index = -1;

  if (manual) index = live.stage;
  else for (let i = 0; i < stages.length; i++) if (stages[i].start <= nowStamp) index = i;

  return { stages, index, manual, window: nowStamp >= addMinutes(stages[0].start, -PROGRAM_LEAD) };

}


/** live.json, re-validated (the frozen shape only); null when unusable. */
export function cleanLive(raw) {

  if (!raw || typeof raw !== 'object' || raw.schema !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date || '')) return null;

  return {
    date: raw.date,
    stage: Number.isInteger(raw.stage) && raw.stage >= 0 && raw.stage < 24 ? raw.stage : null,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt.slice(0, 40) : ''
  };

}


/* the widget's stylesheet, before anything shows (the sheet's list is
   styled by sheets.css) */
let css = null;

export const styles = () => (css ||= new Promise(resolve => {
  const link = h('link', { rel: 'stylesheet', href: new URL('../css/program.css', import.meta.url).href });
  link.onload = link.onerror = resolve;
  doc.head.append(link);
}));


/* ---------- live.json ---------- */

let live = null;
let askedAt = 0;
let asking = false;
let last = null;
let current = null;
const rowsOf = new WeakMap();

/** The live.json answer in use (null = automatic). */
export const liveState = () => live;

function follow(prog, force) {

  if (!prog || !prog.window || root.hasAttribute('data-preview')) {
    if (live) { live = null; repaint(); }
    return;
  }

  if (doc.hidden || asking || Date.now() - askedAt < (force ? 5000 : 29000)) return;

  asking = true;
  askedAt = Date.now();

  fetch(`live.json?ts=${Date.now()}`, { cache: 'no-store' })
    .then(response => (response.ok ? response.json() : null))
    .then(cleanLive, () => null)
    .then(next => {
      asking = false;
      if (JSON.stringify(next) !== JSON.stringify(live)) {
        live = next;
        repaint();
      }
    });

}

function repaint() {

  if (last && last.slot.isConnected) paint(last.slot, last.status, zonedNow());

}

if (doc && doc.addEventListener) {
  doc.addEventListener('visibilitychange', () => {
    if (!doc.hidden && last && last.slot.isConnected) follow(current, true);
  });
}


/* ---------- the meeting widget ---------- */

const at = (wall, nowStamp) => (wall > nowStamp ? `الساعة ${formatTime(stampToMinutes(wall) % 1440)}` : '');

function row() {

  const label = h('span', { class: 'program-now__label' });
  const title = h('span', { class: 'program-now__title' });
  const time = h('span', { class: 'program-now__time' });

  return { el: h('p', { class: 'program-now__row' }, label, title, time), label, title, time };

}

/** Called by the meeting widget on every update (status: meetingStatus()). */
export function paint(slot, status, now) {

  const nowStamp = stamp(now);
  const fresh = !slot.firstChild;
  const prog = current = programAt(status && status.session, nowStamp, live);
  const stage = prog && prog.index >= 0 ? prog.stages[prog.index] : null;
  const before = !!prog && !stage && status.state === 'today';

  last = { slot, status };

  if (fresh) {
    const rows = [row(), row()];
    // the stage on now is spoken when it changes (not on arrival)
    rows[0].el.setAttribute('aria-live', 'polite');
    rows[0].el.setAttribute('aria-atomic', 'true');
    slot.append(h('div', { class: 'program-now' }, rows[0].el, rows[1].el));
    rowsOf.set(slot, rows);
  }

  const box = slot.firstChild;
  const [nowRow, nextRow] = rowsOf.get(slot);

  box.hidden = !stage && !before;
  box.classList.toggle('program-now--before', before);
  nextRow.el.hidden = before;

  const set = (target, label, text, time) => {
    const roll = !fresh && root.dataset.motion === 'full' ? swapText : (el, value) => { el.textContent = value; };
    target.label.textContent = label;
    roll(target.title, text);
    roll(target.time, time);
  };

  if (before) {
    // (its time only when it is not the meeting's own, already said above)
    const first = prog.stages[0];
    set(nowRow, 'أول حاجة', first.title, first.start === status.startStamp ? '' : at(first.start, nowStamp));
  }
  else if (stage) {
    const next = prog.stages[prog.index + 1];
    set(nowRow, 'دلوقتي', stage.title, '');
    if (next) set(nextRow, 'بعدها', next.title, at(next.start, nowStamp));
    else set(nextRow, 'بعدها', 'نهاية الاجتماع', at(stage.end, nowStamp));
  }

  // the meeting sheet, if it is open, follows too
  const list = doc.querySelector('dialog.sheet[open] .program');
  if (list) paintList(list, prog);

  follow(prog, fresh);

}


/* ---------- the meeting sheet ---------- */

/** The whole program (detail.js); null when there is none or it ended. */
export function programList(session, nowStamp) {

  const prog = programAt(session, nowStamp, live);

  if (!prog) return null;

  const list = h('ol', { class: 'program' }, prog.stages.map(s => h('li', { class: 'program__stage' },
    h('span', { class: 'program__time' }, formatTime(stampToMinutes(s.start) % 1440)),
    h('span', { class: 'program__title' }, s.title)
  )));

  paintList(list, prog);

  return h('section', { class: 'detail__program' }, h('h3', {}, 'برنامج الاجتماع'), list);

}

function paintList(list, prog) {

  const index = prog ? prog.index : list.children.length;

  [...list.children].forEach((li, i) => {
    li.classList.toggle('is-done', i < index);
    li.classList.toggle('is-now', i === index);
    if (i === index) li.setAttribute('aria-current', 'step');
    else li.removeAttribute('aria-current');
  });

}
