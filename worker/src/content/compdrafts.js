/*
 * COMPETITIONS' ADMIN ON THE WORKER (docs/PHASE5-PLAN.md §3o).
 *
 * The drafts (Competitions, Questions) are draft_rows like every other kind and the admin's
 * calls run the SAME apps-script/CompAdmin.gs (content/runtime.js), so a save, a review and a
 * publish no longer wait for Apps Script. settings.COMP_DRAFTS = 'worker' is the switch.
 *
 * The move, once (compImportTick, from the minute cron; a D1 setting asks for it):
 *   COMP_IMPORT = 'dry'    Apps Script's rows are checked and reported, nothing changes on either side
 *   COMP_IMPORT = 'apply'  Apps Script freezes its copy (Script Property COMP_DRAFTS) and answers with it;
 *                          the rows, the linked cards, the module switches and the version key go into
 *                          one D1 batch with the switch. Repeatable until the switch is on.
 * COMP_IMPORT_REPORT holds the outcome (no answers, no key).
 *
 * Results: the read calls run the same code over a tab built from D1's submissions (the Worker's
 * own rows since COMP_RUNTIME = worker); the marks go through comp/admin.js (ledger, member emails).
 */

import { ApiError } from '../lib/http.js';
import { retry, cairoText } from '../lib/db.js';
import { activityStmt } from '../lib/activity.js';
import { logLine } from '../lib/log.js';
import { sha256 } from '../lib/hash.js';
import { COMP_KIND_NAMES, canonicalRow, rowKey } from './kinds.js';
import { checkKind, kindHash } from './store.js';
import { askAppsScript } from './comps.js';

export const COMP_AUTHOR_CALLS = ['apiComps', 'apiComp', 'apiCompCreate', 'apiCompSave', 'apiCompDuplicate', 'apiCompArchive', 'apiCompDelete', 'apiCompClose', 'apiCompFinalize', 'apiCompSettings',
  'apiCompQuestionSave', 'apiCompQuestionDuplicate', 'apiCompQuestionDelete', 'apiCompQuestionsReorder', 'apiCompImportPreview', 'apiCompImportApply', 'apiCompPreviewGrade', 'apiCompPreviewDefinition'];
export const COMP_RESULT_READS = ['apiCompSubmissions', 'apiCompSubmission', 'apiCompReviewQueue', 'apiCompResults', 'apiCompExport'];
export const COMP_RESULT_WRITES = ['apiCompGrade', 'apiCompGradeGroup', 'apiCompRegrade', 'apiCompVoid'];
export const COMP_CALLS = new Set([...COMP_AUTHOR_CALLS, ...COMP_RESULT_READS, ...COMP_RESULT_WRITES]);

export const MODULE_KEYS = ['COMP_REGISTRY', 'COMP_WALLET', 'COMP_SHOP'];
const SETTING_KEYS = ['COMP_DRAFTS', 'COMP_HASH_KEY', ...MODULE_KEYS];
const SUBMITTED = ['submitted', 'pending_review', 'graded'];

export const settingStmt = (db, key, value, now, by) => db.prepare(
  'INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by'
).bind(key, value, now, by);

export const compSettingsQuery = db => db.prepare(`SELECT key, value FROM settings WHERE key IN (${SETTING_KEYS.map(k => `'${k}'`).join(', ')})`);

export function compSettingsOf(results) {
  const map = Object.fromEntries(results.map(r => [r.key, r.value]));
  return { local: map.COMP_DRAFTS === 'worker', key: map.COMP_HASH_KEY || '', modules: Object.fromEntries(MODULE_KEYS.map(k => [k, map[k] === '1' ? '1' : ''])) };
}

export async function compWriter(db) {
  const row = await retry(() => db.prepare("SELECT value FROM settings WHERE key = 'COMP_DRAFTS'").first());
  return row && row.value === 'worker' ? 'worker' : 'apps-script';
}

