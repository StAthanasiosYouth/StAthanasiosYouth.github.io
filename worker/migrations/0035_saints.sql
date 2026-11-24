-- «خبزنا اليومي» P3 (docs/daily-bread/saints/P3-PLAN.md, approved by the owner 2026-11-24): the saints and church
-- people registry, edited in the admin. D1 holds the draft (one row per person / occasion, with its own rev so two
-- admins never overwrite each other); «انشر» writes daily-bread/data/saints.json through the existing bread publish
-- (published_revisions kind 'bread', key 'saints') and keeps the full internal registry of that publish in
-- saints_snapshots (history and «رجّع النسخة دي»). Additive. Nothing reads it while BREAD_SAINTS = '0'.
-- Rollback: BREAD_SAINTS = '0' (the admin routes answer `disabled`; the feasts keep the last published file).
CREATE TABLE saints_items (
  kind        TEXT NOT NULL,                 -- 'person' | 'occasion' | 'meta'
  id          TEXT NOT NULL,                 -- P2's ids (a-z0-9); meta: 'categories', 'about', 'picturesRoot'
  ord         INTEGER NOT NULL,              -- the owner's order (the earlier wins on a shared day)
  data        TEXT NOT NULL,                 -- the item, schema 2 (JSON), status/missing computed by the Worker
  rev         INTEGER NOT NULL DEFAULT 1,    -- +1 on every save
  pub_rev     INTEGER,                       -- rev at the last publish (NULL = never published)
  deleted_ms  INTEGER,                       -- removed in the draft; gone for good at the next publish
  updated_at  INTEGER NOT NULL,
  updated_by  TEXT NOT NULL,
  PRIMARY KEY (kind, id)
) WITHOUT ROWID;

CREATE TABLE saints_snapshots (
  rev         INTEGER PRIMARY KEY,           -- the registry's publish number (1, 2, …)
  data        TEXT NOT NULL,                 -- the whole internal registry as published (JSON)
  people      INTEGER NOT NULL,
  occasions   INTEGER NOT NULL,
  note        TEXT,                          -- what changed, in a line (the review)
  publish_id  TEXT,                          -- publish_jobs.id of the published file
  at          INTEGER NOT NULL,
  by          TEXT NOT NULL
);

INSERT INTO settings (key, value, updated_at, updated_by) VALUES
  ('BREAD_SAINTS', '0', 0, 'migration')
ON CONFLICT(key) DO NOTHING;
