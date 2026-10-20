# تغيير طريقة تسجيل المخدوم في المسابقة — Youth Account redesign (PLAN ONLY)

Rev. 4, 2026-10-20 (owner: **final, roadmap locked**). **Study and plan only.** Nothing here has been implemented, migrated, configured or deployed.

Rev. 4 (owner decisions, final):
- Still **Phase 5A**. No real legacy youth accounts exist: no migration, no claim flow.
- **6-digit email OTP** is used in exactly two self-service cases: **self-registration** (before activation) and **forgot password on a verified email**. Never for login, bookings, competitions, store, points, installment payments or any other everyday action.
- The system-generated 12-symbol password and the remembered sessions stay.
- **Authorized admins create accounts without OTP** and edit account data per the permission split (§12.2). Email verification state is separate from activation.
- **Primary Admin views any participant's current password at any time, unlimited, without changing it.** Viewing and resetting are separate actions (§12.3).
- **Recovery without a verified, reachable email = Technical Support only**, through the existing configurable WhatsApp support contact. No SMS, phone-based or other self-service recovery. Support can reset a password and give it privately by WhatsApp. **Plaintext passwords are never emailed** (§10, §11).
- Duplicate phone or email at registration is refused with a friendly message pointing to support (§16).
- **Account/booking age sync:** the signed-in account's DOB controls the booker's eligibility for future bookings (§18.1). Admin DOB corrections apply to future checks; existing bookings keep their snapshots.
- No verification gate before store orders (old decision §28 #3 retired).
- The email address is **`athanasius.youth.safaga@gmail.com`** (earlier revisions misspelled it).

Rev. 3 (owner decision): **every competition participant must have an account.**
- There is no anonymous or no-account competition mode. `participation: open`, `allowGuests`, the open form and `uniquePhone` are all retired.
- "Guest" is purely an **account eligibility state**, computed from the DOB and the age range currently set in Admin.

Rev. 2 applied the owner's answers to rev. 1:
- Guests may browse the Store.
- Points freeze after aging out.
- No child or parent-consent flow.
- **No legacy claim**: the system has not had real youth in production yet.
- A two-field email-first login.
- Account-existence messages, with protection against misuse.
- "Continue with the previous account" on the same device.
- Simpler email verification.

Code inspected:
- `origin/main` @ `f503d79`: Apps Script competitions, registry, wallet, store, seasons, age rules; the Worker foundation.
- `feat/worker-foundation` @ `e16f175`: the booking pilot on the Worker, with Turnstile, edit locks and phone retention.

Contracts read: `docs/COMPETITIONS.md` (§7, §8, §9, §17, §18, §19), `docs/BACKEND-MIGRATION.md` rev. 3, `worker/README.md`.

The local `feat/push` checkout is behind `origin/main`. Every file reference below is to `origin/main`.

---

## 0. Executive summary

Today's code-based registry already has most of the parts an account system needs:
- a stable participant id (`p-xxxxxxxx`);
- a secret stored as an HMAC hash plus an encrypted copy that admins can reveal (audited);
- an Egyptian phone normalizer;
- admin-configured age rules with a computed eligibility;
- "out of age ⇒ plays without points, can't redeem";
- an append-only points ledger keyed by participant id.

Because **no real youth have used it yet**, we don't migrate people. **We reuse the logic, not the data**:
- the account *is* the participant row, extended with email, a unique phone, a locked DOB, an eligibility override, a block state and a generated password;
- login is **email + generated password** («الباسورد بتاعك») from launch day;
- the code login is never ported to the Worker.

Key choices:
- **Every competition needs an account.** There is no anonymous or no-account mode. Each account is classified automatically from its DOB and the age range **currently configured in Admin** (never a hard-coded 30):
  - **eligible** (inside the range): plays, earns points, uses the Store normally;
  - **guest / خارج نطاق الخدمة** (outside the range): a normal account with the same email + generated-password login. Plays without points; the Store is view-only (§9).
- **Login UI:** one real two-field form (email + password, both always technically usable). The email is resolved first by a deliberate «متابعة» tap, so device password managers work everywhere (§8, §13).
- **Account-existence messages:** kept as you want them («مفيش حساب بالإيميل ده»). Protected by invisible Turnstile, D1 rate limits and uniform response timing (§8.4).
- **Same-device return:** a "continue with this account" card built from a still-valid session, or from a non-secret hint (first name + masked email). The password stays in the browser's password manager only. A «جهاز مشترك» option stores nothing (§8.5).
- **Guests** (an eligibility state of a real account, not an anonymous player):
  - can log in, play and **browse the Store**;
  - ordering and spending are locked;
  - no new points;
  - points earned earlier are **frozen**: kept and visible, not spendable while out of range (§9).
- **Where:** Worker + D1. Build it **inside Phase 5 as its first step (5A, "accounts-first registry")** instead of a separate Phase 5.5 after it. With no real participant data there is nothing to verify-equal and no code login worth porting (§27).
- **Rev. 4:** self-registration activates only after a 6-digit email OTP (§6); forgot password uses the same OTP on verified emails only (§10); everything else is OTP-free. Admins create and edit accounts without OTP (§6.5, §12). Support-only recovery otherwise (§11). Primary Admin can view the current password at any time (§12.3). Bookings take the booker's age from the account (§18.1).

---

## 1. Current system audit

### 1.1 What the participant code is today

| Aspect | Today (`CompRegistry.gs`, COMPETITIONS.md §7) |
| --- | --- |
| Identity | `Participants` row in the private competitions spreadsheet. `id = p-xxxxxxxx`, never changes |
| Code | `ATH-XXXX-XXXX`: 8 symbols from a 30-symbol alphabet with no 0/O/1/I/L/U, about 39 bits |
| Storage | `codeHash = HMAC-SHA256(code, CODE_PEPPER)` for lookup, plus `codeEnc` (encrypt-then-MAC with `CODE_KEY`) for the admin reveal. `codeVersion` increases on reset |
| What it represents | The whole credential: whoever holds the code *is* the participant. There is no username |
| Login | `compCode {code}` → «الكود مسجل باسم …» confirm → `pt1` token (HMAC, 3 h, bound to `codeVersion`) |
| Token storage | Competitions: `localStorage['athanasios.comp.v1:<slug>']`. «نقاطي»: `sessionStorage['athanasios.portal.v1']` |
| Brute force | Global budget of 60 wrong codes a minute, a ~300 ms pause |
| Reset / block | A reset gives a new code and `codeVersion + 1`, so every token dies. `inactive` stops the code |

### 1.2 How competitions authenticate

- `participation: open`: no identity; a form; `uniquePhone` limits by normalized phone.
- `participation: registered`: `compStart` needs a `ptoken`. Identity is never taken from typed text.
- `allowGuests` (§19.2) lets a person with no code play a registered competition through the open form. Their row has `participantId = ''` and they never earn points.
- Attempt tokens (`at1`) carry `p` and `cv`, so a reset or a block kills attempts in flight.
- **Rev. 3:** `participation: open`, `allowGuests`, the open-mode `fields` form and `uniquePhone` are **not carried into the new model**. Every attempt belongs to an account (§18).

### 1.3 Points, store, seasons

- `PointsLedger` is append-only and keyed by `participantId` + `seasonId`. Balance = Σ of the **active season's** rows.
- Points come from `walletReconcile_`: the best graded attempt per participant per competition, idempotent.
- `Redemptions` move pending → approved → fulfilled, or are cancelled with a refund. **Every redemption needs an admin to approve or fulfil it.**
- Seasons are closed into `SeasonTotals`.

### 1.4 Age / eligibility (already built, §19.3)

- `AGE_MIN` / `AGE_MAX` / `AGE_WARN_DAYS` are admin settings, currently 18 / 30 / 60. Nothing is hard-coded.
- Eligibility is computed from the DOB on every request: `ok | soon | out | unknown`. In the new model the DOB is required, so `unknown` disappears.
- An `out` participant can log in and see «نقاطي» with a notice. Their submissions are stamped `noPoints` at submit time and earn 0 forever. `shopRedeem` answers `not_eligible`.
- No public leaderboard exists. Ranking is only in the admin («النتائج»).

### 1.5 Phones

- `normPhoneEg_` (server) and `normPhoneEg` (admin) accept 01…, 1…, +20, 0020, 20, Arabic digits and separators. They store `+201XXXXXXXXX` and `phoneNorm = 1XXXXXXXXX`.
- Phones are **not unique** today: a shared phone is only a warning. **The new model makes them unique** (§16).

### 1.6 Admin and Excel

- Participants admin: list/search, add/edit, activate/deactivate, view/reset/export codes, bulk assign, import preview/apply/undo.
- `peopleBook` round trip by id; distribution files with the code message.
- Activity log: never a code or a phone.
- Roles: allowlist + **primary admin** (`ADMIN_PRIMARY`; D1 `admins.role = 'primary'`).

### 1.7 Infrastructure facts that shape the design

- Pages are on `stathanasiosyouth.github.io` and the API on `*.workers.dev`, so cookies would be third-party (Safari blocks them). **Sessions are bearer tokens.**
- The Worker already has:
  - D1 `rate_limits` with salted hashes;
  - idempotency keys and `activity`;
  - logs that never hold bodies, emails, IPs or tokens;
  - **Turnstile** (booking pilot, free);
  - Queues.
- Workers Free allows 10 ms CPU per request, so there is no slow password hashing (§21.2).
- Apps Script MailApp on a consumer account can send to 100 recipients a day.

### 1.8 Real data status (owner confirmation, rev. 2)

The competition, participant, points and store system **has not been used with real youth in production**. Whatever rows exist in the competitions spreadsheet (Participants, Submissions, PointsLedger, Redemptions, Seasons) are **test/demo data**.
- They are **not migrated as accounts**.
- They are archived once as an XLSX export for reference.
- Competition definitions, questions and store items are content, not identity. They follow the normal Phase 4/5 content path.

---

## 2. What we KEEP (reused as logic, not data)

- **`participants.id`** (`p-…`) as the one identity: account = participant. No second identity table.
- Ledger, seasons, `SeasonTotals`, redemptions, submissions, best-attempt reconcile and the store rules: unchanged in shape. They key on the participant id.
- Phone normalizer rules, DOB parser (`regBirthDate_`), age rules from admin settings, computed eligibility including `soon`.
- "Out ⇒ `noPoints` stamped at submit time, never revisited" and "out ⇒ `not_eligible` on redeem".
- The hash + encrypted-copy pattern, with an admin-only, audited reveal. The rule "never in lists, logs, URLs, push, activity".
- Credential versioning (`codeVersion` → `pw_version`): a reset kills every session and attempt.
- The competition engine itself: questions, scoring, result/answer policies, attempts, time limits, autosave, the scoring and wallet switches. Only the identity part changes (always an account).
- Excel export by id; activity-log conventions (no private data in `changes`).
- The 30-symbol readable alphabet and the rejection sampling of today's code generator, now used for passwords.

## 3. What we MODIFY

| Area | Change |
| --- | --- |
| Credential | **Email + generated password** («الباسورد بتاعك») from launch. No code login on the Worker |
| Participant row | + `email`, `email_canon` (UNIQUE), `email_verified_at`, `email_source` (self \| admin, rev. 4), **UNIQUE `phone_norm`**, **required and locked DOB**, `eligibility_override`, block fields, `pw_hash`, `pw_enc`, `pw_version` |
| Sessions | `pt1` 3 h → revocable server-side sessions (device: 30 days sliding; shared device: this tab only) |
| Public UI | Code screen → one two-field sign-in form, registration, forgot password, remembered-account card. Shared by `competition/` and `points/` |
| Competitions | **Every attempt needs a signed-in account.** The builder loses the «مفتوحة / بالأكواد» choice; presets keep only their scoring/result/wallet defaults; limits count per account |
| Store UI | Guest sees everything; order actions locked with an explanation; frozen balance shown |
| Admin | Person sheet: email (+ verified / admin-entered), phone, DOB, eligibility (+ override), frozen balance, block, view-password and reset (separate), corrections with reason, audit history, new-accounts review list |
| Excel | Export gains account columns; **no credentials**; distribution files and code export retired |
| Email | New: outgoing mail from `athanasius.youth.safaga@gmail.com`: registration OTP, recovery OTP, security notices. **Never a password** (rev. 4) |
| Wording | «الكود» → «الباسورد بتاعك» everywhere a participant sees it |

## 4. What is RETIRED (never ported to the Worker)

- Code login (`compCode`), the «الكود مسجل باسم …» confirm, and `pt1` tokens.
- `distributionFiles`, `codeMessage`, `apiParticipantCode(s)`, `apiParticipantResetCode(s)` and the code columns.
- **Every no-account competition path:**
  - `participation: open`;
  - `allowGuests` («السماح بالمشاركة بدون كود»);
  - the open-mode `fields` form (name/phone/age/church/group/custom);
  - the `uniquePhone` and `maxSubmissions`-by-phone identity;
  - the `guest` submission flag for rows with `participantId = ''`;
  - the `hp` honeypot on `compStart`, which moves to registration.
- The code-based participant import is replaced (decision §28 #7).
- The Apps Script registry module stays on Apps Script until Phase 5 retires it with everything else.
- **No legacy claim flow, no claim campaign, no sunset, no dual login.**

---

## 5. Final account architecture

```
Browser (GitHub Pages: /competition/<slug>/, /points/)
  assets/js/account/ : sign-in form · register · forgot · remembered-account card · session
  │  Authorization: Bearer <session token>   (localStorage on "my device", sessionStorage on "shared device";
  │                                           never the password)
  ▼
Cloudflare Worker  /v1/account/*  (public; invisible Turnstile; D1 rate limits; uniform timing)
  ├─ D1 participants (= accounts), account_sessions, pending_registrations, otp_codes, email_outbox,
  │      participant_audit, settings (age rules, switches)
  ├─ secrets: PW_PEPPER (hash), PW_KEY (AES-GCM, view), OTP_PEPPER (codes), TURNSTILE_SECRET, GMAIL_*
  ├─ Queue: email jobs (outside the request; retries; daily cap)
  └─ Gmail API (as athanasius.youth.safaga@gmail.com) → recipient inbox
Admin (/admin/, Google Sign-In)  /v1/admin/participants/*  (Phase 1.5 grants; view-password = Primary Admin only)
```

Rules:
- Every decision (identity, eligibility, points, store) is made on the server.
- One writer for identity: the Worker, from the day participants exist.
- No external identity integration of any kind. **There is no link to Fady Youssef's افتقاد app**: no API, no shared data, no import, no lookup. Suspicious details are checked by the owner manually, outside the system. The system only provides admin corrections (§12).

---

## 6. Registration flow

Entry: the sign-in form (§8) answers «مفيش حساب بالإيميل ده» → [إنشاء حساب جديد].

1. **Register view.** It replaces the sign-in form in place. Contents:
   - The email, carried over and shown as **text** with «تعديل», not as an input (§13.4).
   - Mobile: `type="tel"`, `autocomplete="tel"`, `inputmode="tel"`.
   - Full name: `autocomplete="name"`, 3 or 4 names (§6.2).
   - DOB as three selects: `bday-day`, `bday-month`, `bday-year`.
   - Honeypot field.
   - The same invisible Turnstile.
2. **Confirm step** (the DOB can't be changed later): «تاريخ ميلادك ١٢ مارس ٢٠٠٣ ورقمك ٠١٠… — صح؟» with [أيوه، اعمل الحساب] / [تعديل].
3. **[ابعت كود التحقق]** → `POST /v1/account/register/start`. The server checks, with UNIQUE indexes as the final guard later:
   - email shape, and `email_canon` unused;
   - a valid Egyptian mobile, and `phone_norm` unused;
   - duplicates get a friendly message pointing to support (§16.4);
   - name 3–4 parts;
   - DOB real, not in the future, age 5–100;
   - rate limits;
   - Turnstile.

   It then stores a **pending registration** (§6.7) and queues the OTP email from the verification reserve (§14). **No account row exists yet**, so nobody can reserve an email or phone they don't own.
4. **OTP view** (rev. 4): «بعتنالك كود من ٦ أرقام على name@example.com» + one input (`autocomplete="one-time-code" inputmode="numeric" maxlength="6" dir="ltr"`), [تأكيد], «ابعت الكود تاني» (after the cooldown), «تعديل الإيميل». → `POST /v1/account/register/verify { pendingId, code }`.
5. **Create** (only after a correct code, in one D1 batch; email/phone uniqueness re-checked by the UNIQUE indexes):
   - a new `p-…`, `status = active`, `dob_locked = 1`, `created_via = self`;
   - `email_verified_at = now`, `email_source = self`;
   - generate the password (§6.1): `pw_hash`, `pw_enc`, `pw_version = 1`;
   - `participant_audit` `register`, `activity` (no PII);
   - the pending registration is deleted.
6. **Eligibility** is computed now. Out of range ⇒ the account is still created, and the reply carries `eligible: false` (§9.2).
7. **"Here is your password" view.** It is a real login form, so the browser offers to save (§13.5):

   > أهلاً بيك يا {first name} ❤️
   > ده الباسورد بتاعك.
   > احتفظ بيه في مكان آمن لأنه هيكون وسيلة دخولك للمسابقات والنقط والمتجر والخدمات المرتبطة بحسابك.

   It has the password in large letters, [نسخ] and [احفظه وادخل]. That button submits email + password through the normal sign-in endpoint: the first real login, which creates the session.

### 6.1 Generated password format

- Format: **`XXXX-XXXX-XXXX`**, 12 symbols from `23456789ABCDEFGHJKMNPQRSTVWXYZ` (≈ 59 bits). Alternative: 10 symbols, decision §28 #2.
- Input is forgiving: case, dashes, spaces and Arabic digits are ignored. A password manager pastes it exactly anyway.
- Generated with `crypto.getRandomValues` + rejection sampling (values ≥ 240 skipped).

### 6.2 Name

- Store as typed (≤ 80) + `name_norm`.
- **3 or 4 names**, after joining compound prefixes «عبد / أبو» with the next word, so «عبد المسيح» counts as one name.
- 2 or fewer → «اكتب اسمك ثلاثي أو رباعي». 5 or more → «اكتب ٣ أو ٤ أسماء بس».

### 6.3 Phone and DOB

- Phone: Egyptian mobile only (`^1[0125]\d{8}$` after normalization), unique (§16). It is **not** a login username.
- DOB: required, locked after creation (§17.3).

### 6.4 Wording

| Old | New |
| --- | --- |
| «ادخل الكود بتاعك» | «سجّل دخولك بالإيميل والباسورد بتوعك» |
| «الكود» | «الباسورد بتاعك» |
| «الكود ده مش صحيح…» | «الباسورد مش صحيح. اتأكد منه وجرّب تاني.» |
| «المسابقة دي بالكود…» | «المسابقة دي محتاجة تسجيل دخول.» |

### 6.5 Admin-created accounts

Rev. 4: **authorized admins** (`participants.add`, §12.2) create an account in the admin **without OTP**, with the same fields and validation (name, unique phone, unique email, DOB).
- The account is **active at once** (`status = active`, `created_via = admin`).
- Its email is recorded as `email_source = admin`, `email_verified_at = NULL`. **Activation and email verification are separate**: an unverified email blocks nothing (login, competitions, points, store, bookings) except self-service password recovery (§10).
- The generated password is shown to the admin, who hands it over in person or privately by WhatsApp. The Primary Admin can view it later at any time (§12.3).
- The editor says «راجع الإيميل مع الشخص قبل الحفظ», because a mistyped email can't be used for recovery.
- No welcome or verification email is sent (OTP is self-service only).
- Audited `register.admin` (actor, no secret).
- An email becomes verified only through the self-registration OTP, so admin-entered emails stay unverified. Recovery for these accounts is always Technical Support (§11). The state is informational and never limits the account.

### 6.6 Email OTP (rev. 4: registration and verified-email recovery only)

| Rule | Value |
| --- | --- |
| Format | 6 digits, `crypto.getRandomValues` + rejection sampling; Arabic digits accepted on input |
| Storage | `HMAC-SHA256(OTP_PEPPER, purpose ‖ pendingId/participantId ‖ code)`; never stored or logged in plain text; constant-time compare |
| Expiry | 10 minutes; a new code cancels the previous one |
| Wrong tries | 5 per code, then the code is dead («الكود اتقفل، اطلب كود جديد») |
| Resend | after 60 s; at most 5 codes per email per day; per-IP 20 per hour; global cap (setting) with an admin alert |
| Bot protection | invisible Turnstile on every send |
| Email | short Arabic text: the code, its 10-minute life, «لو مش إنت اللي طلبت، تجاهل الرسالة». No links, no password |

Messages:
- «الكود غلط، فاضل لك X محاولات.»
- «الكود انتهى، اطلب كود جديد.»
- «استنى ٦٠ ثانية قبل ما تطلب كود تاني.»
- «وصلت للحد اليومي للأكواد، جرّب بكرة أو كلّم الدعم الفني.»
- «الرسالة ممكن تتأخر دقيقة؛ بص في Spam كمان.»

### 6.7 Pending registrations

- `pending_registrations` (§20) holds the validated form + the OTP hash for **30 minutes** at most, then is purged.
- One pending row per `email_canon` (a new start replaces the old one). It reserves nothing: uniqueness is enforced when the account is created.
- If someone else completes registration with the same phone or email first, verify answers with the duplicate message (§16.4).

---

## 7. Existing data (no account migration)

- **No claim flow.** No participant is converted, and no old code logs in.
- **Test/demo data** in the competitions spreadsheet:
  1. Export Participants, Submissions, PointsLedger, Redemptions and Seasons once to an XLSX archive (admin export; kept privately by the owner).
  2. Don't copy them into D1.
  3. The spreadsheet tabs are frozen with the rest of Sheets in Phase 7.
- **Content that is kept**: competition definitions, questions, store items, store schedule and age settings. This is not identity data. It moves with Phase 4/5 content (drafts → D1). A store item's `stock` starts with no redemptions.
- **If a demo account is wanted on staging**, it is created fresh with the new model (fixture script), never converted.
- **One condition keeps this true** (decision §28 #1): competitions must not be opened to real youth on today's code-based system before accounts ship. Otherwise real legacy data would exist again and a claim step would be needed after all.
- Today's no-account competitions on Apps Script leave no identities to migrate. But they are **not part of the new model**: at account launch, every competition requires an account.

---

## 8. Sign-in flow and login UX

### 8.1 The form

One real form, used by every page that needs an account:

```
┌──────────────── سجّل دخولك ────────────────┐
│ الإيميل        [ name@example.com        ] │  type=email  autocomplete="username"
│ الباسورد بتاعك [ ••••••••••••       👁  ] │  type=password autocomplete="current-password"
│                 (اكتب الإيميل الأول ودوس متابعة)  ← hint while the email is unresolved
│ [ متابعة ]          ← label becomes «دخول» once the password field has a value
│ نسيت الباسورد؟                           │
│ ☐ ده جهاز مشترك (متفتكرنيش هنا)            │
└──────────────────────────────────────────────┘
```

### 8.2 States and the single submit rule

**Both fields are always enabled and editable.** The email-first guidance is visual, not a technical lock (§13.2 explains why).

| State | Look | What the submit does |
| --- | --- | --- |
| **Start** | Email focused. The password field is visible and de-emphasized (muted label, hint «اكتب الإيميل الأول») | — |
| Submit with **email only** | — | `POST /v1/account/signin { email, turnstile }` → discovery |
| ↳ account exists | The password field is emphasized and focused; hint «أهلاً بيك تاني — اكتب الباسورد بتاعك» | Waits for the password; the password manager may fill it now |
| ↳ no account | The password field collapses (the form stays). Message: «مفيش حساب بالإيميل ده.» + [إنشاء حساب جديد] [جرّب إيميل تاني] | → registration (§6) |
| Submit with **email + password** (typed, or autofilled together) | — | `POST /v1/account/signin { email, password, turnstile }` → **login directly**. No separate discovery round trip |
| ↳ right | Session; the form is replaced by the next screen (§13.5) | — |
| ↳ wrong password | «الباسورد مش صحيح. اتأكد منه وجرّب تاني.» + «نسيت الباسورد؟» | — |
| ↳ no account | Same as "no account" above | — |
| ↳ blocked (after a correct password only) | «الحساب ده موقوف. كلّم الخدمة.» | — |

This keeps your intent:
- two fields from the start;
- email-first discovery;
- the user is told whether the email has an account.

It also never blocks a password manager that fills both fields at once. That is the most common case for returning users, and it then takes **one** request.

### 8.3 When the email check runs

- Only on a **deliberate action**: the «متابعة» button or Enter in the email field.
- Optionally also when the password field is focused while the email is valid and not yet resolved (the user has moved on). One request, never repeated for the same email.
- **Never** on each keystroke, never debounced while typing, never on blur.
  - Blur fires when a password-manager sheet opens, when the keyboard closes on mobile, and when the user taps «نسيت الباسورد؟». It would make surprise requests and spend rate-limit budget.
- Client-side shape check first (no request for `abc@`).
- The last answer is cached per email in memory, so going back and forth costs nothing.
- While waiting (typically 0.1–0.4 s), the button shows a spinner. The fields stay editable. If the email changes, the stale answer is ignored.

### 8.4 Account existence: risk and protection (requirement kept)

**Risk.** Telling a visitor «مفيش حساب بالإيميل ده» (and, in registration, «رقم الموبايل ده مستخدم») lets anyone test whether an email or phone belongs to the service.
- Here that is more sensitive than usual: an account implies **membership of a church youth service**, and religious affiliation counts as sensitive personal data under Egypt's data-protection law (No. 151/2020).
- Abuse looks like a bot running a list of emails or phones.
- Wrong-password messages leak nothing extra once existence is shown, so being explicit there is fine.

**Safest way to keep the UX:**
1. **Invisible Turnstile on every `signin`, `register` and `forgot` call.** It is free and already used by the booking pilot. Managed/invisible mode, so most people see nothing.
   - The token is fetched when the form appears and refreshed after each use, so it adds no visible delay.
   - A bot without a valid token gets `{ ok:false, code:'verify' }`; the widget then shows an interactive check.
   - The session-continue path (§8.5) needs no Turnstile.
2. **D1 rate limits** (§21.4). Discovery: 10 per 10 min and 40 per day per IP. Global: 400 a day, with an admin push at 50%.
3. **Uniform replies.**
   - The existing and missing branches run the same query and the same HMAC work (a dummy hash when there is no account).
   - Responses are padded to a fixed minimum (~300 ms), so timing doesn't reveal the answer either.
   - The reply never includes a name, masked phone or any other data, only `exists: true|false`.
4. **No existence signal anywhere else.** «نسيت الباسورد» always answers the same neutral sentence (§10). The admin-only views are behind Google Sign-In.
5. **Monitoring.** Daily counts of discovery calls and "no account" answers per salted IP. The admin sees a warning when one source tries many emails.

**Recommended exact behaviour:**
- Explicit «مفيش حساب بالإيميل ده» and «رقم الموبايل ده مستخدم بالفعل في حساب آخر.», as you asked.
- Explicit «الباسورد مش صحيح».
- All of them only behind Turnstile + limits + uniform timing.
- This is proportionate for a small youth service. The generic-message alternative would weaken the UX you want for little real gain.

### 8.5 "Continue with the previous account" on the same device

**What we remember, and where:**

| Item | Where | Secret? | When |
| --- | --- | --- | --- |
| Session token (random, 256 bit; D1 stores only its hash) | `localStorage['athanasios.account.v1']` (my device) or `sessionStorage` (shared device) | yes: a bearer token, but **not** the password; revocable, expires | after a login |
| Account hint `{ firstName, email, lastUsedAt }`, up to 3 accounts (siblings sharing a phone or tablet) | `localStorage['athanasios.account.hints.v1']` | no (personal but not a credential) | after a login on "my device" only |
| The password | **only in the browser's or OS's password manager** | — | when the user accepts the save prompt |

**Card on a later visit** (competition or Store), when a hint exists:

> هل تريد المتابعة بالحساب الذي استخدمته سابقًا؟
> **مينا** · m•••a@gmail.com
> [متابعة] [استخدام حساب آخر] [✕ انسَ الحساب ده على الجهاز ده]

- [متابعة] when **the session is still valid**: the Worker confirms it (`GET /v1/account/me`), and the user continues at once. No password, no typing.
- [متابعة] when **the session has expired or was ended**: the sign-in form opens with the email prefilled (in the `autocomplete="username"` field) and the password focused. The password manager offers to fill it (Chrome/Android: one tap; iPhone: the Passwords suggestion above the keyboard).
- [استخدام حساب آخر]: the empty sign-in form. Hints stay.
- [✕]: deletes that hint (and its session if it is the current one) from this device.

**Masking:** yes, on the card. Show the first name + `first letter•••last letter@domain`. The full email is used only to prefill the field after the person taps [متابعة].
- Rationale: a passer-by on a shared family tablet sees less.
- The name is the first name only, never the full four-part name.

**Logout and forgetting:**

| Action | Session (server + device) | Hint | Saved password in the browser |
| --- | --- | --- | --- |
| «خروج» | ended | **kept** (fast return) | untouched |
| «خروج وانسَ الجهاز ده» (in the account menu) | ended | deleted | untouched (the browser owns it; the menu says so) |
| ✕ on the card | ended if it was that account | deleted | untouched |
| Password reset / email change / block | **all sessions ended** on every device | kept; next «متابعة» asks for the new password | the browser offers to update on the next login |

**Shared devices:** the tick «ده جهاز مشترك (متفتكرنيش هنا)» on the sign-in form:
- the session goes to `sessionStorage` (gone when the tab closes) and is shorter (12 h);
- **no hint is stored**;
- the save-password prompt can't be suppressed by the site; the hint text says «لو مش جهازك، متحفظش الباسورد».

**Why not a browser-standard alternative?**
- Credential Management `navigator.credentials.get({ password: true })` can show a native account chooser, but only in Chrome/Edge. Safari and Firefox lack `PasswordCredential`, and it needs the password to be stored through the API first.
- So a small non-secret hint + the session token is simpler and works the same everywhere. Credential Management is used only for the optional `store()` call (§13.6).

---

## 9. Guest / out-of-age flow and the points lifecycle

### 9.1 Effective eligibility (recomputed, never corrupting history)

```
effective =
  blocked                           → 'blocked'
  eligibility_override = 'guest'    → 'guest'      (primary admin forced, with reason)
  eligibility_override = 'eligible' → 'eligible'   (primary admin forced, with reason)
  else from DOB + the CURRENT admin age settings, on today's Cairo date:
       min ≤ age ≤ max → 'eligible'  ('soon' sub-state when the (max+1)th birthday is within warnDays)
       otherwise       → 'guest'     (too young or too old)
```

- **Only two classes exist**, and both are real accounts with the same login:

  | Class | Rule (with today's Admin range 18–30 as the example) | Competitions | Points | Store |
  | --- | --- | --- | --- | --- |
  | **eligible** | age inside the configured range (e.g. 18–30) | participate | earn | normal rules |
  | **guest / خارج نطاق الخدمة** | age outside the configured range (e.g. 17 or 31) | participate | none | view-only; orders and spending locked |

  - There is no "unknown" class (DOB is required) and no anonymous class (§18).
  - The numbers always come from the **current Admin settings** (`age_min`, `age_max`). If Admin changes the range to 18–32, a 31-year-old becomes eligible at once, with no code change.
- Computed on **every request** (cheap: a date comparison). Nothing is stored as "current eligibility", so nothing goes stale. Aging out happens by itself on the (max+1)th birthday. Changing the admin settings takes effect at once.
- **History is protected by snapshots.** Every decision that uses eligibility stamps the result on its own row, and later recalculations never rewrite it:
  - submission: `elig` (`eligible`/`guest`) + `noPoints` + the rule values used (`age_min`, `age_max`) at submit time;
  - redemption: `elig = eligible` at order time (only eligible accounts can order).
- So a later DOB correction or settings change affects **future** submissions and orders only.
- Wallet reconcile (regrade, void, review) keeps using the submission's own stamp. A submission made while eligible still earns after its owner ages out, and one made as a guest never earns.

### 9.2 At registration (out of range)

The account is created normally, with `eligible: false`, and the screen says:

> حسابك اتعمل بنجاح، لكن سنك خارج النطاق العمري للخدمة، لذلك تقدر تشارك في المسابقات كضيف بدون احتساب نقاط.

Then the "here is your password" view as usual.

### 9.3 Guest capabilities (decided)

| Feature | Guest |
| --- | --- |
| Register, log in, reset password, continue on device | ✓ |
| Play every competition (all are account-only); see results/answers per the competition's policy | ✓ (attempt recorded under their id) |
| Earn competition points | ✗ (submission stamped `noPoints`) |
| Open and browse the Store: items, rewards, required points, stock, normal presentation | ✓ |
| Redeem, place an order, spend or cancel-for-refund | ✗ (locked in the UI; refused by the server with `not_eligible`) |
| See their balance and ledger history | ✓ (shown as frozen, §9.4) |

### 9.4 Points lifecycle and the FROZEN state

```
 eligible ──(ages out / admin marks guest / DOB corrected out)──► guest
    ▲                                                              │
    └──(admin override eligible / DOB corrected in / settings widened)─┘
```

| State | Earn new points | Spend (redeem) | Balance & history |
| --- | --- | --- | --- |
| eligible | ✓ | ✓ | visible |
| guest with balance > 0 ⇒ **frozen** | ✗ | ✗ | **kept, visible to the participant and the admin, never deleted** |
| guest with balance 0 | ✗ | ✗ | visible |

- **Frozen is derived, not stored**: frozen = `effective = guest` AND balance > 0. No ledger row is written when someone ages out, so nothing has to be undone if they become eligible again (an admin correction or wider settings). The same balance simply becomes spendable again. This is the natural meaning of "frozen, not deleted".
- **Seasons still apply.** The balance is the active season's (existing rule). At season close a frozen balance is written into `SeasonTotals` like anyone's, and the next season starts at 0 for everyone. Frozen points are never carried over automatically. The admin's existing manual `transfer` can do it if ever wanted.
- **Store orders that already exist when someone ages out:** decision §28 #5 (recommended: honour them).
- Admin views show a «متجمد» badge and the amount. Season-close previews show frozen balances separately.

### 9.5 Store UX for guests

- A banner at the top of the Store: «حسابك خارج النطاق العمري للخدمة، فتقدر تتفرج على المتجر بس الطلب مقفول.»
- Balance card: «رصيدك: ١٢٠ نقطة — متجمد» with a «ليه؟» link to a short explanation sheet («النقط اللي جمعتها محفوظة، بس مش هتقدر تستخدمها طول ما سنك خارج النطاق العمري للخدمة. لو بياناتك غلط، كلّم الخدمة.»).
- Each item renders normally (picture, name, description, points, stock, per-person limit). The order button is replaced by a **locked chip** «الطلب مقفول 🔒». It is a real `<button aria-disabled="true">` that opens the same explanation, not a dead `disabled` button, so a tap gives feedback.
- Reason priority: guest lock first, then store closed or preview, then stock, then insufficient balance. A guest never sees «رصيدك مش كفاية».
- The server enforces it regardless: `shopRedeem` and `shopCancel` refuse `not_eligible`. `portalMe` returns `eligible:false`, `frozen:true|false` and `lockReason`.

### 9.6 "Guest" means one thing only

- «ضيف / خارج نطاق الخدمة» is an **account eligibility state**: a registered person with a DOB outside the configured range. They sign in with email + generated password like everyone else.
- There is **no anonymous guest and no "play without an account"** (rev. 3). The rev. 2 split between "age-guest" and "no-account player" is removed, and so is the wording «من غير حساب».

---

## 10. Forgot password

Rev. 4: **6-digit email OTP, for verified emails only** (replaces the rev. 2 confirm link; the "nothing changes before verification" rule is kept).

1. «نسيت الباسورد؟» → the email (prefilled from the form) + invisible Turnstile → `POST /v1/account/forgot`.
2. The reply is **always the same**, and the support contact is always visible under it: «لو الإيميل ده متأكد وعليه حساب، هيوصلك كود من ٦ أرقام خلال دقايق. مش واصلك؟ كلّم الدعم الفني.»
3. A code (§6.6) is sent **only if** an account exists, is not blocked, **has `email_verified_at` set**, and is within limits. Otherwise nothing is sent and no email budget is spent (unverified, unknown or blocked emails → the same neutral reply; the person contacts support, §11).
   - **Nothing changes yet.** The old password still works, so someone who only knows the email cannot force resets on a victim.
4. The OTP view (same as §6, step 4) → `POST /v1/account/forgot/verify { email, code }`. A correct code:
   - generates a **new password** (`pw_hash`, `pw_enc`);
   - `pw_version + 1`, which kills the old password, every session and every attempt in flight;
   - shows the password in the "here is your password" login form (§13.5), so the browser offers to update it;
   - **never emails the password**;
   - audit `password.reset.self`.
5. Points, history, Store and id: untouched.

Limits:
- 5 codes per email a day, resend after 60 s, 5 wrong tries per code (§6.6);
- 10 requests per IP an hour;
- codes expire after 10 min;
- a newer code cancels older ones.

## 11. Lost-email / support flow

Rev. 4 (owner, final): **Technical Support is the only recovery path** when the email is not verified, not reachable, the OTP doesn't arrive, or the account is lost. There is **no SMS OTP, no phone-number confirmation, no phone-based or other self-service recovery**.

1. **Technical Support** = the **existing support/admin WhatsApp contact stored in the database**, chosen in Admin settings (`support_contact_id` → the site contacts registry). It is shown under the sign-in form («مش قادر توصل للإيميل بتاعك؟»), the forgot-password reply, the OTP limit message and the duplicate-registration message (§16.4). There is **no** automatic transfer.
2. A support admin with **`participants.manage`** verifies the person **manually**, person to person: known in person, or name + DOB + group match the account, or a call/WhatsApp **from support** to the number already on the account. This is a manual identity check by support, not a self-service method. The **check used** (in person / details match / support call) is a required field in the audit.
3. Support actions on the **same account**:
   - **Reset the password**: a new generated password, `pw_version + 1`, all sessions revoked. Support gives it **privately by WhatsApp** (or in person). It is **never emailed**.
   - **Correct the email** (optional): the new email must be unused; it is stored as `email_source = admin`, unverified (§6.5).
   - Reason + check method required for each.
4. If the old email was verified, it gets «تم تغيير الإيميل المرتبط بحسابك. لو مش إنت، كلّم الدعم الفني فورًا.» (notice only, no link, no password).
5. Same id, points, history and Store data.

Safeguards against support-assisted theft:
- `participants.manage` only (default: primary admin; grantable, §12.2);
- reason + check method required and audited (old and new values in the private audit);
- at most one email change per account per 7 days unless the primary admin overrides;
- the old-email notice;
- a «الإيميل اتغير من قريب» warning on that account's Store requests for 7 days;
- a **critical** notification to the Primary Admin on every support reset or email change.

---

## 12. Admin control and password reveal (decided: primary admin has full access)

### 12.1 Person sheet

- Name, email (+ verified badge), phone, DOB (+ age), **eligibility**: effective state + source (auto / forced guest / forced eligible) + `soon` warning.
- Status (active / blocked + reason); created via (self / admin).
- Points: balance (+ «متجمد» when frozen), season totals, ledger. Competition history (with each submission's `elig` stamp). Store requests.
- Sessions: count and last seen (device label only), with «اخرج من كل الأجهزة».
- **Audit history** (`participant_audit`): who changed what, when and why.

### 12.2 Actions

Rev. 4: permissions use the Phase 1.5 grants (`participants` module; BOOKING-PHASE1-COMPLETION-PLAN §4.3). No admin action needs an OTP.

| Action | Who | Requirements |
| --- | --- | --- |
| View the full sheet | `participants.view` | — |
| **View the current password** | **Primary Admin only** | **Any time, unlimited, never changes it** (§12.3). Logged |
| Create an account without OTP (§6.5) | `participants.add` | same validation as registration; password shown once to the creator |
| Edit profile: name, group, church, servant, notes | `participants.edit` | reason for name changes; old → new in audit |
| Correct email / phone | `participants.manage` | reason; uniqueness; email becomes unverified (`email_source = admin`); sessions revoked; old-email notice when it was verified; critical notification |
| **Correct DOB** (participants can never change it) | `participants.manage` | reason; old → new in audit; eligibility (points, store, **future** bookings) recomputed for the future only; past submissions, orders and bookings keep their snapshots; critical notification |
| Eligibility override: guest / eligible / auto | `participants.manage` | reason |
| Reset / generate a new password | `participants.manage` | reason; kills sessions; the new password is shown to that admin once and can be given privately by WhatsApp; never emailed. **Separate from viewing** |
| Emergency block | `participants.edit` or higher | reason; revokes sessions at once; critical notification |
| Unblock | `participants.manage` | reason |
| Duplicate person found | `participants.manage` | block the duplicate + move points with the existing `transfer` adjustment (both rows audited). No merge tool in v1 |

`participants.manage` defaults to the Primary Admin only; the Primary Admin can grant it. Every action writes `participant_audit` (actor, reason, old → new; never a password) and an `activity` row without personal data.

### 12.3 Reveal design (encrypted copy, not plain text)

**Storage:**
- `pw_hash = HMAC-SHA256(PW_PEPPER, normalized password)`, used for login.
- `pw_enc = AES-256-GCM(PW_KEY, password)` with a random 96-bit IV and associated data = `participant_id ‖ pw_version`. A ciphertext can't be moved to another row.

**Keys:** `PW_PEPPER` and `PW_KEY` are **Worker secrets**, never in D1, git, backups or logs. Backups therefore hold only hashes and ciphertext.

**Why this supports "view at any time" (rev. 4, owner final):** every password the system issues (self-registration, admin creation, self-service reset, support reset) is written as `pw_hash` **and** `pw_enc` in the same batch, so the **current** password is always decryptable. Viewing reads and decrypts `pw_enc`; it writes nothing to the credential, never bumps `pw_version` and never ends sessions. Viewing and resetting are **separate actions, separate buttons, separate endpoints**.

**Endpoint:**
- `POST /v1/admin/participants/:id/view-password` (Primary Admin only; a valid admin session; reason optional). **No rate limit and no count limit.** Reply `Cache-Control: no-store`.
- Reset is a different endpoint (`/reset-password`, `participants.manage`, reason required).
- The admin modal shows the password with [نسخ]; it clears when closed (and after 60 s idle) and never stores the password in caches, IndexedDB, lists, URLs or history.

**Logs (auditing kept; no secret ever logged):**
- an `activity` row `password.view` (actor, participant id);
- `participant_audit` row (with the reason when given).
- No push for the Primary Admin's own views (they are the only viewer).

**Honest trade-off:**
- Anyone who obtains **both** the D1 data and `PW_KEY` (for example a full Cloudflare account takeover) could read every password. Hash-only storage would not allow that.
- Accepted by the owner because:
  - passwords are generated and used only on this site (no reuse elsewhere);
  - Cloudflare 2FA with two owners;
  - viewing is limited to the Primary Admin and every view is logged.
- `PW_KEY` rotation (re-encrypting every `pw_enc`) is a runbook step, not a v1 feature.

---

## 13. Password manager / autofill implementation

Credentials are saved per origin. `github.io` is on the Public Suffix List, so they are scoped to `stathanasiosyouth.github.io` and work on every path (`/competition/<slug>/`, `/points/`).

### 13.1 Exact markup semantics

| Form | Field | Attributes |
| --- | --- | --- |
| Sign-in | email | `type="email" name="email" id="acct-email" autocomplete="username" inputmode="email" autocapitalize="off" spellcheck="false" dir="ltr" required` |
| Sign-in | password | `type="password" name="password" id="acct-password" autocomplete="current-password" dir="ltr"` + show/hide toggle |
| Register | phone | `type="tel" autocomplete="tel" inputmode="tel" dir="ltr"` |
| Register | name | `autocomplete="name"` |
| Register | DOB | `<select autocomplete="bday-day">`, `bday-month`, `bday-year` |
| Register | email | **shown as text, not an input** |
| Register | password | **none** |
| Password reveal ("here is your password") | email | `type="email" autocomplete="username" value=<email>` (visible, editable but prefilled) |
| Password reveal | password | `type="password" autocomplete="current-password" value=<generated>` + show/hide (shown by default) + [نسخ] |

Rules:
- Real `<form>` elements with a real `<button type="submit">`; JS handles `submit` + `fetch`.
- Stable `name` and `id` values.
- **Never** `autocomplete="off"`. **No** `new-password` anywhere (§13.4).
- No password in `localStorage`, `sessionStorage`, IndexedDB or URLs.

### 13.2 Disabled vs readonly vs usable: the technical answer

- **`disabled` hurts autofill.** Chrome's password manager only fills fields that are enabled and not read-only (Chromium `IsElementEditable`: `isEnabled() && !isReadOnly()`).
  - Disabled fields are also left out of form data and skipped by iOS AutoFill.
  - Picking a saved credential from the email dropdown would then fill only the email. The user would have to come back and fill the password separately: the exact friction we want to remove.
- **`readonly` is not better for filling.** The same Chromium check excludes it. Chromium also historically did not *save* from readonly password fields. On iOS a readonly field doesn't open the keyboard or the AutoFill bar.
- **Recommendation: both fields stay fully usable**, and the email-first flow is guided visually:
  - the password field is muted, with the hint «اكتب الإيميل الأول»;
  - the submit-label rule in §8.2 does the rest.
  - If someone (or their password manager) fills the password early, that is simply the fast path.
- Your visual intent is kept: two fields visible from the start, the email first, the password "not yet". Only the technical lock goes.

### 13.3 Why one form and not two steps for detection

- Password managers recognise a form with a `username` + `current-password` pair best.
- Identifier-only screens are a known weak spot. Some managers neither fill nor save there, and iOS suggests the saved password only when a password field is on screen.
- Keeping both fields in one form from the beginning avoids the weakness entirely, and needs no hidden-username tricks.

### 13.4 Registration without confusing saved-login autofill

- The register view has **no username or password inputs**: the email is plain text, and there is no password field. Saved-login suggestions therefore don't appear on it. Phone, name and DOB get ordinary contact autofill (`tel`, `name`, `bday-*`), which is helpful.
- **No `autocomplete="new-password"`.** In Chrome and Safari it triggers the browser's own "suggest strong password" generator. If accepted, the browser would save a password our server never issued.
- The generated password is presented in a normal **sign-in** form (`current-password`) and submitted as a real login. To the browser, this is "the user signed in with these credentials", which is exactly what it should save.

### 13.5 Making the browser save after a JS (fetch) login

After a successful `signin` reply:
1. If `window.PasswordCredential` exists (Chrome, Edge, Android Chrome), call `navigator.credentials.store(new PasswordCredential({ id: email, password, name: firstName }))`. This shows the save/update prompt explicitly.
2. Then **replace the form**: remove it from the DOM and render the next screen (+ `history.replaceState`).
   - Chrome treats "the form disappeared after a successful request" as a successful login.
   - Safari/iCloud Keychain and Firefox prompt on the real form submit.
3. Never clear the password field before step 2, because some managers read the value at that moment.

### 13.6 Is the Credential Management API useful?

- `store()`: **yes, as a small progressive enhancement** (about 5 lines; reliable save prompts in Chrome-family browsers).
- `get()` (auto sign-in / native account chooser): **no**. It is Chrome-family only, and the session token + remembered-account card already cover "continue" everywhere.

### 13.7 Expected behaviour by platform

| Platform | Sign-in | After registration / reset |
| --- | --- | --- |
| Chrome desktop / Edge | Dropdown on the email field; choosing an account fills **both** fields → one tap «دخول» | `store()` prompt «حفظ الباسورد؟»; update prompt after a reset |
| Android (Chrome, installed PWA; Google Password Manager / Android Autofill) | Tap the email → account suggestion → both filled (Chrome fills on account select) | Save prompt; synced to the Google account |
| iPhone Safari / home-screen app (iCloud Passwords) | Passwords suggestion above the keyboard on the email or password field; Face ID fills both | «Save password?» sheet after the form submit |
| Firefox | Lock-icon dropdown, fills both | Save doorhanger on submit |

Always available: the [نسخ] button and the visible password, as a fallback when a prompt doesn't appear.

### 13.8 Notes

- `/.well-known/change-password` → `/points/#forgot` is optional and low value; skip it in v1.
- If the site ever moves to a custom domain (the optional custom-domain step, BACKEND-MIGRATION §18), saved passwords and hints don't follow. Everyone logs in once by hand. Add this to the domain decision.

---

## 14. Email sending architecture (`athanasius.youth.safaga@gmail.com`)

Re-checked for rev. 2. No materially better free option was found.

| Option | Free limit | Verdict |
| --- | --- | --- |
| **Gmail API from the Worker** (OAuth refresh token of the youth account, scope `gmail.send`) | Consumer Gmail ~500 recipients/day (vendor-documented; Google publishes no exact API figure) | **Recommended.** No Apps Script, fits the final architecture. The OAuth app must be **"In production"** (Testing-mode tokens expire after 7 days). The token is revoked if the account's password changes, so monitor it |
| Apps Script MailApp in a small project owned by the youth account | 100 recipients/day | Fallback only. Contradicts the Apps Script exit |
| Cloudflare Email Service | Workers Free: only to verified addresses; needs a domain | ✗ |
| Third-party free tiers sending as `@gmail.com` | — | ✗ (fails DMARC alignment → spam) |

**Flow:**

```
handler → INSERT email_outbox → Queue job → daily cap check → build Arabic text + simple HTML →
OAuth token (cached ~1 h) → gmail.users.messages.send → sent / retry with backoff / dead-letter after 5
```

**Our own caps (rev. 4, owner final):**
- The shared daily total (admin notifications + account mail) is a **configurable target of ~400/day**, always within Gmail's real limit (~500). Overflow of non-critical mail waits for the next window and the admin sees it.
- **Reserves:** the existing critical-notification reserve (BOOKING-PHASE1-COMPLETION-PLAN §4.4) and a separate **verification-code (OTP) reserve**, so registrations at a youth meeting never starve critical admin mail, and the reverse.
- OTP mail is sent at once (highest queue priority after critical); per email ≤ 5 codes a day (§6.6).

**Content:**
- Arabic, short, links only to `stathanasiosyouth.github.io`, no shorteners. OTP emails carry no link at all.
- A stable subject per kind, and a monitored `Reply-To`.
- The outbox never stores bodies, codes or passwords. **No email ever contains a password** (rev. 4).

**Volume (no claim campaign):** registrations come in bursts at youth meetings, about 1 email per new account (the OTP; more on resend). Admin-created accounts send none. Hundreds a day at most on launch day, normally a handful. If a burst would exceed the OTP reserve, the message «وصلت للحد اليومي للأكواد… كلّم الدعم الفني» appears and admins can still create accounts without OTP (§6.5).

## 15. Email verification (rev. 4, final)

Free and reliable through the same Gmail path. No SMS.

**Rules:**
1. **Self-registration:** the 6-digit OTP (§6.6) verifies the email **before** the account exists; the account is created verified (`email_source = self`).
2. **Admin-created accounts:** created without OTP and active at once; the email stays unverified (`email_source = admin`). Activation and verification are separate (§6.5).
3. **Verification gates nothing in everyday use**: no OTP and no verification check for login, bookings, competitions, store orders, points or installment payments. (The rev. 3 "verified email before the first Store order" rule, old §28 #3, is retired.)
4. The **only** thing that depends on verification is self-service password recovery (§10). Unverified accounts recover through Technical Support (§11).
5. The person sheet shows «متأكد» / «اتسجل من الأدمن — مش متأكد».

**Also:**
- domain-typo hints (`gmial.com` → «قصدك gmail.com؟»);
- a small static disposable-domain block list (self-registration only).

---

## 16. Phone and email normalization / uniqueness

### 16.1 Phone

- Reuse `normPhoneEg_` exactly (ported to the Worker).
- `phone_norm = 1XXXXXXXXX`; display `01XXXXXXXXX`.
- `01xxxxxxxxx`, `+201xxxxxxxxx`, `00201xxxxxxxxx`, `201…`, `1…`, `+20 01…`, Arabic digits and separators are all the **same number**.
- `CREATE UNIQUE INDEX participants_phone ON participants(phone_norm)` across **all** accounts. There are no legacy exemptions, because there is no legacy data.
  - The index is the final guard against simultaneous registrations; D1's single writer makes it exact.
- Message: §16.4.
- Egyptian mobiles only. The phone is not a username, and never a recovery method (rev. 4).

### 16.2 Email

- `email` = as typed and trimmed (used for sending).
- `email_canon` (UNIQUE):
  - lower-case, NFC, IDN domain → punycode;
  - **gmail.com / googlemail.com**: dots and `+tag` removed, googlemail → gmail;
  - **outlook.com / hotmail.com / live.com**: `+tag` removed;
  - other providers: lower-case only.
- Any provider is allowed (Gmail, Yahoo, Outlook, …).

### 16.3 Name

`name_norm` (existing normalizer). Same name + DOB as another account → a **soft flag** on the admin review list, never a refusal.

### 16.4 Duplicate registration messages (rev. 4, owner final)

Duplicates are **blocked** (at `register/start` and again by the UNIQUE indexes at creation) with a friendly message that points to Technical Support (§11), with its WhatsApp button:
- Phone in use: «رقم الموبايل ده مسجّل بالفعل في حساب تاني. لو ده رقمك ومش قادر تدخل، كلّم الدعم الفني.»
- Email in use (verified or admin-entered): «الإيميل ده عليه حساب بالفعل. سجّل دخول، ولو مش فاكر الباسورد استخدم "نسيت الباسورد" أو كلّم الدعم الفني.»
- The same rules apply to admin creation and admin corrections (a clear inline error naming the field; no support link).

---

## 17. Anti-cheating

### 17.1 The main scenario

Someone registers with their real DOB and becomes a guest. They then try another email, another name and a fake DOB with **the same mobile**. **The unique phone index refuses it** (§16.4). Changing the email or the name doesn't help, because all phone formats normalize to one value.

### 17.2 Another phone (a second SIM or a relative's)

This can't be prevented technically without external identity checks, which are intentionally excluded. Layered defences:
1. **Every Store order needs admin approval** (existing): points are worthless until an admin approves a prize.
2. Every self-registered account has an OTP-verified email (§6); emails are UNIQUE after canonicalization (§16.2).
3. An admin **«حسابات جديدة» review list**: self-registered accounts, newest first, with flags:
   - same name + DOB as another account;
   - same name, different phone;
   - DOB within 30 days of a range boundary;
   - many registrations from one salted IP in an hour;
   - registered soon after a guest account from the same salted IP.
4. The owner checks suspicious people **manually, outside the system**, then uses the admin corrections (§12.2): DOB fix, mark guest, block. All with a reason and audit.

### 17.3 DOB editing

- **Participants cannot edit their DOB at all**, before or after creation. The confirm step (§6, step 2) catches typos before saving.
- A correction goes **only through an admin with `participants.manage`** (default: Primary Admin; rev. 4), with a reason; the audit keeps old → new; a critical notification goes to the Primary Admin.
- Eligibility is recomputed **for the future only**: points, store and **future booking eligibility** (§18.1). Past submissions keep their `elig` stamp (§9.1); existing bookings keep their age snapshot.
- **Guest → eligible always needs `participants.manage`**: a DOB correction or an override, both audited.
- If fairness requires giving back points a corrected person missed, use the existing manual adjustment with a note. Nothing is regraded automatically.

### 17.4 Bots

Invisible Turnstile + honeypot + IP limits on signin/register/forgot. Phone uniqueness itself limits mass sign-ups.

---

## 18. Competition / Points / Store impacts

**Competitions (every participant has an account):**
- `compStart` **always** requires a valid session.
  - No session → `session` → the page shows the sign-in form (§8). After sign-in or registration it returns to the same competition with the autosave intact.
  - The server resolves participant → status (blocked → refused) → effective eligibility → stamps `elig`/`noPoints` on the attempt.
- Attempt tokens bind `pw_version`.
- **Removed from the engine and the builder:**
  - the `participation` axis (`open` | `registered`);
  - `allowGuests`;
  - the open-mode `fields` form;
  - `uniquePhone` and the phone-based limits;
  - the `guest` flag on code-less rows;
  - the `hp` honeypot in `compStart`.
- `attempts` and `maxSubmissions` count **per account**.
- **Presets** in «مسابقة جديدة» keep only their scoring, result and wallet defaults:
  - «استبيان بسيط»: scoring off;
  - «مسابقة عامة بدرجات»: scoring on, no wallet;
  - «مسابقة نقاط»: scoring + wallet.
  - «مسابقة بأكواد» disappears (every competition is now "with accounts").
- Surveys and score-only quizzes still work. They just require an account like everything else.
- Publish validation: a definition with `participation`/`allowGuests`/`fields` is rejected or ignored. Since no real data exists, old test definitions are simply re-saved in the new shape (§7).
- Guests play every competition the same way; only the points differ.

**Points:**
- Ledger unchanged.
- Guest submissions earn 0 (stamped).
- Frozen = derived (§9.4).
- Duplicates: block + `transfer` adjustment.

**Store:**
- Sessions instead of `ptoken`.
- Guests browse and are locked (§9.5).
- No OTP and no email-verification check before orders (rev. 4).
- Blocked accounts can't log in; their pending orders are listed for the admin.

**Admin results ranking:** guests carry a «ضيف» badge and no rank number (§28 #4, final).

### 18.1 Bookings: account/booking age sync (rev. 4, owner final)

Phase 1.5 step 10 adds event age eligibility with a **self-declared** booker DOB (BOOKING-PHASE1-COMPLETION-PLAN §4.9). That flow stays until 5A. From 5A:

1. **Signed-in booker:** the booking form hides the DOB field and prefills name + phone from the account. `POST /v1/book/submit` with a session reads the DOB **from the account only** (any client-sent DOB is ignored), computes the age **at the event's start date (Cairo)** and applies the event's `bookerAge` rule server-side. Out of range → the same `code:'age'` message.
2. **Snapshot:** the booking stores `participant_id`, `booker_age`, `age_source = 'account'` and the rule values used. Later DOB corrections or rule edits never change an existing booking.
3. **Admin DOB correction** (§17.3) is used by every **future** check automatically (it is read live from the account).
4. **Pending booking whose account DOB changed before confirmation:** the confirm dialog warns «السن اتغير بعد الحجز ده». No automatic action.
5. **`requireAccount` per event:** defaults to on for events with a `bookerAge` range (so a guest account can't sign out and self-declare), off otherwise. Events without a range stay open to everyone, as today.
6. **Linking older bookings:** a self-declared booking can be attached to an account only through its status link (possession) or by an admin; never automatically by phone. It keeps its self-declared snapshot; a mismatch flag shows when the DOBs differ.
7. **Kept separate:** event eligibility (per event), account eligibility (eligible / guest, §9) and companions' ages + child/free pricing (`categoryForAge`, unchanged). A guest account may book any event whose range allows it.
8. **Admin age override** (`bookings.manage`, mandatory reason, audited) works the same with accounts.
9. OTP is never involved in bookings or installment payments.

---

## 19. Excel impact

| Item | Change |
| --- | --- |
| Participants export | Columns: رقم المشترك · الاسم · الإيميل · اتأكد الإيميل · الموبايل · تاريخ الميلاد · السن · الأهلية (مؤهل / ضيف) + مصدرها (تلقائي / يدوي) · متجمد (رصيد) · الحالة (نشط / موقوف) · المجموعة · الكنيسة · الخادم المسؤول · ملاحظات. **No password column, ever** |
| Import | Bulk account creation from Excel is decision §28 #7. If kept, import **never** sets or reads passwords, eligibility overrides or block state. A phone or email already in use is an error |
| Distribution files / code export | Retired |
| Results / points exports | Unchanged (by id), + a «ضيف» column |

---

## 20. Proposed D1 data model

This replaces the code-based Phase 5 `participants` design. There are no code columns and no legacy flags.

```sql
CREATE TABLE participants (
  id TEXT PRIMARY KEY,                       -- p-xxxxxxxx
  name TEXT NOT NULL, name_norm TEXT NOT NULL,
  email TEXT NOT NULL, email_canon TEXT NOT NULL, email_verified_at INTEGER,
  email_source TEXT NOT NULL,                -- 'self' (OTP-verified at registration) | 'admin' (entered by an admin, unverified)
  phone TEXT NOT NULL, phone_norm TEXT NOT NULL,
  birth_date TEXT NOT NULL,                  -- YYYY-MM-DD, locked (only admin corrections)
  eligibility_override TEXT,                 -- NULL | 'guest' | 'eligible'
  grp TEXT, church TEXT, servant TEXT, notes TEXT,
  status TEXT NOT NULL DEFAULT 'active',     -- active | blocked | deleted
  blocked_at INTEGER, blocked_reason TEXT,
  pw_hash TEXT NOT NULL, pw_enc TEXT NOT NULL, pw_version INTEGER NOT NULL DEFAULT 1,
  pw_issued_at INTEGER NOT NULL, pw_issued_by TEXT NOT NULL,   -- 'self' | 'reset' | admin email
                                             -- pw_enc is ALWAYS written with pw_hash, so the current password stays viewable (§12.3)
  created_via TEXT NOT NULL,                 -- self | admin | import
  reg_ip_hash TEXT,                          -- salted; purged after 90 days
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX participants_email ON participants(email_canon);
CREATE UNIQUE INDEX participants_phone ON participants(phone_norm);

CREATE TABLE account_sessions (
  id TEXT PRIMARY KEY, participant_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
  pw_version INTEGER NOT NULL, kind TEXT NOT NULL,          -- 'device' (30 d sliding) | 'shared' (12 h)
  created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  revoked_at INTEGER, device TEXT                            -- 'Android Chrome' etc.; no raw UA
);
CREATE INDEX account_sessions_p ON account_sessions(participant_id);

-- rev. 4: OTP replaces the verify/reset links (auth_tokens is not built)
CREATE TABLE pending_registrations (          -- self-registration before OTP; purged after 30 min
  id TEXT PRIMARY KEY, email_canon TEXT NOT NULL UNIQUE, data TEXT NOT NULL,   -- validated form (name, email, phone, DOB)
  code_hash TEXT NOT NULL, code_expires_at INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0,
  sends INTEGER NOT NULL DEFAULT 1, last_sent_at INTEGER NOT NULL, ip_hash TEXT, created_at INTEGER NOT NULL
);

CREATE TABLE otp_codes (                      -- forgot password (verified emails only)
  participant_id TEXT NOT NULL, purpose TEXT NOT NULL,              -- 'recover'
  code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0,
  used_at INTEGER, created_at INTEGER NOT NULL,
  PRIMARY KEY (participant_id, purpose)                             -- a new code replaces the old one
);
-- The plain code exists only in the Queue message (or the inline send); never in D1, logs or the outbox.

CREATE TABLE email_outbox (
  id TEXT PRIMARY KEY, participant_id TEXT, kind TEXT NOT NULL,   -- otp_register | otp_recover | email_changed (never a password)
  ref TEXT, pw_version INTEGER, status TEXT NOT NULL,             -- queued | sent | skipped | failed | deferred
  attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at INTEGER NOT NULL, sent_at INTEGER,
  idem_key TEXT UNIQUE
);

CREATE TABLE participant_audit (             -- PRIVATE, admin only
  id TEXT PRIMARY KEY, participant_id TEXT NOT NULL, at INTEGER NOT NULL, actor TEXT NOT NULL,
  action TEXT NOT NULL,   -- register | register.admin | email.change | phone.change | dob.correct | eligibility
                          -- | block | unblock | password.reset | password.reset.self | password.reset.support | password.view
                          -- | profile.edit | session.revoke | transfer
  field TEXT, old_value TEXT, new_value TEXT, reason TEXT,
  check_method TEXT       -- support recovery: in_person | details_match | support_call (rev. 4)
);
CREATE INDEX participant_audit_p ON participant_audit(participant_id, at);
```

Other tables:
- `submissions`:
  - `participant_id` is **NOT NULL** (no anonymous rows);
  - adds `elig TEXT` ('eligible' | 'guest'), `age_min INTEGER`, `age_max INTEGER` (the snapshot);
  - keeps `no_points`;
  - drops the open-mode `name`/`phone`/`fields` columns and the `guest` flag (the name is read from the account).
- `competitions` drops `participation`, `allow_guests`, `fields` and `unique_phone`.
- `redemptions` adds `elig` at order time.
- The ledger is unchanged.
- `settings` rows:
  - `age_min`, `age_max`, `age_warn_days`;
  - `accounts_mode` (off | on);
  - `email_daily_cap` (target ~400, shared), `otp_reserve`, `otp_daily_cap_per_email`;
  - `support_contact_id` (the Technical Support WhatsApp contact, §11);
  - `session_days_device`, `session_hours_shared`;
  - `discovery_daily_cap`.

Write budget: about 6–8 rows written per registration including index entries. Negligible against 100k a day.

---

## 21. Security model

### 21.1 Trust boundaries

- The frontend is public. Every decision is made in the Worker.
- Public `/v1/account/*` routes: invisible Turnstile (except session-continue), D1 rate limits, uniform timing.
- Admin routes: Google ID token verified locally + allowlist + a role check per action. Reveal and corrections need the primary role and a fresh token.

### 21.2 Password storage

- HMAC-SHA256 with `PW_PEPPER`, plus AES-GCM with `PW_KEY` for reveal (§12.3).
- No slow hash (the 10 ms CPU limit on Free; and the reveal copy would make it moot). The protection comes from generated 59-bit passwords, keys kept outside D1, Turnstile and rate limits.

### 21.3 Threats → protections

| Threat | Protection |
| --- | --- |
| Brute-force password | 59-bit passwords. Per account: 5 fails → interactive Turnstile; 10 in 15 min → 15-min cool-down (never a permanent lock). Per IP 30 fails/hour; global 120/min → `busy` |
| Email / phone enumeration | Explicit messages kept (owner's UX) behind invisible Turnstile, per-IP and global caps, uniform timing, no data in replies, monitoring (§8.4) |
| Bots testing email lists | Turnstile on every discovery; 10 per 10 min / 40 a day per IP; 400 a day globally with an admin alert |
| Duplicate registrations | UNIQUE `email_canon` + `phone_norm`; idempotency key per form |
| Recovery abuse / mass email | OTP reset on verified emails only (nothing changes until the code is verified), a neutral reply, per-email/IP/global caps, OTP reserve, outbox daily cap |
| OTP guessing | 6 digits, 5 tries per code, 10-min life, 5 codes/email/day, hashed with `OTP_PEPPER`, constant-time compare |
| Email squatting at registration | No account row before OTP verification (§6.7) |
| Account takeover through support | `participants.manage` only, manual identity check + check method + reason in the audit, old-email notice, 7-day change limit, order warning, critical notification |
| Phone-based recovery social engineering | Not offered at all (rev. 4): no SMS, no phone confirmation |
| DOB change for eligibility | No participant edit; admin correction only; snapshots protect history |
| Duplicate-phone tricks | Normalization + UNIQUE index |
| Session theft | Random 256-bit token, hashed in D1, revocable, bound to `pw_version`; device 30 d / shared 12 h; strict CSP (no inline scripts, `textContent` rendering, existing rules); no tokens in URLs; «اخرج من كل الأجهزة» |
| Shared-device leakage | «جهاز مشترك» tick: sessionStorage only, no hint; masked email on the card; «انسَ الحساب ده» |
| Admin misuse | Password viewing Primary-only and logged; sensitive corrections need `participants.manage`; reasons, private audit, critical notifications, activity log |
| Secrets in logs or backups | No bodies, emails, IPs or tokens in logs (existing); a test scans for password and token shapes; backups hold only hashes and ciphertext |

### 21.4 Rate limits (D1 `rate_limits`, salted keys)

| Bucket | Limit |
| --- | --- |
| `acct.discover` per IP | 10 / 10 min, 40 / day |
| `acct.discover` global | 400 / day (admin push at 50%) |
| `acct.login.fail` per account | 5 → interactive Turnstile; 10 / 15 min → cool-down |
| `acct.login.fail` per IP | 30 / hour |
| `acct.register` per IP | 30 / hour (church Wi-Fi), 100 / day |
| `acct.otp.send` per email / per IP | 5 / day (60 s cooldown) · 20 / hour |
| `acct.otp.try` per code | 5 |
| `acct.forgot` per IP | 10 / hour |
| `mail.send` global | 300 / day |
| `admin.view-password` | **none** (owner: unlimited; Primary Admin only; every view logged) |

---

## 22. Data retention / privacy

- Personal data: name, email, mobile and DOB (all required). Account existence implies membership of a church youth service (sensitive), which is the reason for §8.4.
- **No child or parental-consent flow.** Registration accepts any real DOB (age 5–100 sanity range). Eligibility comes only from the admin age settings; out of range = guest.
- Update `privacy/` to say:
  - what is collected and why;
  - that **leaders can view or reset your password** and correct your data;
  - that email is used only for account messages;
  - what this device remembers (first name + email for «متابعة», and the session), and how to make it forget;
  - retention, and how to ask for deletion.
- Retention defaults:

  | Data | Kept |
  | --- | --- |
  | `reg_ip_hash` | 90 days |
  | `email_outbox` | 30 days |
  | `pending_registrations` / `otp_codes` | 30 min / 1 day after expiry or use |
  | Expired sessions | 30 days |
  | `participant_audit` | 3 years |
  | `activity` | 365 days (existing) |

- **Deletion request:** anonymize (name → «حساب محذوف», email/phone/DOB nulled, credentials cleared, `status = deleted`). The ledger and submissions stay for season integrity (they hold no PII). Admin-only, audited.
  - The UNIQUE NOT NULL columns get a tombstone value (`deleted:<id>`), so the number and the email become free again.
- Location: D1 `eeur`. Nothing private on GitHub, in published revisions, in push payloads or in activity `changes`.
- Test/demo XLSX archive (§7): kept privately by the owner, not in the repo.

---

## 23. Implementation and rollout (inside Phase 5, step 5A)

All behind `accounts_mode`, on **staging first**. No claim campaign.

| Step | Scope | Gate |
| --- | --- | --- |
| **5A-0 Prep** (can start any time, no production change) | Owner tasks (§28.2); privacy text; archive the test/demo data; decide §28 | Decisions answered |
| **5A-1 Server** | Accounts schema incl. `pending_registrations`, `otp_codes`, `email_source`; `/v1/account/*` (signin incl. discovery, register/start + register/verify (OTP), me, logout, forgot + forgot/verify (OTP, verified emails only)); sessions; Turnstile; rate limits; uniform timing; OTP templates + reserve on the Phase 1.5 outbox/Gmail sender; admin endpoints per the grant split (sheet, create without OTP, profile edit, email/phone/DOB corrections, eligibility, view-password, reset-password, support recovery with check method, block, transfer, audit, review list) | Unit + Worker tests; staging race/limit checks |
| **5A-2 Public UI** | `assets/js/account/` (two-field form, register + OTP view, password view, forgot + OTP, remembered-account card, shared-device mode, Technical Support links); Store guest lock + frozen balance; wording | E2E + device matrix (§25) |
| **5A-3 Admin UI** | Person sheet (verified / admin-entered email), review list, create-account dialog, view-password and reset dialogs (separate), corrections with reason, support recovery with check method, Excel columns. Existing admin components only (Phase 8 rule) | Admin e2e |
| **5A-4 Booking age sync** (§18.1) | Booking submit with a session: DOB from the account, age at the event date, `age_source = 'account'`, `requireAccount` per event, confirm-time DOB-changed warning, booking ↔ account linking via status link or admin | Worker + e2e |
| **5B…** (the rest of Phase 5) | Points, store and competitions runtime on the Worker, written against sessions from the start | Phase 5 gates |
| **Staging rehearsal** | Fresh fixture accounts (eligible, soon, guest, frozen); real emails to Gmail/Yahoo/Outlook test inboxes; device matrix | Deliverability OK; no PII in logs |
| **Launch** | `accounts_mode = on` in production, then open competitions (all account-only) to youth (between competitions) | First real competition clean |

## 24. Rollback

- Before launch there is no real data, so rollback = keep `accounts_mode = off`. No competition is open to youth on the new system yet.
- After launch:
  - `wrangler rollback` for a bad deploy (seconds);
  - D1 Time Travel (7 days) or the nightly encrypted backup for bad data;
  - `email_daily_cap = 0` pauses mail (reset falls back to the admin);
  - `accounts_mode = off` shows «تسجيل الدخول متوقف مؤقتًا» on **every** competition and on the Store. Data is kept. There is no anonymous fallback mode by design.
- There is no code-login fallback (nothing to fall back to). Schema changes are forward-only.

## 25. Testing plan

**Pure unit tests:**
- phone normalization (every format, Arabic digits);
- email canonicalization;
- name parts with «عبد/أبو»;
- DOB parsing and eligibility at the boundaries (birthday today, 29 Feb, min/max ± 1 day, settings changes);
- frozen derivation;
- the password generator (alphabet, length, uniformity, normalization round trip);
- AES-GCM associated data (a moved ciphertext fails).

**Worker tests** (existing `d1-sqlite` helper):
- signin: discovery exists / missing, login right / wrong / missing / blocked;
- register: phone and email in use (support message), guest creation; **no participant row before a correct OTP**; OTP wrong ×5 → dead; expiry; resend cooldown and daily cap; a new code cancels the old one;
- forgot: neutral reply for unknown / unverified / blocked emails **and no email sent**; verified email → OTP; the old password still works until the code is verified; a correct code rotates `pw_version` and kills sessions; **no outbox row ever contains a password**;
- admin create without OTP → active, `email_source = admin`, unverified; forgot on it sends nothing;
- view-password: Primary only, returns the current password, unlimited calls, `pw_version` and sessions unchanged, every call logged; reset is a separate endpoint and does rotate;
- grant split: each admin action refused without its grant (§12.2);
- support recovery: check method + reason required; critical notification;
- booking age sync (§18.1): signed-in booker's client-sent DOB ignored; account DOB at the event date decides; an admin DOB correction changes the next booking's result but not existing snapshots; `requireAccount` refuses signed-out submits on ranged events;
- **50 parallel registrations with one phone → exactly 1**;
- rate-limit windows; Turnstile missing or invalid;
- timing: missing vs existing discovery within the padding;
- guest: `noPoints` stamp, `not_eligible` on redeem/cancel, browse allowed;
- `compStart` without a session → `session` for **every** competition (survey, score-only, points); no anonymous submission row can be written (NOT NULL);
- classification follows the Admin range: change 18–30 → 18–32 and a 31-year-old flips to eligible on the next request, while their earlier submissions keep their stamps;
- aging out between submit and regrade (the stamp wins);
- frozen → eligible again;
- store orders need no OTP and no verified email (rev. 4).

**Security tests:**
- no password, OTP, token or email in logs, `activity.changes` or the outbox;
- no credential in any URL;
- the view-password reply is `no-store`;
- non-primary admins refused on view-password.

**E2E (Playwright):**
- the two-field flow: email only → exists / missing; both filled → direct login;
- opening any competition signed out → sign-in → back to the same competition;
- registration → OTP → password view → login; forgot → OTP → new password view;
- signed-in booking on a ranged event: no DOB field, eligibility from the account;
- remembered-account card (session valid / expired), «انسَ», shared-device mode;
- Store guest lock and frozen balance;
- RTL;
- the competition autosave with sessions.

**Manual device matrix** (password managers can't be automated reliably):

| Device | Browser / mode |
| --- | --- |
| Android | Chrome, and the installed PWA |
| iPhone | Safari, and the home-screen app |
| Windows | Chrome, Edge |
| Desktop | Firefox |

Check on each:
- the save prompt after registration and the update after a reset;
- one-tap fill of both fields;
- the card's «متابعة» with an expired session.

**Email:** staging sends to Gmail, Yahoo and Outlook test inboxes (inbox vs spam, Arabic rendering, OTP arrival time, cap and reserve behaviour). The OTP field's `one-time-code` autofill is checked on iPhone and Android.

## 26. Effort and risk

| Part | Rev. 1 | Rev. 2 |
| --- | --- | --- |
| Worker account module, schema, sessions, rate limits, Turnstile, timing | 4–6 | 4–5 |
| Claim flow, legacy code coexistence, shared-phone handling, sunset | (≈ 3–4, inside the rows above and below) | **0** |
| Email outbox + Gmail sender + templates | 1.5–2.5 | 1.5–2 |
| Admin endpoints | 3–4 (incl. merge) | 2.5–3 (no merge tool) |
| Public UI (two-field form, register, password view, forgot, remembered card, Store guest lock) | 4–5 | 4–5 |
| Admin UI + Excel | 4–5 | 3–4 (no claim lists or distribution) |
| Tests | 3–4 | 3–4 |
| Staging rehearsal + device matrix | 2–3 | 2 |
| Claim campaign (calendar) | 1–3 weeks | **0** |
| **Total** | ~22–30 dev days + a campaign | **~16–21 dev days (~3–4 calendar weeks), no campaign** |

Extra saving inside Phase 5: these **are never ported** to the Worker, about 3–4 dev days off Phase 5's own registry and competitions port:
- the code login, `pt1` tokens, code export and distribution files;
- (rev. 3) the whole no-account competition path: open mode, `allowGuests`, the open form, phone-based limits.

The builder change (removing the participation choice and the open form; presets reduced) is about 0.5 day inside the admin UI row. Rev. 3 does not change the 16–21 day total.

**Rev. 4 (final): ~19–25 dev days.**
- OTP registration + recovery (pending registrations, codes, OTP views, reserve): +1–1.5;
- admin account control without OTP + grant split + `email_source`: +1–1.5;
- support-only recovery tool (check method, WhatsApp contact setting): +0.5;
- view-password as a separate unlimited action: ±0 (replaces the reveal);
- booking age sync (5A-4): +1.5–2;
- removed: the verify link, the store verification gate, emailed passwords: −0.5 to −1.
- The Gmail sender and outbox are built in Phase 1.5, so 5A only adds templates and the OTP reserve.

**Risk: low–medium.** No data migration risk. The remaining risks are:
- password-manager quirks on iOS (mitigated by the copy button and the visible password);
- the Gmail token being revoked (monitoring; admins can still create accounts without OTP; recovery falls back to Technical Support);
- a registration burst exhausting the OTP reserve (configurable reserve; admin creation as fallback);
- `PW_KEY` exposure would reveal all passwords (accepted by the owner; §12.3);
- someone launching coded competitions with real youth before accounts ship (decision §28 #1).

## 27. Where in the backend-migration roadmap

**Rev. 2 recommendation: build accounts as the first step of Phase 5 ("5A, accounts-first registry"), not as a separate Phase 5.5 after it.**

- Rev. 1 put it after Phase 5 to keep Phase 5's "verify equal balances and codes" gate clean. With **no real participant data**, that gate has nothing to compare, and porting the code login only to delete it weeks later is wasted work.
- Phase 5 moves the registry, points, store and competitions runtime to D1. Making the registry the account system from the start means:
  - the competitions runtime and the Store are written once, against sessions;
  - there are never two writers of identity.
- It still **doesn't touch Phases 1–4** (booking pilot, publish separation, admin platform, content). Nothing in the current migration work changes.
- Before Phase 5 it can't be done cleanly: competitions, points and the Store still run on Apps Script, and an account system on the Worker would need a cross-runtime token bridge for a short-lived hybrid.
- This changes `docs/BACKEND-MIGRATION.md` §12 (the Participants row) and §22 (the Phase 5 gate) when Phase 5 is planned in detail. **Not edited here** (plan-only; one document).

---

## 28. Decisions (rev. 4: all final, roadmap locked 2026-10-20)

### 28.1 Decisions

Settled by the owner:
- Guest Store access;
- points after aging out (frozen);
- no child or parent-consent flow;
- no legacy claim;
- no افتقاد integration;
- Primary Admin views any current password at any time, unlimited, without changing it (rev. 4; viewing and resetting separate);
- password recovery by 6-digit email OTP on verified emails only, nothing changes before verification (rev. 4; replaces the confirm link);
- 6-digit email OTP before activation for self-registration; OTP used nowhere else (rev. 4);
- admins create and edit accounts without OTP per the grant split (rev. 4);
- recovery otherwise via Technical Support only (the configurable WhatsApp contact); no SMS or phone-based recovery; passwords never emailed (rev. 4);
- account DOB controls future booking eligibility; snapshots kept (rev. 4);
- email budget ~400/day configurable target with critical and OTP reserves (rev. 4);
- the two-field email-first UX with explicit existence messages;
- (rev. 3) **no play without an account**: every participant has an account, and eligible vs guest comes automatically from the Admin age range.

| # | Decision | Final (rev. 4) |
| --- | --- | --- |
| 1 | Hold competitions with real youth until accounts ship? | **Yes, hold** (keeps "no migration" true) |
| 2 | Password length | **12 symbols** (`XXXX-XXXX-XXXX`) |
| 3 | Verified email before the first Store order | **Retired**: no gate before store orders |
| 4 | Guests in the admin results ranking | **Badge, no rank number** |
| 5 | Store orders placed before someone ages out | **Honour them** |
| 6 | Who can block | **Emergency block: `participants.edit` or higher; unblock: `participants.manage`** |
| 7 | Bulk account creation from Excel | **Not in v1**; single admin creation without OTP is allowed |
| 8 | Support contact | **Technical Support = the existing configurable WhatsApp support contact** (`support_contact_id`) |
| 9 | Session length and remembered accounts | **30 days device / 12 h shared; up to 3 remembered accounts** |
| 10 | Forgot-password reply | **Always neutral** + the support contact; codes only to verified emails |
| 11 | Booking `requireAccount` (5A) | **On by default for events with a booker age range**, off otherwise |
| 12 | Pending booking whose account DOB changed | **Warning at confirmation only** |

Background for #1–9 from the revision that introduced them (the table above is authoritative):

1. **Launch order.** If competitions start with codes for real youth before accounts exist, real legacy data appears and a claim flow comes back.
   - *Example:* a points competition next month using printed codes.
   - *Recommended:* hold competitions with real youth until accounts launch. If something must run earlier, a one-off survey on today's system is fine as a throw-away (it creates no identities). Its data is not carried into the account system.
   - *Technically:* yes = no claim work; no = add the rev. 1 claim flow (+3–4 days + a campaign).
2. **Password length.** *Example:* `K7QM-4RTX-9PHA` (12) vs `K7QM-4RTX-9P` (10). *Recommended:* 12. *Technically:* one constant; 10 is slightly easier to type, 12 is far harder to guess.
3. **(Retired in rev. 4.) Verify the email before the first order (eligible accounts).** *Example:* Mina registers, plays and earns 200 points; his first prize order asks him to click the email link first. *Recommended:* yes. *Technically:* a flag check in `shopRedeem` + a resend button; off = no check.
4. **Guests in the admin ranking.** *Example:* a 32-year-old guest scores highest in a quiz. *Recommended:* show them with «ضيف» but without a rank number, so eligible people keep places 1, 2, 3. *Technically:* a sort/filter in `apiCompResults` and the XLSX.
5. **Orders made before aging out.** *Example:* Sara orders a prize on Monday and turns 31 on Wednesday, before the admin approves. *Recommended:* honour it (it was made while eligible, and the order row carries `elig = eligible`). *Technically:* honour = no extra code; cancel = auto-cancel + refund into a frozen balance at the birthday (a daily cron job).
6. **Who can block.** *Example:* another admin sees an obvious fake account at 11 pm. *Recommended:* any admin may *block*; only the primary admin unblocks, corrects or reveals. *Technically:* a role check per endpoint.
7. **Bulk account creation from Excel.** *Example:* a servant has a sheet of 40 names to pre-register. *Recommended:* not in v1. Self-registration + single admin creation are enough, and bulk creation would mean handing out 40 passwords. *Technically:* yes = an import preview/apply with email+phone+DOB required, passwords revealed one by one (+2 days).
8. **Support contact for lost email.** *Example:* «كلّم مينا على واتساب 010…». *Recommended:* one named servant's WhatsApp/phone from the site contacts. *Technically:* a settings value shown on the form.
9. **Session length and remembered accounts.** *Example:* opening a competition 3 weeks later on the same phone. *Recommended:* 30 days of inactivity on "my device", 12 hours (tab only) on "shared device"; up to 3 remembered accounts per device. *Technically:* settings values; shorter sessions mean more password prompts (still one tap with a password manager).

### 28.2 Things only you do later (never paste secrets in chat)

- **`athanasius.youth.safaga@gmail.com`:** turn on 2-Step Verification, and give the recovery details to two leaders. At build time, sign in **as that account** once on the OAuth consent screen (`gmail.send`).
- **Google Cloud:** set the OAuth consent screen's publishing status to **In production**.
- **Worker secrets:** use `wrangler secret put NAME [--env staging]` from `worker/`, or the Cloudflare dashboard → Workers & Pages → `athanasios-api` → Settings → Variables and Secrets:
  - `PW_PEPPER`, `PW_KEY`, `OTP_PEPPER`: generated locally by a helper script and piped straight in, never printed;
  - `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`: from the one-time consent helper;
  - `TURNSTILE_SECRET` (already planned for the booking pilot; one widget can cover the account forms).
- **Privacy text** approval (§22).
- **Technical Support contact:** pick the existing WhatsApp contact in Admin settings (§11).
- **Archive the test/demo data** (§7) when Phase 5 starts.

---

## Summary

- **Final architecture:** account = the participant row (email, unique phone, locked DOB, eligibility override, block, generated password as HMAC hash + AES-GCM copy so the Primary Admin can view the current password (logged)), on the Worker + D1. It uses revocable bearer sessions, invisible Turnstile, D1 rate limits, uniform timing, and email through a Queue → Gmail API as `athanasius.youth.safaga@gmail.com`.
- **Login:** one two-field form (`username` + `current-password`, both always usable); email-first discovery on «متابعة»; direct login when both are filled; explicit existence messages behind bot protection; the password saved by the browser's own manager; a remembered-account card from a session or a non-secret hint, with a shared-device mode.
- **Accounts only:** every competition participant has an account; there is no anonymous mode. Each account is **eligible** or **guest**, decided automatically from its DOB and the age range currently set in Admin.
- **Guests:** play and browse the Store; no earning, ordering or spending; earlier points frozen (derived, not deleted). Eligibility is recomputed from DOB + current settings, and history is protected by per-row snapshots.
- **Rev. 4:** 6-digit email OTP only for self-registration (before activation) and verified-email recovery; admins create/edit without OTP per grants; Technical Support (WhatsApp) is the only other recovery; passwords never emailed; Primary Admin views current passwords any time without resetting; account DOB drives future booking eligibility (§18.1).
- **Migration:** none. Logic is reused, test data archived, no claim.
- **When:** Phase 5, step 5A (after Phase 1.5 provides grants and the Gmail sender).
- **Effort:** ~19–25 dev days, low–medium risk.
- **Open:** none (§28.1 final); owner tasks in §28.2.

### Sources (fetched 2026-10-19)

- Apps Script quotas (consumer: 100 email recipients/day): https://developers.google.com/apps-script/guides/services/quotas
- Cloudflare Email Service pricing/limits (Free: verified destinations only): https://developers.cloudflare.com/email-service/platform/pricing/ , https://developers.cloudflare.com/email-service/platform/limits/
- Gmail sending limit (~500/day consumer, vendor doc): https://www.courier.com/docs/integrations/email/gmail
- Google OAuth refresh tokens expire after 7 days in Testing mode: https://www.unipile.com/google-oauth-refresh-token/
- Gmail API scopes (gmail.send = sensitive): https://www.unipile.com/gmail-api-scopes-guide/
- Chromium password autofill only fills enabled, non-readonly fields: https://chromium.googlesource.com/chromium/+/trunk/chrome/renderer/autofill/password_autofill_manager.cc
- Chromium did not save passwords from readonly fields: https://codereview.chromium.org/1072813002/
- Identifier-first screens and password managers (forum report): https://community.auth0.com/t/password-managers-not-recognizing-identifier-field-when-identifier-first-is-enabled/182657
