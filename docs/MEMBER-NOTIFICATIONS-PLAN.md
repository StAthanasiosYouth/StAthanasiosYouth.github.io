# Member email notifications (PLAN ONLY)

Rev. 1, 2026-10-20 (owner decisions D1–D5: **final**). Plan and contract only. Nothing here is implemented, configured, deployed or sent.

Scope: email from `athanasius.youth.safaga@gmail.com` to **youth members** (accounts of `docs/YOUTH-ACCOUNTS-PLAN.md`) about their account, competitions, points wallet, rewards store and bookings.
It is **not** the admin notification system of Phase 1.5 (BOOKING-PHASE1-COMPLETION-PLAN §4.4: router, `notify_outbox`, catalog, «إعدادات الإشعارات», «تنبيهاتي»). The two share only the Gmail sender (`worker/src/notify/gmail.js`), the rolling-24h budget and the layout of `worker/src/notify/templates.js`.

Related contracts: YOUTH-ACCOUNTS-PLAN rev. 5 (accounts, OTP, §14 sender), COMPETITIONS.md §20 (crediting and result visibility on the Worker), EVENTS.md §7.4 (booking member emails), PAYMENT-REMINDERS.md (reminders), BOOKING-PHASE1-COMPLETION-PLAN §4.4 (budget), BACKEND-MIGRATION §22 (phases).

Code inspected: `feat/phase15-step1-perms` @ `db7e98b` (= `main` `26baa66` + the Azure Crest commits) (Worker `worker/src/notify/*`, migrations `0009`, `0012`; Apps Script `CompWallet.gs`, `CompPublic.gs`).

---

## 0. Decisions (owner, final, 2026-10-20)

| # | Decision |
| --- | --- |
| D1 | **Admin-created accounts are administratively verified at once**, without OTP: `email_verified_at` set, `email_verified_via = 'admin'`. Safeguards: email-entry confirmation, a creation notice, audit, critical alert on first self-recovery (§6). Same for an admin email correction. |
| D2 | Booking/payment emails **include paid / remaining amounts and due dates**, sent only to the account's verified email (OTP- or admin-verified). **Never** payment destination numbers, proofs, status tokens or any other secret (§7). |
| D3 | Personal **results emails on by default, delivered gradually**. Auto-gradable answers are graded and **credited to the wallet at once, without admin approval**; manual (essay) answers earn their points when a servant grades them; mixed competitions credit the automatic part at once and the manual part later; corrections are idempotent. Emails follow the result-visibility settings: no spoilers, no duplicates (§4.3, COMPETITIONS §20). |
| D4 | One rolling-24h budget, target **~400**: critical 50, **OTP ~100**, admin 120, member transactional 100, the remainder for bulk. **Reservations and priorities, not rigid caps.** OTP always has precedence; nothing else may use the OTP reserve (§5). |
| D5 | General announcements, new events and new competitions: **push + the website bell only**. No promotional or broadcast Gmail, ever, whatever the domain. |

Applied rules: OTP and security mail automatic; booking / payment / store status mail automatic **after** the server-side state change commits; results and points mail after the actual credit **and** permitted visibility; event-change announcements only on an explicit Admin send.

## 1. Status at rev. 1 (repository evidence)

