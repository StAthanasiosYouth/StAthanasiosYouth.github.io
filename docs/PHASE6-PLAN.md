# Phase 6 plan

Started 2026-11-02 on the owner's order. Six steps, one at a time. Each step needs the owner's choice to start, and each production release needs its own approval.

**Progress: Step 4 of 6 in progress. Slice 4a passed on Staging (2026-11-03) and stays off production until the sending moves. Slice 4b waits for the owner's order.**

## 1. Official scope

`docs/BACKEND-MIGRATION.md` §22, row 6: competition authoring, seasons, push through Queues and cron, the schedule, the route service, and the native-app push groundwork (§22.2.4). `docs/BOOKING-PHASE1-COMPLETION-PLAN.md` adds: the push channel moves to Worker FCM, the claim feed retires, and announcements, new events and new competitions stay push and bell only (decision D5).

**Gate:** Apps Script has no live callers.

**Not in Phase 6:**
- The real-device notification audit (7a), retiring Apps Script and removing `script.google.com` (7b), the test data cleanup (7c).
- The admin redesign (Phase 8), the native apps (Phase 9), the games (Phase 10). New admin UI uses existing components only.
- Anything already done in Phase 5 and the improvements batch: accounts, sign-in, member email, participants, the ledger, the store, the competitions runtime, and the competitions' admin (`PHASE5-PLAN` §3o).
- The batch's three follow-ups stand on their own: the old failing tests, picture sizes on phones, the first real competition.
- `NOTIFY_ROUTER`, `NOTIFY_EMAIL` and `PERMS_ENFORCE` don't change without the owner.

## 2. Inventory (2026-11-02, read from the code at `1569b7e`)

`HEAD` equals `origin/main`. Both Workers' `/v1/health` answer 200. The last Worker CI run (`46d6edd`) succeeded.

**Tests at the start:**
- Worker: 414 of 414 pass.
- Site units: 757 of 759 pass. The two failures are #12 (competition and trip) and #693 (`admin/config.js`). The batch's record counts two old unit failures; this run did not compare them by name against the earlier commit.
- Browser tests were not run in this step.

**The site still calls Apps Script for:**
- `route` (`assets/js/map-config.js`)
- `pushSubscribe` and `pushUnsubscribe` (`assets/js/push-config.js`)

**The admin still calls Apps Script.** Of 140 `api*` names, 81 go to the Worker as content or competitions calls and 7 as platform calls. The other 52:

