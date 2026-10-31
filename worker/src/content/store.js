/*
 * CONTENT DRAFTS IN D1 (Phase 4, docs/CONTENT-MIGRATION-PLAN.md §3–§5).
 *
 * P4-1: the Sheets → D1 copy (dry run / apply, checked row by row against
 * the hashes Apps Script computed), the reverse export (D1 → the Sheets'
 * columns, for the rollback), the panel's read (whole, or the changes since
 * the versions it holds) and the status.
 *
 * One writer (BACKEND-MIGRATION §22): settings.CONTENT_DRAFTS '0' = the
 * Sheets write, D1 is a copy and imports are allowed; '1' = D1 writes,
 * imports are refused (they would overwrite the panel's edits).
 *
 * Hashes (the same recipe in apps-script/ContentExport.gs):
 *   row  = sha256(JSON.stringify(row in the kind's column order))
 *   kind = sha256(rows.map(r => key + ':' + rowHash).join('\n'))   in Sheet order
 */

import { ApiError } from '../lib/http.js';
import { sha256, randomId } from '../lib/hash.js';
import { retry } from '../lib/db.js';
import { activityStmt } from '../lib/activity.js';
import { KINDS, KIND_NAMES, canonicalRow, rowKey, validKey } from './kinds.js';

export const IMPORT_MAX_BYTES = 4 * 1024 * 1024;
/* D1 binds one value up to ~2 MB: a kind's rows go in as one JSON text */
const KIND_MAX_CHARS = 1800 * 1024;
const KIND_MAX_ROWS = 5000;

export async function draftsWriter(db) {
  const row = await retry(() => db.prepare("SELECT value FROM settings WHERE key = 'CONTENT_DRAFTS'").first());
  return row && row.value === '1' ? 'worker' : 'sheets';
}

export async function kindHash(rows) {
  return sha256(rows.map(r => r.id + ':' + r.hash).join('\n'));
}

/*
 * Checks one kind of an export: every row canonical, keys valid and unique,
 * the row hashes and the kind hash equal to what Apps Script sent.
 * → { rows: [{ id, pos, text, hash }], hash, problems: [] }
 */
export async function checkKind(kind, sent) {
  const problems = [];
  const rows = [];
  if (!sent || !Array.isArray(sent.rows)) return { rows, hash: '', problems: ['rows missing'] };
  if (sent.rows.length > KIND_MAX_ROWS) return { rows, hash: '', problems: ['too many rows'] };
  const seen = new Set();
  for (let pos = 0; pos < sent.rows.length; pos++) {
    let data;
    try {
      data = canonicalRow(kind, sent.rows[pos]);
    } catch (err) {
      problems.push('row ' + (pos + 1) + ': ' + err.message);
      continue;
    }
    const id = rowKey(kind, data);
    if (!validKey(id)) { problems.push('row ' + (pos + 1) + ': bad key'); continue; }
    if (seen.has(id)) { problems.push('row ' + (pos + 1) + ': duplicate key ' + id); continue; }
    seen.add(id);
    const text = JSON.stringify(data);
    rows.push({ id, pos, text, hash: await sha256(text) });
  }
  const hash = await kindHash(rows);
  if (!problems.length) {
    const hashes = Array.isArray(sent.hashes) ? sent.hashes : null;
    if (!hashes || hashes.length !== rows.length) problems.push('row hashes missing');
    else rows.forEach((r, i) => { if (hashes[i] !== r.hash) problems.push('row ' + (i + 1) + ' (' + r.id + '): hash differs'); });
    if (sent.hash !== hash) problems.push('kind hash differs');
  }
  if (rows.reduce((n, r) => n + r.text.length + 200, 0) > KIND_MAX_CHARS) problems.push('kind too large for one statement');
  return { rows, hash, problems: problems.slice(0, 20) };
}

/* the live rows of a kind in order, as stored */
async function storedRows(db, kind) {
  const { results } = await retry(() => db.prepare('SELECT id, hash FROM draft_rows WHERE kind = ? AND deleted_ms IS NULL ORDER BY pos, id').bind(kind).all());
  return results;
}

/*
 * The Sheets → D1 copy. body: { mode: 'dry' | 'apply', kinds: { kind: { rows, hashes, hash } }, sourceHash }
 * Every kind of KINDS must be present (a partial copy would leave D1 half old).
 * apply replaces each kind whole, in one D1 batch (one transaction), then
 * re-reads D1 and compares every kind's hash with the source.
 */
