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

## 3a. Batch 2 (P5-3 + P5-4): what was built

Status: **implemented and verified on staging, 2026-10-30. Not on `main`, not in production.**

**P5-4 member email**
- `worker/migrations/0019_member_email.sql`: counters per class (`admin`, `member_tx`, `member_bulk`), `MAIL_RESERVE_MEMBER` 100, `MAIL_BULK_PER_HOUR` 30; `MAIL_RESERVE_OTP` 50 → 100 and `MAIL_ADMIN_BUDGET` 150 → 120 only where the old default is still there.
- `worker/src/notify/email.js`: the owner's D4 rule replaces the hard caps. A class may send while the total stays under the target minus the unused reservations above it; OTP looks only at the target.
- `worker/src/notify/member.js`: kinds, `memberEmailStmt` (the row goes in the state change's batch), the cron's lease by priority, re-check at send (`superseded`), verified-only recipient, preferences, 10 receipts a day, drip, expiry, retries, one dead-mail alert an hour. Queue job `member.email`.
- Templates: `account_created`, `password_reset_support`; security notices open `#me/security` (a creation notice only the site, since it may reach a stranger); Tier 2–3 carry the «إعدادات الإشعارات» link.
- Live trigger: `acct.dev` (a device this account never used; opt-in).

**P5-3 profile**
- Routes `GET /v1/account/security`, `GET` + `POST /v1/account/prefs`.
- `/account/`: profile (read-only; corrections go through support), `#me/notifications` «إشعاراتي», `#me/security` (devices, «اخرج من كل الأجهزة»). A link's destination survives sign-in once, for 30 minutes, in this tab, own routes only (EMAIL-DEEP-LINKS §3).

**Monitoring:** «حالة النظام» shows the three switches, member mail in the last 24 hours, and the sign-in form's daily count, no-account answers and wide sources. One important admin alert at half of the daily form budget. «إعدادات الإشعارات» gains the member reservation.

**Boundaries inside batch 2**
- The Tier 0 notices `acct.new`, `acct.pw`, `acct.rec1` are built and tested, but their triggers are admin actions, so they fire from P5-5. `acct.email` is not built yet: it needs the correction flow and a way to reach the old address.
- Manual resend (MEMBER §9) needs the person sheet: P5-5. Age-out email: P5-8, with the other 5B mail (MEMBER §10).
- There is no admin switch for `accounts_mode`, `OTP_EMAIL`, `MEMBER_EMAIL`: they are shown, and changed at launch by SQL on the owner's approval (P5-10).

**Takes effect for admin mail too, on release.** The D4 rule also governs admin notifications: an important one was held from a total of 100 and is now held from 150 while reservations are unused. «إعدادات الإشعارات» now refuses reservations that add up to more than the target. Both come from the signed-off plan (MEMBER §5).

## 3b. Batch 2 results (2026-10-30)

| Check | Result |
| --- | --- |
| Worker unit tests, 22 new in `test/member-email.test.mjs` | 330 / 330 |
| Site unit tests | 771 pass; the same 3 known failures |
| Admin e2e `tests/accounts-admin.e2e.mjs` (includes the new status part) | 8 / 8 |
| Staging `node scripts/member-check.mjs` (real cron + queue) | 20 / 20 |
| Staging `node scripts/account-check.mjs` (batch 1 again) | All passed |
| Staging page in a browser | Passed: link kept through registration, «إشعاراتي» saved and reloaded, devices, logout everywhere, a foreign hash ignored, no overflow |
| Production | Unchanged: Worker `4408fb3a`, no migration, nothing pushed |

Staging: migration `0019`, Worker `cafe2c46`; `accounts_mode = on`, `OTP_EMAIL = 0`, `MEMBER_EMAIL = 0` left on staging.

**Not verified (planned for P5-9):** a real member email through real Gmail to a real inbox (staging used the test inbox; Gmail is covered by unit tests with a fake). The budget's full-window behaviour is unit-tested only.

## 3c. Batch 3 (P5-5 + P5-6 + 5A-4): what was built

Status: **implemented and verified on staging, 2026-10-30. Not on `main`, not in production.**

**P5-5 participants** (`worker/src/account/admin.js`, `/v1/admin/participants/*`, grants in `lib/perms.js`)
- List and search (name, email, any phone format), «حسابات جديدة» with its flags, Excel export (no credential).
- Create without OTP: email typed twice, a confirmation method, verified by admin, a creation notice, the password once to the creator.
- Corrections with a reason and old → new in the audit: profile, email (7-day rule, Primary override, both addresses told), phone, DOB, eligibility override. Block (edit or higher), unblock (manage), end all sessions.
- Viewing and resetting are separate. View: Primary only, unlimited, changes nothing, logged. Reset: new password once, sessions end, a notice, never emailed; support reset needs a check method.
- Critical notifications: email, phone, DOB, reset, block, first recovery on an admin-entered email. That first recovery also sends `acct.rec1` and marks the address proven.
- Manual resend of one Tier 1 email once a day. Settings: the Admin age range and the Technical Support contact, which now reaches the page and every member email.
- Admin screen `apps-script/AdminAccounts.html` «حسابات الشباب», existing components only. **The tab appears only when `accounts_mode = on`**, so the panel doesn't change before launch.

**P5-6 points** (`worker/src/points/ledger.js`, migration `0020`)
- Append-only ledger, balance from the active season, never below zero (decided inside the write), idempotent keys, a note the member sees only when marked, `pts.deduct` email.
- Frozen is derived; freezing writes nothing. Transfer between duplicates: both rows or neither, audited.
- Seasons: planned / active / closed, close with a preview key (moved numbers refuse), totals frozen, frozen balances shown apart, the next season starts at 0.
- Member view `GET /v1/account/points` and `/account/#me/points`.

**5A-4 bookings and accounts** (`worker/src/book/account.js`, §18.1)
- Signed-in booker: the DOB comes from the account only, a client one is ignored; the booking stores `participant_id`, `age_source = 'account'` and its snapshot. A later correction changes future bookings only; the admin booking shows a warning.
- `requireAccount`: on by default for an event with a booker range, off otherwise, the event's choice wins. **Only while accounts are on: with `accounts_mode = off` bookings behave exactly as today.**
- Linking an older booking: its status link or an admin, never by phone; different dates of birth raise a flag.
- `/account/#me/bookings[/REF]`, «اربطه بحسابي» on the status page, «سجّل دخولك واحجز» and back on the event page, the form prefilled with no DOB field.
- Email for linked bookings only, in the same batch as the change: received, confirmed, rejected, cancelled, event cancelled, payment recorded / voided, due changed, payment request received / rejected, deadline reminder (per-event switch), «بلّغ الحاجزين».

**Boundaries**
- Crediting from competitions and spending in the store: P5-7, P5-8, on `ledgerStmt`. The rule «a season can't close with open store requests» arrives with the store.
- `competition/` and `points/` still use today's Apps Script code login, and the old «المشاركين» / «النقاط» screens stay until they move in batch 4.
- Reservations and switches stay as batch 2. No test data is migrated (YOUTH §7).

## 3d. Batch 3 results (2026-10-30)

| Check | Result |
| --- | --- |
| Worker unit tests, 32 new in `test/participants.test.mjs` | 362 / 362 |
| Site unit tests | 771 pass; the same 3 known failures |
| Admin e2e `tests/youth-admin.e2e.mjs` (new) and `tests/accounts-admin.e2e.mjs` | 4 / 4 and 8 / 8 |
| Public booking e2e `tests/book-public.e2e.mjs` (1 new) | 18 / 18 |
| Staging `node scripts/participants-check.mjs` (real cron + queue) | 56 / 56 |
| Staging `member-check.mjs`, `account-check.mjs` (earlier batches again) | All passed |
| Staging account page in a browser (`#me/points`, `#me/bookings`, an unknown ref) | Passed |
| Production | Unchanged: Worker `4408fb3a`, no migration, nothing pushed |

Staging: migration `0020`, Worker `264fe9ef`; `accounts_mode = on`, `OTP_EMAIL = 0`, `MEMBER_EMAIL = 0` left on staging.

**Not verified (planned for P5-9):** a real email to a real inbox; a signed-in booking on a real event page against staging (the API is checked live, the page against a mock); the deadline reminder through the real daily cron (unit-tested with a clock); the admin screen against the live Worker with a real Google sign-in (its e2e uses a fake of the routes).

**Before launch, owner:** archive the test data from the competitions spreadsheet (YOUTH §7), as it is still open.

## 4. Rollback (batches 1–3)

- Batch 3 extra: everything stays behind `accounts_mode`. A booking already linked keeps working if it goes off, and `POST /v1/admin/book/bookings/:id/link { participantId: null }` unlinks one. Schema additions are unused while off.

- Batch 2 extra: `MEMBER_EMAIL = 0` stops every member email except codes (tested). Rows wait until they expire. The budget rule change rolls back with `wrangler rollback`; the migration's added columns and settings stay harmless. To restore the old defaults: `MAIL_RESERVE_OTP = 50`, `MAIL_ADMIN_BUDGET = 150`.

- Staging: `UPDATE settings SET value = 'off' WHERE key = 'accounts_mode'` (tested by the check script: every route answers `accounts_off`) or `wrangler rollback --env staging`.
- Production (when released): the schema is additive and unused while `accounts_mode = off`; `wrangler rollback` to the previous version for a bad deploy. Migrations are forward-only (YOUTH §24).
- No existing table, booking, content or admin flow is changed by this batch.

## 5. Before production (needs the owner)

Production release of batches 1–3 is a separate approval: `main`, migrations `0018`–`0020`, the deploy, and `node scripts/account-secrets.mjs --production`. Accounts stay dormant with `accounts_mode = off`; the new budget rule applies to admin mail at once (§3a).

Owner tasks from YOUTH §28.2, needed by P5-10 at the latest: 2-Step Verification on the youth Gmail account; privacy text approval; pick the support contact (batch 3); archive the test data from the competitions spreadsheet (before batch 3).
