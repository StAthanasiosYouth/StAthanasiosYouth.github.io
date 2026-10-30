# Project handoff — start of Phase 4

Written 2026-10-21 at the close of Phase 1.5; updated 2026-10-22 at the close of Phase 2, then by the plan review of Phases 0–9 (§4.1), then at the close of Phase 3 (§4.2). Read this first in a fresh session, then the docs it names.
Progress rule (owner, 2026-10-22): nothing is gated or scheduled by a number of days. A step is done when its checks pass; functional time rules (retention, expiry, reminders, provider deadlines) stay.
Owner: Mena Zakaria. The owner approves every production release; nothing reaches production without an explicit "approved".

## 1. What this project is

The youth site of St Athanasius church, Safaga (Arabic, RTL), with an admin panel, an event booking system and
a notification system. Repository `StAthanasiosYouth/StAthanasiosYouth.github.io`; `main` **is** production.

| Part | Where | How it ships |
| --- | --- | --- |
| Public site | `index.html`, `assets/`, `data/` | GitHub Pages from `main` (cache ~10 min) |
| Admin panel (PWA) | `admin/` — `admin/admin-app.js` is **built** from `apps-script/*.html` by `node tools/build-admin.mjs`; `admin/boot.js`, `admin/sw.js` are hand-written | GitHub Pages from `main` |
| Apps Script API (legacy backend, Sheets/Drive) | `apps-script/*.gs` | `cd tools && node deploy-api.mjs "vNN: …"` (updates the one API deployment in place) |
| Cloudflare Worker + D1 (new backend) | `worker/` | CI (`.github/workflows/worker.yml`) deploys production on a push to `main` touching `worker/**`. Staging: `cd worker && npx wrangler deploy --env staging` |
| D1 migrations | `worker/migrations/0001`–`0015` (`0001`–`0014` in production; `0015` = Phase 3, staging only; next free: **`0016`**; staging secret `DEVICE_KEY` set, production needs its own at the cutover) | `npx wrangler d1 migrations apply athanasios-prod --remote` (staging: `athanasios-staging --remote --env staging`) — always before the Worker that needs them; additive only |

APIs: production `https://athanasios-api.menazak-lab.workers.dev`, staging `https://athanasios-api-staging.menazak-lab.workers.dev`.

## 2. Production state (2026-10-22, end of Phase 3)

- `main`: see `git log origin/main -3` (Step 11 = `dc1fc38`, `PAY_REQUESTS` switch = `cd18002`).
  2026-10-21: Phase 2 P2-2 (`99d69cc`, Worker `497cdad3`, Apps Script @54, migrations `0013`–`0014`), then the
  admins bugfix `000fe84` (Apps Script @55; Worker `56d44915` = same code, CI redeploy). Rollback refs: Worker
  `e2673438`, Apps Script @53 / @54. `PUBLISH_MODE` (Script Property) is set by the owner.
  2026-10-21: Phase 2 **Release R1** (`a593948`, Worker `d644a5e8`, Apps Script @56; switches unchanged:
  `CONTENT_SOURCE=static`, `PUBLISH_MODE=shadow`). Rollback: revert on `main` + Worker `56d44915` + Apps Script @55.
  2026-10-21: Phase 2 R1.1 (`5efa4b2`, Worker `6094eb69`: the hourly read-only GitHub token check).
  2026-10-22: **Phase 2 cutover** (`1058b6a`): `CONTENT_SOURCE='worker'` (static first, the Worker's newer file
  swapped in), owner set `PUBLISH_MODE=worker`; first worker publish `258646becddf` live at once, mirrored to `main`
  as `1de5669` 3.8 s later. Rollback: D1 `CONTENT_SERVE='0'` (seconds) → `PUBLISH_MODE=shadow` (1 min) → revert
  `1058b6a` on `main` (Pages ~1 min) → Worker `6094eb69` / Apps Script @56. Full table: `docs/PUBLISH-SEPARATION-PLAN.md` §9.
- **Publishing now:** the admin's «راجع وانشر» posts the build to the Worker (D1 `published_revisions`, live at once);
  the Worker commits the same files to `main` as «Athanasius Portal Admin» (the mirror; never edit those files by hand
  in a release: rebase on `origin/main` first, the mirror may have committed since). Production `GITHUB_TOKEN` is a
  Worker secret (Contents RW on the site repo only); `settings.MIRROR_ACCESS` = the hourly check (no expiry date seen:
  the owner checks it in GitHub). The staging token expires 2026-11-20.
- Worker, Apps Script version, D1 bookmark and rollback refs: the status table at the top of
  `docs/BOOKING-PHASE1-COMPLETION-PLAN.md` (one row per step, with rollback for each release).
