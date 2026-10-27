# Phase 4 — content, pages/events and media on the Worker

Spec: `docs/BACKEND-MIGRATION.md` §22 row 4. Started 2026-10-27. Owner rules: staging first; no production
deploy, migration, Apps Script deploy, switch flip or data copy without the owner's explicit approval; one writer per
module; no day-based gates (a step is done when its checks pass).

## 1. Audit (P4-1, read against the code on the work branch = `origin/main` + docs)

**Drafts today.** Two spreadsheets, read by `readDraft_()` (`apps-script/Store.gs`):

| Kind | Tab | Spreadsheet | Key | Written by |
| --- | --- | --- | --- | --- |
| settings, sections, links, contacts | Settings, Sections, Links, Contacts | content Sheet | key / key / id / id | `Code.gs` api* |
| sessions, news, games, notifications, activities, types | same names | content Sheet | date / id / id / id / id / key | `Items.gs` apiSaveItem & co., `Import.gs` |
| media | Media | content Sheet | id | `Media.gs` (bytes in Drive) |
| pages, page_media, events, servants, pay_methods | Pages, PageMedia, Events, Servants, PayMethods | competitions spreadsheet | id / id / id / id / key | `Pages.gs`, `PayDest.gs` |

About 45 content `api*` functions (Code 14, Items 5, Pages 21, Media 10, PayDest 1) run under the script lock and
return the whole panel state (`apiStateFor_`: draft + `buildPublicContent` + layout + status) — the 9–15 s panel open
measured in Phase 3.

**Cross-module writers found** (they decide the order below):
1. `CompAdmin.gs compSyncCard_` (competitions, Phase 5–6, stays on Apps Script) writes the competition's card into
   the content Sheet's **Activities** tab; the content publish (`Hub.gs`) reads competitions to link them.
2. `Pages.gs homeSync_` writes the page/event home card into **Activities** (moves with Phase 4 — fine).
3. `PayDest.gs` approves servant payment numbers and pushes `pay_dest` to the Worker (moves with servants).
4. Booking reads the **published** `event.json` into `event_cfg` (`book/event.js`) — unaffected by where drafts live.
5. The publish build (`Publish.gs`, `Content.gs`, `Pages.gs`, `CompPublish.gs`, `Review.gs`) reads the Sheets.

## 2. Reconciled step order

The proposed P4-1 … P4-8 hold, with one correction: **the drafts' writer can switch to D1 only together with the
publish** (P4-4 builders + P4-6 Worker publish). While Apps Script publishes, it reads the Sheets, so a D1 writer
before then would publish stale content, and a dual write is forbidden. So:

- P4-1 … P4-3 build the D1 side complete but **dormant**: D1 is a checked copy (imports allowed while
  `CONTENT_DRAFTS='0'`); the Worker's save routes refuse unless `CONTENT_DRAFTS='1'`.
- The flip of `CONTENT_DRAFTS` happens once, at the P4-8 cutover, after P4-4/P4-6 are on staging.
- Conflict for P4-6 (owner decision needed before batch 2): competitions stay on Apps Script until Phase 5–6, but
  content.json links them and they write an Activities card. Options: (a) Apps Script posts the competition card and
  the competitions' public index to the Worker (signed sync) when a competition is saved/published; (b) move only
  the competition **card** ownership into the Worker's activities and read competitions' public data from
  `published_revisions` (`kind='comp'`, already there since Phase 2). Recommended: (b) + a small signed card sync.

## 3. D1 design (migration `0016_content_drafts.sql`)

- `draft_rows (kind, id, pos, version, kver, data, hash, deleted_ms, updated_ms, updated_by)` — one row per entity.
  `data` = the row exactly as Apps Script reads it (Sheet column keys), so the builders get the same input and the
  reverse export is a straight copy. Deviation from §12's "one table per entity": one table keyed by `kind`
  (16 kinds share the same version/delta/hash logic; columns are checked against the `.gs` specs by a test).
- `draft_kinds (kind, version, base, rows, hash, …)` — per-kind version for "same" / delta reads (§15);
  `base` = from which version deltas are complete (an import resets it).
- `draft_imports` — every copy (dry/apply) with per-kind source and D1 hashes.
- Switch `settings.CONTENT_DRAFTS` = `'0'` (seeded).
- Concurrency (P4-2): `UPDATE … WHERE version = ?` → `stale` (409) «حد عدّل ده قبلك»; edit locks stay for the UX.
- Private columns: `servants.phone/instapayNumber/walletNumber`, `media.driveId/thumbDriveId` — never in the panel's
  generic read, only in the reverse export (`system.manage`) and never in any published file.

