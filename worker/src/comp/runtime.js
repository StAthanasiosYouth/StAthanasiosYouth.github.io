/*
 * The competitions runtime on the Worker (docs/PHASE5-PLAN.md P5-8, docs/COMPETITIONS.md §5, §20,
 * YOUTH-ACCOUNTS-PLAN §18). Every attempt belongs to a signed-in account: there is no anonymous mode, no
 * code login, no form. Identity is never read from the body. The key stays here: only what publicQuestion lets
 * through leaves. Authoring stays on Apps Script until Phase 6 and pushes live definitions (POST /v1/sync/comp-live).
 *
 * Crediting (§20.1): auto-graded answers earn at submit, manual ones as graded; `sub:<id>:<n>` keeps it idempotent.
 * Visibility (§20.2): the ledger row is written at once, and hidden from the member until released_ms.
 */

import { ApiError } from '../lib/http.js';
import { retry } from '../lib/db.js';
import { randomId, sha256 } from '../lib/hash.js';
import { limit, clientIp } from '../lib/ratelimit.js';
import { verifySync, syncStampStmt } from '../lib/sync.js';
import { logLine } from '../lib/log.js';
import { requireAccount } from '../account/session.js';
import { gate } from '../account/routes.js';
import { eligibility, rulesFrom } from '../account/model.js';
import { memberEmailStmt } from '../notify/member.js';
import { activeSeason, ledgerStmt, visibleBalance } from '../points/ledger.js';
import { storeOf, shopForMember, redemptionsOf } from '../store/shop.js';
import { compValidateAnswers_, compGrade_, compEmpty_ } from './score.gen.js';
import {
  GRACE_MINUTES, TOKEN_HOURS, DEADLINE_SLACK_MS, TIMEUP_EARLY_MS, FAST_SECONDS, MAX_OPEN_ATTEMPTS, SENT, SLUG, CLIENT_KEY, SUBMISSION_ID,
  wallOf, compStatus, servedOrder, publicQuestion, releaseAt, resultOf
} from './model.js';

const AGE_NOTICE = 'حسابك خارج النطاق العمري للخدمة، فتقدر تشارك كضيف بدون نقاط.';
const SENT_SQL = "('submitted', 'pending_review', 'graded')";
const fail = (code, message, extra) => new ApiError(code, code, { ...(message ? { message } : {}), ...(extra || {}) });

export async function liveBySlug(db, slug) {
  const row = await retry(() => db.prepare('SELECT l.*, v.def FROM comp_live l JOIN comp_versions v ON v.comp_id = l.comp_id AND v.version = l.version WHERE l.slug = ?').bind(slug).first());
  return row ? { compId: row.comp_id, version: row.version, closedAt: row.closed_at || '', finalizedAt: row.finalized_at || '', def: JSON.parse(row.def) } : null;
}

export async function liveById(db, compId) {
  const row = await retry(() => db.prepare('SELECT l.*, v.def FROM comp_live l JOIN comp_versions v ON v.comp_id = l.comp_id AND v.version = l.version WHERE l.comp_id = ?').bind(compId).first());
  return row ? { compId: row.comp_id, version: row.version, closedAt: row.closed_at || '', finalizedAt: row.finalized_at || '', def: JSON.parse(row.def) } : null;
}

export async function versionDef(db, compId, version) {
  const text = await retry(() => db.prepare('SELECT def FROM comp_versions WHERE comp_id = ? AND version = ?').bind(compId, version).first('def'));
  return text ? JSON.parse(text) : null;
}

