-- Phase 5A, batch 1 (docs/PHASE5-PLAN.md P5-1): youth accounts (forward-only, additive).
-- Schema: docs/YOUTH-ACCOUNTS-PLAN.md rev. 5 §20; the member outbox: docs/MEMBER-NOTIFICATIONS-PLAN.md §2.
-- Dormant: nothing answers until accounts_mode = 'on'; no code email until OTP_EMAIL = '1'.

-- the account IS the participant row: one identity, no codes
CREATE TABLE participants (
  id                   TEXT PRIMARY KEY,            -- p-xxxxxxxx
  name                 TEXT NOT NULL,
  name_norm            TEXT NOT NULL,
  email                TEXT NOT NULL,               -- as typed (trimmed): the address mail goes to
  email_canon          TEXT NOT NULL,               -- lower case, gmail dots/+tag removed… (account/model.js)
  email_verified_at    INTEGER,
  email_source         TEXT NOT NULL,               -- self | admin
  email_verified_via   TEXT,                        -- otp | admin; NULL = not verified
  phone                TEXT NOT NULL,               -- 01XXXXXXXXX
  phone_norm           TEXT NOT NULL,               -- 1XXXXXXXXX
  birth_date           TEXT NOT NULL,               -- YYYY-MM-DD, locked (admin corrections only)
  eligibility_override TEXT,                        -- NULL | guest | eligible
  grp                  TEXT,
  church               TEXT,
  servant              TEXT,
  notes                TEXT,
  status               TEXT NOT NULL DEFAULT 'active', -- active | blocked | deleted
  blocked_at           INTEGER,
  blocked_reason       TEXT,
  pw_hash              TEXT NOT NULL,               -- HMAC-SHA256(PW_PEPPER, normalized password)
  pw_enc               TEXT NOT NULL,               -- AES-256-GCM(PW_KEY), AD = id ‖ pw_version; always written with pw_hash
  pw_version           INTEGER NOT NULL DEFAULT 1,
  pw_issued_at         INTEGER NOT NULL,
  pw_issued_by         TEXT NOT NULL,               -- self | reset | an admin's email
  created_via          TEXT NOT NULL,               -- self | admin | import
  reg_ip_hash          TEXT,                        -- salted; blanked after 90 days
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  version              INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX participants_email ON participants (email_canon);
CREATE UNIQUE INDEX participants_phone ON participants (phone_norm);

CREATE TABLE account_sessions (
  id             TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL,
  token_hash     TEXT NOT NULL UNIQUE,              -- SHA-256 of the bearer token; the token itself is never stored
  pw_version     INTEGER NOT NULL,
  kind           TEXT NOT NULL,                     -- device (30 d sliding) | shared (12 h)
  created_at     INTEGER NOT NULL,
  last_seen      INTEGER NOT NULL,
  expires_at     INTEGER NOT NULL,
  revoked_at     INTEGER,
  device         TEXT                               -- 'Android Chrome' etc.; no raw user agent
);
CREATE INDEX account_sessions_p ON account_sessions (participant_id);

-- self-registration before the OTP: no account exists yet, so nobody reserves an email or a phone they don't own
CREATE TABLE pending_registrations (
  id              TEXT PRIMARY KEY,
  email_canon     TEXT NOT NULL UNIQUE,
  data            TEXT NOT NULL,                    -- the validated form; purged after 30 minutes
  code_hash       TEXT NOT NULL,
  code_expires_at INTEGER NOT NULL,
  tries           INTEGER NOT NULL DEFAULT 0,
  sends           INTEGER NOT NULL DEFAULT 1,
  last_sent_at    INTEGER NOT NULL,
  ip_hash         TEXT,
  created_at      INTEGER NOT NULL
);

-- forgot password (verified emails only); a new code replaces the old one
CREATE TABLE otp_codes (
  participant_id TEXT NOT NULL,
  purpose        TEXT NOT NULL,                     -- recover
  code_hash      TEXT NOT NULL,
  expires_at     INTEGER NOT NULL,
  tries          INTEGER NOT NULL DEFAULT 0,
  used_at        INTEGER,
  created_at     INTEGER NOT NULL,
  PRIMARY KEY (participant_id, purpose)
);

-- every member email (separate from the admin notify_outbox). No bodies, codes or passwords, ever.
CREATE TABLE member_outbox (
  id             TEXT PRIMARY KEY,
  participant_id TEXT,
  kind           TEXT NOT NULL,                     -- otp_register | otp_recover | acct.* | book.* | pay.* | res.* | store.*
  entity_type    TEXT,
  entity_id      TEXT,
  entity_version INTEGER,
  tier           INTEGER NOT NULL,                  -- 0..3
  class          TEXT NOT NULL,                     -- otp | member_tx | member_bulk
  dedupe_key     TEXT NOT NULL UNIQUE,
  status         TEXT NOT NULL,                     -- queued | sent | failed | dead | deferred | expired | superseded | suppressed
  attempts       INTEGER NOT NULL DEFAULT 0,
  next_ms        INTEGER,
  expires_ms     INTEGER,
  sent_ms        INTEGER,
  error          TEXT,
  created_ms     INTEGER NOT NULL
);
CREATE INDEX member_outbox_due ON member_outbox (status, next_ms);

CREATE TABLE member_prefs (
  participant_id TEXT NOT NULL,
  grp            TEXT NOT NULL,
  mode           TEXT NOT NULL,
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (participant_id, grp)
);

-- PRIVATE, admin only; never a password
CREATE TABLE participant_audit (
  id             TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL,
  at             INTEGER NOT NULL,
  actor          TEXT NOT NULL,
  action         TEXT NOT NULL,
  field          TEXT,
  old_value      TEXT,
  new_value      TEXT,
  reason         TEXT,
  check_method   TEXT
);
CREATE INDEX participant_audit_p ON participant_audit (participant_id, at);

INSERT OR IGNORE INTO settings (key, value, updated_at, updated_by) VALUES
  ('accounts_mode', 'off', 0, 'migration'),
  ('OTP_EMAIL', '0', 0, 'migration'),
  ('MEMBER_EMAIL', '0', 0, 'migration'),
  ('age_min', '18', 0, 'migration'),
  ('age_max', '30', 0, 'migration'),
  ('age_warn_days', '60', 0, 'migration'),
  ('session_days_device', '30', 0, 'migration'),
  ('session_hours_shared', '12', 0, 'migration'),
  ('discovery_daily_cap', '400', 0, 'migration');
