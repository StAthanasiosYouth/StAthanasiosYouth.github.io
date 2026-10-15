-- 0001 foundation: admins, audit, abuse protection, idempotency, request log, settings.
-- Applied with: npx wrangler d1 migrations apply <db> --remote   (see worker/README.md)
-- Forward-only. Never edit an applied migration; add a new numbered file instead.

-- Admin allowlist. The Google `sub` is bound on first sign-in so a recycled
-- email address can never inherit an admin seat.
CREATE TABLE admins (
  email       TEXT PRIMARY KEY,          -- lower-case
  google_sub  TEXT UNIQUE,
  name        TEXT,
  role        TEXT NOT NULL DEFAULT 'admin',   -- 'primary' | 'admin'
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER
);

-- Audit trail, same shape as the Apps Script Activity tab (Activity.gs) so the
-- two can be merged / exported. `changes` is short JSON with no private data.
CREATE TABLE activity (
  id            TEXT PRIMARY KEY,        -- act-<12 hex>
  at            INTEGER NOT NULL,        -- epoch ms
  cairo         TEXT NOT NULL,           -- YYYY-MM-DD HH:MM (Cairo wall clock)
  actor         TEXT NOT NULL,           -- admin email, or 'system' / 'public'
  actor_name    TEXT,
  action        TEXT NOT NULL,
  entity_type   TEXT,
  entity_id     TEXT,
  entity_title  TEXT,
  summary       TEXT,
  changes       TEXT,                    -- ≤ 1 KB JSON
  ref           TEXT,
  count         INTEGER NOT NULL DEFAULT 1,
  notified      INTEGER NOT NULL DEFAULT 0,
  device        TEXT
);
CREATE INDEX activity_at ON activity (at);
CREATE INDEX activity_entity ON activity (entity_type, entity_id, at);

-- Fixed-window counters for abuse protection. `key` never holds a raw IP or
-- email: it is a salted hash (lib/hash.js).
CREATE TABLE rate_limits (
  key     TEXT NOT NULL,
  window  INTEGER NOT NULL,              -- window start, epoch seconds
  count   INTEGER NOT NULL,
  PRIMARY KEY (key, window)
);

-- Idempotency: the same (scope, key) always gets the same answer.
CREATE TABLE idempotency (
  scope       TEXT NOT NULL,             -- route + actor
  key         TEXT NOT NULL,             -- client Idempotency-Key
  req_hash    TEXT NOT NULL,             -- sha-256 of the request body
  status      TEXT NOT NULL,             -- 'pending' | 'done'
  http_status INTEGER,
  response    TEXT,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (scope, key)
);
CREATE INDEX idempotency_created ON idempotency (created_at);

-- Errors and slow requests only (no bodies, no personal data).
CREATE TABLE api_log (
  id        TEXT PRIMARY KEY,
  at        INTEGER NOT NULL,
  rid       TEXT,
  method    TEXT,
  route     TEXT,
  status    INTEGER,
  ms        INTEGER,
  code      TEXT,
  colo      TEXT,
  actor     TEXT                         -- salted hash
);
CREATE INDEX api_log_at ON api_log (at);

-- Module switches and small settings (no secrets: those are Worker secrets).
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  updated_by  TEXT
);
INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('BOOKING_MODULE', '0', 0, 'migration');