## 4. Copy and rollback (P4-1, done locally)

Hash recipe (both sides): row = `sha256(JSON.stringify(row in column order))`; kind = `sha256(rows.map(key + ':' +
rowHash).join('\n'))`. The Worker recomputes everything and refuses any difference, a missing kind, an unknown
column, a duplicate key; applies each kind whole in **one D1 batch** (one transaction, one `INSERT … SELECT FROM
json_each(?)` per kind), then re-reads D1 and compares every kind hash.

- Apps Script (`apps-script/ContentExport.gs`, owner-only, run from the editor): `contentMigrateDryRun`,
  `contentMigrateApply`, `contentRestoreDryRun`, `contentRestoreApply`. Restore writes D1 back by column name, keeps
  hand-added columns, blanks leftover rows, and re-hashes the Sheets after writing.
- Worker: `POST /v1/sync/content-import`, `POST /v1/sync/content-export` (signed), `GET /v1/admin/content/drafts`
  (`content.view`; `?kinds=…&since=kind:version`), `GET /v1/admin/content/export` (`system.manage`),
  `GET /v1/admin/content/status` (`system.view`).

## 5. Steps and checks

| Step | Scope | Done when |
| --- | --- | --- |
| P4-1 ✔ local | Audit, `0016`, copy/verify/export/read APIs, Apps Script copy + rollback | Worker tests incl. real `.gs` round trip; staging `scripts/content-check.mjs` (pending approval) |
| P4-2 ✔ local | Worker saves for the content-Sheet kinds (links, sections, contacts, settings, items) with row versions, activity, locks; dormant behind `CONTENT_DRAFTS` | Parity tests: same drafts, same refusal texts as Apps Script; stale write refused |
| P4-3 ✔ local | Pages, page media, events, servants, pay methods (+ home cards, `pay_dest` derived in the Worker) | Same as P4-2; booking checks (`book-check`, `rehearsal`) unchanged on staging (pending) |
| P4-4 | Builders bundled from the pure `.gs` into the Worker and the admin; browser-side Review | Built content = Apps Script build, byte for byte, on fixtures + a staging copy |
| P4-5 | Drive library → R2, upload pipeline, background GitHub commit of derivatives | Every media id resolves; counts/hashes equal |
| P4-6 | Publish fully in the Worker (validate, revisions, restore), competitions bridge (§2) | Publish < 0.4 s on staging; mirror still background |
| P4-7 | Panel on D1 state, «راجع وانشر» 4 → 3 steps, performance | Panel open < 1 s measured in a real browser |
| P4-8 | Staging rehearsal of copy → flip → rollback (restore + flip back), production cutover plan | Owner approval |

Rollback at any point before the flip: nothing reads D1 drafts. After the flip: `CONTENT_DRAFTS='0'` +
`contentRestoreApply` (D1 → Sheets, re-hashed) + Apps Script publish mode back — rehearsed on staging in P4-8.

## 6. Saves on the Worker (P4-2 / P4-3)

**Approach: the same code, new storage.** The ~45 content calls are not re-written. `tools/build-worker-gs.mjs` bundles
the Apps Script files (the ones the Sheets tests already run in Node) into `worker/src/content/gs.gen.js`, a factory
created fresh per request. `src/content/runtime.js` gives it sheets held in memory, built from D1's draft rows
(`services.js`: Sheets semantics, a synchronous SHA-256 for `Utilities.computeDigest`, no network: `UrlFetchApp`,
`DriveApp` … throw). After the call it diffs every tab the call wrote, exactly as the copy does (`contentExportKind_`),
and writes one D1 batch:

- a guard per written row (`draft_guard` CHECK): the row is still the version read, else the batch rolls back → `stale`
  (409 «حد عدّل ده قبلك»); the editor can send `expect: { 'links:<id>': version }` for the version it opened;
