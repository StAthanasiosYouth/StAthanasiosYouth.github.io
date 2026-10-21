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