- **Phase 3 cutover** (2026-10-22, `docs/ADMIN-PLATFORM-PLAN.md`): `main` `4dcfde7` (code, migration `0015` by CI, Worker `eb0ca214`),
  `DEVICE_KEY` secret (Worker `3a9f9c4d`), Apps Script **@57**, D1 `ADMIN_PLATFORM='1'`, Script Property `ADMIN_PLATFORM=worker`
  (owner), `admin/config.js` `platform: 'worker'` (`a6a7a18`). The panel's sessions, presence, edit locks and trusted devices
  are the Worker's (D1). Rollback (reverse): Script Property `both` → revert `a6a7a18` → delete the property → D1 `'0'` →
  Worker `6094eb69` / Apps Script @56.
- D1 `settings` switches — **all OFF, keep them OFF unless the owner says otherwise:**
  `NOTIFY_ROUTER=0`, `NOTIFY_EMAIL=0`, `PERMS_ENFORCE=0`, `PAY_REQUESTS` (missing/0 = off).
  On: `BOOKING_MODULE=1`, `PAY_DEST=1` (approved payment numbers shown).
- Not launched officially: the launch gate (`docs/BOOKING-PHASE1-COMPLETION-PLAN.md` §6) is still open — go-live test #2,
  **test-data cleanup with the owner's explicit go**, real events published.

## 3. Phase 1.5 closure (steps 1–11)

All eleven steps are in production. Details, test counts and rollback refs: the status table in
`docs/BOOKING-PHASE1-COMPLETION-PLAN.md`; the closure audit is §0.1 of the same file.

