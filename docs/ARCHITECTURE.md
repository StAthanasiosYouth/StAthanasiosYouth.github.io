# Architecture

## Overview

```
 Admin (Google account on the allowlist)
   │  Google sign-in
   ▼
 Apps Script web app (Admin.html + Code.gs) ──read/write──► Google Sheet  (drafts)
   │  "نشر التغييرات": buildPublicContent() → one Git commit
   ▼  GitHub Git Data API (token in Script Properties)
 Repository: content.json + meeting.ics
   │  GitHub Pages redeploys (~1 min)
   ▼
 Public portal: index.html + assets/  ──fetch──► content.json (same origin)
```

- **The public site is static.** Visitors never call Apps Script. They load
  HTML, CSS, JS, fonts and one JSON file from GitHub Pages. It's fast on a
  QR scan and keeps working if Google has an outage.
- **The Sheet is the draft.** The admin panel and manual Sheet edits both
  change drafts. Nothing reaches visitors until someone publishes.
- **Publishing is a commit.** Every publish is in the git history, which
  works as an audit trail and makes rollback possible (revert the commit).

## Files

| Path                     | Runs on        | What                                                    |
| ------------------------ | -------------- | ------------------------------------------------------- |
| `index.html`             | GitHub Pages   | Page shell, CSP, Open Graph tags, static hero           |
| `assets/js/main.js`      | browser        | Boot, cache, clock tick                                 |
| `assets/js/content.js`   | browser        | Load and re-validate `content.json`, localStorage cache |
| `assets/js/render.js`    | browser        | Widgets (meeting, featured, location, links, contacts)  |
| `assets/js/schedule.js`  | browser        | Meeting timing in Cairo time (pure, tested)             |
| `assets/js/words.js`     | browser        | Egyptian Arabic wording, numerals (pure, tested)        |
| `assets/js/share.js`     | browser        | Share sheet, copy link, branded QR card                 |
| `assets/js/icons.js`     | browser        | Line icons + brand glyphs (`icons-brand.js`, generated) |
| `assets/vendor/qrcode.mjs` | browser      | QR encoder (MIT), loaded only when QR is opened         |
| `content.json`, `meeting.ics` | GitHub Pages | Published data (written by the admin)              |
| `apps-script/Content.gs` | Apps Script + Node | Content model: validation, build, ICS, change summary (pure) |
| `apps-script/Seed.gs`    | Apps Script + Node | Initial content, settings list with Arabic help     |
| `apps-script/Auth.gs`    | Apps Script    | Allowlist check                                         |
| `apps-script/Store.gs`   | Apps Script    | Sheet schema, `setup()`, row read/write, log            |
| `apps-script/Code.gs`    | Apps Script    | `doGet`, admin API (`api*`)                             |
| `apps-script/Publish.gs` | Apps Script    | Review, publish, GitHub API                             |
| `apps-script/*.html`     | Apps Script    | Admin panel UI                                          |
| `tools/`                 | dev machine    | Asset builds, seed, previews, URL switch                |
| `tests/`                 | dev machine    | Unit, admin end-to-end (fake Apps Script), browser e2e  |

`Content.gs` and `Seed.gs` contain no Google API calls, so the same code
runs in Apps Script (publishing) and in Node (`tools/build-seed.mjs`,
tests).

## Sheet schema

Row 1 of each tab holds the column keys (with Arabic notes on hover).

| Tab        | Columns                                                                 |
| ---------- | ----------------------------------------------------------------------- |
| `Settings` | `key`, `value`, `help`; keys listed in `SETTINGS_SPEC` (Seed.gs)        |
| `Sections` | `key`, `title`, `order`, `enabled`                                      |
| `Links`    | `id`, `enabled`, `order`, `section`, `style` (`card`/`tile`), `featured`, `title`, `subtitle`, `cta`, `url`, `icon`, `badge`, `startAt`, `endAt`, `updatedAt` |
| `Contacts` | `id`, `enabled`, `order`, `kind` (`service`/`support`), `name`, `role`, `description`, `phone`, `method` (`call`/`whatsapp`), `message`, `updatedAt` |
| `Log`      | `time`, `user`, `action`, `details`                                     |

- **Featured** links (like صوتك يهمنا) show as a large card near the top and
  ignore `section`.
- **Sections** group the other links. `style` decides how each link looks:
  `tile` (app-icon square, for social media) or `card` (wide row with a
  description).
- `startAt` / `endAt`: `YYYY-MM-DD` or `YYYY-MM-DD HH:MM`, Cairo time. A
  date-only end means "until the end of that day".

## content.json (schema 1)

