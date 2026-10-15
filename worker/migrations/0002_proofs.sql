-- 0002 proofs: metadata of private files in R2 (binding PROOFS). The bytes
-- live only in the private bucket; D1 keeps the reference, hash and size.
-- docs/EVENTS.md §1 / §10: never public, admin-only streaming, retention.

CREATE TABLE proofs (
  id               TEXT PRIMARY KEY,          -- prf-<8 base32>
  purpose          TEXT NOT NULL CHECK (purpose IN ('booking', 'payment', 'test')),
  booking_id       TEXT,                      -- bkg-… (booking pilot)
  payment_id       TEXT,                      -- pay-… (attached to a payment row)
  r2_key           TEXT NOT NULL UNIQUE,      -- object key in the private bucket
  mime             TEXT NOT NULL CHECK (mime IN ('image/webp', 'image/jpeg')),
  bytes            INTEGER NOT NULL,
  sha256           TEXT NOT NULL,
  width            INTEGER,
  height           INTEGER,
  by               TEXT NOT NULL,             -- 'visitor' | admin email
  at               TEXT NOT NULL,             -- Cairo wall clock
  at_ms            INTEGER NOT NULL,
  delete_after_ms  INTEGER NOT NULL,          -- retention: the daily cron deletes the file after this
  deleted_at       TEXT,                      -- row kept for accounting; the file is gone
  deleted_by       TEXT,                      -- admin email | 'retention'
  deleted_ms       INTEGER
);
CREATE INDEX proofs_booking ON proofs (booking_id);
CREATE INDEX proofs_sha ON proofs (sha256);
CREATE INDEX proofs_retention ON proofs (delete_after_ms) WHERE deleted_at IS NULL;
