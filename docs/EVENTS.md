# Events, bookings and service pages

Booking events (trips, conferences, fun days) with servant-handled payments,
permanent service / media pages (Black Theatre, Silent Theatre), and optional
partner co-branding (Brave Under Grace – B.U.G.).

This file is the build contract, in the style of `COMPETITIONS.md`. Names here
(tabs, columns, functions, JSON fields, statuses, error codes) are binding. If
an implementation detail forces a change, change it HERE first.

Status: **Phase 0 (contract). Nothing below is built yet.**

---

## 0. Principles and modules

- **The public site stays static.** Event and service pages are generated HTML
  stubs plus a JSON file per page, committed by the normal publish. Only
  booking actions (`book*`) call Apps Script.
- **Private data never reaches GitHub.** Bookings, phones, payments, proofs
  and servant phone numbers (except the WhatsApp links an admin chose to
  publish, §9) live only in the private module spreadsheet and a private Drive
  folder.
- **Payments are append-only.** No amount is ever edited or deleted. A
  correction is a new row that voids an older one.
- **Totals are derived.** `paid`, `remaining`, `paymentStatus`, seat counts
  and every report are computed from the rows, never stored as editable values.
- **Pending bookings never take places.** Only confirmed ones do.
- **No page exists only as a URL.** Every event and service page can have a
  home-page card, created and updated automatically by the shared page system
  (§1.2). The card can be hidden or reordered without touching the page.

| Module | Files | Switch (Script Property) | Depends on |
| --- | --- | --- | --- |
| Pages | `Pages.gs`; `pages/index.html` (shell); `assets/css/page.css`, `assets/js/page/*`; `AdminPages.html` | `PAGES_MODULE` = `'1'` | nothing |
| Partners | `Pages.gs` (§12); intro in `assets/js/page/collab.js` | always on with Pages or Events | — |
| Events | `BookModel.gs` (pure), `BookStore.gs`, `BookPublish.gs`; `events/index.html` (shell); `assets/js/page/event.js`; `AdminEvents.html` | `EVENTS_MODULE` = `'1'` | nothing |
| Booking | `BookPublic.gs`, `BookAdmin.gs`, `BookPay.gs`; `assets/js/page/booking.js`, `status.js`, `image.js`; `AdminBookings.html` | `BOOKING_MODULE` = `'1'` | Events |

A switch that is off hides its admin screens. Its public actions answer
`{ ok:false, code:'disabled' }`. Its data is kept.

`BookModel.gs` contains no Google API calls. It holds validation, pricing,
capacity and accounting, and runs in Apps Script and Node (tests), like
`CompScore.gs`.

---

## 1. Storage

> **Revised 2026-10-15 (backend migration, docs/BACKEND-MIGRATION.md).**
> The booking engine is built on the Cloudflare Worker, not Apps Script.
> - **Data:** Bookings, Payments and Proofs live in **D1**
>   (`worker/drafts/0002_bookings.sql`, applied when the pilot is approved).
> - **Proof files:** in the private **R2** bucket `athanasios-private`, not Drive.
> - **Events, Servants, PayMethods** stay edited in the Sheet (Apps Script)
>   for now. Their bookable part is synced to D1 (`event_cfg`, `servants`,
>   `pay_methods`) on save/publish.
>
> **What stays binding:** the tab and column names below. D1 columns are their
> snake_case twins, so a reverse export to Sheets is a straight copy.
> Statuses, rules and error codes are unchanged.
>
> **What the Worker replaces:**
> - `compLock_` → guarded single statements / atomic batches + UNIQUE keys
>   (`worker/test/bookings-draft.test.mjs`).
> - `driveId` → `r2_key`.
> - The `book*` doPost actions → Worker routes with the same names and replies.
>
> The original Sheets wording follows for reference.

**Spreadsheet (original plan, superseded).** All tabs below live in the existing private module
spreadsheet (`COMP_SHEET_ID`, `compSpreadsheet_()`), in a new list
`BOOK_TABLES` next to `COMP_TABLES`:

- tabs and missing columns are created on first use (`compSheet_`), so there
  is no `Migrate.gs` step;
- writes are batched (`compAppend_` / `compUpdate_`);
- every text cell goes through `plainCell_`.

**Locks (original plan, superseded — see the note above).**
- Every booking-state, payment and capacity write runs under `compLock_`.
- Drive uploads always run outside the lock (§18.1 of `COMPETITIONS.md`).

**Formats.**
- Times are Cairo wall-clock text `YYYY-MM-DD HH:MM`; columns marked `ms` are
  epoch milliseconds.
- Booleans are `'1'` / `''`. JSON columns hold compact JSON text.
- **Money is whole Egyptian pounds (EGP), stored as an integer string.** No
  decimals and no currency symbol in data.

**Ids.** Each id is a prefix plus 8 lowercase base32 characters:

| Prefix | What |
| --- | --- |
| `evt-` | event |
| `bkg-` | booking |
| `pay-` | payment row |
| `prf-` | proof |
| `srv-` | servant |
| `pg-` | service page |
| `pm-` | page media card |
| `ptn-` | partner |

**Booking reference** (shown to people): `B-` plus 5 Crockford base32
characters (no I, L, O, U), unique per event.

### 1.1 Tabs

```
Servants          (one registry: payment receivers AND page team contacts)
  id            srv-…
  name          ≤ 60
  phone         normalized +E.164 (compNormPhoneEg_)        PRIVATE
  role          ≤ 40  (e.g. «أمين الرحلة»)  shown on pages
  image         img-… | ''
  active        '1' | ''
  publicWa      '1' | ''   consent to show a wa.me link on published pages
  note          ≤ 200      PRIVATE
  updatedAt

PayMethods
  key           [a-z][a-z0-9_]{1,19}   seeded: cash, instapay, wallet
  label         ≤ 24       (كاش / إنستاباي / محفظة)
  icon          icon key (icons.js) | ''
  needsProof    '1' | ''   visitor must attach a proof (cash: '')
  order, active

Events            (draft definitions)
  id            evt-…
  slug          [a-z0-9-]{2,40} (COMP_SLUG rules), unique, LOCKED after first publish
  kind          trip | conference | funday        (EVENT_KINDS; = a Types key)
  enabled, archived
  title ≤ 80 · shortTitle ≤ 30 · summary ≤ 200 · body ≤ 3000
  cover         img-… | ''
  gallery       ≤ 8 tokens (Links.gallery syntax: img-… | vid-…[@s-e])
  startAt, endAt          Cairo stamps (startAt required)
  locationName ≤ 80 · locationUrl https|''
  theme         SECTION_THEMES | ''
  partner       ptn-… | ''
  terms         ≤ 800   (shown before submit; cancellation policy etc.)
  booking       JSON BookingSpec (§3) | ''   ('' = page without booking)
  servants      JSON [{ id: srv-…, methods: [key…] }]  ≤ 12
  revision      hash of the last published definition
  cardId        act-… | ''   the linked home card (§1.2)
  publishedAt, updatedAt

Bookings
  id            bkg-…
  ref           B-XXXXX
  eventId
  source        site | admin
  status        pending | confirmed | rejected | withdrawn | cancelled   (§4)
  name ≤ 60 · phone (+E.164)
  servantId     the servant the visitor chose (may differ from who received money)
  method        PayMethods key the visitor chose
  requested     JSON { <categoryKey>: count }
  actual        JSON { <categoryKey>: count }   ('' until confirmed)
  names         JSON [ ≤ 60 chars ] | ''        (only when collectNames)
  quotedTotal   integer, server price at submit
  priceRev      hash of the pricing used
  amountDue     integer | ''   (set at confirm; §5.3)
  dueHistory    JSON [{ at, by, from, to, reason }]   append-only
  proofIds      JSON [prf-…]   visitor proofs
  visitorNote ≤ 300 · adminNote ≤ 500
  rejectReason ≤ 200 · cancelReason ≤ 200
  capOverride   JSON { by, at, reason } | ''
  requestKey    COMP_CLIENT_KEY
  createdAt (stamp) · createdMs (ms)
  confirmedAt, confirmedBy, closedAt, closedBy
  updatedAt

Payments          (APPEND-ONLY; never updated except `voidedBy`)
  id            pay-…
  bookingId, eventId
  kind          payment | refund | void
  amount        integer > 0   (void: the voided row's amount, for audit)
  servantId     who received (payment) or paid back (refund)
  servantName   snapshot at write time
  method        PayMethods key (snapshot)
  receivedAt    Cairo stamp: when the money moved (≤ now, ≥ booking createdAt)
  recordedAt    Cairo stamp · recordedMs ms
  recordedBy    admin email · recordedName (display name snapshot)
  proofIds      JSON [prf-…] | ''
  note          ≤ 300
  voidsId       pay-… (kind void only)
  voidedBy      pay-… of the void row ('' = live)   ← the only column ever updated
  idemKey       unique

Proofs
  id            prf-…
  bookingId
  paymentId     pay-… | ''   ('' = attached by the visitor at submit)
  driveId       PRIVATE folder file id
  mime          image/webp | image/jpeg
  bytes, sha256, width, height
  by            visitor | <admin email>
  at (stamp) · deletedAt (retention, §10)

Pages             (service / media pages)
  id pg-… · slug (top level, §8.1) LOCKED after first publish
  enabled, archived, order
  title ≤ 60 · tagline ≤ 120 · description ≤ 2000
  hero          img-… | vid-…[@s-e]
  cover         img-…   (required when the home card is on; the card image,
                        and the hero poster fallback when hero is a clip)
  cardType      a Types key for the home card (default service)
  theme         SECTION_THEMES | ''
  partner       ptn-… | ''
  teamTitle ≤ 60 · teamText ≤ 300 · teamMessage ≤ 300 (WhatsApp prefill)
  team          JSON [srv-…] ≤ 6
  revision, cardId (act-… | ''), publishedAt, updatedAt

PageMedia
  id pm-… · pageId · order · enabled
  title ≤ 80 · text ≤ 300 · duration ≤ 10 (label, e.g. «١:٢٠ س»)
  cover         img-… (required)
  source        clip | link     (youtube: reserved, §8.4)
  clip          vid-…[@s-e] | ''          (source clip)
  fullUrl       https | ''   («شاهد المسرحية كاملة» target)
  ctaLabel ≤ 30 (default «شاهد المسرحية كاملة»)
  updatedAt

Partners
  id ptn-… · key [a-z]{2,12} (e.g. bug) · name ≤ 60 («Brave Under Grace – B.U.G.»)
  short ≤ 12 («B.U.G.») · logo img-… · mark img-… · url https|'' · active
```