| Piece | State |
| --- | --- |
| Gmail API sender, token health, retry/backoff, dead letters, rolling-24h budget (`notify/email.js`, `gmail.js`) | Live for **admin** mail; `NOTIFY_EMAIL = 0` in production |
| `otpEmail` (verify, recovery), `securityEmail` (`password_changed`, `email_changed`, `recovery_used`, `new_signin`), `bookingEmail` (confirmed, pending, balance, cancelled), member layout guard (no admin links) — `notify/templates.js` | **Implemented, inactive** (no caller) |
| `MAIL_RESERVE_OTP` setting, `allowed('otp')`, `notify_quota.otp` column | Implemented, inactive. The counter is never incremented; budget rules are hard caps (replaced in 5A-1, §5) |
| Azure Crest design: layout in `templates.js` (`bcd55be`), staging-only sample route (`db7e98b`), images `assets/email/*` (`d513500`, live on the site), `tools/build-mail-assets.mjs`, `worker/scripts/mail-preview.mjs` | **Implemented on branch `feat/phase15-step1-perms`, staging Worker only**; not on `main` / production (production still sends the older plain layout with the hyphenated sender name) |
| OTP flows, `pending_registrations` (the rev. 4 `email_outbox` becomes `member_outbox`) | Planned (YOUTH-ACCOUNTS 5A-1) |
| Any member email about competitions, wallet, store or bookings | **Added by this plan** (missing before) |
| Booking contact email | None: bookings store a phone only. Member booking mail needs a booking linked to an account (5A-4) |
| Wallet crediting (Apps Script, as built) | Credits only when the whole submission is `graded` (a mixed one waits for manual grading); the graded row shows in «نقاطي» `ledger`/`balance` even before `resultsAt` (a spoiler). Both change in 5B (COMPETITIONS §20); Apps Script is not patched |
| Budget rule `allowed()` (`notify/email.js`) | Hard caps; OTP may already use any free room (matches D4); the `otp` counter is never incremented; no member classes. Replaced in 5A-1 (§5) |

## 2. Architecture: a separate member pipeline

```
state change (account / booking / payment / ledger / redemption) ─┐ same D1 batch
                                                                 └▶ member_outbox row (kind, participant_id, entity, version, tier, dedupe_key UNIQUE, ttl)
OTP / forgot: register/start, forgot ──▶ member_outbox row + inline send (ctx.waitUntil), no cron wait
cron (1 min) ──▶ lease due rows by priority ──▶ re-check (§3) ──▶ budget (§5) ──▶ prefs (§8) ──▶ Gmail ──▶ sent | retry | dead | expired | superseded
```

- **Never the admin router.** The activity log is PII-free and admin-only by design; member events never ride it, and the admin catalog keys (`booking.confirm`, …) are not member kinds. Own catalog (`worker/src/notify/member.js`, 5A-1), own outbox, own switches.
- **Table** `member_outbox` (replaces the rev. 4 `email_outbox` of YOUTH-ACCOUNTS §20; one table for every member email): `id`, `participant_id`, `kind`, `entity_type`, `entity_id`, `entity_version`, `tier`, `class` (`otp` | `member_tx` | `member_bulk`), `dedupe_key` UNIQUE, `status` (queued | sent | failed | dead | deferred | expired | superseded | suppressed), `attempts`, `next_ms`, `expires_ms`, `sent_ms`, `error`, `created_ms`. **No bodies, codes or passwords**; the OTP code lives only in the inline send / Queue message. Kept 30 days.
- **Switches** (D1 `settings`): `MEMBER_EMAIL` (0/1: all member mail except codes), `OTP_EMAIL` (0/1). Independent of the admin `NOTIFY_EMAIL`. `accounts_mode = off` stops both.
- **Recipient:** the account's `email` only when `email_verified_at` is set (`via` otp or admin) and `status = active`. Never another address, never a booking's typed data.

## 3. "Never claim success before the server confirms"

- The outbox row is written **in the same D1 batch** as the state change it reports. No batch, no email.
- At send time the sender re-reads the entity: if its state or `version` no longer matches the row (a booking confirmed then cancelled before the email left), the row becomes `superseded` and the newer row speaks instead.
- Values (amounts, points, balance) are read at send time and labelled «وقت الإرسال». The append-only ledgers make them exact.
- Receipts say what happened and nothing more: «استلمنا طلبك — ده مش تأكيد».

## 4. Notification matrix

Model: **A** automatic immediate · **B** admin action → automatic email · **C** manual send · **D** optional / scheduled · **E** no email (in-app only).
Tier: **0** security, can't be turned off · **1** essential transactional, can't be turned off · **2** on by default, member can mute · **3** opt-in. Class: §5.

### 4.1 Account (5A-1)

