-- Phase 5, batch 5 (docs/PHASE5-PLAN.md P5-9): what «نقاطي» needs of a competition, without parsing its questions.
-- The load check measured 64 ms of CPU for one member's page with 30 competitions, against the 10 ms limit.
ALTER TABLE comp_versions ADD COLUMN meta TEXT;       -- JSON: the definition without its questions
