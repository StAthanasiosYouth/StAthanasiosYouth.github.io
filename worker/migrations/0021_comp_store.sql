-- Phase 5B, batch 4 (docs/PHASE5-PLAN.md P5-7, P5-8): competitions runtime and the store on the Worker.
-- Forward-only, additive. Dormant: every route needs accounts_mode = 'on' and a signed-in account.
-- Authoring stays on Apps Script until Phase 6: it pushes each live definition here (POST /v1/sync/comp-live).

-- immutable: what a published version asked (with its key, private)
CREATE TABLE comp_versions (
  comp_id   TEXT NOT NULL,
  version   TEXT NOT NULL,
  slug      TEXT NOT NULL,
  def       TEXT NOT NULL,
  synced_ms INTEGER NOT NULL,
  PRIMARY KEY (comp_id, version)
);

CREATE TABLE comp_live (
  slug         TEXT PRIMARY KEY,
  comp_id      TEXT NOT NULL UNIQUE,
  version      TEXT NOT NULL,
  closed_at    TEXT,
  finalized_at TEXT,
  updated_ms   INTEGER NOT NULL
);

-- every attempt belongs to an account: there is no anonymous row (YOUTH-ACCOUNTS-PLAN §18)
CREATE TABLE submissions (
  id             TEXT PRIMARY KEY,
  comp_id        TEXT NOT NULL,
  version        TEXT NOT NULL,
  client_key     TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  attempt_no     INTEGER NOT NULL,
  status         TEXT NOT NULL,            -- in_progress | submitted | pending_review | graded | void
  started_ms     INTEGER NOT NULL,
  deadline_ms    INTEGER NOT NULL DEFAULT 0,
  submitted_ms   INTEGER,
  duration_sec   INTEGER,
  seed           TEXT NOT NULL,
  qids           TEXT NOT NULL,
  answers        TEXT,
  grading        TEXT,
  score          INTEGER NOT NULL DEFAULT 0,
  max_score      INTEGER NOT NULL DEFAULT 0,
  correct_count  INTEGER NOT NULL DEFAULT 0,
  gradable_count INTEGER NOT NULL DEFAULT 0,
  pending_count  INTEGER NOT NULL DEFAULT 0,
  flags          TEXT NOT NULL DEFAULT '',
  -- the snapshot taken at submit; later DOB corrections or range changes never rewrite it (§9.1)
  elig           TEXT,                     -- eligible | guest
  age_min        INTEGER,
  age_max        INTEGER,
  no_points      INTEGER NOT NULL DEFAULT 0,
  -- COMPETITIONS §20.2: credits stay hidden from the member until released
  scoring        INTEGER NOT NULL DEFAULT 0,
  release_at     TEXT,                     -- wall stamp; NULL = only on finalize
  released_ms    INTEGER,
  result_mailed  INTEGER NOT NULL DEFAULT 0,
  updated_ms     INTEGER NOT NULL
);
CREATE UNIQUE INDEX submissions_key ON submissions (comp_id, client_key);
CREATE UNIQUE INDEX submissions_one_open ON submissions (comp_id, version, participant_id) WHERE status = 'in_progress';
CREATE INDEX submissions_person ON submissions (participant_id, comp_id);
CREATE INDEX submissions_comp ON submissions (comp_id, status);
CREATE INDEX submissions_release ON submissions (released_ms, release_at) WHERE released_ms IS NULL;

ALTER TABLE points_ledger ADD COLUMN comp_id TEXT;
CREATE INDEX points_ledger_ref ON points_ledger (ref);

CREATE TABLE store_items (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image       TEXT,                        -- JSON image object, or NULL
  cost        INTEGER NOT NULL,
  stock       INTEGER,                     -- NULL = unlimited
  per_person  INTEGER,                     -- NULL = no limit
  category    TEXT NOT NULL DEFAULT '',
  ord         INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_ms  INTEGER NOT NULL,
  updated_ms  INTEGER NOT NULL
);

CREATE TABLE redemptions (
  id             TEXT PRIMARY KEY,
  item_id        TEXT NOT NULL,
  item_name      TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  season_id      TEXT NOT NULL,
  cost           INTEGER NOT NULL,
  status         TEXT NOT NULL,            -- pending | approved | fulfilled | cancelled
  request_key    TEXT NOT NULL UNIQUE,
  elig           TEXT NOT NULL DEFAULT 'eligible',
  note           TEXT,
  created_ms     INTEGER NOT NULL,
  updated_ms     INTEGER NOT NULL,
  decided_by     TEXT
);
CREATE INDEX redemptions_item ON redemptions (item_id, status);
CREATE INDEX redemptions_person ON redemptions (participant_id, created_ms);
CREATE INDEX redemptions_season ON redemptions (season_id, status);

INSERT OR IGNORE INTO settings (key, value, updated_at, updated_by) VALUES
  ('SHOP_MODE', 'auto', 0, 'migration'),
  ('SHOP_OPENS_AT', '', 0, 'migration'),
  ('SHOP_CLOSES_AT', '', 0, 'migration'),
  ('SHOP_ALLOW_CANCEL', '', 0, 'migration');
