# Phase 6 plan

Started 2026-11-02 on the owner's order. Six steps, one at a time. Each step needs the owner's choice to start, and each production release needs its own approval.

**Progress: Steps 4 and 5 of 6 closed (2026-11-03). Step 6 started.** Earlier: Step 4 of 6 in progress. Slices 4a and 4b passed on Staging (2026-11-03). Slice 4c passed on Staging the same day, its screens on the approved preview. The push cutover ran on production on 2026-11-03, steps 1 to 7, under the owner's end-to-end approval. Step 8, the real phone test, waits for the owner's hands. Step 5 starts alongside. Nothing reaches production before 4d and a review of the whole cutover plan (owner, 2026-11-03).**

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

**The push cutover (approved by the owner as a plan, 2026-11-03; each step still waits for its own approval).** Slices 4a to 4d reach production together, here, each step only on the owner's approval. Apps Script keeps sending from its Sheets until step 7. Every step says how to check it and how to go back.

*Before (nothing changes):*
- B1. The owner sets `FCM_SERVICE_ACCOUNT` on the production Worker. The key is never shown here: `cd worker && npx wrangler secret put FCM_SERVICE_ACCOUNT`.
- B2. The owner reads the production D1 counts as usual, plus the Script Property `PUSH_AUTO` (is Apps Script's automatic push on?) and anything in the «الإرسال المتجدول» list due during the cutover window.
- B3. Pick a quiet hour with nothing scheduled to send.

*1. Migrations `0025`, `0026`, `0027` on production* (owner: `npx wrangler d1 migrations apply athanasios-prod --remote`). Additive: three new tables and one nullable column. They go first, because the new Worker writes there: saving a season, the store's schedule, the daily housekeeping. **Check:** the migration list shows them applied. **Back:** nothing to undo, the old Worker doesn't read them.

*2. The Worker.* The branch's Worker commits reach `main` and CI deploys them. With every switch unset it behaves as today. **Check:** CI's own run passes (read by its id), `/v1/health` answers 200, the new push routes answer 401 without a credential, and `wrangler tail` shows no exceptions. **Back:** `npx wrangler rollback <the version before>`.

*3. The pages (panel and site), after the Worker.* `push-config.js workerUrl` is still empty, so the site registers on Apps Script as today. The panel gets the store's and seasons' new fields and follows `boot.push` and `boot.pushSend`, both still Apps Script. **Check:** the live `admin-app.js` carries `data-season-days`. **Back:** revert the page commit, before any Worker rollback.

*4. Apps Script deploy:* the deployed version (@60, the same as its head) plus only Step 4's changes, never the folder as it is in git: its `appsscript.json` web-app access and older competition changes differ from what is live. Adds `pushExport` for the copy and `pushOnWorker_`, which stops every send there once its `PUSH_SENDER` property is set. **Check:** `PUSH_IMPORT = dry` gives a report with the counts. **Back:** `clasp deploy -i <API id> -V <the version before>`.

*5. Copy the devices.* `PUSH_IMPORT = dry`, read `PUSH_IMPORT_REPORT`, then `apply`. A row already on the Worker stays, and nothing is deleted from the Sheets. **Check:** `added` matches the dry run's counts. **Back:** the rows are unused until step 6.

*6. Point the devices at the Worker,* then copy again. `settings.PUSH_DEVICES = worker`, and a site commit sets `workerUrl`. Devices registering from now on use their Firebase Installation ID. A second `apply` brings what registered on Apps Script in between. Keep this step and step 7 close together: a device that registered only on the Worker gets nothing until the Worker sends. **Check:** a new subscribe lands in `push_devices`. **Back:** `workerUrl` empty and `PUSH_DEVICES` removed. A device that took an FID re-registers on Apps Script with its token at its next weekly refresh, because the site leaves the FID out there.

*7. The Worker sends.* Set `settings.PUSH_SENDER = worker`, `settings.NOTIFY_ROUTER = 1` (decision 2; the first tick marks the old backlog, so nothing floods), and Apps Script learns it from its next claim reply (`sender`), which sets its Script Property `PUSH_SENDER = worker` by itself. Apps Script then sends nothing: no button, no schedule, no admin push. **Check:** «إشعارات الموبايل» shows the Worker's subscribers and log, and the «الإرسال المتجدول» list is the Worker's. **Back:** remove `PUSH_SENDER` and set `NOTIFY_ROUTER = 0`; the next claim clears the Apps Script property. Apps Script sends from its Sheets again, and the claim feed hands it the admin rows.

*8. The real phone test (owner's choice, 2026-11-03: here, in the cutover).*
- Visitor: on the owner's phone, open the site, turn notifications off and on from the bell (a fresh registration on the Worker), and close the browser or app. Send one real live bell item from «إشعارات الموبايل». **Done when:** it arrives with the app closed, and a tap opens that exact item.
- Admin: in the panel on the phone, «أجهزتي» turns this device on again. Another admin edits an item. **Done when:** the push arrives closed, and a tap opens that item in the panel (`/admin/#open/…`).
- If either fails: back with step 7's way back, then find out why on Staging.

*9. After.* Watch for a day with `wrangler tail`, `push_sends` (sent, failed, removed) and the activity log for «إرسال تلقائي ما اتبعتش». Apps Script's push tabs stay as they are until 7c's clean-up.

**4a as built (Staging Worker `908fe1d6`, migration `0025`):**
- `push_devices`: one table for visitors' and admins' rows, with `platform` (web, android, ios), `os`, `app_version`, `topics`, an account link column, and `fails`.
- Visitors: `POST /v1/push/subscribe` and `/unsubscribe`, one token in or out, nothing read back. Admins: `/v1/admin/push/{subscribe,unsubscribe,devices,remove}`, the same answers as Apps Script. Five devices per admin, and the two audiences never mix.
- The copy: `settings.PUSH_IMPORT`, a signed question to Apps Script (`pushExport`), which changes nothing there. A row already on the Worker stays, no token in a report. It needs Apps Script's new call, so that deploy joins the cutover.
- `panel`: `admin/boot.js` follows `boot.push`. `site`: `workerUrl` stays empty, and a test holds it there until the cutover.
- Linking a device to an account is only a column so far. It's built with decision 3 in 4c.

**4a tests:** Worker 431 of 431, site units 758 of 760 (the same two failures), `content-worker` 4 of 4, `push-hint` and `admin-rel` 15 of 15, `push-devices-check` live on Staging 15 of 15. The copy ran through the fake Apps Script only, because Staging has none. No real token and no notification were involved.

**4b as built (Staging Worker `31e03447`, migration `0026`):**
- `push/fcm.js`: the key, the access token (a WebCrypto RS256 JWT, kept in the isolate's memory, never in D1), `classify` as Push.gs, and one message model. The web gets data only, as `sw.js` expects. Android gets `android.notification` and iOS gets `apns` for Phase 9, with `tag`, `group` and `badge`. Links are paths, and an outside link or picture is dropped.
- `push/send.js`: a send is a `push_sends` row plus queue messages (`push.fanout`) of 45 device ids each, never tokens. `push_parts` takes each part once, so a message delivered twice sends nothing twice. Transient failures get one more round 30 s later.
- Clean-up: a dead token is deleted. One that failed 5 sends in a row goes too, and a visitor's device unseen for 270 days goes in housekeeping. A missing or refused key never counts against a device.
- `jobs.js`: a fan-out runs first in its consumer batch. Anything after it is sent again as the same job, which spends no retry, so a run stays under 50 outside requests.
- Admin pushes: with `PUSH_SENDER = worker` and the router on, the minute cron leases the outbox's push rows and sends each to the named admin's devices. The device whose panel is in sight in D1 `admin_sessions` is spared, unless the row is critical. The send's result answers the row: sent, a backoff, or dead after 5 tries. The claim feed then hands Apps Script nothing, and still says the router is on, so Apps Script's own admin pushes stay off.
- `publicSend`: Push.gs's rules for a send to visitors. A repeated key gets its first result, an item goes once, 60 s between sends, 10 a Cairo day, and an optional topic. The screen and the schedule that call it come in 4c.
- Routes: `POST /v1/admin/push/check` (`push.view`, validate_only, no device notified) and `POST /v1/admin/push/test` (any admin, their own devices only, once a minute).

**4b tests:** Worker 443 of 443, 12 of them new, against a fake FCM. Live on Staging, `push-sender-check` 9 of 9 against the real FCM with made-up tokens: Google accepted the key, the queue ran the part, and FCM refused the tokens, which were deleted. No device got anything. `push-devices-check` 15 of 15 again.

**4b not checked:** a delivery to a real device (4d, the owner's phone). The admin outbox path ran only in the unit tests, because Staging's `NOTIFY_ROUTER` is 0 and stays as it is. No setting was changed on Staging.

**The cutover as it ran (2026-11-03, owner's approval for the whole plan, no step-by-step stops):**
- B1–B3 by the owner. `FCM_SERVICE_ACCOUNT` was set on `athanasios-api`. Counts before: participants 1, ledger 1, redemptions 0, bookings 10, activity 324, outbox 8. `PUSH_AUTO = 1`. No real notifications to keep, because the site isn't launched (owner), so no pending `PushSchedule` row was carried over.
- 1. Migrations `0025`–`0027`. The list showed exactly those three. The counts afterwards matched, with `push_devices` at 0.
- 2–3. `main` `5cf8d11` → `21130f9`, CI run 41626502454 (test and deploy passed), Worker `c7c26096` (back: `8207618c`, the version the owner's secret made). `/v1/health` 200, the new admin push routes 401, and the live `admin-app.js` carries `data-season-days`.
- 4. Apps Script `@61` = `@60` (its head, checked equal) plus Step 4's five files only. The folder in git was **not** pushed as it is: its `appsscript.json` web-app access (`USER_ACCESSING`/`ANYONE` against the live `USER_DEPLOYING`/`ANYONE_ANONYMOUS`) and older competition changes differ from what is live, and pushing it would have changed who the public API runs as. Back: `clasp deploy -i AKfycbxJ…Km1 -V 60`. The public API answered as before.
- 5. `PUSH_IMPORT` dry: 4 visitor and 2 admin devices, no problems. Apply: 6 added.
- 6. `PUSH_DEVICES = worker`, and `main` `90d4623` sets `workerUrl`, live after 40 s. The second copy added 0. The browser test now fakes the Worker too. Before that change, its run had reached the real Worker from a test origin, CORS refused it, and production holds no such row.
- 7. **Found:** `NOTIFY_SINCE` was still set from 2026-10-21, with 51 activity rows waiting since then, so turning the router on would have pushed all 51 to the admins at once. In one batch: `NOTIFY_SINCE` removed, `PUSH_SENDER = worker`, `NOTIFY_ROUTER = 1`. The first tick marked the 51 as backlog (3) and sent nothing. Apps Script's next claim (11:33 UTC) carried `sender`, and it sends nothing since. `wrangler tail`: the minute cron's push tick ran with no exceptions.
- **Found at the first real send (owner):** «إشعارات الموبايل» said the key was missing and kept «إرسال» off. The Worker answered, not Apps Script (Apps Script has its key). The Worker now names the problem without a value, and production logs `not-json`: the secret holds only part of the file, typically its first line from a paste into a terminal. Fix: the owner uploads it again from the file itself, piped. The screen and «اختبر الإعداد» now show the Worker's own words (`616e818`, Worker by CI run 41630815979).
- **Step 8, visitor (owner, 2026-11-03):** after the key was uploaded again from its file, a real push reached an Android phone with the site closed, and the tap opened the bell. **Passed.** The bell, though, looked empty.
- **Why the bell was empty (found, not assumed):** the live content had the item, on the Worker and on GitHub alike, and a fresh browser showed it. A tap opens the bell at once from the page's older copy (its cached `content.json`, or a tab opened before the publish). The fresh file arrives a moment later, `current` takes it, but the open sheet never redrew. «يفتح الجرس» had nothing to do with it. Fixed in `bell.js` `refreshOpenBell`, called from `main.js` `show()`. A new `hub.e2e` test fails on the old code and passes on the fix. (`hub.e2e` tests 1 and 2 also fail on the old code, so they were failing before this change.)
- **A bell item goes as a push by itself (owner's request):** the notification made with the content («اعمل إشعار في الجرس لما تظهر») or in «الإشعارات» is sent once it is live, right after the publish (`ctx.defer`) or at its time (the minute cron), with no send button. This is `push/autobell.js`, behind `PUSH_AUTO_BELL`, and `PUSH_AUTO_BELL_SINCE` keeps anything older from being sent. It uses `publicSend`'s rules, so one item already sent from the screen or the schedule never goes twice. The bell's own retention is untouched. Found beside it: a send with no device left to reach stayed «sending» forever and blocked its item. It now finishes at once.
- **Tests:** Worker 462 of 462, site units 764 of 766 (the same two), `hub.e2e` new test passes. Live on Staging, `push-bell-check` 5 of 5: the cron sent the live item by itself, through the queue to the real FCM, once, and the switches and the live content were put back. Production: `main` `c9a4dc3`, Worker CI run 41635668521 passed, the site's bell fix is live, `PUSH_AUTO_BELL = 1` with `PUSH_AUTO_BELL_SINCE = 2026-11-03T14:29`, and nothing older was sent.
- **Confirmed by the owner (2026-11-03):** a content item published with its bell notification reached the phone by itself with the site closed, and the bell showed it. On production, `bell-notif-session-2026-11-08` was sent to 3 of 3 devices, none failed. **Step 4 closed.** The admin half of step 8 (a closed-app push from another admin's edit) is left to Step 6's checks, because it needs a second admin.
- *(was)* **Still for the owner:** publish a content item with its bell notification. The push should arrive by itself, and the tap should show it in the bell. Step 8's admin half (another admin's edit) is also still to do.
- Owner said no store or season reminders need moving now. They are set in the new screens when wanted.

**4c decisions:**
- **The automatic pushes (owner, 2026-11-03): a push goes at its moment, always.** It doesn't wait for a publish. Its bell item joins the site with the next publish, so the bell may not show one that no publish carried.
- **Decision 2:** production reads `NOTIFY_ROUTER = 0`, `NOTIFY_EMAIL = 0`, `PERMS_ENFORCE = 0` (owner, 2026-11-03, unchanged since). So the cutover turns the router on, as the default said, with the owner's approval at that step.
- **Decision 3, as built:** the booker's payment reminder goes to the devices linked to their account that kept «reminders», beside the email. It carries no amounts and needs no table: the send key is the booking, the stage and the day. `reminders` keeps its WhatsApp-only check, so no table rebuild.
- **D5:** announcements, new events and new competitions have no email path. They go through «إشعارات الموبايل» and the bell only. Nothing to build.

**4c as built (Staging Worker `09ae3510`, migration `0027`):**
- `push_schedule` (the §18.5 kinds) and `seasons.notify_days`. The store's `SHOP_NOTIFY` sits beside its dates in `settings`. Saving the store or a season syncs the schedule, and closing a season cancels its reminder. One schedule, from the Worker's own dates (gap 4).
- The minute cron (`scheduleTick`) sends what is due while `PUSH_SENDER = worker`, through `publicSend`: once per item, the cooldown and the day's cap. A cooldown waits for the next minute. Six hours overdue is skipped, and the admins get an activity row.
- The bell items: added inside the build's hub (`buildHub_` is now replaceable in `gs.gen.js`), so the review and the publish agree. While any exist, the browser's own review defers to the Worker's, as it does for the competitions.
- «إشعارات الموبايل» on the Worker: `/v1/admin/push/{state,send,auto,schedule,schedule/cancel}`, with Apps Script's answers. Candidates come from the Worker's live `content.json`, not a fetch of the site. The panel follows `boot.pushSend`.
- Account link: a visitor's subscribe with the account's own token (this device's, never a shared session's) links the row. A bad token never stops the subscribe, and the session is never stretched past the account's settings.
- Found and fixed beside it: 4b refused with codes the HTTP table didn't know (`rate_limited`, `unavailable`), which would have answered 400. Now `rate`, `busy`, `disabled`.

**4c tests:** Worker 455 of 455 (12 new in `push-schedule`, one in `content-publish` through a real publish). Site units 758 of 760, the same two failures. Browser: `content-worker`, `push-hint` and `admin-rel` 19 of 19. Live on Staging, `push-schedule-check` 10 of 10: the screen's state, the store's choices, the list and a cancel, and the minute cron sending a due moment through the queue to the real FCM, which refused the made-up token. `PUSH_SENDER` was on for that part only and is back as it was, and the store's schedule was restored. `push-devices-check` and `push-sender-check` pass again.

**4c screens (owner approved the preview, https://claude.ai/artifact/6tyKoB6NnwvaKtKk6V3Jan), on existing components and no new CSS:**
- «المتجر»: the five «إشعارات المتجر» choices under the dates, saved with them, and «الإرسال المتجدول» with a cancel on each pending one.
- «المواسم»: «تنبيه قبل النهاية (يوم)» in the season's form, and the active season shows its reminder.
- «إشعارات الموبايل»: «بيتبعت دلوقتي…» while the Worker's parts are still going.
- Until the cutover the scheduled list is Apps Script's (`apiPushSchedule` follows `boot.pushSend`), and the store's choices are saved on the Worker for when it sends.

**4c screen tests:** `youth-admin` 10 of 10, one new at phone width 375: no sideways scroll on the store screen, and the push result while sending. `admin-layout`, `comp-admin3` 9 of 9, `content-worker` 4 of 4, site units 758 of 760 (the same two). Desktop and phone screenshots match the preview.

**4c not checked:** the screens signed in against Staging itself, which needs the owner's sign-in. The browser tests use a fake Worker.

**4d as built (Staging Worker `dab09782`), against §22.2.4:**
1. Device registry: done in 4a (`platform`, `app_version`, one register call for web and native, admins and visitors).
2. Payload per platform: done in 4b. Now `urgent` (an admin's critical or important row) is `HIGH` on Android and `apns-priority 10` on iOS. Anything else is `NORMAL` and 5, and the web keeps `Urgency: high` as before.
3. Path links: done in 4b and 4c.
4. Anonymous rows linked after sign-in, and topics on the server: done in 4a and 4c.
5. Origins: CORS reads `ALLOWED_ORIGINS` only, and a test shows `https://localhost` and `capacitor://localhost` pass once listed and are refused otherwise. The pages' CSP lists where they connect, not who calls, so a shell that loads the live site needs no change there.
6. The new FCM web API: the vendor bundles gain `register`, `unregister`, `onRegistered` (Firebase 12.19.0). `assets/js/push-fid.js` is shared by the site and the panel. On the Worker the device is its Firebase Installation ID (22 characters), and a failure falls back to the old token. On Apps Script nothing changes, because its sender knows tokens only. The Worker takes both shapes and sends `fid` or `token` to match. FCM's reference marks `token` deprecated in favour of `fid`, and `token` still takes an FID during the transition.
7. Badge and group: done in 4b.

**4d tests:** Worker 457 of 457, site units 762 of 764 (the same two failures, `push-fid` 4 new), browser `push-hint` and `admin-app` 21 of 21. Live on Staging, `push-native-check` 5 of 5: one web device by its FID and one simulated native Android token through the same register call, then one send. The real FCM took both targets, `fid` and `token`, refused the made-up ids, and both rows were removed with no auth error.

**4d not done yet:** a real closed-app push on the owner's phone with a tap that opens the exact record. It is step 8 of the cutover, by the owner's choice.

**Found while writing the cutover:**
- Apps Script would have kept sending its own scheduled store pushes after the switch: a device on both sides would get them twice. `pushOnWorker_` (the Script Property `PUSH_SENDER`) now stops the button, the schedule and the admin pushes there. Tested in `push.test`.
- Going back after FIDs: the site would send an FID as `previous` to Apps Script, which refuses the whole call. It now leaves it out there.

### Step 5: Integration
- `route` moves to the Worker: the key as a secret, a D1 cache, a daily budget.
- The Settings and tools calls, `apiAdmins`, `apiSetAdminName` and age rules move or retire.
- The old wallet and store screens are confirmed unreachable.
- Each background job on Apps Script gets a Worker home or a reason to end.
- The sync routes the Worker no longer needs are listed for 7b, not removed.

**Done when:** a pass through every admin screen on Staging, with the network logged, shows no Apps Script call.

**Step 5 as built (2026-11-03):**
- **Settings and tools (live):** `worker/src/admin/tools.js` answers `apiCheckGithub`, `apiCheckMedia` (now the library's own path: R2 write, read and delete, D1, the site's copy), `apiResolveMapsUrl`, `apiFetchMediaUrl`, `apiSetLiveStage` (`live.json` committed alone, and the panel's copy in `settings.LIVE_STATE`), `apiPlanMigration` (finished) and `apiMigrate` (refused, decision 4: retired). The answers keep Apps Script's shapes and permissions, so no screen changed. `apiAgeRules`/`apiAgeRulesSave` map to D1's account settings. The old card has no caller.
- **Admins (live):** `apiAdmins` comes from D1 in `adminList_`'s shape. `apiSetAdminName` is the Worker's rename followed by that list. `apiActivity` is called only when no Worker exists, so no live caller.
- **The old «النقاط» / «المتجر» screens:** they hide once accounts are on. Until then, or from a remembered tab, they asked Apps Script for the frozen Sheets. While the Worker writes the content, their calls are now answered in the page, pointing to «حسابات الشباب». Tests: `comp-*`, `youth-admin`, `points-widget` 41 of 42. The failing `points-widget` 31 (axe on the public page) fails on the code before this change too.
- **Panel calls left on Apps Script:** none reachable with the content on the Worker (a check of every `A.call` name in `admin-app.js` against `boot.js`'s routes).
- **Route:** `worker/src/route.js` keeps Route.gs's contract, takes the page's own body and `text/plain`, caches 6 h in D1 (migration `0028`), and has a minute and day budget plus a per-visitor limit. Staging (`fd4188ed`) answers `config` without its key, and CORS works from the site. Worker 474 of 474. **Not on production:** the auto-mode guard refused the production migration from this session. The commit (`88094bf`) waits, local, for migration `0028` on production, because the daily housekeeping deletes from `route_cache`. Then `ORS_API_KEY` (Staging and production, owner) and the page's `routeUrl`.
- **Background jobs, each with its reason:** `bookNewsTick` (5 min) runs the claim, then stops while the router is on: it is the claim's heartbeat, which keeps Apps Script's `PUSH_SENDER` in step. `pushScheduleTick`/`Daily` send nothing under `pushOnWorker_`, and the daily one also sends the admins list. `activityForward_`, `compSigPush_`, `workerSyncAdmins_` and `notifyClaimRun_` rode on admin calls, which no longer reach Apps Script. None needs a Worker home. The triggers go in 7b.
- **Sync routes, for 7b:** still called by Apps Script's triggers: `notify-claim` (`bookNewsTick`), `admins` (the daily trigger). With no live caller once the triggers go: `session`, `activity`, `grants`, `pay-dest`, `publish`, `content-import`, `content-export`, `content-notify`, `comp-sig`, `media-copy`, `comp-live`, `store-import`, `book-news`. To list and remove in 7b, not before.

**Step 5 closed (2026-11-03):**
- **Route:** the owner applied `0028` on production from the worktree's `worker/` (the main checkout didn't have it yet), checked `route_cache`, and set `ORS_API_KEY` on both Workers. Staging, with the real key: driving 3,624 m / 296 s (49 points), walking 2,891 m, the second ask from the cache. `main` `fc403b1` (CI run 41656780906 passed). Production with the real key gives the same route. Then `68acff7` moved `map-config.js routeUrl` to `/v1/public/route`, live after Pages. `final-m.e2e` 31 of 31, now faking the Worker too.
- **The panel's own load:** opening the panel still woke Apps Script (`warm`) and asked it for an early state it then threw away. `admin/config.js content: 'worker'` is now the first guess: neither goes there. If the Worker says the Sheets write the content (a rollback), the state is asked as before, with the Google token. A tested way back, with no stored memory: `boot.js` keeps nothing persistent, a rule its unit test holds.
- **The network pass:** `content-worker.e2e` test 5, with production's switches (content, competitions, push devices and sender on the Worker, accounts on), walks 21 areas and tabs plus the push screen. **No call reached Apps Script.** On production, the live panel's load and the public site made no request to `script.google.com` (the browser's request log, signed out).
- **Tests:** Worker 474 of 474. Site units 765 of 766: the admin config test is fixed, since it hadn't known `platform` since Phase 3, and #12 is the one old failure left. Browser: `content-worker` 5 of 5, `admin-app`, `admin-platform`, `admin-rel` all pass, `final-m` 31 of 31.
- **Done when (met):** a pass through every admin screen, with the network logged, shows no Apps Script call. What still runs on Apps Script runs on its own triggers (`bookNewsTick`, the guarded push triggers), and each has its reason above. Their removal and the sync routes' go in 7b.

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
