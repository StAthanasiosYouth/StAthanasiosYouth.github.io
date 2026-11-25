/*
 * «خبزنا اليومي» — the D1 side shared by the admin, the public routes, the tick and the alerts.
 *
 * Publishing (decision recorded in docs/daily-bread/progress/W3.md): a program's days and the index are published files
 * in the EXISTING pipeline (published_revisions, kind 'bread', a publish_jobs row of mode 'bread'), so the Worker
 * serves them at once and the GitHub mirror commits them to `daily-bread/data/…` for GitHub Pages (fast from Egypt).
 * A 'bread' publish never counts as a site publish: restore, the shadow gate and «a newer publish» skip it.
 */

import { ApiError } from '../lib/http.js';
import { retry } from '../lib/db.js';
import { sha256, randomId } from '../lib/hash.js';
import { logLine } from '../lib/log.js';
import { makeJob } from '../jobs.js';
import { indexFile, filePath } from './model.js';

export const SETTING_KEYS = ['BREAD_MODULE', 'BREAD_PUSH', 'BREAD_EMPTY_MUTED', 'bread_default_time', 'bread_max_slots', 'BREAD_SAINTS', 'BREAD_OCCASIONS'];

export async function breadSettings(db) {
  const { results } = await retry(() => db.prepare(`SELECT key, value FROM settings WHERE key IN (${SETTING_KEYS.map(() => '?').join(',')})`).bind(...SETTING_KEYS).all());
  const s = Object.fromEntries(results.map(r => [r.key, r.value]));
  return {
    module: s.BREAD_MODULE === '1',
    push: s.BREAD_PUSH === '1',
    emptyMuted: s.BREAD_EMPTY_MUTED === '1',
    saints: s.BREAD_SAINTS === '1',   // P3: the saints registry in the admin
    occasions: s.BREAD_OCCASIONS === '1',   // P5: «مناسبات كنيستنا» on the member page (the card, the «كنيستنا» tab)
    defaultTime: /^\d{2}:\d{2}$/.test(s.bread_default_time || '') ? s.bread_default_time : '08:00',
    maxSlots: Math.max(1, Math.min(3, Number(s.bread_max_slots) || 3))
  };
}

export const settingStmt = (db, key, value, by, now) => db.prepare(
  'INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by'
).bind(key, value, now, by);

/* the public routes: off → `disabled` */
export async function requireModule(db) {
  const on = await retry(() => db.prepare("SELECT value FROM settings WHERE key = 'BREAD_MODULE'").first('value'));
  if (on !== '1') throw new ApiError('disabled', 'BREAD_MODULE');
}

/* P5: «مناسبات كنيستنا» on the member page: off → `disabled` (the page shows no card, no «كنيستنا» tab) */
export async function requireOccasions(db) {
  const on = await retry(() => db.prepare("SELECT value FROM settings WHERE key = 'BREAD_OCCASIONS'").first('value'));
  if (on !== '1') throw new ApiError('disabled', 'BREAD_OCCASIONS');
}

/* programs that can be live now or later (dated): small, read whole */
export async function datedPrograms(db) {
  return (await retry(() => db.prepare("SELECT * FROM bread_programs WHERE status IN ('scheduled', 'stopped') AND starts_on IS NOT NULL AND purged_ms IS NULL ORDER BY starts_on").all())).results;
}

/*
 * Publish statements: `topicsOf` (a program id: every day of it, copied by SQL from bread_topics, no body through the
 * Worker) and the index (from `rows`, the dated programs AFTER this change). → { stmts, publishId }.
 * The caller runs them in its own batch with its change, then calls mirrorSoon.
 */
