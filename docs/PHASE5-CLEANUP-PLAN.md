# Phase 5: test data cleanup, inventory and plan

**Status: waiting for the owner's approval. Nothing has been deleted.** Inventory taken 2026-10-30 with read-only queries on production. Names and phones are left out on purpose.

Owner's rule: bookings, payments and their proofs are all test data (confirmed by the owner). Keep all media and files, all links, «المسرح الأسود», settings, admins, grants, and the booking and payment system itself.

## 1. Inventory

### Delete (D1)

| Table | Rows | What |
| --- | --- | --- |
| `bookings` | 9 | All closed (5 cancelled, 4 withdrawn), on the 2 test events. One phone number across all 9, the same as the technical support contact |
| `payments` | 4 | 460 in total, instapay |
| `proofs` | 11 | 9 with a file in R2, 2 whose file is already gone |
| `handovers` | 3 | 2 handovers and 1 void |
| `reminders` | 1 | Sent for a test booking |
| `book_news` | 2 | The 2 test events |
| `notify_outbox` | 2 | `booking.new` |
| `comp_versions` | 1 | The withdrawn `test` competition |
| `store_items` | 1 | «محفظة» |
| `activity` | 67 | 49 on the test entities, plus `participant` 14, `shopitem` 3, `points` 1 |

### Delete (R2)

9 proof files in `athanasios-proofs-prod`.

### Already empty

`participants`, `points_ledger`, `season_totals`, `submissions`, `redemptions`, `comp_live`, `member_outbox`, `payment_claims`, `event_notices`.

### Keep, though test-related

| Item | Why |
| --- | --- |
| 2 test events and 3 test cards in the drafts (`evt-4011914c`, `evt-59f41592`, `act-8282cddb`, `act-5079631e`, `act-ce15d7c6`) | Not shown to visitors. The admin refuses to delete a published event, and a direct SQL delete would break the drafts' version and hash |
| 2 `event_cfg` rows | Belong to those events. Neither can be booked: `/v1/book/state` answers `not_found` |
| Stubs `competition/test`, `events/test`, `events/booking-test-temp` | Say `withdrawn` and hold no data. Worker tests read `competition/test/comp.json` |
| `comp_package` (2 rows) | Built by the system, replaced by the next publish |
| `published_revisions` | Publish history, needed for rollback |
| Season `sea-first` | The Worker needs an active season. It holds no points |

### Keep, real

All of `media_files` (65 rows) and the R2 media; `media`, `links`, `contacts`, `sections`, `types`, `pages`, `page_media`, `pay_methods`, `servants`, `settings` in the drafts; `pay_dest`; `admins`, `admin_grants`, `notify_prefs`, `notify_settings`; `settings`; every other `activity` row.

The media library includes `spongebob_1mb`, which looks like a test image. It stays under the owner's rule.

### Not inventoried: the competitions spreadsheet

The old competitions and points live in Google Sheets, which can't be read from here. The same spreadsheet holds real tabs, so it must never be wiped as a whole.

| Candidates, after the row counts | Never touched |
| --- | --- |
| `Competitions`, `Questions`, `Snapshots`, `Submissions`, `Participants`, `PointsLedger`, `StoreItems`, `Redemptions`, `PushSchedule`, `Seasons`, `SeasonTotals` | `Servants`, `PayMethods`, `Pages`, `PageMedia`, `Events`, and all content tabs |

## 2. Plan

**Stage A: backups and the spreadsheet count. No deletion.**
1. Fresh D1 export, encrypted with the existing age recipient, stored outside the repository. Decrypt it and compare table counts to prove it can be restored.
2. Download the 9 proof files, encrypted, to the same place.
3. Record the D1 bookmark and a baseline of counts and hashes.
4. Owner: in Google Sheets, File → Make a copy of the competitions spreadsheet.
5. Push a read-only `cleanupInventory()` to `@HEAD` only; the API stays at @59. Owner runs it from the editor; it logs row counts per tab, and no personal data. Then it is removed from `@HEAD`.

**Stage B: D1 and R2.**
1. Delete the rows in §1 by exact id, as one atomic batch, in this order: `activity`, `notify_outbox`, `reminders`, `handovers`, `proofs`, `payments`, `bookings`, `book_news`, `comp_versions`, `store_items`.
2. Delete the 9 R2 files by the keys saved in step A1.
3. Verify (§3).

**Stage C: the spreadsheet. Shown to the owner again before it runs,** with the counts from step A5. It keeps tab headers and touches only the listed tabs.

## 3. Done when

- Every table in §1 has the expected count, and the 9 R2 files are gone.
- Media, links, `pages`, `pay_dest`, `admins`, `admin_grants`, `settings` and the live site's hashes equal the baseline.
- `/` and the «المسرح الأسود» page load. The admin's bookings page opens empty, without errors.
- A booking on a staging fixture event still works (`book-check`).

## 4. Rollback

- **Proof files and rows:** restore from the backups in stage A.
- **Whole D1:** `wrangler d1 time-travel restore athanasios-prod --bookmark=<A3>`, valid for 7 days. It replaces the whole database, so it also undoes anything saved after the bookmark. The encrypted export has no time limit while it is kept.
- **Spreadsheet:** the owner's copy from step A4.
- No Worker, site or Apps Script version changes in stage B.
