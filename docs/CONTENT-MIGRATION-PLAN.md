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

## 8. Competitions in the Worker's publish (batch 2; owner decision 2026-10-27: hybrid, one button)

Competitions stay on Apps Script until Phase 5–6 (their draft, the keyed version hash with their secret, Snapshots,
`liveVersion`). Apps Script builds their part (`apps-script/WorkerComp.gs compPackage_`: `compBuildPublic_` with the
Worker's own library index, their files with the shell, the review words) and the Worker keeps the last one
(`comp_package`, migration `0017`). It asks again only when:

- the competitions' draft changed — Apps Script pushes its signature after each admin call
  (`compSigPush_` → `POST /v1/sync/comp-sig`; the signature ignores `liveVersion` / `publishedAt` / `updatedAt`,
  so a publish does not invalidate it);
- the library rows it was built against changed; a competition time it depends on has passed (`stableUntil`);
- a publish needs it prepared (Snapshots written: mode `prepare`) and the kept one is not.

Worker → Apps Script: `POST <APPS_SCRIPT_URL> { fn: 'workerSync', args: [{ ts, sig, payload }] }` (HMAC with the
shared sync secret, ±5 min, each signature answered once). After the publish went live the Worker tells Apps Script
what went live (`compCommit` → `compAfterCommit_`); a failure is retried by the queue (`comp.commit`).
A publish whose competitions' part cannot be had is refused (`comps`, 503) — never published without them.
Staging (no Apps Script of its own): `COMPS_SOURCE=none` builds without competitions; ignored in production.
Speed: a publish without competition changes never waits for Apps Script; one after a competition change does
(Apps Script build + Snapshots, a few seconds), like today.

## 9. Review and publish on the Worker (P4-4, P4-6)

- **Server:** `apiReview` / `apiPreview` / `apiPublish` run through `POST /v1/admin/content/call` — the same
  `reviewNow_` / `publishNow_` code (`content/publishing.js` hooks): what is live = `published_revisions`; files go
  to `preparePublish` (Phase 2's checks: paths, private keys, sizes) and are stored **in the same D1 batch** as the
  drafts the publish changes (pages' / events' `liveV`, Activity «نشر»); the GitHub mirror follows in the background.
  One publish at a time: `settings.PUBLISH_CLAIM` (2-minute claim). The reviewed revision must still be the built one.
- **Browser (moved from Phase 2):** `admin/review-kit.js` (built by `tools/build-review-kit.mjs` from the pure
  builders) computes the review from `GET /v1/admin/content/review-input` (drafts as the builders read them, the live
  content.json, the competitions' part when current). Same result as the Worker's review (test). When the
  competitions' part is not current, the panel asks the Worker's review instead. Wiring into «راجع وانشر»: P4-7.

## 10. Media library on R2 (P4-5)

- Bucket binding `MEDIA` (`athanasios-media-staging` / `athanasios-media-prod` — **the production bucket must be
  created before the production deploy**). Rows keep `r2:media/<name>` in `driveId` / `thumbDriveId`.
- Upload: `POST /v1/admin/media/upload` (the same `apiUploadMedia`, 12 MB body for a video + poster): bytes to R2
  before the D1 batch; `media_files` rows; GitHub copy at upload time in the background (`media.mirror` job), then
  `publishedAt`. A publish first sends anything still waiting (a failure stops the publish, as with Apps Script).
- Preview reads R2; purge deletes the R2 objects. Library rows/flows otherwise unchanged (Media.gs).
- One-time copy: `mediaCopyDryRun` / `mediaCopyApply` (Apps Script editor, owner) after `contentMigrateApply`;
  each file SHA-256-checked (a picture's full file also against the row's own hash), stored once, the row pointed
  at R2. `GET /v1/admin/content/media-status` shows rows still on Drive and files waiting for the site.

## 11. Batch 2 staging record (2026-10-27)

Staging Worker **`87e0098c`** (migration `0017` applied to `athanasios-staging`; bucket `athanasios-media-staging`
created and bound as `MEDIA`). Production untouched. `CONTENT_DRAFTS=1` on staging for the checks only, back to `'0'`
after; staging `pay_dest` restored from the snapshot taken before.

| Check | Result |
| --- | --- |
| `scripts/content-publish-check.mjs` (upload → R2, preview, background GitHub copy + `publishedAt`, Worker review, browser kit = Worker review, stale refused, publish live at once, repeat publish, mirror caught up) | 11/11 ok — upload 0.9–1.1 s, review 0.24–0.30 s, kit 35 ms (+ input 0.22 s), publish 0.9–1.25 s, repeat 0.65–0.73 s, GitHub copy 7–10 s in the background |
| `scripts/content-saves-check.mjs` (P4-2/P4-3 regression) | 32/32 ok — median 215 ms, p90 245 ms |
| `scripts/publish-check.mjs` (Phase 2 path after the `preparePublish` refactor) | 21/21 ok |
| `book-check`, `age-check`, `platform-check` | 31, 9, 26 ok |
| `claims-check`, `rehearsal` | 23, 58 ok (re-run 10 minutes apart: back-to-back runs hit the staging booking rate limit — expected, as the handoff notes) |

Found and fixed on staging: a background Media update (`publishedAt`, the Drive copy's R2 refs) bumped the kind's
version but not its hash — the integrity check caught it; `updateMediaRow` now rewrites the kind hash in the same
guarded batch (local test added).

Not met yet: **publish < 0.4 s** — 0.9–1.25 s on staging (the first includes reading `pages/index.html` from
GitHub, then cached). P4-7 is where this is tuned (it was planned there: "optimize real-world publishing").
Staging has no competitions (`COMPS_SOURCE=none`): the hybrid path is covered by the local tests against the real
`.gs` (review, prepare, commit, reuse, unreachable → refused).

Production release (when approved) needs, in order: R2 bucket `athanasios-media-prod` created → migration `0017` →
Worker via `main` (wrangler.jsonc adds `MEDIA` + `APPS_SCRIPT_URL`). Every switch stays as it is; nothing reads the new
code while `CONTENT_DRAFTS=0`. Apps Script (`WorkerComp.gs`, the `Api.gs` hooks, `ContentExport.gs` media copy)
ships at the cutover.

### 11.1 Production release (2026-10-27, owner approved)

`main` **`795b55c`** (= work branch `c9f84ad` docs + `a578547` batch 2). Order: R2 bucket `athanasios-media-prod`
created → migration `0017` on `athanasios-prod` (D1 bookmark before it:
`00000164-0000008a-00005111-0bc60b9d92e1caacbce717dc9d786717`) → CI deployed Worker **`0a63c6b1`** (previous:
`30f6cbc0`). Checks after: `/v1/health` ok; `/v1/health/deep` 17 migrations, storage ok; new routes refuse without auth
(content call, media upload, review-input 401; comp-sig, media-copy unsigned 401); public content, site, admin 200; no
5xx in `api_log`. Switches unchanged: `CONTENT_DRAFTS=0`, `NOTIFY_ROUTER=0`, `NOTIFY_EMAIL=0`, `PERMS_ENFORCE=0`,
`PAY_REQUESTS`/`CONTENT_SERVE` unset, `BOOKING_MODULE=1`, `PAY_DEST=1`, `ADMIN_PLATFORM=1`; `PUBLISH_CLAIM` empty.
New tables empty. Apps Script still @57 (WorkerComp.gs and the Api.gs hooks ship at the cutover).
Release tree tests: Worker 270/270 (one notify-email timing flake on the first run, 7/7 alone and 270/270 on re-run);
the touched site/admin tests pass except the known `admin/config.js` one.
Rollback: Worker `30f6cbc0` (`wrangler rollback`); `0017` is additive and unread while `CONTENT_DRAFTS=0`; the empty
bucket can stay.

## 12. Admin integration and speed (P4-7)

- **One switch decides, the page follows.** The Worker's session answer carries `boot.content` = `'worker'` while
  `settings.CONTENT_DRAFTS = '1'`, else `'sheets'`. `admin/boot.js` then sends the content calls (`CONTENT_FNS`, the
  same list as the Worker's `CONTENT_CALLS`, a test compares them) to `POST /v1/admin/content/call` (an upload to
  `/v1/admin/media/upload`), with the same names, arguments and answers; `apiPublishRefresh` → `apiState`. Otherwise
  everything goes to Apps Script as today. The page decides nothing about who writes.
- **The panel state comes from the Worker**: `apiState` and every save answer with the full `apiStateFor_` state,
  built there (drafts from D1, activity from D1, status with the kept competitions' part — a save never waits for
  or fails on Apps Script; only the review and the publish ask it when the competitions changed).
- **«راجع وانشر» — 3 steps** (owner 2026-10-22): مراجعة → نشر → ظهر على الموقع whenever the publish is the Worker's
  (`status.mode = 'worker'` or content on the Worker). No GitHub / GitHub Pages wait; the mirror stays in the
  background (its lateness shows in the status pill, as in Phase 2). The 4-step flow remains only for
  `PUBLISH_MODE = github` (the Phase 2 rollback).
- **The review in the page**: `admin/review-kit.js` (loaded on first use) from `/v1/admin/content/review-input`;
  falls back to the Worker's review when the competitions' part is not current or anything fails.
- **One writer on the Apps Script side**: with the Script Property `CONTENT_WRITER = worker`, `mutate_`,
  `pagesWrite_` and `publishNow_` refuse (`moved`: «المحتوى بقى بيتحفظ على السيرفر الجديد») — an old open tab or
  the recovery admin can't write the frozen Sheets.
- **Speed** (staging, from this machine; network round trip 80–260 ms):

  | | server | client |
  | --- | --- | --- |
  | panel state (`apiState`) | 70–130 ms | 180–300 ms |
  | save | ~100 ms | 300–390 ms |
  | review (Worker) | ~75 ms | 250–300 ms |
  | review (browser kit) | — | 10–35 ms + 0.22–0.29 s input |
  | publish (changed) | 160–200 ms | **336–403 ms** |

  Done for it: one D1 round trip for the load (writer switch, competitions view, media waiting folded in), the
  claim taken in the read batch and released in the write batch, only live hashes read (not every file body), the
  page shell kept in D1, Apps Script told about competitions after the answer, Activity read only since the last
  publish. A publish right after library uploads first sends the waiting pictures to GitHub (by design, once).
  Every content reply carries `timing` (server phases) for later checks.
- Browser e2e `tests/content-worker.e2e.mjs` (real Chrome, real Worker in process): panel 149 ms, save via the
  Worker (Sheets untouched), review computed in the page, 3 steps, publish click → live 46 ms; the switch back.

## 13. Production cutover runbook (P4-8) — needs the owner's approval for every step

**Before (no visible change; all dormant):**
1. Release batch 3 to `main` (Worker + admin files) — owner approval. `CONTENT_DRAFTS` stays `'0'`.
2. Apps Script deploy (@58: `WorkerComp.gs`, `ContentExport.gs`, the `Api.gs` / `Activity.gs` / `Code.gs` /
   `Pages.gs` / `Publish.gs` hooks) — owner approval. Inert until `CONTENT_WRITER` is set.
3. Production `GITHUB_TOKEN` (Worker) can write the site repository (it already mirrors Phase 2 publishes).

**Cutover (owner present; tell the admins not to edit for ~10 minutes):**
1. Apps Script editor → `contentMigrateDryRun` → every kind `ok`, `problems` empty.
2. `contentMigrateApply` → `state: ok`, every kind `ok` (D1 = the Sheets, hash per kind).
3. `mediaCopyDryRun` → the file count; `mediaCopyApply` → `failed: []`; `GET /v1/admin/content/media-status` → `onDrive: 0`.
4. Script Property **`CONTENT_WRITER = worker`** (Apps Script stops writing content; the competitions' signature push starts).
5. D1: `wrangler d1 execute athanasios-prod --remote --command "UPDATE settings SET value='1' WHERE key='CONTENT_DRAFTS'"`.
6. Owner reloads `/admin/`: the panel opens from the Worker; one small save; «راجع وانشر» (3 steps); publish; the site shows it.
7. Watch: `api_log` (no 5xx), the publish status pill (mirror not late), `content_notify` drained by Apps Script, a booking page.

**Rollback (any time; rehearsed on staging — §14):**
1. D1 `CONTENT_DRAFTS = '0'` (seconds): the Worker refuses content calls; admins reloading go back to Apps Script —
   which still refuses writes (step 4 below not yet), so nothing can be lost in between.
2. Apps Script editor → `contentRestoreDryRun` → `contentRestoreApply`: D1 → the Sheets (every kind re-hashed equal,
   the edits made on the Worker included).
3. Delete the Script Property `CONTENT_WRITER`: Apps Script writes and publishes again (PUBLISH_MODE stays `worker`).
4. If the published site must go back too: «ارجع للنسخة دي» (Phase 2 restore) to the publish before the cutover.
5. Code: `wrangler rollback` to the Worker before batch 3 only if the code itself is the problem (with
   `CONTENT_DRAFTS = '0'` it is inert anyway).
Known limit after a rollback: pictures uploaded while the Worker wrote are on GitHub (published at upload) and in R2,
not in Drive: Apps Script's library preview can't show their draft thumbnails; publishing them is unaffected
(`publishedAt` is set).

## 14. Batch 3 staging record (2026-10-27)

Staging Worker **`aeefdba0`**. Production untouched. Staging `CONTENT_DRAFTS` set to `'1'` only for the runs, back to
`'0'`; `PUBLISH_CLAIM` empty; staging `pay_dest` restored from its snapshot.

| Check | Result |
| --- | --- |
| `scripts/cutover-rehearsal.mjs` — copy → media copy → switch on → panel / save / review (server + kit) / publish → reverse copy into the Sheets (= D1, Worker edits included) → switch off (Worker refuses content: one writer) → «ارجع للنسخة دي» | all ok. Timings: copy dry 1.1 s, apply 1.6 s, media copy 1.2 s, panel state 0.18–0.27 s, save 0.39 s, review 0.30 s, kit 10 ms, publish after uploads 3.4 s (one-time GitHub copy of waiting pictures), next publish 0.69 s, reverse export 0.21 s, Sheets written 11 ms, publish restore 0.52 s |
| timing probe (§12 table) | publish 160–200 ms server / 336–403 ms client |
| `content-publish-check`, `content-saves-check`, Phase 2 `publish-check` | all ok |
| `book-check`, `platform-check`, `claims-check`, `rehearsal` | 31, 26, 23, 58 ok (spaced 10 min: staging rate limits) |
| `age-check` | 9 ok (re-run spaced; the first run hit the rate limit right after book-check) |

Local: Worker 273/273; site/admin 761/764 (the 3 known); browser e2e 19/19 (`content-worker`, `admin-platform`,
`admin-app`). The other admin e2e failures (media upload / library / hub, 8 tests) fail the same way on the code
before batch 3 (checked on a clean worktree of `01aa3a3`): not from Phase 4.

Found and fixed during the batch: the review kit's load order (CompModel before Pages) and its Apps Script time helper;
a publish claim left held when Apps Script was unreachable (now always released); a page shell never cached when the
repository has none (fetched every publish).
