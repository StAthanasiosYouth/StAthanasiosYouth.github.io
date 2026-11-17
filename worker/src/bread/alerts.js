/*
 * «خبزنا اليومي» — the daily housekeeping's part (scheduled.js housekeeping, 04:17 Cairo): the admin alerts and the
 * retention. Short SQL only (10 ms CPU).
 *
 * Alerts (STUDY §7.3), as activity rows the notify router already carries to the bell and the admins' devices
 * (catalog 'bread.left' / 'bread.empty' → holders of bread.content):
 *   - 7, 3 or 1 days left in the live program and nothing waits after it: one row per program and threshold (the id is
 *     fixed, INSERT OR IGNORE: never twice). A missed day sends only the nearest threshold.
 *   - the content is finished (nothing live, nothing waiting): one row per ended program, unless BREAD_EMPTY_MUTED
 *     (cleared by the next activation).
 * Retention: single opens after 30 days (the daily totals stay); a program's topics, reflections and kept seeds at
 * ends_on + 90 days (decision 9) — the program's name and numbers stay (decision 14) and its published files become
 * a «gone» stub; drafts never activated after 14 days; slots of devices that no longer exist.
 */

import { retry } from '../lib/db.js';
import { activityStmt } from '../lib/activity.js';
import { logLine } from '../lib/log.js';
import { cairoDay, dayAdd, currentOf, nextOf, daysLeft } from './model.js';
import { breadSettings, datedPrograms } from './store.js';
import { randomId } from '../lib/hash.js';

export const THRESHOLDS = [7, 3, 1];
export const OPENS_DAYS = 30;
export const DRAFT_DAYS = 14;
const DAY_MS = 86400000;
const ar = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);

/* the alert rows due today → [stmt] (and what they are, for the log and the staging check) */
export async function alertStmts(db, now = Date.now()) {
  const day = cairoDay(now);
  const [rows, s] = await Promise.all([datedPrograms(db), breadSettings(db)]);
  const cur = currentOf(rows, day);
  const next = nextOf(rows, day);
  const out = [];
  if (cur && !next) {
    const left = daysLeft(cur, day);
    const t = THRESHOLDS.filter(x => left <= x).sort((a, b) => a - b)[0];
    if (t !== undefined) {
      out.push({
        kind: 'left', threshold: t, program: cur.id,
        stmt: activityStmt(db, {
          id: 'act-bread-left' + t + '-' + cur.id.slice(4), orIgnore: true, at: now, actor: 'system', action: 'bread.left', entityType: 'bread', entityId: cur.id, entityTitle: cur.name,
          severity: 'important', summary: (left === 0 ? 'النهارده آخر يوم في «' + cur.name + '»' : 'فاضل ' + ar(left) + (left <= 2 ? ' يوم' : ' أيام') + ' على نهاية «' + cur.name + '»') + ' ومفيش برنامج بعده.',
          changes: { left, threshold: t }
        })
      });
    }
  }
  if (!cur && !next && !s.emptyMuted) {
    const ended = rows.filter(p => p.ends_on && p.ends_on < day && p.ends_on >= p.starts_on).sort((a, b) => (a.ends_on < b.ends_on ? 1 : -1))[0];
    if (ended) {
      out.push({
        kind: 'empty', program: ended.id,
        stmt: activityStmt(db, {
          id: 'act-bread-empty-' + ended.id.slice(4), orIgnore: true, at: now, actor: 'system', action: 'bread.empty', entityType: 'bread', entityId: ended.id, entityTitle: ended.name,
          severity: 'important', summary: 'المحتوى خلص: «' + ended.name + '» انتهى ومفيش برنامج جديد. المخدومين شايفين «قريب قوي…».'
        })
      });
    }
  }
  return { day, alerts: out };
}

/* the retention statements (purge of the programs past purge_on is two statements per program, bounded to 3 a day) */
export async function retentionStmts(db, now = Date.now()) {
  const day = cairoDay(now);
  const due = (await retry(() => db.prepare('SELECT id FROM bread_programs WHERE purge_on IS NOT NULL AND purge_on <= ? AND purged_ms IS NULL ORDER BY purge_on LIMIT 3').bind(day).all())).results;
  const stmts = [
    db.prepare('DELETE FROM bread_opens WHERE day < ?').bind(dayAdd(day, -OPENS_DAYS)),
    db.prepare("DELETE FROM bread_topics WHERE program_id IN (SELECT id FROM bread_programs WHERE status IN ('draft', 'ready') AND created_ms < ?)").bind(now - DRAFT_DAYS * DAY_MS),
    db.prepare("DELETE FROM bread_programs WHERE status IN ('draft', 'ready') AND created_ms < ?").bind(now - DRAFT_DAYS * DAY_MS),
    db.prepare("DELETE FROM bread_slots WHERE device_id NOT IN (SELECT id FROM push_devices WHERE audience = 'public')")
  ];
  for (const { id } of due) {
    const publishId = randomId('brd-pub-', 6);
    stmts.push(
      // the published days become a stub (the GitHub mirror overwrites them), the old texts go
      db.prepare(`INSERT INTO published_revisions (id, kind, key, rev, hash, body, withdrawn, live, publish_id, published_by, published_at)
        SELECT 'rev' || lower(hex(randomblob(6))), 'bread', r.key, r.rev + 1, 'gone-' || r.key, '{"schema":1,"gone":true}' || char(10), 1, 0, ?, 'retention', ?
        FROM published_revisions r WHERE r.kind = 'bread' AND r.live = 1 AND r.withdrawn = 0 AND r.key LIKE ? || '/%'`).bind(publishId, now, id),
      db.prepare("UPDATE published_revisions SET live = 0 WHERE live = 1 AND kind = 'bread' AND key LIKE ? || '/%' AND publish_id <> ?").bind(id, publishId),
      db.prepare('UPDATE published_revisions SET live = 1 WHERE publish_id = ?').bind(publishId),
      db.prepare("DELETE FROM published_revisions WHERE kind = 'bread' AND live = 0 AND key LIKE ? || '/%' AND (mirrored_at IS NOT NULL OR withdrawn = 0)").bind(id),
      db.prepare(`INSERT INTO publish_jobs (id, mode, revision, hash, state, files, changed, result, by, at, created_at, updated_at)
        SELECT ?, 'bread', NULL, 'retention', 'live', c, c, '{}', 'retention', ?, ?, ? FROM (SELECT COUNT(*) AS c FROM published_revisions WHERE publish_id = ?) WHERE c > 0`).bind(publishId, now, now, now, publishId),
      db.prepare('DELETE FROM bread_topics WHERE program_id = ?').bind(id),
      db.prepare('DELETE FROM bread_reflections WHERE program_id = ?').bind(id),
      db.prepare('DELETE FROM bread_members WHERE program_id = ?').bind(id),
      db.prepare('UPDATE bread_programs SET purged_ms = ? WHERE id = ?').bind(now, id)
    );
  }
  return { stmts, purged: due.map(d => d.id) };
}

/* the daily cron's step → { alerts, purged } */
export async function breadDaily(env, now = Date.now()) {
  const db = env.DB;
  const a = await alertStmts(db, now);
  const r = await retentionStmts(db, now);
  const res = await retry(() => db.batch([...a.alerts.map(x => x.stmt), ...r.stmts]));
  const written = a.alerts.filter((_, i) => res[i].meta.changes === 1).map(x => x.kind + (x.threshold || ''));
  logLine({ kind: 'cron', job: 'bread', alerts: written, purged: r.purged.length });
  return { alerts: written, purged: r.purged };
}
