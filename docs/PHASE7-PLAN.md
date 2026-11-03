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

## 3. Progress

- Step 1: built; Worker 478/478, site units 765/766 (the one is the known #12), Staging Worker `22d290d4` (sync switch 401 → 410 → 401;
  sampled rows land). Browser suite: see the closing record.
