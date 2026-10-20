-- Phase 1 final: the visitor's payment choice, and payment reminders (forward-only)

-- «دفع كامل» / «دفع قسط»: what the visitor said they paid with the request (checked
-- server-side against the event's installment rule). A claim, not money: the admin
-- still records the payment from the proof.
ALTER TABLE bookings ADD COLUMN pay_plan TEXT;          -- 'full' | 'part' | NULL (older / free)
ALTER TABLE bookings ADD COLUMN pay_claim INTEGER;      -- the amount the visitor said they sent

-- Reminders sent by an admin to participants who still owe money (append-only log).
-- channel 'whatsapp' = a message the admin opened in WhatsApp; Push is Phase 6.
CREATE TABLE reminders (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL,
  booking_id    TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'balance' CHECK (kind IN ('balance')),
  channel       TEXT NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp')),
  balance       INTEGER NOT NULL,
  sent_at       TEXT NOT NULL,
  sent_ms       INTEGER NOT NULL,
  sent_by       TEXT NOT NULL,
  sent_name     TEXT,
  idem_key      TEXT NOT NULL UNIQUE
);
CREATE INDEX reminders_booking ON reminders (booking_id, sent_ms);
CREATE INDEX reminders_event ON reminders (event_id, sent_ms);
