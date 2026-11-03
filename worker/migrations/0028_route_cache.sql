-- Phase 6 Step 5 (docs/PHASE6-PLAN.md): the map card's routes on the Worker (src/route.js). Additive.
-- An answer per profile and rounded start (≈ 11 m), kept 6 hours. No visitor is named: only the rounded point.
CREATE TABLE route_cache (
  key         TEXT PRIMARY KEY,                -- profile:lng,lat:church
  body        TEXT NOT NULL,                   -- the answer as the page reads it
  expires_ms  INTEGER NOT NULL
);
CREATE INDEX route_cache_expires ON route_cache (expires_ms);