| Event | Model | Tier / class | Content | Dedupe |
| --- | --- | --- | --- | --- |
| Registration OTP | A, inline | 0 / otp | 6-digit code, 10 min, «لو مش انت تجاهلها»; no link | `otp:reg:<pending>:<n>` |
| Forgot-password OTP (verified emails only, incl. admin-verified) | A, inline | 0 / otp | code only | `otp:rec:<pid>:<n>` |
| Account created by an admin (D1) | B | 0 / member_tx | «اتعمل حساب على موقع الخدمة بالإيميل ده»; no name, no password, no link but the site; «لو مش انت كلّم الدعم الفني» | `acct:new:<pid>` |
| Email changed by an admin/support | B | 0 / member_tx | to the **old** address (when it was verified) **and** a creation-style notice to the new one; never shows the other address | `acct:email:<pid>:<ver>` |
| Password reset by support/admin | B | 0 / member_tx | «الباسورد اتغير من الدعم الفني وقت …»; never the password | `acct:pw:<pid>:<pw_version>` |
| First self-recovery on an admin-verified email | A | 0 / member_tx | `recovery_used` notice (+ critical admin alert, §6) | `acct:rec1:<pid>` |
| Self-service password reset (later ones), welcome, phone/DOB/eligibility corrections, block, Primary views a password | E | — | — | — |
| New-device sign-in | D | 3 / member_tx | time, device type | `acct:dev:<session>` |
| About to age out (points will freeze) | D, daily cron, once | 2 / member_bulk | the date; «استخدم نقاطك قبلها»; no age | `acct:age:<pid>:<leavesAt>` |
| Deletion request done | B | 1 / member_tx | confirmation, no data; sent before anonymizing | `acct:del:<pid>` |

### 4.2 Bookings and payments (5A-4; only bookings linked to an account, §2)

| Event | Model | Tier / class | Content (D2) |
| --- | --- | --- | --- |
| Booking request received | A | 2 / member_tx | ref, event, date, people count, «قيد المراجعة — ده مش تأكيد» |
| Confirmed | B | 1 / member_tx | ref, event, date, places, amount due, paid, remaining, final due date |
| Rejected / cancelled by admin | B | 1 / member_tx | ref, the public reason chip, refund owed («الخادم هيتواصل معاك») |
| Whole event cancelled (`event.cancelAll`) | B | 1 / member_tx | ref, reason, refund follow-up |
| Payment recorded (incl. an accepted payment request) | B | 1 / member_tx | amount recorded, total paid, remaining, due date; «اتدفع بالكامل» variant |
| Payment voided / refund recorded | B | 1 / member_tx | corrected totals, neutral wording |
| Amount due changed | B | 1 / member_tx | new amount due, remaining, reason chip |
| Payment request submitted (BOOKING-PHASE1 §4.10) | A | 2 / member_tx | amount stated, «صورة التحويل مش تأكيد للدفع» |
| Payment request rejected | B | 1 / member_tx | reason |
| Payment deadline reminder | D, per-event switch | 2 / member_tx | remaining, due date; at `finalDueAt` − 3 days and on the day; confirmed + balance > 0 only; skipped while a request is open; never within 20 h of a WhatsApp reminder |
| Event date / time / place changed | **C** «بلّغ الحاجزين» | 1 / member_tx | fixed fields old → new; to pending + confirmed bookers of that event only |
| Withdrawn by the visitor, pending-DOB warning | E | — | — |

Dedupe: `book:<kind>:<bookingId>:<version>`; payments `pay:<paymentId>`; reminders `rem:<bookingId>:<stage>`; change notice `evt:<eventId>:<changeId>`.

### 4.3 Competitions and points (5B; rules in COMPETITIONS §20)

| Event | Model | Tier / class | Content |
| --- | --- | --- | --- |
| Submission received, awaiting manual grading, each grade change | E | — | «نقاطي» shows it |
| **Personal result** | A at the release moment, or B when it follows «اعتماد النتائج» | 2 / member_bulk, gradual | title; score/max **only when `resultShow` allows**; points credited (or «بدون نقاط» for guests); balance at send time; «لسه فيه أسئلة بتتصحح» when manual answers are pending; link to «نقاطي»; never answers or others' ranks |
| Manual points added after the result email | B (servant grading) | 2 / member_bulk | points added, new balance; one email per submission, merged over 24 h |
| Correction after the result email (regrade, void, wallet off) | B | 2 / member_tx | old → new points, balance; merged over 24 h; none when the net change is 0 |

