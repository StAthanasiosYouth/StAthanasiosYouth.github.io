# Booking API (Worker) — the contract the UI builds against

docs/EVENTS.md is the product contract (statuses, rules, wording). This file
fixes the **transport**: routes, request/response shapes and error codes on the
Cloudflare Worker (`worker/`). Phase 1 pilot, 2026-10-15.

Base URL: `config.workerUrl` (admin) / `BOOK_CONFIG.apiUrl` (site).
Production `https://athanasios-api.menazak-lab.workers.dev`, staging `https://athanasios-api-staging.menazak-lab.workers.dev`.

**Switches** (both must be on for a visitor to book):
- Worker `settings.BOOKING_MODULE` = `'1'`; otherwise every public `book` route answers `disabled`.
- Published `event.json` `booking.online` = `true`, set at publish by Apps Script when Script Property `BOOKING_ONLINE` = `'1'`.

Production keeps both **off** until go-live.

## Envelope and errors

**Success:** `{ ok: true, …fields }`.

**Failure:** `{ ok: false, code, message, hint?, field?, left?, opensAt?, warnings?, requestId }`. `message` is Arabic and ready to show.

| code | HTTP | meaning |
| --- | --- | --- |
| `bad` | 400 | malformed request |
| `invalid` | 400 | a field failed validation; `field` names it (`name`, `phone`, `counts`, `servantId`, `method`, `proofs`, `names`, `note`, `amount`, `receivedAt`, `amountDue`, `reason`, `retain`, `actual`) |
| `toolarge` | 413 | body over the limit |
| `proof` | 400 | a proof image is unreadable, the wrong type, too big, or not yours |
| `not_found` | 404 | no such event / booking / payment |
| `disabled` | 403 | booking module off, or the event's booking is not online |
| `not_open` | 409 | booking not open yet; carries `opensAt` |
| `closed` | 409 | window closed |
| `full` | 409 | not enough places; carries `left` |
| `limit` | 429 | too many pending bookings for this phone at this event (2) |
| `rate` | 429 | too many requests; `retry-after` header |
| `busy` | 409 | a twin request is running, retry shortly |
| `conflict` | 409 | `version` is stale (someone else changed the booking): reload it. Also an Idempotency-Key reused with another body |
| `final` | 409 | the booking can no longer be changed this way |
| `expired` | 401 | status token expired or tampered |
| `warn` | 409 | payment warnings; `warnings: [{ code, message }]`. Repeat the same call with `force: true` |
| `needs_override` | 409 | confirm blocked by §5.1 (payment) or §9 (capacity); `warnings` says which. Repeat with `overridePay` / `overrideCap` = true plus `reason` |
| `auth` / `denied` | 401 / 403 | admin sign-in (Google ID token only; a remembered-device token is refused) |

**Retries:** every write carries a key (`requestKey`, `idemKey`, or the `Idempotency-Key` header). Retrying with the same key returns the same answer and never writes twice. Retry network errors, 5xx and `busy` with backoff.

## Shapes

```
Stamp      'YYYY-MM-DDTHH:MM' Cairo wall clock (like event.json); '' when none
Counts     { <categoryKey>: n }                (keys from event.json booking.pricing.categories)
People     { adult, child, companion, total }
Derived    { paid, balance, paymentStatus: 'free'|'unpaid'|'partial'|'paid'|'overpaid'|null,
             overdue: bool, refundOwed }       (paymentStatus null while pending)
PayInput   { kind: 'payment'|'refund', amount, servantId, method, receivedAt: Stamp,
             note?, proofIds?: [prf-…] (≤3, uploaded first), idemKey, force? }
```

## Public (no sign-in; CORS for the site only)

### `GET /v1/book/state?slug=<slug>`
Returns `{ open, reason?: 'not_open'|'closed'|'full'|'disabled', opensAt, closesAt, left: n|null, revision }`.
- `left` is null when the event is unlimited, or when `showLeft` is off and left > `showLeftBelow`.
- `Cache-Control: max-age=15`.

### `POST /v1/book/proof?slug=<slug>`
- Body: the raw image bytes, `Content-Type: image/webp|image/jpeg`.
- Returns `{ proofId, claim }`. Pass both to submit; an unclaimed proof is deleted after 24 h.
- The image is prepared in the browser first (≤ 1600 px, WebP q 0.82, stepped down to ≤ 600 KB). The server hard limit is 900 KB / 2400 px.
- Limit: 10 per 10 min per IP.

### `POST /v1/book/submit`
**Request:**
```
{ slug, requestKey (8–100 [A-Za-z0-9_.:-]), name (2–60), phone (Egyptian mobile, any format),
  counts: Counts, names?: [string ≤60] (when collectNames), servantId?, method?,
  note? (≤300), proofs?: [{ proofId, claim }] (≤3), hp: '' (honeypot), revision }
```
**Reply:** `{ ref: 'B-XXXXX', status: 'pending', token, quotedTotal, replay?: true, priceChanged?: true }`.

**Rules:**
- `requestKey` replays return the first answer.
- Server price only. When `revision` differs from the published one, the server price still wins and `priceChanged` is set.
- Free events ignore servant, method and proofs.
- A method with `needsProof` requires 1–3 proofs.
- Pending bookings don't take places. `full` applies when `seats(counts) > left`.
- At most 2 pending bookings per phone per event (`limit`).

