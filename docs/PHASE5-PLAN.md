# Phase 5: batches and execution record

Started 2026-10-30 (owner's start order). This file organizes the work; it does not replace the contracts:
`docs/YOUTH-ACCOUNTS-PLAN.md` rev. 5 (5A), `docs/MEMBER-NOTIFICATIONS-PLAN.md` (member email), `docs/COMPETITIONS.md` §20 (crediting, result visibility), `docs/BACKEND-MIGRATION.md` §22 (Phase 5 row, gates). Where this file and a contract differ, the contract wins, unless this file states a boundary change and its reason.

Working method (same as Phase 4): one batch at a time; implement → local tests → staging → report → the owner chooses «next batch» or «stop». **No production change and no new batch without the owner's explicit choice.** Data and rollback are kept in every step.

## 1. Batches

| Batch | Steps | Scope | Contract sections |
| --- | --- | --- | --- |
| **1** | **P5-1** accounts foundation · **P5-2** sign-in | Schema, credentials, sessions, switches; registration + OTP, discovery, sign-in, forgot + OTP; the public `/account/` page | YOUTH §5–§8, §10, §13, §16, §20, §21; MEMBER §2, §9 (OTP only) |
| 2 | P5-3 profiles · P5-4 member email | Account page sections, «إشعاراتي»; `member_outbox` cron, catalog, budget rule + counters, Tier 0 notices, health in «حالة النظام» | YOUTH 5A-2; MEMBER §3–§9, §11 (5A-1, 5A-2) |
| 3 | P5-5 participants · P5-6 points | Admin person sheet, create without OTP, corrections, view/reset password, support recovery, review list, Excel; **booking age sync + booking/payment email (5A-4)**; points ledger, seasons, frozen balance | YOUTH §6.5, §11, §12, §17–§19; MEMBER §4.2, §6; BACKEND-MIGRATION «Points» |
| 4 | P5-7 store · P5-8 competitions runtime | Store and redemptions; competitions runtime on sessions, crediting + result visibility, results/store/age-out email; `competition/` and `points/` switch to accounts | YOUTH §9.5, §18; COMPETITIONS §20; MEMBER §4.3–§4.4 |
| 5 | P5-9 full tests · P5-10 launch | Rehearsal, real inboxes (Gmail, Yahoo, Outlook), device matrix; `accounts_mode = on` in production on the owner's approval | YOUTH §23 (rehearsal, launch), §25; BACKEND-MIGRATION Phase 5 gates |

### Boundary changes, and why

1. **The code email moved from batch 2 into batch 1 (P5-1/P5-2).** An account can't exist before its OTP (YOUTH §6.7), and forgot needs the same code, so sign-in can't be tested without it. Batch 1 has only the OTP path: inline send, one `member_outbox` row, the `otp` counter. The rest of member email stays in batch 2.
2. **Booking age sync (5A-4) sits in batch 3, not in a batch of its own.** It needs the admin DOB correction (P5-5) and booking mail needs the member outbox (P5-4). The owner's batches had no slot for it; it can't be dropped (BOOKING-PHASE1 §4.9.5).
3. **Points are split across batches 3 and 4.** The ledger, seasons and manual adjustments are in P5-6; crediting from competitions (COMPETITIONS §20) needs the runtime, so it lands with P5-8.
4. **Admin account actions stay in batch 3 (P5-5)**, although YOUTH §23 lists their endpoints in 5A-1: the owner's order puts participants there, and nothing in batch 1 needs them. Until then the only accounts are self-registered, so the first-recovery alert on admin-verified emails (YOUTH §6.5) has nothing to act on: it ships with admin creation.

## 2. Batch 1 (P5-1 + P5-2): what was built

Status: **implemented and verified on staging, 2026-10-30. Not on `main`, not in production.**

**Worker**
- `worker/migrations/0018_accounts.sql` (additive): `participants`, `account_sessions`, `pending_registrations`, `otp_codes`, `member_outbox`, `member_prefs`, `participant_audit`; settings `accounts_mode = off`, `OTP_EMAIL = 0`, `MEMBER_EMAIL = 0`, age range 18/30/60, session lengths, discovery cap.
- `worker/src/account/`: `model.js` (rules), `secret.js` (credentials), `session.js`, `mail.js` (code email), `routes.js`.
- Routes: `GET /v1/account/config`, `POST /v1/account/signin`, `register/start`, `register/verify`, `GET /v1/account/me`, `POST /v1/account/logout`, `forgot`, `forgot/verify`.
- Secrets: `PW_PEPPER`, `PW_KEY`, `OTP_PEPPER` (`worker/scripts/account-secrets.mjs` generates and pipes them, never prints them).

**Site**
- `account/index.html`, `assets/js/account/{app,model,page}.js`, `assets/css/account.css`. `mountAccount()` is the module batch 4 mounts in `competition/` and `points/`. Nothing links to `/account/` yet.
- `account` reserved as a page slug (`sw.js`, `not-found.js`, `page/model.js`, `Pages.gs`; generated `gs.gen.js`, `review-kit.js`). The Worker is the content writer, so its bundle is what enforces it; the Apps Script copy follows at the next Apps Script deploy.

**Decisions inside the contract**
- Plan's reply `code: 'verify'` for a missing check is the existing `turnstile` code, so the booking wording and handling are reused.
- «5 wrong → interactive Turnstile» (§21.3): the reply carries `challenge: true`. Every sign-in already needs a valid token; whether Cloudflare asks for a visible check is the widget's own decision, so the server cannot force it per request. The hard limit is the 15-minute rest after 10.
- `support_contact_id` (§11) is not read yet: the page and mail use the fixed support contact of `templates.js`. The Admin setting comes with batch 3.
- Discovery monitoring and its admin alert at 50% (§8.4) come with «حالة النظام» in batch 2. The caps themselves are live.

**Watch item for the owner.** `acct.otp.send` per IP is 20 an hour (§6.6, §21.4), lower than `acct.register` 30 an hour «for church Wi-Fi». A registration burst on one Wi-Fi can reach it (`otp_limit`). Kept as written; review at the P5-9 rehearsal, with admin creation (batch 3) as the fallback.

## 3. Batch 1 results (2026-10-30)

| Check | Result |
| --- | --- |
| Worker unit tests (`npm test` in `worker/`), 33 new in `test/account.test.mjs` | 308 / 308 |
| Site unit tests `tests/account-public.test.mjs` | 9 / 9 |
| Staging API `node scripts/account-check.mjs` | 47 / 47 |
| Staging page in a browser, desktop and 375 px (via `?api=` on localhost) | Passed: full registration, wrong code, password view, sign-in, remembered card (session valid / ended), wrong password, forgot, «انسَ الجهاز», shared device, typo hint, no horizontal overflow |
| Staging Gmail token (`diag/gmail-health`, no email sent) | Healthy |
| Site unit tests (`npm test` in `tools/`) | 770 pass; 3 fail, the known pre-existing ones (none about accounts) |
| Production | Unchanged: Worker `4408fb3a`, no migration, no secret, nothing pushed |

Staging: migration `0018` applied; Worker version `a69f6f79` (with the three secrets); `accounts_mode = on`, `OTP_EMAIL = 0` left on staging.

**Not verified in this batch (planned for P5-9):**
- A real code email reaching a real inbox. All staging codes used `@staging.invalid`, which sends nothing. The Gmail call itself is covered only by unit tests with a fake Gmail.
- A real Turnstile widget: staging uses Cloudflare's always-pass test keys.
- Password-manager save and fill on real devices (the device matrix, YOUTH §25).
- The Excel, admin and points parts: later batches.

## 4. Rollback (batch 1)

- Staging: `UPDATE settings SET value = 'off' WHERE key = 'accounts_mode'` (tested by the check script: every route answers `accounts_off`) or `wrangler rollback --env staging`.
- Production (when released): the schema is additive and unused while `accounts_mode = off`; `wrangler rollback` to the previous version for a bad deploy. Migrations are forward-only (YOUTH §24).
- No existing table, booking, content or admin flow is changed by this batch.

## 5. Before production (needs the owner)

Production release of batch 1 is a separate approval: `main`, migration `0018`, the deploy, and `node scripts/account-secrets.mjs --production`. Everything stays dormant with `accounts_mode = off`.

Owner tasks from YOUTH §28.2, needed by P5-10 at the latest: 2-Step Verification on the youth Gmail account; privacy text approval; pick the support contact (batch 3); archive the test data from the competitions spreadsheet (before batch 3).
