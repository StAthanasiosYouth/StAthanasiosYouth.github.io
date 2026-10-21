# Phase 3 — Admin platform (execution record)

Spec: `docs/BACKEND-MIGRATION.md` §9 (sessions, presence, edit locks, devices), §12 (activity, platform tables), §22 row 3, §23 row 3.
Goal: the admin chrome off Apps Script; panel load < 1 s; no heartbeat contention. Ships behind a switch; production changes only at P3-8.
Owner rule: staging first; nothing on production without an explicit "approved". No day-based gates: a step is done when its checks pass.

## Steps and batches (owner, 2026-10-22)

| Batch | Step | Scope | State |
| --- | --- | --- | --- |
| 1 | P3-1 | D1 migration `0015_admin_platform` (`admin_sessions`, `admin_sessions_gone`, `admin_devices`, `admin_device_nonces`, setting `ADMIN_PLATFORM='0'`); Worker routes under `/v1/admin/session/*`, `/v1/sync/session` | ✔ staging |
| 1 | P3-2 | Sessions on the Worker (`worker/src/admin/session.js`, port of `Presence.gs`): one live session per account, takeover question / force, park / resume, end, heartbeat (locks + presence + activity in one D1 batch), panel token `wk1` with the sid inside (`lib/auth.js mintPanelToken`, checked on every Worker call). Apps Script bridge `apps-script/AdminPlatform.gs` (dormant): takes the panel token, asks the Worker for the session and the locks | ✔ staging (Worker); bridge tested, **not deployed** |
| 1 | P3-3 | `GET /v1/admin/me` (effective permissions = the panel's navigation model), rename on the Worker (`POST /v1/admin/accounts/:email/name`, rules of `Activity.gs`), Apps Script names follow D1 while the switch is on | ✔ staging (Worker); bridge not deployed |
| 2 | P3-4 | Trusted devices on the Worker (`worker/src/admin/devices.js`, port of `AdminDevice.gs`): trust (Google only; binds the open session to the device), signed sign-in (+ session in the same round trip), device tokens checked against D1 on every call, forget ends the device's session, removal in «الصلاحيات» ends devices + session + locks. Secret AES-GCM with `DEVICE_KEY` | ✔ staging |
| 2 | P3-5 | The panel on the Worker (`admin/boot.js`, `config.platform: 'worker'`; absent = today): session start/resume/end/park, heartbeat (presence + locks), renew, device sign-in/trust/forget go to the Worker; Apps Script calls carry the panel token; a write asks the Worker once, outside the script lock (all live locks); `apiBadges` keeps the menu numbers | ✔ tests (not on Pages) |
| 2 | P3-6 | Activity from D1: heartbeat toasts (others since a time), the home card (`/v1/admin/activity?limit=6`), the takeover row written by the Worker | ✔ tests + staging |
| 3 | P3-7 | Bootstrap: `session/start` and `resume` with `boot: true` bring who / permissions / the home card's activity / modules in the same answer (`worker/src/admin/bootstrap.js`); the page asks Apps Script's content state AT THE SAME TIME with the Google token (read-only `apiState` without a sid, worker mode only) instead of after | ✔ tests + staging |
| 3 | P3-8 | Cutover: transition mode `both` (Apps Script), local release branch, runbook below. **Waits for the owner's "approved"** | prepared, not run |

Accounts + grants and the unified activity log were already moved in Phase 1.5.

## Switches and rollback

Two switches, both off today:

| Switch | Where | Off = |
| --- | --- | --- |
| `settings.ADMIN_PLATFORM` | D1 | `'0'`: every `/v1/admin/session/*` route answers `off` |
| Script Property `ADMIN_PLATFORM` | Apps Script | absent: Apps Script sessions, locks and names exactly as today. `both`: the cutover window — old pages keep their Apps Script sessions, new pages use the Worker's, a lock on either side refuses the other's save. `worker`: the Worker only |
| `platform` in `admin/config.js` | GitHub Pages | absent: the page runs the Apps Script sessions |

The panel's own switch (`admin/config.js`, P3-7) decides which side the page talks to. Cutover order: D1 on → Script Property `worker` → panel config. Rollback in reverse (panel config, ~1 min Pages; delete the Script Property, seconds; D1 `'0'`, seconds). Apps Script session code stays untouched until stable (§23).

## Batch 1 results (2026-10-22)

- Worker tests: 232/232 (16 new, `worker/test/admin-platform.test.mjs`).
- Site/admin unit tests: 750/753 + the 3 known pre-existing failures (#2, #191, #574); 8 new bridge tests (`tests/admin-platform.test.mjs`).
- Staging: migration `0015` applied, Worker `ba201557` deployed, `ADMIN_PLATFORM='1'` on staging only. `node worker/scripts/platform-check.mjs`: 19/19.
- Server round trips from this network (staging, median): session start 249 ms, heartbeat 203 ms (Apps Script heartbeat today: ~2–3 s under the script lock), resume 248 ms, rename 323 ms.
- Production: untouched (no migration, no deploy, no Apps Script deploy, no push to `main`).

## Batch 2 results (2026-10-22)

- Worker tests: 244/244 (12 new: `admin-devices.test.mjs`, more in `admin-platform.test.mjs`).
- Bridge unit tests: 9/9 (`tests/admin-platform.test.mjs`), incl. "no Worker call under the script lock".
- e2e `tests/admin-platform.e2e.mjs`: 4/4 — a real browser, the REAL Worker on SQLite, the real .gs code in worker mode: sign-in, presence + locks + a save refused by Apps Script because of a D1 lock, takeover + reload resume, «خليك داخل» relaunch with no Google and «خروج».
- Found and fixed while testing: (1) Apps Script asked the Worker about a lock while holding its script lock (contention) → one fresh check per write, before the lock; (2) the installed app reopened on the same phone was asked «جهاز تاني» when its first session was a Google one → trusting the device binds the open session; (3) «خروج» on the app left the session open (its token named the deleted device) → forget ends the device's session.
- Staging: `DEVICE_KEY` set (staging only), Worker `f78a9d8a`; `platform-check.mjs` 25/25. Median round trips: start 198 ms, heartbeat 179 ms, device sign-in 314 ms, activity head 156 ms.
- Production: untouched. `admin/boot.js` and the .gs bridge are committed on the work branch only (not on `main`, no Apps Script deploy).

## Batch 3 results (2026-10-22)

- Worker tests: 245/245. Bridge unit tests: 11/11 (incl. mode `both` both ways, `apiState` without a sid on/off).
- e2e: `admin-platform` 4/4 (real browser + real Worker + real .gs), and the regressions (see the commit).
- Staging Worker `e2092dd4`; `platform-check.mjs` 26/26.
- Timing from this machine (the admin's network) to staging `workers.dev`, median warm: session start **with** the bootstrap 244 ms (n=10), heartbeat 156 ms, resume 180 ms, device sign-in 370 ms; a plain `/v1/health` 69–295 ms (median ~100 ms).
- **The < 1 s panel open is not reachable in Phase 3.** With the platform on, opening = max(Worker start + bootstrap ≈ 0.25 s, Apps Script `apiState` ≈ 2–3 s warm, more when cold). The Worker part is done; the remaining ~2 s is the content state read from Sheets, which moves to D1 in Phase 4 (§22 row 4). What Phase 3 removes: the Apps Script session round trip (state came with it before, now in parallel), every heartbeat's 2–3 s under the global script lock (now ~0.16 s, no lock), and the device sign-in's Apps Script wait.

## P3-8 — production cutover runbook (prepared; nothing below has run)

Release = cherry-pick the Phase 3 commits onto a fresh `origin/main` (the publish mirror commits there: rebase right before the push). Prepared locally as branch `release/phase3` (not pushed). Quiet time; one admin watching.

| # | Step | Who / how | Check before the next |
| --- | --- | --- | --- |
| 0 | Owner "approved" for production | owner | — |
| 1 | Push `release/phase3` to `main` (switches all off: D1 `'0'`, no Script Property, no `platform` in config) | `git push origin release/phase3:main` → CI applies migration `0015` and deploys the Worker | CI green; `/v1/health` ok; D1 `ADMIN_PLATFORM='0'`; the panel works exactly as before |
| 2 | Production secret `DEVICE_KEY` (random, never printed) | `wrangler secret put DEVICE_KEY` | `wrangler secret list` shows it |
| 3 | Apps Script deploy (the bridge, dormant) | `cd tools && node deploy-api.mjs "vNN: Phase 3 admin platform (dormant)"` | the panel works as before (property absent) |
| 4 | D1 `ADMIN_PLATFORM='1'` | `wrangler d1 execute athanasios-prod --remote --command "UPDATE settings …"` | `/v1/admin/me` says `platform: true` |
| 5 | Script Property `ADMIN_PLATFORM=both` | owner, Apps Script → Project settings | an open (old) panel still saves; nothing else changes |
| 6 | `admin/config.js`: `platform: 'worker'` | one-line commit to `main` (Pages ~1 min; browsers may keep the old file ~10 min) | a fresh panel: sign-in, presence, a lock, a save, «خروج»; the app relaunch (Google once, then no Google) |
| 7 | After ≥ 15 min and the checks of step 6: Script Property `ADMIN_PLATFORM=worker` | owner | old pages (if any) are asked to refresh; heartbeats no longer reach Apps Script |
| 8 | Watch: `api_log` errors, «سجل النشاط», the publish status; record rows in `BOOKING-PHASE1-COMPLETION-PLAN.md` status table | — | — |

**Rollback** (reverse order; each step alone is enough to stop the new path):
1. Script Property back to `both` (seconds): both kinds of page work again.
2. Revert the `config.js` commit (Pages ~1 min, browsers ≤ 10 min).
3. Delete the Script Property (seconds) → Apps Script exactly as today.
4. D1 `ADMIN_PLATFORM='0'` (seconds) → every `/v1/admin/session/*` route answers `off`.
5. Code: the Worker version from before step 1 (`wrangler rollback`), Apps Script the version before step 3. Migration `0015` is additive and stays.

After the cutover each installed admin app signs in with Google once (device credentials are not copied from Script Properties); trusted devices then live in D1. Old `ADMIN_DEVICE_*` Script Properties can be removed later with the owner.

## Notes for the next batches

- Temporary-bridge limit (defer to Phase 6/7A): while the switch is on, `AdminNotify.gs adminPresent_` reads the Apps Script cache, so it no longer sees who has the panel open; admin pushes then also reach a device whose panel is open. Fixed when admin push moves to the Worker.
- The Apps Script bridge fails closed: the Worker unreachable → `busy` (no call goes through unchecked, no save overwrites an open editor).
- A panel token is never a Google token: `GOOGLE_ONLY_FUNCTIONS` and the Worker's account changes still ask Google.
- Device credentials in Script Properties are not copied: after the cutover each installed app signs in with Google once (decided in P3-4 if the owner prefers a copy).
