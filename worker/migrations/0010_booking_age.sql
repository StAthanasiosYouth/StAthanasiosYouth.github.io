-- Phase 1.5 step 10: event age eligibility (BOOKING-PHASE1-COMPLETION-PLAN §4.9). Additive only.
--
-- A snapshot on each booking of what was checked when it was made: the booker's
-- self-declared date of birth (private: never on the status view or in event.json;
-- blanked with the phone after the event), their age at the event's start (Cairo),
-- where the age came from, and the rule used — so later rule edits never re-judge it.
ALTER TABLE bookings ADD COLUMN booker_dob TEXT;        -- 'YYYY-MM-DD' | NULL (no booker age rule)
ALTER TABLE bookings ADD COLUMN booker_age INTEGER;     -- full years at the event start | NULL
ALTER TABLE bookings ADD COLUMN age_source TEXT;        -- 'self' (before Phase 5A) | 'account' | 'admin' | NULL
ALTER TABLE bookings ADD COLUMN age_rule TEXT;          -- JSON {bookerAge:{min,max}|null, strict, allowed:[keys]} | NULL
ALTER TABLE bookings ADD COLUMN age_override TEXT;      -- JSON {by, at, reason} (bookings.manage, like cap_override) | NULL
