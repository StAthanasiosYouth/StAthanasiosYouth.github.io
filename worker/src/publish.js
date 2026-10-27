/*
 * PUBLISHED REVISIONS (Phase 2, docs/PUBLISH-SEPARATION-PLAN.md §4–5)
 *
 *   POST /v1/sync/publish        Apps Script → Worker (signed, lib/sync.js): the files of one publish
 *   GET  /v1/public/content      content.json      ─┐
 *   GET  /v1/public/page/:slug   <slug>/page.json   │ the live revision's exact text,
 *   GET  /v1/public/event/:slug  events/…/event.json│ ETag + no-cache (304 on repeat)
 *   GET  /v1/public/comp/:slug   competition/…/comp.json
 *   GET  /v1/public/ics          meeting.ics       ─┘
 *
 * Apps Script still builds (until Phase 4); this only stores what it built.
 * Revisions are immutable; a publish adds a row only for a file whose text
 * changed and flips `live` to it, in one batch. Folder stubs (index.html) are
 * kept for the GitHub mirror (P2-4) and never served. CONTENT_SERVE=0 in
 * settings is the kill switch: the public reads answer `disabled` and the
 * site falls back to its static files.
 */

import { ApiError, publicFileResponse } from './lib/http.js';
import { retry } from './lib/db.js';
import { sha256, randomId } from './lib/hash.js';
import { limit, clientIp } from './lib/ratelimit.js';
import { verifySync, syncStampStmt } from './lib/sync.js';
import { makeJob } from './jobs.js';

export const PUBLISH_MAX_BYTES = 2 * 1024 * 1024;
const FILE_MAX_BYTES = 256 * 1024;
const MAX_FILES = 200;
const INSERT_CHUNK_BYTES = 400 * 1024;    // one INSERT … FROM json_each(?) per chunk (D1 row/param size)

// the same rule as Apps Script COMP_SLUG (CompModel.gs), used for pages and events too (Pages.gs)
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])$/;
const PUBLISH_ID = /^[A-Za-z0-9._:-]{4,80}$/;

// keys that only private data has: a JSON file carrying one is refused (BACKEND-MIGRATION §7)
const PRIVATE_KEYS = new Set([
  'phone', 'phones', 'mobile', 'email', 'emails', 'dob', 'birth', 'birthDate', 'birthdate', 'nationalId',
  'code', 'codeHash', 'codeEnc', 'pepper', 'password', 'secret', 'token', 'tokens', 'answers', 'submissions',
  'bookings', 'payments', 'proof', 'proofs', 'ledger', 'balance', 'participantsList'
]);

const TYPES = {
  content: 'application/json; charset=utf-8',
  page: 'application/json; charset=utf-8',
  event: 'application/json; charset=utf-8',
  comp: 'application/json; charset=utf-8',
  ics: 'text/calendar; charset=utf-8',
  stub: 'text/html; charset=utf-8'
};

/* a published path → { kind, key }; null when it is not a file a publish writes */
export function pathKind(path) {
  const p = String(path || '');
  let m;
  if (p === 'content.json') return { kind: 'content', key: 'site' };
  if (p === 'meeting.ics') return { kind: 'ics', key: 'site' };
  if ((m = /^events\/([^/]+)\/(event\.json|index\.html)$/.exec(p)) && slugOk(m[1])) {
    return m[2] === 'event.json' ? { kind: 'event', key: m[1] } : { kind: 'stub', key: 'events/' + m[1] };
  }
  if ((m = /^competition\/([^/]+)\/(comp\.json|index\.html)$/.exec(p)) && slugOk(m[1])) {
    return m[2] === 'comp.json' ? { kind: 'comp', key: m[1] } : { kind: 'stub', key: 'competition/' + m[1] };
  }
  if ((m = /^([^/]+)\/(page\.json|index\.html)$/.exec(p)) && slugOk(m[1]) && m[1] !== 'events' && m[1] !== 'competition') {
    return m[2] === 'page.json' ? { kind: 'page', key: m[1] } : { kind: 'stub', key: m[1] };
  }
  return null;
}

export function slugOk(slug) {
  return SLUG.test(slug) && !/--/.test(slug);
}

/* the first private key in a parsed JSON value ('' when none) */
export function privateKey(value, depth = 0) {
  if (depth > 40) return '(too deep)';
  if (Array.isArray(value)) {
    for (const v of value) { const k = privateKey(v, depth + 1); if (k) return k; }
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (PRIVATE_KEYS.has(k)) return k;
      const inner = privateKey(v, depth + 1);
      if (inner) return inner;
    }
  }
  return '';
}

