# Competitions platform

One reusable competition engine, an optional participant registry with codes,
an optional points wallet with a «نقاطي» portal and a rewards store. Everything
is operated from the admin (`/admin/`); Google Sheets is the storage; the
public browser never touches a Sheet.

This file is both the architecture description and the build contract. Names
here (tabs, columns, functions, JSON fields, error codes) are binding: the
server, the public engine and the admin are built against them in parallel.
If an implementation detail forces a change, change it HERE first.

## 0. Modules and switches

| Module | Files | Switch | Depends on |
| --- | --- | --- | --- |
| Engine (Phase 1) | `CompStore.gs`, `CompModel.gs`, `CompScore.gs`, `CompPublic.gs`, `CompAdmin.gs`, `CompPublish.gs`; `assets/js/comp/*`, `assets/css/comp.css`, `competition/index.html`; `apps-script/AdminComp*.html` | always on | nothing |
| Registry (Phase 2) | `CompRegistry.gs`, `CompCrypto.gs`; `AdminCompPeople.html` | Script Property `COMP_REGISTRY` = `'1'` («تفعيل المشاركين بالأكواد») | Engine |
| Wallet (Phase 3) | `CompWallet.gs`; `points/index.html`, `assets/js/comp/portal.js`; `AdminCompWallet.html` | `COMP_WALLET` = `'1'` | Registry |
| Store (Phase 3) | `CompStoreItems.gs` (name avoids clashing with `Store.gs`); `AdminCompShop.html` | `COMP_SHOP` = `'1'` | Wallet |

Rules:
- The engine never requires another module. A public competition with
  scoring off reads and writes only `Competitions`, `Questions`, `Snapshots`,
  `Submissions`.
- Turning a switch off hides that module's admin screens and makes its public
  actions answer `{ ok:false, code:'disabled' }`. Data is kept.
- A competition can only choose `participation:'registered'` while the
  registry is on, and `wallet:'on'` while the wallet is on (validated on save
  AND at publish).
- Switches are changed only by `apiCompSettings` (admin) and logged.

## 1. Storage

### 1.1 A separate spreadsheet

- Script Property `COMP_SHEET_ID`. `compSpreadsheet_()` opens it; if the
  property is missing it is created (`SpreadsheetApp.create('Athanasios — Competitions (private)')`,
  timezone Africa/Cairo) **only from an admin call** under the script lock. A
  public call with no spreadsheet answers `not_found`.
- Never shared with anyone. The API deployment runs as the owner, so admins
  never need Sheet access. The recovery admin (HtmlService, runs as the
  visiting admin) does not offer competitions; it says to use `/admin/`.
- Tabs are created on first use by `compSheet_(name)` from `COMP_TABLES`
  (CompStore.gs): bold frozen header, all columns `@` text format. Missing
  columns are appended to the right automatically (never reordered, never
  deleted). Script Property `COMP_SCHEMA` = `'1'`.
- Every written text cell goes through `plainCell_` (no formula injection).
- Writes are BATCHED: one `setValues` per row (or per block of rows), never
  one call per cell (`upsertRow_` in Store.gs is per-cell and must not be
  used here). Reads of list views read only the columns they need.

### 1.2 Tabs (`COMP_TABLES`)

Times are Cairo wall-clock text `YYYY-MM-DD HH:MM` (like the rest of the
project) unless the column says `ms` (epoch milliseconds, for durations and
deadlines). Booleans are `'1'` / `''`. JSON columns hold compact JSON text.

```
Competitions   (draft definitions; one row per competition)
  id             cmp-xxxxxxxx
  slug           [a-z0-9-]{2,40}, unique, LOCKED after first publish
  title          ≤ 80
  shortTitle     ≤ 30 (card, push, portal)
  description    ≤ 600
  instructions   ≤ 2000 (shown before start)
  ctaLabel       ≤ 24 (default «ابدأ المسابقة»)
  banner         img-xxxxxxxx | ''
  icon           img-xxxxxxxx | ''
  theme          one of SECTION_THEMES (Content.gs) | ''
  startAt        Cairo stamp | ''   (empty = open as soon as published)
  endAt          Cairo stamp | ''   (empty = never closes by itself)
  participation  open | registered
  scoring        '1' | ''           ('' = submission only)
  resultShow     none | score | points | both
  resultsAt      Cairo stamp | ''   (result hidden until then; '' = right after submit)
  answersShow    never | immediately | afterClose | atDate
  answersAt      Cairo stamp | ''   (for atDate)
  showPoints     '1' | ''           (show each question's points while answering)
  wallet         '1' | ''           (award earned points to the wallet; needs registered + scoring + COMP_WALLET)
  attempts       1..20 (default 1)
  layout         paged | single     (one question per screen | all on one page)
  shuffleQ       '1' | ''
  shuffleC       '1' | ''
  timeLimit      minutes 0..600 (0 = none)
  maxSubmissions 0..100000 (0 = no cap)
  uniquePhone    '1' | ''           (open mode: one submission per phone number)
  fields         JSON [{ key, label, type, mode, options? }]   (§3.3)
  successText    ≤ 300
  enabled        '1' = include in the next publish | ''
  cardId         act-xxxxxxxx | ''  (linked Activities card in the content Sheet)
  liveVersion    version hash of the last published snapshot | ''
  publishedAt    Cairo stamp | ''
  closedAt       Cairo stamp | ''   (admin «اقفل دلوقتي»: closes immediately, before any publish)
  finalizedAt    Cairo stamp | ''   («اعتماد النتائج»)
  archived       '1' | ''
  createdBy, createdAt, updatedAt

Questions      (draft; one row per question)
  id             q-xxxxxxxx
  compId
  order          integer (gaps allowed; sorted ascending)
  type           single | multi | truefalse | short | long | number | info
  text           ≤ 600 (info: ≤ 2000)
  help           ≤ 300
  media          img-xxxxxxxx | ''
  choices        JSON [{ id:"c-xxxxxx", text ≤ 200 }]  (single/multi: 2..8; others: [])
  correct        JSON  single:"c-…" | multi:["c-…",…] | truefalse:"t"|"f"
                       | short:["accepted",…] (≥1 unless review=manual) | number:"40" | long/info: null
  points         0..10000 (info: 0)
  required       '1' | ''
  explanation    ≤ 1000
  explanationMedia img-xxxxxxxx | ''
  review         auto | manual | fallback   (short: fallback = no match → pending review;
                                             long is always manual; others auto)
  enabled        '1' | ''
  updatedAt

Snapshots      (what is LIVE; content-addressed; never edited)
  compId | version | part | json | publishedAt | publishedBy
  version = first 16 hex of sha256(definition JSON). json is the definition
  split into ≤ 45,000-char parts (part = 0,1,2…). Definition = §4.2.

Submissions    (one row per attempt)
  id             s-xxxxxxxxxxxx
  compId | version
  clientKey      the attempt's idempotency key (client UUID), unique per comp
  attemptNo      1..
  participantId  p-xxxxxxxx | ''     (registered mode)
  name           display name (registered: copied from the registry at start)
  phone          +20… text | ''
  fields         JSON { key: value } other form fields
  status         in_progress | submitted | pending_review | graded | void
  startedAt | submittedAt          Cairo stamps
  startedMs | deadlineMs | submittedMs   ms (deadlineMs 0 = no time limit)
  durationSec
  seed           order seed (shuffle) — the admin sees the order the person saw
  qids           JSON [qid,…] in the order served
  score          points earned (sum of awarded points)
  maxScore       sum of points of gradable questions
  correctCount | gradableCount | pendingCount
  flags          comma list: fast, late, dupPhone, preview…
  answers        JSON { qid: value }        (§5.2)
  grading        JSON { qid: { ok:true|false|null, pts, by:'auto'|email, at } }
  reviewedBy | updatedAt

Participants   (Phase 2)
  id p-xxxxxxxx | name | nameNorm | phone (+20…) | phoneNorm (10 digits) | group | church | notes
  status active|inactive | codeHash | codeEnc | codeVersion | codeIssuedAt | codeIssuedBy
  importBatch imp-xxxxxxxx|'' | createdBy | createdAt | updatedAt

PointsLedger   (Phase 3, append-only, never edited)
  id l-xxxxxxxxxxxx | participantId | amount (signed integer)
  kind competition|correction|manual|redeem|refund
  refType submission|redemption|'' | refId | compId | note | idemKey (unique) | actor ('' = system) | createdAt

StoreItems     (Phase 3)
  id i-xxxxxxxx | name ≤ 60 | description ≤ 500 | image img-…|'' | cost 1..1000000
  stock '' (unlimited) | 0..100000 (total quantity ever) | perPerson '' | 1..100
  category ≤ 30 | order | active '1'|'' | createdAt | updatedAt

Redemptions    (Phase 3)
  id r-xxxxxxxxxx | participantId | itemId | itemName (copy) | cost (copy)
  status pending|approved|fulfilled|cancelled | requestKey (idempotency, unique per participant)
  ledgerId | refundLedgerId | requestedAt | handledBy | handledAt | note | updatedAt
```

