/*
 * RESTORE «ارجع للنسخة دي» (Phase 2 P2-8, docs/PUBLISH-SEPARATION-PLAN.md)
 *
 *   GET  /v1/admin/publish/revisions   the last publishes (newest first), which one is live, whether restore is on
 *   POST /v1/admin/publish/restore     { to: <publish id>, expect: <the live publish id the admin saw> }
 *
 * A restore never rewrites history: it is a new publish (mode 'restore')
 * whose files are the texts that were live right after the chosen publish.
 * Pages, events and competitions added since then get their withdrawn JSON
 * (their links keep working: «مش متاحة»); stubs stay. Live at once; the
 * booking re-reads a changed event; GitHub follows through the mirror.
 *
 * Only while the Worker is the truth (the latest publish was 'worker' or
 * 'restore'): in github/shadow mode GitHub is, and a restore here would split
 * the two. The draft (Apps Script) is not touched: the next publish of the
 * draft brings its content back — the panel says so before confirming.
 */

import { ApiError } from './lib/http.js';
import { retry } from './lib/db.js';
import { sha256, randomId } from './lib/hash.js';
import { limit } from './lib/ratelimit.js';
import { activityStmt } from './lib/activity.js';
import { liveStmts } from './publish.js';
import { makeJob } from './jobs.js';

export const RESTORE_FROM = ['worker', 'restore'];
const LIST_MAX = 15;
const WITHDRAWABLE = ['page', 'event', 'comp'];

/* the latest real publish (seeds aside): its id and mode */
async function latest(db) {
  return retry(() => db.prepare("SELECT id, mode FROM publish_jobs WHERE mode <> 'seed' ORDER BY at DESC, created_at DESC LIMIT 1").first());
}

/* GET /v1/admin/publish/revisions */
export async function publishRevisions(ctx) {
  const db = ctx.env.DB;
  const [jobs, top] = await Promise.all([
    retry(() => db.prepare('SELECT id, mode, revision, state, files, changed, by, at FROM publish_jobs WHERE changed > 0 OR mode = \'seed\' ORDER BY at DESC, created_at DESC LIMIT ?').bind(LIST_MAX).all()),
    latest(db)
  ]);
  return {
    enabled: !!top && RESTORE_FROM.includes(top.mode),
    live: top ? top.id : null,
    jobs: jobs.results.map(j => ({ ...j, live: !!top && j.id === top.id }))
  };
}

/* POST /v1/admin/publish/restore */
export async function publishRestore(ctx) {
  await limit(ctx, 'publish.restore', ctx.actor.email, 6, 600);
  const db = ctx.env.DB;
  const to = String(ctx.body && ctx.body.to || '');
  const expect = String(ctx.body && ctx.body.expect || '');
  const top = await latest(db);
  if (!top || !RESTORE_FROM.includes(top.mode)) throw new ApiError('mode', 'restore needs PUBLISH_MODE worker');
  if (expect && expect !== top.id) throw new ApiError('conflict', 'someone published in between');
  const target = await retry(() => db.prepare('SELECT id, mode, revision, created_at, at FROM publish_jobs WHERE id = ?').bind(to).first());
  if (!target) throw new ApiError('not_found', 'publish');
  if (target.id === top.id) throw new ApiError('bad', 'already live');

  // what was live right after the target: per (kind, key) the newest revision of a publish not later than it
  const [then, now] = await Promise.all([
    retry(() => db.prepare(
      "SELECT r.kind, r.key, r.rev, r.hash, r.body, r.withdrawn FROM published_revisions r JOIN publish_jobs j ON j.id = r.publish_id WHERE (j.at < ? OR (j.at = ? AND j.created_at <= ?)) AND r.kind <> 'stub'"
    ).bind(target.at, target.at, target.created_at).all()),
    retry(() => db.prepare("SELECT kind, key, MAX(rev) AS rev, MAX(CASE WHEN live = 1 THEN hash END) AS hash, MAX(CASE WHEN live = 1 THEN withdrawn END) AS withdrawn FROM published_revisions WHERE kind <> 'stub' GROUP BY kind, key").all())
  ]);
  const wanted = new Map();
  for (const r of then.results) {
    const k = r.kind + '\u0000' + r.key;
    if (!wanted.has(k) || wanted.get(k).rev < r.rev) wanted.set(k, r);
  }
  const at = Date.now();
  const rows = [];
  for (const cur of now.results) {
    const k = cur.kind + '\u0000' + cur.key;
    let body;
    let withdrawn;
    if (wanted.has(k)) {
      const w = wanted.get(k);
      if (w.hash === cur.hash) continue;
      body = w.body;
      withdrawn = w.withdrawn;
    } else if (WITHDRAWABLE.includes(cur.kind) && !cur.withdrawn) {
      body = JSON.stringify({ schema: 1, slug: cur.key, withdrawn: true }, null, 2) + '\n';     // added after the target
      withdrawn = 1;
    } else {
      continue;
    }
    rows.push({ id: randomId('rev'), kind: cur.kind, key: cur.key, rev: cur.rev + 1, hash: await sha256(body), body, withdrawn });
  }
  if (!rows.length) return { id: null, unchanged: true, to: target.id };

  const id = 'restore-' + at;
  const contentRow = wanted.get('content\u0000site');
  let revision = target.revision || null;
  if (contentRow) { try { revision = JSON.parse(contentRow.body).revision || revision; } catch { /* keep */ } }
  const result = { id, to: target.id, revision, unchanged: false, changed: rows.map(r => ({ kind: r.kind, key: r.key, rev: r.rev, withdrawn: !!r.withdrawn })) };
  const stmts = liveStmts(db, id, ctx.actor.email, at, rows);
  stmts.push(db.prepare(
    "INSERT INTO publish_jobs (id, mode, revision, hash, state, files, changed, result, by, at, created_at, updated_at) VALUES (?, 'restore', ?, ?, 'live', ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, revision, await sha256(rows.map(r => r.kind + '/' + r.key + '/' + r.hash).join('\n')), rows.length, rows.length, JSON.stringify(result), ctx.actor.email, at, at, at));
  const events = rows.filter(r => r.kind === 'event').map(r => r.key);
  if (events.length) stmts.push(db.prepare("UPDATE event_cfg SET fetched_at = 0 WHERE source <> 'fixture' AND slug IN (SELECT value FROM json_each(?))").bind(JSON.stringify(events)));
  stmts.push(activityStmt(db, {
    actor: ctx.actor.email, actorName: ctx.actor.name, action: 'publish', entityType: 'site', entityId: revision || id,
    summary: 'رجّع الموقع للنسخة اللي اتنشرت ' + (target.revision ? '(' + target.revision + ')' : target.id), severity: 'important',
    changes: { restore: target.id, files: rows.length }
  }));
  await retry(() => db.batch(stmts));
  if (ctx.env.JOBS) ctx.defer(ctx.env.JOBS.send(makeJob('publish.mirror', { id })));
  return result;
}
