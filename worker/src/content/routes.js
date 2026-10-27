/*
 * Content drafts — the routes (Phase 4 P4-1, docs/CONTENT-MIGRATION-PLAN.md §5).
 *
 *   POST /v1/sync/content-import   Apps Script → the Sheets' rows (dry | apply)    signed
 *   POST /v1/sync/content-export   Apps Script ← D1 in the Sheets' columns           signed, read-only
 *   GET  /v1/admin/content/drafts  the panel's read (?kinds=a,b&since=links:3,news:5)
 *   GET  /v1/admin/content/export  the reverse export (private columns included)
 *   GET  /v1/admin/content/status  the switch, each kind's version/hash, the last imports
 */

import { ApiError } from '../lib/http.js';
import { limit, clientIp } from '../lib/ratelimit.js';
import { verifySync, syncStampStmt } from '../lib/sync.js';
import { retry, cairoText } from '../lib/db.js';
import { importDrafts, readDrafts, exportDrafts, draftsStatus, IMPORT_MAX_BYTES } from './store.js';
import { KINDS, KIND_NAMES } from './kinds.js';

/*
 * GET /v1/admin/content/review-input — what the browser-side «راجع» needs (admin/review-kit.js, P4-4):
 * every draft as the builders read it (a servant's phone only when they agreed to show it; never
 * payment numbers or Drive ids), the live content.json, the competitions' part when the one kept is
 * current (else null: the panel asks the Worker's review instead), and the Cairo time.
 */
export async function adminReviewInput(ctx) {
  const db = ctx.env.DB;
  const { kinds } = await readDrafts(db, { includePrivate: true });
  for (const r of kinds.servants.rows) {
    const d = r.data;
    const shown = d.publicWa === true || d.publicWa === '1' || d.publicWa === 'TRUE';
    for (const c of KINDS.servants.private) if (c !== 'phone' || !shown) d[c] = d[c] === '' ? '' : true;
  }
  for (const r of kinds.media.rows) for (const c of KINDS.media.private) r.data[c] = r.data[c] === '' ? '' : true;
  const now = Date.now();
  const wall = cairoText(now).replace(' ', 'T');
  const [live, pkg, sig] = await retry(() => db.batch([
    db.prepare("SELECT body FROM published_revisions WHERE kind = 'content' AND key = 'site' AND live = 1"),
    db.prepare("SELECT sig, data FROM comp_package WHERE id = 'current'"),
    db.prepare("SELECT value FROM settings WHERE key = 'COMP_SIG'")
  ]));
  let comps = null;
  if (ctx.env.COMPS_SOURCE === 'none' && ctx.env.ENVIRONMENT !== 'production') {
    comps = { none: true, built: null, errors: [], warnings: [], points: null, modules: {}, files: {}, reviewInfo: {}, stableUntil: '' };
  } else if (pkg.results[0] && sig.results[0] && pkg.results[0].sig === sig.results[0].value) {
    const data = JSON.parse(pkg.results[0].data);
    if (!data.stableUntil || wall < data.stableUntil) comps = data;
  }
  return { kinds, live: live.results[0] ? JSON.parse(live.results[0].body) : null, comps, now: wall };
}

export { IMPORT_MAX_BYTES };

export async function syncContentImport(ctx) {
  await limit(ctx, 'sync.content', clientIp(ctx.request), 10, 60);
  const raw = new TextDecoder().decode(ctx.raw);
  let peek = null;
  try { peek = JSON.parse(raw); } catch { throw new ApiError('bad', 'sync json'); }
  const apply = !!peek && peek.mode === 'apply';
  // a dry run changes nothing and may repeat; an apply is never replayed
  const { body, ts } = await verifySync(ctx.env, ctx.request, raw, 'content', Date.now(), { monotonic: apply });
  const by = String(body.by || 'apps-script').trim().toLowerCase().slice(0, 200) || 'apps-script';
  const result = await importDrafts(ctx.env, body, { by, raw });
  if (apply && result.state !== 'refused') await retry(() => syncStampStmt(ctx.env.DB, 'content', ts).run());
  return result;
}

export async function syncContentExport(ctx) {
  await limit(ctx, 'sync.content', clientIp(ctx.request), 10, 60);
  const raw = new TextDecoder().decode(ctx.raw);
  await verifySync(ctx.env, ctx.request, raw, 'content-export', Date.now(), { monotonic: false });
  return { kinds: await exportDrafts(ctx.env.DB) };
}

function parseSince(text) {
  const since = {};
  for (const part of String(text || '').split(',')) {
    const [kind, v] = part.split(':');
    if (KINDS[kind] && /^\d{1,12}$/.test(v || '')) since[kind] = Number(v);
  }
  return since;
}

export async function adminDrafts(ctx) {
  const q = ctx.url.searchParams;
  const kinds = q.get('kinds') ? q.get('kinds').split(',').filter(k => KINDS[k]) : KIND_NAMES;
  if (!kinds.length) throw new ApiError('bad', 'kinds');
  return readDrafts(ctx.env.DB, { kinds, since: parseSince(q.get('since')) });
}

export async function adminDraftsExport(ctx) {
  await limit(ctx, 'content.export', ctx.actor.email, 6, 60);
  return { kinds: await exportDrafts(ctx.env.DB) };
}

export async function adminDraftsStatus(ctx) {
  return draftsStatus(ctx.env.DB);
}

/*
 * POST /v1/sync/content-notify (signed, Apps Script): the admin pushes Activity.gs decided for content
 * saved on the Worker, handed out once each (like book-news: a lost reply loses that push, never doubles it).
 * → { items: [activity record] } — Apps Script appends them to its Activity sheet as «pending» and sends them.
 */
export async function syncContentNotify(ctx) {
  await limit(ctx, 'sync.content-notify', clientIp(ctx.request), 30, 60);
  const raw = new TextDecoder().decode(ctx.raw);
  const { ts } = await verifySync(ctx.env, ctx.request, raw, 'content-notify');
  const db = ctx.env.DB;
  const now = Date.now();
  const { results } = await retry(() => db.prepare('SELECT id, row FROM content_notify WHERE sent_ms IS NULL ORDER BY created_ms LIMIT 50').all());
  const ids = results.map(r => r.id);
  await retry(() => db.batch([
    db.prepare('UPDATE content_notify SET sent_ms = ? WHERE sent_ms IS NULL AND id IN (SELECT value FROM json_each(?))').bind(now, JSON.stringify(ids)),
    db.prepare('DELETE FROM content_notify WHERE sent_ms IS NOT NULL AND sent_ms < ?').bind(now - 7 * 86400_000),
    syncStampStmt(db, 'content-notify', ts)
  ]));
  return { items: results.map(r => JSON.parse(r.row)) };
}
