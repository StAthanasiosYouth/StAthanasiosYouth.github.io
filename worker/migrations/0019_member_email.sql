-- Phase 5A, batch 2 (docs/PHASE5-PLAN.md P5-4): the shared budget's counters per class and the
-- owner's reservations (docs/MEMBER-NOTIFICATIONS-PLAN.md §5, D4). Forward-only, additive.
-- A value someone already changed in «إعدادات الإشعارات» stays: only the old defaults move.

ALTER TABLE notify_quota ADD COLUMN admin INTEGER NOT NULL DEFAULT 0;        -- admin important + summaries
ALTER TABLE notify_quota ADD COLUMN member_tx INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notify_quota ADD COLUMN member_bulk INTEGER NOT NULL DEFAULT 0;

UPDATE settings SET value = '100', updated_by = 'migration' WHERE key = 'MAIL_RESERVE_OTP' AND value = '50';
UPDATE settings SET value = '120', updated_by = 'migration' WHERE key = 'MAIL_ADMIN_BUDGET' AND value = '150';

INSERT OR IGNORE INTO settings (key, value, updated_at, updated_by) VALUES
  ('MAIL_RESERVE_MEMBER', '100', 0, 'migration'),
  ('MAIL_BULK_PER_HOUR', '30', 0, 'migration');
