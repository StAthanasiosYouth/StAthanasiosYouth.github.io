# Notifications audit, stage 2 (Phase 7a)

The output asked for by `docs/BOOKING-PHASE1-COMPLETION-PLAN.md` §4.8 stage 2. Written 2026-11-03 in Phase 7
(`docs/PHASE7-PLAN.md`). Every notification path runs on the Worker since Phase 6: push (FCM HTTP v1 with Firebase
Installation IDs), the schedule (cron), automatic bell pushes, the admin router's outbox, member and admin email (Gmail API).
Apps Script sends nothing and is retired (`@62`), so this audit no longer depends on it.

Legend: **passed** (with where), **covered by tests** (server behaviour, no device), **owner** (needs a real device or inbox).

## 1. Real-device matrix

| Device / client | Visitor push, app closed | Admin push, app closed + tap opens the record | State |
|---|---|---|---|
| Android Chrome + installed app | passed (owner, Phase 6 Step 4, 2026-11-03) | passed (owner, `ntf-180be2a86856`, receipt "shown (app closed)", ~85 s) | **passed** |
| iOS 16.4+ home-screen app | not run | not run | **owner** |
| Desktop Chrome / Edge | not run | not run | **owner** |
| Gmail web + Gmail app | member email live since 2026-10-31 (`MEMBER_EMAIL = 1`, owner's first tests passed, PHASE5-PLAN §3m) | admin email: `NOTIFY_EMAIL = 0` (owner's switch) | member **passed**; admin email **off by owner** |

The deferred Phase 1.5 item (admin push with the app closed, the tap opening `#open/booking/<id>`) is the Android admin row:
the push showed and the receipt came back. The admin half of booking test #2 (a *new booking's* push) runs on the same path
(router → outbox → `push/send.js`); it is tested in `worker/test/push-sender.test.mjs` and `notify-router.test.mjs` and
waits for one real booking on the owner's phone (§4, item 2).

## 2. Every notification kind (server side)

| Kind | Where | Evidence |
|---|---|---|
| General announcements, news, events, trips (bell items) | `push/autobell.js`, `push/schedule.js` | push-schedule tests (a bell item goes once, after the switch, at its time); live since 2026-11-03, owner confirmed 3/3 |
| Competitions (open, close, results) | `push/schedule.js`, the store's notify choices | push-schedule tests; «قريبًا» + server lock: comp-runtime tests (a submit before the opening is refused) |
| Bookings (admin) | router `booking.new`, grouped per event in 10 min | notify-router tests |
| Booker's reminder | `push/schedule.js` booker reminder | push-schedule test (linked devices only, no amounts, once) |
| Admin push (all levels) | outbox → `push/send.js` | push-sender tests (critical to the device in sight, backoff, removed admin) |
| Gmail immediate + summary | `notify/email.js`, `notify/member.js` | notify-email and member-email tests; admin email switched off by the owner |

## 3. Schedules and failures (server side)

| Check | Evidence |
|---|---|
| Egypt time and DST (last Friday of April → last Thursday of October), stamps near midnight | `push-schedule.test.mjs` «Cairo wall time: to ms across the year»; `tests/schedule.test.mjs`; `notify-email` rolling 24 h across midnight |
| Expired / dead tokens | push-sender «classify», «dead tokens go, a flaky one gets a second round» |
| Revoked permission / device offline | FCM answers per token: dead → removed, transient → second round (push-sender); the device re-registers on its next visit |
| Quota | push-sender «cooldown, a day's limit»; notify-email «budget short … critical waits as deferred_quota» |
| Gmail token broken | notify-email «token health: revoked → ONE critical gmail.token row» |
| Dead letters, dedupe | notify-router «claim … dead letter → critical alarm»; push-sender «a repeated key gets its result» |

## 4. Confirmed failures and required fixes

None found on the server side. Open, all needing the owner's devices (none blocks the retirement: Apps Script plays no part in them):

1. iOS home-screen app: visitor and admin push with the app closed.
2. Android: one real new booking → the admin push with the app closed → the tap opens that booking (booking test #2, admin half).
3. Desktop Chrome or Edge: one visitor push and one admin push.
4. Admin email stays off (`NOTIFY_EMAIL = 0`) until the owner turns it on; then one important item and one daily summary.
