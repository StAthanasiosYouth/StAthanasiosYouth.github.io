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