/* one posted file → the row to store, or ApiError('bad') naming the path */
async function checkFile(path, text) {
  const where = pathKind(path);
  if (!where) throw new ApiError('bad', 'path ' + String(path).slice(0, 80));
  if (typeof text !== 'string' || !text) throw new ApiError('bad', 'empty ' + path);
  if (new TextEncoder().encode(text).byteLength > FILE_MAX_BYTES) throw new ApiError('toolarge', path);
  let withdrawn = 0;
  let revision = '';
  if (where.kind === 'ics') {
    if (!/^BEGIN:VCALENDAR/.test(text)) throw new ApiError('bad', 'ics ' + path);
  } else if (where.kind === 'stub') {
    if (!/^\s*<!doctype html/i.test(text)) throw new ApiError('bad', 'stub ' + path);
  } else {
    let value;
    try { value = JSON.parse(text); } catch { throw new ApiError('bad', 'json ' + path); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('bad', 'json ' + path);
    const found = privateKey(value);
    if (found) throw new ApiError('bad', 'private key «' + found + '» in ' + path);
    withdrawn = value.withdrawn === true ? 1 : 0;
    if (where.kind === 'content') revision = typeof value.revision === 'string' ? value.revision.slice(0, 80) : '';
  }
  return { path, kind: where.kind, key: where.key, body: text, hash: await sha256(text), withdrawn, revision };
}

/*
 * POST /v1/sync/publish  (signed by Apps Script, kind 'publish')
 * body: { id, mode: 'shadow' | 'worker', by, at, files: { "<path>": "<text>" } }
 * → { id, unchanged, files, changed: [{ path, kind, key, rev, hash }] }
 */
export async function syncPublish(ctx) {
  await limit(ctx, 'sync.publish', clientIp(ctx.request), 30, 60);
  const raw = new TextDecoder().decode(ctx.raw);
  const { body, ts } = await verifySync(ctx.env, ctx.request, raw, 'publish');

  const db = ctx.env.DB;
  const prepared = await preparePublish(db, body);
  if (prepared.replayed) {
    await retry(() => syncStampStmt(db, 'publish', ts).run());
    return prepared.result;
  }
  const { result, stmts, mode } = prepared;
  stmts.push(syncStampStmt(db, 'publish', ts));
  await retry(() => db.batch(stmts));
  // PUBLISH_MODE='worker': live now; GitHub follows in the background (publish-mirror.js; the cron retries)
  if (mode === 'worker' && result.changed.length && ctx.env.JOBS) ctx.defer(ctx.env.JOBS.send(makeJob('publish.mirror', { id: result.id })));
  return result;
}

/*
 * One publish, checked and turned into statements (the caller runs them in ITS batch, so a
 * Worker publish stores the revisions and the drafts' after-publish changes together, Phase 4).
 * body: { id, mode, by, at, files } → { result, stmts, mode, events } or { replayed: true, result }.
 */
export async function preparePublish(db, body, now = Date.now()) {
  const id = String(body.id || '');
  if (!PUBLISH_ID.test(id)) throw new ApiError('bad', 'id');
  const mode = body.mode;
  if (mode !== 'shadow' && mode !== 'worker') throw new ApiError('bad', 'mode');
  const at = Number(body.at);
  if (!Number.isFinite(at) || at <= 0) throw new ApiError('bad', 'at');
  const by = typeof body.by === 'string' ? body.by.trim().toLowerCase().slice(0, 200) : '';
  const posted = body.files && typeof body.files === 'object' && !Array.isArray(body.files) ? Object.entries(body.files) : [];
  if (!posted.length || posted.length > MAX_FILES) throw new ApiError('bad', 'files');

  const files = [];
  for (const [path, text] of posted.sort((a, b) => (a[0] < b[0] ? -1 : 1))) files.push(await checkFile(path, text));
  const setHash = await sha256(files.map(f => f.path + '\n' + f.hash).join('\n'));
  const revision = (files.find(f => f.kind === 'content') || {}).revision || null;

  const known = await retry(() => db.prepare('SELECT hash, result FROM publish_jobs WHERE id = ?').bind(id).first());
  if (known) {
    if (known.hash !== setHash) throw new ApiError('conflict', 'publish id reused with other files');
    return { replayed: true, result: { ...JSON.parse(known.result), replayed: true } };
  }
  const newer = await retry(() => db.prepare("SELECT id FROM publish_jobs WHERE at > ? AND mode <> 'seed' LIMIT 1").bind(at).first());
  if (newer) throw new ApiError('conflict', 'a newer publish is already stored');

  // what is live now, and the last rev of each (kind, key): a small table, read once
  const current = await retry(() => db.prepare(
    'SELECT kind, key, MAX(rev) AS rev, MAX(CASE WHEN live = 1 THEN hash END) AS live FROM published_revisions GROUP BY kind, key'
  ).all());
  const byKey = new Map(current.results.map(r => [r.kind + '\u0000' + r.key, r]));
  const changed = [];
  for (const f of files) {
    const cur = byKey.get(f.kind + '\u0000' + f.key);
    if (cur && cur.live === f.hash) continue;
    changed.push({ ...f, id: randomId('rev'), rev: (cur ? cur.rev : 0) + 1 });
  }

  const result = {
    id, unchanged: changed.length === 0, files: files.length,
    changed: changed.map(f => ({ path: f.path, kind: f.kind, key: f.key, rev: f.rev, hash: f.hash }))
  };

  const stmts = liveStmts(db, id, by, now, changed);
  stmts.push(db.prepare(
    "INSERT INTO publish_jobs (id, mode, revision, hash, state, files, changed, result, by, at, created_at, updated_at) VALUES (?, ?, ?, ?, 'live', ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, mode, revision, setHash, files.length, changed.length, JSON.stringify(result), by || null, at, now, now));
  // 'worker': the booking's copy of a changed event is re-read on its next use (book/event.js reads this revision)
  const events = changed.filter(f => f.kind === 'event').map(f => f.key);
  if (mode === 'worker' && events.length) {
    stmts.push(db.prepare("UPDATE event_cfg SET fetched_at = 0 WHERE source <> 'fixture' AND slug IN (SELECT value FROM json_each(?))").bind(JSON.stringify(events)));
  }
  return { result, stmts, mode, events };
}

/*
 * The statements that store `rows` ({ id, kind, key, rev, hash, body, withdrawn }) under
 * publishId and make them live: new rows first (not live, a few per statement, so a big
 * publish stays within D1's per-call statement limit), then the old live rows of the same
 * (kind, key) step down and the new ones go up (the unique live index holds throughout).
 */
export function liveStmts(db, publishId, by, now, rows) {
  if (!rows.length) return [];
  const stmts = chunks(rows.map(f => ({ id: f.id, kind: f.kind, key: f.key, rev: f.rev, hash: f.hash, body: f.body, withdrawn: f.withdrawn })))
    .map(chunk => db.prepare(
      'INSERT INTO published_revisions (id, kind, key, rev, hash, body, withdrawn, live, publish_id, published_by, published_at) ' +
      "SELECT json_extract(value, '$.id'), json_extract(value, '$.kind'), json_extract(value, '$.key'), json_extract(value, '$.rev'), " +
      "json_extract(value, '$.hash'), json_extract(value, '$.body'), json_extract(value, '$.withdrawn'), 0, ?, ?, ? FROM json_each(?)"
    ).bind(publishId, by || null, now, chunk));
  stmts.push(db.prepare(
    'UPDATE published_revisions SET live = 0 WHERE live = 1 AND EXISTS (SELECT 1 FROM published_revisions n WHERE n.publish_id = ? AND n.kind = published_revisions.kind AND n.key = published_revisions.key)'
  ).bind(publishId));
  stmts.push(db.prepare('UPDATE published_revisions SET live = 1 WHERE publish_id = ?').bind(publishId));
  return stmts;
}

/* rows → JSON arrays of at most INSERT_CHUNK_BYTES each (a single bigger row gets its own) */
function chunks(rows) {
  const out = [];
  let cur = [];
  let size = 0;
  for (const row of rows) {
    const bytes = new TextEncoder().encode(JSON.stringify(row)).byteLength;
    if (cur.length && size + bytes > INSERT_CHUNK_BYTES) { out.push(cur); cur = []; size = 0; }
    cur.push(row);
    size += bytes;
  }
  if (cur.length) out.push(cur);
  return out.map(c => JSON.stringify(c));
}

/* GET /v1/public/<kind>[/:slug] → the live text (or 304) */
function servePublic(kind) {
  return async ctx => {
    const key = kind === 'content' || kind === 'ics' ? 'site' : String(ctx.params.slug || '');
    if (key !== 'site' && !slugOk(key)) throw new ApiError('not_found', 'slug');
    const row = await retry(() => ctx.env.DB.prepare(
      "SELECT s.value AS serve, r.body, r.hash FROM (SELECT 1) LEFT JOIN settings s ON s.key = 'CONTENT_SERVE' " +
      'LEFT JOIN published_revisions r ON r.kind = ? AND r.key = ? AND r.live = 1'
    ).bind(kind, key).first());
    if (row && row.serve === '0') throw new ApiError('disabled', 'CONTENT_SERVE');
    if (!row || row.body == null) throw new ApiError('not_found', kind);
    const etag = '"' + row.hash.slice(0, 32) + '"';
    const match = (ctx.request.headers.get('if-none-match') || '').split(',').map(t => t.trim().replace(/^W\//, ''));
    const status = match.includes(etag) || match.includes('*') ? 304 : 200;
    return { __response: publicFileResponse(ctx, row.body, { contentType: TYPES[kind], etag, status }) };
  };
}

export const publicContent = servePublic('content');
export const publicPage = servePublic('page');
export const publicEvent = servePublic('event');
export const publicComp = servePublic('comp');
export const publicIcs = servePublic('ics');
