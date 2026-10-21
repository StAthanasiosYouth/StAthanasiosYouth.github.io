# Phase 2 — publish separation: execution plan

Rev. 1, 2026-10-21. This is the execution contract for Phase 2. The approved spec is `docs/BACKEND-MIGRATION.md`
§22 (row 2), §5, §6, §15, §19 and §23. This file does not change that spec. It fixes the order, the switches and the
contracts each step builds against.

**Status (2026-10-21).** P2-1 and P2-2 built and tested on **staging only**: migrations `0013` + `0014` applied to
`athanasios-staging`, Worker `d33fc92c` (staging); Worker tests 199/199, site/admin unit 728/731 (the 3 known
pre-existing failures); `worker/scripts/publish-check.mjs` 21/21, `worker/scripts/shadow-check.mjs` all ok against
the real Pages site.

**Production release 2026-10-21 (owner approved):** D1 bookmark before the migrations
`00000124-00000079-0000510b-9ef1b1f0f5f0f8821aecc38da08bfcf5`; `0013` + `0014` applied to `athanasios-prod`;
`main` `99d69cc` → Worker `497cdad3` via CI (previous: `e2673438`); Apps Script API @54 (previous: @53). Seed: the 6
files Pages served (content, ics, black-theatre, events test + booking-test-temp, comp test) stored as live
revisions with `worker/scripts/shadow-seed-sql.mjs` (the admin route needs a Google session); the 6 public reads
return the same sha-256 as the site, ETag 304 ok. **Left: the owner sets the Script Property `PUBLISH_MODE=shadow`**
(Apps Script editor → Project Settings → Script Properties); the 15-minute comparison starts with the first shadow
publish after that. Rollback: delete `PUBLISH_MODE`; Worker `wrangler rollback e2673438`; Apps Script @53.

### P2-7 and P2-8 as built (2026-10-21, staging / local only; nothing released)

- **P2-7, what was built** (`WorkerSync.gs` `workerLiveContent_` / `liveRevision_`, `Publish.gs`): in `worker` mode the
  review's diff, the publish's "already live?" check and the panel status use the Worker's live revision
  (`GET /v1/public/content`; fresh for review/publish, a 20-s cached copy for the status; if the Worker can't say,
  GitHub / the property decide as before). Needed: GitHub's `content.json` lags behind the mirror, and a restore
  changes what is live without Apps Script. github/shadow mode never asks the Worker.
- **P2-7, what was not built: the review computed in the browser.** The browser does not hold the pages and
  competitions drafts (Sheets), and the builders (`Content.gs`, `Pages.gs`, `CompPublish.gs`, `Review.gs`) move to the
  Worker in Phase 4 anyway (§22 row 4). Doing it in the browser now would mean shipping those drafts and ~5k lines of
  builders to the admin, then replacing them in Phase 4. **Owner decision 2026-10-21: moved to Phase 4**
  (BACKEND-MIGRATION §22 rows 2 and 4 amended). **P2-7 is complete in this reduced scope.**