The Activity `changes` JSON never holds names, phones, amounts tied to a
person, or proof ids. It holds counts and booking refs only.

### 1.2 Home entries (shared by events and pages; built in Phase 1)

Every event and service page can own **one home card**. The card is an
ordinary `Activities` row in the content Sheet, linked through a lazy column.
This follows the existing `compSyncCard_` pattern, so the home page,
ordering, display shapes, sections, the admin preview and publishing all work
unchanged.

**Linking:**
- New lazy Activities columns:
  - `event` (an `evt-` id) or `page` (a `pg-` id). A row has at most one link
    (including the existing `competition`).
  - `partner` (`ptn-` | ''), for the B.U.G. chip.
- The owner stores the card's id in `cardId`.
- **One sync function** `homeSync_(owner, kind, home)` in `Pages.gs`, used by
  both events and pages:
  - Called by `apiEventSave` / `apiPageSave` (and `…SetEnabled`, `…Archive`)
    whenever the input carries `home`.
  - Creates the row on first `show`.
  - Updates the derived fields on every save.
  - Never deletes the row. "Off" means `enabled: ''`.

**Editor settings** (panel «الصفحة الرئيسية» in both editors; `home` input
object):
```
home = {
  show:          bool        «إظهار في الصفحة الرئيسية»  → card.enabled
  cta:           ≤ 24 | ''   override of the automatic button label
  display:       '' | compact | side | banner | stack     → card.display
  displayMobile: '' | auto | compact | side | banner | stack
}
```

**Order:**
- The order is the card's own `order`, changed where every activity card is
  already ordered: the «الفعاليات» list in the content center.
- The editor shows the card's current position with «رتّب في الصفحة
  الرئيسية», which opens that list focused on the card.
- A new card is added at the end (`nextOrder_`).

**Derived fields** (rewritten on every save, read-only in the Activities
editor, which shows «الكارت ده بيتعدل من صفحة الفعالية/الخدمة»):

| Card field | Event | Page |
| --- | --- | --- |
| `type` | `kind` (`trip` · `conference` · `funday`) | `cardType` (default `service`) |
| `title` | `title` | `title` |
| `subtitle` | `summary` | `tagline` |
| `image` | `cover` | `cover` |
| `location` | `locationName` | '' |
| `startAt` / `endAt` | event times | '' (permanent) |
| `visibleUntil` | `endAt` + 12 h (the «خلصت» window, then gone) | '' |
| `ctaLabel` | `home.cta` or automatic (below) | `home.cta` or automatic |
| `partner` | `partner` | `partner` |
| `url` | '' (the link is the internal page) | '' |

Section and icon come from the card's Type, as for any activity.
- New seed types: `funday` («يوم ترفيهي», section `activities`, theme
  `emerald`, icon `sun`) and `service` («خدمة», section `services`).
- A new seed section `services`, «خدماتنا», placed after `activities`. Its
  title, order and surface can be edited like any section.
- Page cards default to `service`. The admin may pick any Type, e.g. the
  existing `black-theatre` / `mime` for their icon and theme. Existing Types
  and their sections are **not** changed by this work, so manual activity
  cards stay where they are.

**Automatic button label** (static, decided in the browser from Cairo time
like every activity; the home page never calls Apps Script):

| Owner | Condition | Label |
| --- | --- | --- |
| event, booking on | before `opensAt` | «اعرف التفاصيل» + chip «الحجز يفتح <date>» |
| event, booking on | open window | «احجز الآن» |
| event, booking on | after `closesAt`, before `endAt` | «اعرف التفاصيل» + chip «الحجز اتقفل» |
| event, no booking | — | «اعرف التفاصيل» |
| page | has ≥ 1 clip card | «شاهد» |
| page | no clips | «اعرف التفاصيل» |

"Full" is live data, so the home card can't know it. The card keeps «احجز
الآن» and the event page shows «اكتمل العدد». An admin who wants the card to
say so sets `home.cta` (e.g. «اكتمل العدد – التفاصيل»).

**Click:** the card opens the internal page **in the same tab**:
`events/<slug>/` or `<slug>/`. `items.js` `cta()` gains `eventHref` /
`pageHref`, beside `competitionHref`. `content.js` validates
`item.event` / `item.page` with the slug regex and keeps them only when that
slug is in the published `events[]` / `pages[]`.

**Visibility rules** (applied at publish in `Hub.gs`, so the home page can
never link to a missing or disabled page):
- The card is published only when `show` is on **and** its owner is enabled,
  not archived, and published in **this same commit**.
- Otherwise the card is dropped, with a review note («الكارت مستخبي لأن
  الصفحة مش منشورة»).
- Hiding the card (`show` off) leaves the page published and reachable by its
  URL, news, notifications and links.
- Disabling or archiving the owner turns the card off automatically. Turning
  the owner back on restores the card only if `show` is still on.
- Deleting a card from the Activities list is refused while it is linked
  («اخفيه من صفحة الفعالية/الخدمة بدل ما تمسحه»). Deleting its owner (an
  event with no bookings, or a page) deletes the card.

**Activity log:** card syncs are not logged separately. The owner's
`event.save` / `page.save` row lists «الصفحة الرئيسية: ظاهر/مخفي» in its
`changes`.

---

## 2. Events (public)

### 2.1 Routes and files (one publish commit, like competitions)

```
events/index.html                committed shell; the bare /events/ lists published events
events/<slug>/index.html         generated stub (bookStubHtml_, same CSP as competition stubs)
events/<slug>/event.json         PublicEvent
content.json  events[]           card summary only: { id, slug, kind, title, shortTitle, summary,
                                  cover, startAt, endAt, partner, theme, bookable, closesAt }
```

- The event's home card follows §1.2: optional, ordered, hidable, and its CTA
  opens `/events/<slug>/` **in the same tab**.
- News, notifications and links gain the target `event:<slug>`. It is added
  in `Items.gs` target validation, `Hub.gs`, `content.js`, `router.js`
  `pageForHash`, `main.js` and `sw.js` `PAGE`/`ROUTE`.
