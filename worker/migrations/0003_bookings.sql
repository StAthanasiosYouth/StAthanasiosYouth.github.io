-- 0003 bookings: the booking pilot (docs/EVENTS.md §1, §4, §5, §9; worker/BOOKING-API.md).
-- Columns mirror the EVENTS.md tabs (snake_case) so a reverse export to Sheets is a straight copy.
-- Money: integer EGP. *_ms: epoch ms. Stamps: Cairo wall clock 'YYYY-MM-DD HH:MM'.
-- Proof files use the shared `proofs` table (0002) with purpose booking | payment.

-- The published booking definition of each event, read from the site's
-- event.json (what visitors saw), refreshed on demand. Never edited here.
CREATE TABLE event_cfg (
  id            TEXT PRIMARY KEY,          -- evt-…
  slug          TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  start_at      TEXT NOT NULL,             -- Stamp from event.json
  end_at        TEXT NOT NULL DEFAULT '',
  end_ms        INTEGER NOT NULL,          -- endAt (or startAt) as epoch ms
  booking       TEXT,                      -- event.json `booking` block (JSON) or NULL
  online        INTEGER NOT NULL DEFAULT 0,
  capacity      INTEGER,                   -- NULL = unlimited
  price_rev     TEXT NOT NULL DEFAULT '',
  revision      TEXT NOT NULL DEFAULT '',  -- event.json `v`
  withdrawn     INTEGER NOT NULL DEFAULT 0,
  source        TEXT NOT NULL DEFAULT 'site',   -- site | fixture (staging tests)
  fetched_at    INTEGER NOT NULL
);

CREATE TABLE bookings (
  id              TEXT PRIMARY KEY,          -- bkg-…
  ref             TEXT NOT NULL,             -- B-XXXXX
  event_id        TEXT NOT NULL,
  source          TEXT NOT NULL CHECK (source IN ('site', 'admin')),
  status          TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'rejected', 'withdrawn', 'cancelled')),
  name            TEXT NOT NULL,
  phone           TEXT NOT NULL,             -- +E.164, PRIVATE
  servant_id      TEXT,
  method          TEXT,
  requested       TEXT NOT NULL,             -- Counts JSON
  actual          TEXT,                      -- Counts JSON, set at confirm
  seats_requested INTEGER NOT NULL,
  seats_actual    INTEGER NOT NULL DEFAULT 0,-- takes places only while confirmed
  names           TEXT,
  quoted_total    INTEGER NOT NULL,
  price_rev       TEXT NOT NULL,
  amount_due      INTEGER,                   -- NULL while pending
  due_history     TEXT NOT NULL DEFAULT '[]',
  visitor_note    TEXT,
  admin_note      TEXT,
  reject_reason   TEXT,
  cancel_reason   TEXT,
  cap_override    TEXT,
  pay_override    TEXT,
  request_key     TEXT NOT NULL UNIQUE,
  created_at      TEXT NOT NULL,
  created_ms      INTEGER NOT NULL,
  confirmed_at    TEXT,
  confirmed_by    TEXT,
  closed_at       TEXT,
  closed_by       TEXT,
  updated_ms      INTEGER NOT NULL,
  version         INTEGER NOT NULL DEFAULT 1,
  UNIQUE (event_id, ref)
);
CREATE INDEX bookings_event_status ON bookings (event_id, status);
CREATE INDEX bookings_event_phone ON bookings (event_id, phone, status);
CREATE INDEX bookings_created ON bookings (event_id, created_ms);

-- APPEND-ONLY. The only column ever updated is voided_by (EVENTS.md §5.2).
CREATE TABLE payments (
  id              TEXT PRIMARY KEY,          -- pay-…
  booking_id      TEXT NOT NULL,
  event_id        TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('payment', 'refund', 'void')),
  amount          INTEGER NOT NULL CHECK (amount > 0 AND amount <= 1000000),
  servant_id      TEXT,
  servant_name    TEXT,
  method          TEXT,
  received_at     TEXT NOT NULL,             -- Cairo stamp: when the money moved
  received_ms     INTEGER NOT NULL,
  recorded_at     TEXT NOT NULL,
  recorded_ms     INTEGER NOT NULL,
  recorded_by     TEXT NOT NULL,
  recorded_name   TEXT,
  proof_ids       TEXT,                      -- JSON [prf-…]
  note            TEXT,
  voids_id        TEXT,                      -- kind = void only
  voided_by       TEXT,                      -- NULL = live
  idem_key        TEXT NOT NULL UNIQUE
);
CREATE INDEX payments_booking ON payments (booking_id);
CREATE INDEX payments_event ON payments (event_id, received_ms);
CREATE UNIQUE INDEX payments_one_void ON payments (voids_id) WHERE voids_id IS NOT NULL;

INSERT OR IGNORE INTO settings (key, value, updated_at, updated_by) VALUES ('BOOKING_MODULE', '0', 0, 'migration');