const pointsOfSubmission = (db, id) => retry(() => db.prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM points_ledger WHERE ref = ?').bind('sub:' + id).first('n'));

/*
 * §2, §20.1: the wallet's rows after a change. Only the best attempt per person per competition earns; its target is
 * the points of what is graded so far. `change`: this submission as it is about to be stored. → { stmts, deltas }
 */
export async function walletStmts(db, { participantId, compId, def, change, actor = '', now = Date.now(), guard = '', guardBinds = [] }) {
  const rows = (await retry(() => db.prepare(`SELECT id, status, score, submitted_ms, no_points FROM submissions WHERE comp_id = ? AND participant_id = ? AND status IN ${SENT_SQL.replace(')', ", 'void')")}`).bind(compId, participantId).all())).results
    .map(r => (change && r.id === change.id ? { ...r, ...change } : r));
  if (change && !rows.some(r => r.id === change.id)) rows.push(change);
  const earning = def.wallet && def.scoring ? rows.filter(r => !r.no_points && (r.status === 'graded' || r.status === 'pending_review')) : [];
  const best = earning.slice().sort((a, b) => b.score - a.score || (a.submitted_ms || 0) - (b.submitted_ms || 0))[0];
  const refs = rows.map(r => 'sub:' + r.id);
  const ledger = refs.length ? (await retry(() => db.prepare(`SELECT ref, amount, season_id FROM points_ledger WHERE ref IN (${refs.map(() => '?').join(',')}) ORDER BY created_ms`).bind(...refs).all())).results : [];
  const season = await activeSeason(db);
  const stmts = [];
  const deltas = [];
  for (const r of rows) {
    const mine = ledger.filter(l => l.ref === 'sub:' + r.id);
    const sum = mine.reduce((n, l) => n + l.amount, 0);
    const target = best && best.id === r.id ? Number(best.score) || 0 : 0;
    if (target === sum) continue;
    const seasonId = mine.length ? mine[0].season_id : season && season.id;
    if (!seasonId) continue;
    // a closed season never changes again (§18.6)
    if (mine.length && (!season || seasonId !== season.id)) continue;
    stmts.push(ledgerStmt(db, {
      participantId, seasonId, amount: target - sum, kind: mine.length ? 'correction' : 'competition', ref: 'sub:' + r.id, compId, idemKey: `sub:${r.id}:${mine.length}`, actor, now, force: true, guard, guardBinds
    }));
    deltas.push({ id: r.id, delta: target - sum });
  }
  return { stmts, deltas };
}

async function replyFor(ctx, def, row, live, now, resumed, clientKey) {
  const byId = new Map(def.questions.map(q => [q.id, q]));
  const questions = JSON.parse(row.qids).map(id => byId.get(id)).filter(Boolean).map(q => publicQuestion(def, q, row.seed));
  const reply = {
    attempt: { token: row.id, id: row.id, startedAt: wallOf(row.started_ms), deadlineMs: row.deadline_ms, resumed: !!resumed, status: row.status, serverNow: now },
    comp: { v: row.version, layout: def.layout, showPoints: def.showPoints, timeLimit: def.timeLimit, total: questions.length },
    questions
  };
  if (resumed && row.client_key !== clientKey) reply.attempt.clientKey = row.client_key;
  if (row.status !== 'in_progress') {
    reply.receipt = row.id;
    reply.result = await resultFor(ctx.env.DB, def, row, live, now);
  }
  return reply;
}

async function resultFor(db, def, row, live, now) {
  const policy = live && live.version !== row.version ? live.def : def;
  return resultOf(def, policy, row, live, wallOf(now), await pointsOfSubmission(db, row.id));
}

/* POST /v1/comp/start { slug, clientKey } → the attempt: the same one again on a retry or another device */
export async function compStart(ctx) {
  const settings = await gate(ctx);
  const { account } = await requireAccount(ctx, settings);
  const body = ctx.body || {};
  if (typeof body.slug !== 'string' || !SLUG.test(body.slug) || typeof body.clientKey !== 'string' || !CLIENT_KEY.test(body.clientKey)) throw new ApiError('bad', 'shape');
  await limit(ctx, 'comp.start', account.id, 30, 60);
  await limit(ctx, 'comp.start.slug', body.slug, 200, 60);
  const db = ctx.env.DB;
  const live = await liveBySlug(db, body.slug);
  if (!live) throw new ApiError('not_found', 'comp');
  const def = live.def;
  const now = Date.now();
  const wall = wallOf(now);
  const status = compStatus(live, def, wall);
  if (status === 'scheduled') throw fail('not_open', 'المسابقة لسه ما بدأتش.', { startAt: def.startAt });
  if (status !== 'open') throw fail('closed', 'المسابقة اتقفلت.');

  const mine = (await retry(() => db.prepare("SELECT * FROM submissions WHERE comp_id = ? AND status <> 'void' AND (client_key = ? OR participant_id = ?)").bind(live.compId, body.clientKey, account.id).all())).results;
  const same = mine.find(r => r.client_key === body.clientKey) || mine.find(r => r.participant_id === account.id && r.version === live.version && r.status === 'in_progress');
  if (same && same.participant_id !== account.id) throw new ApiError('bad', 'another account');
  if (same) {
    const served = same.version === live.version ? def : await versionDef(db, live.compId, same.version);
    return replyFor(ctx, served || def, same, live, now, true, body.clientKey);
  }
  const theirs = mine.filter(r => r.participant_id === account.id);
  if (theirs.filter(r => SENT.includes(r.status)).length >= (def.attempts || 1)) throw fail('limit', def.attempts > 1 ? 'خلّصت كل المحاولات المسموحة.' : 'إنت شاركت في المسابقة دي قبل كده.');
  const counts = await retry(() => db.prepare(`SELECT
      (SELECT COUNT(*) FROM submissions WHERE comp_id = ? AND status IN ${SENT_SQL}) AS sent,
      (SELECT COUNT(*) FROM submissions WHERE comp_id = ? AND status = 'in_progress' AND started_ms > ?) AS open`).bind(live.compId, live.compId, now - TOKEN_HOURS * 3600000).first());
  if (def.maxSubmissions && counts.sent >= def.maxSubmissions) throw fail('limit', 'المسابقة اكتملت ومش بتستقبل مشاركات تانية.');
  if (counts.open >= MAX_OPEN_ATTEMPTS) throw fail('limit', 'المسابقة عليها ضغط كبير دلوقتي. جرّب تاني كمان شوية.');

  const seed = (await sha256(body.clientKey + ':' + live.compId)).slice(0, 12);
  const row = {
    id: randomId('s-', 6), comp_id: live.compId, version: live.version, client_key: body.clientKey, participant_id: account.id, attempt_no: theirs.length + 1, status: 'in_progress',
    started_ms: now, deadline_ms: def.timeLimit ? now + def.timeLimit * 60000 : 0, seed, qids: JSON.stringify(servedOrder(def, seed)), updated_ms: now
  };
  try {
    await retry(() => db.prepare(`INSERT INTO submissions (id, comp_id, version, client_key, participant_id, attempt_no, status, started_ms, deadline_ms, seed, qids, scoring, updated_ms) VALUES (?, ?, ?, ?, ?, ?, 'in_progress', ?, ?, ?, ?, ?, ?)`)
      .bind(row.id, row.comp_id, row.version, row.client_key, row.participant_id, row.attempt_no, row.started_ms, row.deadline_ms, row.seed, row.qids, def.scoring ? 1 : 0, now).run());
  } catch (err) {
    if (!/UNIQUE/i.test(String(err && err.message))) throw err;
    // a parallel start of this attempt: answer with the one that landed
    const twin = await retry(() => db.prepare("SELECT * FROM submissions WHERE comp_id = ? AND (client_key = ? OR (participant_id = ? AND version = ? AND status = 'in_progress')) LIMIT 1").bind(live.compId, body.clientKey, account.id, live.version).first());
    if (!twin || twin.participant_id !== account.id) throw new ApiError('bad', 'another account');
    return replyFor(ctx, def, twin, live, now, true, body.clientKey);
  }
  return replyFor(ctx, def, row, live, now, false, body.clientKey);
}

/* POST /v1/comp/submit { token, clientKey, answers } → { receipt, result }. Sent already: the stored result again */
export async function compSubmit(ctx) {
  const settings = await gate(ctx);
  const { account } = await requireAccount(ctx, settings);
  const body = ctx.body || {};
  const id = String(body.token || '');
  if (!SUBMISSION_ID.test(id) || typeof body.clientKey !== 'string' || !CLIENT_KEY.test(body.clientKey)) throw new ApiError('bad', 'shape');
  const db = ctx.env.DB;
  const row = await retry(() => db.prepare('SELECT * FROM submissions WHERE id = ?').bind(id).first());
  if (!row) throw new ApiError('not_found', 'attempt');
  if (row.participant_id !== account.id || row.client_key !== body.clientKey) throw new ApiError('bad', 'not this attempt');
  const def = await versionDef(db, row.comp_id, row.version);
  if (!def) throw new ApiError('not_found', 'def');
  const live = await liveById(db, row.comp_id);
  const now = Date.now();
  const wall = wallOf(now);
  if (row.status !== 'in_progress') return { receipt: row.id, result: await resultFor(db, def, row, live, now) };
  if (!live) throw fail('closed', 'المسابقة اتقفلت.');
  if (compStatus(live, def, wall, { graceMinutes: GRACE_MINUTES }) !== 'open') throw fail('closed', 'المسابقة اتقفلت.');
  if (row.deadline_ms && now > row.deadline_ms + DEADLINE_SLACK_MS) throw fail('expired', 'الوقت خلص.');
  const late = compStatus(live, def, wall) !== 'open' || (row.deadline_ms && now > row.deadline_ms);

  const qids = JSON.parse(row.qids);
  const sent = body.answers && typeof body.answers === 'object' ? body.answers : {};
  const checked = compValidateAnswers_(def, qids, body.answers);
  const problems = row.deadline_ms && now >= row.deadline_ms - TIMEUP_EARLY_MS
    ? checked.problems.filter(p => !(p.qid && qids.includes(p.qid) && compEmpty_(sent[p.qid])))
    : checked.problems;
  if (problems.length) throw new ApiError('invalid', 'answers', { qid: problems[0].qid, field: 'answers', message: problems[0].message });

  const graded = compGrade_(def, checked.answers, { qids, at: wall });
  const duration = Math.max(0, Math.round((now - row.started_ms) / 1000));
  const gradable = def.questions.filter(q => q.type !== 'info' && qids.includes(q.id)).length;
  // §9.1: stamped now, never recomputed: a later correction or a wider range changes the future only
  const rules = rulesFrom(settings);
  const elig = eligibility(account, rules, now).state === 'eligible' ? 'eligible' : 'guest';
  const flags = [];
  if (elig === 'guest') flags.push('noPoints');
  if (gradable && duration < FAST_SECONDS * gradable) flags.push('fast');
  if (late) flags.push('late');
  const release = releaseAt(def, live);
  const releasedNow = release === '';
  const mailNow = releasedNow && !!def.scoring;
  const change = { id: row.id, status: graded.status, score: graded.score, submitted_ms: now, no_points: elig === 'guest' ? 1 : 0 };
  const made = "EXISTS (SELECT 1 FROM submissions WHERE id = ? AND status <> 'in_progress' AND submitted_ms = ?)";
  const wallet = await walletStmts(db, { participantId: account.id, compId: row.comp_id, def, change, now, guard: made, guardBinds: [row.id, now] });
  const r = await retry(() => db.batch([
    db.prepare(`UPDATE submissions SET status = ?, submitted_ms = ?, duration_sec = ?, answers = ?, grading = ?, score = ?, max_score = ?, correct_count = ?, gradable_count = ?, pending_count = ?, flags = ?,
        elig = ?, age_min = ?, age_max = ?, no_points = ?, release_at = ?, released_ms = ?, result_mailed = ?, updated_ms = ?
      WHERE id = ? AND status = 'in_progress'
        AND (SELECT COUNT(*) FROM submissions s WHERE s.comp_id = submissions.comp_id AND s.participant_id = submissions.participant_id AND s.status IN ${SENT_SQL}) < ?
        AND (? = 0 OR (SELECT COUNT(*) FROM submissions s WHERE s.comp_id = submissions.comp_id AND s.status IN ${SENT_SQL}) < ?)`).bind(
      graded.status, now, duration, JSON.stringify(checked.answers), JSON.stringify(graded.grading), graded.score, graded.maxScore, graded.correctCount, graded.gradableCount, graded.pendingCount, flags.join(','),
      elig, rules.min, rules.max, change.no_points, release === null ? null : release, releasedNow ? now : null, mailNow ? 1 : 0, now, row.id, def.attempts || 1, def.maxSubmissions || 0, def.maxSubmissions || 0),
    ...wallet.stmts,
    ...(mailNow ? [memberEmailStmt(db, { kind: 'res.result', participantId: account.id, entityType: 'submission', entityId: row.id, dedupeKey: 'res:' + row.id, now, guard: made, guardBinds: [row.id, now] })] : [])
  ]));
  if (r[0].meta.changes !== 1) {
    const current = await retry(() => db.prepare('SELECT * FROM submissions WHERE id = ?').bind(row.id).first());
    if (current && current.status !== 'in_progress') return { receipt: row.id, result: await resultFor(db, def, current, live, now) };
    throw fail('limit', def.attempts > 1 ? 'خلّصت كل المحاولات المسموحة.' : 'إنت شاركت في المسابقة دي قبل كده.');
  }
  const stored = await retry(() => db.prepare('SELECT * FROM submissions WHERE id = ?').bind(row.id).first());
  return { receipt: row.id, result: await resultFor(db, def, stored, live, now) };
}

async function ownSubmission(ctx, account, id) {
  if (!SUBMISSION_ID.test(String(id || ''))) throw new ApiError('bad', 'shape');
  const row = await retry(() => ctx.env.DB.prepare('SELECT * FROM submissions WHERE id = ?').bind(id).first());
  // someone else's and an unknown one look the same
  if (!row || row.participant_id !== account.id) throw new ApiError('not_found', 'submission');
  return row;
}

/* POST /v1/comp/result { receipt | submissionId } → { result }: the policy at this moment */
export async function compResult(ctx) {
  const settings = await gate(ctx);
  const { account } = await requireAccount(ctx, settings);
  const body = ctx.body || {};
  const row = await ownSubmission(ctx, account, body.receipt || body.submissionId);
  const db = ctx.env.DB;
  const def = await versionDef(db, row.comp_id, row.version);
  if (!def) throw new ApiError('not_found', 'def');
  return { result: await resultFor(db, def, row, await liveById(db, row.comp_id), Date.now()) };
}

/* POST /v1/comp/me → «نقاطي» (the shape of portalMe, §18.4): only what the member may see now */
export async function compMe(ctx) {
  const settings = await gate(ctx);
  const { account } = await requireAccount(ctx, settings);
  const db = ctx.env.DB;
  const now = Date.now();
  const wall = wallOf(now);
  const state = eligibility(account, rulesFrom(settings), now).state;
  const season = await activeSeason(db);
  const seasonId = season ? season.id : '';
  const [ledger, totals, subs] = await retry(() => db.batch([
    db.prepare(`SELECT l.* FROM points_ledger l WHERE l.participant_id = ? AND l.season_id = ?
      AND NOT EXISTS (SELECT 1 FROM submissions s WHERE 'sub:' || s.id = l.ref AND s.released_ms IS NULL) ORDER BY l.created_ms DESC, l.id DESC LIMIT 500`).bind(account.id, seasonId),
    db.prepare('SELECT t.season_id, s.name, s.start_at, s.end_at, t.earned, t.spent, t.final FROM season_totals t JOIN seasons s ON s.id = t.season_id WHERE t.participant_id = ? ORDER BY t.closed_ms DESC').bind(account.id),
    db.prepare(`SELECT * FROM submissions WHERE participant_id = ? AND status IN ${SENT_SQL} ORDER BY submitted_ms DESC LIMIT 200`).bind(account.id)
  ]));
  const defs = new Map();
  const defOf = async r => {
    const key = r.comp_id + '|' + r.version;
    if (!defs.has(key)) defs.set(key, await versionDef(db, r.comp_id, r.version));
    return defs.get(key);
  };
  const lives = new Map();
  const liveOf = async id => {
    if (!lives.has(id)) lives.set(id, await liveById(db, id));
    return lives.get(id);
  };
  const history = [];
  for (const r of subs.results) {
    const def = await defOf(r);
    if (!def) continue;
    const live = await liveOf(r.comp_id);
    const result = await resultFor(db, def, r, live, now);
    history.push({
      submissionId: r.id, compId: r.comp_id, title: def.shortTitle || def.title, slug: def.slug, submittedAt: wallOf(r.submitted_ms), status: r.status,
      score: result.score === undefined ? null : result.score, maxScore: result.maxScore === undefined ? null : result.maxScore,
      pointsAwarded: result.pointsAwarded === undefined ? null : result.pointsAwarded, pending: result.pending === undefined ? null : result.pending, canReview: !!result.review
    });
  }
  const titles = new Map(history.map(h => [h.compId, h.title]));
  const balance = visibleBalance(ledger.results);
  const redemptions = await redemptionsOf(db, account.id, season, settings, wall);
  return {
    participant: { name: account.name, group: account.grp || '' },
    features: { wallet: true, shop: true },
    eligible: state === 'eligible',
    ...(state === 'eligible' ? {} : { notice: AGE_NOTICE }),
    frozen: state !== 'eligible' && balance > 0,
    store: await storeOf(db, wall),
    season: season ? { id: season.id, name: season.name, startAt: season.start_at || '', endAt: season.end_at || '', earned: ledger.results.filter(l => l.kind === 'competition' || l.kind === 'correction').reduce((n, l) => n + l.amount, 0), maxTheoretical: null } : null,
    seasons: totals.results.map(t => ({ id: t.season_id, name: t.name, startAt: t.start_at || '', endAt: t.end_at || '', final: t.final, earned: t.earned, spent: t.spent })),
    balance,
    ledger: ledger.results.map(l => ({ amount: l.amount, kind: l.kind, note: l.note_public ? l.note || '' : '', compTitle: l.comp_id ? titles.get(l.comp_id) || '' : '', createdAt: wallOf(l.created_ms) })),
    history,
    redemptions,
    shop: await shopForMember(db, account.id)
  };
}

/*
 * The minute cron: submissions whose release moment has come (§20.2, §20.3): visible from now,
 * one result email each (gradual: the sender's drip). Bounded per minute.
 */
export async function compReleaseTick(env, now = Date.now()) {
  const db = env.DB;
  const on = await retry(() => db.prepare("SELECT value FROM settings WHERE key = 'accounts_mode'").first('value'));
  if (on !== 'on') return 0;
  const wall = wallOf(now);
  const rows = (await retry(() => db.prepare(`SELECT id, participant_id, scoring FROM submissions WHERE released_ms IS NULL AND release_at IS NOT NULL AND release_at <= ? AND status IN ${SENT_SQL} LIMIT 50`).bind(wall).all())).results;
  if (!rows.length) return 0;
  await retry(() => db.batch(rows.flatMap(r => [
    db.prepare('UPDATE submissions SET released_ms = ?, result_mailed = ? WHERE id = ? AND released_ms IS NULL').bind(now, r.scoring ? 1 : 0, r.id),
    ...(r.scoring ? [memberEmailStmt(db, { kind: 'res.result', participantId: r.participant_id, entityType: 'submission', entityId: r.id, dedupeKey: 'res:' + r.id, now })] : [])
  ])));
  logLine({ kind: 'cron', job: 'comp.release', released: rows.length });
  return rows.length;
}

/*
 * POST /v1/sync/comp-live (signed, Apps Script: WorkerComp.gs compRuntimePush_)
 * { comps: [{ slug, compId, version, def, closedAt, finalizedAt }], withdrawn: [{ slug }] }
 * A version is immutable once here. Finalizing releases the competition's held results (the cron does the rest).
 */
export async function syncCompLive(ctx) {
  await limit(ctx, 'sync.comp', clientIp(ctx.request), 120, 60);
  const raw = new TextDecoder().decode(ctx.raw);
  const { body, ts } = await verifySync(ctx.env, ctx.request, raw, 'comp-live');
  const comps = Array.isArray(body.comps) ? body.comps : [];
  const withdrawn = Array.isArray(body.withdrawn) ? body.withdrawn : [];
  if (comps.length > 50 || withdrawn.length > 50) throw new ApiError('bad', 'too many');
  const db = ctx.env.DB;
  const now = Date.now();
  const wall = wallOf(now);
  const stmts = [];
  for (const c of comps) {
    if (!c || !SLUG.test(String(c.slug)) || !c.compId || !c.version || !c.def || !Array.isArray(c.def.questions)) throw new ApiError('bad', 'comp');
    stmts.push(db.prepare('INSERT OR IGNORE INTO comp_versions (comp_id, version, slug, def, synced_ms) VALUES (?, ?, ?, ?, ?)').bind(String(c.compId), String(c.version), c.slug, JSON.stringify(c.def), now));
    // a competition renamed: its old slug goes
    stmts.push(db.prepare('DELETE FROM comp_live WHERE comp_id = ? AND slug <> ?').bind(String(c.compId), c.slug));
    stmts.push(db.prepare(`INSERT INTO comp_live (slug, comp_id, version, closed_at, finalized_at, updated_ms) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET comp_id = excluded.comp_id, version = excluded.version, closed_at = excluded.closed_at, finalized_at = excluded.finalized_at, updated_ms = excluded.updated_ms`)
      .bind(c.slug, String(c.compId), String(c.version), c.closedAt || null, c.finalizedAt || null, now));
    if (c.finalizedAt) stmts.push(db.prepare(`UPDATE submissions SET release_at = ? WHERE comp_id = ? AND released_ms IS NULL AND status IN ${SENT_SQL}`).bind(wall, String(c.compId)));
  }
  for (const w of withdrawn) if (w && SLUG.test(String(w.slug))) stmts.push(db.prepare('DELETE FROM comp_live WHERE slug = ?').bind(w.slug));
  stmts.push(syncStampStmt(db, 'comp-live', ts));
  await retry(() => db.batch(stmts));
  return { stored: comps.length, withdrawn: withdrawn.length };
}