- rows (data → `version + 1`; order only → `pos`, no version bump, so a reorder never conflicts with an edit),
  tombstones for deletes, `draft_kinds.version + 1` per changed kind (the panel's delta read);
- the Activity rows the call noted (`activity`, source `worker`; merge of repeated edits not done here);
- `pay_dest` recomputed from the servants (`payDestPayload_`) when servants changed or a number was approved.

Edit locks: the Phase 3 locks in D1 are handed to the code as `API_REQUEST_.platformHolders` — the same
`assertUnlocked_` refuses (`locked`). Permissions: `Grants.gs API_PERMS` (the doPost table) via `requirePerm`.
A tab outside the drafts written by a call → nothing is saved (error). Competition secrets (`compEnsureSecrets_`)
are a no-op here (they stay Apps Script's until Phase 5–6).

Route: `POST /v1/admin/content/call { fn, args, expect }` (panel session required) → `{ result, changed, versions }`.
`result` is what Apps Script returns, except the whole panel state (`apiStateFor_`): the panel reads
`GET /v1/admin/content/drafts?since=…` instead (P4-7 wires the admin to it).

Not on the Worker yet: media upload / library (P4-5), review / publish / live stage (P4-4, P4-6),
`apiResolveMapsUrl` (network; P4-6), the competitions' own calls (Phase 5–6).

**Activity merge (kept).** The Worker hands the code the recent D1 Activity rows (10-minute window, last 15) as its
Activity tab, so `activityMergeTarget_` merges a repeat edit exactly as today; a merged row updates the same D1 row
(`contentActivityStmt`, same id, count + 1).

**Admin pushes (kept).** While `NOTIFY_ROUTER=0`, Activity.gs decides the push on the Worker too
(`row.notified = 'pending:now|cooldown'`). Such rows go to `content_notify`; Apps Script pulls them
(`POST /v1/sync/content-notify`, signed, at most once each, at most once a minute) inside `activityPending_` — the
same occasions it sends its own pending pushes (quiet calls, the 5-minute trigger) — appends them to its Activity
sheet as «pending» and sends them with `activityDispatchPending_` (same devices, cooldowns, texts, deep links).
Off until the owner sets the Script Property **`CONTENT_WRITER=worker`** at the cutover (Apps Script deploy needed
then: `ContentExport.gs` + the one-line hook in `Activity.gs`).

Rebuild after any change to the bundled `.gs`: `cd tools && node build-worker-gs.mjs` (a Worker test fails when stale).

## 7. Staging record (2026-10-27)

Staging Worker `f2742d8c` (migration `0016` applied to `athanasios-staging`). Production untouched.

| Check | Result |
| --- | --- |
| `scripts/content-check.mjs` (P4-1: dry run, apply, per-kind hashes, reverse export, 2,500-row kind in one statement, refusals) | all ok (2,500 rows: 9.8 s, one-time copy) |
| `scripts/content-saves-check.mjs` (P4-2/P4-3 with staging `CONTENT_DRAFTS=1` for the run only) | 32/32 ok; content calls median 219 ms, p90 248 ms, max 365 ms |
| `book-check`, `rehearsal`, `claims-check`, `age-check`, `platform-check` | 31, 58, 23, 9, 26 ok — 0 failed |

After the run: staging `CONTENT_DRAFTS` back to `'0'`; staging `pay_dest` restored from a snapshot taken before
(the approval check replaces the approved set). Staging D1 keeps the fixture drafts (harmless while `'0'`).
Local: Worker 262/262; site/admin 761/764 (the 3 known failures, files untouched).

Production release when approved (changes nothing visible; every switch stays off): migration `0016` on
`athanasios-prod` → Worker via `main` (CI). Apps Script (`ContentExport.gs`, `Activity.gs` hook) can wait for
the cutover step that uses it.

### 7.1 Production release (2026-10-27, owner approved)

`main` `265f590` (= work branch `ce69a75` + `4771343`): migration `0016` applied to `athanasios-prod` first (D1
bookmark before it: `00000163-00000196-00005111-fb7b644cbc8f72750017eab5a9b6ae96`), then CI deployed Worker
**`30f6cbc0`** (previous: `3a9f9c4d`). Checks after: `/v1/health` ok, `/v1/health/deep` 16 migrations, storage ok;
`/v1/admin/content/call` and `/v1/sync/content-import` refuse without auth (401); public content 200; no 5xx in
`api_log`; site and admin 200. Switches unchanged: `CONTENT_DRAFTS=0` (new), `NOTIFY_ROUTER=0`, `NOTIFY_EMAIL=0`,
`PERMS_ENFORCE=0`, `PAY_REQUESTS`/`CONTENT_SERVE` unset, `BOOKING_MODULE=1`, `PAY_DEST=1`, `ADMIN_PLATFORM=1`.
New tables empty (no copy made). Apps Script not deployed (still @57; `ContentExport.gs` waits for the cutover).
Rollback: Worker `3a9f9c4d` (`wrangler rollback`); the migration is additive and nothing reads it while the switch is `0`.
