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

## 3e. Batch 4 (P5-7 + P5-8): what was built

Status: **implemented and verified on staging, 2026-10-30. Not on `main`, not in production.**

**P5-8 competitions runtime** (`worker/src/comp/`, migration `0021`)
- `POST /v1/comp/start`, `submit`, `result`, `me`: every attempt belongs to a signed-in account. No code login, no form, no guest row. The key never leaves the Worker before the policy allows it.
- Grading is one source: `score.gen.js` is generated from `apps-script/CompScore.gs` (`tools/build-worker-score.mjs`; a test fails when stale). The rest is ported from `CompPublic.gs` and `CompModel.gs`.
- Crediting (COMPETITIONS §20.1): automatic part at submit, manual part as graded, best attempt only, `sub:<id>:<n>` idempotent, void and regrade reverse through the same path.
- Visibility hold (§20.2): the ledger row is written at once and hidden from the member, the spendable balance included, until `released_ms`. The minute cron releases at `resultsAt`, on finalize, or at the end when nothing shows.
- Eligibility is stamped at submit with the range used (§9.1). A guest plays and earns nothing; ranking gives a badge and no place number.
- Email: one result per submission at release, completion, merged corrections, the age-out notice.
- Authoring stays on Apps Script until Phase 6 (owner's hybrid decision): `compRuntimePush_` sends each live definition at publish, close and finalize to `POST /v1/sync/comp-live`, signed, immutable per version.

**P5-7 store** (`worker/src/store/shop.js`)
- `POST /v1/shop/redeem`, `cancel`: the request and its charge are one batch, with stock, per-person and spendable balance decided inside the write. Guests browse and are refused on the server. Orders placed before aging out are honoured.
- Admin: prizes, requests (approve, fulfil, cancel + one refund), schedule. A season with open requests can't close. Prizes move once with `workerRuntimeSeed()`.
- Email: request receipt, approved, cancelled + refund.

**Pages**
- `competition/` and `points/` keep their screens. With accounts on they use `assets/js/comp/accounts.js`: same reply shapes, signed in, sign-in on `/account/` and straight back. With accounts off they stay exactly as today (one extra config read; its last answer is remembered).
- `/account/`: `#me/results`, `#me/orders`.
- Admin «حسابات الشباب»: «النتايج» and «المتجر». With accounts on, the old «المشاركين», «النقاط», «المتجر» tabs give way to it.

**Changed from the Apps Script build (on purpose or by limit)**
- By contract: credits are no longer visible before release; points no longer wait for the whole submission.
- **Not ported:** grading a group of identical answers at once (`apiCompGradeGroup`, the review queue). Answers are graded one submission at a time. It's a convenience, and belongs with the Phase 8 screen unless the owner wants it sooner.
- **The explanation picture** no longer waits for its file to be on the site (`compMediaReleased_`): the review shows what the definition names.

**Open before launch (P5-9, P5-10)**
- **The home page's store widget** reads `points.shop` from `content.json`, which Apps Script builds from its own schedule, and the automatic store and season pushes (§18.5) stay there until Phase 6. After the move, a schedule saved on the Worker doesn't reach them. Needs a decision at launch: keep both schedules aligned by hand, or send the Worker's into the build.
- `/v1/comp/me` reads a lot in one request; measure it against the Free plan's 10 ms CPU limit under load.

## 3f. Batch 4 results (2026-10-30)

| Check | Result |
| --- | --- |
| Worker unit tests, 20 new in `test/comp-runtime.test.mjs` | 382 / 382 |
| **End to end, real pages + real Worker code on SQLite** `tests/comp-accounts.e2e.mjs` | 2 / 2: signed out → `/account/` → back → answers → points → store; a guest locked |
| Admin e2e `tests/youth-admin.e2e.mjs` (2 new) | 6 / 6 |
| Existing competition e2e (code login, accounts off) `comp-public`, `comp-portal`, `comp-portal2` | Pass |
| Site unit tests | 771 pass; the same 3 known failures |
| Staging `node scripts/comp-check.mjs` (real cron + queue) | 39 / 39 |
| Staging `participants-check`, `member-check`, `account-check` (earlier batches again) | All passed |
| Production | Unchanged: Worker `4408fb3a`, no migration, nothing pushed |

Staging: migration `0021`, Worker `0635ae1b`; `accounts_mode = on`, `OTP_EMAIL = 0`, `MEMBER_EMAIL = 0` left on staging.

**Not verified (planned for P5-9):** the Apps Script side (`compRuntimePush_`, `workerRuntimeSeed`): staging has no Apps Script, so definitions were pushed by a signed script, and these functions have only loaded in the tests' fake; a real email; real Turnstile on the way back from `/account/`; the device matrix.

One test in `tests/points-widget.e2e.mjs` («placement», the home page's order of sections) fails. No file of the home page changed in this batch; comparing with the previous commit wasn't possible (the old checkout's test didn't load), so it is reported, not explained. **Explained in batch 5:** it fails the same way on the commit before Phase 5 (`afd64d1`), so it is not from this phase.

## 3g. Batch 5, P5-9: full tests (2026-10-30)

**Found and fixed by the load check** (`worker/scripts/comp-load.mjs`: 40 accounts at once, real-size definitions, CPU from the Worker's own traces):
- `POST /v1/comp/me` for a member with 30 competitions: **64 ms CPU and 3.8 s** → **9 ms and 0.33 s**. It parsed every question of every competition and made a read per submission. It now reads the metas in one query (migration `0022`), and builds no review for a list.

**Closed open items**
- The home widget (§3e): once accounts are on, the Worker's build replaces `points` with its own schedule and season (`runtimePoints`). The change shows at the next publish, like every home-page change. The §18.5 automatic pushes stay on Apps Script until Phase 6: **keep their dates the same as the store's** (ADMIN-GUIDE §١٣).
- One writer: Script Property `COMP_RUNTIME = worker` makes every public competition, «نقاطي» and store action on Apps Script answer `disabled`.
- The Apps Script side now runs in a test (`worker/test/comp-runtime-push.test.mjs`): real `.gs` code in the fake, its signed call through the real `verifySync` into the real Worker code, then an account plays and is graded with the pushed key; finalize; the seed.
- Privacy text shortened in `privacy/index.html` on the owner's request (2026-10-30), linked from the register form, admin guide §١٣ written.

**Load results on staging** (from Egypt, Worker + D1 in Eastern Europe)

| Route | Wall p50 / p95 | CPU p50 / p95 |
| --- | --- | --- |
| Burst of 40: `comp/start` | ≈ 1.3 s / 1.4 s | 7 / 24 ms |
| Burst of 40: `comp/submit` (20 questions) | ≈ 1.1 s / 1.2 s | 13 / 24 ms |
| `comp/me`, 30 competitions | 0.33 s / 0.40 s | 9 / 14 ms |
| Store race, 30 at once, stock 5 | ≈ 1.4 s | 6 / 14 ms |

No request failed: every outcome `ok`, stock exact. **Still over 10 ms at times:** `submit` sits a little above the Free plan's CPU limit and new isolates reach 28 ms. Cloudflare didn't refuse any here, but a limit that is enforced under sustained load wouldn't show in a burst this short. The first real competition must be watched (`wrangler tail`); the Workers Paid plan removes the question if it ever refuses.

## 3h. P5-10: the launch runbook

Each step needs the owner's explicit approval. Steps 1–2 change nothing anyone can see.

1. **Release the code, dormant.** Work branch → `main` (site, admin, docs), CI deploys the Worker; migrations `0018`–`0022`; `node scripts/account-secrets.mjs --production`. Check: `/v1/account/config` says `off`; bookings, publish and the panel as before; baseline hashes equal. Back: `wrangler rollback`; the schema additions stay unused.
2. **Apps Script deploy** (`compRuntimePush_`, `workerRuntimeSeed`; inert for visitors). Run `workerRuntimeSeed()` once from the editor. Check: `comp_live` and `store_items` hold the live competitions and prizes. Back: `clasp deploy -i <API id> -V <previous>`.
3. **Owner, before step 4:** 2-Step Verification on the youth Gmail; archive the test data from the competitions spreadsheet (YOUTH §7); approve the privacy text; pick the support contact (after step 4, in «الإعدادات»).
4. **Accounts on, in production, for owners only.** `accounts_mode = on`, `OTP_EMAIL = 1`. Visible at once: `/account/` works, `competition/` and `points/` ask for a sign-in, ranged events ask for an account. Owners test here: a real code to a real inbox, real Turnstile, one competition, one prize, one booking, the device matrix (YOUTH §25). `MEMBER_EMAIL = 1` once the codes arrive. Back: `accounts_mode = off`.
5. **One writer.** Script Property `COMP_RUNTIME = worker`. Back: delete it.
6. **The first real competition**, watched with `wrangler tail`. Close Phase 5 when it is clean.

**A real inbox before step 1 is possible** on staging: `OTP_EMAIL = 1` and one registration with an address the owner names (see §3i).

## 3i. Batch 5 results

| Check | Result |
| --- | --- |
| Worker tests | 386/386 (with the Apps Script → Worker test) |
| Site unit tests | 771 pass, 3 failures known from before Phase 5 (competition + trip sections, `content.js` competitions index, `admin/config.js` shapes) |
| Staging, accounts on | account, member, participants, comp, accounts, activity, platform, notify, content, content-saves, content-publish, book, claims: all pass |
| Staging, accounts off | age, book-ops: all pass (see below) |
| Browser, same test on `afd64d1` and now | no new failure from Phase 5 |
| Load | §3g |
| Production | Unchanged: Worker `4408fb3a`, no migration, nothing pushed |

Staging: migrations up to `0022`, Worker `1cedc03a`; `accounts_mode = on`, `OTP_EMAIL = 0`, `MEMBER_EMAIL = 0`, `CONTENT_DRAFTS = 0` left on staging.

**Found and fixed in these runs:** the browser review and the Worker's review differed once accounts were on, because `runtimePoints` reached only the Worker's build. `adminReviewInput` now sends the same points to the kit. `content-publish-check` caught it and passes.

**Why two checks run with accounts off:** `age-check` and `book-ops-check` make visitor bookings. With accounts on, an event with an age range refuses a visitor by design (`account_required`, YOUTH §18.1 #5), and `participants-check` covers that path. So they test the booking code as it runs until launch, and `age-check`'s visitor path is not a test of accounts-on behaviour.

**Browser failures, the same on `afd64d1` (not from Phase 5):** `browser.e2e` #1, 2, 3, 7, 8; seven admin media tests (media, 12 MP, small image, Drive failure, library, «من المكتبة», section banner); `points-widget` «placement». **Seen once, then passed on rerun:** B.U.G. intro, admin-app «names», admin «unsaved changes». **Not run to the end:** comp-admin 1–4 (cut by the time limit).

**Not verified, and stays so until the owner acts (§3h):** a real email in a real inbox; real Turnstile; the device matrix on real phones; the real Apps Script deploy (only the test's fake so far). **Not ported:** group grading stays on Apps Script. **Risk to watch:** `comp/submit` CPU slightly above 10 ms (§3g).

## 3j. Runbook step 1: production release record (2026-10-30)

Owner approved step 1. Dormant: `accounts_mode = off`, `OTP_EMAIL = 0`, `MEMBER_EMAIL = 0`.

| Item | Value |
| --- | --- |
| `main` | `211b5d4` → `50236b8` (cherry-picks of the batches, plus the test fix below) |
| Worker | `4408fb3a` → `bcfaad19` (CI). Rollback target: `4408fb3a` |
| Migrations | `0018`–`0022` applied |
| Secrets | `PW_PEPPER`, `PW_KEY`, `OTP_PEPPER` set |
| D1 bookmark before the migrations | `00000179-00000648-00005114-5f40b6c11b31b1743aa5ad8cbc6af181` |
| Apps Script | Not deployed (step 2) |

**Checked:** baseline equal before and after: bookings 9, payments 4, proofs 11, pay_dest 1, event_cfg 2, admins 3, grants 135, 100 draft rows in 16 kinds, 28 revisions, 65 media files, and the hashes of these and of the live files. `/v1/account/config` says `off`; `/v1/comp/me` and `/v1/account/signin` answer `accounts_off`; smoke passes. In a browser: the home page, `/account/` («تسجيل الدخول متوقف مؤقتًا»), `competition/`, `points/` (the old code login, as before) and the `/admin/` sign-in page load, with no site errors.

**One live value changed, as batch 2 planned:** `MAIL_RESERVE_OTP` 50 → 100, `MAIL_ADMIN_BUDGET` 150 → 120. To restore the old values, see §4.

**Found during the release:** `worker/test/publish.test.mjs` read `events/test/event.json` from the repository. The mirror withdrew that event on `main` on 2026-10-28, so the test failed there and would have stopped the CI deploy. CI hadn't seen it because mirror commits don't touch `worker/`. The test now has its own fixture.

**Not checked:** the signed-in panel, a real save, review and publish on production, because they need the owner's Google account.

## 3k. Runbook step 2: Apps Script record (2026-10-30)

Owner approved step 2 and ran `workerRuntimeSeed()` from the editor.

| Item | Value |
| --- | --- |
| API deployment | `AKfycbxJj…Km1` @58 → **@59**; recovery admin still @14 |
| Rollback | `clasp deploy -i <API id> -V 58` |
| `comp_live` | 1 row: `test` (`cmp-9227de8c`, version `af9742f9476a7f6e`, closed, finalized). Same id and version as `content.json`, its only competition |
| `comp_versions` | 1 row, with its meta |
| `store_items` | 1 row: «محفظة», cost 30, stock 1, active. Not compared with the sheet by me: the owner confirms |

**Checked:** `warm` answers `{"ok":true}`; `compStart` still answers from Apps Script, not `disabled`; `accounts_mode` still `off`; no 5xx in `api_log` from this step or from the owner's publish. Bookings, payments, proofs, pay_dest, event_cfg and grants equal the baseline.

**Owner's production test on Worker `bcfaad19`, read from D1:** a save at 14:33 Cairo («المسرح الأسود2») and a publish at 14:35 (`pub-f8948ee61ccb`, 4 files), mirrored to `main` as `57d12e2`. This covers the §3j item left open. The admins hash also changed in the same window; its count stays 3. The cause wasn't read, and the sign-in is the likely one.

**Before step 4:** the owner withdrew `test` the same day (`pub-0d2cc47b7c93`), and `comp_live` is empty. Running the seed again wouldn't have removed it, because the seed only adds. «محفظة» is test data too, and stays until Phase 7c with the rest of the test data (`docs/PHASE5-CLEANUP-PLAN.md`). `auto` with no dates means an open store, so on the owner's decision `SHOP_MODE = closed` on production (2026-10-30). The owner opens the store when real prizes exist.

**Also seen, not from this release:** `api_log` has one 500 on `/v1/sync/content-notify` on 2026-10-29 07:13 UTC, on Worker `4408fb3a`. Not investigated. The two 503 `accounts_off` on 2026-10-30 are my own checks.

## 3l. Runbook steps 3–4 record (2026-10-30)

**Step 3, as the owner reported:** 2-Step Verification on, OAuth consent screen In production, test address named. The owner takes the Gmail recovery details and the backup key on themselves. The test data cleanup is deferred to Phase 7c. Privacy text live on `main` `8d97849`.

**Step 4, owner approved:** `accounts_mode = on`, `OTP_EMAIL = 1`. `MEMBER_EMAIL` stays `0` until the codes arrive. `SHOP_MODE = closed`, and `COMP_RUNTIME` isn't set (step 5).

| Item | Value |
| --- | --- |
| D1 bookmark before the switch | `0000017b-000001bc-00005114-dc8b324b4a5c76de0ab75ba145673bc3` |
| Worker | `bcfaad19`, unchanged |
| Back | `accounts_mode = off` |

**Checked:** `/v1/account/config` says `on`, `/v1/comp/me` answers `session`, smoke passes. In a browser: `/account/` shows the sign-in form with the Turnstile script loaded, `points/` goes to `/account/`, and the home page and «المسرح الأسود» load, with no site errors.

**Not checked, left to the owner's tests:** a real code email, Turnstile passing with a real token, registration and sign-in, one booking, the device matrix. No form was submitted. With no competition live, playing one needs a new published test competition. With the store closed, a prize request needs the store opened.

**Not limited to owners:** the runbook says "for owners only", but nothing enforces it. Any visitor who reaches `/account/` or `points/` can register during this test.

## 3m. Step 4: owner's first tests and two small changes (2026-10-31)

**Owner's tests on production, as reported:** registration, email confirmation, sign-in and sign-out, forgot password, Turnstile, and the account in the admin and on the member page all work. The logs agree: 1 account, 2 code emails sent, no 5xx on account routes.

**`MEMBER_EMAIL = 1`:** on, since the codes arrive. No member email other than the codes has gone out yet, so delivery is still unproven.

**Released:** `main` `8e713d7`, Worker `4e725bb7` (rollback `bcfaad19`).
- «إنشاء حساب جديد» on the first screen; the register form asks for the email when it has none.
- The support link names the person. `/v1/account/config` has a default name, and the admin's account settings edit the name and number or fill them from a contact. The Apps Script copy of the admin wasn't redeployed, because it's only the recovery path.

**Password viewing, reviewed, nothing changed:** every password today is generated (register, forgot, admin reset), and no route lets a member choose one. The Primary Admin's view reads `pw_enc`, is logged, closes after 60 seconds, has no rate limit, and doesn't tell the member. If members may choose passwords later, they may reuse them on other services, so that choice needs its own decision first.

**Current password in the person's facts (owner's request, 2026-10-31):** for the Primary Admin only, the sheet shows it with no click, through the existing `view-password` call. The sheet's own reply never carries it; the server refuses anyone else; each view writes `participant_audit` and `activity`. It leaves the page after 5 minutes, and «إظهار تاني» is another logged view. «توليد باسورد جديد» stays separate. Storage is unchanged. Only `menazakmena@gmail.com` is Primary, so «حساب الأسرة» doesn't see it.

**Remaining before step 5:** a real member email; the support name edited in the admin; one booking; one test competition; the device matrix. A prize request waits for the store to open.

## 3n. Runbook step 5: one writer (2026-10-31)

Owner approved and set the Script Property `COMP_RUNTIME = worker` in the editor.

**Checked:** `compStart`, `compSubmit`, `compResult`, `compCode`, `portalMe` and `shopRedeem` on Apps Script answer `disabled`; `warm` still answers. The Worker's `/v1/comp/me` answers `session`; smoke passes; `points/` goes to `/account/`; no new 5xx. `comp-accounts` 3/3 and `comp-runtime-push` 3/3 before the switch.

**Back:** delete the property. From now on `accounts_mode = off` alone only closes competitions, points and the store; a full way back needs both.

**Phase 5 stays open.** Step 6 closes it: a competition watched with `wrangler tail`. No submission has reached the Worker on production yet, and no member email other than codes has gone out. The owner's accounts improvements batch comes after the close, before Phase 6.

## 3o. Competitions' admin on the Worker (2026-10-31)

**Why:** during step 6 the owner saved «مسابقة نقاط», but it never showed among the changes ready to publish. Activity reached D1, while the competitions' signature and view stayed old, so the Worker's review kept reusing its last part. The monitoring later showed why: `POST /v1/sync/comp-sig` allows 1024 bytes, and the view outgrew that, so every push got a 413. Each save also waited for Apps Script and its Sheets. The owner ordered the whole admin moved.

**Moved to the Worker + D1:** create, edit, questions, bulk import, duplicate, archive, delete, close, finalize, module switches, trial grade, preview, review, publish, and the results screens (list, submission, review queue, ranking, export, marks, void, regrade).

**How:** `Competitions` and `Questions` are `draft_rows` kinds (`COMP_KINDS`), outside the panel's drafts read, the content import and the export, because they hold the answers. The admin's calls run the same `CompAdmin.gs`, `CompModel.gs`, `CompPublish.gs`, `CompScore.gs` and `CompCrypto.gs`, bundled in `gs.gen.js`. A publish writes the revisions, `liveVersion`, `comp_versions` and `comp_live` in one D1 batch, so there is no partial publish. Results read D1's `submissions` through a tab in memory; marks go through `comp/admin.js`. The browser's review kit gets no competitions, so the panel uses the Worker's review.

**The move:** `COMP_IMPORT = 'dry'` reports Apps Script's rows and changes nothing. `COMP_IMPORT = 'apply'` freezes Apps Script (Script Property `COMP_DRAFTS = worker`) and copies the rows, linked cards, module switches and the version key in one batch with `settings.COMP_DRAFTS = worker`. The outcome is in `COMP_IMPORT_REPORT`. The version key travels too, but Apps Script hashed Arabic text differently, so on production «تجربة تشغيل» (byte-identical definition) gets a new version at its next publish, once. Earlier submissions keep their version.

**Back:** delete the Script Property, then set `settings.COMP_DRAFTS` to empty. The Sheets hold the state at the move: anything saved on the Worker after it stays only in `draft_rows`, so it has to be copied back by hand. `comp_live` and submissions are untouched either way.

**Still on Apps Script:** the old participants, wallet, store and seasons screens, and push schedules. They read a frozen copy of the competitions' titles. The module switches are sent there after a change. Moving them is separate work.

## 3p. Phase 5 closed (2026-10-31)

**Closed by the owner's order after the final check below.** The next work is the owner's accounts improvements batch (5 steps, a desktop and mobile preview before any publish). It and Phase 6 each wait for the owner's approval.

**Production:** `main` `9724cd5` plus mirror commits, Worker `be8cc66f`, Apps Script @60. `accounts_mode = on`, `OTP_EMAIL = 1`, `MEMBER_EMAIL = 1`, `SHOP_MODE = closed`, `CONTENT_DRAFTS = 1`, `COMP_DRAFTS = worker`, `COMP_RUNTIME = worker`.

**Owner's live tests, as reported, each matched by the logs:**
- A competition with a result email: `s-47b8d9bc6544`.
- A competition with points: `s-503569b948a0`, 100/100, one ledger row of 100, shown in «نقاطي» and in the admin's «المشاركات».
- The support name changed and restored.
- A booking with an account: `bkg-177e022fb41b`, in the account and the admin, confirmation email received.

**Test items withdrawn 2026-10-31:** «تجربة تشغيل», «مسابقة نقاط», «مسابقة نقاط (نسخة)» and «تجربة حجز» are archived and published (`0d2cc47b7c93`, mirrored). `comp_live` is empty, content.json names none of them, their public files say `withdrawn`, and booking state answers `not_found`. Links people have still open and say so. Kept: 2 submissions, the 100 points, all bookings. Their removal stays with the cleanup in Phase 7c, on a fresh inventory.

**Final check:**
- Site, account, points and admin pages, and the Worker's health and config routes, answer 200.
- 620 monitored requests from the move through the booking test: no failed outcome, no exception, no 5xx. All 4xx: 18 `comp-sig` 413s (below), 3 404s, 2 401s, 1 400.
- Member outbox: every due email sent, none waiting. Gmail health is ok.
- The two 5xx rows in the last 24 hours are `accounts_off` from before step 4, by design.

**Follow-ups:**
1. **iPhone:** not tested.
2. **Android:** the owner's close order names only iPhone; no Android result was reported in the runbook record.
3. **Performance at the first real competition:** watch `wrangler tail`. Peak CPU so far: 55 ms on an admin call (21 of 92 above 10 ms), 14 ms on `book/submit`, 13 ms on `comp/submit`, with no rejected request. Test traffic only, so the load is unproven. If requests start failing on CPU, the fix is the paid plan, which is the owner's decision.
4. **`comp-sig` 413:** fixed 2026-10-31, the limit is now 512 KB.
5. **Screens still on Apps Script:** old participants, wallet, store and seasons screens, and push schedules (§3o).
6. **Cleanup in Phase 7c** also covers today's test records and their still-enabled cards. Each publish warns about those cards until then.
7. **Uninvestigated:** one old 500 on `/v1/sync/content-notify`, 2026-10-29.

## 3q. `comp-sig` proven, Phase 5 complete (2026-10-31)

**What triggers it:** `doPost` in `Api.gs` calls `compSigPush_` after an admin call that reaches Apps Script, not on a timer. It sends only when the signature differs from the one last accepted (kept 6 hours in the script cache). It signs with `WORKER_SYNC_SECRET` (`v1=` HMAC over `ts.body`). The Worker checks the signature, refuses an old timestamp, then writes `COMP_SIG`, the view and `SYNC_TS_comp-sig` in one batch.

**Evidence on production (read from D1, no test data, nothing changed):**
- Apps Script signed at 07:55:42.742 UTC, after Worker `ade89df5` went live. The Worker stored it 559 ms later. That timestamp can only be written after the signature check, and only Apps Script and the Worker hold the secret.
- `COMP_SIG`, `SYNC_TS_comp-sig` and the view carry the same stored time, so they landed in one batch. The signature moved from `9ec9a0cc…` to `2394f266…`.
- Content: the view went from 2 competitions and 11 questions to 4 and 13. Ids, slugs, titles, pictures and question media equal D1's drafts row by row. It holds no answers.
- Store items: `i-9cc596e4` «محفظة», active, no picture, the same as `store_items`.

**Limit of this proof:** the one prize has no picture, so no picture value has crossed on production. Adding one would change real data. `comp-drafts.test.mjs` covers a view with pictures. The monitoring did not capture this push's HTTP line; the proof is the D1 rows above.

**Requirements (P5-1 to P5-10), against the records in §3 to §3p:** accounts, sign-in, recovery, profile, member email, participants in the admin, booking with an account, points, competitions runtime and the runbook steps are done and tested live, except as listed below.

**Tests on the final code:**
- Worker: 394/394.
- Site units: 771 pass, the same 3 failures known from before Phase 5.
- Browser, all pass: comp-admin 1–4, comp-accounts, comp-live, comp-portal 1–2, comp-public, content-worker, content-source, youth-admin, book-public.
- Browser, `book-admin`: 10 pass, 2 fail (#1 and #7). Both fail the same way on `e9d212b`, the commit before the move, so the move did not cause them. Not investigated beyond that.

**Runbook points that ended differently, none blocking:**
- Step 6 says the first real competition closes the phase. The owner closed on test competitions instead, and watching the first real one is a follow-up.
- A prize request stays untested until the store opens.
- Test data stays until Phase 7c, by the owner's decision.

**Status: Phase 5 complete. No critical issue open.** The follow-ups in §3p stand, except `comp-sig`, now proven. One added: the old store, wallet and seasons screens still write to the Sheets while the accounts screens write to D1, so edits belong in the accounts screens. Test a prize request before opening the store.

## 4. Rollback (batches 1–5)

- Batch 4 extra: `accounts_mode = off` returns `competition/` and `points/` to Apps Script at once and refuses every `/v1/comp/*`, `/v1/shop/*` route. Worker rows stay. After launch that fallback serves only the old code login, so it is a stop, not a way back.

- Batch 3 extra: everything stays behind `accounts_mode`. A booking already linked keeps working if it goes off, and `POST /v1/admin/book/bookings/:id/link { participantId: null }` unlinks one. Schema additions are unused while off.

- Batch 2 extra: `MEMBER_EMAIL = 0` stops every member email except codes (tested). Rows wait until they expire. The budget rule change rolls back with `wrangler rollback`; the migration's added columns and settings stay harmless. To restore the old defaults: `MAIL_RESERVE_OTP = 50`, `MAIL_ADMIN_BUDGET = 150`.

- Staging: `UPDATE settings SET value = 'off' WHERE key = 'accounts_mode'` (tested by the check script: every route answers `accounts_off`) or `wrangler rollback --env staging`.
- Production (when released): the schema is additive and unused while `accounts_mode = off`; `wrangler rollback` to the previous version for a bad deploy. Migrations are forward-only (YOUTH §24).
- No existing table, booking, content or admin flow is changed by this batch.

## 5. Before production (needs the owner)

Production release of batches 1–4 is a separate approval: `main`, migrations `0018`–`0022`, the Apps Script deploy (`compRuntimePush_`), the deploy, and `node scripts/account-secrets.mjs --production`. Accounts stay dormant with `accounts_mode = off`; the new budget rule applies to admin mail at once (§3a).

Owner tasks from YOUTH §28.2, needed by P5-10 at the latest: 2-Step Verification on the youth Gmail account; privacy text approval; pick the support contact (batch 3); archive the test data from the competitions spreadsheet (before batch 3).
