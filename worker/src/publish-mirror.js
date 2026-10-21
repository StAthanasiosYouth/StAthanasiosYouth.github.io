/*
 * THE GITHUB MIRROR (Phase 2 P2-4, docs/PUBLISH-SEPARATION-PLAN.md)
 *
 * With PUBLISH_MODE='worker' the publish is live once D1 has it; GitHub gets
 * the same files afterwards, as history and as the static fallback. The
 * mirror commits the CURRENT live snapshot: every live revision of a
 * worker-mode publish (or restore) not mirrored yet, in one commit. Several publishes in
 * a row coalesce; a retry never commits an older text over a newer one.
 * Shadow/seed revisions are never mirrored (Apps Script committed those).
 *
 * Runs right after such a publish (queue job 'publish.mirror') and on the
 * per-minute cron while something is pending (backoff after a failure:
 * 1, 2, 4 … 15 minutes). One run at a time (a claim in settings). GitHub
 * down never blocks publishing: the admin sees «نسخة GitHub متأخرة».
 */

import { retry, cairoText } from './lib/db.js';
import { githubConfig, commitFiles } from './lib/github.js';
import { logLine } from './lib/log.js';

const CLAIM_KEY = 'MIRROR_CLAIM';
const LAST_KEY = 'MIRROR_LAST';
const CLAIM_MS = 2 * 60 * 1000;
export const MIRROR_LATE_MS = 5 * 60 * 1000;

/* a revision's published path (the inverse of publish.js pathKind) */
export function revisionPath(kind, key) {
  if (kind === 'content') return 'content.json';
  if (kind === 'ics') return 'meeting.ics';
  if (kind === 'page') return `${key}/page.json`;
  if (kind === 'event') return `events/${key}/event.json`;
  if (kind === 'comp') return `competition/${key}/comp.json`;
  if (kind === 'stub') return `${key}/index.html`;
  return '';
}

const PENDING = "FROM published_revisions r JOIN publish_jobs j ON j.id = r.publish_id WHERE r.live = 1 AND r.mirrored_at IS NULL AND j.mode IN ('worker', 'restore')";

async function last(db) {
  const row = await retry(() => db.prepare('SELECT value FROM settings WHERE key = ?').bind(LAST_KEY).first());
  try { return row ? JSON.parse(row.value) : null; } catch { return null; }
}

function setStmt(db, key, value, now) {
  return db.prepare("INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, 'mirror') ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(key, value, now);
}

/* due on the cron: something pending and the backoff after the last failure has passed */
export async function mirrorDue(db, now = Date.now()) {
  const pending = await retry(() => db.prepare('SELECT COUNT(*) AS n ' + PENDING).first('n'));
  if (!pending) return false;
  const prev = await last(db);
  if (!prev || prev.ok || !prev.fails) return true;
  return now - prev.at >= Math.min(15, Math.pow(2, prev.fails - 1)) * 60 * 1000;
}

/* one mirror run → { committed, sha, files } | { skipped } | { failed } */
export async function mirrorPending(env, { now = Date.now(), fetchImpl = fetch } = {}) {
  const db = env.DB;
  const cfg = githubConfig(env);
  if (cfg.error) return { skipped: cfg.error };

  const claimed = await retry(() => db.prepare(
    "INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, 'mirror') ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at WHERE CAST(settings.value AS INTEGER) < ? RETURNING value"
  ).bind(CLAIM_KEY, String(now), now, now - CLAIM_MS).first());
  if (!claimed) return { skipped: 'another mirror run is busy' };

  try {
    const rows = (await retry(() => db.prepare('SELECT r.id, r.kind, r.key, r.body ' + PENDING).all())).results;
    if (!rows.length) return { committed: false, files: 0 };

    const files = {};
    let revision = '';
    for (const r of rows) {
      const path = revisionPath(r.kind, r.key);
      if (path) files[path] = r.body;
      if (r.kind === 'content') { try { revision = JSON.parse(r.body).revision || ''; } catch { revision = ''; } }
    }
    const prev = await last(db);
    let out;
    try {
      out = await commitFiles(cfg, files, `Publish content ${revision || '(pages)'} (${cairoText(now)} Cairo, mirror)`, fetchImpl);
    } catch (err) {
      const fails = (prev && !prev.ok ? prev.fails || 0 : 0) + 1;
      const error = String(err && err.message).slice(0, 200);
      await retry(() => db.batch([
        setStmt(db, LAST_KEY, JSON.stringify({ at: now, ok: false, fails, error }), now),
        db.prepare("UPDATE publish_jobs SET state = 'failed', error = ?, updated_at = ? WHERE mode IN ('worker', 'restore') AND state IN ('live', 'failed') AND EXISTS (SELECT 1 FROM published_revisions r WHERE r.publish_id = publish_jobs.id AND r.live = 1 AND r.mirrored_at IS NULL)").bind(error, now)
      ]));
      logLine({ lvl: 'warn', kind: 'mirror', files: rows.length, fails, err: error });
      return { failed: error, fails };
    }

    const ids = JSON.stringify(rows.map(r => r.id));
    await retry(() => db.batch([
      db.prepare('UPDATE published_revisions SET mirrored_at = ?, github_commit = ? WHERE id IN (SELECT value FROM json_each(?))').bind(now, out.sha, ids),
      // older worker revisions that never made it out on their own: their newer text just did
      db.prepare("UPDATE published_revisions SET mirrored_at = ? WHERE live = 0 AND mirrored_at IS NULL AND publish_id IN (SELECT id FROM publish_jobs WHERE mode IN ('worker', 'restore'))").bind(now),
      db.prepare("UPDATE publish_jobs SET state = 'mirrored', error = NULL, updated_at = ? WHERE mode IN ('worker', 'restore') AND state IN ('live', 'failed') AND NOT EXISTS (SELECT 1 FROM published_revisions r WHERE r.publish_id = publish_jobs.id AND r.live = 1 AND r.mirrored_at IS NULL)").bind(now),
      setStmt(db, LAST_KEY, JSON.stringify({ at: now, ok: true, fails: 0, sha: out.sha, unchanged: out.unchanged, files: rows.length }), now)
    ]));
    logLine({ kind: 'mirror', files: rows.length, sha: out.sha.slice(0, 7), unchanged: out.unchanged });
    return { committed: !out.unchanged, sha: out.sha, files: rows.length };
  } finally {
    await retry(() => setStmt(db, CLAIM_KEY, '0', now).run()).catch(() => {});
  }
}

/* for the admin: what is waiting, since when, the last run */
export async function mirrorStatus(env, now = Date.now()) {
  const db = env.DB;
  const pending = await retry(() => db.prepare('SELECT COUNT(*) AS n, MIN(r.published_at) AS since ' + PENDING).first());
  const cfg = githubConfig(env);
  return {
    configured: !cfg.error,
    reason: cfg.error || '',
    pending: pending.n,
    since: pending.since || null,
    late: !!pending.n && now - pending.since > MIRROR_LATE_MS,
    last: await last(db)
  };
}