Release moment, crediting and the visibility hold: COMPETITIONS §20. At most **one result email + one completion email per submission**, plus merged corrections. Dedupe `res:<subId>`, `res-done:<subId>`, `pts:<subId>:<ledgerSeq>` (window 24 h).

### 4.4 Points wallet and store (5B)

| Event | Model | Tier / class | Content |
| --- | --- | --- | --- |
| Manual points deducted | B | 1 / member_tx | amount, new balance, the note only if the admin ticked «يظهر للمخدوم» (new field) |
| Manual points added, duplicate transfer, season carry-over | E | — | — |
| Redemption requested | A | 2 / member_tx | item, cost, balance (a receipt: a stolen session that spends points is noticed) |
| Approved (= ready to collect) | B | 1 / member_tx | item, «استلمها من الخادم …» (servant name only) |
| Cancelled by an admin + refund | B | 1 / member_tx | item, points refunded, balance, public reason |
| Fulfilled; cancelled by the member | E | — | — |

There is no separate "ready for collection" status; `approved` carries that wording.

### 4.5 General (D5)

| Event | Channel |
| --- | --- |
| New competitions, events, announcements, scheduled reminders (store opens, competition closes, season ends) | **Push + bell only** (Apps Script schedule today, Worker in Phase 6). **No email.** |
| Urgent service announcement | Push + bell + site banner. **No email.** Booking-specific changes go through §4.2 «بلّغ الحاجزين». |

## 5. Budget and priority (D4)

