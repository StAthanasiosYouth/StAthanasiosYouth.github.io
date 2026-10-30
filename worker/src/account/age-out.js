/*
 * «نقطك هتتجمد قريب» (docs/MEMBER-NOTIFICATIONS-PLAN.md §4.1): once a day, one email per person and date, to
 * eligible accounts that hold points and leave the Admin range within its warning days. Never an age.
 */

import { retry } from '../lib/db.js';
import { memberEmailStmt } from '../notify/member.js';
import { eligibility, rulesFrom } from './model.js';

export async function ageOutNotices(env, now = Date.now()) {
  const db = env.DB;
  const settings = Object.fromEntries((await retry(() => db.prepare("SELECT key, value FROM settings WHERE key IN ('MEMBER_EMAIL', 'accounts_mode', 'age_min', 'age_max', 'age_warn_days')").all())).results.map(r => [r.key, r.value]));
  if (settings.MEMBER_EMAIL !== '1' || settings.accounts_mode !== 'on') return 0;
  const rules = rulesFrom(settings);
  const people = (await retry(() => db.prepare(`SELECT p.id, p.birth_date, p.status, p.eligibility_override FROM participants p
    WHERE p.status = 'active' AND p.email_verified_at IS NOT NULL
      AND (SELECT COALESCE(SUM(l.amount), 0) FROM points_ledger l WHERE l.participant_id = p.id AND l.season_id = (SELECT id FROM seasons WHERE status = 'active')) > 0`).all())).results;
  const stmts = [];
  for (const p of people) {
    const e = eligibility(p, rules, now);
    if (e.state === 'eligible' && e.soon && e.leavesAt) stmts.push(memberEmailStmt(db, { kind: 'acct.age', participantId: p.id, entityType: 'date', entityId: e.leavesAt, dedupeKey: `acct:age:${p.id}:${e.leavesAt}`, now, expires: Date.parse(e.leavesAt + 'T00:00:00Z') }));
  }
  if (stmts.length) await retry(() => db.batch(stmts.slice(0, 100)));
  return Math.min(stmts.length, 100);
}
