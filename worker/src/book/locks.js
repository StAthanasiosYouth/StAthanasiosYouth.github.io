/*
 * Edit locks on bookings (docs/EVENTS.md §10, worker/BOOKING-API.md «Edit locks»).
 *
 * The open booking sheet holds a lease on its booking: taken when the sheet
 * opens, renewed every ~30 s, given back when it closes, gone LOCK_TTL_MS
 * after the last renewal (a closed tab, a dead phone). The holder is one
 * admin PAGE SESSION (`x-edit-session`, a random id per admin page load), so
 * the same admin on two phones is two holders.
 *
 * While a lease lives, every booking write from anyone else is refused with
 * `locked` (+ who and since when) BEFORE anything is written. Writes from a
 * client without a session header are treated as "someone else". When no
 * lease lives, writes need none: the booking `version` keeps guarding
 * every write either way (a lock is about telling admins early, the version
 * is what makes a lost race write nothing).
 *
 * The bulk «cancel the whole event» move ignores leases (it is one admin
 * decision over many bookings); an open sheet then gets `conflict` and
 * re-reads.
 */

import { ApiError } from '../lib/http.js';
import { retry } from '../lib/db.js';

export const LOCK_TTL_MS = 90 * 1000;
export const LOCK_RENEW_MS = 30 * 1000;
const SID = /^[A-Za-z0-9_-]{8,64}$/;

export function editSession(ctx) {
  const sid = String(ctx.request.headers.get('x-edit-session') || '');
  return SID.test(sid) ? sid : '';
}

function holderOf(row, now) {
  return { name: row.name || '', since: Math.max(0, Math.round((now - row.since_ms) / 1000)) };
}

async function liveLock(env, kind, id, now) {
  return retry(() => env.DB.prepare('SELECT * FROM edit_locks WHERE kind = ? AND id = ? AND expires_ms >= ?').bind(kind, id, now).first());
}

/* what the booking detail shows: null, or { mine, holder } */
export async function lockInfo(ctx, id, now = Date.now()) {
  const row = await liveLock(ctx.env, 'booking', id, now);
  if (!row) return null;
  return { mine: row.sid === editSession(ctx), holder: holderOf(row, now) };
}

/* the guard every booking write calls first */
export async function assertUnlocked(ctx, id, now = Date.now()) {
  const row = await liveLock(ctx.env, 'booking', id, now);
  if (row && row.sid !== editSession(ctx)) throw new ApiError('locked', 'booking', { holder: holderOf(row, now) });
}

/*
 * POST /v1/admin/book/bookings/:id/lock → { granted, holder?, ttl }
 * Take or renew. Granted when free, expired, or already this session's.
 */
export async function lockTake(ctx, id, now = Date.now()) {
  const sid = editSession(ctx);
  if (!sid) throw new ApiError('bad', 'x-edit-session');
  const db = ctx.env.DB;
  await retry(() => db.prepare(`INSERT INTO edit_locks (kind, id, email, name, sid, since_ms, expires_ms) VALUES ('booking', ?, ?, ?, ?, ?, ?)
      ON CONFLICT(kind, id) DO UPDATE SET email = excluded.email, name = excluded.name, sid = excluded.sid,
        since_ms = CASE WHEN edit_locks.sid = excluded.sid THEN edit_locks.since_ms ELSE excluded.since_ms END,
        expires_ms = excluded.expires_ms
      WHERE edit_locks.sid = excluded.sid OR edit_locks.expires_ms < ?`)
    .bind(id, ctx.actor.email, String(ctx.actor.name || '').slice(0, 80), sid, now, now + LOCK_TTL_MS, now).run());
  const row = await liveLock(ctx.env, 'booking', id, now);
  if (row && row.sid === sid) return { granted: true, ttl: LOCK_TTL_MS, renew: LOCK_RENEW_MS };
  return { granted: false, holder: row ? holderOf(row, now) : null, ttl: LOCK_TTL_MS, renew: LOCK_RENEW_MS };
}

/* DELETE /v1/admin/book/bookings/:id/lock → { released } (only this session's own) */
export async function lockDrop(ctx, id) {
  const sid = editSession(ctx);
  if (!sid) return { released: false };
  const r = await retry(() => ctx.env.DB.prepare("DELETE FROM edit_locks WHERE kind = 'booking' AND id = ? AND sid = ?").bind(id, sid).run());
  return { released: r.meta.changes === 1 };
}
