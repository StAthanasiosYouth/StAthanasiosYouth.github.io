# athanasios-api (Cloudflare Worker)

The new backend, built next to Apps Script and migrated to module by module
(docs/BACKEND-MIGRATION.md).

**Status (Phase 1 foundation, 2026-10-15):**
- Live and healthy.
- **No production module uses it yet.** The site and admin still call Apps
  Script only.

This folder is excluded from the GitHub Pages build (`_config.yml`).

## Resources

All resources live in Cloudflare account `menazakmena@gmail.com` (workers.dev subdomain `menazak-lab`).

| What | Production | Staging |
| --- | --- | --- |
| Worker | `athanasios-api` → https://athanasios-api.menazak-lab.workers.dev | `athanasios-api-staging` → https://athanasios-api-staging.menazak-lab.workers.dev |
| D1 (location `eeur`) | `athanasios-prod` | `athanasios-staging` |
| Queue / dead letters | `athanasios-jobs` / `athanasios-jobs-dlq` | `athanasios-jobs-staging` / `…-staging-dlq` |
| R2 (private, `eeur`, Standard, r2.dev off) | `athanasios-proofs-prod` | `athanasios-proofs-staging` |
| Cron | `17 1 * * *` housekeeping | `47 1 * * *` |

### Bindings (names the code uses; keep them when moving accounts)

| Binding | Type | Notes |
| --- | --- | --- |
| `DB` | D1 | all data |
| `JOBS` | Queue producer | background jobs (`src/jobs.js`) |
| `PROOFS` | R2 | private proof files (`src/lib/proofs.js`). `/v1/health/deep` reports `storage` (read-only probe) |

### Variables (`wrangler.jsonc`, public)

| Name | Purpose |
| --- | --- |
| `ENVIRONMENT` | `production` or `staging` |
| `ALLOWED_ORIGINS` | CORS allowlist: the site only, plus localhost on staging |
| `GOOGLE_CLIENT_ID` | the admin's OAuth client, the same one as `admin/config.js` |

### Secrets (never in git; `wrangler secret put NAME [--env staging]`)

| Name | Where | Purpose |
| --- | --- | --- |
| `LOG_SALT` | both | HMAC salt for pseudonymous actor/IP hashes in logs and rate-limit keys. Random 32 bytes |
| `SYNC_SECRET` | both | HMAC key for Apps Script → Worker sync (`src/lib/sync.js`). Production: the same value as the Apps Script Script Property `WORKER_SYNC_SECRET`. Staging: `.staging-sync-secret` (gitignored) |
| `ADMIN_EMAILS` | staging only | Bootstrap allowlist for tests. **Production does not use it**: its admins are copied from Apps Script (see "Admin allowlist") |
| `BOOK_SECRET` | both (production: at go-live) | HMAC for visitor booking status links and proof claims (≥ 32 chars). Staging: `.staging-book-secret` |
| `TURNSTILE_SECRET` | both (production: at go-live) | Cloudflare Turnstile secret for `POST /v1/book/submit` (`src/book/turnstile.js`). **Production without it refuses every submit.** Staging: Cloudflare's always-pass TEST secret `1x0000000000000000000000000000000AA`. The site key is the var `TURNSTILE_SITEKEY` (wrangler.jsonc; staging: the TEST key `1x00000000000000000000AA`) |
| `STAGING_TEST_JWK` | **staging only** | Public JWK of the load-test signing key (`.staging-test-key.pem`, gitignored). Ignored unless `ENVIRONMENT === 'staging'` |

**Later phases add:**
- `COMP_SECRET`, `CODE_PEPPER`, `CODE_KEY` (copied from Apps Script, so codes and tokens keep working)
- `FCM_SERVICE_ACCOUNT`, `GITHUB_TOKEN`, `ORS_API_KEY`

## API (foundation)

