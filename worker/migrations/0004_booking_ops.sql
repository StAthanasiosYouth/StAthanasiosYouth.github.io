-- 0004 booking pilot, operations (docs/EVENTS.md §7.3, §10, §11; worker/BOOKING-API.md):
-- phone retention, admin edit locks on bookings, and the grouped
-- «new bookings» counters that Apps Script turns into admin pushes.

-- §10: phone numbers are blanked 12 months after the event ends (daily cron).
-- `phone` stays NOT NULL: a blanked phone is ''. The time it happened is kept.
ALTER TABLE bookings ADD COLUMN phone_blanked_ms INTEGER;
CREATE INDEX bookings_phone_kept ON bookings (event_id) WHERE phone <> '';

-- §10 edit locks: one admin edits a booking at a time. A lock is a lease
-- (renewed every ~30 s by the open booking sheet, gone after LOCK_TTL),
-- held by one admin's page session (sid). Writes by anyone else are refused
-- with `locked` while it lives; the booking `version` still guards the rest.
CREATE TABLE edit_locks (
  kind        TEXT NOT NULL,              -- 'booking'
  id          TEXT NOT NULL,              -- bkg-…
  email       TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  sid         TEXT NOT NULL,              -- the admin page session
  since_ms    INTEGER NOT NULL,
  expires_ms  INTEGER NOT NULL,
  PRIMARY KEY (kind, id)
);
CREATE INDEX edit_locks_expires ON edit_locks (expires_ms);

-- §7.3: new bookings per event not yet announced. Incremented in the same
-- batch as the booking; Apps Script claims the due ones (POST /v1/sync/book-news)
-- and sends one grouped push per event, at most every 10 minutes.
CREATE TABLE book_news (
  event_id    TEXT PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT '',
  unsent      INTEGER NOT NULL DEFAULT 0,
  first_ms    INTEGER,                    -- oldest unsent booking
  last_ms     INTEGER,                    -- newest unsent booking
  sent_ms     INTEGER                     -- last claim (cooldown)
);
