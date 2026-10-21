-- Phase 2 step 2: the shadow comparison (forward-only, additive)
-- docs/PUBLISH-SEPARATION-PLAN.md §6 P2-2. One row per run: the live D1 revision of every
-- published file vs. the same file on GitHub Pages. The gate is 1–2 weeks of clean runs.
CREATE TABLE shadow_checks (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  at        INTEGER NOT NULL,
  total     INTEGER NOT NULL,
  equal     INTEGER NOT NULL,
  lag       INTEGER NOT NULL,     -- the site still shows an older D1 revision
  mismatch  INTEGER NOT NULL,     -- the site shows text D1 never had
  missing   INTEGER NOT NULL,     -- in D1 only, or on the site only
  seeded    INTEGER NOT NULL,     -- copied from the site into D1 (seed run)
  errors    INTEGER NOT NULL,     -- the site could not be read
  detail    TEXT NOT NULL         -- JSON: the files that were not equal
);
CREATE INDEX shadow_checks_at ON shadow_checks (at);