| Group | Names | Where they belong |
|---|---|---|
| Push | `apiPushState`, `apiPushCheck`, `apiSendPush`, `apiAdminPushSubscribe`, `apiAdminPushUnsubscribe`, `apiAdminPushDevices`, `apiAdminPushRemoveDevice`, `apiPushAuto`, `apiPushSchedule`, `apiPushScheduleCancel` | Step 4 |
| Seasons | `apiSeasons` (the competition screen's picker and chip), `apiSeasonSave`, `apiSeasonClosePreview`, `apiSeasonClose` | Steps 2 and 3 |
| Store schedule | `apiShopSchedule`, `apiShopScheduleSave` | Step 3 |
| Old wallet and store screens, hidden once accounts are on | `apiWallet`, `apiWalletParticipant`, `apiWalletAdjust`, `apiWalletSync`, `apiShopItems`, `apiShopItemSave`, `apiShopItemDelete`, `apiShopRedemptions`, `apiShopRedemptionStatus` | Step 5: confirm unreachable |
| Menu numbers | `apiBadges` | Step 2 |
| Settings and tools | `apiCheckGithub`, `apiCheckMedia`, `apiResolveMapsUrl`, `apiSetLiveStage`, `apiFetchMediaUrl`, `apiPlanMigration`, `apiMigrate`, `apiAgeRules`, `apiAgeRulesSave` | Step 5 |
| Admins | `apiAdmins`, `apiSetAdminName`, `apiActivity` (emergency fallback) | Step 5 |
| No caller in the admin | `apiAddAdmin`, `apiRemoveAdmin`, and the 12 `apiParticipant*` names | Leave with Apps Script in 7b |

**Apps Script still runs in the background:** `bookNewsTick` every 5 minutes, `pushScheduleTick` and `pushScheduleDaily`, plus jobs that ride on admin calls (`activityForward_`, `notifyClaimRun_`, `compSigPush_`, `workerSyncAdmins_`). As admin calls leave Apps Script, the riding jobs run less often, so each move has to check what it was carrying.

**What already exists on the Worker for push:** the `JOBS` queue, the minute cron, and `notify_outbox` with its router. There is no FCM sender outside the generated Apps Script bundle, no device table for push, and no `push_schedule`.

## 3. Gaps found

1. **A competition's points don't land in its own season.** `COMPETITIONS.md` §18.6 says they do. `walletStmts` in `worker/src/comp/runtime.js` always uses the active season and never reads the competition's `seasonId`. So a competition tied to a closed season earns in the active one, where the contract says it writes nothing. No real competition has run yet.
2. **The season picker reads the Sheets.** `C.seasons` calls `apiSeasons` on Apps Script, while the accounts screen and the ledger use D1's `seasons`. A season made in the accounts screen doesn't reach the picker.
3. **D1 seasons have less than the contract.** No `notifyDays` column, and the admin view has no `maxTheoretical` or `expected`. The Worker's store schedule has no notify choices.
4. **Two schedules.** Automatic store and season pushes read Apps Script's dates, so today they are kept equal to the Worker's by hand (`PHASE5-PLAN` §3e).
5. **The menu numbers come from Apps Script.** `adminBadges_` counts the Sheets' submissions and requests, which stopped changing when those moved to D1. So an answer waiting for review in D1 never reaches the menu. Fixed in Step 2.
6. **Closed-app admin push is unproven** (test B-NA4VS was accepted by FCM and never shown), and `adminPresent_` can't see who has the panel open.
7. **With `NOTIFY_ROUTER = 0`, admin pushes come from Apps Script's old path.** The claim feed only serves the router. Retiring Apps Script needs either the router on or the old path ported (decision 2 below).
8. **Push to a booker** is marked "Phase 6, not built" in `PAYMENT-REMINDERS.md`, but it isn't in the roadmap row (decision 3 below).
9. **A prize's picture is lost on save (found in Step 2, read from the code, not yet run).** The accounts screen's picker sends a library id as text, and `itemFields` in `worker/src/store/shop.js` stores only an object, so the picture becomes empty with no error. The store is closed and its one prize has no picture. Fixed in Step 3.
10. **`comp-sig` still carries the prizes (found in Step 2).** With the drafts on the Worker, only `view.items` from that push is still read, and it comes from the frozen Sheets. So a picture used only by a prize made on the Worker isn't protected from a purge. Reading the prizes from D1 ends the need for this push, and it belongs with gap 9.
11. **Removing a picture never saw the competitions (found in Step 3, in production since `795b55c`, 2026-10-27).** `apiDeleteMedia` and `apiPurgeMedia` answer with the panel's state, so the build's setup replaced `compDraft_` before `mediaUsage_` read it. The check then saw no competition, question or prize, and a purge could delete a picture in use. Fixed in Step 3. Whether any picture was purged this way hasn't been checked.
12. **The seasons screen can't add a season (found in Step 3).** It only closes the active one and names the next, so the competition picker's list can't get a planned season from the panel. The route exists. Added with the screens, after the preview.

## 4. Steps

Nothing here is gated by a number of days. A step is done when its checks pass.

### Step 1: Review and preparation (done)
This file, and pointers to it from the handoff and the roadmap.

### Step 2: Competitions' admin, what's left
No rebuild. The competition screens stop depending on Apps Script.
- The season picker and chip read `GET /v1/admin/points/seasons`.
- `apiBadges` answers from the Worker, from D1.
- Check whether `compSigPush_` and the module switches sent to Apps Script are still needed, and stop what isn't.
- Any competition feature the owner lists (decision 1).

**Done when:** opening and editing a competition makes no Apps Script call on Staging, the numbers match D1, and `comp-admin` browser tests pass.

**As built:**
- `GET /v1/admin/comp/badges` (any admin, as `apiBadges` was) and `GET /v1/admin/comp/seasons` (`competitions.view`, as `apiSeasons` was; the older seasons route needs `points.view`).
- `admin/boot.js` sends `apiSeasons` and `apiBadges` there only while the Worker writes the competitions (`compWorker`). If `COMP_DRAFTS` goes back, they go back to Apps Script with it.
- No migration, no change of screen, and no Apps Script deploy.
- `compSigPush_` stays until Step 3 (gap 10). The module switches stay until Step 4, because Apps Script's scheduled pushes read them.
- The picker now lists D1's seasons, but points still land in the active season until Step 3 (gap 1).
- Decision 1: no feature was added, since the owner listed none.

**Tests on Staging Worker `9f1225de`:**
- Worker: 416 of 416.
- Site units: 757 of 759, the same two failures as at the start of this phase.
- Browser: `content-worker` 3 of 3, including a new test that the panel never asks Apps Script for these two, through the panel's real code and its heartbeats. `comp-admin` 1, 3, 4 and `youth-admin`: 34 of 34.
- `scripts/comp-reads-check.mjs` live on Staging: no credential and a non-admin are refused, the numbers equal D1, and a season made on the accounts side reaches the picker. It removes its own season.

**Not checked:** the panel in a browser against Staging itself, because Google sign-in isn't possible there from this session. The browser test runs the same Worker code in the page's place. The rest of the competition screens' calls were checked in Step 1's inventory.

**Release (2026-11-02, on the owner's approval):** `1c89aa0` through CI, Worker `e3f3a476`, rollback `b8f6ca82`. Then `6d003b4`, the panel, live on Pages. No migration and no switch changed.

**After the release:** `/v1/health` answers 200, both new routes answer 401 without a credential, and `/admin/` answers 200 with the new `boot.js`. `tools/account-prod-check.mjs` and `tools/account-badge-prod-check.mjs` pass. `wrangler tail` for 90 s: 2 events, both `ok`, no exceptions. That was little traffic, so it says little.

**Not checked on production:** a signed-in call to the two routes, since that needs the owner's sign-in. The owner can confirm it by opening a competition in the panel, where «الموسم» should list the seasons from «حسابات الشباب». D1 counts weren't read, because this release only adds reads.

**Back:** `npx wrangler rollback b8f6ca82` from `worker/` and revert the `admin/boot.js` commit, the page first. Nothing in the data changes.

### Step 3: Seasons and points
- Points land in the competition's season, and write nothing when that season is closed (gap 1). Reports and «نقاطي» stay correct.
- A prize keeps its picture, and the purge guard and the build read prizes from D1, so `comp-sig` stops being needed (gaps 9 and 10).
- The season's reminder days and the store schedule's notify choices move to Step 4c, with the sending that makes them work. A control that does nothing until then would mislead, so Step 3 needs no migration.
- The seasons screen gains adding and editing a season, and closing picks the next season from the planned ones (gap 12).
- The admin's season view gains `maxTheoretical`, `expected` and the competition count, and prizes gain their percent of the season's maximum.
- Close a season on Staging with a prize request open and with none. Close twice, and refund in the right season.

**Done when:** those cases pass in Worker tests and live on Staging, and the ledger's totals are unchanged by the release.

**As built (Staging Worker `8a4b806c`):**
- `walletStmts` reads the competition's `seasonId` from its draft in the query that already read the active season, so a submit makes no extra trip. A choice D1 doesn't know counts in the active season, so no points are lost. Corrections stay in the row's season, and a closed one is never written.
- The seasons list carries `maxTheoretical`, `expected`, `competitions`, and for the active one `topBalance` and `participants`. Prizes carry `pctOfMax`, and the list `seasonMax`.
- A prize stores its library id. The admin reads the id back, and a member gets the file only when it's published and not removed. The Worker stamps `publishedAt` once the file is on the site.
- The usage check and the build read the prizes from D1, and `comp-sig` changes nothing once the drafts are the Worker's (gaps 9, 10, 11).
- The picker's `seasonId` isn't in the published definition, as on Apps Script: changing it needs no publish.

- The seasons screen and the prize list follow the preview the owner approved (https://claude.ai/artifact/2ZGRiet8jQfiYvqQTLHViB), on existing components.
- A fix beside it: a prize request's buttons pushed the store screen 75 px sideways on a phone. They wrap now.

**Tests:**
- Worker: 422 of 422.
- Site units: 757 of 759, the same two failures.
- Browser: `youth-admin`, `comp-admin` 1, 3, 4 and `admin-layout` 36 of 36, `content-worker` 3 of 3. Phone width 375: no sideways scroll on the seasons, closing, store and prize screens.
- Live on Staging: `season-check` 20 of 20, `comp-check` 39 of 39, `comp-reads-check` passes.

**Not checked:** the new screens signed in against Staging itself (no Google sign-in from this session; the browser tests use a fake Worker for this screen), a real phone, and `comp-sig` sent by Apps Script itself (a signed call stood in for it).

**Release (2026-11-02, on the owner's approval):** `6a2b935` through CI (test and deploy jobs both passed), Worker `aa069df6`, rollback `e3f3a476`. Then `24194da`, the panel, built by Pages at 21:43 UTC. No migration and no switch changed.

**After the release:** `/v1/health` answers 200, the season, badge and store routes answer 401 without a credential, and `/v1/comp/me` answers 401 without a session. The live `admin-app.js` and `admin.css` carry the new code. `tools/account-prod-check.mjs` and `tools/account-badge-prod-check.mjs` pass. `wrangler tail` for 90 s: 5 events, all `ok`, no exceptions. That was little traffic.

**Not checked on production:** a signed-in call or the new screens signed in, which need the owner's sign-in. D1 counts weren't read in this step: only a competition's new submission or a prize save writes differently, and no such write has happened. The owner can run the usual count query if wanted.

**Back:** `npx wrangler rollback e3f3a476` from `worker/` and revert the admin commit, the page first. Points landed in a chosen season stay there. No migration.

### Step 4: Push (four slices, each tested on Staging and reported on its own)
- **4a, the device table.** One table for admin, member and anonymous devices, with `platform`, `app_version`, topic preferences and an optional account link. One register endpoint. The site and admin move behind a switch. `PushSubs` and the admin devices are copied once: dry run, then apply, on the owner's approval.
- **4b, the sender.** FCM v1 with WebCrypto. Fan-out in Queue messages of 45 tokens, never in the cron. One message model builds the `webpush`, `android` and `apns` blocks, and carries path links, badge and group fields. Dead tokens are pruned. Admin pushes go straight from the outbox, the claim feed retires, and presence reads D1.
- **4c, schedule and links.** `push_schedule` on the minute cron with the §18.5 kinds. One schedule for the store and seasons (gap 4). «إشعارات الموبايل» moves to the Worker. New events and competitions go push and bell only (D5).
- **4d, groundwork.** The rest of §22.2.4: config-driven origins and the new FCM web client API. A Staging check with one web token and one simulated native token, then a real closed-app push re-run with a tap that opens the exact record.

**Done when:** every slice passes Worker tests and its Staging check, one owner device receives with the app closed, and the switch back has been tried.

**Release order, decided in 4a:** Apps Script keeps sending from its Sheets until the Worker's sender is live. So a device that registered only on the Worker before then would get nothing, and the slices reach production together at one cutover after 4d, with its own approval:
1. Migration and Worker, with `FCM_SERVICE_ACCOUNT` set by the owner.
2. Copy the devices (`PUSH_IMPORT = dry`, then `apply`).
3. Point the site (`push-config.js workerUrl`) and the panel (`PUSH_DEVICES = worker`) at the Worker.
4. Copy again for what registered in between. A row already on the Worker stays.
5. The Worker sends, and Apps Script stops.

**4a as built (Staging Worker `908fe1d6`, migration `0025`):**
- `push_devices`: one table for visitors' and admins' rows, with `platform` (web, android, ios), `os`, `app_version`, `topics`, an account link column, and `fails`.
- Visitors: `POST /v1/push/subscribe` and `/unsubscribe`, one token in or out, nothing read back. Admins: `/v1/admin/push/{subscribe,unsubscribe,devices,remove}`, the same answers as Apps Script. Five devices per admin, and the two audiences never mix.
- The copy: `settings.PUSH_IMPORT`, a signed question to Apps Script (`pushExport`), which changes nothing there. A row already on the Worker stays, no token in a report. It needs Apps Script's new call, so that deploy joins the cutover.
- `panel`: `admin/boot.js` follows `boot.push`. `site`: `workerUrl` stays empty, and a test holds it there until the cutover.
- Linking a device to an account is only a column so far. It's built with decision 3 in 4c.

**4a tests:** Worker 431 of 431, site units 758 of 760 (the same two failures), `content-worker` 4 of 4, `push-hint` and `admin-rel` 15 of 15, `push-devices-check` live on Staging 15 of 15. The copy ran through the fake Apps Script only, because Staging has none. No real token and no notification were involved.

### Step 5: Integration
- `route` moves to the Worker: the key as a secret, a D1 cache, a daily budget.
- The Settings and tools calls, `apiAdmins`, `apiSetAdminName` and age rules move or retire.
- The old wallet and store screens are confirmed unreachable.
- Each background job on Apps Script gets a Worker home or a reason to end.
- The sync routes the Worker no longer needs are listed for 7b, not removed.

**Done when:** a pass through every admin screen on Staging, with the network logged, shows no Apps Script call.

### Step 6: Tests and close
Full Worker, unit and browser suites against the start of this phase. A security review of the new public endpoints. Push fan-out and route under load on Staging. D1 counts before and after the last release. The gate measured on production: Apps Script's executions show no live caller. The closing record goes here, and the handoff is updated.

## 5. Rules for every step

- Staging first, then a report, then the owner's approval for production.
- A visual change gets an interactive desktop and mobile preview first, and waits for approval.
- Migrations are additive and run before the Worker that needs them. Nothing is deleted or migrated without approval.
- One writer per module at any moment. Each move ships behind a switch with a tested way back.
- A `worker/**` push redeploys production through CI: the Worker commit goes first, the page after.

## 6. Decisions and what's needed from the owner

**Decisions, each asked at its step, with the default if the owner has no preference:**

1. **Step 2, extra competition features.** The code shows none missing against the plans. Default: none, the owner lists any if wanted.
2. **Step 4b, admin push with the router off.** Default: turn `NOTIFY_ROUTER` on at the push cutover, because it's the designed path and porting the old one would be built only to be thrown away. Needs the production value of the switch read first.
3. **Step 4c, push to a booker.** Default: a short nudge to devices linked to the booker's account, with no amounts and no separate `booking_push` table, using `reminders.channel = 'push'`.
4. **Step 5, `apiPlanMigration` and `apiMigrate`.** Default: retire them, if the check shows that move is finished.

**Only the owner can do:**
- Set the FCM service account as a Worker secret, Staging then production (Step 4b). The key is never shown here.
- Set `ORS_API_KEY` as a Worker secret (Step 5).
- Renew the Staging `GITHUB_TOKEN` before **2026-11-20**, the day it expires. Staging publish and mirror checks need it.
- Run the production D1 reads. They are refused from this session.
- Use a real phone for the closed-app test (Step 4d).
