# Accounts improvements batch

The owner's batch before Phase 6. Each step ships on its own; Phase 6 and the admin redesign (Phase 8) stay closed.

1. The account page and the optional photo (below).
2. The account icon in the header, one sign-in across services, returning to the original page.
3. OTP emails and copying the code, faster booking, result, points and store emails.
4. Cleaning the old competitions (codes, unused options).
5. Performance, final tests, closing the batch.

## Step 1: the account page

Direction «العتبة», approved from the preview on 2026-10-31.

**The first page** answers «is anything needed from me?» (`attention` in `assets/js/account/model.js`: two items at most, the money first, nothing when nothing is needed), then a summary band, then rows that state each section's condition. A computer keeps the sections in a rail. A new member sees first steps instead of zeros.

**Routes:** every route an email links to is unchanged. New: `#me/profile`, `#me/support`.

**Sessions:** a valid session opens the account directly. «تكمّل بالحساب ده؟» appears only once the session has ended. With a session and no network the page offers a retry and never asks for a password.

**Files:** `assets/js/account/app.js` (sign-in, registration, recovery), `home.js` (signed-in pages), `parts.js` (drawn parts), `motion.js`, `photo.js` (lazy), `assets/css/account.css`.

### The photo

- Optional. The member adds, changes or deletes it. `participants.view` sees it in «حسابات الشباب», `participants.edit` removes it with a required reason (`participant_audit` `avatar.remove`, an `important` activity row with no personal data).
- The page redraws it at 256 × 256 on a canvas, so it leaves the phone small and without location or camera data.
- `worker/src/account/avatar.js` checks it again: a session, 20 changes an hour, 64 KB, JPEG or WebP by its first bytes (no SVG, no HTML), square, 64 to 512 px.
- Bytes live in the private `PROOFS` bucket under `avatars/` with a random name; `participants.avatar_key` and `avatar_version` hold the reference (migration 0023). The proofs' sweep only touches `proofs/`; `sweepAvatars` removes objects no account names after a day.
- Served with a fixed type, `nosniff`, a sandbox CSP and `private` caching; a shared-device session gets `no-store`. The page shows it as `blob:`, which its CSP already allowed.

### API

- `GET /v1/account/summary`: the first page in one call, so opening it no longer needs `/v1/comp/me`. Answers are kept a minute in the page.
- `GET`, `POST /v1/account/avatar`, `POST /v1/account/avatar/delete`.
- `GET /v1/admin/participants/:id/avatar`, `POST /v1/admin/participants/:id/avatar/delete`.
- `/v1/account/bookings` adds `slug` and `statusToken`, for «ادفع الباقي» on the booking's own page.
- `/v1/account/points` adds each row's `title` and the store's state.

### Fixed along the way

- Competition points showed with no label: `KIND_WORDS` lacked `competition` and `correction`. Same words added to the admin's ledger.
- A booking had no way to pay from the account.

### Motion and sound

Motion: `DESIGN.md`. Only transform, opacity and filter. Reduced motion: nothing moves. A weak phone: no blur or stagger.

Sound: the site's own switch and synthesised sounds (`sound.js`), adding `enter`, `leave`, `page` and `nope`. Nothing before the first tap; the arrival on page load is silent.

### Tests

- `worker/test/account-avatar.test.mjs`
- `tests/account-page.e2e.mjs` (real page and CSP, real Worker code on SQLite)
- `tests/youth-admin.e2e.mjs` (the photo in the admin)
- `worker/scripts/account-page-check.mjs` (live on staging, real R2 and D1)

### Release (2026-10-31)

On staging first: Worker `4028c699`, `account-page-check` and `account-check` passed against real R2 and D1. Then production, the Worker before the page, so the page never called a route that wasn't there: Worker `8cec81b7` from `96a979b` (CI: staging, smoke, migration 0023, production, smoke), page and admin `32e3fb8`.

After the release: smoke passes; `tools/account-prod-check.mjs` passes (the new page on the real site at phone and computer widths, no script or CSP errors, silent until a tap, the new routes closed without a session).

**Not checked by these tests:** the signed-in pages on production (no test account was made there), a real iPhone and Android, real uploads from a phone's camera or HEIC files, how the sounds actually sound, and the admin's photo screen on production. In the unit run, `a competition and a trip…` and `admin/config.js` fail on `60d0200` as well, so they predate this step.

### Back (Step 1)

Page and admin: revert `32e3fb8` on `main`. Worker: `npx wrangler rollback ade89df5` (the version before this step); revert the page first, because it needs the new routes. Migration 0023 only adds two columns and can stay. Photos already uploaded stay in R2 under `avatars/`.

## Step 2: the account icon and one way back

