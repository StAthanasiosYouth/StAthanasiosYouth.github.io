-- 0007 servant handovers (Phase 1): the money a servant hands over to the
-- service (the treasurer), per event. APPEND-ONLY like payments: a mistake is
-- voided by a 'void' row (the only update ever: voided_by). The per-servant
-- accounting = what they received (payments, by method) − what they handed
-- over → still to hand over. Never touches payments or bookings.
CREATE TABLE handovers (
  id             TEXT PRIMARY KEY,          -- hnd-…
  event_id       TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('handover', 'void')),
  servant_id     TEXT NOT NULL,
  servant_name   TEXT,
  amount         INTEGER NOT NULL CHECK (amount > 0 AND amount <= 10000000),
  handed_at      TEXT NOT NULL,             -- Cairo stamp: when the money changed hands
  handed_ms      INTEGER NOT NULL,
  received_by    TEXT,                      -- who in the service took it (free text)
  note           TEXT,
  recorded_at    TEXT NOT NULL,
  recorded_ms    INTEGER NOT NULL,
  recorded_by    TEXT NOT NULL,
  recorded_name  TEXT,
  voids_id       TEXT,                      -- kind = void only
  voided_by      TEXT,                      -- NULL = live
  idem_key       TEXT NOT NULL UNIQUE
);
CREATE INDEX handovers_event ON handovers (event_id, servant_id);
CREATE UNIQUE INDEX handovers_one_void ON handovers (voids_id) WHERE voids_id IS NOT NULL;

-- which method's money was handed over (cash, instapay, …): custody is per servant AND method
ALTER TABLE handovers ADD COLUMN method TEXT NOT NULL DEFAULT '';

-- custody of a payment, fixed when it is recorded: 'servant' (cash in hand, or a
-- transfer to the servant's OWN approved number) | 'service' (a transfer to an
-- account that isn't the servant's). NULL on older rows: worked out from the
-- current approved numbers (pay_dest).
ALTER TABLE payments ADD COLUMN custody TEXT;
