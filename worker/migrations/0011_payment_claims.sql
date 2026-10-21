-- Phase 1.5 step 11: paying a remaining balance through the existing booking
-- (BOOKING-PHASE1-COMPLETION-PLAN §4.10). Additive only.
--
-- A participant's payment REQUEST (the amount they say they sent + their transfer
-- screenshots), never a payment: an admin reviews it, and accepting it records the
-- payment through the usual «إضافة دفعة» (payments row, proofs attached), which
-- marks the request accepted. At most one open request per booking.
CREATE TABLE payment_claims (
  id           TEXT PRIMARY KEY,                 -- 'pcl-…'
  booking_id   TEXT NOT NULL,
  event_id     TEXT NOT NULL,
  servant_id   TEXT NOT NULL,
  method       TEXT NOT NULL,
  amount       INTEGER NOT NULL CHECK (amount > 0),
  proof_ids    TEXT NOT NULL,                    -- JSON ['prf-…'] (1–3), attached to the booking
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn')),
  payment_id   TEXT,                             -- the payment recorded when accepted
  reason       TEXT,                             -- why it was rejected (shown to the participant)
  request_key  TEXT NOT NULL UNIQUE,             -- the client's idempotency key
  created_at   TEXT NOT NULL,
  created_ms   INTEGER NOT NULL,
  decided_at   TEXT,
  decided_ms   INTEGER,
  decided_by   TEXT
);
CREATE UNIQUE INDEX payment_claims_one_open ON payment_claims (booking_id) WHERE status = 'pending';
CREATE INDEX payment_claims_event ON payment_claims (event_id, status);
