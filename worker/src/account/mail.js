/*
 * The code emails (docs/MEMBER-NOTIFICATIONS-PLAN.md §2, §5, §9): one
 * member_outbox row (no body, no code), sent at once and outside the reply.
 * Never the admin router, and never on the minute cron: a code that waits is
 * useless, so a failed send is only marked, and the page offers «ابعت تاني».
 *
 * STAGING ONLY, the checks' inbox: an @staging.invalid address sends nothing
 * and the reply carries the code. Production can never reach that branch.
 */

import { retry } from '../lib/db.js';
import { randomId } from '../lib/hash.js';
import { gmailConfigured, sendMail } from '../notify/gmail.js';
import { allowed, budget, quotaOf, hourKey, countStmt } from '../notify/email.js';
import { otpEmail } from '../notify/templates.js';

export const CODE_MINUTES = 10;
const OUTBOX_TTL_MS = 3 * 60000;

export function isTestInbox(env, email) {
  return env.ENVIRONMENT === 'staging' && /@staging\.invalid$/i.test(String(email));
}

/* §9: can a code go out now? Asked BEFORE anything is written */
export async function codesReady(env, settings, now = Date.now()) {
  if (settings.OTP_EMAIL !== '1' || !gmailConfigured(env)) return false;
  let health = null;
  try { health = settings.GMAIL_HEALTH ? JSON.parse(settings.GMAIL_HEALTH) : null; } catch { health = null; }
  if (health && health.ok === false) return false;
  return allowed('otp', await quotaOf(env.DB, now), budget(settings));
}

/* the outbox row of one code: in the caller's batch, with the state it reports */
export function codeRow(db, { kind, participantId = null, dedupeKey, now = Date.now() }) {
  const id = randomId('mo-', 8);
  return {
    id,
    stmt: db.prepare("INSERT INTO member_outbox (id, participant_id, kind, tier, class, dedupe_key, status, expires_ms, created_ms) VALUES (?, ?, ?, 0, 'otp', ?, 'queued', ?, ?)")
      .bind(id, participantId, kind, dedupeKey, now + OUTBOX_TTL_MS, now)
  };
}

/* the send itself, after the reply (ctx.defer): the row says how it went */
export function sendCode(ctx, { to, code, purpose, outboxId, support = null, now = Date.now() }) {
  const db = ctx.env.DB;
  ctx.defer((async () => {
    if (isTestInbox(ctx.env, to)) {
      await retry(() => db.prepare("UPDATE member_outbox SET status = 'sent', sent_ms = ?, attempts = 1, error = 'test inbox' WHERE id = ?").bind(now, outboxId).run());
      return;
    }
    try {
      await sendMail(ctx.env, { to, ...otpEmail({ code, minutes: CODE_MINUTES, purpose, support }), now });
      await retry(() => db.batch([
        db.prepare("UPDATE member_outbox SET status = 'sent', sent_ms = ?, attempts = 1 WHERE id = ?").bind(now, outboxId),
        countStmt(db, hourKey(now), 'otp')
      ]));
    } catch (err) {
      await retry(() => db.prepare("UPDATE member_outbox SET status = 'failed', attempts = 1, error = ? WHERE id = ?").bind(String(err.message || err).slice(0, 200), outboxId).run());
    }
  })());
}
