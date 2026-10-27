-- Phase 4 step 1 — content drafts in D1 (docs/CONTENT-MIGRATION-PLAN.md §3).
-- Forward-only, additive. Nothing reads these tables for the site or the panel
-- until the owner flips settings.CONTENT_DRAFTS to '1' at the Phase 4 cutover.
--
-- One row per draft entity, for every kind the content Sheet and the pages /
-- events tabs hold today (links, sections, contacts, sessions, news, games,
-- notifications, activities, types, media, settings, pages, page_media,
-- events, servants, pay_methods). `data` is the row exactly as Apps Script
-- reads it (readTable_ / compRows_: the Sheet's column keys, camelCase), so a
-- reverse export to the Sheets is a straight copy and the builders get the
-- same input they get today. `pos` keeps the Sheet's row order.

CREATE TABLE draft_rows (
  kind        TEXT NOT NULL,              -- links | sections | … (src/content/kinds.js)
  id          TEXT NOT NULL,              -- the row's key: id, key or date (per kind)
  pos         INTEGER NOT NULL,           -- the Sheet's row order (0-based)
  version     INTEGER NOT NULL DEFAULT 1, -- the row's edit version: UPDATE … WHERE version = ?
  kver        INTEGER NOT NULL,           -- the kind's version when this row last changed (delta reads)
  data        TEXT NOT NULL,              -- JSON object, the Sheet's columns
  hash        TEXT NOT NULL,              -- sha-256 of the canonical data
  deleted_ms  INTEGER,                    -- a tombstone (delta reads see the delete), trimmed later
  updated_ms  INTEGER NOT NULL,
  updated_by  TEXT,
  PRIMARY KEY (kind, id)
);
CREATE INDEX draft_rows_order ON draft_rows (kind, pos);
CREATE INDEX draft_rows_kver ON draft_rows (kind, kver);

-- one row per kind: its version (bumped by every change) and the hash of its live rows
CREATE TABLE draft_kinds (
  kind        TEXT PRIMARY KEY,
  version     INTEGER NOT NULL,
  base        INTEGER NOT NULL,           -- deltas are complete only from this version on (an import resets it)
  rows        INTEGER NOT NULL,
  hash        TEXT NOT NULL,              -- sha-256 over the live rows in order (the import check)
  source      TEXT NOT NULL,              -- 'import' | 'worker'
  updated_ms  INTEGER NOT NULL,
  updated_by  TEXT
);

-- a write's preconditions (P4-2): one INSERT per row the write checks, ok = 0 when the row
-- moved on since it was read → the CHECK fails → the whole batch rolls back (stale). Emptied by the same batch.
CREATE TABLE draft_guard (
  ok  INTEGER NOT NULL CHECK (ok = 1)
);

-- admin pushes for content edits saved on the Worker, while the router is off (P4-2): Apps Script decided
-- them (Activity.gs activityNotifyKind_ → row.notified = 'pending:now|cooldown'); Apps Script pulls them
-- (POST /v1/sync/content-notify) into its Activity sheet and sends them as today. At most once.
CREATE TABLE content_notify (
  id          TEXT PRIMARY KEY,           -- the activity row's id
  row         TEXT NOT NULL,              -- JSON: the Activity record (ACTIVITY_COLUMNS), no phone ever
  created_ms  INTEGER NOT NULL,
  sent_ms     INTEGER                     -- handed out (never again)
);
CREATE INDEX content_notify_open ON content_notify (sent_ms, created_ms);

-- every Sheets → D1 copy (dry run or apply) and its check
CREATE TABLE draft_imports (
  id          TEXT PRIMARY KEY,           -- imp-<random>
  mode        TEXT NOT NULL,              -- 'dry' | 'apply'
  state       TEXT NOT NULL,              -- 'ok' | 'mismatch' | 'refused' | 'failed'
  kinds       TEXT NOT NULL,              -- JSON { kind: { rows, hash, d1Hash, ok } }
  source_hash TEXT NOT NULL,              -- sha-256 of the whole payload as Apps Script sent it
  by          TEXT,
  at          INTEGER NOT NULL,
  error       TEXT
);
CREATE INDEX draft_imports_at ON draft_imports (at);

-- the Phase 4 switch: '0' = the Sheets are the drafts' only writer (D1 is a copy,
-- refreshed by imports); '1' = D1 is the only writer (imports refused).
INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('CONTENT_DRAFTS', '0', 0, 'migration')
  ON CONFLICT(key) DO NOTHING;
