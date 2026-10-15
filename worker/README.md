# athanasios-api (Cloudflare Worker)

The new backend, built next to Apps Script and migrated to module by module
(docs/BACKEND-MIGRATION.md).

**Status (Phase 1 foundation):**
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
| R2 (private) | `athanasios-private` — **pending: R2 not enabled on the account** | `athanasios-private-staging` (pending) |
| Cron | `17 1 * * *` housekeeping | `47 1 * * *` |

### Bindings (names the code uses; keep them when moving accounts)

| Binding | Type | Notes |
| --- | --- | --- |
| `DB` | D1 | all data |
| `JOBS` | Queue producer | background jobs (`src/jobs.js`) |
| `PRIVATE` | R2 | proofs, media originals. Optional until R2 is enabled; `/v1/health/deep` reports `storage` |

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
| `ADMIN_EMAILS` | both | Bootstrap admin allowlist (comma list). Each admin's row is created and its Google `sub` bound on first sign-in. **Not set in production yet** (no admin can use it: intended) |
| `STAGING_TEST_JWK` | **staging only** | Public JWK of the load-test signing key (`.staging-test-key.pem`, gitignored). Ignored unless `ENVIRONMENT === 'staging'` |

**Later phases add:**
- `COMP_SECRET`, `CODE_PEPPER`, `CODE_KEY` (copied from Apps Script, so codes and tokens keep working)
- `SYNC_SECRET` (Apps Script → Worker sync)
- `FCM_SERVICE_ACCOUNT`, `GITHUB_TOKEN`, `TURNSTILE_SECRET`, `ORS_API_KEY`

## API (foundation)

| Route | Auth | |
| --- | --- | --- |
| `GET /v1/health` | public | liveness, no DB |
| `GET /v1/health/deep` | public, 30/min/IP | DB + migrations, storage, queue |
| `GET /v1/admin/whoami` | admin | the verified admin |
| `GET /v1/admin/activity?before&limit` | admin | audit log, newest first |
| `POST /v1/admin/diag/echo` | admin + `Idempotency-Key` | foundation check: one audit row + one queue job, exactly once |

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
   - R2: copy the objects (rclone with S3 credentials, or a one-off Worker).
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
| `drafts/0002_bookings.sql` | booking pilot schema, **not applied** until the pilot is approved |
| `scripts/` | `setup-resources`, `smoke`, `load` (staging), `backup` (age keygen/encrypt/decrypt) |
| `test/` | `node --test` on `node:sqlite` (`d1-sqlite.mjs` adapter) |
