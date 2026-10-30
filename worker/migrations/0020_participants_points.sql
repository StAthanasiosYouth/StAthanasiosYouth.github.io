-- Phase 5A + 5B, batch 3 (docs/PHASE5-PLAN.md P5-5, P5-6): bookings linked to accounts, the points
-- ledger and seasons, event-change notices. Forward-only, additive. Nothing runs until accounts_mode = 'on'.

-- §18.1: the account a booking belongs to; its age snapshot stays as it was taken
ALTER TABLE bookings ADD COLUMN participant_id TEXT;
ALTER TABLE bookings ADD COLUMN dob_mismatch INTEGER NOT NULL DEFAULT 0;     -- linked later, and the dates of birth differ
CREATE INDEX bookings_participant ON bookings (participant_id) WHERE participant_id IS NOT NULL;

-- the one case a member email leaves for another address: the OLD one after an email change (emptied once sent)
ALTER TABLE member_outbox ADD COLUMN to_email TEXT;

CREATE TABLE seasons (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  start_at   TEXT,
  end_at     TEXT,
  status     TEXT NOT NULL,                    -- planned | active | closed
  closed_ms  INTEGER,
  closed_by  TEXT,
  created_ms INTEGER NOT NULL,
  updated_ms INTEGER NOT NULL
);
CREATE UNIQUE INDEX seasons_one_active ON seasons (status) WHERE status = 'active';

-- append-only: corrections are new rows, never edits
CREATE TABLE points_ledger (
  id             TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL,
  season_id      TEXT NOT NULL,
  amount         INTEGER NOT NULL,             -- signed
  kind           TEXT NOT NULL,                -- earn | manual | transfer | spend | refund
  note           TEXT,
  note_public    INTEGER NOT NULL DEFAULT 0,   -- the participant may read the note
  ref            TEXT,
  idem_key       TEXT NOT NULL UNIQUE,
  actor          TEXT NOT NULL,
  created_ms     INTEGER NOT NULL
);
CREATE INDEX points_ledger_p ON points_ledger (participant_id, season_id);

CREATE TABLE season_totals (
  season_id      TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  earned         INTEGER NOT NULL,
  spent          INTEGER NOT NULL,
  adjusted       INTEGER NOT NULL,
  final          INTEGER NOT NULL,
  closed_ms      INTEGER NOT NULL,
  PRIMARY KEY (season_id, participant_id)
);

-- «بلّغ الحاجزين»: what changed, read when each email is sent
CREATE TABLE event_notices (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL,
  changes    TEXT NOT NULL,                    -- [{ field, from, to }]
  actor      TEXT NOT NULL,
  created_ms INTEGER NOT NULL
);

INSERT OR IGNORE INTO seasons (id, name, status, created_ms, updated_ms) VALUES ('sea-first', 'الموسم الأول', 'active', 0, 0);
INSERT OR IGNORE INTO settings (key, value, updated_at, updated_by) VALUES ('support_contact', '', 0, 'migration');
