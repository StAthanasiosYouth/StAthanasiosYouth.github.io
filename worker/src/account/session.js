/*
 * Youth account sessions (docs/YOUTH-ACCOUNTS-PLAN.md §8.5): revocable bearer
 * tokens (the site and the API are on different origins, so no cookies).
 * device = 30 days sliding, shared = 12 hours fixed. A password change raises
 * pw_version, which ends every session bound to the old one.
 */

import { ApiError } from '../lib/http.js';
import { retry } from '../lib/db.js';
import { randomId } from '../lib/hash.js';
import { generateToken, tokenHash } from './secret.js';
import { deviceLabel } from './model.js';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const SLIDE_EVERY_MS = HOUR;   // one write an hour at most, per session

const sessionMs = (settings, kind) => (kind === 'shared'
  ? Math.max(1, Number(settings.session_hours_shared) || 12) * HOUR
  : Math.max(1, Number(settings.session_days_device) || 30) * DAY);

/* → { token, stmt, kind, expiresAt }: the row goes in the caller's batch */
export async function newSession(ctx, account, kind, settings, now = Date.now()) {
  const token = generateToken();
  const expiresAt = now + sessionMs(settings, kind);
  const stmt = ctx.env.DB.prepare('INSERT INTO account_sessions (id, participant_id, token_hash, pw_version, kind, created_at, last_seen, expires_at, device) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(randomId('ses-', 8), account.id, await tokenHash(token), account.pw_version, kind, now, now, expiresAt, deviceLabel(ctx.request.headers.get('user-agent')));
  return { token, stmt, kind, expiresAt };
}

const bearer = request => {
  const m = /^Bearer (as1\.[A-Za-z0-9_-]{20,80})$/.exec(request.headers.get('authorization') || '');
  return m ? m[1] : '';
};

/* the signed-in account, or throws `session`. → { session, account } */
export async function requireAccount(ctx, settings, now = Date.now()) {
  const token = bearer(ctx.request);
  if (!token) throw new ApiError('session');
  const db = ctx.env.DB;
  const hash = await tokenHash(token);
  const row = await retry(() => db.prepare('SELECT * FROM account_sessions WHERE token_hash = ?').bind(hash).first());
  if (!row || row.revoked_at || row.expires_at <= now) throw new ApiError('session');
  const account = await retry(() => db.prepare('SELECT * FROM participants WHERE id = ?').bind(row.participant_id).first());
  if (!account || account.status !== 'active' || account.pw_version !== row.pw_version) throw new ApiError('session');
  if (row.kind === 'device' && now - row.last_seen > SLIDE_EVERY_MS) {
    ctx.defer(retry(() => db.prepare('UPDATE account_sessions SET last_seen = ?, expires_at = ? WHERE id = ?').bind(now, now + sessionMs(settings, 'device'), row.id).run()));
  }
  return { session: row, account };
}

/* the token's session, ended; quiet when it is already gone. → the row or null */
export async function endSession(ctx, now = Date.now()) {
  const token = bearer(ctx.request);
  if (!token) return null;
  const db = ctx.env.DB;
  const hash = await tokenHash(token);
  return retry(() => db.prepare('UPDATE account_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL RETURNING id, participant_id').bind(now, hash).first());
}

export const revokeAllStmt = (db, participantId, now = Date.now()) =>
  db.prepare('UPDATE account_sessions SET revoked_at = ? WHERE participant_id = ? AND revoked_at IS NULL').bind(now, participantId);

const RETENTION = { pendingMs: 30 * 60000, otpMs: DAY, outboxMs: 30 * DAY, sessionsMs: 30 * DAY, ipHashMs: 90 * DAY };

/* hourly: unconfirmed registrations hold private data for 30 minutes at most (§6.7) */
export const pendingSweepStmt = (db, now = Date.now()) =>
  db.prepare('DELETE FROM pending_registrations WHERE created_at < ?').bind(now - RETENTION.pendingMs);

/* daily (scheduled.js, §22) */
export const accountSweepStmts = (db, now = Date.now()) => [
  pendingSweepStmt(db, now),
  db.prepare('DELETE FROM otp_codes WHERE expires_at < ?').bind(now - RETENTION.otpMs),
  db.prepare('DELETE FROM member_outbox WHERE created_ms < ?').bind(now - RETENTION.outboxMs),
  db.prepare('DELETE FROM account_sessions WHERE expires_at < ?').bind(now - RETENTION.sessionsMs),
  db.prepare('UPDATE participants SET reg_ip_hash = NULL WHERE reg_ip_hash IS NOT NULL AND created_at < ?').bind(now - RETENTION.ipHashMs)
];
