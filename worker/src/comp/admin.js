/*
 * Results in the admin (docs/PHASE5-PLAN.md P5-8, §3o): submissions, manual grading, void, regrade, export, on the
 * Worker's own rows. The admin's calls reach the marks through content/runtime.js (the routes here answer the same).
 * Ranking (YOUTH-ACCOUNTS-PLAN §28 #4): guests carry a badge and no rank number.
 */

import { ApiError } from '../lib/http.js';
import { retry } from '../lib/db.js';
import { activityStmt } from '../lib/activity.js';
import { limit } from '../lib/ratelimit.js';
import { memberEmailStmt } from '../notify/member.js';
import { compApplyManual_, compRegrade_, compAnswerKey_ } from './score.gen.js';
import { SENT, SUBMISSION_ID, wallOf } from './model.js';
import { liveById, versionDef, walletStmts } from './runtime.js';

const SENT_SQL = "('submitted', 'pending_review', 'graded')";
const COMP_ID = /^[a-z0-9-]{3,40}$/i;

/* GET /v1/admin/comp: what is live here, with its counts */
export async function adminComps(ctx) {
  const db = ctx.env.DB;
  const [live, counts] = await retry(() => db.batch([
    db.prepare('SELECT l.slug, l.comp_id, l.version, l.closed_at, l.finalized_at, v.def FROM comp_live l JOIN comp_versions v ON v.comp_id = l.comp_id AND v.version = l.version ORDER BY l.updated_ms DESC'),
    db.prepare(`SELECT comp_id, SUM(status IN ${SENT_SQL}) AS sent, SUM(status = 'pending_review') AS pending, SUM(status = 'in_progress') AS open FROM submissions GROUP BY comp_id`)
  ]));
  return {
    comps: live.results.map(l => {
      const def = JSON.parse(l.def);
      const c = counts.results.find(x => x.comp_id === l.comp_id) || {};
      return { id: l.comp_id, slug: l.slug, title: def.title, version: l.version, scoring: !!def.scoring, wallet: !!def.wallet, closedAt: l.closed_at || '', finalizedAt: l.finalized_at || '', sent: c.sent || 0, pending: c.pending || 0, open: c.open || 0 };
    })
  };
}

const rowView = r => ({
  id: r.id, participantId: r.participant_id, name: r.person || '', phone: r.phone || '', status: r.status, attempt: r.attempt_no, submittedAt: r.submitted_ms, duration: r.duration_sec,
  score: r.score, maxScore: r.max_score, correct: r.correct_count, pending: r.pending_count, guest: r.elig === 'guest', flags: r.flags ? r.flags.split(',') : []
});

/* GET /v1/admin/comp/:id/submissions?status= → ranked: eligible best-first; a guest has no place number */
export async function adminCompSubmissions(ctx) {
  const db = ctx.env.DB;
  const id = String(ctx.params.id);
  if (!COMP_ID.test(id)) throw new ApiError('not_found', 'comp');
  const status = ctx.url.searchParams.get('status') || '';
  const rows = (await retry(() => db.prepare(`SELECT s.*, p.name AS person, p.phone FROM submissions s LEFT JOIN participants p ON p.id = s.participant_id
    WHERE s.comp_id = ? AND s.status <> 'in_progress' ${status === 'pending_review' || status === 'void' ? 'AND s.status = ?' : ''} ORDER BY s.status = 'void', s.score DESC, s.submitted_ms ASC LIMIT 1000`).bind(id, ...(status === 'pending_review' || status === 'void' ? [status] : [])).all())).results;
  let place = 0;
  return { submissions: rows.map(r => ({ ...rowView(r), rank: r.elig === 'guest' || r.status === 'void' ? null : ++place })) };
}

/* GET /v1/admin/comp/submissions/:id: the answers, the key, the marks */
export async function adminCompSubmission(ctx) {
  const db = ctx.env.DB;
  const id = String(ctx.params.id);
  if (!SUBMISSION_ID.test(id)) throw new ApiError('not_found', 'submission');
  const r = await retry(() => db.prepare('SELECT s.*, p.name AS person, p.phone FROM submissions s LEFT JOIN participants p ON p.id = s.participant_id WHERE s.id = ?').bind(id).first());
  if (!r) throw new ApiError('not_found', 'submission');
  const def = await versionDef(db, r.comp_id, r.version);
  const answers = JSON.parse(r.answers || '{}');
  const grading = JSON.parse(r.grading || '{}');
  const byId = new Map((def ? def.questions : []).map(q => [q.id, q]));
  return {
    submission: { ...rowView(r), compId: r.comp_id, ageMin: r.age_min, ageMax: r.age_max, released: !!r.released_ms },
    questions: JSON.parse(r.qids || '[]').map(q => byId.get(q)).filter(q => q && q.type !== 'info').map(q => ({
      id: q.id, type: q.type, text: q.text, points: q.points, choices: q.choices, correct: q.correct, answer: answers[q.id] === undefined ? null : answers[q.id], grade: grading[q.id] || null
    }))
  };
}