Derived, never stored as truth: a participant's balance (sum of their ledger
rows), an item's remaining stock (`stock` − redemptions not `cancelled`), a
competition's status (§2).

### 1.3 Locks

- Draft tabs (Competitions, Questions, Participants, StoreItems) are written
  by admin functions under the existing **script lock**.
- Live tabs (Submissions, PointsLedger, Redemptions) are written under
  `compLock_()`: `LockService.getUserLock()` (every request runs as the owner,
  so it is one shared mutex that is separate from the script lock that
  publishing holds), falling back to the script lock if the user lock is
  unavailable. Critical sections stay short: grade BEFORE taking the lock,
  then read one column + write one row.
- Every balance check and every ledger append happens under `compLock_()`.

### 1.4 Caches (CacheService; never a source of truth)

- `comp:def:<compId>:<version>` → live definition (chunked: 30,000 characters
  per value so even 3-byte characters stay under CacheService's 100 KB, `putAll`; 6 h).
- `comp:live:<slug>` → `{ compId, version, closedAt, finalizedAt }` (60 s;
  dropped by close / finalize / publish, so `closedAt` is honoured at once).
- `comp:keys:<compId>` → clientKey → row index map is NOT cached; the
  clientKey column is read under the lock (≤ a few thousand rows).
- `comp:draft` (chunked) → the two draft tabs' rows (what `apiState` builds
  from); `comp:draftsig` → their digest (see §4.4). Both dropped on every
  draft write and after a publish; `apiReview` / `apiPublish` drop them first
  and read the tabs themselves (never publish from a cache).
- `comp:shell` → the committed `competition/index.html` (10 min, §4.3).
- `comp:min:<minute>` (public budget), `comp:fail:<minute>` (failed codes).
- `reg:hash` → codeHash → participantId map (chunked), dropped on any code change.
- `wal:bal:<pid>` (a balance), `wal:retry` (reconciles that met a busy lock), `shop:img` (published store pictures) — §17.

## 2. Competition status (derived)

`compStatus_(comp, def, now, opts)` (CompModel.gs; `comp` = parsed row, `def`
= the LIVE definition or null, `opts.live` = the public's view — a published
competition keeps running until the next publish whatever the draft's
`enabled` / `archived` say — `opts.graceMinutes` for submits):

| Status | Meaning |
| --- | --- |
| `draft` | never published (`liveVersion` empty) or not `enabled` |
| `scheduled` | published, now < startAt |
| `open` | published, started, not ended, not `closedAt` |
| `closed` | now > endAt (+ grace for submits only) or `closedAt` set |
| `results` | closed and (`finalizedAt` set or `resultsAt` passed) |
| `archived` | `archived` = '1' |

The SERVER is the authority. Public start/submit always re-check with the
server clock (`cairoNow_()`), using the LIVE snapshot's dates plus `closedAt`.
Submit grace: an attempt started before the end may submit until
end + `COMP_GRACE_MINUTES` (3). `closedAt` («اقفل دلوقتي») refuses new
starts at once; attempts already started get the same 3-minute grace after
it (fairness), then `closed`. `endAt` is inclusive to the minute.

## 3. Modes

### 3.1 Axes (independent)

- participation: `open` | `registered`
- result: `scoring:''` (submission only) | `scoring:'1'` (score) | `scoring:'1'` + `wallet:'1'` (points)
- what the participant sees: `resultShow`, `resultsAt`, `answersShow`, `answersAt`

### 3.2 Presets in «مسابقة جديدة» (they only fill defaults)

| Preset | participation | scoring | resultShow | answersShow | wallet |
| --- | --- | --- | --- | --- | --- |
| استبيان بسيط | open | '' | none | never | '' |
| مسابقة عامة بدرجات | open | 1 | score | afterClose | '' |
| مسابقة بأكواد | registered | 1 | both | never | '' |
| مسابقة نقاط | registered | 1 | points | never | 1 |

Presets that need a disabled module are hidden.

### 3.3 Participant form fields (open mode)

`fields` = list of `{ key, label ≤ 40, type, mode, options? }`:
- keys: `name`, `phone`, `age`, `church`, `group`, `custom1`, `custom2`, `custom3`
- type: name→text, phone→phone, age→number, others text | select (options ≤ 12, each ≤ 40)
- mode: `required` | `optional` | `hidden`
- defaults: name required, phone required, others hidden.
- Registered mode ignores `fields` (identity comes from the code).

## 4. Publishing

### 4.1 One publish button

Competitions go out with the normal «راجع وانشر» (`apiReview` / `apiPublish`).
Nothing about a competition is public before that publish.

### 4.2 Live definition (snapshot)

At publish, for every competition with `enabled` = '1' and not archived:
`compDefinition_(row, questions)` builds
```
{ schema:1, id, slug, title, shortTitle, description, instructions, ctaLabel,
  banner:<image object|null>, icon:<image object|null>, theme,
  startAt, endAt, resultsAt, participation, scoring, resultShow, answersShow, answersAt,
  showPoints, wallet, attempts, layout, shuffleQ, shuffleC, timeLimit, maxSubmissions,
  uniquePhone, fields, successText,
  questions:[{ id, type, text, help, media, choices, required, points,
               correct, explanation, explanationMedia, review }] }   ← PRIVATE parts included
```
(dates in the `YYYY-MM-DDTHH:MM` form; image objects like content.json's;
flags `scoring`, `showPoints`, `wallet`, `shuffleQ`, `shuffleC`, `uniquePhone`,
`required` are JSON booleans; `attempts`, `timeLimit`, `maxSubmissions`, `points`
numbers; `fields` = the full §3.3 list in open mode, `[]` in registered mode;
`ctaLabel` defaults to «ابدأ المسابقة»; `correct` is null for long/info).
`version` = sha256(JSON)[0..16]. Snapshot rows are written BEFORE the commit
(content-addressed: an existing (compId, version) is left alone, one read +
one block) and, only after the commit lands, `liveVersion` / `publishedAt` are
set (a withdrawn competition gets `liveVersion` cleared). An "unchanged"
publish runs both steps again (idempotent), healing a publish that stopped
right after its commit.

### 4.3 Public files (one commit with content.json)

- `competition/<slug>/index.html` — generated from `competition/index.html`
  (the one engine shell, written by the public engine) by
  `compStubHtml_(def, siteUrl, version, shell)`. At publish `compShellText_()`
  reads the COMMITTED shell through the GitHub contents API (cached 10 min
  under `comp:shell`); a text is used only if it looks like the shell (an
  Arabic `<html>`, a CSP meta, `</head>`, `assets/js/comp/main.js`), else the
  built-in copy `COMP_SHELL_FALLBACK` (CompModel.gs: same CSP as index.html,
  `../` asset URLs, `<main id="comp-app">` + noscript). The stub = the shell
  with every `href="../` / `src="../` made `../../`, `<html … data-slug="<slug>"
  data-v="<version>">`, the shell's own `<title>`, description, canonical,
  `og:*`, `twitter:*` removed and the competition's put before `</head>`
  (absolute SITE_URL URLs, the banner as og:image, else the site's
  og-image). No other changes, so shell edits reach every stub on the next
  publish that commits. The CSP is the shell's (the fallback's equals
  index.html's — tested).
- `competition/<slug>/comp.json` — the PUBLIC definition:
```
{ schema:1, id, slug, v:<version>, title, shortTitle, description, instructions, ctaLabel,
  banner, icon, theme, startAt, endAt, resultsAt, participation, scoring, resultShow,
  answersShow, answersAt, showPoints, wallet, attempts, layout, timeLimit, fields,
  successText, questionCount, totalPoints, publishedAt }
```
  NO question text, NO choices, NO answers, NO explanations.
  (`publishedAt` = the Cairo wall time `YYYY-MM-DDTHH:MM` of the publish that
  made this version live; `questionCount` excludes info paragraphs;
  `totalPoints` = 0 when scoring is off.)
- content.json gains (additive; CONTENT_SCHEMA_VERSION stays 3; the key is
  present only when at least one competition is published, so content
  without competitions stays byte-identical):
```
"competitions": [{ id, slug, title, shortTitle, startAt, endAt, v }]
```
  and a linked card (Activities) gains `"competition": "<slug>"` and
  `"ctaLabel": "<the competition's button text>"`; its `cta` is null (the
  page makes the same-tab button).
- Media used by published competitions (banner, icon, question media,
  explanation media) are added to the publish's media list like any image.
