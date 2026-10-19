# Booking Phase 1 completion + Admin access & notifications foundation (PLAN ONLY)

Rev. 4, 2026-10-19. It folds in the owner's final clarifications on decisions 2, 5, 6, 7, 12 and 15.
Planning only: nothing here is implemented, deployed or changed in production.

Code inspected: `origin/main` @ `3c029b1` (production) plus the worker worktree
(`feat/worker-foundation` @ `d059ad0`, one unpushed commit: `bookingOnlineOn/Off`).
The local `main` and `feat/push` in this checkout are behind production and were not used as the reference.

Related contracts (not reopened unless a technical reason is given):
`docs/BACKEND-MIGRATION.md` (roadmap rev. 3), `docs/EVENTS.md` (booking product contract),
`worker/BOOKING-API.md` (transport), `docs/YOUTH-ACCOUNTS-PLAN.md` §14 (Gmail sender design;
**its address is misspelled there**: the correct, existing account is `athanasius.youth.safaga@gmail.com`).

---

## 0. Summary

- **Most of the booking system already exists.** It includes the queue per event, the booking sheet, proofs,
  the append-only payment ledger, installments, overrides, edit locks, idempotency, the summary per servant and the XLSX export.
  The gaps are **visibility, permissions, notification reliability, cash policy and the InstaPay/wallet payment step**.
- **Bug confirmed by reading the code:** the booking UI is invisible on the Events page in the installed admin app
  ("stay signed in" device session). It is also hidden for 60 s after any Worker error.
- **Push to the Primary Admin:** the code has six possible silent-drop paths (§2.2). The most likely causes are the presence filter
  and a missing admin-push subscription on the device. A read-only production check decides between them.
- **Approach: Recommended (§5).**
  - **Phase 1:** close the pilot with targeted fixes + the payment UX (~9–12 dev-days).
  - **Phase 1.5 (new), before Phase 2:** admins + permissions, unified activity, and the **global** Gmail + Push notification system (~15–19 dev-days).
  - **Final project stage:** a full real-device notifications audit (§4.8).
- **Not launched yet.** The test event stays available, test records are kept until testing ends, no real money moves during tests,
  and the test data is cleaned before the official launch (§3).
- **Payment numbers** are served live by the Worker, only after the Primary Admin has approved them, and are never written into `event.json`.
  This replaces the EVENTS.md §2 rule "no account numbers are ever published", at your request.

---

## 1. What exists vs. what is missing

| Requirement | Exists (production code) | Missing |
| --- | --- | --- |
| Booking dashboard | `AdminBook.html`: per-event queue with status filters + counts, search, booking sheet (request, flags, proofs, payments, derived totals), confirm/reject/cancel/reopen/update, manual booking, cancel-all, summary | Header KPIs in the queue; proof thumbnails in rows; `01x` phones in lists; an obvious entry point (B1) |
| Approve / reject / payments / installments | Worker `book/admin.js`: §5.1 payment rules, `full` / `installments` (`minFirst`, `finalDueAt`, `overdue`), refunds, voids, `needs_override`, `warn` + `force` | Multiple due dates / reminders (later) |
| Accounting | Append-only `payments`, one void per row, totals derived, per-servant summary, refund owed, retained fee | Servant cash-handover reconciliation (later) |
| Activity log | Every booking write adds a D1 `activity` row in the same guarded batch | «سجل النشاط» reads only the Apps Script Activity tab: booking moves are invisible there (B3) |
| Concurrency | `version` guard, edit locks (90 s lease), UNIQUE `request_key` / `idem_key`, capacity recount inside confirm | Nothing for Phase 1 |
| Cash via servants | Servants + PayMethods (`cash` seeded); servant cards with `wa.me` only when `publicWa = 1`; prefilled WhatsApp text | Cash is **selectable and submittable online** today (B4); no "online" flag per method; no permission split for cash bookings |
| InstaPay / wallet UX | Proof step: 1–3 screenshots required when `needsProof`, checked on the server. The draft keeps step, fields, `requestKey` and uploaded `proofId`/`claim`, saved on `pagehide` | Destination number, beneficiary and amount on the page; «نسخ الرقم»; «تم التحويل»; `visibilitychange` save; per-servant numbers + Primary approval |
| Roles & permissions | `admins` table (D1, synced from the Apps Script allowlist), `primary | admin`; the module switch is primary-only | No per-module or per-action grants: **any allowlisted admin can confirm, void, cancel-all and export phones** (B6). Apps Script has none either |
| Notifications | Worker `book_news` → Apps Script 5-min `bookNewsTick` → one grouped push to every non-present admin + toast | Recipients not filtered by permission; at-most-once delivery (B7); presence suppression too broad (B8); no email; no settings |
| Excel | `admin/xlsx.js`: real XLSX, RTL, autofilter, text columns, inline strings (never formulas); per-event workbook + one sheet per servant | Phones as `+2010…`; no combined report; no filters; no permission check or audit |
| Gmail | Nothing sends email. Sender design exists (YOUTH-ACCOUNTS-PLAN §14: Worker → Queue → Gmail API) | Everything |

