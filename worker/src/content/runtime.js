/*
 * CONTENT SAVES ON THE WORKER (Phase 4 P4-2 / P4-3, docs/CONTENT-MIGRATION-PLAN.md §6).
 *
 * The admin's content calls (links, sections, contacts, settings, the
 * hub items, service pages, events, servants, payment methods) run the SAME
 * Apps Script code they run today — apps-script/*.gs bundled into gs.gen.js —
 * against sheets held in memory, built from D1's draft rows:
 *
 *   load   every live draft row + versions, the admins, the other sessions' edit locks (one batch)
 *   run    the api* function, synchronous, as in Apps Script (services.js)
 *   diff   each sheet the call wrote, read back exactly as the copy is (ContentExport.gs)
 *   write  one D1 batch: per-row guards (the row is still the version read, else `stale`),
 *          the rows (data → version + 1; order only → pos), tombstones, the kinds' versions,
 *          the Activity rows the call noted, the approved payment numbers (pay_dest)
 *
 * Only while D1 is the drafts' writer (settings.CONTENT_DRAFTS = '1'). Until the
 * Phase 4 cutover it is '0' and every call here is refused (`writer`).
 */

import { ApiError } from '../lib/http.js';
import { retry } from '../lib/db.js';
import { contentActivityStmt, queryActivity } from '../lib/activity.js';
import { requirePerm } from '../lib/perms.js';
import { cleanDests, payDestStmts } from '../book/pay.js';
import { createGs, GS_SOURCE } from './gs.gen.js';
import { MemSpreadsheet, Utilities, memCache, memProperties, LockService, offline } from './services.js';
import { KINDS, KIND_NAMES } from './kinds.js';
import { setupBuild } from './publishing.js';
import { staticView } from './comps.js';
import { setupMedia, mirrorMedia, MEDIA_CALLS, MEDIA_UPLOAD_MAX_BYTES } from './media.js';

export { MEDIA_UPLOAD_MAX_BYTES };

const CONTENT_ID = 'd1-content';
const COMP_ID = 'd1-comp';

/* the calls the Worker takes (P4-2: the content Sheet; P4-3: pages / events / servants) */
export const CONTENT_CALLS = new Set([
  'apiSaveLink', 'apiSetLinkEnabled', 'apiDeleteLink', 'apiMoveLink',
  'apiSaveSection', 'apiSetSectionEnabled', 'apiDeleteSection', 'apiMoveSection',
  'apiSaveContact', 'apiDeleteContact', 'apiMoveContact', 'apiSaveSettings',
  'apiSaveItem', 'apiDeleteItem', 'apiSetItemArchived', 'apiDuplicateItem', 'apiSetItemEnabled',
  'apiImportPreview', 'apiImportApply',
  'apiHomeOrder', 'apiServants', 'apiServantSave', 'apiServantSetActive', 'apiPayMethodsSave', 'apiServantPayApprove',
  'apiPages', 'apiPage', 'apiPageSave', 'apiPageSetEnabled', 'apiPageArchive', 'apiPageDelete',
  'apiPageMediaSave', 'apiPageMediaOrder', 'apiPageMediaDelete', 'apiPagePreview',
  'apiEvents', 'apiEvent', 'apiEventSave', 'apiEventSetEnabled', 'apiEventArchive', 'apiEventDelete',
  // P4-4 / P4-6: the review, the preview, the publish (publishing.js); P4-7: the panel's state
  'apiReview', 'apiPreview', 'apiPublish', 'apiState',
  // P4-5: the media library, its bytes on R2 (media.js)
  ...MEDIA_CALLS
]);

/* the page calls that check a slug against the repository's top-level folders (Pages.gs pagesRepoRoots_) */
const NEEDS_ROOTS = new Set(['apiPageSave', 'apiEventSave']);

/* Apps Script's own codes that the Worker's envelope knows */
const PASS_CODES = new Set(['locked', 'busy', 'session_expired', 'session_replaced']);