/* the competition a result read is about, and its rows as the Submissions tab holds them */
export async function loadResults(db, fn, args, columns) {
  let compId = String(args[0] || '');
  if (fn === 'apiCompSubmission') {
    const one = await retry(() => db.prepare('SELECT comp_id FROM submissions WHERE id = ?').bind(compId).first());
    if (!one) throw new ApiError('invalid', 'submission', { error: 'المشاركة مش موجودة' });
    compId = one.comp_id;
  }
  const [rows, versions] = await retry(() => db.batch([
    db.prepare('SELECT s.*, p.name AS person, p.phone AS person_phone FROM submissions s LEFT JOIN participants p ON p.id = s.participant_id WHERE s.comp_id = ? ORDER BY s.started_ms, s.id LIMIT 5000').bind(compId),
    db.prepare('SELECT version, def FROM comp_versions WHERE comp_id = ?').bind(compId)
  ]));
  const wall = ms => (ms ? cairoText(ms) : '');
  const text = v => (v === null || v === undefined ? '' : String(v));
  const lines = rows.results.map(r => {
    const flags = text(r.flags).split(',').filter(Boolean);
    if (r.elig === 'guest' && !flags.includes('guest')) flags.push('guest');
    if (r.no_points && !flags.includes('noPoints')) flags.push('noPoints');
    const row = {
      id: r.id, compId: r.comp_id, version: r.version, clientKey: r.client_key, attemptNo: text(r.attempt_no), participantId: r.participant_id, name: text(r.person), phone: text(r.person_phone),
      fields: '{}', status: r.status, startedAt: wall(r.started_ms), submittedAt: wall(r.submitted_ms), startedMs: text(r.started_ms), deadlineMs: text(r.deadline_ms), submittedMs: text(r.submitted_ms),
      durationSec: text(r.duration_sec), seed: r.seed, qids: r.qids, score: text(r.score), maxScore: text(r.max_score), correctCount: text(r.correct_count), gradableCount: text(r.gradable_count),
      pendingCount: text(r.pending_count), flags: flags.join(','), answers: text(r.answers), grading: text(r.grading), reviewedBy: '', updatedAt: wall(r.updated_ms)
    };
    return columns.map(c => (row[c] === undefined ? '' : row[c]));
  });
  const defs = Object.fromEntries(versions.results.map(v => [v.version, v.def]));
  return { compId, lines, defs };
}

/* «المسابقات» list and the delete check: { compId: counts }, and the ids that have any submission */
export async function loadCounts(db) {
  const { results } = await retry(() => db.prepare('SELECT comp_id, status, COUNT(*) AS n FROM submissions GROUP BY comp_id, status').all());
  const counts = {};
  for (const r of results) {
    const c = counts[r.comp_id] = counts[r.comp_id] || { total: 0, done: 0, pending: 0, inProgress: 0, void: 0 };
    c.total += r.n;
    if (SUBMITTED.includes(r.status)) c.done += r.n;
    if (r.status === 'pending_review') c.pending += r.n;
    if (r.status === 'in_progress') c.inProgress += r.n;
    if (r.status === 'void') c.void += r.n;
  }
  return counts;
}

/* one kind written whole from checked rows */
function kindStmts(db, kind, checked, now, by) {
  const stmts = [db.prepare('DELETE FROM draft_rows WHERE kind = ?').bind(kind)];
  if (checked.rows.length) {
    stmts.push(db.prepare(
      'INSERT INTO draft_rows (kind, id, pos, version, kver, data, hash, deleted_ms, updated_ms, updated_by) ' +
      "SELECT ?, json_extract(value, '$[0]'), json_extract(value, '$[1]'), 1, COALESCE((SELECT version FROM draft_kinds WHERE kind = ?), 0) + 1, json_extract(value, '$[2]'), json_extract(value, '$[3]'), NULL, ?, ? FROM json_each(?)"
    ).bind(kind, kind, now, by, JSON.stringify(checked.rows.map(r => [r.id, r.pos, r.text, r.hash]))));
  }
  stmts.push(db.prepare(
    "INSERT INTO draft_kinds (kind, version, base, rows, hash, source, updated_ms, updated_by) VALUES (?, 1, 1, ?, ?, 'import', ?, ?) " +
    'ON CONFLICT(kind) DO UPDATE SET version = draft_kinds.version + 1, base = draft_kinds.version + 1, rows = excluded.rows, hash = excluded.hash, source = excluded.source, updated_ms = excluded.updated_ms, updated_by = excluded.updated_by'
  ).bind(kind, checked.rows.length, checked.hash, now, by));
  return stmts;
}

/*
 * The linked cards the Sheets hold and D1 doesn't: a competition's card was written by Apps Script into
 * its frozen Activities tab, so the Worker's publish never had it. Added to the kind, nothing else touched.
 */
async function missingRows(db, kind, sent, wanted, now, by) {
  const { results } = await retry(() => db.prepare('SELECT id, pos, hash, deleted_ms FROM draft_rows WHERE kind = ?').bind(kind).all());
  const have = new Map(results.map(r => [r.id, r]));
  const add = [];
  for (const row of sent || []) {
    const data = canonicalRow(kind, row);
    const id = rowKey(kind, data);
    if (!wanted.has(id) || (have.get(id) && !have.get(id).deleted_ms)) continue;
    const text = JSON.stringify(data);
    add.push({ id, text, hash: await sha256(text) });
  }
  if (!add.length) return { stmts: [], added: [] };
  const live = results.filter(r => !r.deleted_ms).sort((a, b) => a.pos - b.pos);
  const pos = live.reduce((max, r) => Math.max(max, r.pos), -1);
  const hash = await kindHash(live.concat(add));
  const kver = '(SELECT version FROM draft_kinds WHERE kind = ?)';
  return {
    added: add.map(r => r.id),
    stmts: [
      db.prepare('UPDATE draft_kinds SET version = version + 1, rows = ?, hash = ?, updated_ms = ?, updated_by = ? WHERE kind = ?').bind(live.length + add.length, hash, now, by, kind),
      ...add.map((r, i) => db.prepare(
        `INSERT INTO draft_rows (kind, id, pos, version, kver, data, hash, deleted_ms, updated_ms, updated_by) VALUES (?, ?, ?, 1, ${kver}, ?, ?, NULL, ?, ?) ` +
        'ON CONFLICT(kind, id) DO UPDATE SET pos = excluded.pos, version = draft_rows.version + 1, kver = excluded.kver, data = excluded.data, hash = excluded.hash, deleted_ms = NULL, updated_ms = excluded.updated_ms, updated_by = excluded.updated_by'
      ).bind(kind, r.id, pos + 1 + i, kind, r.text, r.hash, now, by))
    ]
  };
}

