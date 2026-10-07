# Architecture

## Overview

```
 Admin (Google account on the allowlist)
   │  github.io/admin/: "Sign in with Google" → ID token → POST to doPost (Api.gs)
   │  (recovery: the Apps Script URL, Google session → google.script.run)
   ▼
 Apps Script (Code.gs, api* functions) ──read/write──► Google Sheet  (drafts)
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
| `apps-script/Auth.gs`    | Apps Script    | Who is calling (API token or Google session), allowlist + its admin functions |
| `apps-script/Api.gs`     | Apps Script    | `doPost`: the official admin's API (ID token check, listed functions only) |
| `apps-script/Presence.gs` | Apps Script   | The official admin's sessions (one per account), heartbeat/presence, edit locks (CacheService) |
| `admin/`                 | GitHub Pages   | The official admin page; `index.html`, `admin.css`, `admin-app.js` generated from `apps-script/Admin*.html` (`tools/build-admin.mjs`); `boot.js` sign-in + transport; `config.js` the two public settings |
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
| Who can edit                | Google sign-in + `ADMIN_EMAILS` allowlist (Script Properties), checked by `assertAdmin_()` at the start of every browser-callable function. Fails closed. Admins manage the list in «صلاحيات لوحة التحكم»; the primary (`ADMIN_PRIMARY`) can't be removed, the list is never empty, changes are logged. |
| Official admin (`/admin/`)  | Static page; Google ID token (GIS) sent with every call to `doPost` on a deployment that runs as the owner. The server verifies it with Google (aud = the page's client ID: `ADMIN_CLIENT_ID` or the default in `Api.gs`, issuer, expiry, verified email; cached per token hash), then the allowlist, then runs only a listed `api*` function as that email. In that mode the Session is never read: no valid token, no access, for every function. `doGet` there never serves HTML. Token in memory only. Strict CSP (meta), frame-busting, `noindex`, `no-referrer`; no secrets in the page (client ID and API URL are public). |
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
| One session per account (`/admin/`) | `apiSessionStart` issues a random session id (memory only on the page); every other API call must carry it and match the account's live session, or it fails closed (`session_replaced`). A second device is asked before it takes over; the old tab goes back to the sign-in screen. The id is never enough without the token. The recovery admin doesn't take part. |
| Two admins, one item (`/admin/`) | An editor of an existing item holds its lock (`<kind>:<key>`, ~90 s, renewed by the heartbeat). The save / delete / archive / toggle functions refuse (`locked`, naming who) while another live session holds it; the page opens it read-only. Locks run out by themselves and die with their session. Only email, device label and what is being edited are shared between admins. |
| Maps helper                 | Fetches only exact Google Maps hosts (no open fetch).                            |

## Content center (schema 2)

Meetings with topics, news with posters, games, and the in-site bell. All
of it is still static: the browser decides what to show from Cairo time, so
scheduled things appear, open and expire on time without anyone publishing
at that minute.

### More files

| Path                        | Runs on            | What                                                   |
| --------------------------- | ------------------ | ------------------------------------------------------ |
| `apps-script/Hub.gs`        | Apps Script + Node | Builds `sessions`, `news`, `games`, `notifications`; media index; Cairo wall-clock arithmetic (pure) |
| `apps-script/Items.gs`      | Apps Script        | One save / delete / toggle API for the four content types; "linked notification" checkboxes |
| `apps-script/Media.gs`      | Apps Script        | Poster upload checks, Drive staging (`drive.file`), files for the publish commit |
| `apps-script/AdminPage.html`, `AdminContent.html` | Apps Script | Admin views: page (links, location, contacts, settings) and content center (timeline, meetings, news, games, notifications) |
| `assets/js/hub.js`          | browser            | News, games, pinned banner, meeting topic, detail sheets |
| `assets/js/bell.js`, `inbox.js` | browser        | The bell, history panel, per-browser read state         |
| `assets/js/sheet.js`, `router.js` | browser      | App-like sheets; deep links `#notifications`, `#news/<id>`, `#game/<id>`, `#meeting` |
| `assets/css/sheets.css`    | browser            | The sheets' own styles (detail, poster hero + viewer, bell panel), loaded on the first touch or by a deep link |
| `tools/subset-fonts.mjs`   | dev machine        | Rebuilds the lean Latin subsets of Cairo (main.css unicode-ranges) |
| `assets/js/intro.js`       | browser (classic script in `<head>`) | The first-visit intro: stages the real hero, then hands over (skipped on repeat visits, deep links, reduced motion, weak devices, the admin preview) |
| `assets/js/detail.js`      | browser (lazy)     | The detail sheets' content and the poster hero, loaded on the first touch or by a deep link |
| `assets/js/motion.js`, `sound.js` | browser      | Springs, swaps, particles; optional synthesized sounds    |
| `tools/demo.mjs`            | dev machine        | Demo content built through the real admin code           |

### Sheet tabs