- Unpublishing or disabling an event keeps its stub, and the stub shows
  «الفعالية دي مش متاحة دلوقتي». A stub is never deleted, so links don't 404.

### 2.2 PublicEvent (`event.json`)

```jsonc
{
  "schema": 1, "revision": "…",
  "id", "slug", "kind", "title", "summary", "body",
  "cover": Image|null, "gallery": [Image|Video],
  "startAt", "endAt", "location": { "name", "url" } | null,
  "theme", "partner": { "key", "name", "short", "logo": Image, "mark": Image, "url" } | null,
  "terms",
  "booking": null | {
    "opensAt", "closesAt",            // Cairo stamps; '' = open from publish / until startAt
    "capacity": 120 | null,           // null = unlimited
    "showLeft": true,                 // show «فاضل N مكان» when ≤ showLeftBelow
    "showLeftBelow": 20,
    "perBookingMax": 10,              // seats per booking
    "collectNames": false,
    "pricing": PricingSpec,           // §3
    "payment": { "mode": "full" | "installments", "minFirst": 500, "finalDueAt": "…" },
    "methods": [{ "key", "label", "icon", "needsProof" }],
    "servants": [{ "id", "name", "role", "image", "wa": "https://wa.me/20…" | null,
                   "methods": ["cash","instapay"] }]
  }
}
```

- `wa` is present only when the servant has `publicWa = '1'` (§10).
- **No account numbers** (InstaPay handles, wallet numbers, IBAN) are ever
  published. The servant sends them in the WhatsApp chat.
- Live state (places left, open/closed) is **not** in the JSON. It comes from
  `bookState` (§6), so the page is right without a re-publish.

---

## 3. Pricing and people

```jsonc
PricingSpec = {
  "mode": "single" | "group",
  "categories": [                          // 1..6; the FIRST is the applicant
    { "key": "applicant", "label": "الحاجز", "group": "adult", "price": 1500,
      "seat": true, "min": 1, "max": 1, "note": "" },
    { "key": "adult",  "label": "فرد إضافي", "group": "adult",     "price": 1500, "seat": true,  "min": 0, "max": 6, "note": "" },
    { "key": "child",  "label": "طفل", "group": "child",     "price": 800,  "seat": true,  "min": 0, "max": 6, "note": "من ٤ لـ ١٢ سنة" },
    { "key": "infant", "label": "أقل من ٤ سنين", "group": "child", "price": 0, "seat": false, "min": 0, "max": 4, "note": "" },
    { "key": "guest",  "label": "مرافق", "group": "companion", "price": 1700, "seat": true,  "min": 0, "max": 4, "note": "" }
  ]
}
```

**Category rules:**
- `key` matches `[a-z][a-z0-9_]{1,15}` and is unique.
- `label` ≤ 30, `note` ≤ 60.
- `price` is an integer from 0 to 200,000.
- `group` is one of `adult | child | companion`. Reports use the group.
- `applicant` always exists with min = max = 1.
- `mode: 'single'` means only `applicant`; any other category is refused on
  save.

**Computation (`BookModel.gs`, pure):**

| Value | Formula |
| --- | --- |
| `quote(counts)` | Σ count × price |
| `seats(counts)` | Σ counts of categories where `seat` is true |
| `people(counts)` | `{ adult, child, companion, total }` |

**Request checks:** every count is within that category's min/max,
`seats ≤ perBookingMax`, and unknown keys are refused.

**Price snapshot:** `priceRev` = FNV-1a of the canonical PricingSpec. A
booking keeps its `quotedTotal`, and later price edits never change existing
bookings. The admin sees «السعر اتغير بعد الحجز ده» when `priceRev` differs
from the current one.

**Free events:** when every price is 0, `quote = 0`.
- The servant/method step and the proof step are skipped.
- Confirmation sets `amountDue = 0` and records no payment.

---

## 4. Booking statuses

```
pending ──confirm──► confirmed ──cancel──► cancelled (final)
   │  └─reject────► rejected ──reopen──► pending
   └─withdraw (visitor)──► withdrawn (final)
```

| Status | Takes places | Amount due | Who moves it |
| --- | --- | --- | --- |
| `pending` | no | — (quote only) | visitor submit / admin create / admin reopen |
| `confirmed` | **yes**, from `actual` | `amountDue` | admin |
| `rejected` | no | 0 | admin (reason required) |
| `withdrawn` | no | 0 | visitor (status link) while pending only |
| `cancelled` | no | retained fee (default 0) | admin (reason required) |

**Allowed moves:**
- `rejected → pending` is allowed ("reopen", e.g. a mistake). It is logged.
- `cancelled` and `withdrawn` are final.
- A booking whose **event has ended** (`endAt` passed) can still receive
  payments, refunds and voids, but no status changes except `cancelled`.

**Derived payment status**, for confirmed and closed bookings:

```
paid      = Σ live payment − Σ live refund         (live = voidedBy '')
balance   = amountDue − paid
paymentStatus =
  free       amountDue = 0 and paid = 0
  unpaid     paid = 0  and amountDue > 0
  partial    0 < paid < amountDue
  paid       paid = amountDue (> 0)
  overpaid   paid > amountDue            → refund owed = paid − amountDue
overdue     = installments and finalDueAt passed and balance > 0 and status confirmed
refundOwed  = max(0, paid − amountDue)   (for rejected / withdrawn, amountDue = 0)
```

---

## 5. Payments, instalments, refunds

### 5.1 Event payment modes

**`full`:**
- Confirming needs the recorded payments to satisfy `paid ≥ amountDue`.
- Otherwise the admin must tick «تأكيد من غير ما الدفع يكمل» and give a
  reason. The reason is stored in the confirm Activity row.

**`installments`:**
- Confirming needs `paid ≥ min(minFirst, amountDue)`, with the same override
  as `full`.
- `minFirst` is an integer of at least 0.
- `finalDueAt` is optional. When set, it drives `overdue`.

### 5.2 Payment rows

- **Kinds:** `payment` adds money, `refund` subtracts it, and `void` cancels
  one earlier `payment` or `refund`.
  - A void row's `amount` repeats the voided row's amount, for audit.
  - Writing a void sets the target's `voidedBy`. That is the only update ever
    made to a Payments row.
  - A void can't itself be voided. To restore a voided payment, record it
    again.
- **Required fields:** `amount > 0`, `servantId` (an active or inactive
  servant), a `method`, `receivedAt`, and `idemKey`.
  - Proofs are optional (up to 3).
  - A void requires a reason in `note`.
- **Warnings** the admin can confirm past (the server returns `warn` and the
  admin repeats the call with `force: true`):
  - the method isn't one this servant accepts for this event;
  - another live payment exists with the same amount, servant and day;
  - the refund is more than the refund owed;
  - the payment pushes the booking to `overpaid`.
- **Hard refusals:**
  - `receivedAt` in the future, or before the booking's `createdAt`;
  - a non-integer amount, or more than 1,000,000;
  - a refund on a booking with `paid` = 0;
  - an `idemKey` already used: the call returns the same row instead of
    writing a new one.
- **Which bookings accept payments:** confirmed, rejected, withdrawn and
  cancelled bookings all accept payments and refunds (money really moved).
  Pending bookings accept payments only through the confirm or reject dialogs.

### 5.3 Amount due

- At confirmation `amountDue` = `quote(actual)` by default. The admin may
  change it (discount or exemption). If it differs from the quote, a reason is
  required.
- Later changes go through `apiBookingUpdate`. Each one appends to
  `dueHistory` `{ at, by, from, to, reason }` and is logged.
- Changing `actual` suggests the new quote; the admin accepts it or keeps the
  amount.
- Cancel sets `amountDue` to the retained fee the admin enters (default 0, at
  most `paid`), and the reason is required.
- Reject and withdraw set `amountDue` to 0.

### 5.4 Worked example (instalments)

