-- Phase 1.5 steps 5–6: the notification router, the push claim and the Gmail quota (forward-only, additive)
-- docs/BOOKING-PHASE1-COMPLETION-PLAN.md §4.4, §8. 0010 / 0011 stay reserved for steps 10 / 11.

-- the level the router gave the row (critical | important | routine) and the push claim it is out on
ALTER TABLE notify_outbox ADD COLUMN level TEXT NOT NULL DEFAULT 'routine';
ALTER TABLE notify_outbox ADD COLUMN claim_id TEXT;
CREATE INDEX notify_outbox_recipient ON notify_outbox (recipient, channel, status);

-- emails per Cairo day: the shared target, the critical and (Phase 5A) verification-code reserves
CREATE TABLE notify_quota (
  day       TEXT PRIMARY KEY,            -- YYYY-MM-DD (Cairo)
  total     INTEGER NOT NULL DEFAULT 0,
  critical  INTEGER NOT NULL DEFAULT 0,
  otp       INTEGER NOT NULL DEFAULT 0
);

-- §8 switches: both off until the owner turns them on («إعدادات الإشعارات»)
INSERT OR IGNORE INTO settings (key, value, updated_at, updated_by) VALUES
  ('NOTIFY_ROUTER', '0', 0, 'migration'),
  ('NOTIFY_EMAIL', '0', 0, 'migration'),
  ('NOTIFY_SUMMARY_TIME', '21:00', 0, 'migration'),
  ('MAIL_DAILY_TARGET', '400', 0, 'migration'),
  ('MAIL_ADMIN_BUDGET', '150', 0, 'migration'),
  ('MAIL_RESERVE_CRITICAL', '50', 0, 'migration'),
  ('MAIL_RESERVE_OTP', '50', 0, 'migration');