- **Nothing of today's Review is lost:** `apiReview` is unchanged (the same builders, errors, warnings, grouped
  changes, revision guard, competition info); only its comparison point changes, and only in `worker` mode (the
  Worker's live revision, else GitHub as before). github/shadow mode never asks the Worker (tested).
- **P2-8** (`worker/src/publish-restore.js`): `GET /v1/admin/publish/revisions` (the last 15 publishes, which is live,
  whether restore is on) and `POST /v1/admin/publish/restore { to, expect }` (`publish.publish`). A restore is a new
  publish (mode `restore`) of the texts that were live right after the chosen one; pages/events/competitions added
  since get their withdrawn JSON; stubs stay; history is never rewritten. Only while the Worker is the truth (the
  latest publish `worker`/`restore`); `expect` refuses a stale view. Live at once; the booking re-reads a changed
  event; the mirror commits it; one activity row («رجّع الموقع للنسخة اللي اتنشرت …», important). The panel: the
  «نسخ النشر» card in Settings (existing components), a confirm that says the draft is not changed and the next
  publish brings it back, then `apiPublishRefresh` (the status follows the Worker).
- Tests: Worker 215/215 (`publish-restore` 3/3), Apps Script `publish-shadow` 10/10 (3 new for P2-7), accounts e2e 8/8
  (the «نسخ النشر» card; the rename test's typing race fixed), unit 748/751 (3 known). Staging Worker `815d2f1b`:
  `worker/scripts/restore-check.mjs` 10/10 (restore ≈ 0.8 s, live at once, stale view refused, mirrored to the test
  repository, commit `e4b5d84`). Production repository untouched.

### P2-4 real check on staging (2026-10-21)

The owner set the staging secret `GITHUB_TOKEN` (fine-grained, the test repository
`StAthanasiosYouth/publish-mirror-staging` only). `worker/scripts/mirror-check.mjs`: a worker-mode publish live at once,
mirrored in 7 s by the queue job (commit `680e83c`). Retry, for real: staging deployed with a branch that does not
exist → the publish stayed live, the job `failed` («GitHub 404: Branch not found», 2 attempts); the correct config
deployed again → the cron retried after its backoff, commit `8e45f7f`, job `mirrored`. Three publishes in a row of one
event → one commit with the newest text (`b149b83`). The production repository was never written (`main` still
`000fe84`; GitHub does not know these commits there).

### P2-5 and P2-6 as built (2026-10-21, staging / local only; nothing released)

- **P2-6** (`worker/src/book/event.js`): the booking reads an event from its live D1 revision when a worker-mode
  publish made it (`event_cfg.source = 'published'`), else from the site as before (github / shadow mode). A
  worker-mode publish expires the booking's copy of a changed event, so the next request already uses it; a withdrawn
  revision is not bookable; staging fixtures are never replaced. Tests: `book-published` 4/4, Worker 212/212. Staging
  (`a5b04517`): publish v1 → `book/state` v1; v2 seconds later → v2 at once; withdrawn → `not_found`.
- **P2-5** (`404.html` + `assets/js/not-found.js`): GitHub Pages serves `404.html` for every missing path. For
  `/<slug>/`, `/events/<slug>/`, `/competition/<slug>/` (reserved folders excluded; with or without the slash) it
  fetches the matching shell, makes its URLs absolute, adds `data-kind` / `data-slug` as a stub would and writes it in;
  the page engine then loads the content (the Worker when `CONTENT_SOURCE='worker'`, else the static file — which a
  new slug does not have yet, so before the cutover it shows «not available»). Any other path: a plain «الصفحة دي مش
  موجودة» page. Its CSP is the page shell's (a superset of the site's and the competition shell's). Tests:
  `not-found` unit 3/3, e2e 6/6 (event, page, competition, no trailing slash, Worker down, other paths); unit 745/748
  (3 known).

### P2-4 as built (2026-10-21, staging only; nothing released)

- Apps Script `PUBLISH_MODE='worker'` (`WorkerSync.gs` `publishToWorker_`, `Publish.gs` step B): new pictures are
  committed to GitHub first (binaries only), then the text files go to the Worker (mode `worker`) and are live at
  once. If the Worker does not take them (5xx/429/network after one retry, or a refusal) the publish fails with a
  clear message and nothing is recorded; there is **never** a GitHub commit instead (one writer). The panel says
  «اتنشر على السيرفر الجديد ✓ ونسخة GitHub بتتحدث في الخلفية», then «نسخة GitHub اتحدثت ✓», or «نسخة GitHub متأخرة»
  when Pages has not shown it after ~3.5 minutes.
- Worker (`src/publish-mirror.js`, `src/lib/github.js`): the mirror commits the **current live snapshot** (every live
  revision of a worker-mode publish not mirrored yet) in one fast-forward commit, with the same non-personal identity
  as Apps Script. Publishes in a row coalesce; an older text is never committed over a newer one; shadow/seed
  revisions are never mirrored. Runs from the queue job `publish.mirror` right after the publish, and from the
  per-minute cron while something is pending (backoff 1 → 2 → 4 … 15 min after failures). One run at a time (a
  `MIRROR_CLAIM` in settings, taken over after 2 min). `GET /v1/admin/publish/status` → `mirror`: `configured`,
  `pending`, `since`, `late` (> 5 min), `last`.
- Config: vars `GITHUB_REPO` / `GITHUB_BRANCH` (production: the site repo, `main`; staging:
  `StAthanasiosYouth/publish-mirror-staging`, `main`), secret `GITHUB_TOKEN`. Outside production the production
  repository is refused in code. Without the secret the mirror only reports «GITHUB_TOKEN not set».
- **Rollback order:** `PUBLISH_MODE='shadow'` first (each publish is committed by Apps Script and also updates D1, so
  nothing the mirror still holds can come back over it), then `'github'` once `mirror.pending` is 0.
- Tests: Worker 208/208 (`publish-mirror` 9/9: one commit with exactly the live files, coalescing, never older,
  shadow never mirrored, GitHub down + backoff, a push in between, not configured, a busy claim, queue + cron),
  Apps Script `publish-shadow` 7/7 (worker mode: no text commit, refusal → no fallback commit, picture first), unit
  742/745 (3 known), `admin.e2e` unchanged (the 6 pre-existing media failures). Staging Worker `051c8047`:
  `worker/scripts/mirror-check.mjs` → live at once (≈ 0.5 s); the real commit part waits for the staging token.

### P2-3 as built (2026-10-21, staging / local only; nothing released)

- `assets/js/content-source.js`: `CONTENT_SOURCE = 'static'` (shipped). In `'worker'` mode the first, revalidating
  load asks `GET /v1/public/…` (credential-less CORS, `no-cache`); anything but a 200 within 2 s (404, 403
  `CONTENT_SERVE=0`, 5xx, network, CSP refusal, timeout) falls back to the static file with the page's own init. The
  offline `force-cache` retry stays static. Localhost only: `?content=worker|static` (or
  `localStorage['athanasios.content.source']`) and `?api=` (the booking's override key). It imports nothing, so a page
  without online booking still loads no booking module.
- Loaders: `content.js` (home), `page/main.js` (page, event, the events list), `comp/main.js` (comp.json).
- CSP: the Worker origins are in `connect-src` of `index.html`, `competition/index.html`, `points/index.html` and the
  Apps Script built-in stub policy (`COMP_SITE_CSP`; `PAGE_SITE_CSP` no longer adds them twice). The Worker now
  exposes `date` over CORS (the device-clock correction).
- **Cutover prerequisite (P2-9):** stubs committed before this change (today `black-theatre/`, `competition/test/`)
  still carry the old CSP. There the browser refuses the Worker request and the page uses its static file (tested:
  no breakage). They get the new CSP when their page is next published, or all at once with the P2-4 mirror. The
  Apps Script change (`COMP_SITE_CSP`) ships with the next Apps Script deploy.
- Tests: `tests/content-source.test.mjs` 7/7, `tests/content-source.e2e.mjs` 11/11 (Worker served / down / off /
  empty / slow; the shipped switch makes no request; an old stub), `pages-public` 19/19, `book-public` 17/17,
  `comp-public` 14/14; unit 738/741 (the 3 known). `browser.e2e` 5 failures are pre-existing (the same without this
  change). Real check: the local site on `:8080` against the staging Worker (`b68525ad`): home and `events/test`
  read their live revision (≈ 110 ms), no static request.

### P2-2 as built

- Apps Script (`WorkerSync.gs` `publishShadow_`, called from `Publish.gs` step D after the commit landed, under the
  publish claim): only when `PUBLISH_MODE='shadow'`. It posts the commit's text files with id
  `pub-<revision>-<start ms>`, one retry on 5xx/429/network, never throws. The outcome is kept in the Script Property
  `PUBLISH_SHADOW_LAST`. Any other value (unset, `github`, `worker`) posts nothing.
- Worker (`src/publish-shadow.js`): every 15 minutes on the per-minute cron, only once a publish has been posted, and
  not within 10 minutes of the last one (Pages build). It reads `content.json`, `meeting.ics` and every page, event
  and competition `content.json` lists from the site (≤ 40 reads), and compares each with the live D1 revision:
  `equal` · `lag` · `mismatch` · `missing` · `error`. One `shadow_checks` row per run (kept 60 days).
- `POST /v1/admin/publish/shadow-check` (`system.manage`, `{ seed: true }` copies the files D1 lacks from the site as
  live revisions, publish id `seed-…`). `GET /v1/admin/publish/status` (`system.view`): the last jobs, the last
  run, `cleanSince` / `cleanDays` (the gate).
- Production step (owner): apply `0013` + `0014` to `athanasios-prod`, deploy the Worker, deploy Apps Script,
  run one `seed` check, then set `PUBLISH_MODE='shadow'`. Rollback: delete `PUBLISH_MODE` (visitors are never
  affected: they still read GitHub Pages).

**Rules.** All work is done and tested on staging first. Production changes (D1 migration, Worker, Apps Script deploy,
site push, any switch) need the owner's explicit approval at the step marked **[owner]**. Phase 1.5 features and the
`NOTIFY_*`, `PERMS_ENFORCE` and `PAY_REQUESTS` switches are not touched.

## 1. Baseline (today)

`publishNow_` (`apps-script/Publish.gs`) builds the draft with `buildPublicContent` and writes one GitHub commit:
`content.json`, `meeting.ics`, `<slug>/` and `events/<slug>/` stubs + `page.json` / `event.json`,
`competition/<slug>/` stub + `comp.json`, and new media binaries. Visitors see it after the Pages build (~1 min).
The public loaders read only same-origin static files: `assets/js/content.js`, `assets/js/page/main.js` and
`assets/js/comp/main.js`. The Worker's booking module reads `events/<slug>/event.json` from the site
(`worker/src/book/event.js`).

## 2. Phase 2 end state

- Apps Script still owns drafts and the build (until Phase 4). On publish it **posts the built files to the Worker**.
- The Worker stores them as immutable rows in `published_revisions` and flips `live`. Visitors read them through
  public `GET` endpoints with ETag (304 on repeat).
- The GitHub commit becomes a **background mirror** (Queue job). It is the static fallback and the history.
- Media binaries stay with Apps Script. They are committed **before** the revision goes live, so a live revision never
  points at an image that is not on Pages yet.
- New slugs render at once through a root `404.html` shell. The real stub comes with the mirror.
- The booking module reads the event definition from the live D1 revision. The site file is the fallback.

## 3. Switches

| Switch | Where | Values | Default |
| --- | --- | --- | --- |
| `PUBLISH_MODE` | Apps Script Script Property | `github` (today) · `shadow` (commit as today, then post to the Worker; a failed post never fails the publish) · `worker` (post to the Worker = live; mirror commits) | `github` |
| `CONTENT_SOURCE` | site config (`assets/js/content-config.js`, new) | `static` · `worker` | `static` |
| `CONTENT_SERVE` | D1 `settings` | `0` → public content endpoints answer `403 disabled`, loaders fall back to static at once (kill switch without a Pages build) | absent = serve. Harmless while nothing posts: production has no revisions until P2-2 |

Rollback (§23): `CONTENT_SOURCE='static'` + `PUBLISH_MODE='github'`. `CONTENT_SERVE=0` is the instant first step.

## 4. Data (migration `0013_published_revisions.sql`, additive)

`published_revisions`: `id`, `kind` (`content` · `page` · `event` · `comp` · `ics` · `stub`), `key` (`site`, the slug, or a stub's folder),
`rev` (per kind+key, increasing), `hash` (sha-256 of `body`), `etag`, `body` (the exact file text), `withdrawn`,
`live` (0/1, exactly one live row per kind+key, enforced by a partial unique index), `publish_id`, `published_by`,
`published_at`, `mirrored_at`, `github_commit`. `stub` rows (a folder's `index.html`) are kept for the mirror, never served.

`publish_jobs`: one row per publish attempt (`id` from Apps Script, unique per attempt, reused by its retries; `state`
`live`·`mirroring`·`mirrored`·`failed`, `mode`, `revision`, `hash` of the whole file set, counts, `result`, timestamps).
Order: the signed `x-sync-ts` must be newer than the last accepted publish (`src/lib/sync.js`), so a late retry of an
older publish never overwrites a newer one. Same `id` + same files → the stored reply; same `id` + other files → `conflict`.

Size guard: ≤ 256 KB per file, ≤ 200 files and ≤ 2 MB per publish (today: content.json 22 KB, all JSON files < 20 KB).

## 5. Worker API

| Route | Auth | Contract |
| --- | --- | --- |
| `POST /v1/sync/publish` | `sync` (HMAC, `src/lib/sync.js`, kind `publish`) | Body: `{ id, mode, by, at, files: { "<path>": "<text>" } }`. Paths are mapped to kind+key (§4); unknown paths are refused. Validates JSON files parse, runs the "no private data" scan, then one `batch()`: insert new revisions for changed hashes, flip `live`, mark the job. Idempotent per `id` + hash (a replay returns the same result). Reply `{ id, live: [{kind,key,rev,hash}], unchanged }` |
| `GET /v1/public/content` | public | Live `content.json` body. `ETag` = hash, `Cache-Control: no-cache`, `304` on `If-None-Match`. CORS: the site origin (+ localhost) |
| `GET /v1/public/page/:slug`, `/event/:slug`, `/comp/:slug` | public | Same rules. `404 not_found` when no revision. A withdrawn revision is returned as its withdrawn JSON (the loaders already handle it) |
| `GET /v1/public/ics` | public | `meeting.ics` text (`text/calendar`) |
| `GET /v1/admin/publish/revisions?kind=&key=` | admin, `publish.publish` | Revision list without bodies (for restore, step 8) |
| `GET /v1/admin/publish/status` | admin | Last jobs, mirror lag, shadow comparison |

Public reads are not rate-limited (a limit costs a D1 write per page view); each is one indexed read. The post refuses
JSON that carries private keys (`phone`, `email`, `dob`, `codeHash`, `answers`, …).

## 6. Steps

| Step | Content | Size | Tests | Gate |
| --- | --- | --- | --- | --- |
| **P2-1** | Migration 0013, `POST /v1/sync/publish`, public GETs with ETag/CORS, `CONTENT_SERVE` | M | Worker unit tests: HMAC, path mapping, idempotency, live flip, 304, size/privacy refusals, kill switch. Staging smoke with a signed post | Staging only |
| P2-2 | Apps Script `PUBLISH_MODE='shadow'` post after the commit; shadow check (cron) compares each live hash with the file on Pages; status in diag | M | Apps Script unit (`tools`), staging rehearsal | **[owner]** production deploy of Apps Script + migration + Worker (invisible to visitors); then **1–2 weeks of equal hashes** |
| P2-3 | Loaders read the Worker when `CONTENT_SOURCE='worker'`, 2 s timeout → static fallback; CSP `connect-src` in `index.html` (+ `competition/`, `black-theatre/`, stub templates) | M–H | e2e: home, page, event, competition, API down, 503 | Staging |
| P2-4 | Worker mirror: Queue job commits the live snapshot (one commit), cron retries, «نسخة GitHub متأخرة» in the admin; `PUBLISH_MODE='worker'` (media committed by Apps Script first) | H | Worker unit (GitHub API mocked), staging against a test repo/branch | Needs a Worker `GITHUB_TOKEN` (fine-grained, contents on the repo only), created by the owner **[owner]** |
| P2-5 | Root `404.html` shell for new `<slug>/`, `events/<slug>/`, `competition/<slug>/` | M | e2e new slug before/after mirror | Staging |
| P2-6 | Booking `loadEvent` reads the live D1 `event` revision first, then the site | L–M | Worker unit + `rehearsal.mjs` on staging | Staging |
| P2-7 | Browser-side Review: the pure builders bundled into the admin, diff against the live revision | M | unit + admin e2e | Staging |
| P2-8 | Restore «ارجع للنسخة اللي قبلها»: flip `live` to an older revision + mirror; warning that the draft is unchanged and the next publish republishes it; activity row | M | Worker unit + admin e2e | Staging |
| P2-9 | Full staging rehearsal incl. rollback; production cutover: `PUBLISH_MODE='worker'`, `CONTENT_SOURCE='worker'` | H (ops) | Rehearsal checklist | **[owner]**, after the launch gate or the owner's decision |

Publish events go to `activity` (and, per the roadmap, can feed the router later). `NOTIFY_ROUTER` stays 0.

## 7. Risks

- Live revision ahead of the mirror: new media → committed first (§2); new slug → `404.html` (P2-5); booking → D1 (P2-6).
- Worker down: loaders fall back to static within 2 s; `CONTENT_SERVE=0` makes it instant.
- Two writers to GitHub: Apps Script commits in `github`/`shadow`, only the mirror in `worker`. Never both.
- Restore vs. draft: restore changes only the public side (P2-8 warning).
- Free-tier writes: one publish ≈ 10–20 row writes; far below the limits.

## 8. Out of scope

Drafts in D1 and the builders on the Worker (Phase 4), media to R2 (Phase 4), admin chrome (Phase 3), any UI redesign (Phase 8).

## 9. P2-9 — staging rehearsal and the production cutover runbook

Status 2026-10-21: P2-1 … P2-8 built and checked on staging (P2-7 in the reduced scope above). **Nothing of P2-3 …
P2-8 is in production yet.** Every production step below needs the owner's explicit approval, one at a time.

### Gate (before any cutover step)

| Check | Today (2026-10-21) | Needed |
| --- | --- | --- |
| `PUBLISH_MODE='shadow'` set in production (Script Property, owner) | 0 shadow publishes in production D1 (not set yet, or no publish since) | set, then normal publishing |
| Shadow comparison clean | 0 runs | `GET /v1/admin/publish/status` → `cleanDays` ≥ 7–14, `lastDirtyAt` explained |
| Launch gate (BOOKING-PHASE1-COMPLETION-PLAN §6) | open | closed, or the owner decides the cutover goes first |
| Production `GITHUB_TOKEN` (owner) | not set | fine-grained, **Contents read/write on the site repo only**, `npx wrangler secret put GITHUB_TOKEN` (no `--env`) |

### Staging rehearsal (repeat right before the cutover)

- `cd worker && node scripts/phase2-rehearsal.mjs` → publish-check, shadow-check, mirror-check, restore-check (wait ~10
  min between two runs: staging rate limits).
- Local (Chrome): `cd tools && node --test --test-concurrency=1 ../tests/content-source.e2e.mjs ../tests/not-found.e2e.mjs
  ../tests/accounts-admin.e2e.mjs ../tests/pages-public.e2e.mjs ../tests/book-public.e2e.mjs ../tests/comp-public.e2e.mjs`.
- Unit: `cd worker && npm test`; `cd tools && npm test` (only the 3 known failures).

### Production steps (each one: owner approval → do → verify → report)

1. **Release R1 — code, switches unchanged.** Cherry-pick P2-3 … P2-8 onto `origin/main` (temporary worktree), push →
   CI deploys the Worker; Apps Script deploy (`@56`: worker mode code, `COMP_SITE_CSP`, `apiPublishRefresh`).
   Visitors: no change (`CONTENT_SOURCE='static'`, `PUBLISH_MODE` stays `shadow`). Verify: site, booking, Worker
   health, the next shadow publish and comparison.
2. **Re-stub (one maintenance commit).** The stubs committed before the new CSP (`black-theatre/index.html`,
   `competition/test/index.html`; re-list with the loop in this file's history) get the shell's CSP line, nothing
   else. Until then those pages use their static file (safe, tested).
3. **Production token** (owner, `wrangler secret put GITHUB_TOKEN`). The mirror stays idle: nothing is in `worker` mode.
4. **Cutover (one short window, the owner present):**
   a. site push `CONTENT_SOURCE = 'worker'` (`assets/js/content-source.js`; Pages ~1 min) — visitors read the Worker,
      which equals the site (the shadow gate);
   b. owner sets `PUBLISH_MODE='worker'` (Script Property);
   c. one small real publish: visible at once on the site; «نسخة GitHub اتحدثت ✓» within ~2 min; the mirror commit on
      `main`; booking state of a published event; `GET /v1/admin/publish/status` → `mirror.pending` 0.
5. **Watch** for a few days: `mirror.late`, the activity log, booking.

### Rollback (fastest first)

| Problem | Action | Time |
| --- | --- | --- |
| The Worker serves something wrong | D1 `CONTENT_SERVE='0'` → every page uses its static file at once | seconds |
| Publishing through the Worker misbehaves | `PUBLISH_MODE='shadow'` (Apps Script commits again; D1 still follows); `'github'` only once `mirror.pending` is 0 | 1 min |
| Back to static for good | site push `CONTENT_SOURCE = 'static'` | ~1 min (Pages) |
| A bad Worker release | `wrangler rollback <previous version>` | seconds |
| A bad Apps Script release | redeploy the previous version (`@55`) | minutes |
| A wrong publish | «نسخ النشر» → «ارجع للنسخة دي» (worker mode), or the previous GitHub commit (github mode) | seconds |
