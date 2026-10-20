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

/*
 * The unified «سجل النشاط» (Phase 1.5 step 4): the Worker's own rows and the
 * Apps Script rows forwarded into D1 (POST /v1/sync/activity), read together.
 * Filters and families/sections mirror apps-script/Activity.gs apiActivity,
 * plus the Worker's own actions (bookings, money, accounts). view=log hides
 * the technical rows (diagnostics, feeds, syncs); without it, every row.
 */
export const FAMILIES = {
  add: ['create', 'upload', 'import', 'duplicate', 'booking.create', 'payment.add', 'handover.add', 'accounts.add', 'proof.upload'],
  edit: ['update', 'settings', 'reorder', 'enable', 'disable', 'archive', 'unarchive', 'media.update', 'media.restore', 'live.stage',
    'review', 'finalize', 'regrade', 'close', 'code.view', 'code.reset', 'code.export', 'participant.phone', 'points.adjust', 'redemption.status',
    'booking.confirm', 'booking.update', 'booking.reopen', 'booking.remind', 'modules.book', 'pay.approve'],
  remove: ['delete', 'media.delete', 'media.purge', 'booking.cancel', 'booking.reject', 'booking.withdraw', 'payment.void', 'payment.refund',
    'handover.void', 'event.cancelAll', 'proof.delete', 'accounts.remove'],
  publish: ['publish'],
  push: ['push'],
  admins: ['admin.add', 'admin.remove', 'admin.rename', 'migrate', 'session.takeover', 'accounts.add', 'accounts.grants', 'accounts.remove']
};
export const SECTIONS = {
  sessions: ['sessions'],
  news: ['news'],
  games: ['games'],
  activities: ['activities', 'types'],
  notifications: ['notifications'],
  page: ['links', 'sections', 'contacts', 'settings'],
  media: ['media'],
  site: ['site', 'data'],
  admins: ['admins', 'session', 'admin'],
  competitions: ['competition', 'participant', 'points', 'shopitem', 'redemption'],
  pages: ['page', 'event', 'servant'],
  bookings: ['booking', 'bookings', 'proof', 'handover'],
  delivery: ['notify']
};
const TECHNICAL = ['diag.echo', 'diag.queue', 'booknews.claim', 'booknews.ack', 'admins.sync', 'paydest.sync', 'job.failed', 'booking.retention'];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const marks = list => list.map(() => '?').join(',');

