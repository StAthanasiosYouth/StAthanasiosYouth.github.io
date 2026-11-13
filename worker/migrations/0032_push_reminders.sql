-- Site wave 5 (S4 «فكّرني لما تبدأ», owner 2026-11-14): one device asks to be told when one competition starts.
-- Additive. The minute cron (push/remind.js remindTick) sends to that device only, once, at the start.
CREATE TABLE push_reminders (
  device_id   TEXT NOT NULL,                   -- push_devices.id ('h' + 40 hex), a public device
  slug        TEXT NOT NULL,                   -- the competition (content.json competitions[].slug)
  at_ms       INTEGER NOT NULL,                -- its start (Cairo wall time → ms) when asked; re-read from the live content at send time
  created_ms  INTEGER NOT NULL,
  sent_ms     INTEGER,                         -- done (sent, or covered by the competition's own push to everyone)
  PRIMARY KEY (device_id, slug)
);
CREATE INDEX push_reminders_due ON push_reminders (sent_ms, at_ms);