/* the emails a grade change owes (§20.3), only once the result email went */
function followUps(db, row, deltas, wasPending, nowPending, now, kind) {
  if (!row.result_mailed) return [];
  const stmts = [];
  const delta = deltas.filter(d => d.id === row.id).reduce((n, d) => n + d.delta, 0);
  const day = Math.floor(now / 86400000);
  if (wasPending > 0 && nowPending === 0) stmts.push(memberEmailStmt(db, { kind: 'res.done', participantId: row.participant_id, entityType: 'submission', entityId: row.id, dedupeKey: 'res-done:' + row.id, now }));
  else if (delta !== 0) stmts.push(memberEmailStmt(db, { kind, participantId: row.participant_id, entityType: 'submission', entityId: row.id, dedupeKey: `pts:${row.id}:${day}`, now }));
  return stmts;
}

/* POST /v1/admin/comp/submissions/:id/grade { grades: { qid: true | false | number | null } } */
export async function adminCompGrade(ctx) {
  const id = String(ctx.params.id);
  await gradeSubmission(ctx, id, (ctx.body || {}).grades);
  return adminCompSubmission(ctx);
}

export async function gradeSubmission(ctx, id, grades) {
  const db = ctx.env.DB;
  if (!SUBMISSION_ID.test(id)) throw new ApiError('not_found', 'submission');
  if (!grades || typeof grades !== 'object' || Array.isArray(grades)) throw new ApiError('bad', 'grades');
  const row = await retry(() => db.prepare('SELECT * FROM submissions WHERE id = ?').bind(id).first());
  if (!row) throw new ApiError('not_found', 'submission');
  if (!SENT.includes(row.status)) throw new ApiError('final', row.status);
  const def = await versionDef(db, row.comp_id, row.version);
  if (!def) throw new ApiError('not_found', 'def');
  const now = Date.now();
  const at = wallOf(now);
  let totals = null;
  let grading = JSON.parse(row.grading || '{}');
  for (const [qid, pts] of Object.entries(grades)) {
    if (!(pts === null || typeof pts === 'boolean' || Number.isFinite(pts))) throw new ApiError('bad', 'grade');
    totals = compApplyManual_(grading, qid, pts, ctx.actor.email, def, at);
    if (!totals) throw new ApiError('invalid', 'qid', { field: 'grades', message: 'السؤال ده مينفعش يتصحح.' });
    grading = totals.grading;
  }
  if (!totals) return;
  const change = { id, status: totals.status, score: totals.score, submitted_ms: row.submitted_ms, no_points: row.no_points };
  const wallet = await walletStmts(db, { participantId: row.participant_id, compId: row.comp_id, def, change, actor: ctx.actor.email, now });
  await retry(() => db.batch([
    db.prepare('UPDATE submissions SET status = ?, grading = ?, score = ?, max_score = ?, correct_count = ?, gradable_count = ?, pending_count = ?, updated_ms = ? WHERE id = ?')
      .bind(totals.status, JSON.stringify(totals.grading), totals.score, totals.maxScore, totals.correctCount, totals.gradableCount, totals.pendingCount, now, id),
    ...wallet.stmts,
    ...followUps(db, row, wallet.deltas, row.pending_count, totals.pendingCount, now, 'res.points'),
    activityStmt(db, { at: now, actor: ctx.actor.email, actorName: ctx.actor.name, action: 'review', entityType: 'competition', entityId: row.comp_id, summary: 'صحّح إجابة', changes: { questions: Object.keys(grades).length } })
  ]));
}

