-- «خبزنا اليومي» W3 (docs/daily-bread/PLAN.md §3 W3, STUDY.md §7). Additive only: new tables, one nullable column,
-- settings rows. Nothing reads them while BREAD_MODULE = '0' (public routes answer `disabled`) and BREAD_PUSH = '0'
-- (the minute cron sends nothing). Rollback: the switches; the tables stay (forward-only, nothing depends on them).

-- one program = N days, one topic a day; at most one is live on a Cairo day (src/bread/model.js currentOf)
CREATE TABLE bread_programs (
  id            TEXT PRIMARY KEY,                 -- brd-<hex>
  name          TEXT NOT NULL,
  days          INTEGER NOT NULL CHECK (days BETWEEN 1 AND 120),
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'scheduled', 'stopped')),
  starts_on     TEXT,                             -- Cairo date YYYY-MM-DD (scheduled / stopped)
  ends_on       TEXT,                             -- the last day (stop: the day before the stop, or the stop day's eve)
  purge_on      TEXT,                             -- ends_on + 90: topics and reflections go (decision 9)
  created_by    TEXT NOT NULL,
  created_ms    INTEGER NOT NULL,
  activated_ms  INTEGER,
  activated_by  TEXT,
  stopped_ms    INTEGER,
  stopped_by    TEXT,
  purged_ms     INTEGER                           -- content gone: the name and the numbers stay (decision 14)
);
CREATE INDEX bread_programs_dates ON bread_programs (status, starts_on);

-- the program's days as uploaded (the browser resolved the Bible text); `body` is the published file, `hash` its sha-256
CREATE TABLE bread_topics (
  program_id    TEXT NOT NULL,
  n             INTEGER NOT NULL,                 -- 1 … days (the Excel row's day)
  title         TEXT NOT NULL,
  verse_ref     TEXT NOT NULL,
  verse_text    TEXT NOT NULL,
  verse_note    TEXT,                             -- «(مزمور ٢٢ في الأجبية)» (decision 6)
  reading_ref   TEXT NOT NULL,
  reading_json  TEXT NOT NULL,                    -- [{ book, chapter, verses: [[v, text], …] }, …]
  meditation    TEXT NOT NULL,
  question      TEXT,
  body          TEXT NOT NULL,
  hash          TEXT NOT NULL,
  PRIMARY KEY (program_id, n)
) WITHOUT ROWID;

-- an account keeps the device's seed it first came with in a program (STUDY §7.2): its order never changes mid-program
CREATE TABLE bread_members (
  participant_id TEXT NOT NULL,
  program_id     TEXT NOT NULL,
  seed           TEXT NOT NULL,
  created_ms     INTEGER NOT NULL,
  PRIMARY KEY (participant_id, program_id)
) WITHOUT ROWID;

-- «فكّرني»: up to bread_max_slots Cairo minutes a device; off = no rows. The seed: the device's own order
CREATE TABLE bread_slots (
  device_id   TEXT NOT NULL,                      -- push_devices.id (public)
  minute      INTEGER NOT NULL CHECK (minute BETWEEN 0 AND 1439),
  seed        TEXT NOT NULL,
  created_ms  INTEGER NOT NULL,
  PRIMARY KEY (device_id, minute)
) WITHOUT ROWID;
CREATE INDEX bread_slots_minute ON bread_slots (minute);

-- one reflection a person a topic; edit / delete within 20 minutes of created_ms (enforced in src/bread/public.js)
CREATE TABLE bread_reflections (
  id             TEXT PRIMARY KEY,                -- rfl-<hex>
  participant_id TEXT NOT NULL,
  program_id     TEXT NOT NULL,
  n              INTEGER NOT NULL,
  day            TEXT NOT NULL,                   -- the Cairo day it was written
  text           TEXT NOT NULL,
  state          TEXT NOT NULL,                   -- eligible | guest at the time (the admin's view)
  created_ms     INTEGER NOT NULL,
  edited_ms      INTEGER,
  deleted_ms     INTEGER,
  UNIQUE (participant_id, program_id, n)
);
CREATE INDEX bread_reflections_program ON bread_reflections (program_id, created_ms);

-- one row per device hash, day and kind: an open counted once (STUDY §4.4). Kept 30 days, then only bread_daily
CREATE TABLE bread_opens (
  day          TEXT NOT NULL,
  device_hash  TEXT NOT NULL,                     -- salted pseudonym of the device's random id, never the id
  kind         TEXT NOT NULL CHECK (kind IN ('open', 'read')),
  program_id   TEXT NOT NULL,
  PRIMARY KEY (day, device_hash, kind)
) WITHOUT ROWID;

-- the totals that stay (aggregate only, no person)
CREATE TABLE bread_daily (
  day          TEXT NOT NULL,
  program_id   TEXT NOT NULL,
  opens        INTEGER NOT NULL DEFAULT 0,
  reads        INTEGER NOT NULL DEFAULT 0,
  sent         INTEGER NOT NULL DEFAULT 0,
  reflections  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, program_id)
) WITHOUT ROWID;

-- the section's own look (W1 decision, 2026-11-17): NULL = night (navy + paper), 'dawn'
ALTER TABLE participants ADD COLUMN bread_look TEXT;

INSERT INTO settings (key, value, updated_at, updated_by) VALUES
  ('BREAD_MODULE', '0', 0, 'migration'),
  ('BREAD_PUSH', '0', 0, 'migration'),
  ('BREAD_EMPTY_MUTED', '0', 0, 'migration'),
  ('bread_default_time', '08:00', 0, 'migration'),
  ('bread_max_slots', '3', 0, 'migration')
ON CONFLICT(key) DO NOTHING;