---

## 2. Bugs: confirmed vs. assumed

### 2.1 Confirmed by reading the code

| # | Bug | Where | Effect |
| --- | --- | --- | --- |
| B1 | «الحجوزات» (nav item + per-event button) is drawn only when `B.on`. A **device session** (installed admin app, "stay signed in", `632f0f9`) gets `code: 'google'` → hidden. The Google card shows only through a push link | `AdminBook.html` `B.check`, `paintLink`, `addNav` | **This explains "the Events page doesn't clearly show booking management."** |
| B2 | Any Worker error during `B.check` → hidden quietly for 60 s | same | Intermittent "missing" bookings |
| B3 | Booking/payment audit only in D1; «سجل النشاط» reads Apps Script | `AdminActivity.html` | Booking audit invisible |
| B4 | Public submit accepts `cash` | `worker/src/book/public.js` L129–138, `assets/js/page/booking.js` | Conflicts with the cash policy |
| B5 | Export phones are `+20…` | `admin/book-kit.js` `bookingBook` | Requirement gap |
| B6 | Every booking/finance route is `auth: 'admin'`, with no per-action check | `worker/src/routes.js` | Servants can't be onboarded safely |
| B7 | `claimNews` is at-most-once: a lost reply loses that push for good | `worker/src/book/news.js` | Silent missed alerts |
| B8 | A "present" admin (heartbeat < 70 s) gets only a toast, even when the panel is in a background tab or on another device | `AdminNotify.gs` `adminPresent_` | Likely why the Primary Admin missed `B-Z8PSQ` |

### 2.2 Push to the Primary Admin: the decisive read-only checks

The session's permission policy blocked my read-only production query. The owner runs these, or allows me to run them (decision R1).

1. **Sheet «Activity»:** find the `booking.new` row of the test event. Its `notified` column tells what happened:
   - `sent:N`: sent, so the problem is on the device (H6);
   - `present`: H1;
   - `none`: H2;
   - `off` or `error`: H3.
2. **No `booking.new` row at all.** Run in D1:
   ```sql
   SELECT event_id, unsent, sent_ms FROM book_news;
   SELECT cairo, summary FROM activity WHERE action = 'booknews.claim' ORDER BY at DESC LIMIT 5;
   SELECT key, value FROM settings WHERE key LIKE 'SYNC_TS_%';
   ```
   - `unsent > 0` and no claim → H4: trigger uid, `BOOKING_ONLINE` at tick time, `WORKER_SYNC_SECRET`, or HTTP ≠ 200 (execution log: `book news: HTTP …`).
   - A claim exists but no sheet row → H5 (= B7).
3. **Sheet «AdminPushSubs»:** does the Primary Admin's email have a row for the expected device? Opt-in is per device (the bell in the installed `/admin/` app).

| H | Cause | Likelihood |
| --- | --- | --- |
| H1 | Primary Admin "present" → toast only | High |
| H2 | No admin-push subscription on that device | High |
| H3 | FCM key / send failure | Low |
| H4 | Tick not running or not reaching the Worker | Medium |
| H5 | Claim lost (B7) | Low |
| H6 | Delivered but suppressed (OS / service-worker scope after the `/index.html` change) | Low–medium |

B7 and B8 get fixed in Phase 1 whatever the answer. Email becomes the fallback in Phase 1.5.

---

## 3. Test event and test data (decision 2: final)

The site, the booking system and the event pages have **not officially launched**.
- **Kept:**
  - the test event stays published and bookable for development and testing;
  - `BOOKING_MODULE = 1` and `BOOKING_ONLINE = 1` stay on;
  - nothing is closed now.
- **`B-Z8PSQ` and every test record are preserved** until all tests finish. They are evidence for §2.2 and for go-live test #2.
- **No real money during tests:**
  - payments in tests are recorded by an admin with the note «تجربة»;
  - on InstaPay / wallet tests the tester pastes the copied number into the app, checks that the app accepts it and shows the holder name, then **cancels before sending**;
  - screenshots are sample images.
