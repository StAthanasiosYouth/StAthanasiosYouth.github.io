# Phase 7 — Apps Script retirement

Started 2026-11-03 on the owner's order, from the state at the close of Phase 6 (`docs/PHASE6-PLAN.md`, closing record).
Scope as already planned: BACKEND-MIGRATION §22 row 7 and §25, BOOKING-PHASE1 §10 row 7 (7a audit, 7b retirement), the
items Phase 6 carried to 7a and 7b, and the test data cleanup deferred to 7c (`docs/PHASE5-CLEANUP-PLAN.md`).

Working mode (owner, 2026-11-03): each step is built and tested on Staging, then its safe part goes to production without
stopping. **Nothing old is deleted for good without a backup and the owner's approval** (data, Sheets, Drive, the Apps Script
project or its deployments).

## 1. Where Phase 6 left it

- The panel and the site call Apps Script for nothing (Phase 6 Step 5 gate). The Worker serves every action.
- Apps Script still had: its API deployment `@61` (and an old recovery-admin deployment `@14`), and three triggers:
  `bookNewsTick` (every 5 min, the claim heartbeat), `pushScheduleTick` (one-off) and `pushScheduleDaily` (daily, also the
  admins' names sync). With `PUSH_SENDER = worker` they send nothing.
- Still named in shipped files: the `/exec` URL in `admin/config.js` and `assets/js/push-config.js` (each the way back of an
  earlier cutover), `script.google.com` / `script.googleusercontent.com` in every page's CSP and in the page builders'
  CSP (`apps-script/CompModel.gs` → `worker/src/content/gs.gen.js`, `admin/review-kit.js`), and the Worker's `APPS_SCRIPT_URL`.
- The Worker still called Apps Script in one place on production: `compModules` after «إعدادات المسابقات» is saved
  (fire and forget; nothing on Apps Script reads it since the competitions moved). Everything else that asks Apps Script
  (`compPackage`, `compCommit`, `compExport`, `pushExport`) runs only when `COMP_DRAFTS` is not `worker` or for the one-time moves.
- The Worker's `/v1/sync/*` routes (signed, Apps Script → Worker) are still open.

**What stays on purpose:** `apps-script/*.gs` is the source of the Worker's content engine (`tools/build-worker-gs.mjs` builds
`gs.gen.js` from it) and of the admin's screens (`tools/build-admin.mjs`). It is code the Worker runs, not Apps Script running.
The Google client ID (`…apps.googleusercontent.com`) is Google Sign-In, not Apps Script.

## 2. Steps

| Step | What | Where it runs |
|---|---|---|
| 1 | Code off Apps Script: site, admin, Worker (below) | Staging, then production |
| 2 | Apps Script retired: version `@62` answers `retired`, its triggers remove themselves, the Worker's sync routes closed by a switch | Production (Apps Script has no Staging) |
| 3 | 7a: the browser tests left behind by Phases 3–5; the gate read again; the notification audit | Local + production reads + the owner's phone |
| 4 | 7c: the test data cleanup — fresh inventory and backups; **deletion only on the owner's approval** | Production reads |
| 5 | Archive: Sheets and Drive read-only, the deployments archived — **owner's approval**; the 90-day window | Owner |
| 6 | Closing record, §25 checklist | Docs |

### Step 1 — code off Apps Script

- **Site:** `push-config.js` loses `apiUrl`; `push.js` registers on the Worker only (`pushRequest` removed). The CSP of the
  hand-written pages (`index.html`, `events/`, `pages/`, `points/`, `competition/`, `account/`, `404.html`) and of the page
  builders (`COMP_SITE_CSP`, so `PAGE_SITE_CSP`) drops `script.google.com` and `script.googleusercontent.com`. The pages the
  publish writes (`events/<slug>/`, `competition/<slug>/`, `black-theatre/`) get the new CSP at the next publish (never edited by hand).
