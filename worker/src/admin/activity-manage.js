/*
 * Phase 8 A6 (BACKEND-MIGRATION §22.1 item 22): «إدارة السجل» — the activity log's own housekeeping, for
 * admins holding `activity.manage` (never granted by default: the Primary Admin's until they grant it).
 *
 * The nightly housekeeping (scheduled.js RETENTION) already keeps 365 days and at most 5250 rows. This adds,
 * on demand:
 *   GET  /v1/admin/activity/manage            → { rows, oldest, technical, minDays, archives }
 *   POST /v1/admin/activity/manage/preview    { days, section?, technical? } → { count, kept }
 *   POST /v1/admin/activity/manage/archive    { days, section?, technical? } → { archive }   (a private R2 CSV)
 *   GET  /v1/admin/activity/manage/archive/:id → the CSV
 *   POST /v1/admin/activity/manage/delete     { days, section?, technical?, confirm: 'امسح' } → { deleted, kept }
 *
 * Safe delete: only rows older than MIN_DAYS (90); never the security and permission rows of the last year
 * (PROTECTED); the word «امسح» is required; the delete itself is written as one row (`activity.trim`).
 */

import { ApiError, fileResponse } from '../lib/http.js';
import { retry } from '../lib/db.js';
import { activityStmt, SECTIONS } from '../lib/activity.js';
import { limit } from '../lib/ratelimit.js';
import { randomId } from '../lib/hash.js';

const DAY = 24 * 3600 * 1000;
export const MIN_DAYS = 90;
const MAX_ROWS = 20000;
const PREFIX = 'activity-archive/';
const TECHNICAL = ['diag.echo', 'diag.queue', 'booknews.claim', 'booknews.ack', 'admins.sync', 'paydest.sync', 'job.failed', 'booking.retention', 'push.receipt'];
// security and permissions: kept a year whatever the filter says
export const PROTECTED = ['admin.add', 'admin.remove', 'admin.rename', 'accounts.add', 'accounts.grants', 'accounts.remove', 'session.takeover',
  'migrate', 'code.view', 'code.reset', 'code.export', 'activity.trim'];
const marks = list => list.map(() => '?').join(',');

/* the filter's WHERE (rows the action may touch) and the kept part (protected rows inside it) */
function scope(body, now) {
  const days = Math.floor(Number(body && body.days));
  if (!Number.isFinite(days) || days < MIN_DAYS || days > 3650) throw new ApiError('invalid', 'days', { field: 'days' });
  const where = ['at < ?'];
  const args = [now - days * DAY];
  const section = body && body.section ? String(body.section) : '';
  if (section) {
    if (!Object.prototype.hasOwnProperty.call(SECTIONS, section)) throw new ApiError('invalid', 'section', { field: 'section' });
    where.push('entity_type IN (' + marks(SECTIONS[section]) + ')');
    args.push(...SECTIONS[section]);
  }
  if (body && body.technical === true) {
    where.push('action IN (' + marks(TECHNICAL) + ')');
    args.push(...TECHNICAL);
  }
  const keepYear = now - 365 * DAY;
  const kept = '(action IN (' + marks(PROTECTED) + ') AND at >= ?)';
  return { days, section, technical: body && body.technical === true, where: where.join(' AND '), args, kept, keptArgs: [...PROTECTED, keepYear] };
}

async function counts(db, s) {
  const row = await retry(() => db.prepare(
    `SELECT COUNT(*) AS n, SUM(CASE WHEN ${s.kept} THEN 1 ELSE 0 END) AS k FROM activity WHERE ${s.where}`
  ).bind(...s.keptArgs, ...s.args).first());
  const n = row ? Number(row.n) || 0 : 0;
  const k = row ? Number(row.k) || 0 : 0;
  return { count: n - k, kept: k };
}