- An unpublished competition (enabled turned off) gets
  `comp.json = { schema:1, slug, withdrawn:true }`; its stub stays (links don't 404).

### 4.4 Review and revision

- `draft.competitions` (read from the comp spreadsheet, cached under
  `comp:draftsig`) is passed into `buildPublicContent`; the content.json
  `competitions` entries include `v`, so ANY change to a competition's public
  files changes the content revision → «فيه تعديلات لسه متنشرتش» and the
  review list shows it (Review.gs group `competitions`: «مسابقة جديدة: …»,
  «تعديل مسابقة: … (٢٠ سؤال)», «مسابقة هتختفي: …»).
- Validation errors (e.g. a single-choice question with no correct answer,
  registered mode while the registry is off) are publish ERRORS that block
  the publish, shown in the review like other build errors.
- `apiState` stays fast: the comp draft is read through the cache; a cold read
  is one batched read of two tabs.

### 4.5 Card link

- Activities gets a lazy column `competition` (comp id; appended by the first
  card save, never a data upgrade). A copy of a card («استخدم تاني») is never linked.
- A card whose competition is not in this publish (disabled, archived,
  deleted, broken) is left out with a review warning.
- The builder's «اعرض كارت في قسم المسابقات» creates/updates the linked card
  (type `competition`; the type row is created from the seed if missing) and
  stores its id in `Competitions.cardId`. The card's title/subtitle/image/dates
  follow the competition at publish; the card editor shows them read-only
  with «بتتعدل من المسابقة».
- Public: an activity with `competition` gets its CTA from the client:
  same-tab link to `competition/<slug>/` (relative to the site root). Its
  state (soon/open/ended) follows the competition dates.
- Cards with an external `url` and no `competition` behave exactly as before.

## 5. Public API (no admin token)

All through the existing `doPost` with `{ fn, args:[arg] }` as `text/plain`,
dispatched BEFORE the admin token check, like `route` / `pushSubscribe`:
`if (/^(comp|portal|shop)[A-Z]\w*$/.test(fn)) return jsonOutput_(publicComp_(fn, arg, size))`
(`size` = the body's length; `readApiRequest_` returns it). Any unexpected
server error answers `busy` (nothing about the request is logged); an
unknown action answers `bad`.

Replies: `{ ok:true, … }` or `{ ok:false, code, message }` with Arabic
`message`. Codes: `bad` (malformed), `not_found`, `disabled`, `not_open`
(+`startAt`), `closed`, `busy` (budget/lock), `limit` (attempts/maxSubmissions/uniquePhone),
`expired` (attempt deadline / token), `invalid` (validation, + `field`/`qid`),
`code` (wrong participant code), `session` (participant token invalid → log in again),
`insufficient`, `stock`, `per_person`.

Limits: request body ≤ 64 KB for these actions (checked on `e.postData.length`
before parsing when possible, else after); budgets in CacheService:
all comp/portal/shop calls ≤ 300/min; failed code checks ≤ 30/min and ≤ 1,000/day
(on overflow: `busy`); a fixed ~300 ms pause after every failed code check.
Unknown keys are ignored; every value is type/length checked.

### 5.1 Endpoints

```
compStart   { slug, clientKey, fields?, ptoken?, hp? }
            → { ok, attempt:{ token, id, startedAt, deadlineMs, resumed, status, serverNow },
                comp:{ v, layout, showPoints, timeLimit, total },
                questions:[ PublicQuestion ],
                receipt?, result? }   ← only when this attempt was already sent (a reload)
  - not_open carries `startAt`; invalid carries `field` (the form key)
  - limits count SENT attempts (submitted / pending_review / graded; void
    never counts); identity = participantId (registered) or the normalized
    phone (open). Open mode without a phone field: only the clientKey
    identifies an attempt. Messages: «إنت شاركت في المسابقة دي قبل كده» /
    «خلّصت كل المحاولات المسموحة» / «الرقم ده شارك…» / «المسابقة اكتملت…»
  - the served order (shuffleQ / shuffleC) is a pure function of the seed
    (sha256(clientKey:compId)[0..12]): a retry before the row was written
    serves the same order too
  - live definition by slug; status must be open (server clock, closedAt)
  - registered: ptoken required (§7.4); identity = participant from the token
  - open: fields validated against the live `fields` spec; phone normalized
  - idempotent: same clientKey → the SAME attempt (same questions/order),
    `resumed:true`; a registered participant with an in_progress attempt for
    the same comp+version gets that attempt back (another device)
  - attempts / maxSubmissions / uniquePhone enforced here (and again at submit)
  - hp = honeypot (must be empty)
  - writes the Submissions row (status in_progress) under compLock_
  PublicQuestion = { id, type, text, help, media, choices:[{id,text}], required, points? }
  (points only when showPoints; NEVER correct/explanation/review)

compSubmit  { token, clientKey, answers }
            → { ok, receipt, result:Result }
  - token (attempt) verified; row by id; same clientKey
  - already submitted → the stored result again (idempotent replay)
  - window: now ≤ end + grace and (deadlineMs = 0 or nowMs ≤ deadlineMs + 60 s)
  - from 15 s before the time limit on (`COMP_TIMEUP_EARLY_MS`; the page sends by
    itself at zero and its clock may run a little ahead), unanswered required
    questions don't block: what was answered is graded
  - answers validated against the attempt's qids (unknown qids rejected,
    choice ids must belong to the question, length caps, required present)
  - graded with CompScore BEFORE taking compLock_; inside the lock: the row
    as it is now (one read), the limits again (one read of five columns, only
    when a limit can apply), one row write
  - flags: fast (< 2 s per question on average), late (in grace / past the
    time limit inside the 60 s slack)
  - errors: invalid carries `qid` (the first problem); a request over 64 KB
    is `bad` («الإجابات كبيرة قوي»)

compResult  { receipt } | { ptoken, submissionId }
            → { ok, result:Result }   (the policy at THIS moment)

Result = { status, submittedAt,
           score?, maxScore?, correctCount?, gradableCount?, pending?,   ← per resultShow/resultsAt
           pointsAwarded?,                                               ← wallet comps, when final
           resultsAt?, answersAt?,                                       ← "visible on …" hints
           review?: [{ id, type, text, media, choices, answer, correct, ok, pts, explanation, explanationMedia }] }
           ← ONLY when answersShow allows it now (immediately | afterClose & closed | atDate & passed)

  The questions and answers are the version the person was served; the
  POLICY (resultShow, resultsAt, answersShow, answersAt, endAt) and the key
  shown in `review` are the competition as it is live NOW (after a
  republish / regrade). The score shows when resultShow is score|both and
  (no resultsAt, or it passed, or the results are finalized); otherwise
  `resultsAt` is the hint. `review[].ok/pts` are null while the score is
  hidden; `correct` is null when scoring is off; info questions are not in
  `review`. afterClose before the close gives `answersAt` = endAt as a hint.
  A void submission's result is `{ status:'void', submittedAt }` only.

compCode    { code }            (Phase 2)
            → { ok, participant:{ name, group }, ptoken }   (§7.4)

portalMe    { ptoken }          (Phase 3 portal; works with the registry alone,
                                 wallet/shop parts present only when enabled)
            → { ok, participant:{ name, group }, features:{ wallet, shop },
                balance?, ledger?:[{ amount, kind, note, compTitle, createdAt }],
                history:[{ submissionId, compId, title, slug, submittedAt, status, score?, maxScore?,
                           pointsAwarded?, pending?, canReview }],   ← submissionId: what portalReview takes
                redemptions?:[{ id, itemName, cost, status, requestedAt }],
                shop?:[{ id, name, description, image, cost, category, available, perPersonLeft }] }

portalReview { ptoken, submissionId } → { ok, result:Result }  (Result with review when allowed)

shopRedeem  { ptoken, itemId, requestKey }   (Phase 3)
            → { ok, redemption:{ id, status, itemName, cost }, balance }
```

### 5.2 Answer values

single `"c-…"`; multi `["c-…",…]` (no duplicates); truefalse `"t"|"f"`;
short ≤ 200 chars; long ≤ 3000 chars; number: a string, Arabic/Persian digits
allowed, normalized to a finite number. Missing / `''` / `[]` = unanswered.

### 5.3 Tokens (stateless, HMAC-SHA256 with Script Property `COMP_SECRET`, auto-generated)

- attempt `at1.<b64url {s,c,v,d,e}>.<sig>` — submission id, comp id, version,
  deadlineMs, expiry = min(start + 48 h, end + grace + 15 min): kept loose so
  the server's own window check answers `closed` / `expired` precisely.
- The signature is `b64url(HMAC-SHA256("<kind>.<body>", COMP_SECRET text))`
  (43 characters); tokens are ≤ 1,500 characters.
- receipt `rc1.<b64url {s,c}>.<sig>` — kept by the page to re-check its result later.
- participant `pt1.<b64url {p,cv,e}>.<sig>` — participant id, codeVersion, expiry 3 h.
  Rejected when the participant is inactive or codeVersion changed (reset).
Signatures are compared in constant time. Secrets never leave Script Properties.

## 6. Scoring (CompScore.gs, pure — runs in Apps Script and Node)

- `compNormalizeText_(s)`: NFC; strip tashkeel (U+064B–U+0652, U+0670),
  tatweel U+0640, bidi marks (U+200E/F, U+061C, U+202A–E, U+2066–9);
  أ إ آ ٱ → ا; ة → ه; ى → ي; ؤ → و; ئ → ي; Arabic/Persian digits → ASCII;
  lowercase; collapse spaces; trim.
- `compGrade_(definition, answers, { qids?, at? })` → `{ grading, score, maxScore, correctCount, gradableCount, pendingCount, status }`
  (only the served `qids` count):
  single/truefalse exact; multi exact set; number exact (numeric compare);
  short normalized-equal to any accepted answer → full points, else 0, or
  pending (`ok:null`) when review = fallback; long → pending; info ignored;
  unanswered → 0 (ok:false). Scoring off → every question `ok:null, pts:0`,
  status `submitted`.
- `maxScore` counts gradable questions (everything but info).
- Short answers with review = manual are always pending.
- Manual grade: `compApplyManual_(grading, qid, pts, email, def, at)` → recomputed
  totals (null for info / unknown / scoring off). `pts`: `true` = full points
  («صح»), `false` = 0 («غلط»), a number 0..points (capped; ok = pts > 0), `null`
  = back to pending. Grading entries: `{ ok, pts, by: 'auto' | email, at }`.
- Regrade: `compRegrade_(def, answers, grading, qids, at)`: automatic marks
  follow the new key, entries with `by` ≠ 'auto' are kept.
- `compValidateAnswers_(def, qids, answers)` → `{ answers (clean), problems: [{ qid, message }] }`;
  multi answers are stored in the question's choice order; numbers as canonical text.
- `compAnswerKey_(q, value)` = the grouping key for «زي بعض» review.
- Status after grading: scoring off → `submitted`; any pending → `pending_review`; else `graded`.
- The browser never sends a score; anything score-like is ignored.

## 7. Registry and codes (Phase 2)

### 7.1 Code format
`ATH-XXXX-XXXX`, 8 characters from `23456789ABCDEFGHJKMNPQRSTVWXYZ` (30
symbols, no 0/O/1/I/L/U; ≈ 39 bits), rejection-sampled from SHA-256 of
`Utilities.getUuid()` output (bytes ≥ 240 skipped). Input normalization:
Arabic/Persian digits → ASCII, uppercase, drop spaces/dashes and a leading `ATH`.

### 7.2 Storage
- `codeHash` = HMAC-SHA256(normalized code, Script Property `CODE_PEPPER`), hex.
- `codeEnc` = `v1:` + base64url(nonce16 ‖ ct ‖ tag16) where
  `encKey = HMAC(CODE_KEY,'enc')`, `macKey = HMAC(CODE_KEY,'mac')`,
  `stream = HMAC(encKey, nonce)`, `ct = code XOR stream`,
  `tag = HMAC(macKey, 'v1' ‖ nonce ‖ ct)[0..16]`. Decrypt checks the tag first.
  Implemented (generic, tested) in CompCrypto.gs: `compEncrypt_(text, keyBytes)`,
  `compDecrypt_(text, keyBytes)` → text | null, keyBytes =
  `compSecretBytes_('CODE_KEY')`; for plaintexts over 32 bytes the stream
  continues with HMAC(encKey, nonce ‖ 1), HMAC(encKey, nonce ‖ 2), ….
- `CODE_PEPPER`, `CODE_KEY`, `COMP_SECRET`: 32 random bytes, base64, created
  on first use; never returned, logged or put in errors.
- Collision check against `codeHash` before saving.

### 7.3 Admin access
Authorized admins (the allowlist) can view/copy any current code through
`apiParticipantCode(id)` only (never in lists, state, heartbeat, Activity,
errors, push, URLs, QR codes, browser storage). Views are logged
(`code.view`, merged per admin+participant 10 min, no admin push). Export
`apiParticipantCodes({ batch? | ids? })` is logged (`code.export`).
`apiParticipantResetCode(id)` → new code, new hash/enc, codeVersion+1 (old
code and old participant tokens dead immediately), `reg:hash` cache dropped,
logged (`code.reset`), returns the new code once.

### 7.4 Login
`compCode {code}` → normalize → HMAC → lookup → active participant →
`{ participant:{ name, group }, ptoken }`. The page shows «الكود مسجل باسم …»
and the person confirms. Identity is NEVER taken from typed text in
registered mode.

### 7.5 Bulk import
Same flow and functions shape as Import.gs:
`apiParticipantsImportPreview(text)` (read-only) and
`apiParticipantsImportApply(text, decisions)` (script lock, re-classifies,
applies a row only if its fingerprint still matches). The browser turns XLSX
into tab-separated text. Classification (pure, `RegistryModel` part of
`CompRegistry.gs`): `error` / `exists` / `exists+update` / `dup` (in file) /
`new` with warnings `sharedPhone`, `sameName`, `oneWord`. Defaults: new
ticked; updates and sameName unticked; error/exists/dup not tickable.
Decisions `{ r<line>: 'add:<fp>' | 'update:<pid>:<fp>' | 'phone:<pid>:<fp>' }`.
Limits 500 rows / 300 KB. New rows get `p-…` ids, codes, `importBatch`.
Existing participants keep id and code. One Activity entry with counts.

## 8. Wallet (Phase 3)

- Balance = Σ ledger amounts of the participant (cached per participant, dropped on write).
- Competition points: `walletReconcile_(submissionId)` under compLock_:
  target = (competition wallet on AND submission status `graded`) ? score : 0;
  current = Σ ledger rows with refType submission and refId = id; if they
  differ, append ONE row (`competition` for the first, `correction` after)
  with idemKey `sub:<id>:<n>` (n = number of existing rows for it). Called
  after every grade change (auto at submit, manual review, regrade, void).
  Running it twice adds nothing.
- Manual adjustment `apiWalletAdjust(pid, amount, note, adjustKey)` → `manual`
  row, idemKey `adj:<adjustKey>`, logged.
- The ledger is append-only. There is no editable balance.

## 9. Store (Phase 3)

- `shopRedeem` under compLock_: valid ptoken, item active, available stock
  (stock − non-cancelled redemptions) > 0, per-person limit, balance ≥ cost;
  then append ledger `redeem` (−cost, idemKey `red:<redemptionId>`) and a
  Redemption (status `pending`). Same requestKey → the same redemption back.
- Admin statuses: pending → approved → fulfilled (pending → fulfilled allowed too); pending|approved → cancelled
  (appends `refund` +cost, idemKey `ref:<redemptionId>`, once). Fulfilled is
  final. Logged.

## 10. Admin API (all api*, in apiFunctions_, admin token + session)

Engine: `apiComps`, `apiComp(id)`, `apiCompCreate(input)`, `apiCompSave(id, input)`,
`apiCompDuplicate(id)`, `apiCompArchive(id, archived)`, `apiCompDelete(id)` (only
without submissions), `apiCompClose(id, open?)` (open === true takes «اقفل دلوقتي» back),
`apiCompFinalize(id, final)` (final === false takes it back),
`apiCompSettings(input)` (module switches),
`apiCompQuestionSave(compId, input)`, `apiCompQuestionDuplicate(compId, qid)`,
`apiCompQuestionDelete(compId, qid)`, `apiCompQuestionsReorder(compId, ids)`,
`apiCompImportPreview(compId, text)`, `apiCompImportApply(compId, text, decisions)`,
`apiCompPreviewGrade(compId, answers)` (draft key, writes nothing),
`apiCompPreviewDefinition(compId)` (draft public definition for the preview frame),
`apiCompSubmissions(compId, query)`, `apiCompSubmission(id)`,
`apiCompGrade(submissionId, grades)`, `apiCompGradeGroup(compId, qid, normAnswer, pts)`,
`apiCompReviewQueue(compId, qid?)`, `apiCompRegrade(compId)`, `apiCompVoid(submissionId, void)`,
`apiCompResults(compId)` (ranking + per-question stats), `apiCompExport(compId)` (rows for XLSX).
Registry: `apiParticipants(query)`, `apiParticipant(id)`, `apiParticipantSave(input)`,
`apiParticipantSetActive(id, active)`, `apiParticipantCode(id)`, `apiParticipantCodes(sel)`,
`apiParticipantResetCode(id)`, `apiParticipantsImportPreview(text)`, `apiParticipantsImportApply(text, decisions)`,
`apiParticipantsUndoImport(batch)` (only if none of them has submissions or ledger rows).
Wallet: `apiWallet(query)`, `apiWalletParticipant(id)`, `apiWalletAdjust(id, amount, note, key)`.
Store: `apiShopItems()`, `apiShopItemSave(input)`, `apiShopItemDelete(id)` (only without redemptions),
`apiShopRedemptions(query)`, `apiShopRedemptionStatus(id, status, note)`.

Comp admin functions do NOT go through `mutate_` (which returns the whole
panel state); they return their own data. They use `assertAdmin_()`, the
right lock, `activityNote_` + flush on success (same guarantees as `mutate_`),
and edit locks (`comp:<id>`, `participant:<id>`, `shopitem:<id>`) where two
admins could collide. Live writes (`apiCompGrade`, `apiCompGradeGroup`,
`apiCompRegrade`, `apiCompVoid`, and later every ledger / redemption write)
run only through `/admin/` (API mode): the recovery admin runs as the
visiting admin, whose user lock is not the public's, so it is refused there
(«تصحيح المسابقات من لوحة التحكم الرسمية بس»). Exact shapes: §16.

## 11. Activity log

New entity types: `competition`, `participant`, `points`, `shopitem`, `redemption`.
New actions (summaries in Arabic, no actor): `create`, `update`, `delete`,
`import` («استورد ٥٠ سؤال» / «استورد ٨٥ مشارك»), `review` («راجع ٣١ إجابة في س٧»),
`finalize`, `regrade`, `close`, `code.view`, `code.reset`, `code.export`,
`participant.phone`, `points.adjust`, `redemption.status`, `settings`.
Never a code, never a phone number, never answers in `changes`. A logging
failure never fails the action. As built: question edits are `update` rows
(«عدّل المسابقة «…»», merged within 10 min, a create absorbs them); `review`
rows merge per admin + competition and add up `changes.answers`
(«راجع ٣ إجابة في س٧ في المسابقة «…»»; void / unvoid are `review` with
`changes.void` → «لغى / رجّع مشاركة في …»); `regrade` → «صحّح المسابقة «…» تاني
(n مشاركة اتغيرت)»; `close` / `finalize` (+ reopen / undo); `import` →
«استورد ٥٠ سؤال في المسابقة «…»»; module switches → `settings` with title
«المسابقات». «سجل النشاط» filter section `competitions` = all five types.
Phase 2 / 3 as built: participant `import` and `code.export` push now; `code.reset`,
`points.adjust`, `redemption.status` with the cooldown; `code.view` never (§17.1).
Admin push: `competition` create / delete now, edits with the cooldown, the
rest never (like other content).

## 12. Push and bell

- The builder's «إشعارات» offers linked bell items (ids `notif-<cardId>`
  (opened, existing), `notif-<cardId>-start` (existing), `notif-<cardId>-closing`
  (1 h before end), `notif-<cardId>-results` (at resultsAt)), off by default
  except «لما تفتح». They are normal Notifications rows → published → the admin
  sends a push from the existing AdminPush flow if they want. Nothing is sent
  automatically.
- Notification target kind `competition:<slug>` (Notifications.target text,
  validated against the draft's slugs on save) → content.json
  `target: { kind: 'competition', slug }` (only while that competition is
  live in this publish; a known but unpublished one drops the bell item with
  a warning; an unknown slug is a publish error) → the bell/push open
  `/competition/<slug>/` (same tab). Done in `Hub.gs`, `Items.gs`,
  `Push.gs` (`pushUrl_`, and `pushItemState_` = hidden unless content.json
  lists the slug); and in `content.js`, `bell.js`, `sw.js` (`safeUrl` allows `/competition/<slug>/` and `/points/`).

## 13. Public pages

- `competition/index.html` — the ONE engine shell (also used by the admin
  preview with `?preview`). Generated stubs differ only in head tags and `data-slug` / `data-v`.
  The shell's URLs are relative to `/competition/` (`../assets/…`,
  `../manifest.webmanifest`, `href="../"`). **Stub rule** (`compStubHtml_`):
  every `href="../` / `src="../` becomes `href="../../` / `src="../../`, and
  `<html lang="ar" dir="rtl">` becomes `<html lang="ar" dir="rtl" data-slug="<slug>">`
  (optionally `data-v="<version>"`: comp.json is then fetched with `?v=`), plus
  the competition's own `<title>` / description / canonical / OG tags. The
  engine resolves everything else from `import.meta.url` (site root =
  `new URL('../../../', import.meta.url)`), never from the page address. The
  shell itself also works as `competition/?s=<slug>`.
- `points/index.html` — «نقاطي» + store (Phase 3), one stable page, code login.
- Engine modules `assets/js/comp/`: `api.js` (transport), `flow.js` (state
  machine, pure where possible), `view.js` (DOM), `save.js` (local autosave),
  `main.js` (boot), `config.js` (API URL = `push-config.js` `apiUrl`, the one
  source), `portal.js` (Phase 3). Styles `assets/css/comp.css` (self-contained:
  the site's tokens, fonts and themes; no main.css). No inline
  scripts/styles (CSP), `textContent` only, real form controls, RTL.
- Local autosave: `localStorage['athanasios.comp.v1:<slug>']` = `{ clientKey,
  token, receipt, answers, at, step }`, written on every change, cleared
  (except the receipt) after a confirmed submit. Offline submit is queued and
  retried with backoff when back online. Also kept while an attempt is in
  progress (all optional, validated on read): `v`, `fields` (the typed form,
  to repeat compStart), `ptoken`, `participant`, `attempt { id, startedAt,
  deadlineMs }`, `comp`, `questions` (as served, so a reload works offline),
  `pending` (a queued submit), `def` (the comp.json it started with),
  `submittedAt`. `step` = `q:<index>` | `single` | `review`.
- Main site: `#competition/<slug>` redirects to `competition/<slug>/`;
  `#points` → `points/` (router.js `pageForHash`; `location.replace`, so the
  back button returns to the site instead of bouncing on the redirect).
  content.json `competitions[]` and activity `competition` are sanitized by
  content.js; an activity with `competition` gets a same-tab CTA
  `competition/<slug>/` (label = its `cta.label` or «ادخل المسابقة»);
  notification `target: { kind: 'competition', slug }` is a same-tab link in
  the bell; sw.js allows exactly `/competition/<slug>/` and `/points/` (no
  query/hash) and `#competition/<slug>` / `#points` deep links.

### 13.1 What the engine sends (exact payloads)

All `POST <apiUrl>`, body `{"fn":<fn>,"args":[<arg>]}`, `Content-Type:
text/plain;charset=utf-8`, `credentials:'omit'`, `cache:'no-store'`,
redirects followed, 25 s timeout. Network errors / HTTP 5xx / 429 / non-object
replies and `code:'busy'` are retried (≤ 4 retries, backoff 0.8 s × 2ⁿ ×
0.5–1.5, cap 15 s) with the SAME body; every other `ok:false` is final.

```
compStart  open:        { slug, clientKey, fields:{ name?, phone?, age?, church?, group?, custom1..3? }, hp:'' }
           registered:  { slug, clientKey, ptoken }
             clientKey = crypto.randomUUID() (kept in the autosave; reused on retry/reload)
             fields: only visible fields with a value; phone normalized to 01xxxxxxxxx
             (or +<intl>), age as digits; the server re-validates everything
compSubmit { token, clientKey, answers:{ qid: value } }
             only answered, valid values; multi in choice order; short/long/number trimmed
             (number may contain Arabic digits); info never
compResult { receipt }          (reopening the page after a submit)
compCode   { code:'ATH-XXXX-XXXX' }   (normalized: Arabic digits → ASCII, uppercase,
                                       8 symbols of the §7.1 alphabet; else not sent)
```
Replies are re-validated (`flow.js` `cleanAttempt`, `cleanQuestions`,
`cleanStartComp`, `sanitizeResult`). Used error fields: `code`, `message`
(shown when present), `field` (compStart invalid), `qid` (compSubmit invalid),
`startAt` (not_open). A Result's `review` is rendered only when present.

### 13.2 «نقاطي» (points/index.html, `assets/js/comp/portal.js` + pure `portal-model.js`)

One stable page (no per-participant URL, `noindex`). Code entry and the
«الكود مسجل باسم …» confirm are the engine's own (view.js parts). The
`ptoken` is kept in `sessionStorage['athanasios.portal.v1']` only (this tab;
«خروج» removes it); a `session` reply anywhere → back to code entry;
`disabled` → «الصفحة دي مش متاحة دلوقتي». Requests (same transport as §13.1):
```
compCode     { code:'ATH-XXXX-XXXX' }
portalMe     { ptoken }                       on load (token in the tab) / after confirm / quietly after a redeem
portalReview { ptoken, submissionId }         «شوف إجاباتك» (only when history[].canReview)
shopRedeem   { ptoken, itemId, requestKey }   requestKey = randomUUID per confirmed request, REUSED when the
                                              previous try ended in network/busy (it may have landed); a new
                                              key after success or a final error
```
Balance and ledger show only with `features.wallet`, the store with
`features.shop` (and wallet). Store items: `available` = remaining stock
(null = unlimited; 0 → «خلصت»), `perPersonLeft` (null = no limit; 0 →
«وصلت للحد المسموح»). After a redeem the balance comes from the reply.
Error words: insufficient «رصيدك مش كفاية», stock «الجايزة دي خلصت»,
per_person «وصلت للحد المسموح من الجايزة دي».

### 13.3 Admin preview protocol

The admin opens `competition/index.html?preview` in a SAME-ORIGIN iframe.
The page only enters preview mode when its parent is same-origin (else it
leaves the frame / shows «المعاينة بتشتغل من لوحة التحكم بس»). It never
fetches comp.json, never calls the API and never touches localStorage
(in-memory autosave). Only messages with `event.source === window.parent`
and `event.origin === location.origin` are read.

```
page → parent  { type:'athanasios:comp-preview-ready' }                 on load
parent → page  { type:'athanasios:comp-preview',
                 definition: <public definition (comp.json shape) + questions:[PublicQuestion]>,
                 at: 'YYYY-MM-DDTHH:MM' (Cairo) | null (= now),
                 state: 'auto' | 'scheduled' | 'open' | 'closed',
                 images?: { '<media path>': 'blob:<same origin>/…' } }   (re)renders from scratch
page → parent  { type:'athanasios:comp-preview-shown', state:<step name> }
               { type:'athanasios:comp-preview-error', message }         unusable definition
page → parent  { type:'athanasios:comp-preview-submit', answers:{ qid: value }, id:<uuid> }
parent → page  { type:'athanasios:comp-preview-result', id:<same uuid>, result:<Result> }
```
The definition goes through the same sanitizer as comp.json (private keys such
as `correct` / `explanation` are dropped even if sent). Start is local
(`deadlineMs` = now + timeLimit). `compCode` answers «مشارك تجريبي». The
admin computes the result with `apiCompPreviewGrade(compId, answers)`; with
no reply within 30 s the page shows an error. `at` shifts the page's clock
(like the site preview); `state` other than `auto` forces the intro state.

## 14. Limits and scale

- ≤ 300 questions per competition; ≤ 8 choices; Snapshot parts ≤ 45,000 chars.
- Submissions row JSON: answers ≤ 40,000 chars total (validated).
- Expected load: tens to hundreds of participants per competition, bursts of
  ~100 submits per minute. Apps Script allows 30 simultaneous executions per
  owner account: the client retries `busy`/network errors with jittered backoff
  and idempotency keys make retries safe.
- Sheets: ~30 cells per submission → decades of headroom under 20M cells.

## 15. Security checklist (tested)

- No answer key, explanation or question text in any GitHub file.
- No `correct`/`explanation`/`review` in `compStart` replies; review data only
  when the policy allows at that moment.
- Scores computed only by the server; client values ignored.
- Server clock for every window; `closedAt` honoured immediately.
- Idempotent start/submit/redeem; attempts, maxSubmissions, uniquePhone enforced server-side.
- Codes: hash + encrypted copy; admin-only retrieval; never logged/exposed.
- Code brute force: 39-bit codes + global failure budget + pause.
- Ledger append-only, unique idemKeys, every balance-changing write under compLock_.
- Stock and balance checked and written under the same lock (no double spend).
- No PII in content.json / comp.json / push payloads / Activity `changes`.

## 16. Phase 1 server: implementation reference

Files: `CompStore.gs` (spreadsheet, tabs, batched rows, `compLock_`, caches,
`compDraft_`, `compLive_`, `compDefinitionFor_`), `CompModel.gs` (pure:
validation, presets, status, definition, comp.json, stub), `CompScore.gs`
(pure: normalization, answers, grading), `CompCrypto.gs` (secrets, tokens,
encryption), `CompPublic.gs` (public actions), `CompAdmin.gs` (admin API),
`CompPublish.gs` (publish hooks). Hooks in `Api.gs`, `Store.gs` (`readDraft_`
→ `draft.competitions`; Activities lazy column), `Content.gs`, `Hub.gs`,
`Items.gs`, `Media.gs` (`mediaUsage_` area `competitions`), `Review.gs`
(`describeChanges(previous, next, now, info)`, info = `{ competitions: { id: count } }`),
`Activity.gs`, `Presence.gs` (`LOCK_KINDS` + comp, participant, shopitem),
`Push.gs`, `Publish.gs`. Tests: `tests/comp-*.test.mjs`
(`tests/fakes/comp.mjs` = the shared set-up).

### 16.1 Admin replies (every function: `assertAdmin_()` first)

```
apiComps() → { ready (spreadsheet exists), comps:[Summary], modules:{registry,wallet,shop},
               presets:[{ key, label, participation, scoring, resultShow, answersShow, wallet }],
               limits: COMP_LIMITS, types:{ single:'اختيار واحد', … }, statuses:{ in_progress:'لسه بيحل', … },
               now, siteUrl }
Summary = { id, slug, title, shortTitle, status, startAt, endAt (stored "YYYY-MM-DD HH:MM"),
            participation, scoring, wallet, enabled, archived, liveVersion, draftVersion,
            hasChanges, problems (count), publishedAt, closedAt, finalizedAt, cardId,
            questionCount, submissions (sent), pending, inProgress, updatedAt, url }
apiComp(id) → { comp: Comp, questions:[AdminQuestion] (in order), summary, problems:[text],
                draftVersion, liveVersion, card:{ id, enabled, title } | null, modules, limits, types, now }
Comp = every Competitions column for the builder (booleans as booleans, numbers as
       numbers, fields as the §3.3 list, dates as stored "YYYY-MM-DD HH:MM")
AdminQuestion = { id, order, type, text, help, media, choices:[{id,text}], correct, points,
                  required, explanation, explanationMedia, review, enabled, problems:[text] }
apiCompCreate({ preset?, …Comp fields }) → apiComp(new id)   (no slug → "comp-xxxxxx"; enabled defaults off)
apiCompSave(id, { …Comp fields, card?: true|false }) → apiComp(id)   (fields left out keep their value)
apiCompDuplicate(id) → { id, comp: apiComp(copy) }      apiCompArchive / Close / Finalize → apiComp(id)
apiCompDelete(id) → { deleted:true, id }               apiCompSettings(input) → { modules }
apiCompQuestionSave(compId, Question) → { question: AdminQuestion, warnings:[text], count }
apiCompQuestionDuplicate(compId, qid) → { question, questions }
apiCompQuestionDelete(compId, qid) → { deleted:true, count }
apiCompQuestionsReorder(compId, ids) → { questions }   (ids = exactly the competition's)
apiCompImportPreview(compId, text) → { rows:[{ line, status:'ok'|'error', errors, warnings, fp,
                                       question:{ order, type, typeLabel, text, choices:[text], correct
                                       (display: text | [text] | 'صح'/'غلط' | [accepted] | number),
                                       points, required, review, image, explanation } }],
                                       counts:{ ok, error, warnings }, problems, columns, ignored, fingerprint, max:300 }
apiCompImportApply(compId, text, { 'r<line>': 'add:<fp>' }) → { added, skipped, errors, rows:[{ line, result, reason }], count }
apiCompPreviewGrade(compId, answers) → { problems:[{qid,message}], score, maxScore, correctCount,
                                         gradableCount, pendingCount, status, grading,
                                         review:[{ id, correct, explanation, explanationMedia, answer, ok, pts }] }
apiCompPreviewDefinition(compId) → { comp: comp.json shape of the draft, questions:[PublicQuestion], v, problems, status }
apiCompSubmissions(compId, { status:'all'|'done'|<status>, q, flag, sort:'submittedAt'|'score'|'duration'|'name',
                    dir:'asc'|'desc', offset, limit ≤ 200 }) → { items:[Item], total, offset, limit, counts }
Item = { id, version, attemptNo, participantId, name, phone, fields, status, startedAt, submittedAt,
         durationSec, score, maxScore, correctCount, gradableCount, pendingCount, flags:[…], reviewedBy }
apiCompSubmission(id) → { submission: Item, comp:{ id, title, slug, scoring, liveVersion }, version, latest,
                          questions:[{ number, id, type, text, help, media, choices (served order), correct,
                                       points, explanation, review, answer, answerText, key, grade }] }
apiCompGrade(submissionId, { qid: true|false|points|null }) → apiCompSubmission(id)
apiCompGradeGroup(compId, qid, key, pts) → { updated, queue: apiCompReviewQueue(compId, qid) }
apiCompReviewQueue(compId, qid?) → { questions:[{ qid, number:'س٧', text, type, points, pending }],
                                     groups:[{ qid, key, sample, count, ids (≤ 100) }], total }
apiCompRegrade(compId) → { regraded, changed }          apiCompVoid(id, void) → apiCompSubmission(id)
apiCompResults(compId) → { ranking:[{ rank, id, participantId, name, phone, score, maxScore, durationSec,
                           submittedAt, status, pending, attempts }], stats:{ submissions, participants,
                           average, top, maxScore, pending }, questions:[{ qid, number, text, type, points,
                           answered, correct, wrong, pending, rate, choices? }], finalizedAt }
apiCompExport(compId) → { filename, header:[text], rows:[[cell]] }   (Arabic headers; answers as choice text)
```

Question input (editor and import): `{ id?, type, text, help, media, choices:
[{ id?, text, correct? }], correct, points, required, explanation,
explanationMedia, review, enabled, order? }` — the WHOLE question on every
save. `correct` may be a choice id / ids, a 0-based position, `'t'|'f'|'صح'|'غلط'|true|false`,
accepted answers (array or text split on `|`), or a number; or flag choices
with `correct: true`. Valid existing choice ids are kept. Empty points = 100
(`COMP_DEFAULT_POINTS`). A missing key saves (a warning) and blocks the
publish when scoring is on.

### 16.2 Question import template (first sheet / paste, one row per question)

Headers (Arabic, English accepted; spelling, hamza, ة/ه and spaces are
forgiven): `ترتيب`(order) · `السؤال`(question, required column) · `النوع`(type) ·
`اختيار 1`…`اختيار 8`(choice1…choice8) · `الإجابة الصحيحة`(correct) · `الدرجة`(points) ·
`إجباري`(required) · `التوضيح`(explanation) · `صورة`(image) · `مراجعة`(review).
Types: اختيار واحد/single, اختيارات متعددة/multi, صح وغلط/truefalse, إجابة قصيرة/short,
إجابة مفتوحة/long, رقم/number, فقرة/info (empty type with ≥ 2 choices = single).
Correct: choice number(s) (Arabic digits ok) separated by ، or , — or the
exact choice text; truefalse صح/غلط/صحيح/خطأ/true/false/t/f; short: accepted
answers separated by `|`; number: a number; long/info: ignored. Points: empty
= 100. Required: نعم/لا/yes/no/1/0, empty = نعم. Image: empty or a library
`img-xxxxxxxx`. Review: empty = تلقائي, يدوي/manual, «مراجعة لو مش مطابق»/fallback
(short only; elsewhere a warning, ignored). Order: empty = after the last
question, in file order. Import only ADDS (no update by matching in v1).
Limits: 300 rows, 400 KB, and 300 questions per competition. Errors (row not
importable, «صف ١٢، الإجابة الصحيحة: «٥» مش من الاختيارات»): unknown type,
missing text, a choice question with < 2 choices, a key that is not a
choice, a single with two keys, a number key that is not a number, an
unknown image, bad points / required / review; when the competition is
SCORED also a missing key for single / multi / truefalse / number. Warnings:
short with no accepted answers and automatic review, 0 points, the same
question text in the file or already in the competition. Then the editor's
own validation runs on every row.

### 16.3 Hooks for Phase 2 / 3 (define these globals; Phase 1 checks `typeof`)

- Module present: `compRegistryReady_()`, `compWalletReady_()`, `compShopReady_()`
  (a switch can be turned on only when its function exists; `compModules_()`
  = switch on AND code installed).
- Public actions: `compCodeAction_(arg)`, `portalMeAction_(arg)`,
  `portalReviewAction_(arg)` (module registry), `shopRedeemAction_(arg)`
  (module shop) — `CompPublic.gs COMP_MODULE_ACTIONS`; they run after the
  size check and the shared budget and must return the reply object.
- `compParticipantFromToken_(ptoken)` → `{ id, name, group, phone }` | null (registered
  compStart / compResult; null → `session`).
- `walletReconcile_(submissionId)` (called after every grade change: submit,
  manual review, group review, regrade, void; failures are swallowed) and
  `walletPointsFor_(submissionId)` → number (Result.pointsAwarded).
- Helpers ready for `compCode`: `compCodeBudgetOk_()` (≤ 30/min, ≤ 1,000/day),
  `compCodeFailed_()` (counts + 300 ms pause); `compSignToken_('pt1', { p, cv, e })`,
  `compReadToken_('pt1', token)` → `{ ok, payload }` | `{ ok:false, reason:'bad'|'expired' }`;
  `compSecret_('CODE_PEPPER')`, `compEncrypt_` / `compDecrypt_`; `compSheet_('Participants')`
  etc. create the Phase 2/3 tabs on first use; `compAppend_`, `compUpdate_`,
  `compColumns_`, `compRows_` are the batched row helpers; `compLock_()`.


## 17. Phase 2 / 3 server: implementation reference

Files: `CompRegistry.gs` (pure part: `normName_`, `normPhoneEg_`, the code
format, `regCheckPerson_`, `planParticipantImport_`; storage, codes, admin,
`compCode`, `compParticipantFromToken_`, and the portal actions `portalMe` /
`portalReview`, which need only the registry), `CompWallet.gs` (ledger,
`walletReconcile_` / `walletReconcileMany_`, admin, the portal's wallet part),
`CompStoreItems.gs` (items, redemptions, `shopRedeem`, the portal's store part).
Small hooks: `CompPublic.gs` (registered compStart copies the registry's
phone; `compAfterGradeMany_`), `CompAdmin.gs` (regrade / group grade reconcile
in one batch), `CompStore.gs` (`compDraft_` carries `items`), `CompModel.gs`
(`compBuildPublic_` adds active store pictures to the media list while the
store is on), `Media.gs` (`mediaUsage_`: store pictures, area `competitions`,
label «جايزة في المتجر: …»), `Publish.gs` (`mediaWaiting_`: an "unchanged"
publish still commits when a used picture was never uploaded — a store
picture is not in content.json), `Activity.gs` (summaries, push decisions),
`Api.gs`. Tests: `tests/comp-registry.test.mjs`, `comp-wallet.test.mjs`,
`comp-shop.test.mjs` (`tests/fakes/reg.mjs` = the shared set-up).

### 17.1 Decisions (where the contract left room)

- Admin WRITES of a module need its switch on (`«…» مش متفعّل`); reads keep
  working while it is off (data is kept), and so do the code functions
  (`apiParticipantCode(s)`, `apiParticipantResetCode`: admins may always
  view / copy / reset codes). Public actions answer `disabled`.
- Phones: `normPhoneEg_` accepts 01…, 1… (a spreadsheet dropped the 0), +20 /
  0020 / 20 prefixes, "+20 0…", Arabic / Persian digits, spaces, dashes, dots,
  parentheses, bidi marks; valid = `^1[0125]\d{8}$` after the prefixes;
  stored `phone` = `+201XXXXXXXXX`, `phoneNorm` = `1XXXXXXXXX`; admin replies show
  the local `01XXXXXXXXX` as `phone` (+ `phoneIntl`). Reasons: «رقم الموبايل ناقص»,
  «رقم الموبايل ناقص رقم (١٠ أرقام بدل ١١)», «رقم الموبايل زيادة رقم (١٢ رقم بدل ١١)»,
  «الرقم مش رقم موبايل مصري», «رقم الموبايل فيه حروف أو رموز».
- Names: required, ≤ 80, ≥ 3 letters, not digits only; one word = a warning.
  `nameNorm` = `compNormalizeText_` without punctuation. Duplicate = same
  nameNorm + phoneNorm. A phone is required for every participant.
- A new participant's code is NOT in the save reply: the admin page calls
  `apiParticipantCode` (logged `code.view`). Only the reset returns a code
  directly (once, logged `code.reset`).
- `apiParticipantCodes({ all:true })` = ACTIVE participants (≤ 3,000);
  `{ batch }` / `{ ids }` include inactive ones.
- compCode: the budget is checked first (then `busy`, even for a right code);
  malformed, unknown, inactive and wrong codes all count, pause ~300 ms and
  answer `code` «الكود ده مش صحيح. اتأكد منه وجرّب تاني.». `reg:hash` misses are
  re-checked against the tab (a stale cache never refuses a real code).
- Wallet target per submission = (the competition's LIVE definition — else
  the served version — has `wallet` and `scoring`) AND status `graded` ? score : 0.
  Open submissions never touch the ledger. Reconcile: the candidates
  (registered rows) are found before the lock; inside it one read of the
  Submissions columns and of the ledger's refType / refId / amount / idemKey,
  one append block. Lock busy → the ids wait in `wal:retry` (cache, 6 h) and
  are taken along by the next reconcile or by `apiWallet`.
- `apiWalletAdjust` refuses a result below zero («مينفعش الرصيد يبقى بالسالب …»);
  the note is shown to the participant in «نقاطي» (ledger `note`).
- Store: `pending → fulfilled` directly is allowed (handing the prize over
  without the «approved» step). The same status again changes nothing
  (`changed:false`; a second cancel never refunds twice). `stock` may not go
  below the requests already taken. An item with requests can't be deleted
  (switch it off instead).
- Store pictures: active items of a switched-on store join the publish's
  media list; «نقاطي» shows an image object only when `Media.publishedAt` is
  set (cache `shop:img`, 5 min). The review may say "no changes" while a new
  store picture waits; «انشر» still uploads it. `apiShopItems` gives
  `imagePublished` so the admin page can say «الصورة هتظهر بعد النشر».
- Admin push (`activityNotifyKind_`): participant `import` and `code.export` now;
  `code.reset`, `points.adjust`, `redemption.status` with the cooldown; `code.view`
  never; participant / store item create / update / delete never.
- Caches added: `wal:bal:<pid>` (6 h), `wal:retry`, `shop:img` (5 min).

### 17.2 Registry replies

```
Person = { id, name, phone ('01…'), phoneIntl ('+201…'), group, church, notes, status:'active'|'inactive',
           active, codeVersion, codeIssuedAt, hasCode, importBatch, createdAt, updatedAt }
           (+ balance when the wallet is on, in apiParticipants)   ← NEVER code / codeHash / codeEnc
apiParticipants({ q, group, status:'all'|'active'|'inactive', sort:'name'|'group'|'createdAt'|'updatedAt'|'balance',
                  dir:'asc'|'desc', offset, limit ≤ 200 })
  → { ready, items:[Person], total, offset, limit, counts:{ all, active, inactive },
      groups:[{ name, count }], batches:[{ id:'imp-…', count, at }] (≤ 20, newest first), modules }
  q: a name (normalized, contains), any phone form (≥ 3 digits, contains), or an id
apiParticipant(id) → { participant: Person, history:[{ submissionId, compId, title, slug, attemptNo, status,
                       startedAt, submittedAt, score, maxScore, pending, points (null without the wallet) }],
                       wallet:{ balance, earned, adjusted, spent, entries, lastAt } | null, modules }
apiParticipantSave({ id?, name, phone, group, church, notes })   (fields left out keep their value on an edit)
  → { participant: Person, created, warnings:[text] }
  errors (appError_, .field = name|phone|group|church|notes): name/phone reasons above;
  «المشترك ده متسجل قبل كده: … » (same name + phone). Warnings: «نفس الرقم متسجل كمان لـ: …»,
  «فيه مشترك تاني بنفس الاسم برقم تاني», «الاسم كلمة واحدة بس: …». Edit lock participant:<id>.
apiParticipantSetActive(id, active) → { participant: Person }   (false = code and tokens stop at once)
apiParticipantCode(id) → { id, code:'ATH-XXXX-XXXX', codeVersion }        (logged code.view, merged 10 min)
apiParticipantCodes({ batch } | { ids:[…] } | { all:true })
  → { rows:[{ id, name, phone, group, code }] (by group, then name), count, filename }   (logged code.export)
apiParticipantResetCode(id) → { id, code, codeVersion }                     (logged code.reset)
apiParticipantsImportPreview(text)
  → { rows:[ImportRow], summary, groups:[{ name, count, isNew }], problems:[text], columns:[key], ignored:[header],
      fingerprint, max:500 }
  ImportRow = { line, status:'error'|'exists'|'dup'|'new', name, phone ('01…' or as typed), group, church, notes,
                errors:[text], warnings:[{ kind:'sharedPhone'|'sameName'|'oneWord', text,
                candidates?:[{ id, name, phone, group, status }] }], reason (exists / dup: «نفس صف ١٢»),
                match:{ id, name, phone, group, status } | null (exists), changes:[{ field, label, from, to }]
                (exists with different group / church / notes = the optional update), dupOf, fp,
                tickable, ticked (default), choices:[{ value, label }] }
    choices.value is exactly what goes into decisions: 'add:<fp>' (new), 'update:<pid>:<fp>' (exists with
    changes), 'phone:<pid>:<fp>' (new with a same-name registered candidate = «نفس الشخص: غيّر رقمه»).
    Defaults: new ticked unless it has a sameName warning; updates unticked; error / exists / dup not tickable.
  summary = { total, new, exists, update, dup, error, ticked, warnings:{ sharedPhone, sameName, oneWord } }
  Template headers: الاسم بالكامل · رقم الموبايل · المجموعة / الفصل · الكنيسة · ملاحظات (aliases: الاسم/اسم/Name,
  الموبايل/التليفون/Phone, المجموعة/الفصل/Group, Church, Notes); a file without a header row = that order.
apiParticipantsImportApply(text, { 'r<line>': choice value })
  → { added, updated, phoneUpdated, skipped:{ unticked, changed, error, exists, dup }, changed, batch ('' when none
      added), rows:[{ line, result:'added'|'updated'|'phone'|'skipped'|'error', reason, id? }], total }
  (re-planned under the script lock; a row applies only when its choice is still offered with the same fp)
apiParticipantsUndoImport(batch) → { removed, batch }   (only the participants that batch ADDED; refused when
  any of them has a submission or a ledger row)
```

### 17.3 Wallet replies

```
apiWallet({ q, group, status, sort:'balance'|'earned'|'spent'|'lastAt'|'name', dir, offset, limit ≤ 200, all? })
  → { items:[{ id, name, phone, group, status, balance, earned, adjusted, spent, entries, lastAt }], total, offset,
      limit, totals:{ participants, balance, earned, adjusted, spent, entries }, modules }
  (only participants with ledger rows unless all:true; default sort balance desc)
  earned = competition + correction, adjusted = manual, spent = −(redeem + refund)
apiWalletParticipant(id) → { participant: Person, balance, totals, entries:[{ id, amount, kind, kindLabel, note,
                             compId, compTitle, refType, refId, redemption:{ id, itemName, status } | null, actor,
                             createdAt, balanceAfter }] (newest first) }
apiWalletAdjust(id, amount, note, adjustKey) → { entry:{ id, amount, kind:'manual', note, createdAt }, balance, replay }
  amount: non-zero integer, |amount| ≤ 1,000,000; note required ≤ 200; adjustKey /^[A-Za-z0-9_-]{8,64}$/
  (a new key per confirmed form; the same key again → replay:true, no new row). Official admin only.
```

### 17.4 Store replies

```
AdminItem = { id:'i-…', name, description, image ('img-…'|''), imageObj (library image object | null),
              imagePublished, cost, stock (null = unlimited), perPerson (null = no limit), category, order, active,
              redeemed (requests not cancelled), pending, available (null = unlimited), createdAt, updatedAt }
apiShopItems() → { ready, items:[AdminItem] (by order), categories:[text], modules, limits, statuses:{ pending:'مستني', … } }
apiShopItemSave({ id?, name, description, image, cost, stock, perPerson, category, order, active })
  → { item: AdminItem }   (fields left out keep their value; edit lock shopitem:<id>)
apiShopItemDelete(id) → { deleted:true, id }   (refused when the item has any request)
AdminRedemption = { id:'r-…', participantId, participantName, group, itemId, itemName, cost, status, statusLabel,
                    next:[status], requestedAt, handledBy, handledAt, note, refunded }
apiShopRedemptions({ status:'all'|'open'|'pending'|'approved'|'fulfilled'|'cancelled', participant, item, q,
                     offset, limit ≤ 200 })
  → { items:[AdminRedemption] (newest first), total, offset, limit, counts:{ all, pending, approved, fulfilled, cancelled } }
apiShopRedemptionStatus(id, status:'approved'|'fulfilled'|'cancelled', note?) → { redemption: AdminRedemption, balance, changed }
  (official admin only; cancel = refund row once)
```

### 17.5 Public replies as built

- `compCode` → `{ ok, participant:{ name, group }, ptoken }`; errors `bad`, `code`, `busy`, `disabled`.
- `portalMe` → exactly §5.1. `history` = every attempt of the participant
  (newest first; in_progress / void included, with their status), values per
  the result policy NOW (`score`/`maxScore`/`pending`/`pointsAwarded` only when
  the competition shows them), `canReview` = the review is allowed now.
  `balance`/`ledger` (≤ 200, newest first; `note` = the admin's note or the prize
  name) with the wallet; `redemptions`/`shop` with the store (active items, by order).
- `portalReview` → `{ ok, result }` (§5.1 Result); `not_found` for someone else's submission.
- `shopRedeem` → `{ ok, redemption:{ id, status, itemName, cost }, balance }` (+ `replay:true` for a
  repeated requestKey); errors `bad`, `session`, `busy`, `not_found` («الجايزة دي مش متاحة دلوقتي.»),
  `stock` «الجايزة دي خلصت.», `per_person` «وصلت للحد المسموح من الجايزة دي.»,
  `insufficient` «رصيدك مش كفاية.» (+ `balance`).