| Route | Auth | |
| --- | --- | --- |
| `GET /v1/health` | public | liveness, no DB |
| `GET /v1/health/deep` | public, 30/min/IP | DB + migrations, storage, queue |
| `GET /v1/admin/whoami` | admin | the verified admin |
| `GET /v1/admin/activity?before&limit` | admin | audit log, newest first |
| `POST /v1/admin/diag/echo` | admin + `Idempotency-Key` | foundation check: one audit row + one queue job, exactly once |
| `POST /v1/admin/diag/housekeeping` | admin, 6/min | run the daily cleanup now (retention, orphans) |
| `POST /v1/admin/proofs?purpose=test` | admin + `Idempotency-Key`, 60/min | upload a proof image (raw body). Until the booking pilot only `test` proofs |
| `GET /v1/admin/proofs/:id` | admin, 300/min | the file, streamed (`private, no-store`, sandboxed) |
| `DELETE /v1/admin/proofs/:id` | admin | deletes the file; the row stays with `deleted_at` |
| `POST /v1/sync/admins` | signed by Apps Script | the admin allowlist |
| `POST /v1/sync/grants` | signed by Apps Script, 120/min | the grants snapshot Apps Script caches 60 s (`apps-script/Grants.gs`) |
| `POST /v1/sync/activity` | signed by Apps Script, 60/min, ≤ 250 rows | Activity tab rows into D1, upserted by id (resends / merged rows never duplicate; Worker rows never overwritten) |

**Unified «سجل النشاط»:** `GET /v1/admin/activity?view=log&limit&before&actor&family&section&from&to&id` returns the
Worker's rows and the forwarded Apps Script rows together, in the shape of Apps Script `apiActivity`
(`view=log` hides diagnostics / feeds / syncs). Forwarding: `apps-script/WorkerSync.gs activityForward_` (history once,
then new rows; critical rows at once). Forwarded rows are stored `notified = 1`: Apps Script still sends its own admin
pushes until the step-5 router. Live check: `node scripts/activity-check.mjs` (staging).

**Permissions (Phase 1.5):** every admin route needs the permission in `src/lib/perms.js` `ROUTE_PERMS`
(grants in D1 `admin_grants`). Switch `settings.PERMS_ENFORCE`: `'0'` (default, rollback) = every active
admin holds everything except `accounts.manage`, `notifications.manage`, `participants.manage`; `'1'` = grants only.
The Primary Admin always holds everything. A denial is `denied 403` with `perm`.