export async function activityManage(ctx) {
  const db = ctx.env.DB;
  const [all, tech] = await retry(() => db.batch([
    db.prepare('SELECT COUNT(*) AS n, MIN(cairo) AS oldest FROM activity'),
    db.prepare('SELECT COUNT(*) AS n FROM activity WHERE action IN (' + marks(TECHNICAL) + ')').bind(...TECHNICAL)
  ]));
  const archives = [];
  if (ctx.env.PROOFS) {
    const listed = await ctx.env.PROOFS.list({ prefix: PREFIX, limit: 100 });
    for (const o of listed.objects || []) archives.push({ id: o.key.slice(PREFIX.length).replace(/\.csv$/, ''), size: o.size, at: o.uploaded ? new Date(o.uploaded).getTime() : 0 });
    archives.sort((a, b) => b.at - a.at);
  }
  return {
    rows: all.results[0].n, oldest: all.results[0].oldest || null, technical: tech.results[0].n,
    minDays: MIN_DAYS, sections: Object.keys(SECTIONS), archives
  };
}

export async function activityManagePreview(ctx) {
  return counts(ctx.env.DB, scope(ctx.body, Date.now()));
}

const csvCell = v => {
  const t = v == null ? '' : String(v);
  return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
};

export async function activityManageArchive(ctx) {
  await limit(ctx, 'activity.archive', ctx.actor.email, 10, 3600);
  if (!ctx.env.PROOFS) throw new ApiError('unavailable', 'storage');
  const s = scope(ctx.body, Date.now());
  const rows = (await retry(() => ctx.env.DB.prepare(
    `SELECT cairo, actor, actor_name, action, entity_type, entity_id, entity_title, summary, source FROM activity WHERE ${s.where} ORDER BY at LIMIT ?`
  ).bind(...s.args, MAX_ROWS).all())).results;
  const head = ['cairo', 'actor', 'actor_name', 'action', 'entity_type', 'entity_id', 'entity_title', 'summary', 'source'];
  const csv = '﻿' + [head.join(',')].concat(rows.map(r => head.map(k => csvCell(r[k])).join(','))).join('\r\n') + '\r\n';
  const id = new Date().toISOString().slice(0, 10) + '-' + randomId('', 6);
  await ctx.env.PROOFS.put(PREFIX + id + '.csv', new TextEncoder().encode(csv), {
    httpMetadata: { contentType: 'text/csv; charset=utf-8' },
    customMetadata: { rows: String(rows.length), days: String(s.days), section: s.section, by: ctx.actor.email }
  });
  await retry(() => activityStmt(ctx.env.DB, {
    actor: ctx.actor.email, actorName: ctx.actor.name, action: 'activity.archive', entityType: 'activity', entityId: id,
    summary: 'أرشف ' + rows.length + ' صف من السجل', severity: 'routine'
  }).run());
  return { archive: { id, rows: rows.length } };
}

export async function activityManageArchiveRead(ctx) {
  const id = String(ctx.params.id || '');
  if (!/^\d{4}-\d{2}-\d{2}-[0-9a-zA-Z]{4,16}$/.test(id) || !ctx.env.PROOFS) throw new ApiError('not_found', 'archive');
  const o = await ctx.env.PROOFS.get(PREFIX + id + '.csv');
  if (!o) throw new ApiError('not_found', 'archive');
  return { __response: fileResponse(ctx, o.body, { contentType: 'text/csv; charset=utf-8', length: o.size, filename: 'activity-' + id + '.csv' }) };
}

export async function activityManageDelete(ctx) {
  await limit(ctx, 'activity.trim', ctx.actor.email, 5, 3600);
  if (!ctx.body || ctx.body.confirm !== 'امسح') throw new ApiError('invalid', 'confirm', { field: 'confirm' });
  const db = ctx.env.DB;
  const s = scope(ctx.body, Date.now());
  const before = await counts(db, s);
  const [gone] = await retry(() => db.batch([
    db.prepare(`DELETE FROM activity WHERE ${s.where} AND NOT ${s.kept}`).bind(...s.args, ...s.keptArgs),
    activityStmt(db, {
      actor: ctx.actor.email, actorName: ctx.actor.name, action: 'activity.trim', entityType: 'activity',
      summary: 'مسح ' + before.count + ' صف من السجل (أقدم من ' + s.days + ' يوم' + (s.section ? '، ' + s.section : '') + (s.technical ? '، التقنية بس' : '') + ')',
      changes: { days: s.days, section: s.section || null, technical: s.technical, kept: before.kept }, severity: 'important'
    })
  ]));
  return { deleted: gone.meta.changes, kept: before.kept };
}
