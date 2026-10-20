# Backend migration — final architecture roadmap

Rev. 3, 2026-10-15. Supersedes rev. 1–2 (study, publish separation, site-wide target), which are folded in here.
Status (2026-10-15): **Phase 0 done. Phase 0.5 and Phase 1 *foundation* in progress/done — see `worker/README.md`.** Booking pilot not enabled (needs review + R2).
Approved 2026-10-15: implementation on Cloudflare account `menazakmena@gmail.com`; booking storage D1 + R2 (EVENTS.md §1 revised).
Code base inspected: `origin/main` @ `1ce107b`. Limits and prices come from official pages fetched 2026-10-14/15 (sources at the end).

Approved earlier (2026-10-14):
- Workers + D1, incremental, no big-bang.
- Booking/payment pilot first.
- Publish separated from deploy, after the pilot.
- GitHub Pages, Firebase push and Google Sign-In kept.
- Production untouched during Phase 0.

---

## 0. Decision summary

| Question | Answer |
| --- | --- |
| End state | **B — full Apps Script exit**, reached through A (hybrid) step by step. Not a big-bang |
| Why not stay hybrid forever | Phase 0 proved every remaining Apps Script job has a clean, free Cloudflare equivalent, including push fan-out (tested on Free via Queues). Keeping Apps Script for "Google jobs" would mean two runtimes, two deploys, two auth checks, two secret stores and a server-to-server channel, all to keep jobs that Workers do as well. Every action left on Apps Script keeps its ~2 s floor |
| Better architecture (C)? | None found. Durable Objects-as-database gives the same latency as D1 here with worse tooling. Supabase, Firebase and the VPS options were rejected in rev. 1 (pausing, uncapped billing, cold starts, self-ops) |
| What Google stays for | **Google Sign-In** (OAuth client) and **Firebase Cloud Messaging**. Both are Google Cloud services, not Apps Script. Sheets and Drive end up **archived, read-only** |
| Hosting | **GitHub Pages on `stathanasiosyouth.github.io` stays.** It serves code, assets, page shells and public media. Published *content* comes from the Worker, with a static fallback. A custom domain is optional later |
| Measured speed-up | Every API action **~0.1 s** warm from here (p50 88–148 ms), against an Apps Script floor of **1.9–3.4 s** for an empty call. That is ~20× |
| Cost at our scale (~300 public users, ~7 admins) | **$0.** All usage is below ~10% of free limits. Optional $5/mo Workers Paid for 30-day backups |
| Biggest speed win first | Fastest felt win: Phase 0.5 front-end quick wins (days). Biggest structural wins: Phase 2 (publish visible instantly) and Phase 4 (every content save ~3.6 s → ~0.15 s) |
| Exact next phase | **Phase 1 — Foundation + booking pilot**, after the 3 decisions in §26 |

---

## 1. Phase 0 results (2026-10-15, isolated spike)

**Setup.**
- Worker `ath-phase0-spike` on `menazak-lab.workers.dev`.
- Two isolated D1 databases: `weur` and `eeur`.
- One test queue.
- **Synthetic data only**: 3,000 participants, 15,000 ledger rows, 1,500 bookings and 1,500 payments, plus a copy of the public `content.json`.
- Production, the live site and Apps Script were not touched.

