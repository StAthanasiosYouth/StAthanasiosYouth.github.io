-- «خبزنا اليومي» W6 (owner's decision 2026-11-19, docs/daily-bread/progress/W6.md): a device with the site's
-- notifications on gets the daily reminder at the default time (bread_default_time) until it turns «فكّرني» off.
-- This table remembers that "off". Additive; nothing reads it while BREAD_PUSH = '0'. Rollback: the switches.
CREATE TABLE bread_optout (
  device_id   TEXT PRIMARY KEY,                   -- push_devices.id (public)
  created_ms  INTEGER NOT NULL
) WITHOUT ROWID;
