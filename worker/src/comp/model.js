/*
 * Competitions on the Worker: the pure rules, ported as they are from apps-script/CompModel.gs and
 * CompPublic.gs (docs/COMPETITIONS.md §5, §20). No I/O. Grading itself: score.gen.js.
 */

import { msStamp, stampMs } from '../book/model.js';

export const GRACE_MINUTES = 3;
export const TOKEN_HOURS = 48;
export const DEADLINE_SLACK_MS = 60000;
export const TIMEUP_EARLY_MS = 15000;
export const FAST_SECONDS = 2;
export const MAX_OPEN_ATTEMPTS = 3000;
export const SENT = ['submitted', 'pending_review', 'graded'];
export const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])$/;
export const CLIENT_KEY = /^[A-Za-z0-9_-]{16,64}$/;
export const SUBMISSION_ID = /^s-[0-9a-f]{12}$/;

export const wallAdd = (stamp, minutes) => msStamp(stampMs(stamp) + minutes * 60000);
export const wallOf = ms => msStamp(ms);

/* live: { closedAt, finalizedAt }; `now`: 'YYYY-MM-DDTHH:MM' */
export function compStatus(live, def, now, { graceMinutes = 0 } = {}) {
  const end = def.endAt ? (graceMinutes ? wallAdd(def.endAt, graceMinutes) : def.endAt) : '';
  const closedAt = live.closedAt ? (graceMinutes ? wallAdd(live.closedAt, graceMinutes) : live.closedAt) : '';
  if (def.startAt && now < def.startAt) return 'scheduled';
  const closed = (end && now > end) || (closedAt && now >= closedAt);
  if (!closed) return 'open';
  return live.finalizedAt || (def.resultsAt && now >= def.resultsAt) ? 'results' : 'closed';
}

function submissionsOver(def, live, now) {
  if (live && live.finalizedAt) return true;
  const ends = [def.endAt, live && live.closedAt].filter(Boolean).sort();
  return !!ends.length && now > wallAdd(ends[0], GRACE_MINUTES + 1);
}

export function answersOpen(def, live, now) {
  if (def.answersShow === 'immediately') return !def.startAt || now >= def.startAt;
  if (def.answersShow === 'afterClose') return submissionsOver(def, live, now);
  if (def.answersShow === 'atDate') return !!def.answersAt && now >= def.answersAt;
  return false;
}

function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/* a seeded shuffle (mulberry32): a retry serves the same order */
function shuffle(list, seedText) {
  let a = hash32(seedText) || 1;
  const out = list.slice();
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function servedOrder(def, seed) {
  const ids = def.questions.map(q => q.id);
  return def.shuffleQ ? shuffle(ids, seed + ':q') : ids;
}

/* what the browser may see of a question: NEVER the key, the explanation or the review mode */
export function publicQuestion(def, q, seed) {
  let choices = (q.choices || []).map(c => ({ id: c.id, text: c.text }));
  if (def.shuffleC && choices.length) {
    const order = shuffle(choices.map(c => c.id), seed + ':' + q.id);
    choices = order.map(id => choices.find(c => c.id === id)).filter(Boolean);
  }
  const out = { id: q.id, type: q.type, text: q.text, help: q.help, media: q.media, choices, required: q.required };
  if (def.showPoints && q.type !== 'info') out.points = q.points;
  return out;
}

/*
 * §20.2: when the member may first see this submission's result. '' = at once; a stamp = from then;
 * null = only when finalized.
 */
export function releaseAt(def, live) {
  if (live && live.finalizedAt) return '';
  const shows = def.scoring && def.resultShow && def.resultShow !== 'none';
  if (shows) return def.resultsAt || '';
  if (def.endAt) return wallAdd(def.endAt, GRACE_MINUTES);
  return null;
}

const shows = (def, what) => def.scoring && (def.resultShow === what || def.resultShow === 'both');

/* the person's answers next to the key, in the order they were served (§5.1) */
function review(def, row, marks, keyDef) {
  const answers = JSON.parse(row.answers || '{}');
  const grading = JSON.parse(row.grading || '{}');
  const byId = new Map(def.questions.map(q => [q.id, q]));
  const keys = new Map(keyDef.questions.map(q => [q.id, q]));
  return JSON.parse(row.qids || '[]').map(id => byId.get(id)).filter(q => q && q.type !== 'info').map(q => {
    const g = grading[q.id] || {};
    const key = keys.get(q.id) || q;
    return {
      id: q.id, type: q.type, text: q.text, media: q.media, choices: q.choices,
      answer: answers[q.id] === undefined ? null : answers[q.id],
      correct: keyDef.scoring ? key.correct : null,
      ok: marks && g.ok !== undefined ? g.ok : null,
      pts: marks ? Number(g.pts) || 0 : null,
      explanation: key.explanation,
      explanationMedia: key.explanationMedia || null
    };
  });
}

/*
 * Result (§5.1): the questions and answers are the version served (def); the policy is the live one (policy).
 * pointsAwarded: the ledger's sum for this submission, shown only once released.
 */
export function resultOf(def, policy, row, live, now, pointsAwarded) {
  const result = { status: row.status, submittedAt: row.submitted_ms ? wallOf(row.submitted_ms) : '' };
  if (row.status === 'void' || row.status === 'in_progress') return result;
  const state = { closedAt: live ? live.closedAt : '', finalizedAt: live ? live.finalizedAt : '' };
  const visible = !policy.resultsAt || now >= policy.resultsAt || !!state.finalizedAt;
  if (shows(policy, 'score')) {
    if (visible) Object.assign(result, { score: row.score, maxScore: row.max_score, correctCount: row.correct_count, gradableCount: row.gradable_count, pending: row.pending_count });
    else result.resultsAt = policy.resultsAt;
  }
  if (policy.wallet && shows(policy, 'points')) {
    if (visible && row.released_ms) result.pointsAwarded = Number(pointsAwarded) || 0;
    else if (!visible) result.resultsAt = policy.resultsAt;
  }
  if (row.no_points) result.noPoints = true;
  if (answersOpen(policy, state, now)) result.review = review(def, row, !!policy.scoring && visible, policy);
  else if (policy.answersShow === 'atDate' && policy.answersAt) result.answersAt = policy.answersAt;
  else if (policy.answersShow === 'afterClose' && policy.endAt) result.answersAt = policy.endAt;
  return result;
}
