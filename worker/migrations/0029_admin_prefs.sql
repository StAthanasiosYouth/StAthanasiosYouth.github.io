-- Phase 8 A1 (docs/PHASE8-PLAN.md §2): each admin's look of the panel (theme, accent, density, motion, sound),
-- theirs only, so it follows them to any device. Additive: a new table; no admin row changes.
CREATE TABLE admin_prefs (
  email       TEXT PRIMARY KEY,                -- the admin (admins.email)
  prefs       TEXT NOT NULL,                   -- JSON, only the known keys and values (src/admin/prefs.js)
  updated_ms  INTEGER NOT NULL
);