**The icon** (changed since this section's release, see «The Step 2 fix» below) is in the top bar of the home page, the service pages, the events, the competitions and «نقاطي» (`assets/js/account/link.js`). Not on `/account/` itself, not in the admin's preview frame, and not during a competition's running timer. Signed out it shows a person and says «سجّل دخولك». Signed in it shows the member's photo or first letter in a small arch.

**No request on public pages:** it draws from what the device remembers (`FACE_KEY`, beside the session and cleared with it; in the tab on a shared device). If the session ended elsewhere the icon still looks signed in until it is pressed, then `/account/` asks.

**One way back:** a service's sign-in goes through `goSignIn` in `link.js`. After signing in the member returns to the same page, with its query and hash. `cleanReturn` allows this site's own public pages only, never `/admin/`, another host or a script. Signed in, the icon opens the account, and «ارجع للموقع» returns to the page they came from.

**A booking's page**, signed out, offers «سجّل دخولك عشان تربطه بحسابك», then returns to that booking to link it.

**Tests:** `tests/account-badge.e2e.mjs`, `tools/account-badge-staging.mjs`. No Worker change.

### Release (2026-10-31)

On staging first: `tools/account-badge-staging.mjs` passed. Production: `main` `9c8bb63`, the site only; Worker stays `8cec81b7`.

After the release: `tools/account-badge-prod-check.mjs` and `tools/account-prod-check.mjs` pass on the real site signed out (the home page and the Black Theatre at 320, 390 and 1280: the icon fits, no account request, no script errors, the sign-in opens and keeps the page to return to).

**Not checked by these tests:** signing in and returning on production (no test account was made there), a real iPhone and Android, the tap sound by ear, and the icon on published event and competition pages on production, since none is published now.

**Back:** revert `9c8bb63` on `main`.

## The Step 2 fix

Approved from a prototype on 2026-10-31 (`spike/account-preview/step2b/`, not in the site).

**The icon is the door.** The round button is gone. The control is a 40 × 44 door with one gold line, and the photo or first letter fills it, centred. It still presses as 44 × 44.

**Pressing the icon opens the account, signed in or not.** Before, signing in from the icon returned to the page, so the member pressed it again. `RETURN_KEY` is now set only by `goSignIn`, when a service asked for the sign-in; the icon clears any old value and sets `FROM_KEY` for «ارجع للموقع».

**First-time walkthrough** (`assets/js/account/onboard.js`, loaded only when it shows): six cards drawn from the page's own parts. Chosen over stills and video for speed, data use and easy editing; its words are plain text in that file.

- Once per account, on any device: `participants.onboarded_at` (migration 0024), set by `POST /v1/account/onboarded` when it closes, by finishing, skipping or Esc. Members who already had an account see it once too.
- On the account's first page only, so signing in to finish a competition or a booking isn't interrupted.
- Reopens from «إزاي تستخدم حسابك» in the support page, which marks nothing.
- A guest reads that they take part without points. The sample cards say «مثال», since a new member has no such data.

### Release (2026-10-31)

On staging first: Worker `69aa55fa`, `account-page-check` and `account-badge-staging` passed. Then production, the Worker before the page: Worker `2401d969` from `2d8c719` (CI, migration 0024), page `486a4ca`.

After the release: smoke passes; `tools/account-badge-prod-check.mjs` and `tools/account-prod-check.mjs` pass on the real site signed out; `POST /v1/account/onboarded` answers 401 without a session.

**Not checked by these tests:** signing in, the walkthrough and the door with a photo on production (no test account was made there), a real iPhone and Android, and how it feels by hand.

**Back:** revert `486a4ca` on `main` first, then `npx wrangler rollback 8cec81b7`. Migration 0024 only adds a column and can stay.

## Step 3: emails

The owner kept the old blue design with five edits only, and the sending fix after the measurements.

**Design** (`worker/src/notify/templates.js`): the logo on the right beside the names; the code as one run of six digits with no cells; the white card the full width of the mail, so its corners meet the header and it reaches the footer; a dark version for apps that honour `prefers-color-scheme` (the header, code and footer keep their blue, the white parts go dark); the words `Verification code` beside the code, also in the plain text. No copy button: mail apps drop scripts, and a link would carry the code. Whether Gmail recognises the code is Google's unpublished rule, so that part is best effort.

**Sending:**
- `res.result`, `res.done` and `res.points` are `member_tx`. As `member_bulk` they got only the 30 a day the reservations left. The 400 budget and the OTP and critical reservations did not change, and results don't count toward the ten daily receipts. `acct.age` stays gradual.
- `memberKick` (`notify/tick.js`) runs after the reply on routes that can write a member's email. One or two rows are sent directly; more go through the queue. The queue alone once held a leased row for 57 s, which is why the common case skips it. The cron stays as the safety net, now up to three batches a minute.
- The lease is one `UPDATE … RETURNING`, and `memberSend` claims each row with one `UPDATE` to `sending`, so two paths or a repeated job can't send a row twice. A row stuck in `sending` goes back in line when its 10 minute lease ends. A crash after Gmail accepts and before the row is saved can still send twice, rarely.

### Measured on Staging (2026-10-31)

| Test | Before | After |
|---|---|---|
| One real email, saved to accepted by Gmail (5 runs) | waited 42–56 s before sending | 0.9–1.2 s |
| One row, test inbox (15 runs) | median 51 s | 0.3–0.4 s |
| One real OTP (1 run) | path unchanged | 0.9 s |
| 5 real emails at the same moment | not measured | 6.6–13.2 s, none twice |
| 120 rows, cron alone, test inbox | 10 a minute | 29 a minute, none twice |
| 100 rows, 15 parallel requests and the cron, test inbox | not measured | 85 a minute, none twice, none stuck |

CPU: a request that also sent through Gmail used a median of 11 ms and a maximum of 25 ms.

**Not checked:** arrival in the inbox (the Gmail scope only sends), 30 real emails a minute (calculated from about 1.6 s per email in a batch), real Gmail and Apple Mail in dark mode, Gmail recognising the code on a phone, and production quotas (the session was refused production reads).

### Release (2026-10-31)

Worker `662e11f`, version `73437f90` through CI; the rollback version is `2401d969`. No migration. The admin label for a row being sent went out after it.

After the release: CI tests and smoke pass, `/v1/health` answers 200, and `tools/account-prod-check.mjs` passes.

**Not checked on production:** no real email was sent there, so the first real one is the first test of this path.

**Back:** `npx wrangler rollback 2401d969` from `worker/`, then revert `662e11f` on `main` so the next push doesn't bring it back. Rows in `sending` at that moment stay there: the old code doesn't pick them up, so set them back to `queued`.

## Step 4: the old competitions

Every competition has belonged to an account since accounts went on (YOUTH-ACCOUNTS-PLAN §4, rev. 3), but the code path and its options stayed in the pages and the builder. This step removes them. No data was touched: no row, column, setting or Script Property.

**Removed from the public pages:** the code screen and «الكود مسجل باسم …», the form, guests, the participant token, the Apps Script client (`comp/api.js`, `comp/config.js`) and the check that fell back to all of it. `points/` keeps its address, for links and printed cards, and sends anyone signed out to `/account/`.

**Removed from the admin:** the builder's «المشاركة» tab, the «مسابقة بأكواد» preset, the codes switch, the «المشاركين» screen with code display, reset, distribution, cards and name import (`AdminCompPeople.html`), the «+ مشارك» quick action and the old age-rules card. «حسابات الشباب» already does these jobs, including the age range. The wallet no longer depends on the codes switch.

**Fixed along the way:** a refused start (attempts used up, for example) went back to the entry step and asked again in a loop. It now stays on the intro with the server's message. A session the server refuses is dropped before sign-in.

**Stays, on purpose:**
- `participation`, `allowGuests`, `fields` and `uniquePhone` columns and old values. Nothing reads them on the public side. Non-points presets still store `open`, because the Apps Script runtime below reads it.
- `CompPublic.gs`, `CompRegistry.gs` and `CompCrypto.gs` on Apps Script, closed by `COMP_RUNTIME = worker`, with their unit tests. They leave with Apps Script, and any data with the Phase 7c cleanup.
- The old «النقاط» and «المتجر» screens, hidden while accounts are on (§3o).

**Tests:** site 757 pass, with the same 2 failing as before this step. Worker 414 pass. Browser: `comp-public` 12, `comp-portal` 8, `comp-portal2` 10, `comp-admin` 16, `comp-admin3` 8, `comp-admin4` 2, `comp-accounts` 3 pass. They run against a signed-in Worker mock (`tests/fakes/comp-worker.mjs`). `points-widget` (3 of 6) and one `admin-filters` test fail the same way on `main`. Removed with the code they tested: `comp-live.e2e.mjs` (Apps Script runtime), `comp-admin2.e2e.mjs` and `people-roundtrip.e2e.mjs` (codes and old participants), plus those scenarios elsewhere. Server behaviour stays covered by `worker/test/comp-runtime.test.mjs`.

**Staging:** Worker `1f2e2cd4`. `scripts/comp-check.mjs` passes on it. Signed out, `points/` reaches `/account/`, and a missing competition says unavailable with no code screen.

**Not checked:** a competition played by hand on Staging from the site, the builder opened on real Staging (no admin sign-in here), and real phones.