One rolling-24h window (`notify_quota` hour buckets, shared with admin mail). Target `MAIL_DAILY_TARGET` 400 (configurable, ≤ 450, inside Gmail's ~500).

| Rank | Class | Reservation (setting) | Notes |
| --- | --- | --- | --- |
| 1 | `otp` | ~100 (`MAIL_RESERVE_OTP`) | may use **any** free room, including other reservations; nothing else may use its reserve |
| 2 | admin critical | 50 (`MAIL_RESERVE_CRITICAL`) | over the room: `deferred_quota` + push (existing, never expires) |
| 3 | `member_tx` | 100 (`MAIL_RESERVE_MEMBER`, new) | Tier 0–2 transactional |
| 4 | admin important | 120 (`MAIL_ADMIN_BUDGET`) | over: into the daily summary (existing) |
| 5 | `member_bulk` | remainder | age-out notices; drip `MAIL_BULK_PER_HOUR` (default 30). Results moved to `member_tx` in the accounts improvements, Step 3: as bulk they got only the 30 a day the reservations left |
| 6 | admin routine / summaries | remainder | |

Rule (replaces today's hard caps in `allowed()`): a send of class *c* is allowed when `total < target − Σ unused reservations of the classes ranked above c` (unused = reservation − sent in the window, ≥ 0); OTP checks only `total < target`. Reservations protect room; they never cap a class while room is free. The counters gain columns per class (`member_tx`, `member_bulk`, `admin`) and the `otp` counter is actually incremented (5A-1 migration; current production values 150/50 stay until then).

Expected load: 60–70 sign-ups/day × ~1.3 sends + recovery ≈ 90–100 OTP; member transactional usually < 50; one finalized competition of 150 → spread over ~5 h at 30/h.

## 6. D1 safeguards (admin-verified emails)

- **Entry confirmation:** the email is typed twice (no paste in the second field), shown back read-only with «اقرا الإيميل للشخص»; the admin ticks one confirmation method (`in_person_readback` | `member_typed` | `confirmed_by_whatsapp`), stored on `participant_audit.check_method`.
- Typo hints and the disposable-domain list apply to admins too.
- On save: `email_verified_at = now`, `email_verified_via = 'admin'`, `email_source = 'admin'`, audit `register.admin` / `email.change` (old → new in the private audit), `activity` row without PII.
- **Creation notice** (§4.1) to the new address: a wrong address learns only that an account exists and is told to contact support.
- Self-recovery (§10 of YOUTH-ACCOUNTS) works for admin-verified emails. The **first** successful recovery on one sends `recovery_used` to that address and a **critical** admin notification; it then becomes `email_verified_via = 'otp'` (possession proven).
- Kept from rev. 4: `participants.manage` for corrections, one email change per 7 days, old-address notice, «الإيميل اتغير من قريب» on store requests, critical notification on every support reset or email change.

## 7. Content and privacy

**Every member email:** Arabic RTL, HTML + equal plain text, the Azure Crest layout (§10), From `BRAND` of `templates.js` («أسرة البابا أثناسيوس الرسولي لشباب سفاجا» in the Azure Crest version), a stable subject per kind, at most one action link (to `stathanasiosyouth.github.io`, never `/admin/`, no shorteners, no tracking) plus the fixed footer links (support WhatsApp/email, privacy; social links only in booking notices), the support line, why the reader gets it, and for Tier 2–3 a «إعدادات الإشعارات» footer link to the account page (sign-in required, no token in the URL).

**Never in a member email:** passwords; OTP in the subject (or anywhere outside the code email); session or status tokens, `#b/<token>` links (every button opens the exact record, session-gated: [EMAIL-DEEP-LINKS](EMAIL-DEEP-LINKS.md)); InstaPay / wallet payment numbers or beneficiary details; proof images; servant phones; the member's phone, DOB or age; companions' names (a count only); the other address in an email-change notice; admin emails or names (say «الخدمة» / «الدعم الفني»; the configured support contact is the one exception), internal notes or reasons not marked public; competition answers, other people's scores or ranks; eligibility labels beyond «بدون نقاط».

## 8. Preferences

- Account page «إشعاراتي» (5A-2): per group (bookings receipts and reminders · results and points · store receipts · security extras) on/off for **Tier 2**, opt-in for **Tier 3**. Tier 0–1 are shown as always on.
- Stored in `member_prefs (participant_id, group, mode, updated_at)`. A muted row is written `suppressed` (kept for the audit), not deleted.
- No admin can change a member's preferences; support can only read them.

## 9. Delivery rules

- **Idempotency:** `dedupe_key` UNIQUE per kind (§4). A replayed request, a cron overlap or a Queue redelivery never sends twice; only a leased, unsent row is sent.
- **Expiry** (`expires_ms`): OTP 3 min after creation (the page offers «ابعت تاني»); Tier 0–1 72 h; reminders at the due date; results / completion 7 days; age-out at `leavesAt`. Expired rows are kept as `expired` and counted in monitoring. (Admin critical keeps «never expires».)
- **Retries:** existing backoff, dead after 5 → monitoring + a routine admin alert (not per row; at most one per hour).
- **Gmail down** (token health not ok, or quota): `register/start` checks health first and answers «مش قادرين نبعت الكود دلوقتي — جرّب بعد شوية أو كلّم الدعم الفني» without creating a pending row; admin creation stays available. Other member rows wait (`deferred`) within their expiry; in-app status stays the source of truth.
- **Abuse:** only OTP and forgot are member-triggered sends (YOUTH-ACCOUNTS §21.4 limits). Receipts are bounded: ≤ 10 member_tx receipts per account per day, the rest `suppressed`. Admin bulk actions (finalize, cancelAll, event change) use the drip.
- **Manual resend** (5A-3, C): `participants.manage` or `bookings.manage` may resend one Tier 1 email once per 24 h, logged; never an OTP.
- **Bounces:** not observable with `gmail.send` only; the sender inbox is checked weekly by the owner (runbook); a reported bad address is corrected by support (§6). No extra OAuth scope.
- **Monitoring:** «حالة النظام» shows member counts per class and status (sent / deferred / expired / dead / suppressed), next to the admin ones.

## 10. Templates (Azure Crest; build later, not in this plan)

Azure Crest (blue gradient header, gold line, floating white card, logo disc, icon set) is the approved direction for **every** service email, admin and member, and is already built in `templates.js` (staging only, §1). Images come from the public site (`assets/email/`), each decorative, with solid colours and a VML header for Outlook; no tracking pixels. New member templates extend that layout; they don't redesign it.

Requirements when wiring the existing templates:
- `bookingEmail` takes `b.url`: the exact booking for its signed-in owner (`#me/bookings/<ref>`, [EMAIL-DEEP-LINKS](EMAIL-DEEP-LINKS.md)), **never** a `#b/<token>` status link (refused since 2026-10-21).
- `bookingEmail` covers confirmed / pending / balance / cancelled; rejected, event cancelled, payment recorded / voided, due changed and payment-request kinds are added in the same layout.
- The support line is hard-coded (`SUPPORT*` constants); 5A reads it from `support_contact_id` (YOUTH-ACCOUNTS §11) so the email and the site show the same contact.

| Template | Dynamic data | Phase |
| --- | --- | --- |
| Code (verify / recovery) — exists (Azure Crest) | code, minutes | 5A-1 |
| Security notice — exists; add kinds `account_created`, `password_reset_support` | kind, Cairo time, device type | 5A-1 |
| Booking status — `bookingEmail` exists (confirmed, pending, cancelled); add rejected, event cancelled | ref, event title, date, places, people count, public reason | 5A-4 |
| Booking money (payment recorded / voided / due changed / fully paid / request received / rejected) | ref, event, amount, paid, remaining, due date, reason | 5A-4 |
| Deadline reminder | ref, event, remaining, due date | 5A-4 |
| Event change («بلّغ الحاجزين») | ref, event, changed fields old → new | 5A-4 |
| Result and points (+ completion, correction) | competition title, score/max when allowed, points, balance, pending flag | 5B |
| Store status (requested / approved / cancelled + refund) | item, cost / refund, balance, servant name, public reason | 5B |
| Points deducted | amount, balance, public note | 5B |
| Age-out notice | date | 5B |

## 11. Implementation placement

| Step | Adds | Done when |
| --- | --- | --- |
| 5A-1 | `member_outbox`, member catalog, switches, inline OTP path with health check, budget rule + counters (§5), expiry/supersede, verified-only recipient, D1 safeguards, Tier 0 notices on the existing Azure Crest templates | Worker tests + staging member-email rehearsal (§12) |
| 5A-2 | «إشعاراتي» preferences + footer link | e2e: a preference change stops that email |
| 5A-3 | Admin entry confirmation UI (existing components), manual resend, member rows in «حالة النظام» | e2e + staging resend check |
| 5A-4 | Booking and payment emails (§4.2), per-event reminder switch, «بلّغ الحاجزين» | staging booking/payment emails to test inboxes only |
| 5B | Competition crediting + visibility hold (COMPETITIONS §20), result / completion / correction, wallet and store emails, age-out | Worker tests + staging rehearsal (§12) |
| 6 | Channel policy: push for nudges, email for records; scheduled reminders on the Worker; platform-aware device registry + push payload (BACKEND-MIGRATION §22.2.4) | — |
| 7a | Member emails in the real-device audit (Gmail web/app, Yahoo, Outlook, images off, dark mode) | — |
| 9 | Native Admin + Youth apps (Capacitor + FCM) get the same push channel; Gmail scope unchanged (personal transactions only) | — |

## 12. Tests (added to YOUTH-ACCOUNTS §25 and the Phase 5 gates)

- No outbox row without its state change (failed batch → no row); superseded on a later state.
- Dedupe: replay, cron overlap, Queue redelivery → one email.
- Budget: OTP sends with every other reservation full; member_tx never takes the OTP reserve; reservations never block a class while room is free.
- Unverified / blocked / deleted account → nothing sent; Tier 2 muted → `suppressed`; Tier 0–1 ignore preferences.
- Result email never before the release moment; `resultShow = none` → no score; mixed competition → result + one completion; net-zero regrade → none.
- Content scan: no password, code outside the code email, token, payment number, phone, DOB or admin email in any rendered member email.
- Gmail token broken → `register/start` refuses before writing a pending row.
