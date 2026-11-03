-- Phase 6 Step 4b (docs/PHASE6-PLAN.md): the Worker's push sender. Additive.
-- Nothing writes here until settings.PUSH_SENDER = 'worker' and FCM_SERVICE_ACCOUNT is set.

-- One send: a bell item to the visitors, or one outbox row to one admin's devices (Push.gs PushLog).
CREATE TABLE push_sends (
  id          TEXT PRIMARY KEY,                -- 'ps-…'
  send_key    TEXT UNIQUE,                     -- the admin's request: a retry or a double click gets the first result
  audience    TEXT NOT NULL CHECK (audience IN ('public', 'admin')),
  ref         TEXT NOT NULL,                   -- public: the bell item id · admin: the notify_outbox row id
  status      TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed')),
  by          TEXT NOT NULL DEFAULT '',        -- the admin who sent it, '' for the schedule or the router
  started_ms  INTEGER NOT NULL,
  finished_ms INTEGER,
  targets     INTEGER NOT NULL DEFAULT 0,      -- devices when it started
  parts       INTEGER NOT NULL DEFAULT 0,      -- queue messages, ≤ 45 devices each (one more per retry round)
  parts_done  INTEGER NOT NULL DEFAULT 0,
  sent        INTEGER NOT NULL DEFAULT 0,
  failed      INTEGER NOT NULL DEFAULT 0,
  removed     INTEGER NOT NULL DEFAULT 0,
  message     TEXT NOT NULL,                   -- JSON: the one message model (push/fcm.js), never a token
  ttl         INTEGER NOT NULL,
  error       TEXT
);
CREATE INDEX push_sends_ref ON push_sends (audience, ref);
CREATE INDEX push_sends_started ON push_sends (started_ms);

-- A queue message can arrive twice: its part is taken once (a stuck one is taken again after its lease).
CREATE TABLE push_parts (
  send_id     TEXT NOT NULL,
  part        TEXT NOT NULL,
  taken_ms    INTEGER NOT NULL,
  done_ms     INTEGER,
  PRIMARY KEY (send_id, part)
);
