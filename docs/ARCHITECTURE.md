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
| `assets/js/map.js`, `assets/css/map.css` | browser (lazy) | The real map in the location card (Leaflet + OpenStreetMap tiles, darkened in CSS) and routes («الاتجاهات»); loaded only on «عرض الخريطة» / «الاتجاهات» |
| `assets/js/map-route.js` | browser (lazy) | Route wording (كم/متر, دقيقة/ساعة) and the request/answer format (pure, tested) |
| `assets/js/map-config.js` | browser (lazy) | `routeUrl`: the Apps Script web app that answers routes (empty = «الاتجاهات» opens Google Maps) |
| `assets/vendor/leaflet/` | browser (lazy)  | Leaflet 1.9.4 (BSD-2-Clause, `LICENSE` kept), self-hosted: the CSP allows scripts from the site only |
| `apps-script/Route.gs`   | Apps Script    | `publicRoute_`: routes from openrouteservice.org (key in the Script Property `ORS_API_KEY`), validated, cached, rate-limited |
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
| Page hardening              | CSP: scripts, styles, fonts and data from the site only; images also from `tile.openstreetmap.org` (the map, on demand); fetch also to `script.google.com` / `script.googleusercontent.com` (routes, on demand); frames only `www.google.com` (the embed, only for a place without coordinates). `rel="noopener"` on new-tab links. No trackers or third-party requests on load. |
| Routes («الاتجاهات»)        | The browser sends only the start (rounded to ~11 m) to `publicRoute_` (Route.gs); the destination is always the church from Settings. The openrouteservice key never leaves Script Properties. Profiles whitelisted; the start must be in Egypt and within 1,000 km; answers cached 6 h; ≤ 30 upstream calls a minute and ≤ 1,500 a day (`ROUTE_DAY_COUNT`), else «busy». Nothing about the visitor is logged or stored (the page keeps it in memory, gone with the map). OSM tiles keep the page's referrer policy and normal caching; the attribution «© OpenStreetMap contributors» (and «Routing © openrouteservice.org by HeiGIT» under a route) is always visible. |
| Admin page                  | Served with X-Frame-Options (no clickjacking). Unsaved-changes guard. Publishing requires the reviewed revision and refuses if the draft changed since. |
| Public page framing         | GitHub Pages can't send frame headers; the page leaves any frame it is put in. |
| Concurrency                 | Script lock around every write and publish; fast-forward-only ref updates with one rebuild-and-retry. |
| One session per account (`/admin/`) | `apiSessionStart` issues a random session id (on the page: memory, plus this tab's sessionStorage so a reload resumes it with `apiSessionResume` — same account, parked or this tab's own page load, never a duplicated tab; the token is never stored); every other API call must carry it and match the account's live session, or it fails closed (`session_replaced`). A second device is asked before it takes over; the old tab goes back to the sign-in screen. The id is never enough without the token. The recovery admin doesn't take part. |
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
| `assets/js/xp/kit.js`, `talk.js`, `library.js` | browser (lazy) | Scenes: the outer effects layer (reactions beside the phone, crossing its edges), the scenes' words, the real media manifest |
| `assets/js/xp/audio.js`, `cards.js` | browser (lazy) | The scenes' sound mixer (one AudioContext, 3 voices max, throttled; on by default, woken by the first gesture); the contact cards' extra life (loaded when on screen) |
| `assets/media/xp/`, `tools/build-xp-media.mjs` | repo / dev machine | The service's real weekly posters and short silent game-segment clips (≤ 300 KB, preload none), rebuilt from the local originals |

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

## Live program, import and surfaces (admin / server side)

- Data schema 5 (additive columns, through the usual plan → backup →
  migrate): `Sessions.program` (JSON text of `[{ title, time 'HH:MM' | '',
  minutes | '' }]`), `Sections.surface`, `Sections.surfaceMobile`.