| Tab             | Columns                                                         |
| --------------- | --------------------------------------------------------------- |
| `Sessions`      | `date` (key), `enabled`, `time` (override), `topic`, `speaker`, `description`, `image`, `status` (`normal`/`cancelled`), `note`, `visibleFrom`, `updatedAt` |
| `News`          | `id`, `enabled`, `featured`, `pinned`, `tone`, `title`, `summary`, `body`, `image`, `linkUrl`, `linkLabel`, `badge`, `publishAt`, `expireAt`, `updatedAt` |
| `Games`         | `id`, `enabled`, `title`, `description`, `image`, `url`, `buttonLabel`, `visibleFrom`, `startAt`, `endAt`, `afterEnd` (`show`/`hide`), `updatedAt` |
| `Notifications` | `id`, `enabled`, `type` (`general`/`meeting`/`news`/`game`/`important`), `title`, `message`, `target` (`meeting`, `news:<id>`, `game:<id>` or an https link), `image`, `publishAt`, `expireAt`, `updatedAt` |
| `Media`         | `id`, `path`, `thumb`, `width`, `height`, `alt`, `mime`, `driveId`, `thumbDriveId`, `uploadedAt`, `publishedAt` |

The `image` columns hold a Media id (`img-xxxxxxxx`). Linked notifications
have predictable ids (`notif-<gameId>-soon`, `notif-<gameId>-start`,
`notif-<newsId>`, `notif-session-<date>`), so the editors know whether their
checkbox is on, and editing an item moves its notification's times while
keeping the admin's own wording.

### content.json additions

```jsonc
{
  "schema": 2,                       // additive: schema-1 readers ignore the new keys
  "sessions": [{ "date", "time", "topic", "speaker", "description", "image", "status", "note", "visibleFrom" }],
  "news": [{ "id", "title", "summary", "body", "image", "link", "badge", "featured", "pinned", "tone", "publishAt", "expireAt" }],
  "games": [{ "id", "title", "description", "image", "url", "buttonLabel", "visibleFrom", "startAt", "endAt", "afterEnd", "endedUntil" }],
  "notifications": [{ "id", "type", "title", "message", "target": { "kind": "meeting|news|game|url", "id"?, "url"? }, "image", "publishAt", "expireAt" }]
}
// image = { "src": "media/2026/img-ab12cd34.webp", "thumb": "…-480.webp", "w", "h", "alt" }
```

At publish: expired items are dropped, notifications without `expireAt`
last `notifications.historyDays` (14), ended games stay visible for
`games.endedHours` (12) when `afterEnd` is `show`, and cancelled sessions
are added to `meeting.skipDates` (countdown and calendar file).

### Posters

1. The admin page resizes the photo in the browser: WebP at most 1600px
   (JPEG on Safari, which can't encode WebP) plus a 480px thumbnail.
2. `apiUploadMedia` checks the type, size and the file's first bytes, then
   stores both in a Drive folder the script created. The `drive.file` scope
   means it can't see anything else in the admin's Drive. It uses the Drive
   REST API because the built-in DriveApp needs full Drive access.
3. Publishing adds the images the published content uses (and only those)
   to the same commit as `content.json`, under `media/YYYY/`. Drafts never
   reach the public repository. Images are served by GitHub Pages from the
   same site, so the security policy is unchanged.

### Time

- Everything is a Cairo wall-clock string (`YYYY-MM-DD HH:MM` in the Sheet,
  `YYYY-MM-DDTHH:MM` in `content.json`) compared as text. No UTC, no
  visitor time zone.
- The visitor's clock can be wrong: `content.js` reads the `Date` header
  GitHub Pages sends with `content.json` and corrects for it (tested with a
  clock 5 hours off).
- The page ticks every 15 seconds: countdowns update in place; when
  something appears, opens or expires, the page re-renders.
- Game "locks" are a convenience: the game URL is in `content.json` from
  publish time. A game that must really stay closed should check the time
  itself.

## Live program and surfaces (public side)

- `sessions[].program` (optional): `[{ title ≤ 40, start, end }]`, Cairo
  wall stamps, in order, each starting at or after the one before
  (content.js drops anything else; no valid stage = `null`).
- `layout[].surface` / `surfaceMobile` (optional): `glass | dark | filled |
  none`. render.js (`dressSection`) puts the result on every widget of the
  section as `data-surface`, the phone's own value below 640px (it follows
  a resize); main.css draws them.
- `live.json` (site root, separate from content.json, may be missing):
  `{ schema: 1, date, stage: <index> | null, updatedAt }`. For its own date
  a valid stage is "now"; anything else = the program's own times.
- `assets/js/program.js` + `assets/css/program.css` are not in the first
  load: the meeting widget loads them only when its session has a program.
  They draw «دلوقتي / بعدها», keep the meeting sheet's list current, and ask
  for `live.json?ts=…` (`cache: 'no-store'`) only from 15 minutes before the
  first stage to the end of the last and only while the tab is visible:
  about every 30 s with the page's tick, and at once when the tab comes
  back. Never stored; a 404 or broken JSON = automatic. The admin's preview
  never asks.

## Ready for later (not built yet)

- **Push notifications (Phase B):** light PWA (manifest + service worker),
  Firebase Cloud Messaging, an anonymous append-only "push relay" Apps
  Script, a 5-minute timer that sends due bell items to subscribed devices.
  The bell items already carry everything a push needs.

- **Click analytics:** a `navigator.sendBeacon` to a separate anonymous
  Apps Script endpoint appending to a `Clicks` tab. Links already have
  stable `id`s.
- **More admins:** add them in «صلاحيات لوحة التحكم» (and share the Sheet for the recovery admin). No code
  change.
- **Rollback UI:** publishing is a commit; a "restore" button could re-commit
  an older `content.json`.
- **Per-link colors, images, events calendar, PWA:** new optional columns
  and new fields in `content.json` (bump `schema` if anything is removed or
  renamed).