| Step | Row | paid | balance | paymentStatus |
| --- | --- | --- | --- | --- |
| Confirm, amountDue 3000 | `payment` 1200 (servant A, InstaPay, the visitor's proof) | 1200 | 1800 | partial |
| Admin «إضافة دفعة» | `payment` 800 (servant B, cash) | 2000 | 1000 | partial |
| 800 was a typo for 1800 | `void` → the 800 row; `payment` 1800 | 3000 | 0 | paid |

---

## 6. Public booking API (`book*`)

**Transport.** Calls go through the existing `doPost`, dispatched before the
admin token check: `if (/^book[A-Z]\w*$/.test(fn)) return jsonOutput_(publicBook_(fn, arg, size))`.
Everything else follows the `publicComp_` pattern:
- check the body size first;
- shape check;
- a per-minute budget in CacheService, spent only after the shape check
  passes;
- the module switch;
- the handler.

The handler never throws; a failure answers `busy`.

**Replies.** `{ ok:true, … }` or `{ ok:false, code, message, field? }`.

| Code | Meaning |
| --- | --- |
| `bad` | malformed request |
| `not_found` | no such event or booking |
| `disabled` | module switched off |
| `not_open` | booking not open yet; carries `opensAt` |
| `closed` | booking window closed |
| `busy` | budget spent or lock busy |
| `limit` | too many active bookings |
| `invalid` | a field failed validation; carries `field` |
| `full` | not enough places; carries `left` |
| `too_big` | request body over the limit |
| `proof` | a proof image is unreadable or the wrong type |
| `expired` | status token expired |
| `final` | booking can no longer be changed |

```
bookState    { slug }
  → { ok, open: bool, reason?: 'not_open'|'closed'|'full'|'disabled', opensAt?, closesAt,
      left: n | null, revision }
  - left = capacity − seatsTaken(confirmed), null when unlimited or when showLeft is off
    and left > showLeftBelow. Cached 30 s per slug (cache dropped on confirm/cancel/update).

bookSubmit   { slug, requestKey, name, phone, counts, names?, servantId?, method?,
               note?, proofs?: [{ mime, data(base64) }], hp, revision }
  → { ok, ref, status:'pending', token, quotedTotal, replay?: true }
  - order: body ≤ BOOK_MAX_BODY → shape → budget → module → event published & open
    (server clock) → requestKey seen? → replay the same reply, no upload
    → validate fields → price (server) → seats(counts) ≤ left else `full` (+left)
    → per-phone limit → decode + check proofs → Drive upload (outside lock)
    → under compLock_: re-check open/limit/requestKey, append Bookings + Proofs rows
    → after the lock: activity (§11) and the admin push.
  - servantId must be in the event's servants; method in that servant's methods;
    a method with needsProof requires 1..3 proofs; a free event ignores servant/method/proofs.
  - revision ≠ the published one → still accepted (server price wins), reply carries the
    new quotedTotal; the page shows it before the success screen.
  - phone: compNormPhoneEg_. Limit: ≤ 2 PENDING bookings per (event, phone) → `limit`.
  - uploads that end up without a row (lock timeout) are swept daily (orphan proofs > 24 h).

bookStatus   { token }
  → { ok, ref, event:{ slug, title, startAt }, status, firstName, people:{adult,child,companion},
      quotedTotal, amountDue?, paid?, balance?, paymentStatus?, overdue?, finalDueAt?,
      reason? (reject/cancel reason), createdAt }
  - never returns phone, full name, servant phone, proofs or payment rows.

bookWithdraw { token, requestKey }  → { ok, status:'withdrawn' }   (pending only, else `final`)
```

**Token:** `bk1.<b64url {b, e}>.<sig>`, using the same HMAC helpers and
`COMP_SECRET` as `COMPETITIONS.md` §5.3.
- `b` is the booking id; `e` (expiry) = event `endAt` + 60 days.
- The token travels only in the URL **fragment**:
  `/events/<slug>/#b/<token>`. It is never sent in a query string or a
  referrer.

**Proof checks (server):**
- MIME is `image/webp` or `image/jpeg`, confirmed by the file's first bytes
  (`decodeImage_`).
- Each file ≤ 900 KB decoded and ≤ 2400 px on its longest side.
- At most 3 per call.
- `sha256` is computed for each file. If the same image already belongs to
  another booking, the booking gets a `dupProof` flag in the admin view (§7.2)
  and is still accepted.

**Visitor-side image preparation** (`assets/js/page/image.js`, ported from the
admin's `prepareImage`):
- EXIF-aware decode.
- Longest side ≤ 1600 px.
- WebP at quality 0.82 (JPEG on Safari), stepped down until ≤ 600 KB.
- HEIC and PNG work when the browser can decode them; otherwise the page shows
  «الصورة دي مش مدعومة، ابعت سكرين شوت».

---

## 7. Workflows

### 7.1 Visitor (event page)

1. **Event page:** cover, details, date, place, prices and a «احجز» button.
   The button state comes from `bookState`: closed, «لسه ما فتحش», «اكتمل
   العدد», or open with «فاضل N مكان».
2. **Who's coming:** name, phone, counts per category with a live total, and
   names if the event collects them.
3. **Servant and payment method:**
   - pick a servant card, then one of their methods;
   - «كلّم الخادم على واتساب» opens `wa`, prefilled with the event title, the
     visitor's name, people per category and the total;
   - copy: «بعد ما تدفع ارجع هنا وكمّل الحجز».
4. **Proof and submit:**
   - 1–3 screenshots, an optional note and the event terms («موافق»);
   - copy: «مكانك بيتأكد بعد مراجعة الدفع».
5. **Done:** the reference, the status link (with «انسخ الرابط»), and «هتوصلك
   رسالة من الخادم بعد التأكيد».

**Draft:** `localStorage['athanasios.book.v1:<slug>']` = `{ step, fields,
counts, names, servantId, method, note, requestKey, savedAt }`.
- It expires after 7 days and is cleared on success.
- Proof files are never stored there.
- Returning from WhatsApp resumes the same step with the same `requestKey`, so
  a re-submit is safe.

**My bookings:** `localStorage['athanasios.bookings.v1']` = `[{ slug, ref,
token }]`, at most 20 entries. The event page shows «حجزك B-XXXXX: قيد
المراجعة» and a link to the status view.

**Status view** (`#b/<token>` on the event page):
- the status, the people, the amount due / paid / remaining when confirmed,
  and the reason when rejected or cancelled;
- «إلغاء الطلب» while pending.

### 7.2 Admin review

- **Queue:** «الحجوزات», filtered by event, with chips for الجديدة (pending),
  المؤكدة, متأخر, مرتجعات مطلوبة, المرفوضة/الملغية and الكل, plus search by
  ref, name or phone.
- **Booking sheet:**
  - the request, with flags: duplicate proof, same phone pending twice, price
    changed since the booking;
  - proofs, viewed through `apiBookingProof`;
  - the payment history and the derived totals.
- **Confirm:** the dialog holds `actual` (prefilled from `requested`),
  `amountDue` (prefilled from the quote) and the first payment (prefilled with
  the chosen servant and method, the visitor's proofs attached, amount empty).
  - The checks from §5.1 and §9 apply.
  - It writes the booking update plus the payment rows in one locked section.
- **Reject:** a reason chip («الدفع مش واضح» / «اكتمل العدد» / «بيانات ناقصة»)
  or free text.
  - The dialog asks «استلمنا فلوس؟». If yes, the payment row(s) are recorded
    first, so the booking lands in مرتجعات مطلوبة with `refundOwed = paid`.
- **«إضافة دفعة» / «تسجيل مرتجع»:** available on any non-pending booking.
- **«إلغاء الحجز» on a confirmed booking:** reason, plus the retained fee
  (default 0).
- **Reopen** a rejected booking.
- **Manual booking** (`source: admin`): the same form and validation, for
  phone or walk-in bookings, created directly as `pending` (or confirmed in
  the same dialog).
- **Event cancelled:** «إلغاء الفعالية» on the event cancels every pending and
  confirmed booking (one locked loop, one Activity row with counts) and fills
  مرتجعات مطلوبة.

### 7.3 Admin push

A new booking creates Activity `booking.new` with the system actor
`visitor`; `activity_` gains a system-actor path.

**Who is notified:**
- every allowlisted admin who is not present gets a push;
- present admins get a toast instead.

**Grouping:** pushes are grouped per event over 10 minutes («٣ حجوزات جديدة –
رحلة الإسكندرية»). Each push links to `/admin/#open/bookings/<eventId>`.

---

## 8. Service / media pages

### 8.1 Routes

```
pages/index.html                  committed shell (noindex; bare /pages/ redirects home)
<slug>/index.html                 generated stub at the SITE ROOT, e.g. /black-theatre/
<slug>/page.json                  PublicPage
content.json  pages[]             { id, slug, title, tagline, hero(thumb), partner, theme }
```

**Slug rules:**
- `COMP_SLUG` syntax.
- Not in `PAGE_RESERVED`: every existing top-level path (`admin`, `assets`,
  `media`, `points`, `competition`, `events`, `pages`, `privacy`, `terms`,
  `review`, `tools`, `docs`, `tests`, `apps-script`, `index`, `preview`,
  `new`, `card-athanasios`) **plus any folder present in the repository**,
  checked against the GitHub tree at save time.
- Locked after first publish.
- Seed slugs: `black-theatre`, `silent-theatre`.

Target `page:<slug>` is added wherever `event:<slug>` is (§2.1). The page's
home card follows §1.2.

### 8.2 PublicPage (`page.json`)

```jsonc
{
  "schema": 1, "revision", "id", "slug", "title", "tagline", "description",
  "hero": Image | Video, "theme",
  "partner": Partner | null,
  "media": [{ "id", "title", "text", "duration", "cover": Image,
              "source": "clip" | "link", "clip": Video | null,
              "fullUrl": "https://…" | null, "ctaLabel" }],
  "team": { "title", "text", "people": [{ "name", "role", "image", "wa": "https://wa.me/…?text=…" }] }
}
```

Limits: ≤ 60 media cards per page; `team.people` lists only servants with
`publicWa = '1'`.

### 8.3 Layout and video experience

**Layout:**
- Hero: cover or muted looping clip with poster; with reduced motion, the
  poster only.
- Then the title, tagline, partner lockup (§12), description.
- **Media grid, YouTube-style:** a 16:9 cover with a play badge and duration,
  the title (2 lines) and the text (2 lines).
  - Columns: 1 below 640 px, 2 at 640–1023 px, 3 from 1024 px.
- Then the team block.

**Card tap:**

| Card | Opens |
| --- | --- |
| `clip` | the **video sheet** |
| `link` without a clip | `fullUrl` in a new tab |

**Video sheet** (extends `sheet.js` `openViewer`, a `<dialog>`):
- A plain `<video controls playsinline preload="metadata">` at the clip's own
  aspect ratio, filling the width, max 80 dvh. No device frame and no social
  chrome.
- Then the title, the text and the «شاهد المسرحية كاملة» CTA when `fullUrl` is
  set (new tab, `noopener`).
- Prev/next by swipe or arrows.
- Escape, the close button and Android back (it pushes a history state) all
  close it.
- Deep link `#v/<id>`.
- Playback starts only on the user's tap; no autoplay with sound.

**Team block:** «عايز تنضم لفريق المسرح؟» plus person cards from the shared
contact components (moved from `render.js` to `assets/js/contacts.js`). The
WhatsApp link is prefilled with `teamMessage`.

### 8.4 Video sources

- **`clip`:** self-hosted MP4 through the existing trimmer and `uploadVideo_`
  (≤ 8 MB, ≤ 600 s, H.264, no audio by default).
  - **Change needed:** service pages want sound. The trimmer gets an «احتفظ
    بالصوت» option (AAC 96 kbps) for page clips, and the cap for clips used
    only by pages is raised to **20 MB** (see decisions).
- **Full performances** are external links (`fullUrl`). GitHub Pages does not
  host full plays.
- **`youtube`** is reserved, not built. It would be a click-to-load
  youtube-nocookie player and needs a CSP change on page stubs only (see
  decisions).

---

## 9. Capacity

```
seatsTaken(event) = Σ seats(actual) over bookings with status confirmed
left              = capacity − seatsTaken          (capacity null → unlimited)
```

**Submit:**
- Refused with `full` (carrying `left`) when `seats(counts) > left`.
- Pending bookings are not counted, so many pending requests may exceed
  capacity. That is expected; confirming is the gate.

**Confirm, or `apiBookingUpdate` raising `actual`:**
- Under `compLock_`, recount `seatsTaken` from the sheet (never from cache).
- If `seatsTaken + seats(actual) − seats(previous actual) > capacity`, answer
  `full` (carrying `left`).
- The admin may override with a reason, stored in `capOverride` and logged.

**Places are freed by:** a cancel, or lowering `actual`. Either drops the
`bookState` cache.

**Changing the event's capacity:**
- Lowering it below `seatsTaken` is allowed, with a warning («فيه N مؤكدين
  فوق العدد الجديد»). Existing bookings are untouched.
- Raising it reopens submissions immediately.

**Public display:** «اكتمل العدد» when `left ≤ 0`. «فاضل N مكان» only when
`showLeft` is on and `left ≤ showLeftBelow`.

---

## 10. Security and privacy rules (tested)

**What never reaches GitHub** (the content.json, event.json and page.json
files, push payloads, the Activity `changes` JSON or the logs):
- visitor names, phones, booking notes;
- proofs, amounts tied to a person;
- servant phones, except the `wa.me` link of a servant with
  `publicWa = '1'`.

A committed-file scan test, like `comp-security.test.mjs`, enforces this.

**Proofs:**
- Stored in the private R2 bucket `athanasios-private` (revised 2026-10-15;
  originally a private Drive folder, `BOOK_PROOF_FOLDER`). No public URL ever
  exists; only an admin can stream one through the Worker.
- Never added to the `Media` tab or library and never published.
- Viewed only through `apiBookingProof(id)`, which returns base64 to an
  admin.

**Retention:**
- Proof files are deleted **60 days after the event's `endAt`** by the
  Worker's daily cron (`worker/src/scheduled.js`; originally the Apps Script
  `PUSH_DAILY_HANDLER`;
  `deletedAt` is set and the row is kept). The same run sweeps orphan proofs.
- Bookings and payments are kept for accounting.
- Phone numbers are blanked **12 months** after the event ends (see
  decisions).

**Public endpoints:**
- Body ≤ `BOOK_MAX_BODY`, checked on the request size before field
  validation.
- Honeypot `hp` must be empty.
- Per-minute budgets: `bookState` 600, `bookSubmit` 60 (≤ 20 per event),
  `bookStatus` and `bookWithdraw` 300.
- Server clock and server price only. Client totals are ignored.

**Status tokens:**
- HMAC-signed, expire, travel only in the URL fragment, and are compared in
  constant time.
- They reveal only the first name, people counts, status and money totals.

**Admin:**
- Every `api*` function calls `assertAdmin_()` and appears in
  `apiFunctions_`.
- Booking and payment writes go through `compLiveWrite_` (official `/admin/`
  only; the recovery admin shows «استخدم /admin/»).
- Edit locks use the new `LOCK_KINDS` `event`, `booking`, `servant`, `page`.

**XLSX:** built in the browser from API rows and contains phones. The export
button shows «الملف فيه أرقام تليفونات، ماتبعتوش في جروبات».

**Text:** all text is set with `textContent`. URLs must be `https:` only;
WhatsApp links must be `wa.me` only.

---

## 11. Admin API (all `api*`, admin token + session, `assertAdmin_()` first)

```
Servants / methods
  apiServants() · apiServantSave(id|null, input) · apiServantSetActive(id, on)
  apiPayMethodsSave(list)

Events
  apiEvents(query) · apiEvent(id) · apiEventSave(id|null, input)
  apiEventSetEnabled(id, on) · apiEventArchive(id, on)
  apiEventDelete(id)                 → refused when any booking exists
  apiEventCancelAll(id, reason)      → §7.2 "event cancelled"
  (published by the existing apiPublish; files added like competition files)

Bookings
  apiBookings({ eventId, status, pay, overdue, refunds, q, cursor })
      → { rows:[BookingRow], counts:{ byStatus, overdue, refunds }, next }
  apiBooking(id) → { booking, payments:[…], proofs:[{ id, by, at, bytes, dup }], derived, flags }
  apiBookingProof(proofId) → { mime, base64 }
  apiBookingCreate(input)                                 source admin
  apiBookingConfirm(id, { actual, names?, amountDue, dueReason?, payments:[PayInput],
                          overrideCap?, overridePay?, reason? })
  apiBookingReject(id, { reason, payments?:[PayInput] })
  apiBookingCancel(id, { reason, retain })
  apiBookingReopen(id)
  apiBookingUpdate(id, { actual?, amountDue?, reason?, adminNote?, names? })
  apiPaymentAdd(bookingId, PayInput)       PayInput = { kind:'payment'|'refund', amount, servantId,
                                            method, receivedAt, note?, proofs?:[{mime,data}], idemKey, force? }
  apiPaymentVoid(paymentId, { reason, idemKey })

Reports
  apiBookingSummary(eventId, { from?, to? }) → Summary (§13)
  apiBookingExport(eventId, { from?, to? })  → { bookings:[…], payments:[…], servants:[…] }

Pages / partners
  apiPages() · apiPage(id) · apiPageSave(id|null, input) · apiPageSetEnabled(id, on) · apiPageArchive(id, on)
  (apiEventSave / apiPageSave input may carry `home` (§1.2); replies include
   `card: { id, show, order, position, of }` so the editor shows «رقم N من M»)
  apiPageMediaSave(pageId, id|null, input) · apiPageMediaOrder(pageId, ids) · apiPageMediaDelete(id)
  apiPartners() · apiPartnerSave(id|null, input)
  apiModulesBook({ pages?, events?, booking? })      switches, logged
```

**Activity actions** (each added to `ACTIVITY_ACTIONS` with an Arabic
summary; whether it triggers an admin push is noted):
- events: `event.save`, `event.cancelAll`;
- bookings: `booking.new` (system actor, push grouped), `booking.confirm`,
  `booking.reject`, `booking.cancel`, `booking.reopen`, `booking.update`,
  `booking.create`;
- money: `payment.add`, `payment.refund`, `payment.void` (push to other
  admins, 30-minute cooldown per booking);
- pages and people: `page.save`, `pagemedia.save`, `servant.save`,
  `partner.save`, `modules.book`.

---

## 12. Partners and the B.U.G. co-branding

**Data:** the `Partners` row with `key bug`, name «Brave Under Grace – B.U.G.»,
short «B.U.G.», and two images:
- `logo`: the full-colour logo on a **transparent** background, WebP or PNG
  ≤ 250 KB;
- `mark`: the letters-only mark, for sizes under 48 px.

Each event or page sets `partner` (optional, off by default).

**Where B.U.G. appears:**
- **Home cards:** a small chip «بإشراف B.U.G.» (the mark plus the short name)
  on activity, event and page cards whose item has a partner.
- **Hero lockup:** our arch logo · a gold hairline «×» · the B.U.G. logo on a
  soft light plate (`--partner-plate`: a warm off-white with 12 % opacity
  glow). It is never placed directly on navy, never recoloured and never
  cropped. Caption: «بإشراف Brave Under Grace – B.U.G.».
- **Visual separation:** the logo's colours stay inside the logo. The page
  keeps the site's navy and gold. The partner never changes the page theme.

**Intro** (`assets/js/page/collab.js`, a classic script in `<head>`, loaded
only by stubs whose item has a partner). It reuses the gating from
`intro.js`.

*When it plays:* only when ALL hold —
- the item has a partner;
- reduced motion is off;
- there is no hash (deep links skip it);
- the tab is visible and not framed;
- the device is not weak and data saver is off;
- the page is not the admin preview;
- `getAnimations` is supported.

*How often (as built, pass 3):* **every time the visitor comes into a
partnered page** — a new load, or the page coming back from the
back/forward cache (`pageshow` with `persisted`). Nothing is stored. A
resize, a turn of the phone or a re-render never replays it (none of them
runs the script again). The earlier once-a-session / short-version rules
are gone.

*The ident, ≈ 2.35 s, over the whole screen (`100vw × 100dvh`), motion in
CSS (page.css INTRO), sound synthesised in collab.js on the same clock:*
1. 0–0.35 s: letterbox bars, a low swell and a rising air.
2. 0.20 / 0.45 s: our seal (right), then the partner's logo (left), each out
   of the depth with a whoosh panned to its side.
3. 1.05–1.45 s: the mark (gold × spectrum strokes): a soft hit, a sub drop,
   a metallic shimmer, then a gold bell with the flare.
4. 1.55–1.95 s: the light sweep and motes: an airy sweep and three sparkles.
5. 1.95–2.35 s: the bars open, the stage lifts into the page (rendered
   underneath from the first frame): a soft chord and a falling air.

*Sound:* the site's one setting (`localStorage['athanasios.sound']`, on
unless `'off'`); quiet (one bus, a soft room, a limiter). A browser that
won't start audio without a tap on this page plays the ident in silence.
Skipping fades the sound out in ~0.2 s.

*Exit:*
- «تخطي» (a real button in the lower corner, never in the tab order) or any
  tap / key skips it immediately (the overlay takes only that first input,
  then removes itself).
- Hiding the tab or leaving the page ends it.
- A hard timeout of 3.3 s removes the overlay no matter what.

*Accessibility:*
- The overlay is `aria-hidden`.
- The page's `<h1>` and content are in the DOM from the start.
- Focus is never moved.

*Reduced motion:* no intro; the static lockup appears in the hero.

---

## 13. Accounting and XLSX

**Summary** (`apiBookingSummary`, computed from rows in `BookModel.gs`). With
`from`/`to` set, only payment figures are filtered (by `receivedAt`); booking
counts always cover the whole event.

```
overall: {
  bookings: { pending, confirmed, rejected, withdrawn, cancelled },
  seats: { capacity, taken, left },
  people: { adult, child, companion, total },          (confirmed, actual)
  money: { due, received, refunded, net, balance, refundsOwed,
           byMethod: { <key>: { received, refunded, net } } },
  payStatus: { free, unpaid, partial, paid, overpaid, overdue },
  pending: { count, quoted }                           (expected, not money)
}
servants: [{ id, name, active,
  payments: n, received, refunded, net,
  byMethod: { <key>: net },
  bookings: n (distinct bookings with ≥ 1 live row by this servant),
  chosenBy: n (pending + confirmed bookings that chose this servant) }]
```

**Rules:**
- Every money figure comes from **live Payments rows**. Booking prices and
  quotes are never counted as money.
- Voided rows and the void rows themselves add 0.
- Per-servant money uses `Payments.servantId`, not `Bookings.servantId`.

**XLSX** (browser, `admin/xlsx.js`, right-to-left, text columns for phones and
refs, header filters). File name `حجوزات-<slug>-<YYYY-MM-DD>.xlsx`.

| Sheet | Columns |
| --- | --- |
| «ملخص» | event title, dates, capacity, overall figures (`from`/`to` noted in the header) |
| «حسب الخادم» | الخادم · عدد الدفعات · المستلم · المرتجع · الصافي · one net column per method · عدد الحجوزات · اختاروه |
| «الحجوزات» | الرقم · الحالة · الاسم · الموبايل · الخادم المختار · طريقة الدفع · كبار · أطفال · مرافقين · الإجمالي · الأسماء · المطلوب · المدفوع · الباقي · حالة الدفع · متأخر · تاريخ الطلب · تاريخ التأكيد · ملاحظات |
| «الدفعات» | full payment history: رقم الدفعة · رقم الحجز · الاسم · النوع · المبلغ · الطريقة · الخادم · وقت الاستلام · وقت التسجيل · سجلها · ملغية؟ · سبب الإلغاء · فيه إثبات؟ |
| one sheet per servant | that servant's live payment rows plus a total row |

Optional: one file per servant, zipped (the `distributionFiles` pattern).

---

## 14. Limits

| Thing | Limit |
| --- | --- |
| `BOOK_MAX_BODY` (bookSubmit) | 3.5 MB (3 proofs × ≤ 900 KB as base64 + fields); other `book*` 16 KB |
| Proofs per visitor submit / per payment | 3 / 3 |
| Proof file | WebP/JPEG, ≤ 900 KB decoded, ≤ 2400 px |
| Categories per event | 6 |
| Seats per booking | `perBookingMax` 1–30 (default 10) |
| Pending bookings per (event, phone) | 2 |
| Servants per event / team per page | 12 / 6 |
| Gallery per event / media per page | 8 / 60 |
| Amounts | integers; price ≤ 200,000; payment ≤ 1,000,000 |
| Bookings per event (design load) | ≤ 2,000; ≤ 60 submits a minute |
| Clip (page) | ≤ 20 MB with sound (pending approval); otherwise 8 MB |

---

## 15. Tests (required before each phase merges)

- **`book-model.test.mjs`:** pricing, seat counts, people groups, derived
  payment status for every branch, `overdue`, `refundOwed`, void handling,
  the §5.4 example, summary totals, and `from`/`to` filtering.
- **`book-public.test.mjs`** (fake world):
  - budgets and the `too_big` check before parsing;
  - honeypot, idempotent `requestKey` replay with no second upload;
  - `full` when seats exceed `left`, and pending bookings not counting;
  - the per-phone limit; proof sniffing and the duplicate-hash flag;
  - token tamper, expiry and fragment-only use.
- **`book-admin.test.mjs`:**
  - confirm with capacity recounted under the lock (two admins race for the
    last seat);
  - the `full` / `installments` confirm rules and both overrides;
  - payment warnings vs refusals, idemKey replay, void-once;
  - reject with money → refunds owed; cancel with a retained fee;
  - reopen; event cancel-all.
- **`book-security.test.mjs`:** scan committed files and published JSON for
  phones, names and proof ids; check that every `api*` is guarded and listed.
- **`pages.test.mjs`:** slug reservation (including a repo-folder clash),
  stub CSP equal to the site's, `publicWa` filtering, media limits.
- **`home-sync.test.mjs`:**
  - first `show` creates exactly one card, later saves update it, `show` off
    disables it, and nothing is ever duplicated;
  - derived fields per §1.2, and the `home.cta` override;
  - a card whose owner is unpublished, disabled or archived is dropped at
    publish, with a review note;
  - a linked card can't be deleted;
  - deleting the owner deletes the card;
  - order is kept across saves;
  - the public `content.js` drops an `event` / `page` link whose slug isn't
    published;
  - `items.js` opens the internal page in the same tab with the right label
    for each row of the label table.
- **e2e:**
  - the booking flow on a 360 × 740 phone, including the
    WhatsApp-then-return draft restore;
  - the video sheet (open, swipe, Android back, `#v/` deep link);
  - the intro (full screen; plays on every entry into a partnered page,
    never on a resize; «تخطي»; skipped by reduced motion and deep links;
    removed by 3.3 s).

---

## 16. Phases

| # | Scope | Notes |
| --- | --- | --- |
| 0 | This contract; partner logo assets | done when approved |
| 1 | Page shell, shared contacts module, Servants registry (public fields), Pages + PageMedia, video sheet, `page:` target, **home entries (§1.2: `homeSync_`, the «الصفحة الرئيسية» panel, `services` section, `service`/`funday` types, internal-page CTA in `items.js`)**; Black & Silent Theatre live with home cards | no booking code |
| 2 | Partners, hero lockup, home chips, `collab.js` intro | |
| 3 | Events (display only): editor, publish, `event.json`, home cards through the Phase 1 `homeSync_`, `event:` target, `/events/` list | |
| 4 | Booking server: tabs, `book*`, proofs in Drive, Payments (add / refund / void), confirm/reject/cancel/reopen, capacity, admin push | |
| 5 | Public booking flow, draft restore, status view, withdraw | |
| 6 | Summaries, XLSX, overdue and refund views, retention trigger | |
| later | YouTube click-to-load player; visitor «ارفع إثبات دفعة» (payment claims); servant logins; treasurer handover tracking; waitlist | |

Phases 1–2 and 4 can run as two parallel tracks; 5 needs 3 and 4; 6 needs 4.

---

## 17. Phase 1 + 3 build contract (binding for this build)

This build covers Phase 1 (service pages, servants registry, home entries)
and Phase 3 (event pages, display only). There is **no booking engine yet**:
- `book*` actions don't exist;
- `event.json` `booking.online` is `false`;
- the event page lists prices and the servants' WhatsApp links, so people book
  with a servant directly.

Phase 4/5 switch `online` on.

### 17.1 Switches

- Pages and Events have no public write surface, so they are **always on**.
  `PAGES_MODULE` / `EVENTS_MODULE` are not used.
- `BOOKING_MODULE` arrives with Phase 4.

### 17.2 Server files (apps-script)

| File | Holds |
| --- | --- |
| `Pages.gs` | `PAGE_TABLES` (Servants, Pages, PageMedia, Events) in the competitions spreadsheet; the admin API for pages, servants and events; `homeSync_`; `pagesDraft_()` (for `readDraft_`); `pagesBuildPublic_(draft, ctx)` (for `buildPublicContent`); `pagesPublishFiles_` / `pagesAfterCommit_` (for `publishNow_`); `pageStubHtml_` |
| `BookModel.gs` | pure: event validation, pricing (§3), the public event shape |

### 17.3 Committed public files

```
pages/index.html     the ONE page shell (service pages, events, the events list, preview)
events/index.html    the events list: the shell with <html … data-kind="events">
assets/css/page.css  self-contained (tokens and fonts as in comp.css)
assets/js/page/*.js  main.js (boot), view.js (render), video.js (video sheet), model.js (pure sanitizers)
```

**Shell rules.** The shell's URLs are relative to one folder deep (`../assets/…`,
`href="../"`).

