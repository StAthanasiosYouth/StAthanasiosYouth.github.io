-- DRAFT — NOT APPLIED (becomes migrations/0003_bookings.sql). Booking pilot schema (docs/EVENTS.md §1, D1 storage).
-- Moves to migrations/ only when the pilot is approved.
-- Columns mirror the EVENTS.md tabs so a reverse export to Sheets is a straight copy.
-- Money: integer EGP. Times: *_ms epoch ms + Cairo text where the contract shows stamps.

-- Bookable part of each event, synced from the Apps Script Events tab
-- (signed server-to-server call on save/publish) until events move (Phase 4).
CREATE TABLE event_cfg (
  id              TEXT PRIMARY KEY,          -- evt-…
  slug            TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  start_at        TEXT, end_at TEXT,         -- Cairo stamps
  end_ms          INTEGER,
  booking         TEXT NOT NULL,             -- BookingSpec JSON (pricing, capacity, window, payment mode)
  capacity        INTEGER,                   -- NULL = unlimited
  servants        TEXT NOT NULL DEFAULT '[]',-- [{ id, methods: [key…] }]
  price_rev       TEXT NOT NULL,
  revision        TEXT NOT NULL,             -- published definition hash
  published       INTEGER NOT NULL DEFAULT 0,
  synced_at       INTEGER NOT NULL
);

CREATE TABLE servants (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT, role TEXT, active INTEGER NOT NULL DEFAULT 1,
  public_wa INTEGER NOT NULL DEFAULT 0, synced_at INTEGER NOT NULL
);

CREATE TABLE pay_methods (
  key TEXT PRIMARY KEY, label TEXT NOT NULL, needs_proof INTEGER NOT NULL DEFAULT 0,
  ord INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, synced_at INTEGER NOT NULL
);

CREATE TABLE bookings (
  id              TEXT PRIMARY KEY,          -- bkg-…
  ref             TEXT NOT NULL,             -- B-XXXXX
  event_id        TEXT NOT NULL,
  source          TEXT NOT NULL,             -- site | admin
  status          TEXT NOT NULL CHECK (status IN ('pending','confirmed','rejected','withdrawn','cancelled')),
  name            TEXT NOT NULL,
  phone           TEXT NOT NULL,             -- +E.164, PRIVATE
  servant_id      TEXT, method TEXT,
  requested       TEXT NOT NULL,             -- {category: count}
  actual          TEXT,                      -- set at confirm
  seats_requested INTEGER NOT NULL,          -- computed by the server model (seat categories)
  seats_actual    INTEGER NOT NULL DEFAULT 0,-- counts toward capacity only while confirmed
  names           TEXT,
  quoted_total    INTEGER NOT NULL,
  price_rev       TEXT NOT NULL,
  amount_due      INTEGER,
  due_history     TEXT NOT NULL DEFAULT '[]',
  visitor_note    TEXT, admin_note TEXT, reject_reason TEXT, cancel_reason TEXT,
  cap_override    TEXT,
  request_key     TEXT NOT NULL UNIQUE,      -- idempotent submit
  created_at      TEXT NOT NULL, created_ms INTEGER NOT NULL,
  confirmed_at    TEXT, confirmed_by TEXT, closed_at TEXT, closed_by TEXT,
  updated_ms      INTEGER NOT NULL,
  version         INTEGER NOT NULL DEFAULT 1,
  UNIQUE (event_id, ref)
);
CREATE INDEX bookings_event_status ON bookings (event_id, status);
CREATE INDEX bookings_event_phone ON bookings (event_id, phone, status);

-- APPEND-ONLY. The only column ever updated is voided_by (EVENTS.md §5.2).
CREATE TABLE payments (
  id              TEXT PRIMARY KEY,          -- pay-…
  booking_id      TEXT NOT NULL,
  event_id        TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('payment','refund','void')),
  amount          INTEGER NOT NULL CHECK (amount > 0 AND amount <= 1000000),
  servant_id      TEXT, servant_name TEXT, method TEXT,
  received_at     TEXT NOT NULL,
  recorded_at     TEXT NOT NULL, recorded_ms INTEGER NOT NULL,
  recorded_by     TEXT NOT NULL, recorded_name TEXT,
  proof_ids       TEXT,
  note            TEXT,
  voids_id        TEXT,                      -- kind = void only
  voided_by       TEXT,                      -- NULL = live
  idem_key        TEXT NOT NULL UNIQUE
);
CREATE INDEX payments_booking ON payments (booking_id);
CREATE INDEX payments_event ON payments (event_id);
CREATE UNIQUE INDEX payments_one_void ON payments (voids_id) WHERE voids_id IS NOT NULL;

-- Proof files: the shared `proofs` table (migrations/0002_proofs.sql, purpose
-- booking | payment, booking_id / payment_id) + the private R2 bucket.

-- Capacity guard used at confirm (EVENTS.md §9), one statement under D1's single writer:
--   UPDATE bookings SET status='confirmed', actual=?, seats_actual=?, amount_due=?, … , version=version+1
--   WHERE id=? AND status='pending' AND version=?
--     AND ( (SELECT capacity FROM event_cfg WHERE id=bookings.event_id) IS NULL
--        OR (SELECT COALESCE(SUM(b2.seats_actual),0) FROM bookings b2
--             WHERE b2.event_id=bookings.event_id AND b2.status='confirmed') + ?
--           <= (SELECT capacity FROM event_cfg WHERE id=bookings.event_id)
--        OR ? = 1 /* admin capacity override with reason */ )
-- changes = 0 → re-read: 'full' (with left) or 'conflict' (someone else moved it).
--
-- Void (EVENTS.md §5.2), one batch; the INSERT only happens for a live, non-void target,
-- payments_one_void blocks a second void, and the UPDATE only follows a written void row:
--   INSERT INTO payments (…, kind, amount, voids_id, …) SELECT …, 'void', t.amount, t.id, …
--     FROM payments t WHERE t.id=:target AND t.voided_by IS NULL AND t.kind<>'void'
--   UPDATE payments SET voided_by=:voidId WHERE id=:target AND voided_by IS NULL
--     AND EXISTS (SELECT 1 FROM payments WHERE id=:voidId)
-- (test/bookings-draft.test.mjs runs these patterns against this schema.)
