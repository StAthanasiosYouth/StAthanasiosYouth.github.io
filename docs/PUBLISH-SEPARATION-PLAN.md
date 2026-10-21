# Phase 2 — publish separation: execution plan

Rev. 1, 2026-10-21. This is the execution contract for Phase 2. The approved spec is `docs/BACKEND-MIGRATION.md`
§22 (row 2), §5, §6, §15, §19 and §23. This file does not change that spec. It fixes the order, the switches and the
contracts each step builds against.

**Status (2026-10-21).** P2-1 done on **staging only**: migration `0013` applied to `athanasios-staging`, Worker
`94e8ba6d` (staging), Worker tests 192/192, `worker/scripts/publish-check.mjs` 21/21. Production: untouched
(no migration, no deploy). Next: P2-2 (needs the owner's approval for its production step).

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