```jsonc
{
  "schema": 1,
  "revision": "c157b1f66ffa",          // hash of the visible content
  "publishedAt": "2026-10-05T16:07:36Z",
  "timezone": "Africa/Cairo",
  "site": { "name", "tagline", "shareText" },
  "meeting": {                          // null when hidden
    "title", "day": 0, "dayKey": "sunday", "time": "20:00",
    "durationMinutes": null,            // null = unknown → never claims "live"
    "note", "skipDates": ["2026-10-12"], "ics": "meeting.ics"
  },
  "location": {                         // null when there's no name
    "name", "address", "note", "mapsUrl", "directionsUrl", "lat", "lng"
  },
  "announcement": { "text", "tone": "info|alert|celebrate", "link": { "url", "label" } | null, "expiresAt" },
  "featured": [ Link ],
  "sections": [ { "key", "title", "links": [ Link ] } ],
  "contacts": [ { "id", "kind", "name", "role", "description", "phoneDisplay",
                  "action": { "type": "call|whatsapp", "href", "label" } } ]
}
// Link = { id, title, subtitle, url, icon, style, badge, startAt, endAt, cta? }
```

At publish time, disabled rows, empty or disabled sections, expired links
and announcements, past skip dates and internal columns are all dropped.
Scheduled links that haven't started yet *are* included with their dates:
the browser hides them until `startAt`, so they appear on time without a
second publish. (Their text is therefore readable in the JSON before they
appear. Don't schedule anything secret.)

## Meeting logic

`schedule.js` reads the current Cairo wall-clock time with `Intl` (works
for visitors in any timezone) and finds the next occurrence, skipping
`skipDates`:

| State      | When                                      | Headline          |
| ---------- | ----------------------------------------- | ----------------- |
| `upcoming` | another day                               | بكره / بعد بكره / فاضل ٣ أيام |
| `today`    | meeting day, before the start             | النهارده (+ "بعد ساعة" within 3 h) |
| `live`     | during the meeting, **only if duration is set** | شغال دلوقتي |
| `started`  | after the start when duration is unknown  | النهارده · بدأ الساعة … |

Day counts use calendar dates, so Egypt's daylight-saving changes don't
shift them (tested).

## Security model

| Concern                     | How it's handled                                                                 |
| --------------------------- | -------------------------------------------------------------------------------- |
| Who can edit                | Google sign-in + `ADMIN_EMAILS` allowlist (Script Properties), checked by `assertAdmin_()` at the start of every browser-callable function. Fails closed. |
| Browser-callable functions  | Apps Script exposes every function not ending in `_`. All of them are either guarded or pure (no data access); a test enumerates them. |
| First admin                 | Set by hand in Script Properties; no automatic bootstrap.                        |
| Code and token isolation    | Standalone Apps Script project (not bound to the Sheet), so sharing the Sheet with an editor never exposes the code or the token. |
| Draft data                  | Private Sheet created by `setup()`, shared only with admins; read only through guarded functions. Log cells are written as plain text (no formula injection). |
| GitHub token                | Script Properties only; never returned to the page, logged, or put in errors or commits. Fine-grained: one repository, Contents read/write, with an expiry. |
| Public content              | Validated at publish (`Content.gs`) and again in the browser (`content.js`). URLs: `https:` only; contacts `tel:+…` or `wa.me`. Text is set with `textContent`; no HTML from data anywhere (public site or admin). |
| Page hardening              | CSP: scripts, styles, fonts and data from the site only; frames only `www.google.com` (map, on demand). `rel="noopener"` on new-tab links. No trackers or third-party requests on load. |
| Admin page                  | Served with X-Frame-Options (no clickjacking). Unsaved-changes guard. Publishing requires the reviewed revision and refuses if the draft changed since. |
| Public page framing         | GitHub Pages can't send frame headers; the page leaves any frame it is put in. |
| Concurrency                 | Script lock around every write and publish; fast-forward-only ref updates with one rebuild-and-retry. |
| Maps helper                 | Fetches only exact Google Maps hosts (no open fetch).                            |

## Ready for later (not built yet)

- **Click analytics:** a `navigator.sendBeacon` to a separate anonymous
  Apps Script endpoint appending to a `Clicks` tab. Links already have
  stable `id`s.
- **More admins:** add emails to `ADMIN_EMAILS` and share the Sheet. No code
  change.
- **Rollback UI:** publishing is a commit; a "restore" button could re-commit
  an older `content.json`.
- **Per-link colors, images, events calendar, PWA:** new optional columns
  and new fields in `content.json` (bump `schema` if anything is removed or
  renamed).
