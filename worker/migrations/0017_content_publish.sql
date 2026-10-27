-- Phase 4 batch 2 (P4-4 … P4-6, docs/CONTENT-MIGRATION-PLAN.md §8–§10). Forward-only, additive.
-- Nothing here is read until settings.CONTENT_DRAFTS = '1' (the Phase 4 cutover).

-- The competitions part of a build (owner decision 2026-10-27: hybrid, one button). Competitions stay on
-- Apps Script until Phase 5–6; Apps Script builds their part (compBuildPublic_ + their files, with its own
-- secret) and the Worker keeps the last one. It is asked again only when the competitions' draft changed
-- (Apps Script pushes its signature: POST /v1/sync/comp-sig) or a time it depends on has passed.
CREATE TABLE comp_package (
  id           TEXT PRIMARY KEY,           -- 'current'
  sig          TEXT NOT NULL,              -- the competitions' draft signature it was built from
  media_sig    TEXT NOT NULL,              -- the library rows it was built against
  data         TEXT NOT NULL,              -- JSON { none, built, errors, warnings, points, modules, files, reviewInfo }
  prepared     INTEGER NOT NULL DEFAULT 0, -- its snapshots are written (a publish may use it)
  committed    INTEGER NOT NULL DEFAULT 0, -- Apps Script was told what went live (compAfterCommit_)
  stable_until INTEGER,                    -- epoch ms: a time the build depends on (NULL = none ahead)
  built_ms     INTEGER NOT NULL,
  committed_ms INTEGER
);

-- one publish at a time (BACKEND-MIGRATION §5: a claim row, not a global lock)
INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('PUBLISH_CLAIM', '', 0, 'migration')
  ON CONFLICT(key) DO NOTHING;

-- the media library's bytes in R2 (P4-5): one row per stored file (full / thumb / video / audio / poster)
CREATE TABLE media_files (
  key         TEXT PRIMARY KEY,           -- R2 key: media/<id>/<part>
  media_id    TEXT NOT NULL,
  part        TEXT NOT NULL,              -- 'full' | 'thumb'
  mime        TEXT NOT NULL,
  bytes       INTEGER NOT NULL,
  sha256      TEXT NOT NULL,
  source      TEXT NOT NULL,              -- 'upload' | 'drive' (the one-time copy)
  site_path   TEXT,                       -- where it goes on the site (the Media row's path / thumb)
  mirrored_ms INTEGER,                    -- committed to GitHub (upload-time, in the background)
  created_ms  INTEGER NOT NULL,
  deleted_ms  INTEGER
);
CREATE INDEX media_files_media ON media_files (media_id);
CREATE INDEX media_files_unmirrored ON media_files (mirrored_ms) WHERE mirrored_ms IS NULL;