### `POST /v1/book/status` — `{ token }`
Returns:
```
{ ref, event: { slug, title, startAt }, status, firstName, people: People, quotedTotal,
  amountDue?, paid?, balance?, paymentStatus?, overdue?, finalDueAt?, reason?, createdAt }
```
It never returns the phone, the full name, proofs or payment rows.

### `POST /v1/book/withdraw` — `{ token, requestKey }`
Returns `{ status: 'withdrawn' }`. Allowed while pending only; otherwise `final`.

**Token** `bk1.<b64url {b,e}>.<sig>`:
- Lives only in the URL fragment: `/events/<slug>/#b/<token>`.
- Expires at the event's end + 60 days.

## Admin (`Authorization: Bearer <Google ID token>`)

### Module and events

| Route | Returns / does |
| --- | --- |
| `GET /v1/admin/book/module` | `{ on: bool, env }` — the admin shows «الحجوزات» only when `on` (or env = staging) |
| `GET /v1/admin/book/events` | `{ events: [{ id, slug, title, startAt, endAt, capacity, taken, left, online, counts: { pending, confirmed, rejected, withdrawn, cancelled }, refreshedAt }] }` |
| `POST /v1/admin/book/events/<slug>/refresh` | Re-reads the published event.json now (after a publish). Returns the event row |
| `POST /v1/admin/book/events/<eventId>/cancel-all` | Body `{ reason, idemKey }`. Returns `{ cancelled: n }`. Every pending and confirmed booking becomes cancelled with retain 0 |

### Bookings

**`GET /v1/admin/book/bookings`**
- Query: `eventId`, `status=pending|confirmed|rejected|withdrawn|cancelled|all`, `overdue=1`, `refunds=1`, `q` (ref / name / phone), `cursor`, `limit` (≤ 100).
- Returns `{ rows: [BookingRow], counts: { byStatus, overdue, refunds }, next }`.
- BookingRow:
```
{ id, ref, eventId, status, source, name, phone, servantId, servantName, method,
  people: People, seats, quotedTotal, amountDue, ...Derived, createdAt, confirmedAt,
  flags: { dupProof, phoneTwice, priceChanged }, version }
```

**`GET /v1/admin/book/bookings/<id>`**
```
{ booking: BookingRow + { requested, actual, names, visitorNote, adminNote, rejectReason,
                         cancelReason, capOverride, dueHistory, priceRev, closedAt, closedBy },
  payments: [{ id, kind, amount, servantId, servantName, method, receivedAt, recordedAt,
               recordedBy, recordedName, proofIds, note, voidsId, voidedBy }],
  proofs: [{ id, purpose, paymentId, by, at, bytes, width, height, dup }],
  derived: Derived,
  event: { id, slug, title, startAt, endAt, capacity, taken, left, perBookingMax, collectNames,
           pricing, payment, methods: [{ key, label, needsProof }],
           servants: [{ id, name, methods }] } }
```

**Writes:**

| Route | Body | Notes |
| --- | --- | --- |
| `POST /v1/admin/book/bookings` | `{ eventId, requestKey, name, phone, counts, names?, servantId?, method?, note?, confirm?: ConfirmBody }` | `source: admin`. Returns the detail |
| `POST /v1/admin/book/bookings/<id>/confirm` | `ConfirmBody = { version, actual: Counts, names?, amountDue, dueReason?, payments?: [PayInput], overrideCap?, overridePay?, reason? }` | §5.1, §9 |
| `POST /v1/admin/book/bookings/<id>/reject` | `{ version, reason, payments?: [PayInput] }` | money received → refund owed |
| `POST /v1/admin/book/bookings/<id>/cancel` | `{ version, reason, retain }` | confirmed only; `retain` ≤ paid |
| `POST /v1/admin/book/bookings/<id>/reopen` | `{ version }` | rejected → pending |
| `POST /v1/admin/book/bookings/<id>/update` | `{ version, actual?, amountDue?, reason?, adminNote?, names? }` | dueHistory; capacity re-check |
| `POST /v1/admin/book/bookings/<id>/payments` | `PayInput` | add a payment or refund |
| `POST /v1/admin/book/payments/<paymentId>/void` | `{ reason, idemKey }` | |

Every write returns the booking detail.

### Proofs

**Upload:** `POST /v1/admin/proofs?purpose=payment&bookingId=<id>` with the raw image, plus the `Idempotency-Key` header. It returns `{ proof: { id, … } }`; then pass the id in `PayInput.proofIds`.

**View:** `GET /v1/admin/proofs/<id>` returns the bytes. Use them as `URL.createObjectURL(await res.blob())`; never as an `<img src>` to the API.

### Reports

| Route | Returns |
| --- | --- |
| `GET /v1/admin/book/summary?eventId=&from=&to=` | Summary exactly as EVENTS.md §13 (`overall`, `servants`) |
| `GET /v1/admin/book/export?eventId=&from=&to=` | `{ event, bookings: [BookingRow+detail fields], payments: [...], servants: [...], summary }`. The admin builds the XLSX in the browser (admin/xlsx.js, §13 sheets) |