**How it was measured.** Client = this machine (the admin's network). Code and raw numbers: `spike/phase0/` (`bench.mjs`, `results-*.json`).

### 1.1 Latency (ms, warm connection unless noted)

| Operation | p50 | p95 | Notes |
| --- | --- | --- | --- |
| **Apps Script, empty call (no Sheets)** | **2,190** | **3,389** | Same session, same network. Real admin actions add Sheet work on top (§13) |
| Worker, no DB | 73 | 81 | Served from Milan/Zurich (Cloudflare picked MXP/ZRH from this network) |
| New connection incl. TLS (first call) | 219 | 236 | What a freshly opened page pays once |
| D1 ping — `weur` / `eeur` | 101 / 88 | 132 / 113 | **`eeur` ~13 ms faster from here** |
| Simple read (row + balance) `weur` / `eeur` | 102 / 87 | 129 / 97 | |
| Filtered list (group + search + count) | 102 | 115 | |
| Full registry, 3,000 rows (266 KB) | 159 | 173 | SQL 6 ms; the rest is transfer |
| Public content (19 KB JSON) / 304 not-modified | 103 / 105 | 109 | ETag works |
| Save + activity row (atomic batch) | 110 | 273 | |
| Booking submit (idempotent) | 109 | 394 | |
| Confirm booking (capacity-guarded) | 109 | 245 | |
| Add payment (idempotent + activity + new total) | 148 | 473 | 2 round trips to D1 |
| Redeem (balance + stock guarded) + ledger charge | 112 | 628 | |
| Google-style RS256 token verify | 66 | 78 | No CPU-limit errors over 30 runs |

### 1.2 Correctness under concurrency (all requests fired at once)

| Test | Result |
| --- | --- |
| 200 confirms against capacity **50** | **exactly 50 seats confirmed**, 50 reported confirmed, 0 errors (wall 3.1 s; p50 1.8 s under that artificial pile-up) |
| 120 redeems, stock **10**, 40 wallets that could afford 2 each | **exactly 10 redeemed, 0 negative balances** (wall 0.53 s) |
| 50 duplicate payments with the same idempotency key + 50 distinct | **exactly 51 rows, total 600** (1 + 50) |
| 300 booking submits at once | 299 ok, **1 transient `D1_ERROR: Network connection lost`** → writes must be idempotent and retried (they are, by key) |
| 100 reads at once | 0 errors, p50 202 ms |

### 1.3 Platform limits verified empirically

| Check | Result |
| --- | --- |
| Subrequests per invocation (Free) | **Exactly 50**; the 51st fails with "Too many subrequests" |
| Push-style fan-out through **Queues on Free** | 300 simulated sends in 7 batches of 45, **all done ~9 s after enqueue, 0 failures** |
| Google JWKS fetch from a Worker | Works; cached per isolate |
| Import write cost | Seeding ~23k rows cost **~90k rows written**, because index entries count. **A full data migration must be split across days or done in a $5 month** (§20) |
| Free daily quota used by the whole Phase 0 | `weur` 97k rows read / 93k written (mostly the seed); `eeur` 13.6k written |

### 1.4 What Phase 0 did not measure

- Mobile data (expect +50–200 ms).
- A real Google ID token. The RS256 cost is identical; the real token is checked in Phase 1.
- Turnstile.
- Workers Cache on workers.dev.
- FCM topic delivery to web.

All are Phase 1 checklist items.

### 1.5 Conclusions

1. **Latency target met with a large margin.** Every routine operation is ~0.1 s server-confirmed, and ≤ 0.65 s p95.
2. **Atomic patterns are correct** with no interactive transactions: guarded single statements, atomic batches, UNIQUE idempotency keys.
3. **Use `eeur`** as the D1 location.
4. **Retries are required.** Transient D1 errors happen under bursts; every write carries an idempotency key and the client retries with backoff.
5. **Push fan-out works on Free** through Queues. Put ~45 tokens *per message* so a broadcast costs ~3 queue ops per 45 subscribers, not 3 per subscriber.
6. Nothing found forces Workers Paid at our scale.

---

## 2. Final target architecture

```
                       GitHub (source of truth: code, history, public static files)
                         │ push → GitHub Actions → wrangler deploy (Worker) + Pages build (site)
                         ▼
Visitor / Admin browser ── stathanasiosyouth.github.io  (GitHub Pages)
   │                        shells, JS/CSS, fonts, public media, last published snapshot (fallback)
   │
   └── fetch ──► Cloudflare Worker  api.<sub>.workers.dev
                   ├─ D1 (eeur): drafts, published revisions, private data, ledgers, activity
                   ├─ R2 (private): payment proofs, media originals
                   ├─ Queues: push fan-out, GitHub mirror commits, heavy jobs
                   ├─ Cron (≤5): scheduled pushes, retention, mirror retries
                   ├─ → GitHub API: publish snapshots, new-slug stubs, public media commits
                   ├─ → FCM HTTP v1: push (service-account JWT signed in the Worker)
                   └─ → Google JWKS: admin sign-in verification

Backups: D1 Time Travel (7 d) + nightly GitHub Actions `wrangler d1 export` → encrypted → private backup repo
Google: OAuth client (Sign-In), Firebase project (FCM). Apps Script: retired. Sheets/Drive: archived read-only.
```

---

## 3. Does Apps Script remain?

**Final state: no.**

During migration it keeps every module that has not moved yet, plus the publish build until Phase 4. After Phase 7 it has no deployment and no triggers. The project is archived for 90 days, then deleted.

### 3.1 Requirements for full removal, and their status

| Apps Script job today | Replacement | Verified |
| --- | --- | --- |
| API router, auth, sessions, locks | Worker + D1 | Phase 0 |
| Sheets as database | D1 tables (§12) | Phase 0 |
| Script Properties (secrets, switches) | Worker secrets (secrets) + D1 `settings` (switches) | standard |
| CacheService | D1 rows with TTL / Worker memory / HTTP caching | standard |
| LockService (one global lock) | Guarded statements, idempotency keys, row versions | Phase 0 races |
| Drive media library | R2 (originals) + GitHub (public files) | R2 free 10 GB |
| GitHub publish (UrlFetch) | Worker → GitHub API (4–5 requests per commit) | docs; ≪ 50 subrequests |
| FCM fan-out (UrlFetch `fetchAll`) | Queues consumer, 45 per batch | **Phase 0** |
| FCM OAuth (`computeRsaSha256Signature`) | WebCrypto RS256 in the Worker | Phase 0 (RS256) |
| Time triggers (scheduled push, daily jobs) | Cron Triggers (5 on Free, 1-minute granularity) | docs |
| openrouteservice route proxy | Worker fetch + D1 cache + daily budget | trivial |
| Recovery admin (HtmlService) | Not needed: after migration it would only see frozen Sheets. Recovery = D1 Time Travel + `wrangler` + backups | — |
| Sheets as hand-editable data | Admin UI + XLSX export/import (already exists for participants) | exists |

### 3.2 Is full removal worth it?

Yes, at the end. The cost is ~1–2 days for the last jobs (push, triggers, route) once everything else has moved. What it buys:
- one runtime, one deploy, one test stack, one auth path;
- no 2 s floor anywhere;
- no Google quota surprises (UrlFetch 20k/day, 30 concurrent executions);
- no "as Me" execution tied to one personal Google account.

The trade-off is that Cloudflare becomes the single vendor for live data. It is mitigated by:
- nightly off-Cloudflare encrypted backups;
- portable SQLite;
- GitHub keeping all code and public content.

---

## 4. GitHub Pages: what stays, what moves

| Stays on GitHub Pages | Moves |
| --- | --- |
| All code (JS/CSS/HTML shells, admin SPA), fonts, icons, manifest, service worker | **Published content** (`content.json`, `page.json`, `event.json`, `comp.json`): served by the Worker from D1 revisions; GitHub keeps a background snapshot as history + fallback |
| Public media files (committed at upload time, in the background) | **Media originals / library**: R2 |
| Page shells/stubs per slug (`/events/<slug>/`, `/black-theatre/`, `/competition/<slug>/`), with OG tags | New slugs: shown at once through a `404.html` shell; the stub is committed in the background (§19) |
| Code deploys (~1 min Pages build) | Content publishing no longer triggers a deploy, except the tiny background stub/snapshot commits |

---

## 5. «راجع وانشر» in the final architecture

```
«راجع»   browser: build(draft) with the shared pure builders → diff against the live revision (ETag-cached)  ~0.1–0.3 s
«وانشر»  Worker: re-build + validate (schema, "no private data" scan) → one D1 batch:
          insert revision(s), flip `live`, enqueue mirror job → reply                       ~0.15–0.4 s
visitors next page load reads the new revision (new ETag)                                     immediately
background Queue job: one GitHub commit (snapshot JSON + changed stubs) → mark mirrored     ~5–60 s, nobody waits
undo     «ارجع للنسخة اللي قبلها»: flip `live` to an older revision (+ mirror)                ~0.15 s
```

**Safeguards:**
- Publish is serialized by a claim row in `publish_jobs`, not a global lock.
- The revision being published must match the one the admin reviewed (same rule as today).
- GitHub being down never blocks publishing. The admin sees «نسخة GitHub متأخرة» until the mirror catches up.

---

## 6. Where public content, drafts and versions live

| What | Where |
| --- | --- |
| Drafts (links, sections, contacts, sessions, news, games, notifications, activities/types, pages, page media, events, servants, pay methods, settings) | **D1** draft tables, one row per entity, with `version` for conflict detection |
| Published versions | **D1 `published_revisions`**: immutable, every version kept, one `live` per (kind, key) |
| Public read path | Worker GET with ETag → browser. Fallback: last mirrored snapshot on GitHub Pages |
| History / audit | D1 revisions + GitHub commit per publish + `activity` |
| Competition definitions | `comp_versions` (immutable per version) in D1; public part published like other content |

---

## 7. Where private data lives

- **D1 only**, location `eeur` (EU).
- Private data includes: participants (names, phones, birth dates, code hashes/encrypted codes), submissions/answers, ledger, redemptions, bookings, payments, admin devices, push tokens and activity.
- **Never** on GitHub, in published revisions, in push payloads, or in Activity `changes`. The existing test that guarantees this is extended to the Worker's public responses and every revision.
- **Secrets** live only as Worker secrets: `COMP_SECRET`, `CODE_PEPPER`, `CODE_KEY`, the FCM service account, the GitHub token, the openrouteservice key and the backup public key.

---

## 8. Media, payment proofs and other files

| Files | Where | Why |
| --- | --- | --- |
| Public images/videos (existing 21 MB) | **Repo / GitHub Pages**, unchanged | Free CDN, cached, versioned |
| New public media | Browser processes it (as today) → Worker → original to **R2** + derivatives committed to **GitHub at upload time** (Queue job). Publish never moves bytes | Instant publish; free hosting |
| Media library originals (Drive today) | **R2 private bucket**; one-time copy of the existing Drive library in Phase 4 (~21 MB) | Drive needs user-OAuth plumbing from a Worker (service accounts can't own files in a personal Gmail Drive) |
| Payment proofs / booking attachments | **R2 private bucket**, admin-only streaming, deleted after 60 days | Private by default, free egress |
| Exports (XLSX) | Generated in the browser (`admin/xlsx.js`), not stored | As today |
| Backups | Encrypted, in a private GitHub repo | Off-Cloudflare copy |

---

## 9. Google Sign-In / admin authentication

**Sign-in.**
- Same Google Identity Services button and the same OAuth client ID.
- The browser holds the ID token in memory, as today.

**Server check.** The Worker verifies the token **locally** against Google's JWKS. It checks the RS256 signature (66 ms p50 round trip in Phase 0), `aud`, `iss`, `exp` and `email_verified`. There is no call to Google's `tokeninfo` per request.

**Who is an admin.**
- `admins` table in D1, keyed by email **and** Google `sub`; ≤ 20 admins, with a primary admin who can't be removed.
- `GOOGLE_ONLY_FUNCTIONS` keeps requiring a fresh Google token for allowlist and device changes.

**Sessions, presence and edit locks** (Phase 3).
- `sessions`, `presence`, `edit_locks` rows with expiry.
- One live session per account, as today.
- Heartbeat becomes a cheap D1 upsert, with no global lock.

**Trusted devices.**
- The `adm1.` HMAC challenge flow is ported as-is.
- Device secrets move into D1 (encrypted with a Worker secret).

**During Phase 1–2 (hybrid):**
- The Worker accepts the same Google token.
- The allowlist is synced from Apps Script on change.
- Booking edit locks live in D1.

**Not used:** passwords, Supabase/Firebase Auth, Cloudflare Access.

---

## 10. Firebase push

**Kept as is:** the Firebase project, web SDK, service worker and **FCM HTTP v1**.

**Sending.**
- Worker signs the service-account JWT and caches the access token (~1 h).
- Broadcast: D1 subscriber rows → Queue messages of **45 tokens each** → consumer sends them → dead tokens (`UNREGISTERED`) are pruned.
- Phase 0 timing: 300 recipients in ~9 s.
- Admin notifications use the same path.

**Scheduled pushes** come from a 1-minute cron that reads `push_schedule`.

**Watch item:** FCM is moving web registration to Firebase Installation IDs and a new `register()` API. Legacy IID topic endpoints shut down on 2027-09-29. We don't use topics, and per-token v1 sends are unaffected. Adopt the new client API when convenient (Phase 6).

---

## 11. Sheets and Drive

| | During migration | Final |
| --- | --- | --- |
| Sheets | Source of truth for modules not yet moved. A moved module's tabs become **frozen** (protected + renamed `_frozen_…`) | **Archived, read-only.** Nothing reads or writes them. Reports come from XLSX exports in the admin |
| Drive | Media library until Phase 4; booking proofs never go there | Archived after the one-time copy to R2 |
| Optional | A nightly XLSX/CSV snapshot to Drive *can* be added later if leadership wants Google-side reports. It needs a user OAuth refresh token. **Not planned by default** | — |

---

## 12. Database design direction

**Common rules:**
- Text IDs copied verbatim from Sheets (`p-…`, `cmp-…`, `l-…`, `evt-…`, …).
- Money as integer EGP; times as epoch ms.
- Append-only ledgers (points, payments) with totals derived by indexed `SUM`.
- `UNIQUE` idempotency keys; `version` on editable rows.
- Column names mirror COMPETITIONS.md / EVENTS.md, so a reverse export to Sheets is a straight copy.

### Bookings and payments (Phase 1)

| Table | Contents |
| --- | --- |
| `event_cfg` | Synced from Sheets until Phase 4, then the `events` draft table owns it: capacity, price, `payment_mode`, `opens_at`, `closes_at`, state |
| `bookings` | `id`, `event_id`↓, `status` (pending/confirmed/rejected/cancelled), `seats`, `amount_due`, `name`, `phone`, `participant_id`, `client_key` UNIQUE, `status_token_hash`, decided by/at |
| `payments` | Append-only. `id`, `booking_id`↓, signed `amount`, `method`, `servant_id`, `received_at`, `proof_id`, `recorded_by`, `voids_id` (partial UNIQUE), `idem_key` UNIQUE |
| `proofs` | `id`, `booking_id`, `r2_key`, `mime`, `bytes`, `sha256`, `delete_after` |

### Participants (Phase 5)

| Table | Contents |
| --- | --- |
| `participants` | `id`, `name`, `phone`, `birth_date`, `grp`, `responsible_servant`, `active`, `code_hash` UNIQUE, `code_enc`, `code_version`, `version` |
| `age_rules` | — |

Codes, hashes and the same secrets carry over unchanged, so **every printed code keeps working**.

### Competitions (Phases 5–6)

| Table | Contents |
| --- | --- |
| `competitions` | Draft |
| `questions` | Draft, ordered |
| `comp_versions` | Immutable definition snapshot per published version (replaces the chunked `Snapshots` tab) |
| `submissions` | `id`, `comp_id`, `participant_id`, `client_key` UNIQUE, answers JSON (private), score, status, graded by/at |

### Points (Phase 5)

| Table | Contents |
| --- | --- |
| `points_ledger` | Append-only. `participant_id`↓, `season_id`↓, signed `delta`, `reason`, `ref`, `idem_key` UNIQUE |
| `seasons` | — |
| `season_totals` | Materialized at season close and for leaderboards (recomputed on change, so the 5M/day read budget isn't burned) |

### Store (Phase 5)

| Table | Contents |
| --- | --- |
| `store_items` | `cost`, `stock`, schedule |
| `redemptions` | `request_key` UNIQUE, `status`, `item_id`↓ |
| `store_settings` | — |

Redeem = one guarded `INSERT … SELECT` + ledger charge in one batch (Phase 0 test).

### Activity (Phase 3)

`activity`:
- Columns: `id`, `at`↓, `actor`, `action`, `entity_type/id/title`, `summary`, `changes` (≤ 1 KB, no private data), `device`.
- Same-actor edits within 10 minutes are merged into one row.
- Kept 365 days / 5k rows; trimmed by cron.
- Written **in the same batch** as the action, so it is never lost and never adds latency.

### Content, pages and events (Phase 4)

| Table | Contents |
| --- | --- |
| Draft tables per entity | `links`, `sections`, `contacts`, `sessions_cal`, `news`, `games`, `notifications`, `activities`, `types`, `pages`, `page_media`, `events`, `servants`, `pay_methods`, `settings`, `media` |
| `published_revisions` | `kind`, `key`, `rev`, `json`, `etag`, `live`, `published_by/at`, `github_commit` |
| `publish_jobs` | — |

### Platform

`admins`, `sessions`, `edit_locks`, `admin_devices`, `push_subs`, `admin_push_subs`, `push_log`, `push_schedule`, `api_log` (latency/outcome sampling), `rate_limits`, `jobs`.

---

## 13. Site-wide performance targets

"Today" = realistic warm latency: the repo's cost model (`tools/profile-admin.mjs`) calibrated to the measured floor. Cold starts add 5–15 s.
"Target" = server time from Phase 0 measurements; add 50–200 ms on mobile data.

| Action | Today | Target | Class |
| --- | --- | --- | --- |
| Admin open / sign-in | 3–15 s | **< 0.8 s** (one bootstrap call) | server |
| Filters / search / sort | instant (local) – 4 s (server-paged) | **instant** local; ≤ 0.2 s server-paged | instant |
| Open an editor | instant from cache + ~3 s detail | **instant** + 0.1 s | instant |
| Save a draft (news, link, section, page, event, comp basics, question) | ~3.6 s | **instant UI**, 0.1–0.3 s confirm | optimistic (drafts only) |
| Show/hide, reorder, archive, soft-delete with undo | ~3.4 s | **instant UI**, 0.1–0.2 s | optimistic |
| Review «راجع» | ~4.1 s | **0.1–0.3 s** | server/local |
| Publish «وانشر» → visible | ~7 s + ~60 s | **0.15–0.4 s, visible at once** | server + background mirror |
| New page/event live | ~4 s + publish + 60 s | live at once; SEO stub ~1–2 min (background) | server + background |
| Booking submit (public) | (new) | 0.1–0.4 s | server, idempotent |
| Confirm/reject booking | (new) | **0.1–0.25 s** | server, never optimistic |
| Record / void / refund payment | (new) | **0.15–0.5 s** | server, never optimistic |
| Proof upload | Drive 4–8 s | 0.5–2 s (phone upload speed) | external-bound |
| Participant add / code reset | ~3.0 s | 0.1–0.3 s | server |
| Participant field edit | ~3.6 s | instant UI | optimistic |
| Participant import (≤ 3,000) | several s | 1–3 s (+ write budget, §20) | server, progress |
| Points adjust | ~3.5 s | 0.1–0.3 s | server |
| Store redeem / approve / cancel | 3–5 s, `busy` in bursts | 0.1–0.65 s | server |
| Competition start / submit (public) | 2.5–5 s, `busy` in bursts | 0.1–0.5 s | server |
| Close / finalize / regrade / season close | ~3.4 s+ | 0.2–1.5 s | server, progress for big ones |
| Activity log | instant + 2–3 s refresh | instant + 0.1 s | instant |
| Heartbeat / presence | ~2–3 s under the global lock | 0.1 s, no lock | background |
| Admin notifications | +0.5–2 s on the action | 0 on the action | background |
| Push to visitors | 5–60 s blocking | instant "queued"; delivered in ~10 s per 300 | background |
| Media upload / trim | 4–10 s + browser processing | upload-bound; GitHub commit in background | external-bound |
| Public page first view | 0.2–0.4 s (static) | same (shell) + ~0.1 s content | instant |
| Code deploy | ~1 min | ~1 min, only for code | external-bound |

**Cannot be instant:**
- Phone uploads.
- Browser video processing.
- Push delivery itself.
- GitHub Pages deploys (code, plus background stubs/snapshots).
- A first visit on a slow network.

**Optimistic UI rules.**
- **Allowed** for drafts under an edit lock, toggles, reorders, display names, alt text and soft deletes with undo.
- **Never** for money, capacity, points, stock, participant codes, publish, permanent deletes or allowlist changes.
- A failed optimistic change rolls back visibly, with a retry.

---

## 14. Background / asynchronous jobs

All of these run on Queues or Cron, with the job state visible in the admin.

- GitHub mirror commits: published snapshots, new-slug stubs, public media derivatives.
- Push fan-out (visitors + admins) and scheduled pushes.
- Proof retention (60 days), activity/log trimming, expired sessions/locks.
- Leaderboard / season-total recompute after ledger changes.
- Nightly backup (GitHub Actions, outside Cloudflare).
- Sheets reverse-export during rollback windows only.

**Never asynchronous:** the decision part of payments, capacity, points, stock, codes and publish. These are always confirmed by the server before the UI says "done".

---

## 15. Caching strategy

| What | How | Invalidation |
| --- | --- | --- |
| Published revisions | ETag + `no-cache` → 304 (Phase 0: 105 ms; tiny payload); static fallback on GitHub Pages | New revision = new ETag |
| Live event status (seats, open/closed) | Response cached 15–30 s | TTL. Decisions are always re-checked inside the transaction |
| Leaderboards / season totals | Summary rows | Recomputed on change |
| Competition definitions | Immutable per version → long `max-age` | Version in the URL |
| Admin lists | Browser memory/IndexedDB, stale-while-revalidate (extends today's Media/Activity pattern) | Per-table `version` → 304 or delta |
| Google JWKS, FCM access token | Worker memory | Per `Cache-Control` / expiry |
| **Never cached for decisions** | balances, stock, capacity, payment totals | — |

Workers Cache (the 2026 feature) bills **every** request, including static hits. Not needed at our scale.

---

## 16. Transactions and concurrency

1. **One guarded statement or one atomic `batch()` per critical operation.** D1 has a single writer, and Phase 0 proved exact capacity, stock and balance under 200 simultaneous requests.
2. **UNIQUE idempotency keys** on every create (`client_key`, `idem_key`, `request_key`). Replays are no-ops, which makes retries safe.
3. **Client retry with backoff** on network/5xx/`D1_ERROR` (seen 1 in 300 under burst), always with the same key.
4. **Row `version`** on drafts: `UPDATE … WHERE id=? AND version=?`. On conflict the admin sees «حد عدّل ده» instead of losing edits. Edit locks stay for the UX.
5. **Publish** is serialized by a claim row in `publish_jobs`.
6. **No global lock anywhere.** If a future flow truly needs read-decide-write in code, it uses a Durable Object for that one flow.
7. **Batch sizes** stay ≤ ~100 statements (Free allows 50 queries per invocation; bulk imports are chunked by a Queue job).

---

## 17. Backup, versioning and rollback

| Layer | Mechanism |
| --- | --- |
| Point-in-time | D1 Time Travel: **7 days on Free**, 30 on $5 |
| Nightly off-Cloudflare | GitHub Actions: `wrangler d1 export` → encrypted with a public key whose private half is held offline by 2 admins → committed to a **private** backup repo. Restore drill once per phase |
| Content versions | Every publish kept in D1 `published_revisions` + a GitHub commit (public data only) |
| Code | GitHub; Worker versions (`wrangler rollback` to a previous version in seconds) |
| Payments, points | Append-only; corrections are reversal rows |
| Proofs | R2 only, 60-day life. *Not* backed up off-Cloudflare by default; payment rows are the record (decide in §26 if you want a copy) |
| Module rollback | §23 |

---

## 18. Domain strategy

| | Keep `stathanasiosyouth.github.io` (**chosen**) | `*.workers.dev` | Custom domain later (~$10/yr) |
| --- | --- | --- | --- |
| Role | Public site + admin, unchanged URLs | **API host only** (and staging previews) | Optional upgrade: whole site on Workers Static Assets |
| Push subscribers / installed admin app / trusted devices | kept | n/a | **lost** (new origin): re-subscribe, re-trust |
| Old links | — | — | GitHub 301-redirects `github.io/<path>` to the domain automatically |
| Cost | $0 | $0 | ~$10/yr |

**API hostname.** It is `<worker>.<account-subdomain>.workers.dev`. The spike used the account subdomain `menazak-lab`. For production, use the church-owned account and a fitting subdomain (it can be changed later).

**If a custom domain is ever wanted**, do it early. The longer we wait, the more push subscribers have to be re-collected. Before moving:
- ship a service-worker handover;
- add the new origin to the OAuth client;
- show a re-subscribe prompt.

---

## 19. SEO and link-preview implications

- **Existing pages: no change.** The static stubs with OG tags stay.
- **Content edits** to existing pages: Google renders JS (it indexes the updated content). WhatsApp/Facebook previews read the stub's OG tags. When the title, description or image changes, the stub is re-committed in the background (~1–2 min).
- **New slug:** visitors see it at once through `404.html` (HTTP 404 status). Crawlers and previews get the real stub with a 200 status after the background commit (~1–2 min). An acceptable gap for us.
- **Custom domain (optional):** removes the gap, because the Worker renders OG tags on the server for any slug (HTMLRewriter).
- **Fallback:** if the API is down, pages render from the last snapshot, so SEO and availability never depend on the Worker.

---

## 20. Free-tier limits and what happens at them

| Limit (Free) | Our expected use | If hit |
| --- | --- | --- |
| Workers 100k requests/day | ~1–5k/day (bursts ≤ 20k) | Error 1027 until 00:00 UTC (02:00/03:00 Cairo). Public pages fall back to the static snapshot; admin shows a clear error |
| 10 ms CPU per request (soft) | RS256 verify and 3,000-row JSON passed in Phase 0 | Error 1102. Keep heavy work in Queues/browser; $5 removes it |
| 50 subrequests per invocation | Max ~6 per admin action; push batched at 45 | Error for the extra fetches (Phase 0 confirmed) |
| D1 5M rows read/day | < 300k/day with indexes + summary rows | Queries fail until 00:00 UTC |
| D1 100k rows written/day (**index entries count**) | < 5k/day normally | Writes fail until 00:00 UTC. **Data migration** of a big module must be spread across days (or done in a $5 month) |
| D1 500 MB per DB | < 50 MB | Writes blocked (alert at 50%) |
| R2 10 GB, 1M/10M ops per month | < 1 GB | **Billed** above the free tier (R2 is metered; enabling R2 is expected to require a payment method on file — confirm in Phase 1). At < 1 GB we are ~10× below; add a billing notification |
| Queues 10k operations/day | ~3 ops per 45 tokens → trivial | Sends delayed |
| Cron 5 per account | 2–3 needed | — |
| D1 Time Travel 7 days | — | Longer history needs $5 (30 d) or the nightly backups |

Alerts: a daily cron reads the usage counters and pushes an admin notification at 50% of any daily limit.

---

## 21. Expected cost at our actual scale (~300 public users, ~7 admins)

| Item | Monthly |
| --- | --- |
| Cloudflare Workers + D1 + R2 + Queues (Free) | **$0** |
| GitHub (Pages, Actions on the public repo, private backup repo) | **$0** |
| Firebase FCM, Google Sign-In | **$0** |
| **Total** | **$0** |
| Optional: Workers Paid (30-day Time Travel, no 10 ms CPU or daily caps) | $5 |
| Optional: custom domain | ~$10/yr |

Usage at this scale is < 10% of every free limit. **No surprise bills:** Workers/D1/Queues on Free have no metered billing (hard stops). R2 is the only metered product (likely needs a card on file to enable); it bills only above 10 GB / 1M writes / 10M reads per month, and proofs are deleted after 60 days, so we stay far below. A Cloudflare billing notification covers it.

---

## 22. Migration order (no big-bang)

| Phase | Scope | Speed effect | Gate |
| --- | --- | --- | --- |
| **0 ✔ Spike** | Isolated Worker/D1/queue, benchmarks | — | Passed (§1) |
| **0.5 Front-end quick wins** (alongside Phase 1) | Optimistic draft saves, stale-while-revalidate on every list, pre-warm call on admin open, admin push moved off the reply path (1 small Apps Script change). Front-end work carries over unchanged | **First felt win: days, not weeks** | Drafts feel instant |
| **1 Foundation + booking pilot** | Production Worker (church account), D1 `eeur`, R2, CI deploy, nightly backup, auth + allowlist sync, admin transport routing, CSP, retries. EVENTS.md 4–6 on the Worker; event config synced from Apps Script; public seats/status reads. **One small event first** | Bookings born fast | One real event clean; restore drill |
| **2 Publish separation** | `published_revisions`, public loaders (Worker + static fallback), Apps Script publish posts its build to the Worker, background GitHub mirror, `404.html` shell, browser-side Review, revision restore | **Publish visible at once; ~7 s + 60 s → ~3 s** | 1–2 weeks of equal shadow hashes |
| **3 Admin platform** | Sessions, presence, edit locks, activity, admins, devices, bootstrap call | Panel load < 1 s; no heartbeat contention | Admin chrome off Apps Script |
| **4 Content + pages/events + media** | Draft tables + the pure builders in the Worker; publish fully in the Worker; Drive library → R2 one-time copy; upload-time GitHub commits | **Biggest everyday win: every content save ~3.6 s → ~0.15 s; publish < 0.4 s** | Content tabs frozen |
| **5 Registry + points + store + competitions runtime** | Data migration (dry run → freeze → copy → verify → flip; spread over days for write limits) | Public bursts and all those screens ~0.1–0.5 s; no `busy` | Balances/stock/codes verified equal |
| **6 Competition authoring, seasons, push, route** | Push via Queues + cron; schedule; openrouteservice | Push no longer blocks; everything off Apps Script | Apps Script has no live callers |
| **7 Retirement** | Remove `script.google.com` from config/CSP, undeploy, delete triggers, archive Sheets/Drive read-only, keep the project 90 days | — | §25 checklist |
| **8 Complete Admin UI/UX redesign** (after 7 / 7a and retirement) | Visual and interaction redesign of every Admin module on the finished backend. Spec: §22.1 | Clearer, faster admin work; no backend effect | §22.1 acceptance criteria |
| Optional: custom domain (unnumbered; was "Phase 8") | Whole site on Workers Static Assets | Instant new-slug previews | Only if wanted; best done early (§18) |

**Rules across all phases:**
- **One writer per module at any moment.** No dual writes.
- Each phase ships behind a switch.
- Production is changed only at the phase's cutover step.

### 22.1 Phase 8 — Complete Admin UI/UX redesign

Decided 2026-10-20 (owner). No further Admin modules are planned, so all functional work and the Cloudflare migration finish first. The full visual redesign is done once, at the end, on a stable backend. Planning only: nothing is built until a separate execution approval.

**Until Phase 8 (Phases 1–7):**
- Build new functionality normally, **with the existing admin components only** (buttons, sheets, tabs, cards, chips). No new one-off visual patterns. This keeps Phase 8 a restyle of a few patterns instead of many.
- Fix only **essential usability issues**: an issue that blocks a task, invites a wrong or destructive click, hides or truncates data, or blocks keyboard/screen-reader use. Everything else goes into the Phase 8 backlog (below).
- Already known essential items (each still needs its own approval):
  - native date/time fields truncated in the event editor sheet (`10/31/20`, `08:00 P!`);
  - the handover list uses a plain-text «إلغاء» for a destructive void, the same word as the sheets' Cancel. Needs a distinct label (for example «إلغاء التسليم») and a confirm.
- Phase 1.5 builds the **permission-aware navigation model** (which modules a user sees) as data/logic. Phase 8 only restyles it.
- Phase 4 builds the **R2 media upload flow** functionally (direct upload, progress, errors). Phase 8 redesigns its presentation.
- The **public (visitor) InstaPay/wallet payment step** stays in Phase 1 §4.7 (BOOKING-PHASE1-COMPLETION-PLAN). It is not Admin and is not deferred.

**Dependencies:**
- Hard: Phase 6 done (every Admin screen exists) and Phase 7a done (notification audit).
- Preferred, as decided: Phase 7b retirement done. The admin then has a single transport (Worker), so the Apps Script call paths are gone from `admin-app.js` before its UI is reworked.
- Not dependent on the optional custom domain.

**Prerequisites (first step of Phase 8):**
- Screenshot baselines of every Admin screen at 3 widths (phone 375, tablet 768, desktop 1440+), extending `admin/layout-check.js`.
- A feature-parity inventory: every action per screen (add, edit, delete, save, export, approve, publish…), checked off again at the end.
- The Phase 8 backlog collected during Phases 1–7.

**Scope:**
1. **Design system:** tokens for typography, spacing, radius, elevation and motion on the existing navy/gold identity (DESIGN.md); one icon set; cards; responsive grid; `prefers-reduced-motion` respected.
2. **Action hierarchy:** primary / secondary / quiet / destructive buttons with consistent icons for Add, Edit, Delete, Save, Export, Approve; an in-app confirm dialog replacing native `confirm()` (32 calls today); an undo toast where the action is reversible.
3. **Shell:** collapsible rail (icons-only / expanded, remembered per device), clearer grouping, spacing and active states; mobile dock and drawer behavior.
4. **Branding:** the family logo replaces the decorative cross mark (`.brand__cross`; it is not an Add button, so no feature is lost); a Settings gear in the header replaces the «الإعدادات» rail item.
5. **Layouts and editors:** wider content area (today ~790px on 1920px screens); three editor sizes by task: centered dialog (short forms, confirmations), wide two-column panel (servant, payment method, contact), full-page editor with a section index and a fixed save bar (events, pages, competitions); unsaved-changes guard; Ctrl+S / Esc / focus trap.
6. **Controls:** brand-consistent dropdowns (`appearance: base-select` where supported, native fallback; a custom listbox only for options with icons); themed date/time fields; toggle rows instead of checkbox cards.
7. **Media library:** grid that uses the width, readable titles instead of raw file names, lightbox preview, bulk select, upload queue and progress, loading/empty/error states.
8. **Payment UI (Admin):** InstaPay mark per its brand guidelines, a generic wallet icon; payment-methods settings as cards with readable names (no raw `cash`/`instapay`/`wallet` keys) that save like every other editor.
9. **Data screens:** finance and booking tables with tabular numerals and cards on mobile; long explanations moved into collapsible help; one numeral style per context.
10. **Accessibility:** WCAG 2.2 AA contrast, focus order, labels, right-to-left icon mirroring, 44px touch targets.
11. **Image or icon:** every image field that represents content (cover image, home card, page/section banner, link and contact tiles; not posters, galleries or proof uploads) offers a choice: «صورة» or «أيقونة».
    - **Icon picker:** a curated, licensed SVG set in one stroke style, plus a small family set (cross, church, Bible, candle, Coptic motifs); search in Arabic and English, categories, recent picks; a live preview of the result at its real size; keyboard and touch friendly; full-screen sheet on mobile.
    - **Display:** the icon is rendered as a branded tile wherever the image would appear (navy surface, gold glyph, the arch/hairline frame from DESIGN.md), scaled per slot (card, banner, list thumbnail, admin list row), with an optional accent from the existing tokens. No blurry raster fallback.
    - **Data:** additive and backward compatible: an optional icon key next to the existing image field; image wins if both exist; old content renders unchanged. The public renderers (home cards, event/page headers) learn the icon tile in the same slice.
    - **Rules:** the alt-text field is hidden for icons (the title is the label); share previews (OG) still need an image, so an icon-only item falls back to the site's default share image, and the editor says so; where an image is required today (the home card cover), an icon satisfies the requirement.
12. **Smart form validation (every Admin form, desktop and mobile):**
    - On save, validate first. If anything is missing or invalid: scroll to the **first** invalid field (smooth, or instant with reduced motion), focus it, highlight it (red border + icon), and show a clear inline message under the field saying what is wrong and how to fix it. Never jump to the top, and never show only a field name in a toast.
    - Collapsed sections, tabs or steps that contain the invalid field open automatically. Fields inside a scrolled sheet scroll within that sheet.
    - The save bar shows a short summary («٢ حقول محتاجة تتصلح») with next/previous links between invalid fields; a live region announces it for screen readers (`aria-invalid`, `aria-describedby`).
    - Mobile: the scroll accounts for the fixed header, the save bar and the on-screen keyboard (`scroll-margin`, `visualViewport`), so the field and its message stay visible.
    - Errors returned by the server are mapped to the same field when the response names one, and otherwise shown in the save bar; the user's input is never cleared. Each message clears as soon as the field becomes valid.
    - Built once as a shared form layer used by every editor (same rules, same messages), not per form.

**Order:** baselines + inventory → design system + action hierarchy + confirm dialog → shell + branding → controls + shared form validation → icon set + picker + public icon tile → editors per module (events/pages → servants/payment → content → competitions → points/store → settings) → media library → data screens → accessibility and real-device pass.
Each module slice ships as its own commit and deploy; each prod deploy needs explicit owner approval.

**Effort:** ~30–39 dev-days: ~25–32 for items 1–10 (the earlier split estimate of ~20–27, plus the screens added in Phases 1.5–6, minus the work no longer done twice), plus ~3–4 for the image-or-icon option (set, picker, public tile, data field) and ~2–3 for the shared form validation.

**Risks:**
- Regressions in the 20k-line `admin-app.js`. Mitigation: baselines, the parity inventory, one module per slice.
- Usability debt while waiting. Mitigation: the essential-fix rule above.
- Patterns drifting during Phases 1–7. Mitigation: the existing-components-only rule.
- The Phase 7a real-device audit checks notification delivery, not visuals. Phase 8 runs its own real-device pass.
- The icon option touches the public site, not only the Admin. Mitigation: additive field, image-first rule, public pages tested in the same slice, OG fallback.

**Acceptance criteria:**
- Every item of the parity inventory works as before (no lost functionality).
- No native `confirm()` and no unstyled native dropdown left in the Admin.
- Every screen passes the baseline review at 375 / 768 / 1440+ with no horizontal scroll and no truncated fields.
- axe: no serious/critical issues on any screen; full keyboard path through every editor.
- One button hierarchy and one icon set across all modules; destructive actions always confirmed and visually distinct.
- Real-device pass on Android Chrome (installed app), the iOS home-screen app, and desktop Chrome/Edge.
- Every content image field listed in item 11 offers «صورة / أيقونة»; a chosen icon shows as the branded tile in every slot where the image appeared, in the Admin and on the public site; existing content renders unchanged.
- In every Admin form, saving with an invalid field brings that exact field into view (also with the on-screen keyboard open on a phone), focuses it and shows its inline message; no form scrolls to the top or reports errors only by field name.
- Owner sign-off per module slice.

---

## 23. Rollback per phase

| Phase | Rollback | Time |
| --- | --- | --- |
| 0 | Delete the spike Worker/DBs/queue | minutes |
| 0.5 | Each change is behind a flag; revert the commit | minutes |
| 1 | Booking switch off on the Worker. The nightly mirror is in EVENTS.md column format → import into `BOOK_TABLES` and build on Apps Script per the original contract (pure `BookModel` shared). Proofs exported to a private Drive folder | hours–days (pilot is one small event) |
| 2 | `CONTENT_SOURCE='static'` (site config) + `PUBLISH_MODE='github'` (Apps Script). GitHub always holds the latest snapshot | ~1 min |
| 3 | Flip the module map back; Apps Script session code untouched until stable | minutes |
| 4–6 | Frozen tabs + a **tested reverse export** (D1 → original Sheets columns) kept for 4 weeks per phase, rehearsed before cutover; then flip the map back | < 1 h |
| 7 | Apps Script project kept (undeployed) 90 days; redeploy is possible, but only meaningful together with a reverse export | hours |
| 8 | Static admin files: revert the slice's commit (GitHub Pages) | minutes |
| Custom domain (optional) | Remove the custom domain → github.io serves again (push re-subscription does not roll back) | minutes |
| Bad deploy | `wrangler rollback` to the previous Worker version | seconds |
| Bad data | D1 Time Travel restore, or the nightly backup | minutes |

---

## 24. Which phase gives the biggest speed improvement first

1. **Phase 0.5** gives the earliest *felt* improvement. Draft saves and toggles respond instantly and lists never block, within days, on the current backend.
2. **Phase 2** removes the worst single wait: publish is visible immediately instead of ~1 min.
3. **Phase 4** is the largest everyday improvement. Content saves are the most frequent admin action, and the 2–4 s floor disappears from them.
4. **Phase 5** removes the public-burst `busy` errors and speeds up participants, points and store.

The booking pilot (Phase 1) doesn't speed up an existing screen. It makes the new feature fast from day one and proves the stack.

---

## 25. Definition of "finished"

The migration is finished when **all** of these are true:

1. No file in the repo references `script.google.com`, and the CSP no longer allows it.
2. The Apps Script project has no active deployment and no triggers.
3. Sheets and Drive are archived read-only; no code reads or writes them.
4. Every admin and public dynamic action is served by the Worker, and `api_log` shows **p95 < 600 ms** for routine actions over 2 consecutive weeks.
5. Content publishing never waits for a GitHub Pages deploy. Only code changes (and background stubs/snapshots) build Pages.
6. A nightly off-Cloudflare encrypted backup exists, and a restore drill has passed after the last phase.
7. Two named owners on the Cloudflare account, 2FA on; a runbook in `docs/` (deploy, rollback, restore, rotate secrets).
8. All rollback windows have closed, and old Apps Script module code has been deleted from the repo.

---

## 26. Decisions needed before Phase 1

1. **Cloudflare account for production.** Use a church-owned account with 2 owners (recommended), or keep `menazakmena@gmail.com`'s account and add a second owner. The spike lives on the latter and is disposable.
2. **Booking storage change.** D1 + R2 instead of the competitions spreadsheet + private Drive folder. EVENTS.md §1 gets updated; everything else in the contract stays.
3. **Optional extras.** Whether payment proofs need an off-Cloudflare copy (§17), and whether to take Workers Paid ($5) once real payments go live.

---

## Sources

**Phase 0 data:** kept outside this repo (`athanasios-links/spike/phase0/`, local).

**Cloudflare Workers:**
- Limits/pricing: https://developers.cloudflare.com/workers/platform/limits/ , https://developers.cloudflare.com/workers/platform/pricing/
- Static Assets: https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- Routes and custom domains: https://developers.cloudflare.com/workers/configuration/routing/routes/ , https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- Cron: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- `waitUntil`: https://developers.cloudflare.com/workers/runtime-apis/context/
- Workers Cache: https://developers.cloudflare.com/workers/cache/

**Cloudflare data and storage:**
- D1: https://developers.cloudflare.com/d1/platform/pricing/ , https://developers.cloudflare.com/d1/platform/limits/ , https://developers.cloudflare.com/d1/reference/time-travel/ , https://developers.cloudflare.com/d1/best-practices/import-export-data/ , https://developers.cloudflare.com/d1/configuration/data-location/
- Queues on Free (2026-02-04): https://developers.cloudflare.com/changelog/post/2026-02-04-queues-free-plan/ , https://developers.cloudflare.com/queues/platform/pricing/ , https://developers.cloudflare.com/queues/platform/limits/
- R2: https://developers.cloudflare.com/r2/pricing/

**Google:**
- FCM: https://firebase.google.com/docs/cloud-messaging/send/v1-api , https://firebase.google.com/docs/cloud-messaging/manage-topic-subscriptions , https://firebase.google.com/docs/cloud-messaging/troubleshooting
- Google ID tokens: https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
- Drive service-account quota: https://developers.google.com/workspace/drive/api/guides/handle-errors
- Apps Script: https://developers.google.com/apps-script/guides/services/quotas

**GitHub:**
- Pages: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits , https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-custom-404-page-for-your-github-pages-site
- REST rate limits: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api

**Earlier comparisons (Supabase, Firebase, Neon, Turso, Vercel, Netlify, Fly, Deno):** see rev. 1 sources; they are unchanged.
