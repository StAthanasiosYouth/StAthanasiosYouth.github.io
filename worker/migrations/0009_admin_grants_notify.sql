-- Phase 1.5 step 1: admin grants + activity columns + notification tables (forward-only, additive)
-- docs/BOOKING-PHASE1-COMPLETION-PLAN.md §4.3 (roles & permissions), §4.4 (notifications), §8 (rollback flags).
-- D1 owns admins + grants from Phase 1.5. Enforcement is behind the PERMS_ENFORCE switch (settings), off here.

-- The admin's linked servant: the meaning of scope 'own' (src/lib/perms.js).
ALTER TABLE admins ADD COLUMN servant_id TEXT;

-- Explicit grants `module.action` (catalog: src/lib/perms.js PERMS). One row per admin per permission.
CREATE TABLE admin_grants (
  email       TEXT NOT NULL,                   -- admins.email (lower-case)
  perm        TEXT NOT NULL,                   -- 'bookings.approve', ...
  scope       TEXT NOT NULL DEFAULT 'all' CHECK (scope IN ('all', 'own')),
  granted_by  TEXT NOT NULL,
  granted_at  INTEGER NOT NULL,
  PRIMARY KEY (email, perm)
);
CREATE INDEX admin_grants_perm ON admin_grants (perm);

-- Existing active admins start with full grants except the Primary-Admin defaults
-- (accounts.manage, notifications.manage, participants.manage). The Primary Admin
-- gets every permission. Keep this list equal to src/lib/perms.js (perms.test.mjs checks it).
WITH catalog(perm) AS (VALUES
  ('content.view'), ('content.edit'), ('content.delete'),
  ('publish.publish'),
  ('events.view'), ('events.add'), ('events.edit'), ('events.delete'),
  ('bookings.view'), ('bookings.create_cash'), ('bookings.edit'), ('bookings.approve'), ('bookings.manage'),
  ('finance.view'), ('finance.manage'),
  ('exports.export'), ('exports.export_pii'),
  ('competitions.view'), ('competitions.add'), ('competitions.edit'), ('competitions.delete'), ('competitions.approve'),
  ('store.view'), ('store.add'), ('store.edit'), ('store.delete'), ('store.approve'),
  ('points.view'), ('points.edit'), ('points.approve'),
  ('participants.view'), ('participants.add'), ('participants.edit'), ('participants.manage'),
  ('media.view'), ('media.add'), ('media.delete'),
  ('push.view'), ('push.manage'),
  ('accounts.view'), ('accounts.manage'),
  ('activity.view'),
  ('notifications.view'), ('notifications.manage'),
  ('system.view'), ('system.manage')
)
INSERT INTO admin_grants (email, perm, scope, granted_by, granted_at)
SELECT a.email, c.perm, 'all', 'migration', 0
FROM admins a CROSS JOIN catalog c
WHERE a.active = 1
  AND (a.role = 'primary' OR c.perm NOT IN ('accounts.manage', 'notifications.manage', 'participants.manage'));

-- Unified activity log: level + origin. `notified` already exists (0001).
ALTER TABLE activity ADD COLUMN severity TEXT NOT NULL DEFAULT 'routine';   -- 'critical' | 'important' | 'routine'
ALTER TABLE activity ADD COLUMN source TEXT NOT NULL DEFAULT 'worker';      -- 'worker' | 'apps-script' | 'system'
-- history is never notified: only rows written after this migration reach the router
UPDATE activity SET notified = 1 WHERE notified = 0;
CREATE INDEX activity_notified ON activity (notified, at);

-- Per activity type (Primary Admin only): email off / immediate / daily summary, push on/off,
-- recipients JSON (include/exclude named admins on top of "everyone holding the permission").
CREATE TABLE notify_settings (
  type        TEXT PRIMARY KEY,
  email_mode  TEXT NOT NULL DEFAULT 'off' CHECK (email_mode IN ('off', 'immediate', 'summary')),
  push        INTEGER NOT NULL DEFAULT 1,
  recipients  TEXT,                            -- JSON {include: [...], exclude: [...]}
  locked      INTEGER NOT NULL DEFAULT 0,      -- mandatory: admins can't opt out
  updated_at  INTEGER NOT NULL,
  updated_by  TEXT
);

-- Each admin's own overrides («تنبيهاتي»), within what notify_settings allows.
CREATE TABLE notify_prefs (
  email       TEXT NOT NULL,
  type        TEXT NOT NULL,
  channel     TEXT NOT NULL CHECK (channel IN ('email', 'push')),
  mode        TEXT NOT NULL CHECK (mode IN ('off', 'immediate', 'summary')),
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (email, type, channel)
);

-- Delivery queue. No bodies: they are rebuilt from activity rows at send time. Kept 30 days.
CREATE TABLE notify_outbox (
  id            TEXT PRIMARY KEY,
  dedupe_key    TEXT NOT NULL UNIQUE,          -- kind:entity:recipient:window
  recipient     TEXT NOT NULL,                 -- admin email
  channel       TEXT NOT NULL CHECK (channel IN ('email', 'push')),
  kind          TEXT NOT NULL,
  activity_ids  TEXT NOT NULL,                 -- JSON array
  status        TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'deferred', 'deferred_quota', 'failed', 'dead', 'dismissed')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  next_ms       INTEGER,
  sent_ms       INTEGER,
  error         TEXT,
  created_ms    INTEGER NOT NULL
);
CREATE INDEX notify_outbox_due ON notify_outbox (status, next_ms);
CREATE INDEX notify_outbox_created ON notify_outbox (created_ms);

-- §8 rollback switch: '0' = every active admin keeps full access except the Primary-Admin defaults.
INSERT OR IGNORE INTO settings (key, value, updated_at, updated_by) VALUES ('PERMS_ENFORCE', '0', 0, 'migration');