- **Admin:** `admin/config.js` loses `apiUrl`. `boot.js` opens with the Worker's platform alone; a call with no Worker route
  fails with a clear Arabic message instead of a request (none is expected: Phase 6's 21-screen walk had none). `admin/index.html`
  (and its source `tools/source/admin-index.html`) drops the Apps Script hosts from `connect-src`.
- **Worker:** `APPS_SCRIPT_URL` empty on production; `compModules` is sent only when it is set. New D1 switch
  `settings.APPS_SCRIPT = 'retired'`: every `/v1/sync/*` route answers **410** before its signature is read (deleting the row
  is the way back). `API_LOG_SAMPLE = 10` keeps about one in ten routine requests in `api_log`, so §25's p95 gate can be read
  (until now `api_log` kept only errors and requests over 1.5 s).
- **Tests:** the admin's browser tests that still drive the panel through the fake Apps Script world (`tests/fakes/gas.mjs`)
  run with the page's CSP bypassed (`tools/lib/admin-server.mjs interceptGoogle`, only when the world has `post`; the
  CSP itself is checked by `tests/refine-b.test.mjs` and `final-m.test.mjs`). The production-shaped test (`content-worker.e2e`)
  runs with production's config (no `apiUrl`): the 21-screen walk asks Apps Script nothing, and a call with no Worker route
  fails with the clear message and no request; only its two rollback sections get the old `apiUrl`. Rewriting the
  legacy-transport tests for the Worker belongs with Phase 8's single transport (BACKEND-MIGRATION §22.1).

### Step 2 — Apps Script retired

Backups first: the live code of `@61` and `HEAD` (identical) pulled to `D:/private_projects/athanasios-backups/2026-11-03-phase7-apps-script/`
(outside the repository). Then:

1. `@62` = the live `@61` + `Retired.gs` + one line at the top of `doPost`, `doGet`, `bookNewsTick`, `pushScheduleTick`,
   `pushScheduleDaily` (`apps-script/Retired.gs` says which). `clasp push` of that folder (never the repository folder as it is),
   then the API deployment and the old `@14` recovery deployment both moved to `@62`.
2. Triggers run the saved code: the next run of any of them deletes every trigger of the project and stops.
3. Done when: a POST to the `/exec` answers `retired`; the Worker's `SYNC_TS_notifyclaim` stops moving (it moved every 5 min);
   then `settings.APPS_SCRIPT = 'retired'` on production D1 and an unsigned sync call answers 410.

**Way back** (90 days): `clasp deploy -i <API id> -V 61` (and `-i <@14 id> -V 14`); re-arm the triggers from the editor
(`enableBookingAlerts`, `enableAutoPush`); delete the D1 row `APPS_SCRIPT`; restore `apiUrl` / `APPS_SCRIPT_URL` from git.
Meaningful only with a reverse export (§23 row 7): `/v1/sync/content-export` stays in the code for it.

## 3. Closing record (2026-11-03)

**Step 1 — code off Apps Script: LIVE.** Staging Worker `22d290d4` (sync switch 401 → 410 → 401, sampled rows land). Production:
`main` `129734f` (commits `a2688a0`, `1477042`, `129734f`), pages live 19:48 UTC, Worker `0c0b4fc5` by CI at 19:49 UTC (back: `bb36f6b5`).
Checked on production: `/v1/health` ok; `admin/config.js` and `index.html` carry no `script.google`; the home page loads with no
console error and no request to Apps Script; the admin gate reaches «ادخل بحساب جوجل» (not "not set up"); the only console errors
on `/admin/` are Google Sign-In's own inline styles, as before. Sampled `api_log` rows arrive (heartbeat 109–144 ms, a content call 307 ms).

**Step 2 — Apps Script retired: DONE.** `@62` on the API deployment and on the old `@14` recovery deployment, ~17:12 UTC: GET and POST
answer `{"ok":false,"code":"retired"}`. The claim stamp `SYNC_TS_notifyclaim` (every 5 min until then) has stayed at 17:08:34 UTC
for over 2.5 hours: no trigger runs. Production D1 `APPS_SCRIPT = retired` set at 19:42 UTC; since the Worker release every
`/v1/sync/*` answers 410. Backups of the live code: `D:/private_projects/athanasios-backups/2026-11-03-phase7-apps-script/`.