/* one mark for every sent submission with the same (normalized) answer → how many */
export async function gradeGroup(ctx, compId, qid, key, pts) {
  const db = ctx.env.DB;
  if (!COMP_ID.test(compId)) throw new ApiError('not_found', 'comp');
  const rows = (await retry(() => db.prepare(`SELECT id, version, qids, answers FROM submissions WHERE comp_id = ? AND status IN ${SENT_SQL} LIMIT 500`).bind(compId).all())).results;
  let updated = 0;
  for (const row of rows) {
    if (!JSON.parse(row.qids || '[]').includes(qid)) continue;
    const def = await versionDef(db, compId, row.version);
    const q = def && def.questions.find(x => x.id === qid);
    if (!q || compAnswerKey_(q, JSON.parse(row.answers || '{}')[qid]) !== key) continue;
    await gradeSubmission(ctx, row.id, { [qid]: pts });
    updated++;
  }
  return updated;
}

/* POST /v1/admin/comp/submissions/:id/void { voided }: never earns; restoring puts it back */
export async function adminCompVoid(ctx) {
  await voidSubmission(ctx, String(ctx.params.id), (ctx.body || {}).voided !== false);
  return adminCompSubmission(ctx);
}

export async function voidSubmission(ctx, id, voided) {
  const db = ctx.env.DB;
  if (!SUBMISSION_ID.test(id)) throw new ApiError('not_found', 'submission');
  const row = await retry(() => db.prepare('SELECT * FROM submissions WHERE id = ?').bind(id).first());
  if (!row || row.status === 'in_progress') throw new ApiError('not_found', 'submission');
  const def = await versionDef(db, row.comp_id, row.version);
  const next = voided ? 'void' : (def && def.scoring ? (row.pending_count ? 'pending_review' : 'graded') : 'submitted');
  if (next === row.status) return;
  const now = Date.now();
  const wallet = await walletStmts(db, { participantId: row.participant_id, compId: row.comp_id, def, change: { id, status: next, score: row.score, submitted_ms: row.submitted_ms, no_points: row.no_points }, actor: ctx.actor.email, now });
  await retry(() => db.batch([
    db.prepare('UPDATE submissions SET status = ?, updated_ms = ? WHERE id = ?').bind(next, now, id),
    ...wallet.stmts,
    ...followUps(db, row, wallet.deltas, 0, 0, now, 'res.correction'),
    activityStmt(db, { at: now, actor: ctx.actor.email, actorName: ctx.actor.name, action: 'review', entityType: 'competition', entityId: row.comp_id, summary: voided ? 'لغى مشاركة' : 'رجّع مشاركة' })
  ]));
}

/* POST /v1/admin/comp/:id/regrade: the live key on every submission of the live version; reviewers' marks stay */
export function adminCompRegrade(ctx) {
  return regradeComp(ctx, String(ctx.params.id));
}

export async function regradeComp(ctx, id) {
  const db = ctx.env.DB;
  await limit(ctx, 'comp.regrade', ctx.actor.email, 6, 60);
  const live = await liveById(db, id);
  if (!live) throw new ApiError('not_found', 'comp');
  const rows = (await retry(() => db.prepare(`SELECT * FROM submissions WHERE comp_id = ? AND status IN ${SENT_SQL} AND version = ? LIMIT 500`).bind(id, live.version).all())).results;
  const now = Date.now();
  const at = wallOf(now);
  let changed = 0;
  for (const row of rows) {
    const totals = compRegrade_(live.def, JSON.parse(row.answers || '{}'), JSON.parse(row.grading || '{}'), JSON.parse(row.qids || '[]'), at);
    if (totals.score === row.score && totals.pendingCount === row.pending_count && totals.status === row.status) continue;
    changed++;
    const wallet = await walletStmts(db, { participantId: row.participant_id, compId: id, def: live.def, change: { id: row.id, status: totals.status, score: totals.score, submitted_ms: row.submitted_ms, no_points: row.no_points }, actor: ctx.actor.email, now });
    await retry(() => db.batch([
      db.prepare('UPDATE submissions SET status = ?, grading = ?, score = ?, max_score = ?, correct_count = ?, gradable_count = ?, pending_count = ?, updated_ms = ? WHERE id = ?')
        .bind(totals.status, JSON.stringify(totals.grading), totals.score, totals.maxScore, totals.correctCount, totals.gradableCount, totals.pendingCount, now, row.id),
      ...wallet.stmts,
      ...followUps(db, row, wallet.deltas, 0, 0, now, 'res.correction')
    ]));
  }
  await retry(() => activityStmt(db, { at: now, actor: ctx.actor.email, actorName: ctx.actor.name, action: 'regrade', entityType: 'competition', entityId: id, summary: 'إعادة تصحيح: ' + changed, changes: { checked: rows.length, changed } }).run());
  return { checked: rows.length, changed };
}
