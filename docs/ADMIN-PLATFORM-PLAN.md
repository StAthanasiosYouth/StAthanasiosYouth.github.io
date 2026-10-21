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
| 2 | P3-4 | Trusted devices (`admin_devices`, `DEVICE_KEY` secret) | next |
| 2 | P3-5 | Presence + edit locks in the panel (`admin/boot.js` collab → Worker heartbeat) | next |
| 2 | P3-6 | Activity: heartbeat toasts and the home card from D1 | next |
| 3 | P3-7 | Bootstrap call + the panel's session wiring (`admin/boot.js`, `admin/config.js platform`) | later |
| 3 | P3-8 | Final tests, Egypt timing, production cutover (approval) | later |

Accounts + grants and the unified activity log were already moved in Phase 1.5.

## Switches and rollback

Two switches, both off today:

| Switch | Where | Off = |
| --- | --- | --- |
| `settings.ADMIN_PLATFORM` | D1 | `'0'`: every `/v1/admin/session/*` route answers `off` |
| Script Property `ADMIN_PLATFORM` | Apps Script | absent / not `'worker'`: Apps Script sessions, locks and names exactly as today |

The panel's own switch (`admin/config.js`, P3-7) decides which side the page talks to. Cutover order: D1 on → Script Property `worker` → panel config. Rollback in reverse (panel config, ~1 min Pages; delete the Script Property, seconds; D1 `'0'`, seconds). Apps Script session code stays untouched until stable (§23).

## Batch 1 results (2026-10-22)

- Worker tests: 232/232 (16 new, `worker/test/admin-platform.test.mjs`).
- Site/admin unit tests: 750/753 + the 3 known pre-existing failures (#2, #191, #574); 8 new bridge tests (`tests/admin-platform.test.mjs`).
- Staging: migration `0015` applied, Worker `ba201557` deployed, `ADMIN_PLATFORM='1'` on staging only. `node worker/scripts/platform-check.mjs`: 19/19.
- Server round trips from this network (staging, median): session start 249 ms, heartbeat 203 ms (Apps Script heartbeat today: ~2–3 s under the script lock), resume 248 ms, rename 323 ms.
- Production: untouched (no migration, no deploy, no Apps Script deploy, no push to `main`).

## Notes for the next batches

- Temporary-bridge limit (defer to Phase 6/7A): while the switch is on, `AdminNotify.gs adminPresent_` reads the Apps Script cache, so it no longer sees who has the panel open; admin pushes then also reach a device whose panel is open. Fixed when admin push moves to the Worker.
- The Apps Script bridge fails closed: the Worker unreachable → `busy` (no call goes through unchecked, no save overwrites an open editor).
- A panel token is never a Google token: `GOOGLE_ONLY_FUNCTIONS` and the Worker's account changes still ask Google.
- Device credentials in Script Properties are not copied: after the cutover each installed app signs in with Google once (decided in P3-4 if the owner prefers a copy).
