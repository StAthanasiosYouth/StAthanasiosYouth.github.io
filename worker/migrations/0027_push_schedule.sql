-- Phase 6 Step 4c (docs/PHASE6-PLAN.md, COMPETITIONS §18.5): the automatic pushes, on the Worker's own dates. Additive.
-- Nothing is sent from here until settings.PUSH_SENDER = 'worker'.

-- One moment: «المتجر هيفتح بكره», «الموسم بيخلص بعد ٣ أيام»… (CompSchedule.gs PushSchedule)
CREATE TABLE push_schedule (
  id          TEXT PRIMARY KEY,                -- 'psh-' + 10 hex
  notif_id    TEXT NOT NULL UNIQUE,            -- notif-<kind>-<yyyymmddhhmm>: the moment is in the id, so a new date is a new item
  kind        TEXT NOT NULL,                   -- shop-open-1d | shop-open-1h | shop-open | shop-close-24h | shop-close-1h | season-end
  ref_id      TEXT NOT NULL DEFAULT '',        -- the season, for season-end
  send_wall   TEXT NOT NULL,                   -- Cairo 'YYYY-MM-DDTHH:MM'
  send_ms     INTEGER NOT NULL,
  expire_wall TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'skipped', 'failed', 'cancelled')),
  result      TEXT NOT NULL DEFAULT '',
  send_key    TEXT NOT NULL,
  updated_ms  INTEGER NOT NULL
);
CREATE INDEX push_schedule_due ON push_schedule (status, send_ms);

-- «ابعت تنبيه قبل نهاية الموسم بـ … يوم» (CompSeasons.gs notifyDays); NULL = none
ALTER TABLE seasons ADD COLUMN notify_days INTEGER;
