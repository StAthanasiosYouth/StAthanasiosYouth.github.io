-- Phase 2 step 1: published revisions (forward-only, additive)
-- docs/PUBLISH-SEPARATION-PLAN.md §4. No switch is seeded: CONTENT_SERVE absent = serve,
-- and nothing is served until Apps Script posts a publish (P2-2, owner approval).

-- every published file, immutable; exactly one live row per (kind, key)
CREATE TABLE published_revisions (
  id             TEXT PRIMARY KEY,           -- rev-<random>
  kind           TEXT NOT NULL,              -- content | page | event | comp | ics | stub
  key            TEXT NOT NULL,              -- 'site', the slug, or a stub's folder
  rev            INTEGER NOT NULL,           -- 1, 2, … per (kind, key)
  hash           TEXT NOT NULL,              -- sha-256 hex of body
  body           TEXT NOT NULL,              -- the exact file text
  withdrawn      INTEGER NOT NULL DEFAULT 0, -- the withdrawn JSON of a page/event/comp
  live           INTEGER NOT NULL DEFAULT 0,
  publish_id     TEXT NOT NULL,
  published_by   TEXT,
  published_at   INTEGER NOT NULL,
  mirrored_at    INTEGER,                    -- P2-4
  github_commit  TEXT,                       -- P2-4
  UNIQUE (kind, key, rev)
);
CREATE UNIQUE INDEX published_revisions_live ON published_revisions (kind, key) WHERE live = 1;
CREATE INDEX published_revisions_publish ON published_revisions (publish_id);

-- one row per publish attempt (its retries reuse the id)
CREATE TABLE publish_jobs (
  id          TEXT PRIMARY KEY,
  mode        TEXT NOT NULL,                 -- shadow | worker
  revision    TEXT,                          -- content.json revision, when sent
  hash        TEXT NOT NULL,                 -- sha-256 of the whole file set
  state       TEXT NOT NULL,                 -- live | mirroring | mirrored | failed
  files       INTEGER NOT NULL,
  changed     INTEGER NOT NULL,
  result      TEXT NOT NULL,                 -- the reply (JSON), returned again to a retry
  by          TEXT,
  at          INTEGER NOT NULL,              -- when Apps Script started this publish (orders publishes)
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  error       TEXT
);
CREATE INDEX publish_jobs_at ON publish_jobs (at);