**Tests.** Worker 478/478. Site units 765/766 (#12, known). Browser 461: the production-shaped `content-worker.e2e` 7/7 (21-screen walk,
no Apps Script call; with no `apiUrl` a call with no Worker route fails clearly, no request). Three route tests in `final-m.e2e` failed
on the Phase 7 code only (their fake answered through Apps Script's redirect, now outside the CSP): fixed (`129734f`), the file is now
as on `origin/main` (30/31, #7 fails there too). The other failures fail on the starting code too: the 33 of Phase 6's list (7a), plus
`final-r.e2e` 1, 2, 4, 6 (they refuse Phase 6's `athanasios-admin.place` key), `account-badge.e2e` 8 (the photo sheet) — checked
on a temporary worktree at `origin/main` `fc98200`. **No regression from Phase 7.** Updating those old tests stays a 7a item.

**Step 3 — 7a.** `docs/NOTIFICATIONS-AUDIT-REPORT.md`: server side complete, no failure found; Android passed (Phase 6). Left for the
owner's devices: iOS home-screen app, desktop, one real new booking's admin push with the app closed. Note: §4.8 set the audit as
the gate *before* retirement; Apps Script already sent nothing (Phase 6), so retiring it first removes nothing the audit needs.

**Step 4 — 7c: backups and inventory done, deletion NOT run (waits for the owner).** Encrypted D1 export (counts checked against
live before encrypting), the 9 proof files that still exist (2 were already gone, as on 2026-10-30), D1 bookmark
`00000197-00000392-00005118-c819c1d6e406f21aa53b0ce6c7079ccc`: `D:/private_projects/athanasios-backups/2026-11-03-phase7-pre-cleanup/`.
Since 2026-10-30 the data changed: bookings 10 (new: `bkg-177e022fb41b`, confirmed, event `evt-1295c819`, 2026-10-31), competitions
`tgrba-tshghyl` and `msabqa-nqat` with 2 graded submissions, 1 participant, 1 points row. Which of them are tests is the owner's call.

**Step 5 — archive: waits for the owner.** Sheets and Drive made read-only (after File → Make a copy); the two deployments archived
in the Apps Script editor; the project kept 90 days, then deleted. None of it is needed for the site to work.

### §25 checklist after Phase 7

| # | Item | State |
|---|---|---|
| 1 | No file references `script.google.com`; CSP doesn't allow it | Shipped config and every hand-written CSP: done. Left: the pages the publish writes (new CSP at the next publish), `apps-script/` (the Worker's builder source), the tests' fake Apps Script, `tools/deploy-api.mjs`, docs — removed with item 8 |
| 2 | No active deployment, no triggers | Triggers: none. Deployments answer `retired`; archiving them waits for the owner |
| 3 | Sheets and Drive read-only, no code reads them | No live code reads them. Read-only: owner |
| 4 | p95 < 600 ms per routine action from `api_log` | Measurement on since 19:49 UTC (`API_LOG_SAMPLE = 10`). Sample size: 200 sampled rows per routine route (or all routes after 30 days); read then |
| 5 | Publishing never waits for Pages | Done (Phase 4) |
| 6 | Nightly backup + a restore drill after the last phase | Nightly backup runs; a restore drill after Phase 7 is still to do |
| 7 | Two Cloudflare owners, 2FA, runbook | Owner (open since Phase 1) |
| 8 | Rollback windows closed, old Apps Script code deleted | After the 90 days (2027-02-01); `apps-script/` must first stop being the Worker's builder source |

### Way back

| What | How | Time |
|---|---|---|
| Worker | `wrangler rollback bb36f6b5` | seconds |
| Sync routes | `DELETE FROM settings WHERE key = 'APPS_SCRIPT'` | seconds |
| Pages | revert `a2688a0` on `main` | ~1 min |
| Apps Script | `clasp deploy -i <API id> -V 61`, `-i <@14 id> -V 14`; re-arm `enableBookingAlerts`, `enableAutoPush` from the editor | minutes |

## 4. 7c — the cleanup list for the owner's approval (read 2026-11-03, production, read-only)

Nothing below has been deleted. Backups: `D:/private_projects/athanasios-backups/2026-11-03-phase7-pre-cleanup/` (D1 export, 9 proof
files, bookmark `00000197-00000392-00005118-c819c1d6e406f21aa53b0ce6c7079ccc`). Names and phones are left out on purpose.
All three booking events are tests by their titles: `evt-4011914c` «اختبار نظام الحجز - مؤقت», `evt-59f41592` «test-2»,
`evt-1295c819` «تجربة حجز» (its page already says it is not available).

### List A — test data, delete (one atomic D1 batch by exact id, then R2)

| Table | Rows | Ids |
|---|---|---|
| `bookings` | 10 | `bkg-ef4a39eebab4`, `bkg-db173f55b264`, `bkg-84354476ae40`, `bkg-33109c56d428`, `bkg-321ee0e7609c`, `bkg-474bc7b56d4f`, `bkg-328726b48e15`, `bkg-fcaa44d738df`, `bkg-0e0c76d0a486`, `bkg-177e022fb41b` (new since 10-30, confirmed, on «تجربة حجز») |
| `payments` | 4 | `pay-420b161b13bb`, `pay-bfda1d37b3ce`, `pay-206715ea77b4`, `pay-52bc2be16bcb` (460 in total) |
| `proofs` | 11 | 9 linked to the bookings above, 2 unlinked (`prf-ylitlzf5`, `prf-ozzauqaz`, files already gone) |
| R2 `athanasios-proofs-prod` | 9 files | the keys in `proofs/keys.txt` of the backup |
| `handovers` | 3 | `hnd-03548f4c76f5`, `hnd-25bf79734cc3`, `hnd-3aaca5b84f70` |
| `reminders` | 1 | `rmd-fa317f461ad9` |
| `book_news` | 3 | the three test events |
| `notify_outbox` | 2 | `booking.new` (sent) |
| `store_items` | 1 | `i-9cc596e4` «محفظة» |
| `comp_versions` | 1 | `cmp-9227de8c` «test» (withdrawn) |
| `activity` | 22 | `booking` 20, `shopitem` 2 |

### List B — the owner decides (default in brackets)

| Item | What it is | Default |
|---|---|---|
| Competition «تجربة تشغيل» `cmp-9308ac4d` | 2 versions, 1 graded submission `s-47b8d9bc6544` | test → withdraw it in the panel, then delete the submission and versions |
| Competition «مسابقة نقاط» `cmp-8a21f34d` | 1 version, 1 graded submission `s-503569b948a0`, which gave 100 points | test → as above, plus the points row `led-8041a8cc6e134bb0` and the season total rebuilt |
| Draft «مسابقة نقاط (نسخة)» `cmp-3d4405b4` | unpublished copy | delete it from the panel |
| Participant `p-ahtj7xz3` | one real account (holds the 100 points) | **keep** the account; only its test points go with the row above |
| Event «تجربة حجز» `evt-1295c819` | published, bookable until 2026-11-06 | withdraw it in the panel now (the drafts stay, as with the other two) |
| `activity` on competitions (21) and the participant (16) | history of those tests | delete with their competitions; keep the participant's |

### Keep (unchanged rule)

All media and R2 media, links, contacts, sections, pages, «المسرح الأسود», settings, admins, grants, `pay_dest`, the 3 events' drafts and
`event_cfg` rows, the withdrawn stubs, `published_revisions`, season `sea-first`, every other `activity` and `notify_outbox` row,
and the booking and payment system itself. The competitions spreadsheet (Sheets) is not touched here: it goes read-only with the archive.

### Run (after approval) and check

1. Fresh count of every table above; stop if any count differs from this list.
2. One D1 batch by exact id (order: activity, notify_outbox, reminders, handovers, proofs, payments, bookings, book_news,
   comp_versions, store_items; List B rows only as approved), then the 9 R2 files.
3. Done when: the counts are as expected; media, links, pages, admins, grants, settings unchanged; `/`, «المسرح الأسود» and the admin's
   bookings page open without errors.
4. Way back: the encrypted export, or `wrangler d1 time-travel restore athanasios-prod --bookmark=<new bookmark taken in step 1>` (7 days).

### 7c result (owner approved List A + List B defaults, 2026-11-03)

- Recount matched the list exactly; bookmark before the batch: `00000199-000000a8-00005118-d04f10b379425de556b60b25d60ac225`.
- One D1 batch, 13 statements, **62 rows** removed: List A (bookings 10, payments 4, proofs 11, handovers 3, reminders 1,
  book_news 3, `booking.new` outbox 2, «محفظة», the `test` competition's version, activity 22) and the data parts of List B: the
  2 test submissions, the 100-point row `led-8041a8cc6e134bb0` and its closed-season snapshot (`sea-first`, `p-ahtj7xz3`). The account stays.
- R2: the 9 backed-up proof files deleted (one checked gone). The 2 without a file were already gone.
- After: all those tables 0; `comp_versions` 3 (the two test competitions, kept until they are withdrawn); activity 342 → 320;
  media 65, admins 3, settings 64, drafts 126, participants 1, events 3 — unchanged. `/`, «المسرح الأسود» load; «تجربة حجز» says not available.
- **Left for the owner, in the panel:** withdraw «تجربة تشغيل» and «مسابقة نقاط», delete the draft «مسابقة نقاط (نسخة)», then publish.
  After that their 3 `comp_versions` rows and 21 competition activity rows go in one more batch. The admin's bookings page should open
  empty without errors (needs a signed-in admin).
- Way back: the encrypted export of 2026-11-03, or time travel to the bookmark above (7 days, replaces the whole database).
