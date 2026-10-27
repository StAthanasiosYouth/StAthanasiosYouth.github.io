/*
 * THE COMPETITIONS' PART OF A BUILD (Phase 4, docs/CONTENT-MIGRATION-PLAN.md §8).
 *
 * Owner decision 2026-10-27 — hybrid, one button: competitions stay on Apps
 * Script until Phase 5–6 (their draft, their secret, Snapshots, liveVersion).
 * Apps Script builds their part (apps-script/WorkerComp.gs compPackage_) and the
 * Worker keeps the last one in comp_package. It is asked again only when
 *   - the competitions' draft changed (Apps Script pushed a new signature:
 *     POST /v1/sync/comp-sig → settings COMP_SIG), or
 *   - the library rows it was built against changed (media_sig), or
 *   - a competition time it depends on has passed (stableUntil), or
 *   - a publish needs it prepared (its Snapshots written) and it is not.
 * Every other review / publish never waits for Apps Script.
 *
 * Asking: POST <APPS_SCRIPT_URL> { fn: 'workerSync', args: [{ ts, sig, payload }] },
 * HMAC with SYNC_SECRET (the same secret as every Apps Script ↔ Worker sync).
 * Staging (no Apps Script of its own): COMPS_SOURCE = 'none' — a build without
 * competitions. Never in production: there a missing part refuses the publish.
 */

import { ApiError } from '../lib/http.js';
import { retry } from '../lib/db.js';
import { sha256 } from '../lib/hash.js';
import { limit, clientIp } from '../lib/ratelimit.js';
import { verifySync, syncStampStmt, signSync } from '../lib/sync.js';

const SIG_RE = /^(?:[0-9a-f]{64}|none)$/;
const NONE = { none: true, built: null, errors: [], warnings: [], points: null, modules: {}, files: {}, reviewInfo: {}, stableUntil: '' };

