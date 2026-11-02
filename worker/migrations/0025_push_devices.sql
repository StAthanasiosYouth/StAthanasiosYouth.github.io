-- Phase 6 Step 4a (docs/PHASE6-PLAN.md, BACKEND-MIGRATION §22.2.4): one table for every device that gets push.
-- Additive. Nothing reads it until settings.PUSH_DEVICES = 'worker' and the site's config point here.
CREATE TABLE push_devices (
  id          TEXT PRIMARY KEY,                -- 'h' + 40 hex of the token's sha-256 (Push.gs pushHash_)
  token       TEXT NOT NULL,                   -- the FCM registration token
  audience    TEXT NOT NULL CHECK (audience IN ('public', 'admin')),   -- a send to one never reaches the other
  email       TEXT,                            -- admin: whose device, always the verified session's
  account_id  TEXT,                            -- public: the youth account, once linked
  platform    TEXT NOT NULL DEFAULT 'web' CHECK (platform IN ('web', 'android', 'ios')),   -- the kind of app (web today, native in Phase 9)
  os          TEXT NOT NULL DEFAULT 'other',   -- android | ios | desktop | other: what the panel counts
  app_version TEXT,
  device      TEXT,                            -- admin: the label in «أجهزتي»
  topics      TEXT NOT NULL DEFAULT '["announcements","events","competitions","reminders"]',
  created_ms  INTEGER NOT NULL,
  last_ms     INTEGER NOT NULL,
  fails       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX push_devices_audience ON push_devices (audience, last_ms);
CREATE INDEX push_devices_email ON push_devices (email) WHERE email IS NOT NULL;
CREATE INDEX push_devices_account ON push_devices (account_id) WHERE account_id IS NOT NULL;
