-- 0005 booking Phase 1 completion (docs/BOOKING-PHASE1-COMPLETION-PLAN.md rev. 4):
-- the new-bookings feed becomes at-least-once (claim → ack), and the
-- approved InstaPay / wallet destinations the booking page shows.
-- Additive only: an older Worker ignores all of it.

-- §4.4 / B7: a handed-out group stays "claimed" until Apps Script acks it.
-- No ack within CLAIM_TTL → the SAME claim (same id, same count) is handed out
-- again; Apps Script remembers the ids it announced, so a re-handed claim is
-- acked without a second push. Callers that don't ask for v2 keep the old
-- at-most-once behaviour (claim_id stays NULL).
ALTER TABLE book_news ADD COLUMN claim_id TEXT;
ALTER TABLE book_news ADD COLUMN claim_count INTEGER;
ALTER TABLE book_news ADD COLUMN claim_ms INTEGER;

-- §4.7: one row per servant × online method whose destination the PRIMARY
-- ADMIN approved (Apps Script owns the Servants registry and the approval;
-- it pushes the whole approved set, signed, on every change). Nothing here is
-- ever written into event.json: the page asks POST /v1/book/pay at the
-- payment step. `number` is the local 01xxxxxxxxx form.
CREATE TABLE pay_dest (
  servant_id   TEXT NOT NULL,             -- srv-…
  method       TEXT NOT NULL,             -- PayMethods key (instapay | wallet | …)
  number       TEXT NOT NULL,             -- 01xxxxxxxxx (ASCII digits)
  name         TEXT NOT NULL DEFAULT '',  -- beneficiary, '' = not shown
  source       TEXT NOT NULL CHECK (source IN ('own', 'phone')),
  approved_ms  INTEGER NOT NULL,
  approved_by  TEXT NOT NULL,
  synced_ms    INTEGER NOT NULL,
  PRIMARY KEY (servant_id, method)
);

-- The payment card + the server check that a visitor's InstaPay / wallet
-- choice has an approved destination. '0' until the approved set is synced.
INSERT OR IGNORE INTO settings (key, value, updated_at, updated_by) VALUES ('PAY_DEST', '0', 0, 'migration');