- **Test identification:** the test events' ids are listed in `settings.TEST_EVENTS`, so the cleanup can find their data. Their titles should start with «تجربة» so a stray visitor knows.
- **Pre-launch cleanup (launch gate, §6). A one-time, primary-only exception to the "never delete" rule:**
  1. dry run: counts per table for the test events (bookings, payments, proofs + R2 files, `book_news`, `edit_locks`, `idempotency` rows, `pay_dest` test rows, activity rows);
  2. D1 Time Travel bookmark + the nightly-format export, kept 30 days;
  3. purge, then verify that the counts are 0;
  4. one `launch.reset` activity row (counts only);
  5. unpublish or delete the test events in the Sheet;
  6. remove the test devices from «AdminPushSubs» if asked.

  Run only with your explicit go at launch time (decision R2).

---

## 4. Design

### 4.1 Booking dashboard (Phase 1)
- **Entry points:**
  - the per-event «الحجوزات (N جديد)» button is always visible when the module is on; a device session opens the Google card;
  - a top-level nav entry «الحجوزات» with a pending badge;
  - a home card «مستنيين المراجعة».
- **Queue header:** total bookings, places taken / left, pending / confirmed / rejected, due / received / balance, refunds owed, overdue. Data from the existing `summary`.
- **Rows:** name, `01x` phone (tap = `tel:`, WhatsApp icon), people, status chip, payment chip, proof icon.
- **Booking history:** `GET /v1/admin/book/bookings/<id>/activity` → «السجل» in the booking sheet. The unified log reuses it.

### 4.2 Cash via servants (decision 5: final)
- **Public visitors:**
  - cash is **informational only**: «الدفع كاش مع الخادم» with the event's servants who accept cash;
  - the WhatsApp number + button with an event-specific prefilled message appear only when `publicWa = 1` (the existing contact visibility). Otherwise name only + «كلّم الخادم في الكنيسة»;
  - visitors can't submit cash bookings.
- **PayMethods:** new column `online` (`cash = ''`, `instapay` / `wallet = '1'`), published as `online: bool`.
  The Worker refuses `online !== true` methods on public submit (`invalid`, `field: 'method'`).
- **Admin cash bookings:**

  | Grants | What happens |
  | --- | --- |
  | `bookings.create_cash` + `bookings.approve` | Registers **and immediately confirms**: one `POST /v1/admin/book/bookings` with `confirm` + the cash payment. This is today's manual booking |
  | `bookings.create_cash` only | Registers the booking **pending** with the received cash **recorded in the ledger at once** (new: `payments` on create without `confirm`, `source: admin`). An approver later confirms with that payment already counted; nobody re-enters the money |
  | neither | No access |

  - The payment's `servantId` must be the admin's own linked servant (scope `own`), unless they hold `finance.manage`.
  - Every step writes payment rows + activity rows (`booking.create`, `payment.add`, `booking.confirm`).
  - Pending cash bookings appear in the approvers' notifications (§4.4).
- **Phase 1:** all current admins still hold every right. The split is enforced from Phase 1.5, before any limited servant is onboarded.
  The Worker API shape (payments on create) is built in Phase 1, so nothing is reworked later.