| Output | How it is made |
| --- | --- |
| **Service page stub** `/<slug>/index.html` | Same depth as the shell, so URLs are unchanged. Adds `<html … data-kind="page" data-slug="<slug>" data-v="<v>">` plus its own title, description, canonical, OG and twitter tags. |
| **Event stub** `/events/<slug>/index.html` | Every `href="../` / `src="../` becomes `../../`. Adds `data-kind="event"`. |

**What the module does on load:**
- Resolves the site root as `new URL('../../../', import.meta.url)`.
- Fetches `./page.json?v=<v>` or `./event.json?v=<v>` relative to the
  document.
- Shell without `data-kind`: `?preview` enters preview mode; otherwise it
  redirects to the site root.
- `data-kind="events"` lists `content.json` `events[]`, upcoming first.

### 17.4 Shared shapes

```
Image = { src, thumb, w, h, alt }                              (as content.json)
Video = { type:'video', src, poster, w, h, alt, start, end }   (as link galleries)
Stamp = 'YYYY-MM-DDTHH:MM' Cairo                               (as content.json)
```

### 17.5 `/<slug>/page.json`

```jsonc
{ "schema": 1, "v": "<hash>", "id": "pg-…", "slug", "title", "tagline", "description",
  "theme": "" | SECTION_THEMES, "cover": Image | null, "hero": Image | Video | null,
  "partner": null,
  "media": [{ "id": "pm-…", "title", "text", "duration", "cover": Image,
              "source": "clip" | "link", "clip": Video | null,
              "audio": { "mode": "original" | "custom" | "none",
                         "src": "media/YYYY/aud-xxxxxxxx.(m4a|mp3)" | null },
              "fullUrl": "https://…" | null, "ctaLabel": "شاهد المسرحية كاملة" }],
  "team": null | { "title", "text",
                   "people": [{ "id", "name", "role", "image": Image | null,
                                "wa": "https://wa.me/<digits>?text=<encoded teamMessage>" }] },
  "publishedAt": Stamp }
```
**Withdrawn** (disabled, archived or deleted after a publish):
`{ "schema": 1, "slug", "withdrawn": true }`. The page shows «الصفحة دي مش
متاحة دلوقتي» and a link home.