/* what Apps Script answered → the report; apply: everything in one batch, read back */
export async function importComps(env, sent, { apply, now = Date.now(), by = 'apps-script' }) {
  const db = env.DB;
  const checked = {};
  const problems = [];
  for (const kind of COMP_KIND_NAMES) {
    checked[kind] = await checkKind(kind, sent.kinds && sent.kinds[kind]);
    problems.push(...checked[kind].problems.map(p => kind + ': ' + p));
  }
  const comps = (sent.kinds && sent.kinds.competitions && sent.kinds.competitions.rows) || [];
  const questions = (sent.kinds && sent.kinds.questions && sent.kinds.questions.rows) || [];
  if (!/^[A-Za-z0-9+/=]{20,}$/.test(String(sent.hashKey || ''))) problems.push('the version key is missing');
  const report = {
    at: now, mode: apply ? 'apply' : 'dry', state: problems.length ? 'refused' : 'ok', problems: problems.slice(0, 20),
    competitions: comps.map(c => ({ id: c.id, slug: c.slug, title: c.title, enabled: c.enabled, archived: c.archived, wallet: c.wallet, scoring: c.scoring, participation: c.participation, cardId: c.cardId, liveVersion: c.liveVersion, questions: questions.filter(q => q.compId === c.id).length })),
    questions: questions.length,
    hash: { competitions: checked.competitions.hash, questions: checked.questions.hash },
    modules: sent.modules || {}
  };
  if (problems.length || !apply) return report;

  const cardIds = new Set(comps.map(c => String(c.cardId || '')).filter(Boolean));
  const cards = await missingRows(db, 'activities', sent.cards, cardIds, now, by);
  const types = await missingRows(db, 'types', sent.types, new Set(cards.added.length ? ['competition'] : []), now, by);
  const modules = sent.modules || {};
  const view = sent.view || null;
  await retry(() => db.batch([
    ...COMP_KIND_NAMES.flatMap(kind => kindStmts(db, kind, checked[kind], now, by)),
    ...cards.stmts,
    ...types.stmts,
    ...MODULE_KEYS.map(k => settingStmt(db, k, modules[k] === '1' ? '1' : '', now, by)),
    settingStmt(db, 'COMP_HASH_KEY', sent.hashKey, now, by),
    ...(view ? [db.prepare("UPDATE comp_package SET data = json_set(data, '$.items', json(?)) WHERE id = 'view'").bind(JSON.stringify(view.items || []))] : []),
    settingStmt(db, 'COMP_DRAFTS', 'worker', now, by),
    activityStmt(db, { actor: by, action: 'import', entityType: 'competition', entityId: 'drafts', summary: 'نقل إدارة المسابقات إلى الخادم الجديد', severity: 'important', source: 'system' })
  ]));
  report.cards = cards.added;
  report.state = 'applied';
  // the check: D1 read back, each kind equal to what was sent
  for (const kind of COMP_KIND_NAMES) {
    const { results } = await retry(() => db.prepare('SELECT id, hash FROM draft_rows WHERE kind = ? AND deleted_ms IS NULL ORDER BY pos, id').bind(kind).all());
    if (await kindHash(results) !== checked[kind].hash) report.state = 'mismatch';
  }
  return report;
}

/* the minute cron: a move someone asked for through the setting. Waits on the network, little CPU. */
export async function compImportTick(env, doFetch = (...a) => fetch(...a), now = Date.now()) {
  const db = env.DB;
  const asked = await retry(() => db.prepare("SELECT value FROM settings WHERE key = 'COMP_IMPORT'").first('value'));
  if (asked !== 'dry' && asked !== 'apply') return null;
  // one try per request: a failure is reported, and asking again is a new setting
  await retry(() => settingStmt(db, 'COMP_IMPORT', '', now, 'worker').run());
  let report;
  try {
    if (await compWriter(db) === 'worker') throw new Error('COMP_DRAFTS is already worker');
    const sent = await askAppsScript({ env, fetch: doFetch }, { call: 'compExport', freeze: asked === 'apply' });
    report = await importComps(env, sent, { apply: asked === 'apply', now });
  } catch (err) {
    report = { at: now, mode: asked, state: 'failed', problems: [String(err && err.message).slice(0, 300)] };
  }
  await retry(() => settingStmt(db, 'COMP_IMPORT_REPORT', JSON.stringify(report), now, 'worker').run());
  logLine({ kind: 'cron', job: 'comp.import', mode: asked, state: report.state });
  return report;
}