export async function publishStmts(db, { rows, day, topicsOf = null, by, now }) {
  const publishId = randomId('brd-pub-', 6);
  const index = indexFile(rows, day);
  const indexHash = await sha256(index);
  const stmts = [];
  if (topicsOf) {
    stmts.push(db.prepare(`INSERT INTO published_revisions (id, kind, key, rev, hash, body, withdrawn, live, publish_id, published_by, published_at)
      SELECT 'rev' || lower(hex(randomblob(6))), 'bread', t.program_id || '/' || t.n,
        1 + COALESCE((SELECT MAX(r.rev) FROM published_revisions r WHERE r.kind = 'bread' AND r.key = t.program_id || '/' || t.n), 0),
        t.hash, t.body, 0, 0, ?, ?, ? FROM bread_topics t WHERE t.program_id = ?`).bind(publishId, by, now, topicsOf));
  }
  stmts.push(db.prepare(`INSERT INTO published_revisions (id, kind, key, rev, hash, body, withdrawn, live, publish_id, published_by, published_at)
    SELECT ?, 'bread', 'index', 1 + COALESCE((SELECT MAX(rev) FROM published_revisions WHERE kind = 'bread' AND key = 'index'), 0), ?, ?, 0, 0, ?, ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM published_revisions WHERE kind = 'bread' AND key = 'index' AND live = 1 AND hash = ?)`)
    .bind(randomId('rev', 6), indexHash, index, publishId, by, now, indexHash));
  stmts.push(db.prepare('UPDATE published_revisions SET live = 0 WHERE live = 1 AND EXISTS (SELECT 1 FROM published_revisions n WHERE n.publish_id = ? AND n.kind = published_revisions.kind AND n.key = published_revisions.key)').bind(publishId));
  stmts.push(db.prepare('UPDATE published_revisions SET live = 1 WHERE publish_id = ?').bind(publishId));
  // mode 'bread': its own kind of publish job (the mirror takes it; the site's publish history does not list it)
  stmts.push(db.prepare(`INSERT INTO publish_jobs (id, mode, revision, hash, state, files, changed, result, by, at, created_at, updated_at)
    SELECT ?, 'bread', NULL, ?, 'live', c, c, '{}', ?, ?, ?, ? FROM (SELECT COUNT(*) AS c FROM published_revisions WHERE publish_id = ?)`)
    .bind(publishId, indexHash, by, now, now, now, publishId));
  return { stmts, publishId, index };
}

/* the GitHub mirror, right away (the minute cron retries what is still pending) */
export async function mirrorSoon(env, defer) {
  if (!env.JOBS) return;
  const p = env.JOBS.send(makeJob('publish.mirror', {})).catch(err => logLine({ lvl: 'warn', kind: 'bread', msg: 'mirror enqueue', err: String(err && err.message).slice(0, 200) }));
  if (defer) defer(p); else await p;
}

/* the published path of a 'bread' revision (publish-mirror.js revisionPath) */
export const breadPath = key => filePath(key);

/* a bread_daily counter +1 (or +k) */
export const dailyStmt = (db, day, programId, column, k = 1) => db.prepare(
  `INSERT INTO bread_daily (day, program_id, ${column}) VALUES (?, ?, ?) ON CONFLICT(day, program_id) DO UPDATE SET ${column} = ${column} + excluded.${column}`
).bind(day, programId, k);

/* W7: one more published file of kind 'bread' (the month's feasts, key 'feasts/YYYY-MM'), same pipeline and mirror */
export async function fileStmts(db, { key, body, by, now }) {
  const publishId = randomId('brd-pub-', 6);
  const hash = await sha256(body);
  return {
    publishId,
    stmts: [
      db.prepare(`INSERT INTO published_revisions (id, kind, key, rev, hash, body, withdrawn, live, publish_id, published_by, published_at)
        SELECT ?, 'bread', ?, 1 + COALESCE((SELECT MAX(rev) FROM published_revisions WHERE kind = 'bread' AND key = ?), 0), ?, ?, 0, 0, ?, ?, ?`)
        .bind(randomId('rev', 6), key, key, hash, body, publishId, by, now),
      db.prepare("UPDATE published_revisions SET live = 0 WHERE kind = 'bread' AND key = ? AND live = 1").bind(key),
      db.prepare('UPDATE published_revisions SET live = 1 WHERE publish_id = ?').bind(publishId),
      db.prepare(`INSERT INTO publish_jobs (id, mode, revision, hash, state, files, changed, result, by, at, created_at, updated_at)
        VALUES (?, 'bread', NULL, ?, 'live', 1, 1, '{}', ?, ?, ?, ?)`).bind(publishId, hash, by, now, now, now)
    ]
  };
}