### 17.6 `/events/<slug>/event.json`

```jsonc
{ "schema": 1, "v", "id": "evt-…", "slug", "kind": "trip" | "conference" | "funday",
  "kindLabel": "رحلة" | "مؤتمر" | "يوم ترفيهي",
  "title", "shortTitle", "summary", "body", "theme",
  "cover": Image | null, "gallery": [Image | Video],
  "startAt": Stamp, "endAt": Stamp | "",
  "location": { "name", "url": "https://…" | null } | null,
  "terms", "partner": null,
  "booking": null | {
    "online": false,
    "opensAt": Stamp | "", "closesAt": Stamp | "",
    "capacity": n | null, "perBookingMax": n, "collectNames": bool,
    "pricing": { "mode": "single" | "group", "categories": [{ "key", "label", "group", "price", "seat", "min", "max", "note" }] },
    "payment": { "mode": "full" | "installments", "minFirst": n, "finalDueAt": Stamp | "" },
    "methods": [{ "key", "label", "icon" }],
    "servants": [{ "id", "name", "role", "image": Image | null, "wa": "https://wa.me/<digits>" | null, "methods": [key] }]
  },
  "publishedAt": Stamp }
```
- **Withdrawn**: `{ "schema": 1, "slug", "withdrawn": true }`.
- **The «احجز الآن» area while `online` is false:**
  - the price table;
  - the booking window («الحجز من … لحد …»);
  - the line «للحجز كلّم خادم من دول على واتساب».
  - Servant cards with their method chips.
  - Each `wa` gets `?text=` added in the browser: event title, a request to
    book, and the people in the category table if the visitor filled the
    optional counter, with the computed total.