async function loadAll(db, sid, now, { activityRows = 15, activityMs = 10 * 60_000 } = {}) {
  const [rows, kinds, admins, locks, router, recent, writer, view, waiting, online] = await retry(() => db.batch([
    db.prepare('SELECT kind, id, pos, version, data, hash FROM draft_rows WHERE deleted_ms IS NULL ORDER BY kind, pos, id'),
    db.prepare('SELECT kind, version FROM draft_kinds'),
    db.prepare('SELECT email, name, role FROM admins WHERE active = 1 ORDER BY email'),
    db.prepare("SELECT l.kind, l.id, l.sid, l.email, l.since_ms, l.expires_ms, s.device, s.parked_ms, a.name FROM edit_locks l " +
      "JOIN admin_sessions s ON s.sid = l.sid LEFT JOIN admins a ON a.email = l.email WHERE l.kind <> 'booking' AND l.expires_ms > ?").bind(now),
    db.prepare("SELECT value FROM settings WHERE key = 'NOTIFY_ROUTER'"),
    // the rows Activity.gs may merge a repeat edit into (its window: 10 minutes, the last 15 rows)
    // a publish reads further back: «what changed since the last publish» (Activity.gs activitySincePublish_ stops at
    // the last «publish» row, at most 300): from that row on — or, for a save, the merge window
    db.prepare('SELECT id, at, cairo, actor, actor_name, action, entity_type, entity_id, entity_title, summary, changes, ref, count, device FROM activity ' +
      "WHERE at > ? AND (? = 0 OR at >= COALESCE((SELECT MAX(at) FROM activity WHERE action = 'publish'), 0)) ORDER BY at DESC LIMIT ?")
      .bind(now - activityMs, activityRows > 15 ? 1 : 0, activityRows),
    // in the same round trip: the one-writer switch, the competitions' view, library files waiting for the site
    db.prepare("SELECT value FROM settings WHERE key = 'CONTENT_DRAFTS'"),
    db.prepare("SELECT data FROM comp_package WHERE id = 'view'"),
    db.prepare('SELECT COUNT(*) AS n FROM media_files WHERE mirrored_ms IS NULL AND deleted_ms IS NULL AND site_path IS NOT NULL'),
    // Pages.gs bookOnline_: the online-booking go-live switch (was the Script Property BOOKING_ONLINE)
    db.prepare("SELECT value FROM settings WHERE key = 'BOOKING_ONLINE'")
  ]));
  const byKind = Object.fromEntries(KIND_NAMES.map(k => [k, []]));
  for (const r of rows.results) if (byKind[r.kind]) byKind[r.kind].push({ id: r.id, pos: r.pos, version: r.version, hash: r.hash, data: JSON.parse(r.data) });
  const holders = {};
  for (const l of locks.results) {
    if (l.sid === sid || (l.parked_ms && now - l.parked_ms > 60_000)) continue;
    holders[l.kind + ':' + l.id] = { email: l.email, name: l.name || '', device: l.device || '', since: Math.max(0, Math.round((now - l.since_ms) / 1000)) };
  }
  return {
    rows: byKind,
    versions: Object.fromEntries(kinds.results.map(k => [k.kind, k.version])),
    admins: admins.results,
    holders,
    notifyRouter: !!(router.results[0] && router.results[0].value === '1'),
    recent: recent.results.reverse(),
    writer: writer.results[0] && writer.results[0].value === '1' ? 'worker' : 'sheets',
    view: view.results[0] ? JSON.parse(view.results[0].data) : null,
    waiting: waiting.results[0] ? waiting.results[0].n : 0,
    bookingOnline: online.results[0] ? online.results[0].value : null
  };
}

