# Project handoff — start of Phase 2

Written 2026-10-21 at the close of Phase 1.5. Read this first in a fresh session, then the docs it names.
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
| D1 migrations | `worker/migrations/0001`–`0014` (`0013`–`0014` = Phase 2, staging only so far; next free: **`0015`**) | `npx wrangler d1 migrations apply athanasios-prod --remote` (staging: `athanasios-staging --remote --env staging`) — always before the Worker that needs them; additive only |

APIs: production `https://athanasios-api.menazak-lab.workers.dev`, staging `https://athanasios-api-staging.menazak-lab.workers.dev`.

## 2. Production state (2026-10-21, end of Phase 1.5)

- `main`: see `git log origin/main -3` (Step 11 = `dc1fc38`, `PAY_REQUESTS` switch = `cd18002`).
  2026-10-21: Phase 2 P2-2 (`99d69cc`, Worker `497cdad3`, Apps Script @54, migrations `0013`–`0014`), then the
  admins bugfix `000fe84` (Apps Script @55; Worker `56d44915` = same code, CI redeploy). Rollback refs: Worker
  `e2673438`, Apps Script @53 / @54. `PUBLISH_MODE` (Script Property) is set by the owner.
  2026-10-21: Phase 2 **Release R1** (`a593948`, Worker `d644a5e8`, Apps Script @56; switches unchanged:
  `CONTENT_SOURCE=static`, `PUBLISH_MODE=shadow`). Rollback: revert on `main` + Worker `56d44915` + Apps Script @55.
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

## 4. Next: Phase 2 — publish separation

Spec: `docs/BACKEND-MIGRATION.md` §22 (row 2), rollback §23, and the sections it references.
Execution plan + status: **`docs/PUBLISH-SEPARATION-PLAN.md`** (P2-1 + P2-2 done on staging, 2026-10-21; production step awaits the owner).
Scope: `published_revisions`, public loaders (Worker + static fallback), Apps Script publish posts its build to the Worker,
background GitHub mirror, `404.html` shell, browser-side Review, revision restore. Goal: publish visible at once
(~7 s + 60 s → ~3 s). Gate: 1–2 weeks of equal shadow hashes. Rollback: `CONTENT_SOURCE='static'` + `PUBLISH_MODE='github'`.
Ships behind a switch; production changes only at the cutover step. Start with a plan for the owner, not code.

## 5. Working rules (owner's standing instructions)

- No production deploy, migration, Apps Script deploy or push to `main` without the owner's explicit approval. Staging first, report, pause.
- Keep `NOTIFY_ROUTER`, `NOTIFY_EMAIL`, `PERMS_ENFORCE` at 0. No bulk or repeated test emails; no real money; no uncontrolled notifications.
- Never print or expose secrets/tokens. Do not modify OAuth credentials, the Gmail setup, or buy a domain / switch email providers.
- Do not weaken authentication; do not repeatedly request notification permission.
- Issues caused only by the temporary Apps Script bridge → document and defer to Phase 6/7A.
- Roadmap decisions are final (2026-10-20); do not reopen them. Phase 5A (accounts/member email) is not started.
- New admin UI uses existing components only; the redesign is Phase 8 (`docs/BACKEND-MIGRATION.md` §22.1).
- Avoid unnecessary repeated tests and token use.

## 6. How to work here

- Work happens on local branch `feat/phase15-step1-perms` (its history differs from `main`: releases were cherry-picked,
  so compare by content, not by `git log main..`). Release = cherry-pick the commits
  onto `origin/main` in a temporary worktree and `git push origin HEAD:main` (owner approval first). Other sessions
  sometimes commit to this checkout; check `git log` before releasing. Untracked `card-athanasios/`, `spike/`,
  `docs/BACKEND-MIGRATION-STUDY.md`, `spongebob_1mb.jpg`, `tools/.overflow-hunt.mjs` are not ours — leave them.
- Tests: Worker `cd worker && npm test` (Node 22, `--experimental-sqlite`; 182/182). Site/admin unit `cd tools && npm test`.
  e2e: `cd tools && node --test --test-concurrency=1 ../tests/<name>.e2e.mjs` (puppeteer-core + local Chrome).
  Known pre-existing failures (not regressions): unit #2 (competition/trip), #191 (content.js competitions), #558 (seasons);
  e2e "module off" in `book-admin.e2e`; a date-boundary flake in final-m `Route.gs`.
- Staging checks (each creates a fixture event, never touches notification switches): `worker/scripts/rehearsal.mjs`,
  `age-check.mjs`, `claims-check.mjs`. Staging rate limits are real: wait ~10 min between runs of the same check.
- Shell on Windows (Git Bash / PowerShell): never put backticks or `$` inside `node -e` strings; write a script file or use the editor.
- After code changes: `graphify update .` (see `CLAUDE.md`).

## 7. Key docs

`docs/BOOKING-PHASE1-COMPLETION-PLAN.md` (Phase 1.5 contract + status), `docs/BACKEND-MIGRATION.md` (roadmap, Phases 2–9),
`docs/EVENTS.md` (booking product contract), `worker/BOOKING-API.md` (transport), `docs/EMAIL-DEEP-LINKS.md`,
`docs/MEMBER-NOTIFICATIONS-PLAN.md` and `docs/YOUTH-ACCOUNTS-PLAN.md` (Phase 5A), `docs/ARCHITECTURE.md`, `docs/ADMIN-GUIDE.md`.