**Accounts («الصلاحيات», `src/lib/accounts.js`):** D1 owns the admins and their grants; Apps Script mirrors
the active list into `ADMIN_EMAILS` within a minute (`apps-script/Grants.gs`), and `/v1/sync/admins` only
refreshes names. `GET /v1/admin/accounts` (accounts.view); `POST /v1/admin/accounts`,
`POST /v1/admin/accounts/:email`, `POST /v1/admin/accounts/:email/remove` (accounts.manage, **a Google ID
token**, not the panel's `wk1` token → `google 403`). Refusals: `protected 403` with `reason`
(`primary` | `self` | `last` | `max`), `denied 403` with the `perm` the actor doesn't hold. Every change
writes a `critical` activity row. Live check: `node scripts/accounts-check.mjs` (staging).
Emergency (no panel): `wrangler d1 execute <db> --remote --command "UPDATE admins SET active = 1 WHERE email = '…'"`;
`ADMIN_EMAILS` follows on the next grants pull.

**Envelope:**
- Success: `{ ok: true, … }`.
- Failure: `{ ok: false, code, message, hint?, requestId }`, with Arabic messages in the Apps Script voice.
- Codes: `auth 401`, `denied 403`, `bad 400`, `toolarge 413`, `rate 429` (+`retry-after`), `conflict`/`busy 409`, `notfound 404`, `method 405`, `error 500`. Internal error text is never returned.

**Admin auth:**
- Send `Authorization: Bearer <Google ID token>`, the same token the admin already has.
- The token is verified locally against Google's JWKS: RS256, `iss`, `aud` = `GOOGLE_CLIENT_ID`, `exp`/`iat` ±60 s, `email_verified`.
- The allowlist is checked next: the `admins` table, plus the `ADMIN_EMAILS` bootstrap list.
- An admin row bound to a different Google `sub` is refused.

**Writes:**
- Every write is idempotent.
- `Idempotency-Key` gives the same answer for the same body, `409 conflict` for a different body, and `409 busy` while a twin is running.
- Domain tables also carry UNIQUE keys.
- Transient D1 errors are retried (`src/lib/db.js`), only around idempotent work.

**Headers:**
- `nosniff`, `no-referrer`, HSTS, CSP `default-src 'none'`, `X-Frame-Options: DENY`, `Cache-Control: no-store`.
- CORS only for `ALLOWED_ORIGINS`.
- Bodies ≤ 64 KB JSON.

**Logs:**
- One JSON line per request (Workers Logs): request id, route, status, ms, colo, pseudonymous actor.
- Never bodies, emails, IPs or tokens.
- Errors and slow requests (≥ 1.5 s) are also kept in D1 `api_log` for 30 days.

## Private proofs (R2)

**Rules:**
- The bucket is private: r2.dev access disabled, no custom domain, no presigned URLs.
- Bytes leave R2 **only** through `GET /v1/admin/proofs/:id` after admin sign-in.
- Replies never contain a URL or storage key.
- D1 `proofs` (migration 0002) keeps only the reference: id, `r2_key`, mime, bytes, sha256, width/height, who, when, retention date, deletion.

**Accepted files** (EVENTS.md §6):
- JPEG or WebP, **decided by the file's first bytes**, not the Content-Type.
- ≤ 900 KB and ≤ 2400 px on the longest side.
- The same image uploaded twice is reported in `duplicates` and still accepted.

**Write order:**
1. Write to R2.
2. Write the D1 row together with its audit row and idempotency answer, in one batch.
3. If the row fails, the object is deleted again.

**Retention** (daily cron + `POST /v1/admin/diag/housekeeping`):
- Files past `delete_after_ms` are deleted, and the row is marked `deleted_by = 'retention'`. The default is 60 days; booking proofs will use the event's end + 60 days.
- R2 objects that no row names and are older than 24 h (orphans) are deleted.

**Tests:**
- `test/proofs.test.mjs` (in-memory R2).
- `node scripts/proof-check.mjs`: live **staging** check with real JPEG/WebP covering upload, replay, read, auth, delete, refusals, retention, orphans and r2.dev.

## Admin allowlist (copied from Apps Script)

Admins are still added and removed in the existing Admin («صلاحيات لوحة التحكم», Script Property `ADMIN_EMAILS`). `apps-script/WorkerSync.gs` copies that list to the Worker's `admins` table.

**How it works:**
- Signed (`SYNC_SECRET` = Script Property `WORKER_SYNC_SECRET`), checked within ±5 min, with replays refused.
- Sent from the background only:
  - after an admin's heartbeat, at most every 10 min, and right away after an allowlist change;
  - from the daily trigger;
  - only when the list changed (plus a 6-hour refresh).
- Listed emails are active; removed ones become inactive. Rows are kept, so each admin's Google `sub` binding stays.
- `/v1/health/deep` shows `admins.active` and `admins.syncedAt`.

**First deploy of the secret (done 2026-10-15):**
- The value went into the Worker (`wrangler secret put SYNC_SECRET`) and into a git-ignored `apps-script/WorkerSyncSeed.local.gs` pushed with the API deploy.
- On the first sync, `WorkerSync.gs` copies it into the Script Property.
- **After `admins.syncedAt` appears:** delete the local seed file and redeploy the API, so the value then lives only in Script Properties.

**To rotate:**
1. Set a new `SYNC_SECRET` on the Worker.
2. Set the same value in Apps Script → Project Settings → Script Properties → `WORKER_SYNC_SECRET`.

## Booking pilot (Phase 1)

**Where things are:**
- Contract: `BOOKING-API.md` (transport) + `docs/EVENTS.md` (product).
- Code: `src/book/` — `model.js` (pure rules, pricing checked against `apps-script/BookModel.gs`), `event.js`, `token.js`, `public.js`, `admin.js`, `turnstile.js`, `locks.js`, `news.js`.
- Schema: migrations `0003_bookings.sql`, `0004_booking_ops.sql` (phone retention, edit locks, the new-bookings counters).
- Operations (BOOKING-API.md): Turnstile on submit, edit locks on bookings, the grouped new-bookings feed for the admin push (Apps Script `BookNotify.gs` pulls `POST /v1/sync/book-news`), phones blanked 12 months after the event (daily cron).

**Event settings:**
- The bookable definition of an event is its **published** `events/<slug>/event.json` on the site (`SITE_URL`).
- It is read on demand and kept in `event_cfg` (re-read when older than 60 s, or on «حدّث بيانات الفعالية»).
- Admins keep editing events in the existing Admin, then publish.

**Switches** (production: both OFF until go-live):
1. Worker `settings.BOOKING_MODULE` = `'1'` (`POST /v1/admin/book/module`, primary admin only).
2. Apps Script Script Property `BOOKING_ONLINE` = `'1'`, so the next publish writes `booking.online: true` into event.json.

**Atomic writes:**
- Each state change is one D1 batch whose first statement is guarded by the booking `version`. Confirm and update also recount the places in the same statement.
- Payments and audit rows land only when that guarded statement did (`EXISTS` on the new version).
- Payment `idem_key` and booking `request_key` are UNIQUE.
- Payments are append-only; a void is a row (`payments_one_void`).

**Secrets:**
- `BOOK_SECRET`: HMAC for visitor status links and proof claims. Staging: `.staging-book-secret` (gitignored). Production: set (2026-10-19).

**Staging only:**
- `POST /v1/admin/diag/event-fixture` stores a test event.
- `node scripts/book-check.mjs` runs the whole flow and the races on staging: same requestKey, same phone, IP budget, last places, parallel payments, competing voids.
- `node scripts/book-ops-check.mjs` checks Turnstile (no token refused, the test token passes), edit locks, the new-bookings feed (signed sync, grouping, cooldown) and the 12-month phone retention. With the staging secret switched to the always-fail TEST secret: `--turnstile-fails`.
- `node scripts/book-ui-staging.mjs <out>` (the event page in real Chrome, with the real Turnstile widget) and `cd tools && node ../tests/book-admin-staging.mjs` (the real admin, edit locks included). Run the UI check ≥ 10 min after book-check: book-check spends the per-IP budgets.

**Go-live (production), in order:**
1. Done 2026-10-19: `BOOK_SECRET` and `TURNSTILE_SECRET` (the «Athanasios booking» widget for stathanasiosyouth.github.io); its site key as `TURNSTILE_SITEKEY` in the production vars.
2. Done 2026-10-19 (Worker + migrations 0003 + 0004). Push to main and deploy Apps Script (BookModel online switch, BookNotify.gs, AdminNotify/Activity changes).
3. Apps Script editor: Run ▸ `enableBookingAlerts` once (the 5-minute new-bookings trigger).
4. `POST /v1/admin/book/module { on: true }` (primary admin), Script Property `BOOKING_ONLINE` = 1, republish the events.

## Develop and test

```bash
cd worker
npm ci
npm test                        # node --test on real SQLite (node:sqlite), same migrations as D1
node scripts/smoke.mjs staging  # read-only checks against a deployed Worker
node scripts/load.mjs           # STAGING ONLY: latency, idempotency races, burst, queue, rate limit
```

## Automatic deployment (GitHub Actions)

`.github/workflows/worker.yml` runs on every push to `main` that touches `worker/**`:

1. `npm test`
2. staging migrations + deploy
3. staging smoke
4. production migrations + deploy
5. production smoke

Content publishes from the admin never touch `worker/`, so they never deploy.

**One-time setup** (a repository admin):

1. In Cloudflare, go to **My Profile → API Tokens → Create Token** and choose **"Edit Cloudflare Workers"**. Add **Account → D1 → Edit**. Scope it to this account only.
2. In GitHub, go to **StAthanasiosYouth.github.io → Settings → Secrets and variables → Actions** and add:
   - `CLOUDFLARE_API_TOKEN`: the token from step 1
   - `CLOUDFLARE_ACCOUNT_ID`: `1bde3770413cf908df545d96de8520f7`
   - optional variable `BACKUP_AGE_RECIPIENT` (defaults to the recipient in `worker-backup.yml`)

Until the secrets exist, the deploy and backup jobs are **skipped with a warning**. Deploy manually from a logged-in machine:

```bash
npm run deploy:staging && node scripts/smoke.mjs staging
npm run deploy:production && node scripts/smoke.mjs production
```

## Backups

| Layer | What | Restore |
| --- | --- | --- |
| D1 Time Travel | any minute of the last **7 days** (Free) | `npx wrangler d1 time-travel restore athanasios-prod --timestamp=<ISO>` (destructive: replaces the DB). Use `time-travel info` first |
| Nightly export (off Cloudflare) | `.github/workflows/worker-backup.yml`, 00:23 UTC: `wrangler d1 export` → **age-encrypted** to the public recipient → workflow artifact, 30 days | see below |
| Code / config | git | — |

The **age identity (private key)** was generated on the admin PC at
`C:\Users\menaz\athanasios-keys\d1-backup-identity.txt`.
- **Move it into two admins' password managers, then delete the file.**
- It is never stored in git or CI.
- Without it, backups cannot be read; with it, anyone can read them.

**Restore from an encrypted backup:**

```bash
node scripts/backup.mjs decrypt backup-….sql.age restored.sql <identity-file>
npx wrangler d1 create athanasios-restore --location eeur        # restore into a NEW db first
npx wrangler d1 execute athanasios-restore --remote --file restored.sql
# verify counts, then either point the binding at it (wrangler.jsonc database_id) or
# copy tables back. Never restore over production without a fresh export first.
```

**Restore drill (2026-10-15):**
- Staging was exported, encrypted, decrypted and imported into a fresh DB.
- The counts matched exactly: activity 488, idempotency 244, rate_limits 2, migrations 1.
- The drill DB was then deleted.

## Rollback

| Problem | Action | Time |
| --- | --- | --- |
| Bad Worker deploy | `npx wrangler deployments list` → `npx wrangler rollback <version-id>` (add `--env staging` for staging) | seconds |
| Bad migration / bad data | D1 migrations are forward-only. Fix forward with a new migration, or Time Travel restore to just before it | minutes |
| A module misbehaves | turn its switch off (`settings` table, e.g. `BOOKING_MODULE` = `0`) → it answers `disabled`; the site keeps using Apps Script | seconds |
| Abandon the Worker entirely | nothing in production depends on it yet; later phases each have their own rollback (docs/BACKEND-MIGRATION.md §23) | — |

## Moving to another Cloudflare account (portability)

Everything except data and secrets is in git. To move:

1. `npx wrangler login` with the new account (or set `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`).
2. `node scripts/setup-resources.mjs`. It creates the D1 databases, queues and R2 buckets, and prints the new `database_id`s. Paste them into `wrangler.jsonc`.
3. Set the secrets listed above (new random `LOG_SALT` is fine; copy `COMP_SECRET`/`CODE_*` exactly once they exist).
4. Move the data:
   - `npx wrangler d1 export athanasios-prod --remote --output prod.sql` from the **old** account;
   - `npx wrangler d1 execute athanasios-prod --remote --file prod.sql` into the **new** one.
   - R2: copy the objects of `athanasios-proofs-*` (rclone with S3 credentials, or a one-off Worker). Keys are stored in D1 `proofs.r2_key`, so the same keys must be kept.
5. `npm run deploy:staging`, `npm run deploy:production`, then run both smoke tests.
6. Point the site's API URL (later: `admin/config.js` / site config) at the new `workers.dev` URL. Update the GitHub secrets.
7. Keep the old account read-only for 30 days, then delete it.

## Files

| Path | What |
| --- | --- |
| `src/index.js` | entry: fetch / queue / scheduled |
| `src/routes.js` | route table |
| `src/lib/http.js` | envelope, CORS, security headers, body limits |
| `src/lib/auth.js` | Google ID token verification, allowlist |
| `src/lib/ratelimit.js` | D1 fixed-window limits |
| `src/lib/idempotency.js` | idempotency keys |
| `src/lib/db.js` | retries, Cairo time |
| `src/lib/activity.js` | audit rows |
| `src/lib/log.js` | structured logs, `api_log` |
| `src/lib/hash.js` | hashing, ids |
| `src/jobs.js` | queue consumer + dead letters |
| `src/scheduled.js` | daily housekeeping (retention) |
| `migrations/` | D1 schema, versioned, forward-only |
| `drafts/0003_bookings.sql` | booking pilot schema, **not applied** until the pilot is approved |
| `scripts/` | `setup-resources`, `smoke`, `load` + `proof-check` (staging), `backup` (age keygen/encrypt/decrypt) |
| `src/lib/proofs.js`, `src/lib/image.js` | private proofs in R2, image checks |
| `src/lib/sync.js` | signed Apps Script → Worker sync |
| `test/` | `node --test` on `node:sqlite` (`d1-sqlite.mjs` adapter) |