/* the repository's top-level names for the slug check, like Pages.gs (6 h cache there; best effort here) */
async function repoRoots(ctx) {
  const env = ctx.env;
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) return null;
  try {
    const res = await ctx.fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/contents/?ref=${encodeURIComponent(env.GITHUB_BRANCH || 'main')}`, {
      headers: { authorization: 'Bearer ' + env.GITHUB_TOKEN, accept: 'application/vnd.github+json', 'user-agent': 'athanasios-api', 'x-github-api-version': '2022-11-28' }
    });
    if (!res.ok) return null;
    const list = await res.json();
    return Array.isArray(list) ? list.map(e => String(e.name || '').toLowerCase()) : null;
  } catch {
    return null;
  }
}

function sheetsFrom(loaded) {
  const content = new MemSpreadsheet(CONTENT_ID, 'drafts (D1)');
  const comp = new MemSpreadsheet(COMP_ID, 'pages and events (D1)');
  const tabs = {};
  for (const kind of KIND_NAMES) {
    const spec = KINDS[kind];
    const lines = [spec.columns.slice()].concat(loaded.rows[kind].map(r => spec.columns.map(c => (r.data[c] === undefined ? '' : r.data[c]))));
    tabs[kind] = (spec.sheet === 'content' ? content : comp).addSheet(spec.tab, lines);
  }
  // the old Log tab (the Activity rows go to D1 instead)
  content.addSheet('Log', [['time', 'user', 'action', 'details']]);
  return { content, comp, tabs };
}

/*
 * One admin call. ctx: the Worker request (actor, session). Returns
 * { result, versions, changed } — result as Apps Script returns it, except the
 * whole panel state (apiStateFor_), which the panel now reads from
 * GET /v1/admin/content/drafts (versions say which kinds moved).
 */
export async function runContentCall(ctx, fn, args, { expect = {}, now = Date.now() } = {}) {
  const db = ctx.env.DB;
  if (!CONTENT_CALLS.has(fn)) throw new ApiError('bad', 'fn');
  if (!Array.isArray(args) || args.length > 6) throw new ApiError('bad', 'args');
  const t0 = Date.now();
  const timing = {};
  const mark = k => { timing[k] = Date.now() - t0; };

  const email = ctx.actor.email;
  const sid = ctx.session && ctx.session.sid || '';
  const history = fn === 'apiPublish' ? { activityRows: 300, activityMs: 30 * 86400_000 } : {};
  let [loaded, roots] = await Promise.all([loadAll(db, sid, now, history), NEEDS_ROOTS.has(fn) ? repoRoots(ctx) : null]);
  if (loaded.writer !== 'worker') throw new ApiError('writer', 'CONTENT_DRAFTS is not 1: the Sheets are the writer');
  // never guessed in production: a missing switch would publish every event without online booking
  if (loaded.bookingOnline === null && ctx.env.ENVIRONMENT === 'production') throw new ApiError('error', 'settings.BOOKING_ONLINE is not set (copy it from the Script Property at the cutover)');
  // a publish never moves bytes: library files still waiting for the site go first (like Publish.gs, a failure stops it)
  if (fn === 'apiPublish' && loaded.waiting) {
    for (let round = 0; round < 5; round++) {
      let r;
      try { r = await mirrorMedia(ctx.env, ctx.fetch, now); } catch (err) { throw new ApiError('error', 'media not on the site yet: ' + String(err && err.message).slice(0, 120)); }
      if (!r.mirrored) break;
    }
    loaded = await loadAll(db, sid, now, history);
    mark('media');
  }
  mark('load');
  const primary = (loaded.admins.find(a => a.role === 'primary') || {}).email || '';
  const names = Object.fromEntries(loaded.admins.filter(a => a.name).map(a => [a.email, a.name]));
  const sheets = sheetsFrom(loaded);

  const noted = [];
  let payDest = false;
  let hooks = null;
  const services = {
    SpreadsheetApp: {
      openById: id => {
        if (id === CONTENT_ID) return sheets.content;
        if (id === COMP_ID) return sheets.comp;
        throw new Error('spreadsheet ' + id + ' is not on the Worker');
      },
      getActiveSpreadsheet: () => null,
      create: () => { throw new Error('no new spreadsheet on the Worker'); },
      newDataValidation: () => {
        const rule = {};
        const builder = new Proxy({}, { get: (_, key) => key === 'build' ? () => rule : key === 'requireCheckbox' ? () => { rule.checkbox = true; return builder; } : () => builder });
        return builder;
      },
      flush: () => {}
    },
    CacheService: memCache(roots ? { 'pages:roots': JSON.stringify(roots) } : {}),
    LockService,
    PropertiesService: null,   // set below, before the code runs
    Utilities,
    Session: { getActiveUser: () => ({ getEmail: () => email }), getEffectiveUser: () => ({ getEmail: () => email }) },
    // what Apps Script would log as a warning (e.g. an Activity row not written) reaches the Worker's log
    console: { log() {}, info() {}, warn: (...a) => console.warn('gs:', ...a), error: (...a) => console.warn('gs:', ...a) },
    ...offline
  };
  services.PropertiesService = memProperties({
    SHEET_ID: CONTENT_ID, COMP_SHEET_ID: COMP_ID,
    ADMIN_EMAILS: loaded.admins.map(a => a.email).join(','), ADMIN_PRIMARY: primary,
    // NotifyClaim.gs notifyRouterOn_: the router's switch as Apps Script last heard it (D1 is the truth here)
    ADMIN_PLATFORM: 'worker', NOTIFY_ROUTER_ON: loaded.notifyRouter ? '1' : '0',
    GITHUB_REPO: ctx.env.GITHUB_REPO || '', GITHUB_BRANCH: ctx.env.GITHUB_BRANCH || 'main',
    SITE_URL: (ctx.env.SITE_URL || '').replace(/\/?$/, '/'),
    BOOKING_ONLINE: loaded.bookingOnline === '1' ? '1' : '0'
  });
  const g = createGs(services, h => { hooks = h; });
  // the Activity tab as Activity.gs reads it for a merge: the recent D1 rows, oldest first
  const actColumns = hooks.get('ACTIVITY_COLUMNS');
  sheets.content.addSheet('Activity', [actColumns.slice()].concat(loaded.recent.map(r => actColumns.map(c => ({
    id: r.id, at: r.at, cairo: r.cairo, actor: r.actor, actorName: r.actor_name || '', action: r.action, entityType: r.entity_type || '',
    entityId: r.entity_id || '', entityTitle: r.entity_title || '', summary: r.summary || '', changes: r.changes || '', ref: r.ref || '',
    count: r.count || 1, notified: '', device: r.device || ''
  })[c]))));
  // the data upgrade is the Sheets' business: D1 holds the current shape
  services.PropertiesService.getScriptProperties().setProperties({ DATA_SCHEMA: String(hooks.get('DATA_SCHEMA_VERSION')), COMP_SCHEMA: String(hooks.get('COMP_SCHEMA_VERSION')) });
  hooks.set('API_REQUEST_', { email, sid, platform: 'worker', platformHolders: loaded.holders });
  hooks.use('assertAdmin_', () => email);
  hooks.use('currentEmail_', () => email);
  hooks.use('log_', () => {});
  hooks.use('rememberActivity_', row => { noted.push(row); });
  hooks.use('activityForward_', () => {});
  hooks.use('activityPendingFlag_', () => {});
  hooks.use('activityDispatch_', () => {});
  hooks.use('apiStateFor_', () => ({ __state: true }));
  hooks.use('payDestSync_', () => { payDest = true; return true; });
  hooks.use('workerSyncSoon_', () => {});
  hooks.use('adminDirectory_', () => ({ ...names }));
  hooks.use('displayName_', who => names[who] || String(who || '').split('@')[0]);

  // the competitions stay on Apps Script: what this code reads of them is their view (comps.js)
  const view = staticView(ctx.env) || loaded.view;
  hooks.use('compDraft_', () => (view ? JSON.parse(JSON.stringify({ ...view, points: null, modules: {} })) : null));
  // a picture a competition uses is never purged: without the view the Worker can't tell
  if (fn === 'apiPurgeMedia' && !view) throw new ApiError('comps', 'the competitions view is not known yet');

  const media = await setupMedia(ctx, { fn, args, hooks, loaded });
  const build = await setupBuild(ctx, { fn, g, hooks, services, email });
  mark('setup');
  // P4-7: these calls answer with the whole panel state, built here as Apps Script built it
  if (build) {
    hooks.use('apiStateFor_', g.apiStateFor_);
    // the home card's rows and where the toasts start: D1's unified activity (as the session's boot)
    const activity = await retry(() => queryActivity(db, { limit: 6, view: 'log' })).catch(() => null);
    hooks.use('activityState_', () => (activity ? { recent: activity.items, latest: activity.items.length ? activity.items[0].at : 0, now } : null));
  }
  try {
    return await runAndSave(ctx, { fn, args, expect, now, g, hooks, sheets, loaded, noted, email, build, media, payDest: () => payDest, mark, timing });
  } finally {
    if (build) await build.release();
  }
}

async function runAndSave(ctx, { fn, args, expect, now, g, hooks, sheets, loaded, noted, email, build, media, payDest: payDestOf, mark, timing }) {
  const db = ctx.env.DB;
  let result;
  try {
    result = g[fn](...args);
    mark('run');
  } catch (err) {
    const message = String(err && err.message || err || '');
    const code = err && err.apiCode && PASS_CODES.has(err.apiCode) ? err.apiCode : 'invalid';
    throw new ApiError(code, 'content call refused', { error: message, apiCode: (err && err.apiCode) || '' });
  }

  // which tabs moved: a managed tab is diffed; any other tab written is a bug → nothing is saved
  const stray = [sheets.content, sheets.comp].flatMap(ss => ss.sheets)
    .filter(s => s.dirty && !Object.values(sheets.tabs).includes(s) && s.name !== 'Log' && s.name !== 'Activity');
  if (stray.length) throw new ApiError('error', 'wrote outside the drafts: ' + stray.map(s => s.name).join(','));

  const specs = hooks.get('CONTENT_EXPORT_KINDS');
  const plan = [];
  for (const spec of specs) {
    const kind = spec[0];
    if (!sheets.tabs[kind].dirty) continue;
    const after = g.contentExportKind_(spec);
    const before = new Map(loaded.rows[kind].map(r => [r.id, r]));
    const seen = new Set();
    const ops = [];
    after.rows.forEach((row, pos) => {
      const id = String(row[spec[3]]);
      if (seen.has(id)) throw new ApiError('error', kind + ': duplicate key ' + id);
      seen.add(id);
      const old = before.get(id);
      const hash = after.hashes[pos];
      if (!old) ops.push({ op: 'insert', id, pos, data: row, hash });
      else if (old.hash !== hash) ops.push({ op: 'update', id, pos, data: row, hash, version: old.version });
      else if (old.pos !== pos) ops.push({ op: 'move', id, pos });
    });
    for (const old of loaded.rows[kind]) if (!seen.has(old.id)) ops.push({ op: 'delete', id: old.id, version: old.version });
    if (ops.length) plan.push({ kind, ops, rows: after.rows.length, hash: after.hash });
  }

  const stmts = [];
  const guard = (kind, id, version) => stmts.push(db.prepare(
    'INSERT INTO draft_guard (ok) SELECT CASE WHEN COALESCE((SELECT version FROM draft_rows WHERE kind = ? AND id = ? AND deleted_ms IS NULL), -1) = ? THEN 1 ELSE 0 END'
  ).bind(kind, id, version));
  // the versions the editor opened (the «حد عدّل ده» check), whatever the call wrote
  const expected = Object.entries(expect || {});
  if (expected.length > 20) throw new ApiError('bad', 'expect');
  for (const [key, version] of expected) {
    const i = key.indexOf(':');
    const kind = key.slice(0, i);
    if (KINDS[kind] && Number.isInteger(version)) guard(kind, key.slice(i + 1), version);
  }
  for (const p of plan) {
    for (const o of p.ops) {
      if (o.op === 'insert') guard(p.kind, o.id, -1);
      if (o.op === 'update' || o.op === 'delete') guard(p.kind, o.id, o.version);
    }
  }
  if (stmts.length) stmts.push(db.prepare('DELETE FROM draft_guard'));
  for (const p of plan) {
    stmts.push(db.prepare(
      "INSERT INTO draft_kinds (kind, version, base, rows, hash, source, updated_ms, updated_by) VALUES (?, 1, 1, ?, ?, 'worker', ?, ?) " +
      "ON CONFLICT(kind) DO UPDATE SET version = draft_kinds.version + 1, rows = excluded.rows, hash = excluded.hash, source = 'worker', updated_ms = excluded.updated_ms, updated_by = excluded.updated_by"
    ).bind(p.kind, p.rows, p.hash, now, email));
    const kver = '(SELECT version FROM draft_kinds WHERE kind = ?)';
    for (const o of p.ops) {
      if (o.op === 'insert') {
        stmts.push(db.prepare(
          `INSERT INTO draft_rows (kind, id, pos, version, kver, data, hash, deleted_ms, updated_ms, updated_by) VALUES (?, ?, ?, 1, ${kver}, ?, ?, NULL, ?, ?) ` +
          'ON CONFLICT(kind, id) DO UPDATE SET pos = excluded.pos, version = draft_rows.version + 1, kver = excluded.kver, data = excluded.data, hash = excluded.hash, deleted_ms = NULL, updated_ms = excluded.updated_ms, updated_by = excluded.updated_by'
        ).bind(p.kind, o.id, o.pos, p.kind, JSON.stringify(o.data), o.hash, now, email));
      } else if (o.op === 'update') {
        stmts.push(db.prepare(`UPDATE draft_rows SET pos = ?, version = version + 1, kver = ${kver}, data = ?, hash = ?, updated_ms = ?, updated_by = ? WHERE kind = ? AND id = ?`)
          .bind(o.pos, p.kind, JSON.stringify(o.data), o.hash, now, email, p.kind, o.id));
      } else if (o.op === 'move') {
        stmts.push(db.prepare(`UPDATE draft_rows SET pos = ?, kver = ${kver} WHERE kind = ? AND id = ?`).bind(o.pos, p.kind, p.kind, o.id));
      } else {
        stmts.push(db.prepare(`UPDATE draft_rows SET deleted_ms = ?, version = version + 1, kver = ${kver}, updated_ms = ?, updated_by = ? WHERE kind = ? AND id = ?`)
          .bind(now, p.kind, now, email, p.kind, o.id));
      }
    }
  }
  for (const row of noted) {
    stmts.push(contentActivityStmt(db, row, typeof g.activitySeverity_ === 'function' ? g.activitySeverity_(row) : 'routine'));
    // Activity.gs decided an admin push (router off): Apps Script sends it (ContentExport.gs contentNotifyPull_)
    if (/^pending:/.test(String(row.notified || ''))) {
      const out = { id: row.id, at: row.at, cairo: row.cairo, actor: row.actor, actorName: row.actorName, action: row.action, type: row.type,
        entityId: row.entityId, title: row.title, summary: row.summary, changes: row.changes || null, ref: row.ref, count: row.count, notified: row.notified, device: row.device };
      stmts.push(db.prepare('INSERT INTO content_notify (id, row, created_ms, sent_ms) VALUES (?, ?, ?, NULL) ON CONFLICT(id) DO UPDATE SET row = excluded.row, sent_ms = NULL')
        .bind(row.id, JSON.stringify(out), now));
    }
  }
  const servantsMoved = plan.some(p => p.kind === 'servants');
  if (payDestOf() || servantsMoved) {
    g.pagesDropDraft_();
    // like payDestSync_: a set the booking side would refuse never blocks the save (the old set stays)
    try {
      stmts.push(...payDestStmts(db, cleanDests(g.payDestPayload_().dests), now));
    } catch (err) {
      console.warn('content: pay_dest not refreshed: ' + (err && err.message));
    }
  }

  // a publish: its revisions in the same batch as the drafts it changed (pages' liveV, Activity)
  if (build) stmts.push(...await build.statements());
  mark('prepare');
  // new library files: in R2 before the rows that point at them
  const mediaPlan = plan.find(p => p.kind === 'media');
  if (media && mediaPlan) await media.beforeBatch(db, stmts, mediaPlan.ops.filter(o => o.data).map(o => o.data), now);

  if (plan.length || noted.length || stmts.length) {
    try {
      await retry(() => db.batch(stmts));
    } catch (err) {
      if (/CHECK constraint failed/i.test(String(err && err.message))) throw new ApiError('stale', 'a row changed since it was read');
      throw err;
    }
  }
  mark('write');
  if (build) await build.finish();
  if (media) await media.afterBatch(db, now);

  const versions = { ...loaded.versions };
  for (const p of plan) versions[p.kind] = (versions[p.kind] || 0) + 1;
  // the whole panel state is not rebuilt here (the panel reads the drafts' delta)
  if (result && typeof result === 'object' && result.state && result.state.__state) delete result.state;
  return {
    result: result && result.__state ? null : result === undefined ? null : JSON.parse(JSON.stringify(result)),
    changed: plan.map(p => p.kind),
    versions,
    source: GS_SOURCE,
    // where the time went (ms since the call started): load, setup, run, prepare, write
    timing
  };
}

/* POST /v1/admin/content/call { fn, args, expect } — the permission is the Apps Script one for that call (Grants.gs API_PERMS) */
export async function adminContentCall(ctx) {
  const body = ctx.body || {};
  const fn = String(body.fn || '');
  if (!CONTENT_CALLS.has(fn)) throw new ApiError('bad', 'fn');
  const perm = API_PERM[fn];
  if (!perm) throw new ApiError('denied', 'perm unmapped');
  await requirePerm(ctx, perm === '*' ? '*' : perm, { scope: 'all' });
  return runContentCall(ctx, fn, Array.isArray(body.args) ? body.args : [], { expect: body.expect && typeof body.expect === 'object' ? body.expect : {} });
}

/* POST /v1/admin/media/upload { …apiUploadMedia's input } — the same call, a body big enough for a video */
export async function adminMediaUpload(ctx) {
  await requirePerm(ctx, API_PERM.apiUploadMedia || 'media.add', { scope: 'all' });
  return runContentCall(ctx, 'apiUploadMedia', [ctx.body || {}]);
}

/* read once from the bundle: the same table doPost checks */
const API_PERM = (() => {
  let map = {};
  createGs({ console: { log() {}, warn() {}, error() {} } }, h => { map = h.get('API_PERMS') || {}; });
  return map;
})();
