-- Phase 3 — admin platform (docs/ADMIN-PLATFORM-PLAN.md): sessions, presence,
-- edit locks, trusted devices move from Apps Script (CacheService / Script
-- Properties) to D1. Additive only. Off until settings.ADMIN_PLATFORM = '1'.

-- One live session per admin account (apps-script/Presence.gs, ported).
-- The row is also the admin's presence: where they are, what they edit.
CREATE TABLE admin_sessions (
  email       TEXT PRIMARY KEY,           -- one row per account
  sid         TEXT NOT NULL UNIQUE,       -- opaque session id (also inside the panel token)
  tab         TEXT NOT NULL DEFAULT '',   -- the page load that holds it
  device      TEXT NOT NULL DEFAULT '',   -- coarse label («موبايل أندرويد – Chrome»)
  device_id   TEXT,                       -- the trusted device that opened it, if any
  via         TEXT NOT NULL DEFAULT 'google',   -- 'google' | 'device'
  since_ms    INTEGER NOT NULL,
  seen_ms     INTEGER NOT NULL,           -- last heartbeat
  parked_ms   INTEGER,                    -- its page left (reload / closed tab)
  hidden_ms   INTEGER,                    -- the panel is out of sight
  beats       INTEGER NOT NULL DEFAULT 0, -- 0 = the panel never drew (no takeover question)
  area        TEXT NOT NULL DEFAULT '',
  view        TEXT NOT NULL DEFAULT '',
  item        TEXT                        -- JSON { kind, id, label } | NULL
);

-- sids that were taken over: a late call from that tab hears «session_replaced», not «expired»
CREATE TABLE admin_sessions_gone (
  sid    TEXT PRIMARY KEY,
  at_ms  INTEGER NOT NULL
);
CREATE INDEX admin_sessions_gone_at ON admin_sessions_gone (at_ms);

-- Panel edit locks reuse edit_locks (0004): kind = the lock kind ('news', 'page', …),
-- id = its key, sid = the admin session. Booking leases keep kind = 'booking'.

-- «خليك داخل» on the installed admin app (apps-script/AdminDevice.gs, ported).
-- The device secret is AES-GCM encrypted with the Worker secret DEVICE_KEY.
CREATE TABLE admin_devices (
  id          TEXT PRIMARY KEY,           -- 24 hex
  email       TEXT NOT NULL,
  secret_enc  TEXT NOT NULL,              -- base64(iv || ciphertext)
  label       TEXT NOT NULL DEFAULT '',
  created_ms  INTEGER NOT NULL,
  until_ms    INTEGER NOT NULL,           -- hard end: 30 days after the Google sign-in
  last_ms     INTEGER,
  fails       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX admin_devices_email ON admin_devices (email);

-- one-time device sign-in nonces (replay guard), kept past the clock skew
CREATE TABLE admin_device_nonces (
  nonce   TEXT PRIMARY KEY,
  exp_ms  INTEGER NOT NULL
);
CREATE INDEX admin_device_nonces_exp ON admin_device_nonces (exp_ms);

-- the Phase 3 switch: '1' = the panel's sessions, presence, locks and devices are the Worker's
INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('ADMIN_PLATFORM', '0', 0, 'migration')
  ON CONFLICT(key) DO NOTHING;