- Publishing (Hub.gs) turns a session's program into the contiguous
  `sessions[].program` above (start by time or by the previous stage's
  duration; the last stage ends at the meeting's end); errors / warnings go
  through the review like everything else.
- `live.json` is written ONLY by `apiSetLiveStage(date, index | null)`: one
  single-file GitHub commit, no review, never touching content.json or the
  drafts; the last value is kept in the Script Property `LIVE_STATE`.
- `apps-script/Import.gs`: «استيراد جدول الاجتماعات». `apiImportPreview`
  (read-only: add / update with before → after / skip / error / locked) and
  `apiImportApply(text, decisions)` (under the script lock; an update only if
  ticked and still exactly what the preview showed; through the meetings
  editor's own validation; no bell notifications).

## Scene videos (Media Library + «صور وفيديوهات المشهد»)

No new Sheet column, no migration (data schema stays 5); one media system.

- **Making a clip (admin only, `apps-script/AdminTrim.html`).** The admin
  chooses a video on the computer (any size; 10 GB phone / camera files
  work). The browser opens it with Mediabunny (MPL-2.0) over WebCodecs and
  reads only the byte ranges it needs: its index and the frames of the
  chosen part. The admin previews and scrubs it locally (a `blob:` URL),
  picks «من» / «لحد» (1–30 s) and a shape (portrait 540×960 with a blurred
  fill, the default, or 854×480), and the browser encodes **only that part**:
  H.264 MP4, ~1.2 Mbps, 30 fps, keyframe every 2 s, `faststart`, **no
  audio**. Over 8 MB it re-encodes once at a lower bitrate. A frame from the
  clip becomes the poster through the same WebP thumb / tiny steps as photos.
  **The original never leaves the computer**: it is not uploaded, not kept,
  and its object URL and file handle are released when the dialog closes.
  `tests/final-v.e2e.mjs` checks that no request carries any part of it.
- **The vendor file.** `admin/vendor/mediabunny.js` (+ its license) is built
  by `tools/build-admin-vendor.mjs` (esbuild, only the exports used, the
  MP4 / MOV / Matroska / WebM readers). The admin loads it with `import()`
  only when a video is chosen. The public site never references it
  (unit-tested). The admin page's CSP gains `media-src 'self' blob:` (the
  local preview); the public site's CSP is unchanged.
- **Capability checks:** no WebCodecs, a codec the browser / GPU can't decode
  (e.g. HEVC without hardware support), no H.264 encoder, or an unknown
  container → a clear message in the dialog; nothing is faked.
- **The recovery admin (HtmlService)** has no trimmer: it says to use
  `/admin/` from Chrome on a computer, and can still use library videos.
- **Server (`Media.gs`).** `apiUploadMedia({ kind: 'video', … })` →
  `uploadVideo_`: MP4 / WebM by MIME and by magic bytes (`ftyp` at 4..8 /
  `1A 45 DF A3`), ≤ 8 MB, a duration 0 < d ≤ 600 s (checked, not stored),
  a WebP / JPEG poster (≤ 300 KB), sane width / height, the same SHA-256
  dedupe. Ids `vid-xxxxxxxx`; files `media/YYYY/vid-xxxxxxxx.mp4|webm` and
  the poster `media/YYYY/vid-xxxxxxxx-480.webp|jpg` (thumb / thumbDriveId).
  Preview, library tiles and "where used" use the poster; delete / restore /
  purge work as for images. Every other image field rejects `vid-` ids
  (`imageRef_`), and `mediaIndex_` (images) never lists them.
- **«من رابط».** `apiFetchMediaUrl(url)`: https only, no `user:pass@`, no
  bare IPs / local names, known social *page* hosts refused up front
  (TikTok, YouTube, Facebook, Instagram…), redirects followed, no
  credentials sent; HTML / non-media refused; the type is decided by the
  bytes; ≤ 8 MB video, ≤ 15 MB image. Returns `{ mime, base64, name, bytes }`
  and stores nothing: the admin then runs the same steps as a picked file
  (photo → resize, video → trimmer).
- **Gallery tokens (`Links.gallery`).** `img-xxxxxxxx`, `vid-xxxxxxxx` or
  `vid-xxxxxxxx@START-END` (seconds, one decimal), ≤ 6, comma separated
  (`Content.gs` `parseGalleryToken_`; `Items.gs` `galleryInput_` validates
  on save: known, not removed, `0 ≤ start < end ≤ 600`, `end − start ≥ 0.5`).
  The same library clip can appear twice with different parts.
- **content.json.** `link.gallery[]` mixes pictures (unchanged image
  objects) and `{ type: 'video', src, poster, w, h, alt, start, end }`
  (`end` 0 = to the end). The clips and posters a published link uses are
  added to the publish commit like images (`githubCommitFiles_` accepts
  `media/YYYY/vid-…` paths). `content.js` `cleanVideo` re-checks the paths
  and numbers and adds `thumb` = the poster for code that only shows
  pictures. Playback in the scenes: `assets/js/xp/*` (separate work).

## Scenes on any screen: one fit rule

The scene sheet (`sheets.css` "MINI-EXPERIENCES", `engine.js` `fitStage`):

- The sheet is one column that never outgrows the visible screen
  (`100dvh`: the browser's own bars; the top safe area). Only the stage gives
  way; the title, the words and the button keep their size, so the button
  is always on screen (on the narrowest phones its words shrink a little and
  may wrap).
- The phone inside is always the same design, **236 × 420 (9:16)**, so every
  app inside it (frames, chats, feeds) has the same shape on every device.
  It is scaled as one piece with `zoom` (`--xp-zoom` =
  `min((stage width − 96) / 236, stage height / 420)`, between 0.3 and 1.15),
  recomputed by a ResizeObserver on the stage: resize, rotation, browser
  bars. The 96 px keep the speaker's corner clear.
- Short landscape screens (`orientation: landscape` and height ≤ 540 px):
  the phone on one side, the words and the button on the other; the sheet
  is the screen's height and the stage takes what is left.
- Media boxes take their shape from the content's size before the picture
  arrives (no jump), re-shape if the real picture differs, and a frame
  decides "fill or sit in it" from its measured shape.
- Chats keep the shared picture (`.is-current`) whole: when newer messages
  would push its top out of view, the oldest messages under it give way
  (`kit.js` `keepCurrent`, measured with layout offsets).

`tools/xp-fit-matrix.mjs` (`npm run fit-matrix`, `--quick` for the hardest
screens) opens every scene on 23 screens (280 × 653 … 440 × 956, the Galaxy
S20 FE with and without Chrome's bars, short phones, landscape, tablet,
desktop) and checks the sheet, the button, overflow, overlaps, the phone's
shape and size, the media and the chats' shared picture; contact sheets go
to `tools/.cache/fit/`. `tests/xp-fit.e2e.mjs` runs the same checks plus the
WhatsApp poster on first open / after new messages / reopened, a slow
picture, a wrong stored size, and rotating the phone.

## Pictures in scenes: one sizing rule

Every scene shows the admin's pictures and clips through `kit.js`
`mediaNode`, in one of three families (styles: `xp.css` "PLAYLIST ITEMS"):

- **Feed cards** (Facebook, X, Threads, a Telegram channel post): the card's
  full width, the box's height from the picture's shape (`FEED` 4:5 … 4:1).
  No height cap: a cap is what left blurred bands beside a 4:5 poster.
  Taller than 4:5: cut like the platforms do when that loses ≤ 30 %
  (`CROP`), keeping the top (the poster's title); else shown whole.
- **Messages** (WhatsApp, Messenger, Discord, Telegram chats): the picture's
  own shape (`CHAT` 9:16 … 4:1), ≤ 170 px tall and ≤ 190 px wide; the
  bubble hugs it.
- **Frames** (Instagram, TikTok, Snapchat stories; the YouTube player; the
  Spotify cover): the frame keeps the platform's shape; the picture sits in
  it at its own shape, centered over its blurred copy, rounded with a soft
  shadow (`--xp-frame-radius` / `--xp-frame-shadow`: flat for YouTube,
  cover-art corners for Spotify); within 8 % of the frame's shape it fills
  the frame.

Never stretched. `tools/xp-media-matrix.mjs` (`npm run media-matrix`) draws
every scene × 9:16 / 4:5 / 1:1 / 16:9 / 4:1 picture on a phone and a
desktop, measures bands, cuts, stretch and gaps, and writes contact sheets to
`tools/.cache/matrix/`; `tests/xp-media.e2e.mjs` checks the numbers.

## Push notifications (Firebase Cloud Messaging)

One content system: a push is a bell item (`Notifications`) that is
already **live** on the site, sent once more to devices that opted in.

- **Site.** `manifest.webmanifest` (standalone, maskable icon: installable,
  which iPhone needs for push) and `sw.js` at the root (scope `/`): push and
  `notificationclick` only, **no fetch handler, no cache**. A tap focuses an
  open site window and posts `{ type: 'athanasios:open', url }` (main.js
  routes it), else opens `/#news/<id>` etc. Links and pictures are checked
  in the worker (own deep links, own `/media/` only).
- **Loading.** main.js reads `localStorage['athanasios.push.v1']` and loads
  `push.js` only when needed: the bell opens (the card at its top), the
  invitation is due (2nd visit on, ≤ 2 times, a week apart), or a subscribed
  device's weekly token refresh. `push.js` loads the vendored Firebase
  subset (`assets/vendor/firebase-messaging.js`, ~15 KB gz,
  `tools/build-push-vendor.mjs`) only to turn push on/off or refresh.
  The permission prompt only follows a tap on «فعّل الإشعارات».
- **API (public).** `doPost` `pushSubscribe` / `pushUnsubscribe`
  (`Push.gs`): one FCM token (format-checked), platform, optional previous
  token; a shared 60/min and 5,000/day budget; ≤ 20,000 rows; nothing is
  read back. CSP adds only `firebaseinstallations.googleapis.com` and
  `fcmregistrations.googleapis.com` to `connect-src`.
- **API (admin).** `apiPushState`, `apiPushCheck`, `apiSendPush(id,
  sendKey, edits)`. The item is looked up in the **live** content.json
  (fetched from SITE_URL) and must be published, not expired, its section
  showing. `PushLog` makes it once per item; a repeated `sendKey` replays
  its result; 60 s cooldown, 10 a day. The row is claimed (`sending`) under
  the script lock, then the lock is released for the fan-out:
  `UrlFetchApp.fetchAll` in batches of 100 to FCM HTTP v1, data-only
  messages, `Urgency: high`, TTL = until the item expires (1 h – 4 days),
  one retry for transient errors. UNREGISTERED / SENDER_ID_MISMATCH / an
  invalid registration token delete the row; 5 failures in a row or 270
  days unseen too. Auth: a JWT signed with the service account
  (`FCM_SERVICE_ACCOUNT`, `Utilities.computeRsaSha256Signature`) exchanged
  for an access token, cached ~50 min. `apiPublish` never touches any of it.
- **Admin.** `AdminPush.html`: offered on «تم النشر ✓» once the site shows
  the new revision, and in «الإشعارات»; preview with push-only edits,
  confirmation with the device count, result summary.

## Admin app, display names, «سجل النشاط», admin push

- **Two apps, one origin, scopes that never overlap.** The site's PWA
  (`/manifest.webmanifest`) keeps its id `/`, name and icons, but its
  start_url and scope are `/index.html` (same page as `/`). With scope `/`
  it contained `/admin/`: on Android, Chrome then treats every admin page as
  part of the installed site WebAPK — no install dialog for the admin, the
  menu only opens the site app, which shows /admin/ in its own window with
  the site's splash and icon (seen on a Galaxy S20 FE). Nested scopes can't be
  fixed with `id`; only non-overlapping scopes (or another origin) can. The
  site worker opens taps at `/index.html#…` (also older `/#…` links) so
  they land in the site app. Shared links to `/` now open in the browser,
  not the installed site app (accepted trade-off). main.js renames "/" to
  "/index.html" in the address (replaceState, same page): Chrome's «فتح في
  التطبيق» hands the app the tab's address, and "/" outside the scope gave
  «Could not open app». The bell offers «ثبّت تطبيق الأسرة» on Android
  (install.js: Chrome's real dialog when `beforeinstallprompt` came — never
  `preventDefault()`ed — else the ⋮ menu steps; «مش دلوقتي» for 30 days;
  hidden when the SITE app is installed: standalone, `appinstalled`, or
  `getInstalledRelatedApps` listing the site manifest, never the admin's).
  The admin is its own app: `admin/manifest.webmanifest` (id and scope
  `/admin/`, start `/admin/?app=admin`, «لوحة تحكم الأسرة» / «إدارة أسرة
  البابا أثناسيوس - سفاجا», `related_applications` = itself),
  its own icons (`tools/build-admin-icons.mjs`: the logo on gold with a gear
  badge), iOS meta + `apple-touch-icon`, and `admin/sw.js` (scope `/admin/`,
  push + taps only, no fetch handler, no cache). The longest scope wins, so
  admin pages are controlled by the admin worker. The admin CSP allows only
  `manifest-src 'self'`, `worker-src 'self'` and the two Firebase hosts.
- **Two push subscriptions, two tokens.** A push subscription belongs to one
  worker registration, so the admin worker gets its own FCM token. Firebase
  Messaging stores its token in IndexedDB keyed by the web app id only — the
  same for both pages — so the admin uses its own SDK copy
  (`admin/vendor/firebase-messaging-admin.js`, built by
  `tools/build-push-vendor.mjs` with the database renamed to
  `athanasios-admin-messaging-database`) and its own Firebase app name.
  Without that, a getToken() on the admin page would revoke and replace the
  visitor token on the same phone. Checked in real Chrome against Firebase.
- **Identity.** Always `currentEmail_()` (verified ID token, allowlist,
  session). Display names: Script Property `ADMIN_NAMES` (JSON, next to
  `ADMIN_EMAILS`), `displayName_()`, `apiSetAdminName` (any admin, any
  admin; 2–40 chars; invisible / direction characters stripped; never the same as
  another admin's name or fallback, compared without spaces, case or Arabic
  letter variants; every rename logged). Presence, locks, the log and
  notifications use them.
- **Activity log** (`Activity.gs`, tab `Activity`). One row per completed,
  meaningful action: id, epoch ms, Cairo time, actor email + name then,
  action, entity type/id/title, Arabic summary without the actor, small
  `changes` JSON (changed field labels, titles, counts; ≤ 1 KB), ref
  (revision + commit, sendKey), count, notified, device. `mutate_()` takes
  rows noted by the change (`activityNote_`) and writes them only after it
  succeeded; publish, live stage, push sends, import, upgrade, admin changes
  and takeovers call `activity_()` directly. A failure there is caught and
  never fails the action. Merging: the same admin repeating a small action
  (edit, reorder, show/hide, settings…) on the same thing within 10 minutes
  updates the row (a create absorbs its edits). Retention: 5,000 rows (+250
  slack, trimmed in one chunk) and 365 days. The last 30 rows live in
  CacheService for the home card and the heartbeat. `apiActivity(query)`:
  person, family, section, Cairo dates, cursor, one id; admins only.
  Not logged: reads, previews, heartbeats, drafts, sign-in/out.
- **Admin push** (`AdminNotify.gs`, tab `AdminPushSubs`: token hash, token,
  email, device, platform, dates, failures, `prefs` for later categories).
  Subscribe / unsubscribe / devices only through the API (token + session);
  the row's email is the server's; a token already in `PushSubs` is
  refused; ≤ 5 devices per admin (the oldest makes room), ≤ 100 in all;
  removing an admin deletes their devices and name. Sending happens in
  `doPost` after the function returned (outside every lock): now for
  publish, create/delete of content, a public push send, import, admin
  add/remove; with a 30-minute cooldown per (admin, item) for edits, links,
  sections, contacts, settings; never for the rest. At most 6 per admin per
  10 minutes. Recipients: admins on the allowlist **now**, not the actor, not
  present in the panel (heartbeat < 70 s, not parked) — those get an in-panel
  toast from `apiHeartbeat({ since })` instead. Payload: title «<name>
  <summary>», a detail line, `url` `/admin/#open/<kind>/<id>` or
  `/admin/#activity/<id>`, `tag` per item (replaces instead of stacking).
- **Is the admin app installed?** Only claimed when it can be known: the
  window was opened from the admin app's icon (standalone AND the
  `?app=admin` start mark, kept in the address), or the browser says so for
  the admin manifest (`navigator.getInstalledRelatedApps()`, Chrome). Any
  other app window ("other-app", e.g. an old site app with scope `/`) is
  never called the admin app. «إعداد تطبيق الإدارة» (settings): sign-in ✓,
  install (the browser's dialog when `beforeinstallprompt` came, else a drawn
  Chrome-menu / Safari guide — never a dead button), admin notifications;
  a home card nudges until done, «مش دلوقتي» hides it for 30 days.
- **«خليك داخل» in the installed admin app** (`AdminDevice.gs`,
  `admin/device.js`, boot.js section 10). Only in the admin app's own window
  (`?app=admin` + standalone). After a real Google sign-in there,
  `apiTrustDevice` (Google token only) creates a 256-bit secret kept in
  Script Properties (`ADMIN_DEVICE_<id>`, with the account and a hard end 30
  days after that sign-in — never extended by use; ≤ 5 per admin); the page
  imports it as a NON-EXTRACTABLE HMAC key (IndexedDB) and keeps nothing
  else. A launch signs `<id>.<ms>.<nonce>` for `deviceSignIn` (doPost, no
  Google token): device, end date, ±10 min, unused nonce, constant-time
  HMAC, allowlist → a random `adm1.…` access token (1 h, hashed in
  CacheService) used like the ID token; the device is re-checked on every
  call. `apiAddAdmin`, `apiRemoveAdmin`, `apiTrustDevice` answer `reauth`
  to device tokens (Google again). It ends with «خروج» (`apiForgetDevice`,
  plus this device's admin push unsubscribed — before the session ends), the
  end date, admin removal, 10 bad signatures.
- **Links into the panel.** boot.js takes `#open/…` / `#activity/…` out of
  the address bar and follows it once the panel is drawn (`A.openLink`:
  `A.go` → `A.openEditor`, asking first about unsaved changes; the data is
  read again before saying an item is gone, which shows its log entries).
  A tap with an admin window open: the worker posts
  `{ type: 'athanasios-admin:open', url }` and focuses it (no second session).

## Competitions (engine, Phase 1)

The full design and build contract is **[docs/COMPETITIONS.md](COMPETITIONS.md)**
(tabs, JSON shapes, error codes, the admin API). In short:

- **A second, private spreadsheet** (`COMP_SHEET_ID`, made by the first admin
  write) holds Competitions, Questions, Snapshots (the live, private
  definitions, content-addressed) and Submissions. Server files:
  `apps-script/Comp*.gs` (`CompModel.gs` and `CompScore.gs` are pure and
  tested in Node).
- **Publishing stays one button and one commit**: content.json gains a
  `competitions` index whose `v` (the definition's hash) makes any
  competition change a new revision; the commit also carries
  `competition/<slug>/index.html` (a stub made from the engine shell
  `competition/index.html`) and `comp.json` (no questions, no answers).
  Question text, choices and keys never reach GitHub (a test scans every
  committed file).
- **The only dynamic public calls** are `comp*` (and later `portal*` /
  `shop*`) through the same `doPost`, before the admin token check:
  start / submit / result with stateless HMAC tokens, the server's clock,
  idempotency keys, a 300/min budget, 64 KB requests, grading before a short
  user-lock section (one row written per submit).
- The admin works through `apiComp*` (not `mutate_`); live writes (grading)
  only from `/admin/`. Cards (Activities `competition` column), bell targets
  `competition:<slug>`, media usage, the review and «سجل النشاط» know
  competitions. `apiState` reads them through a cache.

## Ready for later (not built yet)

- **Push, later:** categories (الاجتماعات / الأخبار / المسابقات والأنشطة) as
  a `topics` column in PushSubs filtered at send time; automatic sends of
  future-dated bell items (a time-driven trigger); "test on my device".

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