### 17.7 content.json additions (only when non-empty, so older content stays byte-identical)

```jsonc
"pages":  [{ "id", "slug", "title", "tagline", "cover": Image | null, "v" }],
"events": [{ "id", "slug", "kind", "kindLabel", "title", "shortTitle", "summary", "cover": Image | null,
             "startAt", "endAt", "booking": { "opensAt", "closesAt" } | null, "v" }]
```

**Activities card additions:**
- `page: <slug>` or `event: <slug>`; never both, and never with
  `competition`.
- `ctaLabel`: the admin override, or `''` (automatic).
- `booking: { opensAt, closesAt } | null`: event cards only (null = event
  without booking).
- `watch: bool`: page cards only (true = at least one clip card).
- Linked cards have `cta: null`.

**`visibleUntil` of an event card** is `endAt + 12 h`, or `startAt + 12 h`
when there is no `endAt`. The page hides the card after it, as with any
activity.

**content.js** keeps `page` / `event` only when they match the slug regex
**and** are in `content.pages` / `content.events`; otherwise it drops the
card.

**items.js** builds the same-tab href (`<slug>/` or `events/<slug>/`, relative
to the site root) and the label per §1.2 (an override wins):

| Card | Condition | Label | Chip |
| --- | --- | --- | --- |
| event, `booking` set | before `opensAt` | «اعرف التفاصيل» | «الحجز يفتح <day/date>» |
| event, `booking` set | open window | «احجز الآن» | — |
| event, `booking` set | after `closesAt` | «اعرف التفاصيل» | «الحجز اتقفل» |
| event, `booking` null | — | «اعرف التفاصيل» | — |
| page | `watch` true | «شاهد» | — |
| page | `watch` false | «اعرف التفاصيل» | — |

