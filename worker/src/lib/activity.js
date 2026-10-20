/*
 * Audit rows, written in the SAME batch as the change they describe (never
 * lost, no extra round trip). Same columns as the Apps Script Activity tab.
 * `changes` is trimmed to 1 KB and must never hold phones, codes, answers or
 * payment proofs — callers pass field NAMES and short public values only.
 */

import { randomId } from './hash.js';
import { cairoText } from './db.js';

const SEVERITY = new Set(['critical', 'important', 'routine']);
const clip = (v, n) => (v == null ? null : String(v).slice(0, n));

export function activityStmt(db, a) {
  const at = a.at || Date.now();
  let changes = a.changes == null ? null : JSON.stringify(a.changes);
  if (changes && changes.length > 1024) changes = changes.slice(0, 1021) + '…';
  return db.prepare(
    (a.orIgnore ? 'INSERT OR IGNORE' : 'INSERT') + ' INTO activity (id, at, cairo, actor, actor_name, action, entity_type, entity_id, entity_title, summary, changes, ref, device, severity, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    a.id || randomId('act-'), at, cairoText(at), clip(a.actor || 'system', 200), clip(a.actorName, 120), clip(a.action, 60),
    clip(a.entityType, 40), clip(a.entityId, 80), clip(a.entityTitle, 200), clip(a.summary, 300), changes, clip(a.ref, 120), clip(a.device, 40),
    SEVERITY.has(a.severity) ? a.severity : 'routine', a.source === 'apps-script' || a.source === 'system' ? a.source : 'worker'
  );
}

export async function listActivity(db, { before = null, limit = 30 } = {}) {
  const n = Math.max(1, Math.min(100, Number(limit) || 30));
  const stmt = before
    ? db.prepare('SELECT id, at, cairo, actor_name, action, entity_type, entity_id, entity_title, summary, count FROM activity WHERE at < ? ORDER BY at DESC LIMIT ?').bind(Number(before), n)
    : db.prepare('SELECT id, at, cairo, actor_name, action, entity_type, entity_id, entity_title, summary, count FROM activity ORDER BY at DESC LIMIT ?').bind(n);
  const r = await stmt.all();
  return r.results;
}