function nextDay(day) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function parseChanges(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

/* q: { limit, before, actor, family, section, from, to (Cairo days), id, view } → { items, more, next, admins, families, sections } */
export async function queryActivity(db, q = {}) {
  const n = Math.max(1, Math.min(100, Math.floor(Number(q.limit)) || 50));
  const where = [];
  const args = [];
  const id = /^act-[0-9a-zA-Z]{6,40}$/.test(String(q.id || '')) ? String(q.id) : '';
  if (id) {
    where.push('a.id = ?'); args.push(id);
  } else {
    if (q.view === 'log') { where.push('a.action NOT IN (' + marks(TECHNICAL) + ')'); args.push(...TECHNICAL); }
    const actor = String(q.actor || '').trim().toLowerCase();
    if (actor) { where.push('a.actor = ?'); args.push(actor); }
    const fam = Object.prototype.hasOwnProperty.call(FAMILIES, q.family) ? FAMILIES[q.family] : null;
    if (fam) { where.push('a.action IN (' + marks(fam) + ')'); args.push(...fam); }
    const sec = Object.prototype.hasOwnProperty.call(SECTIONS, q.section) ? SECTIONS[q.section] : null;
    if (sec) { where.push('a.entity_type IN (' + marks(sec) + ')'); args.push(...sec); }
    if (DAY_RE.test(String(q.from || ''))) { where.push('a.cairo >= ?'); args.push(q.from); }
    if (DAY_RE.test(String(q.to || ''))) { where.push('a.cairo < ?'); args.push(nextDay(q.to)); }
    const before = Number(q.before);
    if (Number.isFinite(before) && before > 0) { where.push('a.at < ?'); args.push(before); }
  }
  const [rows, admins] = await db.batch([
    db.prepare('SELECT a.id, a.at, a.cairo, a.actor, a.actor_name, d.name AS admin_name, a.action, a.entity_type, a.entity_id, a.entity_title, ' +
      'a.summary, a.changes, a.ref, a.count, a.device, a.severity, a.source FROM activity a LEFT JOIN admins d ON d.email = a.actor ' +
      (where.length ? 'WHERE ' + where.join(' AND ') + ' ' : '') + 'ORDER BY a.at DESC LIMIT ?').bind(...args, n + 1),
    db.prepare('SELECT email, name FROM admins WHERE active = 1 ORDER BY email')
  ]);
  const items = rows.results.slice(0, n).map(r => {
    const shown = r.admin_name || r.actor_name || String(r.actor).split('@')[0];
    return {
      id: r.id, at: r.at, cairo: r.cairo, actor: r.actor, actorName: shown, action: r.action, type: r.entity_type || '',
      entityId: r.entity_id || '', title: r.entity_title || '', summary: r.summary || '', text: shown + ' ' + (r.summary || ''),
      changes: parseChanges(r.changes), ref: r.ref || '', count: r.count || 1, device: r.device || '',
      severity: r.severity || 'routine', source: r.source || 'worker'
    };
  });
  const more = rows.results.length > n;
  return {
    items, more, next: more && items.length ? items[items.length - 1].at : 0,
    admins: admins.results.map(a => ({ email: a.email, name: a.name || a.email.split('@')[0] })),
    families: Object.keys(FAMILIES), sections: Object.keys(SECTIONS)
  };
}

/*
 * One Apps Script Activity row into D1 (POST /v1/sync/activity): an upsert by
 * its id, so a resend or a merged row (Activity.gs merges small edits into the
 * same id) updates it — never a second row. A Worker row is never overwritten.
 * While NOTIFY_ROUTER is off Apps Script delivers its own admin pushes
 * (AdminNotify.gs), so a new row is stored as notified; once the router is on
 * (Apps Script then stays quiet, NotifyClaim.gs) it is stored waiting, for the
 * router. A resend or a merge never changes notified (no second notification). The Cairo
 * wall-clock text is always made here from `at`: a Sheet hands its own column
 * back as a Date, so the value Apps Script sends is never trusted.
 */
export function forwardedStmt(db, r) {
  let changes = r.changes == null ? null : JSON.stringify(r.changes);
  if (changes && changes.length > 1024) changes = null;
  return db.prepare('INSERT INTO activity (id, at, cairo, actor, actor_name, action, entity_type, entity_id, entity_title, summary, changes, ref, count, notified, device, severity, source) ' +
    // notified: 1 while the router is off (Apps Script pushes itself), 0 once it is on (the router sends it)
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT CASE WHEN value = '1' THEN 0 ELSE 1 END FROM settings WHERE key = 'NOTIFY_ROUTER'), 1), ?, ?, 'apps-script') " +
    'ON CONFLICT(id) DO UPDATE SET at = excluded.at, cairo = excluded.cairo, actor_name = excluded.actor_name, action = excluded.action, ' +
    'entity_title = excluded.entity_title, summary = excluded.summary, changes = excluded.changes, ref = excluded.ref, count = excluded.count, ' +
    "device = excluded.device, severity = excluded.severity WHERE activity.source = 'apps-script'").bind(
    r.id, r.at, cairoText(r.at), clip(r.actor, 200), clip(r.actorName, 120), clip(r.action, 60), clip(r.type, 40), clip(r.entityId, 80),
    clip(r.title, 200), clip(r.summary, 300), changes, clip(r.ref, 120), Math.max(1, Math.min(10000, Math.floor(Number(r.count)) || 1)), clip(r.device, 40),
    SEVERITY.has(r.severity) ? r.severity : 'routine'
  );
}