**Deferred, documented, not a Phase 2 task:** real-device push with the admin app **closed** + tap opens the exact
booking (test #2, B-NA4VS, was acknowledged to FCM by the Apps Script bridge and never shown). Re-run in Phase 6/7A
when push moves to the Worker.

**Open owner items** (do not act on them without the owner): reject test bookings B-QSSR5 and B-NA4VS; approve (or not)
repairing ~152 old activity rows with broken `cairo` text (**do not modify old activity records until approved**);
when to turn the router/email/`PAY_REQUESTS` on; test-data cleanup before launch.

## 4. Phase 2 closure (publish separation) — done 2026-10-22

Plan, as-built notes, checks and the cutover record: `docs/PUBLISH-SEPARATION-PLAN.md`. Steps P2-0 … P2-9 done; P2-7 in
the reduced scope (Review diffs against the Worker's live revision; the browser-side Review moved to Phase 4, owner
2026-10-21, no function of today's Review lost). The 7–14 day shadow duration was **waived by the owner** on alternative
checks (staging rehearsal, bookings, rollback drills, a clean shadow so far); the accepted risks are written in the plan.
A network finding (slow path to `workers.dev` from Egypt) was fixed before the cutover: pages draw the static file first.

**Watch over the next real publishes (until three in a row are mirrored clean):** «نسخة GitHub متأخرة» in the publish sheet, `GET /v1/admin/publish/status` (`mirror.late`,
`mirror.access.ok`), the booking pages. `node worker/scripts/shadow-watch.mjs` is read-only (the comparison keeps
running: the site and D1 should stay equal once the mirror has committed).

**Booking launch gate: still open and separate** (go-live test #2, test-data cleanup with the owner's go, real events).

### 4.1 Plan review, Phases 0–9 (2026-10-22, read-only against code, git, production and staging)

Checked: `origin/main` = `475404a` (production); work branch `a80d099` differs from it only by the mirrored content
files and the docs below. Production and staging Worker `/v1/health` ok (`0.3.0`). Production D1 `settings`:
`NOTIFY_ROUTER=0`, `NOTIFY_EMAIL=0`, `PERMS_ENFORCE=0`, `PAY_REQUESTS` unset (= off), `CONTENT_SERVE` unset (= serving),
`BOOKING_MODULE=1`, `PAY_DEST=1`, `MIRROR_ACCESS.ok=true`. Last `publish_jobs` row: `worker`, `mirrored`, no error.
Not checked here: the GitHub Actions runs (nightly backup, Worker CI) — `gh` is not installed in this checkout.

| Phase | State |
| --- | --- |
| 0 Spike | ✔ done |
| 0.5 Front-end quick wins | ✔ done (`perf/phase05` merged); was not marked done in the roadmap, now marked |
| 1 Foundation + booking pilot | ✔ built and verified; restore drill done (2026-10-15, `worker/README.md`). **Partial:** the launch gate (go-live test #2, test-data cleanup, real events) is open |
| 1.5 Admin access & notifications | ✔ 11/11 in production, all switches off. Deferred: closed-app push (→ Phase 6/7A). Deviations: no `AGE_RULES` switch (plan §8 had one); `PAY_REQUESTS` has no admin toggle |
| 2 Publish separation | ✔ done; P2-7 reduced (browser Review → Phase 4, owner); shadow duration waived. Open: watch the next publishes (above) |
| 3 Admin platform | ✔ done 2026-10-22 (cutover P3-8; §4.2). The < 1 s panel open moves with the content state to Phase 4 |
| 4 Content + pages/events + media | ✔ done 2026-10-28 (cutover `docs/CONTENT-MIGRATION-PLAN.md` §16–16.3): drafts in D1, publish + review on the Worker, media on R2. Open: measure the panel open from Egypt |
| 5–7 | not started (as planned) |
| 8 Admin redesign, 9 Native apps | planning only (as planned). Essential admin fixes listed in BACKEND-MIGRATION §22.1 still wait for approval |

Found in the review (not in the plans before):
1. **Roadmap docs on `main` are behind and one is damaged.** `docs/MEMBER-NOTIFICATIONS-PLAN.md` does not exist on `main`;
   `docs/BACKEND-MIGRATION.md` on `main` lacks the 5A/Phase 9 amendments and has a merged, wrong header line
   ("Phase 9 native mobile apps on Cloudflare account …"); `YOUTH-ACCOUNTS-PLAN.md`, `COMPETITIONS.md` §20, `EVENTS.md`,
   `PAYMENT-REMINDERS.md` also differ. The work branch holds the correct copies. A docs-only release to `main` needs the owner's approval.
2. **Slow path from Egypt to `workers.dev`** (found at the Phase 2 cutover; pages now draw static first). Phase 3's
   "panel load < 1 s" target depends on the same path: measure it from Egypt in the Phase 3 plan; the optional custom domain is the lever.
3. **Gmail branding verification fails on the github.io homepage** (Phase 1.5): also points to the custom-domain decision (owner).
4. **Staging `GITHUB_TOKEN` expires 2026-11-20** (functional date): renew before any staging publish/mirror rehearsal after it.
5. **§25 "finished" item 7** (second Cloudflare owner + 2FA + runbook) has no owner action recorded yet.
6. The local `main` in this checkout is 235 commits behind `origin/main`: always compare with `origin/main`.
7. Stale text fixed in this review: BOOKING-PHASE1 "Phase 1.5 has not started"; Phase 0.5/1/1.5/2 marks in the roadmap tables.

Day-based estimates and gates were removed from BACKEND-MIGRATION, BOOKING-PHASE1-COMPLETION-PLAN, YOUTH-ACCOUNTS-PLAN and
MEMBER-NOTIFICATIONS-PLAN (replaced by "done when" checks). No requirement was removed; the historical record of the waived
Phase 2 shadow duration stays in PUBLISH-SEPARATION-PLAN.

**Before Phase 3 starts** (none needs code): (a) owner approval of the docs-only release that fixes item 1; (b) the Phase 2 watch
above closes clean; (c) a Phase 3 plan for the owner (sessions, presence, edit locks, devices, bootstrap; switch + rollback;
measured from Egypt). The booking launch gate and the open owner items (§3) run in parallel and do not block Phase 3.

### 4.2 Phase 3 closure (admin platform) — done 2026-10-22

Record, tests, runbook and rollback: `docs/ADMIN-PLATFORM-PLAN.md`. P3-1 … P3-8 done; production checks on the owner's account
after the cutover: sign-in, D1 session + heartbeat, permissions (`/me`), bookings, an edit lock taken and released, a reload
resuming the same sid, no 5xx in `api_log`. Gate met: the admin chrome (session, presence, locks, devices, activity, names)
is off Apps Script; Apps Script now only serves the content modules, with the Worker's panel token.

Not met in Phase 3, moved to Phase 4: **panel open < 1 s**. The Worker part answers in ~0.2–0.6 s; the content state
(`apiState`, Sheets) took 9–15 s warm on the owner's account (it was inside `apiSessionStart` before, so not new).

Open items: old `ADMIN_DEVICE_*` Script Properties (remove with the owner); `AdminNotify.gs adminPresent_` no longer sees
open panels (temporary bridge → Phase 6/7A); the Apps Script session code stays until Phase 7 retirement (rollback path).

## 5. Phase 4 — content + pages/events + media (closed 2026-10-28)

Closed: `CONTENT_WRITER = worker` (Apps Script) and `CONTENT_DRAFTS = 1` (D1) live; production tests passed (review,
save, 3-step publish, media upload, booking page), baseline unchanged. Record and rollback: `docs/CONTENT-MIGRATION-PLAN.md`
§13, §16–16.3. Open: measure the panel open (< 1 s target) on the owner's account from Egypt. Next per the roadmap: Phase 5.

**Phase 5 started 2026-10-30** (`docs/PHASE5-PLAN.md`: five batches, each needs the owner's choice to start and separate approval for production). Batches 1–3 (P5-1…P5-6: accounts, sign-in, profile, member email, participants in the admin, booking age sync, points) are verified on staging; not on `main`, not in production. Next: batch 4, only on the owner's choice.

Original brief (kept for the record):

Spec: `docs/BACKEND-MIGRATION.md` §22 (row 4). Draft tables + the pure builders in the Worker, publish fully in the Worker,
the browser-side Review (moved from Phase 2), Drive library → R2, upload-time GitHub commits. It also brings the panel's
content state to D1, which is what the < 1 s panel open still waits for. Start with a plan for the owner, not code.

Requirement added by the owner 2026-10-22 (document it in the Phase 4 plan, inside the step for the browser-side Review
and publish in the Worker): the «راجع وانشر» dialog goes from 4 steps (مراجعة → نشر على GitHub → انتظار GitHub Pages →
ظهر على الموقع) to 3 (Review → Publish → Live on the site). No GitHub or GitHub Pages wait in the UI; the GitHub mirror
keeps running in the background. Not started.

## 6. Working rules (owner's standing instructions)

- No production deploy, migration, Apps Script deploy or push to `main` without the owner's explicit approval. Staging first, report, pause.
- Keep `NOTIFY_ROUTER`, `NOTIFY_EMAIL`, `PERMS_ENFORCE` at 0. No bulk or repeated test emails; no real money; no uncontrolled notifications.
- Never print or expose secrets/tokens. Do not modify OAuth credentials, the Gmail setup, or buy a domain / switch email providers.
- Do not weaken authentication; do not repeatedly request notification permission.
- Issues caused only by the temporary Apps Script bridge → document and defer to Phase 6/7A.
- Roadmap decisions are final (2026-10-20); do not reopen them. Phase 5A is in progress on the batch system of `docs/PHASE5-PLAN.md`.
- New admin UI uses existing components only; the redesign is Phase 8 (`docs/BACKEND-MIGRATION.md` §22.1).
- Avoid unnecessary repeated tests and token use.

## 7. How to work here

- Work happens on local branch `feat/phase15-step1-perms` (its history differs from `main`: releases were cherry-picked,
  so compare by content, not by `git log main..`). Release = cherry-pick the commits
  onto `origin/main` in a temporary worktree and `git push origin HEAD:main` (owner approval first). Other sessions
  sometimes commit to this checkout; check `git log` before releasing. Untracked `card-athanasios/`, `spike/`,
  `docs/BACKEND-MIGRATION-STUDY.md`, `spongebob_1mb.jpg`, `tools/.overflow-hunt.mjs` are not ours — leave them.
- Tests: Worker `cd worker && npm test` (Node 22, `--experimental-sqlite`; 216/216). Site/admin unit `cd tools && npm test`.
  e2e: `cd tools && node --test --test-concurrency=1 ../tests/<name>.e2e.mjs` (puppeteer-core + local Chrome).
  Known pre-existing failures (not regressions): unit #2 (competition/trip), #191 (content.js competitions), the seasons test (#574 now);
  e2e "module off" in `book-admin.e2e`; a date-boundary flake in final-m `Route.gs`.
- Staging checks (each creates a fixture event, never touches notification switches): `worker/scripts/rehearsal.mjs`,
  `age-check.mjs`, `claims-check.mjs`, `book-check.mjs`; Phase 2: `phase2-rehearsal.mjs` (publish/shadow/mirror/restore).
  The staging Worker allows `http://localhost:8080` only (CORS) for local previews against it. Staging rate limits are real: wait ~10 min between runs of the same check.
- Shell on Windows (Git Bash / PowerShell): never put backticks or `$` inside `node -e` strings; write a script file or use the editor.
- After code changes: `graphify update .` (see `CLAUDE.md`).

## 8. Key docs

`docs/BOOKING-PHASE1-COMPLETION-PLAN.md` (Phase 1.5 contract + status), `docs/PUBLISH-SEPARATION-PLAN.md` (Phase 2), `docs/BACKEND-MIGRATION.md` (roadmap, Phases 2–9),
`docs/EVENTS.md` (booking product contract), `worker/BOOKING-API.md` (transport), `docs/EMAIL-DEEP-LINKS.md`,
`docs/MEMBER-NOTIFICATIONS-PLAN.md` and `docs/YOUTH-ACCOUNTS-PLAN.md` (Phase 5A), `docs/ARCHITECTURE.md`, `docs/ADMIN-GUIDE.md`.
