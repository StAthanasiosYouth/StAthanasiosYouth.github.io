# Project handoff — start of Phase 3

Written 2026-10-21 at the close of Phase 1.5; updated 2026-10-22 at the close of Phase 2. Read this first in a fresh session, then the docs it names.
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
| D1 migrations | `worker/migrations/0001`–`0014` (all in production; `0013`–`0014` = Phase 2; next free: **`0015`**) | `npx wrangler d1 migrations apply athanasios-prod --remote` (staging: `athanasios-staging --remote --env staging`) — always before the Worker that needs them; additive only |

APIs: production `https://athanasios-api.menazak-lab.workers.dev`, staging `https://athanasios-api-staging.menazak-lab.workers.dev`.

## 2. Production state (2026-10-22, end of Phase 2)

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

**Watch for a few days:** «نسخة GitHub متأخرة» in the publish sheet, `GET /v1/admin/publish/status` (`mirror.late`,
`mirror.access.ok`), the booking pages. `node worker/scripts/shadow-watch.mjs` is read-only (the comparison keeps
running: the site and D1 should stay equal once the mirror has committed).

**Booking launch gate: still open and separate** (go-live test #2, test-data cleanup with the owner's go, real events).

## 5. Next: Phase 3 — admin platform

Spec: `docs/BACKEND-MIGRATION.md` §22 (row 3) and the sections it references (sessions, presence and edit locks §6.x,
"Phase 3" notes). Already moved earlier (Phase 1.5): **admins + grants** and **unified activity**. Left for Phase 3:
sessions, presence, edit locks for the other modules, devices, the bootstrap call. Goal: panel load < 1 s, no heartbeat
contention. Gate: the admin chrome is off Apps Script. Ships behind a switch; production changes only at its cutover.
Start with a plan for the owner, not code.

## 6. Working rules (owner's standing instructions)

- No production deploy, migration, Apps Script deploy or push to `main` without the owner's explicit approval. Staging first, report, pause.
- Keep `NOTIFY_ROUTER`, `NOTIFY_EMAIL`, `PERMS_ENFORCE` at 0. No bulk or repeated test emails; no real money; no uncontrolled notifications.
- Never print or expose secrets/tokens. Do not modify OAuth credentials, the Gmail setup, or buy a domain / switch email providers.
- Do not weaken authentication; do not repeatedly request notification permission.
- Issues caused only by the temporary Apps Script bridge → document and defer to Phase 6/7A.
- Roadmap decisions are final (2026-10-20); do not reopen them. Phase 5A (accounts/member email) is not started.
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