export async function importDrafts(env, body, { by = 'apps-script', now = Date.now(), raw = '' } = {}) {
  const db = env.DB;
  const mode = body && body.mode === 'apply' ? 'apply' : body && body.mode === 'dry' ? 'dry' : '';
  if (!mode) throw new ApiError('bad', 'mode');
  const sent = body.kinds && typeof body.kinds === 'object' ? body.kinds : null;
  if (!sent) throw new ApiError('bad', 'kinds');
  const unknown = Object.keys(sent).filter(k => !KINDS[k]);
  const missing = KIND_NAMES.filter(k => !sent[k]);
  const id = randomId('imp-');
  const sourceHash = await sha256(raw || JSON.stringify(body.kinds));

  const record = (state, kinds, error) => db.prepare('INSERT INTO draft_imports (id, mode, state, kinds, source_hash, by, at, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, mode, state, JSON.stringify(kinds), sourceHash, by, now, error ? String(error).slice(0, 2000) : null);

  if (unknown.length || missing.length) {
    const error = (unknown.length ? 'unknown kinds: ' + unknown.join(',') : '') + (missing.length ? ' missing kinds: ' + missing.join(',') : '');
    await retry(() => record('refused', {}, error.trim()).run());
    return { id, mode, state: 'refused', error: error.trim(), kinds: {} };
  }

  const writer = await draftsWriter(db);
  const checked = {};
  const report = {};
  for (const kind of KIND_NAMES) {
    const c = await checkKind(kind, sent[kind]);
    checked[kind] = c;
    const before = await storedRows(db, kind);
    const beforeHash = before.length ? await kindHash(before) : '';
    report[kind] = { rows: c.rows.length, hash: c.hash, d1Before: { rows: before.length, hash: beforeHash, same: beforeHash === c.hash }, problems: c.problems };
  }
  const bad = KIND_NAMES.filter(k => checked[k].problems.length);

  if (bad.length) {
    await retry(() => record('refused', report, 'problems in ' + bad.join(',')).run());
    return { id, mode, state: 'refused', error: 'problems in ' + bad.join(','), kinds: report };
  }
  if (mode === 'apply' && writer !== 'sheets') {
    await retry(() => record('refused', report, 'writer is worker').run());
    throw new ApiError('writer', 'CONTENT_DRAFTS = 1: D1 is the writer, the Sheets copy would overwrite it');
  }
  if (mode === 'dry') {
    await retry(() => record('ok', report).run());
    return { id, mode, state: 'ok', writer, kinds: report };
  }

  // apply: per kind, drop the copy and insert the rows from one JSON text (one statement each)
  const stmts = [];
  for (const kind of KIND_NAMES) {
    const rows = checked[kind].rows;
    stmts.push(db.prepare('DELETE FROM draft_rows WHERE kind = ?').bind(kind));
    if (rows.length) {
      const payload = JSON.stringify(rows.map(r => [r.id, r.pos, r.text, r.hash]));
      stmts.push(db.prepare(
        "INSERT INTO draft_rows (kind, id, pos, version, kver, data, hash, deleted_ms, updated_ms, updated_by) " +
        "SELECT ?, json_extract(value, '$[0]'), json_extract(value, '$[1]'), 1, " +
        "COALESCE((SELECT version FROM draft_kinds WHERE kind = ?), 0) + 1, json_extract(value, '$[2]'), json_extract(value, '$[3]'), NULL, ?, ? FROM json_each(?)"
      ).bind(kind, kind, now, by, payload));
    }
    stmts.push(db.prepare(
      'INSERT INTO draft_kinds (kind, version, base, rows, hash, source, updated_ms, updated_by) VALUES (?, 1, 1, ?, ?, \'import\', ?, ?) ' +
      'ON CONFLICT(kind) DO UPDATE SET version = draft_kinds.version + 1, base = draft_kinds.version + 1, rows = excluded.rows, hash = excluded.hash, source = excluded.source, updated_ms = excluded.updated_ms, updated_by = excluded.updated_by'
    ).bind(kind, rows.length, checked[kind].hash, now, by));
  }
  stmts.push(activityStmt(db, { actor: by, action: 'import', entityType: 'content', entityId: id, summary: 'نسخ المسودات من الشيت إلى الخادم الجديد', severity: 'important', source: 'system' }));
  try {
    await retry(() => db.batch(stmts));
  } catch (err) {
    await retry(() => record('failed', report, err && err.message).run()).catch(() => {});
    throw err;
  }

  // the check: D1 read back, every kind equal to the source
  let mismatched = [];
  for (const kind of KIND_NAMES) {
    const after = await storedRows(db, kind);
    const afterHash = await kindHash(after);
    report[kind].d1Hash = afterHash;
    report[kind].ok = afterHash === checked[kind].hash && after.length === checked[kind].rows.length;
    if (!report[kind].ok) mismatched.push(kind);
  }
  const state = mismatched.length ? 'mismatch' : 'ok';
  await retry(() => record(state, report, mismatched.length ? 'mismatch in ' + mismatched.join(',') : null).run());
  return { id, mode, state, writer, kinds: report };
}

/*
 * The drafts for the panel. since: { kind: version } the panel already holds.
 * A kind whose version is unchanged comes back as { version, same: true };
 * a newer one as the rows changed since (deltas, tombstones as { id, deleted: true })
 * when `since` names it, else the whole kind.
 */
export async function readDrafts(db, { kinds = KIND_NAMES, since = {}, includePrivate = false } = {}) {
  const wanted = kinds.filter(k => KINDS[k]);
  if (!wanted.length) return { kinds: {} };
  const marks = wanted.map(() => '?').join(',');
  const { results: meta } = await retry(() => db.prepare('SELECT kind, version, base, rows, hash, source, updated_ms FROM draft_kinds WHERE kind IN (' + marks + ')').bind(...wanted).all());
  const byKind = Object.fromEntries(meta.map(m => [m.kind, m]));
  const out = {};
  const full = [];
  const delta = [];
  for (const kind of wanted) {
    const m = byKind[kind];
    if (!m) { out[kind] = { version: 0, rows: [] }; continue; }
    const have = Number(since[kind]);
    if (have === m.version) out[kind] = { version: m.version, same: true };
    // an import replaced the kind whole (no tombstones): older holders get it whole
    else if (have >= m.base && have < m.version) delta.push([kind, have]);
    else full.push(kind);
    if (!out[kind]) out[kind] = { version: m.version, hash: m.hash, rows: [] };
  }
  const clean = (kind, data) => {
    const priv = KINDS[kind].private;
    if (includePrivate || !priv) return data;
    const copy = { ...data };
    for (const c of priv) if (copy[c] !== undefined) copy[c] = copy[c] === '' ? '' : true;
    return copy;
  };
  const stmts = [];
  if (full.length) {
    stmts.push(db.prepare('SELECT kind, id, version, data, deleted_ms FROM draft_rows WHERE deleted_ms IS NULL AND kind IN (' + full.map(() => '?').join(',') + ') ORDER BY kind, pos, id').bind(...full));
  }
  for (const [kind, have] of delta) {
    stmts.push(db.prepare('SELECT kind, id, version, data, deleted_ms FROM draft_rows WHERE kind = ? AND kver > ? ORDER BY pos, id').bind(kind, have));
  }
  if (stmts.length) {
    const results = await retry(() => db.batch(stmts));
    for (const r of results) {
      for (const row of r.results) {
        const entry = row.deleted_ms ? { id: row.id, deleted: true } : { id: row.id, version: row.version, data: clean(row.kind, JSON.parse(row.data)) };
        out[row.kind].rows.push(entry);
      }
    }
    for (const [kind] of delta) out[kind].delta = true;
  }
  return { kinds: out };
}

/* D1 → the Sheets' columns (the rollback copy): { kind: { tab, sheet, columns, rows: [[cells]] , hash } } */
export async function exportDrafts(db) {
  const out = {};
  const { results } = await retry(() => db.prepare('SELECT kind, id, data, hash FROM draft_rows WHERE deleted_ms IS NULL ORDER BY kind, pos, id').all());
  for (const kind of KIND_NAMES) out[kind] = { tab: KINDS[kind].tab, sheet: KINDS[kind].sheet, columns: KINDS[kind].columns, rows: [], keyed: [] };
  for (const row of results) {
    if (!out[row.kind]) continue;
    const data = JSON.parse(row.data);
    out[row.kind].rows.push(KINDS[row.kind].columns.map(c => data[c]));
    out[row.kind].keyed.push({ id: row.id, hash: row.hash });
  }
  for (const kind of KIND_NAMES) {
    out[kind].hash = await kindHash(out[kind].keyed);
    out[kind].hashes = out[kind].keyed.map(k => k.hash);
    delete out[kind].keyed;
  }
  return out;
}

export async function draftsStatus(db) {
  const [writer, kinds, last] = await Promise.all([
    draftsWriter(db),
    retry(() => db.prepare('SELECT kind, version, rows, hash, source, updated_ms FROM draft_kinds ORDER BY kind').all()),
    retry(() => db.prepare('SELECT id, mode, state, by, at, error FROM draft_imports ORDER BY at DESC LIMIT 5').all())
  ]);
  return { writer, kinds: kinds.results, imports: last.results };
}