### 4.3 Roles & permissions (Phase 1.5; pulled forward from Phase 3)
- **Model:** explicit grants `module.action`. Presets (Treasurer, Servant – bookings, Content editor, Viewer) only pre-fill checkboxes.
  - Modules: `content`, `publish`, `events`, `bookings`, `finance`, `exports`, `competitions`, `store`, `points`, `participants`, `media`, `push`, `accounts`, `activity`, `notifications`, `system`.
  - Actions: `view`, `add`, `edit`, `delete`, `approve`, `publish`, `export`, `export_pii`, `manage`, `create_cash`.
  - Scope: `all` | `own` (the admin's linked servant, `admins.servant_id`). Per-event scopes are deferred.
- **Owner of the data:** **D1 owns admins + grants from Phase 1.5.** This amends BACKEND-MIGRATION §9 (allowlist synced from Apps Script), for a technical reason:
  - money permissions are enforced on the Worker, and revocation must not depend on a push from the other runtime;
  - grants built in Apps Script would be rebuilt in Phase 3.

  Apps Script pulls a signed `/v1/sync/grants`, caches it 60 s, keeps a last-good copy, and mirrors `ADMIN_EMAILS`, so the login gate is unchanged.
- **Enforcement:**
  - Worker: `requirePerm(ctx, perm, { scope })`, from one route → permission table;
  - Apps Script: `assertCan_(perm)` from one `API_PERMS` table. Unmapped write APIs are denied by default, and a test enumerates every `api*` function;
  - the UI hides what isn't granted (cosmetic only).
- **Primary Admin protection:**
  - the primary row is immutable through the API;
  - nobody can grant a permission they don't hold;
  - an admin can't remove their own `accounts.manage`;
  - the last account manager can't be removed;
  - account and permission changes need a fresh Google token;
  - every change is audited (before/after) and sent as a critical notification to the Primary Admin.
- **Migration:** existing admins start with full grants except `accounts.manage` and the notification settings (primary only). The Primary Admin then trims.

### 4.4 Global Gmail + Push notification & audit system (decisions 6, 7: final; Phase 1.5)

**Principles:**
- the Activity Log is the source of truth, written whatever happens to delivery;
- Push and Gmail are complementary channels derived from it;
- it covers **all** admin modules.

```
any admin/system action ──(same batch)──▶ D1 activity (unified log)
   Apps Script modules ──signed /v1/sync/activity (inline for critical, 1-min tick for the rest)──▶ D1 activity
cron (1 min) sweeps activity.notified = 0 ─▶ router: catalog + settings + grants + prefs ─▶ notify_outbox (UNIQUE dedupe_key)
   ├─ push  ─▶ /v1/sync/notify-claim (generalised book-news feed, ack'd) ─▶ Apps Script pushFanout_ to the NAMED admins ─▶ result back
   └─ email ─▶ Queue job ─▶ Gmail API as athanasius.youth.safaga@gmail.com ─▶ sent | retry (backoff) | dead after 5 → alert
```

**Sender: the existing account `athanasius.youth.safaga@gmail.com`; no new account.**
- **OAuth through the Worker:**
  - a Google Cloud OAuth client with only the `gmail.send` scope, consent screen **"In production"** (Testing-mode tokens expire after 7 days);
  - the owner runs a one-time local consent helper signed in as that account;
  - the refresh token goes straight into the Worker secrets `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`. It never touches the repo, the browser or D1;
  - the access token is cached in Worker memory (~1 h);
  - an hourly token-health check runs, and a failure sends a critical push to the Primary Admin;
  - 2-Step Verification on the account; recovery details with two leaders;
  - a password change revokes the token, so re-consent is in the runbook.
- **From / Reply-To:** «شباب أثناسيوس» `<athanasius.youth.safaga@gmail.com>`.

**Catalog (all modules, in code), with defaults:**

| Level | Default | Examples |
| --- | --- | --- |
| critical | email **immediately** + push; can't be turned off for the Primary Admin | permission/account changes, payment-number change or approval, primary-only switches, cancel-all, payment void, export with phones, publish failure, job dead-letter, Gmail token broken (push only) |
| important | email immediately + push (relatively important changes, on by default) | bookings or cash bookings awaiting approval (grouped per event per 10 min), publish done, event / competition / store item created or opened, points bulk adjust, redemptions awaiting approval, competition review queue, a new admin device |
| routine | **no email by default**; optional in the daily summary | draft edits, reorders, media uploads, small text edits (same-actor edits within 10 min are already merged) |

**«إعدادات الإشعارات» (Admin settings; Primary Admin only):**
- **per activity type** (grouped by module): email on/off, immediate or daily summary, push on/off;
- **recipients per type:** "everyone holding the permission" (default) plus explicit include/exclude of named admins; only admins who hold the permission can receive it;
- **individual preferences:** each admin's own overrides are shown. Admins set their own preferences in «تنبيهاتي», within what the Primary Admin allows; the Primary Admin can lock a type as mandatory;
- **daily summary time** (default 21:00 Cairo) and the daily email budget;
- **delivery monitoring:** sent / deferred / failed / dead per day, last success, token health, quota use, and the critical items still waiting.

**Email content:**
- Arabic RTL, short HTML + plain text: who, what, when (Cairo), which fields changed (names, not values);
- one link to `https://stathanasiosyouth.github.io/admin/#open/<type>/<id>`;
- the link carries no token: access is Google sign-in + the permission check on open.

**Privacy:**
- no visitor names, phones, payment numbers or amounts in email or push;
- the outbox stores **no bodies**: they are rebuilt from activity rows at send time;
- the outbox is kept 30 days.

**Reliability:**
- `dedupe_key = kind:entity:recipient:window` (UNIQUE), so duplicates can't be stored;
- the push claim becomes at-least-once with an acknowledgement (fixes B7);
- Queue retries with backoff; dead after 5 → `notify.failed` activity + push to the Primary Admin;
- presence suppression only when the panel is **visible** (fixes B8).

**Quotas: critical is never silently discarded.**
- Consumer Gmail allows ~500 recipients a day. Own daily budget 150 for admin mail, shared later with the Phase 5A account mail (300 in total, as planned), with **50 reserved for critical**.
- When the budget is short:
  - routine moves into the summary first, then important does;
  - critical uses the reserve;
  - if even that or Google's own limit is hit, critical rows stay **queued (`deferred_quota`)** and are retried at the next window. They also go by push at once, and they show as a red banner in «حالة النظام» and on the Primary Admin's home.
- No critical row expires. It is sent or explicitly dismissed by the Primary Admin.

**Tables (migration `0005`, additive):**
- `activity` + `severity`, `source`, `notified`;
- `notify_settings` (type, email_mode, push, recipients JSON, locked);
- `notify_prefs` (email, type, channel, mode);
- `notify_outbox` (id, dedupe_key UNIQUE, recipient, channel, kind, activity_ids, status, attempts, next_ms, sent_ms, error).

### 4.5 Excel export
- **Phase 1:**
  - phones as `01xxxxxxxxx` **text**;
  - formula-injection guard: every user text cell stays `inlineStr`, never `<f>`. A test covers cells starting with `= + - @`, TAB or CR. Any future CSV path must prefix `'`.
- **Phase 1.5:**
  - `GET /v1/admin/book/export?events=<ids|all>&from&to&status&servantId&method`, filtered on the server;
  - sheets: ملخص عام, حسب الفعالية, حسب الخادم, الحجوزات (+ event), الدفعات (+ installment status), الأقساط المتأخرة; all RTL;
  - grants: `exports.export`; money columns need `finance.view`; phones need `exports.export_pii` (otherwise masked);
  - each export is audited (filters + row count). A PII export is critical. Exports are rate-limited.

### 4.6 Admin UI
Keep the current RTL design and components.
- **Phase 1:**
  - B1/B2 fixes, nav + badge, home card, queue header;
  - mobile booking sheet (sticky action bar, full-screen proof viewer, tap-to-call / WhatsApp);
  - servant editor payment fields + «اعتمد رقم الدفع».
- **Phase 1.5:**
  - «الصلاحيات»;
  - «إعدادات الإشعارات» (Primary) + «تنبيهاتي»;
  - unified «سجل النشاط» from D1;
  - «حالة النظام».

### 4.7 InstaPay & mobile-wallet payment UX (decision 12: final; Phase 1, before the public launch)

**Configuration (Servants registry reused):**
- New optional PRIVATE columns, edited in the existing servant editor:
  - `instapayNumber`;
  - `walletNumber`;
  - `payName` (beneficiary, shown only when filled).
- Approval columns: `instapayApprovedAt/By`, `walletApprovedAt/By`.
- **Phone and contact stay unchanged and independent:** `phone` and `publicWa` are untouched.
  **Payment-number visibility doesn't depend on WhatsApp visibility.** A number can be shown for payment while the WhatsApp link is hidden, and the other way round.
- **Resolved destination** per servant × method:
  - the explicit number if set, else the servant's `phone` (fallback);
  - then it must be a valid Egyptian mobile (`compNormPhoneEg_`) **and approved by the Primary Admin**;
  - otherwise the method is **unavailable** for that servant.
- **Primary Admin approval (no test transfer, no screenshot, no automation):**
  - the editor shows «الرقم اللي هيظهر للزوار: 010 1234 5678 (من رقم الموبايل)» and a button «اعتمد رقم الدفع ده» for the Primary Admin;
  - the Primary Admin personally makes sure the number receives payments;
  - **any change to the resolved number clears the approval**: an edited payment number, or an edited `phone` while it is the fallback. The method is then hidden until it is re-approved;
  - who can edit numbers: the Primary Admin in Phase 1; `finance.manage` holders from Phase 1.5. Their edits wait for the Primary Admin's approval;
  - every edit and approval is audited (masked `010•••••678`) and sent as a critical notification to the Primary Admin.
- **Per method / per event:** the two columns give different numbers per method. Per-event variation comes from attaching a different servant to each event (the existing `event.servants`). A number override per event is not built.

**Delivery (dynamic, never hard-coded, never in `event.json`):**
- Apps Script pushes the resolved, **approved** destinations on servant save, event save and publish: signed `POST /v1/sync/pay-dest` → D1 `pay_dest`. Phase 4 makes D1 the owner.
- Public `POST /v1/book/pay { slug, servantId, method }` → `{ number, name?, amount }`:
  - only for a servant + method attached to an open event;
  - rate-limited 30 / 10 min per IP; `no-store`;
  - `amount` = the server quote: the full total, or «مقدم لا يقل عن minFirst من إجمالي X».
- **Submit:** a servant + method without an approved destination → `invalid`.
- **Page:** «إنستاباي مش متاح مع الخادم ده دلوقتي، اختار خادم تاني أو ادفع كاش مع الخادم».

**Public flow (`booking.js`, step 3 → 4):**
1. **Payment card:** «المطلوب تحوّله»; the number large, `dir="ltr"`, grouped for reading; the beneficiary name when set.
2. **«نسخ الرقم»:**
   - copies ASCII `01xxxxxxxxx` only (no `+20`, spaces, Arabic digits or bidi marks);
   - `clipboard.writeText` → `execCommand` fallback → select for a manual long-press;
   - «اتنسخ الرقم ✓» + an `aria-live` toast.
3. **Guide:** «افتح تطبيق إنستاباي (أو المحفظة) → حوّل المبلغ للرقم ده → خد سكرين شوت → ارجع هنا».
4. **«تم التحويل» → proof step:** 1–3 screenshots, required (`needsProof`, checked on the server). Each one is uploaded when it is picked.
5. **Submit → «قيد المراجعة»:** «صورة التحويل مش تأكيد للدفع: الخادم المسؤول بيراجع التحويل ويأكّد الحجز».
   **A proof is never a payment.** Only an authorized admin records and confirms it (`bookings.approve` + `finance.manage` from Phase 1.5).

**State across app switches:**
- reused: the draft with step, fields, servant, method, `requestKey` and uploaded proof ids;
- added:
  - a save on `visibilitychange → hidden`;
  - the draft remembers that the visitor reached the payment card;
  - Turnstile is reset on resume;
  - an Android tab killed during the gallery picker restores from the draft.

### 4.8 Notifications testing in two stages (decision 15: final)

**Stage 1: Phases 1 and 1.5.**
- **Phase 1:**
  - fix the booking push failure (§2.2, B7, B8);
  - real-device check that the Primary Admin gets booking pushes with the panel closed, and with it open in a background tab;
  - check that the **existing** immediate and scheduled notifications work: public broadcast, `pushScheduleDaily`, `CompSchedule` `pushScheduleTick`, admin push. Sends go only to admin/test devices or a test schedule entry; there is no broadcast to public subscribers before launch;
  - check that each trigger exists exactly once and that every skip reason is logged.
- **Phase 1.5:**
  - essential admin push + Gmail: one item of each level per module family;
  - critical over the quota stays queued and goes by push;
  - retry, dead letters, dedupe, token revoked;
  - delivery monitoring shows all of it.

**Stage 2: final project stage (after Phase 6, when push runs on the Worker; the gate before retirement in Phase 7).**
- **Real-device matrix:**
  - Android Chrome + installed app;
  - iOS 16.4+ home-screen app (web push needs it installed);
  - desktop Chrome / Edge;
  - Gmail web + Gmail app.
- **Every notification kind:** general announcements, news, competitions, events, trips, bookings, admin push, Gmail (immediate + summary).
- **Scheduled announcements and reminders:**
  - Egypt time zone and **DST**: Egypt observes DST from the last Friday of April to the last Thursday of October;
  - pushes scheduled across both transitions;
  - stamps near midnight.
- **Delivery failures:** expired tokens, revoked permission, device offline, quota, Gmail token broken.
- **Competitions:** shown as «قريبًا» before their opening time, with participation **locked on the server** until it. A request sent early is refused, and the button unlocks at the exact time.
- **Output:** `docs/NOTIFICATIONS-AUDIT-REPORT.md`: test matrix, results, confirmed failures, required fixes. Fixes are done before retirement.

---

## 5. Approaches compared

| | Minimal | **Recommended** | Comprehensive |
| --- | --- | --- | --- |
| Scope | B1/B2, push diagnosis, cash flag, `01x` phones, payment card | Phase 1 (§6) + Phase 1.5: grants, global notifications (Gmail + Push, settings), unified log, combined export, UI; final audit | Recommended + per-event scopes, treasurer handover, installment schedules + reminders, the whole of Phase 3, admin push on the Worker now, report builder |
| Effort | 7–9 days | 9–12 + 15–19 days (+ final audit 2–3 days + fixes) | 40–52 days |
| Servants can be onboarded | No | Yes, after 1.5 | Yes |
| Rework before Phase 2 | High | Low | Low, but Phase 2 is delayed by 4–6 weeks |

**Pick: Recommended.**

---

## 6. Implementation order

### Phase 1 — close the pilot, ~9–12 dev-days
1. Owner: the §2.2 read-only checks (the test event stays open).
2. B1/B2: entry points always visible, Google card in device sessions, visible error + retry (0.5–1 d).
3. B7/B8: acknowledged claim + dedupe, presence = visible panel, `notified` reason in the log (1–1.5 d).
4. Cash:
   - `online` flag, informational public card, Worker refusal (1–1.5 d);
   - Worker: payments on create for admin cash bookings (pending + payment recorded) (0.5 d).
5. Dashboard header, rows, booking history, mobile sheet (1.5–2 d).
6. Export: `01x` text phones + injection test (0.5 d).
7. InstaPay/wallet (§4.7):
   - servant fields + Primary approval + preview (1 d);
   - `pay-dest` sync, D1 `pay_dest` (migration `0005a`), `/v1/book/pay`, submit check (1–1.5 d);
   - payment card, copy, guide, «تم التحويل», draft (1–1.5 d);
   - tests (0.5 d).
8. Stage-1 notification checks for Phase 1 (§4.8) (0.5 d).
9. Staging: extended `book-check` / `book-ops-check`, admin + public e2e (0.5–1 d).
10. Go-live test #2 on the test event, **without real money** (§3):
    - a full InstaPay booking on a phone (paste into the app, cancel before sending, sample screenshot, admin confirms with «تجربة»);
    - a cash booking with immediate confirm;
    - a cash booking left pending;
    - the export;
    - booking push.

### Phase 1.5 — Admin access & notifications foundation, ~15–19 dev-days
1. Migration `0005` + `requirePerm` on the Worker (2–3 d).
2. `/v1/sync/grants`, `API_PERMS` + default-deny + completeness test, `ADMIN_EMAILS` mirror (2–3 d). Needs step 1.
3. «الصلاحيات» UI + Primary protections + audit (1.5–2 d). Needs step 2.
4. Activity forwarding + unified «سجل النشاط» (1.5–2 d). Needs step 1.
5. Router + outbox + acknowledged push claim (2–3 d). Needs steps 1 and 4.
6. Gmail OAuth (owner consent) + sender + quota/reserve + summaries + templates (1.5–2 d). Needs step 5.
7. «إعدادات الإشعارات» + «تنبيهاتي» + «حالة النظام» (1.5–2 d). Needs steps 5–6.
8. Combined export + filters + PII grant (1.5–2 d). Needs step 1.
9. Stage-1 checks for Phase 1.5 + staging rehearsal (permission matrix, real emails to test inboxes, quota, token revoked) (1–1.5 d).

Steps 4 and 8 can run alongside steps 2–3. The first limited servant is onboarded only after step 3 passes.

### Official launch gate (between Phase 1 and Phase 2)
1. Phase 1 done, plus Phase 1.5 if servants will approve or record money (decision R3).
2. Go-live test #2 passed.
3. **Test-data cleanup (§3)** with your explicit go.
4. Real events published.

### Phase 3 slices moved earlier
Only **admins + grants** and **unified activity** move. Sessions, presence, edit locks for the other modules, devices and bootstrap stay in Phase 3.

---

## 7. Testing
- **Worker** (`node --test`, real SQLite): permission matrix, cash rules (both grant combinations), pending-with-payment, cash refusal, pay-dest approval and clear-on-change, outbox dedupe/retry/quota reserve/deferred critical, acknowledged-claim races, cleanup dry run.
- **Apps Script fakes:** `API_PERMS` completeness, default-deny, grants cache, activity forwarding, approval cleared when `phone` changes.
- **Admin e2e:** device-session entry points, badges, permissions UI, notification settings, Primary row locked, approval button primary-only.
- **Public e2e:**
  - the cash card with `publicWa` on and off;
  - the payment card shown or hidden by approval, independent of `publicWa`;
  - the copied string is ASCII `01x…`;
  - draft restore after `visibilitychange`.
- **XLSX:** round trip (leading 0, no `<f>`, RTL).
- **Notifications:** stage 1 (§4.8) in Phases 1 / 1.5; stage 2 at the final stage.

## 8. Rollback
- **Worker:** `wrangler rollback`. Migrations are additive only.
- **Flags in D1 `settings`:**
  - `PERMS_ENFORCE=0` (full grants except account management);
  - `NOTIFY_EMAIL=0`;
  - `NOTIFY_ROUTER=0` (back to the book-news push);
  - `PAY_DEST_PUBLIC=0` (payment card off; the number goes by WhatsApp as today).
- **Cash:** set `online` back to `'1'` + republish.
- **Apps Script:** redeploy the previous version (the grants cache falls back to the `ADMIN_EMAILS` mirror).
- **Data:** D1 Time Travel / nightly backup. The pre-launch cleanup keeps its own bookmark + export for 30 days.

## 9. Risks
| Risk | Mitigation |
| --- | --- |
| Gmail token expires (Testing mode) or is revoked by a password change | "In production" consent; hourly health check → critical push; runbook; Push stays a separate channel |
| Admin mail in spam | Plain Arabic text, stable subjects, only github.io links; staged inbox tests |
| Critical email lost to the quota | 50 reserved; critical never expires; deferred + push + red banner |
| Too many emails | Routine off by default; grouping windows; summaries; the Primary Admin tunes it in settings |
| An unmapped Apps Script API → privilege gap | Default-deny + completeness test |
| Lock-out / escalation | Primary immutable, no granting above your own, last-manager rule, fresh token |
| Wrong or tampered payment number | Primary approval required; any change clears it; critical notification; beneficiary name shown |
| Approved fallback phone exposed publicly | Shown only at the payment step, served by the Worker (rate-limited, `no-store`), never in `event.json` / git history; approval is the explicit consent |
| Real money moved by accident in tests | Cancel-before-send rule; payments recorded as «تجربة»; test events titled «تجربة» |
| Test data left at launch | Cleanup is a launch-gate step with dry run + verification |
| Apps Script trigger quota (90 min/day) | Ticks do nothing when idle; critical forwarded inline |
| Phase 1.5 delays Phase 2 | Fixed scope; Comprehensive items stay deferred |

---

## 10. Revised roadmap (Phases 1–7)

| Phase | Scope | Change from BACKEND-MIGRATION rev. 3 |
| --- | --- | --- |
| 0 ✔ / 0.5 | Spike / front-end quick wins | — |
| **1 Foundation + booking pilot** | As built + §6 Phase 1 (B1–B8, cash policy, InstaPay/wallet UX + Primary-approved numbers, stage-1 notification checks); go-live test #2 | Extended |
| **1.5 Admin access & notifications foundation** (new) | Grants in D1 + enforcement in both runtimes, Primary protections, unified activity, global Gmail + Push router with Primary settings, summaries, quotas, monitoring, combined export | Pulled forward: admins + activity (Phase 3), outbox + Gmail sender (Phase 5A) |
| **Launch gate** | Test-data cleanup → official launch of the site + booking | New |
| 2 Publish separation | Unchanged | Publish events feed the router |
| 3 Admin platform | Sessions, presence, edit locks (other modules), devices, bootstrap | Smaller |
| 4 Content + pages/events + media | Unchanged | PayMethods `online`, servant pay fields + approvals move to D1 with Events/Servants |
| 5 Registry + points + store + competitions runtime (5A first) | Unchanged | 5A reuses the outbox/sender |
| 6 Competition authoring, seasons, push, route | Unchanged | The push channel moves to Worker FCM; the claim feed is retired |
| **7 Final notifications audit → Retirement** | 7a: the §4.8 stage-2 real-device audit + report + fixes; 7b: retirement as planned | Audit added as the retirement gate |
| 8 (optional) Custom domain | Unchanged | — |

---

## 11. Decisions

### Final (decided by you, rev. 4)
| # | Decision |
| --- | --- |
| 2 | Test event stays available; `B-Z8PSQ` + test records kept until tests end; no real money; cleanup before launch (§3) |
| 5 | `create_cash` + `approve` → register and confirm at once; `create_cash` only → pending with the payment recorded; full ledger + activity (§4.2) |
| 6 | Sender `athanasius.youth.safaga@gmail.com` (existing), Gmail API via the Worker, OAuth as in §4.4 |
| 7 | Global, all modules; important by default; Primary settings UI (types, recipients, immediate/summary, individual preferences); critical never silently dropped (§4.4) |
| 12 | Primary Admin approval only; only approved numbers shown; phone fallback only after approval; re-approval on change; independent of WhatsApp visibility (§4.7) |
| 15 | Two-stage testing; full real-device audit at the final stage (§4.8) |

### Recommended defaults, kept (no conflict with your clarifications)
| # | Default |
| --- | --- |
| 1 | Recommended approach (Phase 1 → Phase 1.5 → launch gate → Phase 2) |
| 3 | D1 owns admins + grants from Phase 1.5 (amends BACKEND-MIGRATION §9, technical reason in §4.3) |
| 4 | Module × action grants + presets, scope `all | own` |
| 8 | Push suppressed only when the panel is visible |
| 9 | Phones in exports only with `exports.export_pii`, notified to the Primary Admin |
| 11 | Payment numbers served live by the Worker, never in `event.json` (replaces the EVENTS.md §2 rule) |
| 13 | Separate optional `walletNumber`, same rules as InstaPay |
| 14 | No per-event number override; attach a different servant per event |

### Still requiring your approval
| # | Question |
| --- | --- |
| R1 (was 10) | Read-only production diagnostics (§2.2): will you run the 3 `SELECT`s + check the 2 sheets, or allow me to run them? |
| R2 | The pre-launch test-data cleanup as specified in §3 (one-time purge with bookmark + export). It runs only with a separate go at launch time |
| R3 | Launch gate: may the official public booking launch happen right after Phase 1 if, at launch, only full admins (not limited servants) approve and record money? Or must Phase 1.5 also be finished first? |
| R4 | Approval of this plan (rev. 4) as a whole, to start Phase 1 |

**STOP: awaiting approval. Nothing will be implemented before your answer.**