/* POST /v1/sync/comp-sig { sig } (signed, Apps Script): the competitions' draft changed */
export async function syncCompSig(ctx) {
  await limit(ctx, 'sync.comp-sig', clientIp(ctx.request), 60, 60);
  const raw = new TextDecoder().decode(ctx.raw);
  const { body, ts } = await verifySync(ctx.env, ctx.request, raw, 'comp-sig');
  const sig = String(body.sig || '');
  if (!SIG_RE.test(sig)) throw new ApiError('bad', 'sig');
  const db = ctx.env.DB;
  await retry(() => db.batch([
    db.prepare("INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('COMP_SIG', ?, ?, 'apps-script') ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(sig, Date.now()),
    viewStmt(db, sig, body.view),
    syncStampStmt(db, 'comp-sig', ts)
  ]));
  return { sig };
}

/* the competitions' view (WorkerComp.gs compView_: ids, slugs, titles, picture ids — no answers) */
function cleanView(view) {
  if (!view || typeof view !== 'object') return null;
  const s = v => String(v == null ? '' : v).slice(0, 200);
  const list = (a, keys) => (Array.isArray(a) ? a.slice(0, 5000) : []).map(o => Object.fromEntries(keys.map(k => [k, s(o && o[k])])));
  return {
    comps: list(view.comps, ['id', 'slug', 'title', 'banner', 'icon']),
    questions: list(view.questions, ['compId', 'media', 'explanationMedia']),
    items: list(view.items, ['id', 'name', 'image'])
  };
}

function viewStmt(db, sig, view) {
  return db.prepare("INSERT INTO comp_package (id, sig, media_sig, data, prepared, committed, stable_until, built_ms) VALUES ('view', ?, '', ?, 0, 0, NULL, ?) " +
    'ON CONFLICT(id) DO UPDATE SET sig = excluded.sig, data = excluded.data, built_ms = excluded.built_ms').bind(sig, JSON.stringify(cleanView(view)), Date.now());
}

/*
 * What the bundled content code reads as compDraft_() outside a build (Media.gs mediaUsage_,
 * Items.gs competition targets): { view } — view null = not known yet (never pushed);
 * staging without competitions: an empty one.
 */
export async function compView(env) {
  if (staticNone(env)) return { view: staticView(env) };
  const row = await retry(() => env.DB.prepare("SELECT data FROM comp_package WHERE id = 'view'").first());
  return { view: row ? JSON.parse(row.data) : null };
}

/* staging without competitions: an empty view (else null: the view kept in D1 applies) */
export function staticView(env) {
  return staticNone(env) ? { comps: [], questions: [], items: [] } : null;
}

function staticNone(env) {
  return env.COMPS_SOURCE === 'none' && env.ENVIRONMENT !== 'production';
}

/* ask Apps Script (signed) → its answer's result, or throws `comps` */
export async function askAppsScript(ctx, payload) {
  const env = ctx.env;
  if (!env.APPS_SCRIPT_URL || !env.SYNC_SECRET) throw new ApiError('comps', 'APPS_SCRIPT_URL / SYNC_SECRET not set');
  const text = JSON.stringify(payload);
  const ts = String(Date.now());
  const body = JSON.stringify({ fn: 'workerSync', args: [{ ts, sig: await signSync(env.SYNC_SECRET, ts, text), payload: text }] });
  let reply = null;
  try {
    // Apps Script answers a POST with a redirect to its result (GET): followed
    const res = await ctx.fetch(env.APPS_SCRIPT_URL, { method: 'POST', headers: { 'content-type': 'text/plain' }, body, redirect: 'follow' });
    reply = await res.json();
  } catch (err) {
    throw new ApiError('comps', 'apps script: ' + String(err && err.message).slice(0, 120));
  }
  if (!reply || reply.ok !== true) throw new ApiError('comps', 'apps script refused: ' + String(reply && reply.error).slice(0, 120));
  return reply.result;
}

/*
 * The competitions' part for this build. mode: 'review' | 'publish' (prepared: Snapshots written).
 * now: Cairo wall 'YYYY-MM-DDTHH:MM'; media: the build's own library index (Content.gs mediaIndex_).
 * → { …the part, sig, prepared, fresh }
 */
export async function compPackage(ctx, { mode, now, media, by }) {
  if (staticNone(ctx.env)) return { ...NONE, sig: 'none', prepared: true, fresh: false };
  const db = ctx.env.DB;
  // the panel's state (P4-7: after a save, on open): the part kept, never a wait for Apps Script —
  // a save never depends on it; the review and the publish ask when it is not current
  if (mode === 'state') {
    const kept = await retry(() => db.prepare("SELECT sig, data, prepared FROM comp_package WHERE id = 'current'").first());
    if (kept) return { ...JSON.parse(kept.data), sig: kept.sig, prepared: kept.prepared === 1, fresh: false };
    return { ...NONE, none: false, sig: '', prepared: false, fresh: false, unknown: true };
  }
  const mediaSig = await sha256(JSON.stringify(media || {}));
  const [row, sigRow] = await Promise.all([
    retry(() => db.prepare("SELECT sig, media_sig, data, prepared FROM comp_package WHERE id = 'current'").first()),
    retry(() => db.prepare("SELECT value FROM settings WHERE key = 'COMP_SIG'").first())
  ]);
  const sig = sigRow ? sigRow.value : '';
  if (row && sig && row.sig === sig && row.media_sig === mediaSig && (mode === 'review' || row.prepared === 1)) {
    const data = JSON.parse(row.data);
    if (!data.stableUntil || now < data.stableUntil) return { ...data, sig: row.sig, prepared: row.prepared === 1, fresh: false };
  }
  const result = await askAppsScript(ctx, { call: 'compPackage', mode: mode === 'publish' ? 'prepare' : 'review', now, media: media || {}, by: by || '' });
  const data = {
    none: !!result.none, built: result.built || null, errors: result.errors || [], warnings: result.warnings || [],
    points: result.points || null, modules: result.modules || {}, files: result.files || {}, reviewInfo: result.reviewInfo || {},
    stableUntil: String(result.stableUntil || '')
  };
  const prepared = mode === 'publish' ? 1 : 0;
  const fresh = String(result.sig || '');
  await retry(() => db.batch([
    db.prepare("INSERT INTO comp_package (id, sig, media_sig, data, prepared, committed, stable_until, built_ms) VALUES ('current', ?, ?, ?, ?, 0, NULL, ?) " +
      'ON CONFLICT(id) DO UPDATE SET sig = excluded.sig, media_sig = excluded.media_sig, data = excluded.data, prepared = excluded.prepared, committed = 0, built_ms = excluded.built_ms')
      .bind(fresh, mediaSig, JSON.stringify(data), prepared, Date.now()),
    // what Apps Script built from IS the current draft
    db.prepare("INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('COMP_SIG', ?, ?, 'apps-script') ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(fresh, Date.now()),
    viewStmt(db, fresh, result.view)
  ]));
  return { ...data, sig: fresh, prepared: prepared === 1, fresh: true };
}

/* what a publish made live → { live: { id: version }, withdrawn } (null when nothing to tell) */
export function compCommitOf(pkg) {
  if (!pkg || pkg.none || !pkg.built) return null;
  const live = {};
  for (const [id, entry] of Object.entries(pkg.built.live || {})) live[id] = entry.version;
  const withdrawn = (pkg.built.withdrawn || []).map(w => ({ id: w.id, slug: w.slug }));
  if (!Object.keys(live).length && !withdrawn.length) return null;
  return { live, withdrawn };
}

/* tell Apps Script what went live (compAfterCommit_); the queue retries a failure ('comp.commit') */
export async function commitComps(ctx, commit, stamp) {
  await askAppsScript(ctx, { call: 'compCommit', live: commit.live, withdrawn: commit.withdrawn, stamp });
  await retry(() => ctx.env.DB.prepare("UPDATE comp_package SET committed = 1, committed_ms = ? WHERE id = 'current'").bind(Date.now()).run());
}