- `closesAt` `''` = open until `startAt`.
- The new built-in items section `services` («خدماتنا», icon `theatre`) sits
  after `activities`.
- New seed types:
  - `funday` («يوم ترفيهي», section activities, icon `star`, theme
    `emerald`);
  - `service` («خدمة», section services, icon `theatre`, theme `night`).

### 17.8 Notifications and deep links

- Bell targets gain `{ kind: 'page', slug }` and `{ kind: 'event', slug }`,
  as same-tab links. In the Sheet they are written `page:<slug>` /
  `event:<slug>`.
- `sw.js` `PAGE` / `ROUTE` allow `/events/<slug>/`, plus `/<slug>/` for a
  published page slug: it matches the `COMP_SLUG` pattern and is not
  reserved; the worker only opens same-origin paths.
- `router.js` `pageForHash` maps `#event/<slug>` → `events/<slug>/` and
  `#page/<slug>` → `<slug>/`.

### 17.9 Clip sheet (`assets/js/page/video.js`, `clip-audio.js`, `assets/css/xp-clip.css`)

As built (pass 3): the site's own social-sheet language, the same pieces as
the home page's mini-experiences («صوتك يهمنا», the TikTok / Instagram
sheets) — never a copied app frame around the video:
- `sheet.js` (`variant: 'xp'`): springs up, drags down, its open / close
  sounds; the head shows the page's title.
- The real clip at its own aspect ratio in a clean rounded, gold-rimmed
  frame (at most ~56dvh); no native controls: a tap on it pauses / plays, a
  thin gold line shows its progress; it loops between `start` and `end`
  (the address carries `#t=start` only).
- The speaker in its corner (`.xp-sound`): the site's one sound setting.
- The living stage (`xp/kit.js`, `xp.css`, loaded with the first sheet or on
  idle): hearts and reactions rising beside the clip, short warm words
  passing at its edges, and on a computer the same behind the sheet; nothing
  moves with reduced motion; it all goes with the sheet.
- Under it: the title, the text, «شاهد المسرحية كاملة» (new tab,
  `rel="noopener"`, when `fullUrl` is set), prev / next.
- It starts as the sheet opens (the visitor's tap); a browser that refuses
  (a shared `#v/` link) gets it muted.
- **«صوت المقطع»** (`audio.mode`): `original` the clip's own sound;
  `custom` the card's soundtrack (`aud-…`, MP3 / M4A, ≤ 6 MB, the media
  library's «أصوات») with the clip muted; `none` silence. Only ever one
  source. Fades through the site's AudioContext: in as it opens (~0.9 s),
  across between clips (~0.3 s out), out as it closes; a hidden tab pauses
  everything; nothing plays after the sheet closes. The site's sound
  setting off = everything silent. A missing soundtrack file publishes as
  `none`. Service pages only (events never carry it).
- The trimmer keeps a video's own sound (AAC) when it has one, so
  `original` has something to play; clips cut before pass 3 are silent.
- Prev / next with buttons, arrow keys and swipe.
- Close with Escape, the button, a tap beside it, a drag down, or back: it
  pushes a `#v/<id>` history state. Deep link `#v/<id>` opens it on load.
- A `link` card without a clip opens `fullUrl` in a new tab.

**Site-wide UI sounds (pass 3):** `assets/js/ui-sound.js` brings the home
page's sound system (`sound.js`: the same synthesised sounds and the same
`athanasios.sound` setting) to the service pages, events, competitions and
«نقاطي / المتجر»: a 🔊/🔇 button in their top bar (injected, so published
stubs get it without a republish), a light tap for buttons and links,
open / close for sheets, success for a sent competition or a store order,
«important» when a competition has under a minute left.

### 17.10 Admin preview protocol (`pages/index.html?preview`, same-origin iframe only)

```
page → parent  { type:'athanasios:page-preview-ready' }
parent → page  { type:'athanasios:page-preview', kind:'page'|'event', data:<page.json | event.json shape>,
                 images?: { '<media path>': 'blob:…' } }        (re)renders from scratch
page → parent  { type:'athanasios:page-preview-shown' } | { type:'athanasios:page-preview-error', message }
```
- Messages are read only when `event.source === window.parent` and
  `event.origin === location.origin`.
- In preview the page never fetches JSON and never writes storage.

### 17.11 As built (Phase 1 + 3)

- **«خدماتنا» is a Sections row, not a built-in.** `homeEnsureServices_` makes
  it (kind `items`, right after `activities`) the first time a card of a
  `services` type is saved. Content without service pages stays
  byte-identical.
- **Card order:** `apiHomeOrder(sectionKey, ids)` (Pages.gs, through
  `mutate_`) writes orders 10, 20, … for every card of that items section.
  The admin's «رتّب الكروت» sheet uses it; it is also linked from each
  page / event editor and the lists.
- **A linked card in the activities list:**
  - read-only, with «افتح الصفحة / الفعالية»;
  - its on/off toggle sets the owner's «إظهار في الصفحة الرئيسية»
    (`homeSetShowFromCard_`);
  - delete and archive are refused (`homeRefuseLinked_`);
  - a copy («استخدم تاني») is a plain card.
- **Admin:**
  - area «الصفحات والفعاليات» (`AdminPages.html`) with «صفحات الخدمة» /
    «الفعاليات» / «الخدام»;
  - «كروت خدماتنا» under «المحتوى»;
  - help topics `services`, `svcpages`, `events`, `servants`;
  - lock kinds `page`, `event`, `servant`.
- **Stubs** drop the shell's `<meta name="robots">`, and are built from the
  committed `pages/index.html` (fetched from GitHub, cached 10 min) or the
  built-in copy.
- **Slugs:** a page slug is also refused when it names a top-level entry of
  the repository (GitHub `/contents/`, cached 6 h).
- **Partners (§12), built with this phase:**
  - one built-in partner `bug` (`PAGE_PARTNERS` in Pages.gs); its logo files
    are committed under `assets/img/partners/`;
  - a page / an event stores only `partner: 'bug' | ''`, set by the
    «بإشراف Brave Under Grace – B.U.G.» switch in its editor;
  - publishing adds the partner object to page.json / event.json,
    `data-partner` to the stub, the key to content.json `pages`, `events` and
    the linked card, and `partners` to content.json when any item uses one;
  - the intro is `assets/js/page/collab.js`, loaded from the shell's head
    (its partner names and logo paths are listed there too: a new partner
    needs an entry in both places).
- **Not built yet:** booking engine (§4–§7, §9, §13), YouTube playback,
  clips with sound.
