# Setup and deployment

One-time setup, in order. Plan about 30 minutes. Do everything signed in as
**menazakmena@gmail.com** (the admin and owner).

1. [GitHub repository and Pages](#1-github-repository-and-pages)
2. [The Apps Script project](#2-the-apps-script-project)
3. [GitHub token](#3-github-token)
4. [Script Properties](#4-script-properties)
5. [Run setup (creates the Sheet)](#5-run-setup-creates-the-sheet)
6. [Deploy the admin web app](#6-deploy-the-admin-web-app)
7. [First publish and checks](#7-first-publish-and-checks)

---

## 1. GitHub repository and Pages

The portal is the service account's main site:

| Account             | Repository                    | Public URL                                  |
| ------------------- | ----------------------------- | ------------------------------------------- |
| `StAthanasiosYouth` | `StAthanasiosYouth.github.io` | **`https://stathanasiosyouth.github.io/`** |

`صوتك يهمنا` keeps working at `https://stathanasiosyouth.github.io/your-voice-matters/`
(a project site under the same account).

The code is already set to this address (canonical, Open Graph, QR codes,
shared links, calendar). If it ever changes: `npm run set-url -- <new URL>`
in `tools/`, then the same value in `SITE_URL` (step 4).

1. Signed in as **StAthanasiosYouth**, create a **public** repository named
   exactly `StAthanasiosYouth.github.io` (GitHub ignores the case). Don't add a README, license or
   .gitignore (this folder has them).
2. Push this folder to the repository's `main` branch.
3. Repository **Settings → Pages**: *Source* = "Deploy from a branch",
   *Branch* = `main`, folder `/ (root)`. Tick **Enforce HTTPS** once it's available.
4. Wait a minute, then open the URL. You should see the portal with the
   seed content.

GitHub Pages builds with Jekyll; `_config.yml` keeps `apps-script/`,
`tools/`, `tests/` and `docs/` off the website.

## 2. The Apps Script project

The admin is a **standalone** Apps Script project. Don't create it from
inside a Sheet (Extensions → Apps Script). Anyone who can edit a Sheet can
open a script bound to it and read its secrets. Standalone, only you can
open the code and the GitHub token, even if you later share the Sheet with
another admin.

1. Go to <https://script.google.com> → **New project**. Name it
   **"أسرة البابا أثناسيوس – لوحة التحكم"**. Don't share the project with anyone.
2. Create files with these exact names and paste the contents from
   `apps-script/`:

   | Type   | Name           | From                            |
   | ------ | -------------- | ------------------------------- |
   | Script | `Content`      | `apps-script/Content.gs`        |
   | Script | `Hub`          | `apps-script/Hub.gs`            |
   | Script | `Seed`         | `apps-script/Seed.gs`           |
   | Script | `Auth`         | `apps-script/Auth.gs`           |
   | Script | `Store`        | `apps-script/Store.gs`          |
   | Script | `Publish`      | `apps-script/Publish.gs`        |
   | Script | `Code`         | `apps-script/Code.gs` (replace the default `Code.gs`) |
   | Script | `Items`        | `apps-script/Items.gs`          |
   | Script | `Media`        | `apps-script/Media.gs`          |
   | Script | `Api`          | `apps-script/Api.gs` (the API for `/admin/`) |
   | Script | `Migrate`, `Review`, `Platforms`, `Presence`, `Import` | `apps-script/*.gs` |
   | HTML   | `Admin`        | `apps-script/Admin.html`        |
   | HTML   | `AdminStyles`  | `apps-script/AdminStyles.html`  |
   | HTML   | `AdminScript`  | `apps-script/AdminScript.html`  |
   | HTML   | `AdminPage`    | `apps-script/AdminPage.html`    |
   | HTML   | `AdminContent` | `apps-script/AdminContent.html` |
   | HTML   | `AdminIcons`   | `apps-script/AdminIcons.html`   |
   | HTML   | `NoAccess`     | `apps-script/NoAccess.html`     |

3. **Project Settings** (gear icon) → tick *Show "appsscript.json" manifest
   file in editor*. Open `appsscript.json` and replace it with
   `apps-script/appsscript.json`.

**Alternative to copy-paste:** [clasp](https://github.com/google/clasp).
Put the script ID in `apps-script/.clasp.json` (git-ignored) and run
`clasp push` from `apps-script/`.

## 3. GitHub token

The admin publishes by committing `content.json` and `meeting.ics`. It
needs a token that can do exactly that and nothing else.

1. GitHub → your avatar → **Settings → Developer settings → Personal access
   tokens → Fine-grained tokens → Generate new token**.
2. *Resource owner*: `StAthanasiosYouth` (the organization may need to allow
   fine-grained tokens and approve the request).
3. *Repository access*: **Only select repositories** → the portal repository.
4. *Permissions → Repository permissions → Contents*: **Read and write**.
   Leave everything else at "No access".
5. *Expiration*: up to 1 year. Put a reminder in your calendar to renew it.
6. Copy the token. It's shown once.

The token is stored only in Script Properties (next step). It's never sent
to the browser, written to the Sheet, put in the repository, or used as
the commit author (commits are signed "Athanasius Portal Admin"). If it
ever leaks, revoke it on GitHub and create a new one.

## 4. Script Properties

Apps Script editor → **Project Settings → Script Properties → Add script
property**:

| Property        | Value                                                    |
| --------------- | -------------------------------------------------------- |
| `ADMIN_EMAILS`  | `menazakmena@gmail.com` (comma-separated if you add admins later) |
| `GITHUB_TOKEN`  | the token from step 3                                    |
| `GITHUB_REPO`   | `StAthanasiosYouth/StAthanasiosYouth.github.io` |
| `GITHUB_BRANCH` | `main`                                                   |
| `SITE_URL`      | `https://stathanasiosyouth.github.io/`                   |

`ADMIN_EMAILS` has to be set here by hand. There is deliberately no
"first person to open the app becomes admin" shortcut. Only people who can
edit this script can change Script Properties.

`SHEET_ID` is written by `setup`, and `MEDIA_FOLDER_ID` (the private Drive
folder for draft posters) by the first image upload. `PUBLISHED_*` are written by the
publisher; don't edit them.

## 5. Run setup (creates the Sheet)

In the editor, pick `setup` in the function dropdown and press **Run**.
Approve the permissions. Google will warn that the app isn't verified;
that's expected for your own script (*Advanced → Go to …*).

`setup` creates a private Google Sheet in your Drive called **"أسرة البابا
أثناسيوس – بيانات الموقع"** with the tabs `Settings`, `Sections`, `Links`,
`Contacts` and `Log`, filled with the current content. Its link is printed in
the execution log. Running `setup` again later is safe: it never overwrites
data, and it adds any new settings rows that newer code introduces.

The Sheet is the backup way to edit: you can change cells directly.
Changes there are drafts too, and show up in the panel's review.

## 6. Deploy the admin web app

1. Apps Script editor → **Deploy → New deployment** → type **Web app**.
2. *Execute as*: **User accessing the web app**.
   *Who has access*: **Anyone with Google account**.
   (These match `appsscript.json`.)
3. **Deploy**, then copy the **Web app URL** (ends with `/exec`). That's
   the admin panel. Bookmark it on your phone.

Anyone can open that URL, but only accounts in `ADMIN_EMAILS` get past
sign-in; everyone else sees "مش مسموح" and every server function refuses
them. The URL doesn't need to be secret. Don't post it publicly anyway.
(Someone who isn't an admin and opens it will first see Google's
permission screen for the app. If they accept, they still get "مش مسموح";
the app does nothing with their account.)

To update the code later: paste the new files, then **Deploy → Manage
deployments → Edit → Version: New version → Deploy**. The URL stays the
same.

This deployment is now the **recovery admin** (لوحة الطوارئ). The everyday
admin is `https://stathanasiosyouth.github.io/admin/` (section 8). Keep this
one exactly as it is: `AKfycbwhHMp54vLJLK5UuwH_7zByzkPRkQErcUQdvZ1ad2_AxpasNWzShoh1CT3AIOrB8Rtbvw`,
pinned to **version 14**, *User accessing the web app*. Don't give it a new
version while the manifest says `USER_DEPLOYING` (section 8.3).

## 7. First publish and checks

1. Open the admin URL. The status should say **في تغييرات مش منشورة** or
   **الموقع متحدث**.
2. **الإعدادات → اختبر الاتصال بـ GitHub** should report the repository and
   branch. Fix the token or repository name if it doesn't.
3. Change something small (for example the tagline), press **راجع وانشر**,
   check the list of changes, then **نشر التغييرات**.
4. The panel shows the commit, then **ظهر على الموقع ✓** once GitHub Pages
   has deployed (usually under a minute).

## Adding a second admin later

In the admin: **الإعدادات → صلاحيات لوحة التحكم → ضيف** (any admin can do it;
the primary account can never be removed and the list is never empty). It
writes `ADMIN_EMAILS` for you. Or add the email to `ADMIN_EMAILS` by hand.

- On `/admin/` that's all: the API runs as the owner, so they don't need
  access to the Sheet.
- For the recovery admin (Apps Script URL) also share the **Sheet** (not the
  script) with them as Editor: there the script runs as them.

Nothing needs redeploying, and they can't see the code or the token.

## Renewing the GitHub token

When the token expires, publishing shows "GitHub رفض التوكن (401)". Create a
new token (step 3) and replace `GITHUB_TOKEN` in Script Properties. Nothing
else changes.

## Upgrading an existing admin to the content center

If the admin was set up before meetings, news, games and the bell existed:

1. Paste the new and changed files from `apps-script/` (the table in step 2;
   `Hub`, `Items`, `Media`, `AdminPage` and `AdminContent` are new, and most
   others changed). Replace `appsscript.json` too.
2. Run `setup` again from the editor. Google asks for one new permission:
   *"See, edit, create, and delete only the specific Google Drive files you
   use with this app"*. That's the narrow `drive.file` scope: the script only
   ever sees the poster files it created itself, never the rest of your Drive.
   `setup` then:
   - adds the tabs `Sessions`, `News`, `Games`, `Notifications`, `Media`;
   - moves an announcement that is still switched on into **News** as a
     pinned item, and switches the old one off;
   - moves future "days without a meeting" into **Sessions** as cancelled
     meetings.

   Existing data is never overwritten.
3. **Deploy → Manage deployments → Edit → Version: New version → Deploy.**
4. Push the updated website files (`index.html`, `assets/`) to GitHub.

The new website reads both the old and the new `content.json`, so the order
of these steps can't break the live site. Until `setup` runs again, the
admin's content-center screens show a notice; links, location and contacts
keep working.

## Checking the Sheet (`checkSheet`, `clearStrayIds`)

Every checkbox column holds FALSE down to the last row of its tab (1000 by
default). The admin decides whether a row is a record from its other
columns, so those empty checkbox rows are never read as data, and new
records go right after the last real row.

- **`checkSheet`** (read-only): run it from the editor and open the
  **Execution log**. For each tab it shows how many rows are records, and
  for Links/Contacts how many empty rows still carry an automatic id. It
  also shows how long reading and checking the whole draft takes, and the
  error count.
- **`clearStrayIds`** (optional): versions before this fix wrote ids like
  `link-1a2b3c4d` into empty Links/Contacts rows. The panel ignores those
  rows already. This function only empties those id cells, in rows that
  have nothing else in them, to tidy the Sheet. Real rows are not touched.

## Checking poster uploads (`checkMedia`)

**الإعدادات → الصور → «اختبر رفع الصور»** (or run `checkMedia` from the
editor) walks every step a poster upload takes against the real Google
Drive: the `drive.file` permission, the staging folder, a tiny test
upload, reading it back, and deleting it. It stops at the first failing
step and shows Google's exact reason. Nothing is left behind.

A failed upload also shows that reason in the editor (under «تفاصيل
تقنية») and is written to the Log tab as `media.upload.failed`.


## Data upgrade to schema 3 (`planMigration`, `migrate`)

Version 3 of the data makes every block on the page a row in **Sections**
(meeting, featured links, news, games, competitions, activities, location,
link groups, contacts, support, share). Each section can be switched off or
scheduled. It also adds the columns used by competitions, activities,
the archive and the media library, plus the WhatsApp group link.

1. **الإعدادات → ترقية البيانات → «شوف هيتعمل إيه»** (or run
   `planMigration` in the editor). It only reads, and lists each step.
2. **«نفّذ الترقية»** (or `migrate`). Before changing anything it copies every
   tab to a hidden `_backup_YYYYMMDD_<tab>`, never overwriting an older
   backup. Then it:
   - creates the new tabs **Activities** and **Types** (Types with the
     standard activity types);
   - appends the new columns at the end of existing tabs (nothing moves);
   - adds the built-in sections in the order the page already had, with the
     meeting block keeping its old on/off value;
   - adds the WhatsApp group link once.

   It never deletes, reorders or re-seeds anything, and it checks afterwards
   that no tab lost a row. Running it again does nothing.
3. Review and publish as usual. The site looks the same until you change a
   section.

The site and the admin both work before the upgrade (the built-in sections
then follow the old layout). Editing a built-in section asks for the upgrade
first. `setup` runs the same upgrade, so re-running it is safe.

To undo: unhide the `_backup_…` tabs (right-click the tab bar → show) and
copy their contents back.

### Schema 5 (meeting program, cards' background)

The same upgrade, run again after updating the code: **الإعدادات → ترقية
البيانات → «شوف هيتعمل إيه»** must list exactly one step, *أعمدة جديدة*:
`Sections: surface, surfaceMobile — Sessions: program`. Then **«نفّذ
الترقية»** (backup first, columns appended at the end, nothing else
touched; the site looks the same). Until then, saving a meeting program or
a «شكل الخلفية» choice asks for the upgrade (nothing is dropped silently);
everything else works as before.

New in this version: `Import.gs` (the meetings import) — create it in the
Apps Script project next to the others; `Hub`, `Items`, `Code`, `Content`,
`Store`, `Migrate`, `Publish`, `Presence`, `Api`, `AdminContent`,
`AdminHome`, `AdminPage`, `AdminScript`, `AdminStyles` changed. No new
scopes or Script Properties to set (`LIVE_STATE` is written by the panel).

### `live.json` (the live meeting stage)

During a meeting with a program, «دي الحالية دلوقتي» calls
`apiSetLiveStage(date, index | null)`: one commit that changes **only**
`live.json` at the site's root
(`{ "schema": 1, "date": "YYYY-MM-DD", "stage": <index> | null, "updatedAt": "<ISO>" }`),
through the same token as publishing. It never touches `content.json` or the
draft, needs no review, and is logged (`live.stage`). `stage: null` = the
program's own times. The normal publish never writes `live.json`.


## 8. The official admin page (`/admin/`)

`https://stathanasiosyouth.github.io/admin/` **is** the admin: the same
panel, served by GitHub Pages. The browser stays on that address the whole
time (no redirect, no frame). The Apps Script URL from section 6 stays as
the recovery admin (لوحة الطوارئ), linked in small print on the sign-in
screen.

```
 /admin/ (GitHub Pages: index.html, admin-app.js, admin.css, boot.js, config.js)
   │  "Sign in with Google" → a Google ID token (1 hour, kept for this tab only)
   │  POST {fn, args, token}  (text/plain, no cookies)
   ▼
 Apps Script API deployment: doPost (Api.gs), runs as the owner
   1. tokeninfo: Google checks the signature; aud = the client ID,
      iss = accounts.google.com, not expired, email verified (cached per token)
   2. the email is on ADMIN_EMAILS
   3. only a listed api* function runs, as that email
   ▼
 Sheet / Drive / GitHub, exactly as before
```

There are **two public values** and they live in **one file**,
`admin/config.js`:

| Field      | What                                         | Status |
| ---------- | -------------------------------------------- | ------ |
| `clientId` | OAuth 2.0 Client ID (Web application)        | set: `246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com` |
| `apiUrl`   | the API deployment's Web app URL (`…/exec`)  | **empty until step 8.3** → the page says «لوحة التحكم لسه بتتجهز» and offers the recovery admin |
| `fallbackUrl` | the recovery admin (section 6)            | set |

Neither is a secret (anyone can read a website's files). Who gets in is
decided only by the server. There is **no client secret** in this flow:
never create, store or use one.

### 8.1 The OAuth client (done once, needs the owner's Google login)

Already created. For the record, or to make it again:

1. <https://console.cloud.google.com/> signed in as the owner → pick or create
   a project (e.g. "athanasios-admin").
2. **APIs & Services → OAuth consent screen** (Google Auth Platform →
   *Branding / Audience / Data access*):
   - *User type*: **External**. App name «لوحة تحكم أسرة البابا أثناسيوس»,
     support email = the owner, developer contact = the owner.
   - *Scopes / Data access*: add only **openid**, **…/auth/userinfo.email**,
     **…/auth/userinfo.profile** (all "non-sensitive"; no verification needed).
   - *Audience*: either **Publish app** ("In production"; fine for these three
     scopes), or keep "Testing" and add every admin's Gmail under *Test users*
     (otherwise Google refuses their sign-in).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - *Application type*: **Web application**, name "admin page".
   - *Authorized JavaScript origins*: **`https://stathanasiosyouth.github.io`**
     (exactly: https, no path, no trailing slash).
   - *Authorized redirect URIs*: leave empty.
   - **Create**. Copy the **Client ID** (`…apps.googleusercontent.com`).
     Ignore the client secret; it is not used anywhere.
4. Put the Client ID in `admin/config.js` → `clientId` (already there) and in
   the Script Property of step 8.2.

### 8.2 Script Properties

| Property          | Value |
| ----------------- | ----- |
| `ADMIN_CLIENT_ID` | optional. `Api.gs` already defaults to the Client ID above (`DEFAULT_ADMIN_CLIENT_ID`); set this only if the client ever changes. It must equal `admin/config.js` `clientId` |
| `ADMIN_PRIMARY`   | optional; default `menazakmena@gmail.com`. The account that can never be removed from the allowlist |
| `ADMIN_EMAILS`    | unchanged (now also editable from **الإعدادات → صلاحيات لوحة التحكم**) |

If the server's client ID (property or default) differs from `clientId`, or the property is malformed, every API call is refused
(the page says «جوجل دخّلك، بس خادم لوحة التحكم مقبلش الدخول»).

### 8.3 The API deployment (a second deployment of the same project)

The page on github.io can't send Google cookies to Apps Script, so the API
runs as the owner and accepts anonymous requests; every request proves who
it is with the ID token instead. That setting belongs **only** to this new
deployment's version. The recovery deployment stays on version 14 (runs as
the visitor) and must not be touched.

1. Update the project's files from `apps-script/` (new: `Api.gs`, `Presence.gs`;
   changed: `Auth.gs`, `Code.gs`, `Items.gs`, `Media.gs`, `Migrate.gs`, `Admin*.html`). The repository's
   `appsscript.json` keeps the recovery settings (`USER_ACCESSING`); leave
   the Drive advanced service as it is.
2. In the editor, open `appsscript.json` and set only the `webapp` part to:
   ```json
   "webapp": { "executeAs": "USER_DEPLOYING", "access": "ANYONE_ANONYMOUS" }
   ```
   Save.
3. **Deploy → New deployment** → type **Web app** → description "Admin API" →
   *Execute as*: **Me (menazakmena@gmail.com)** → *Who has access*:
   **Anyone** → **Deploy**. Authorize if asked. Copy the **Web app URL**.
4. Put the `appsscript.json` `webapp` part back to
   `{ "executeAs": "USER_ACCESSING", "access": "ANYONE" }` and save, so the
   project's head again matches the recovery deployment.
5. Put the URL in **`admin/config.js` → `apiUrl`**, run
   `cd tools && npm test`, commit and push. That's the only place.
6. Open `https://stathanasiosyouth.github.io/admin/`, sign in, and check
   **الإعدادات → صلاحيات لوحة التحكم** shows the list.

To update the API later: step 1, step 2, **Deploy → Manage deployments →**
the "Admin API" deployment **→ Edit → Version: New version → Deploy**, step 4.
The URL stays the same. Never pick the recovery deployment there.

The code is safe under both settings:

- Runs as the owner (`USER_DEPLOYING`): `doGet` never serves the HTML admin
  (it answers with a short JSON note), so there is no `google.script.run`
  page running with the owner's rights. The only exception it can't tell
  apart is the owner himself, signed in to Google, opening the API URL: he
  gets the same panel the recovery admin gives him. The Session is never
  used inside `doPost`, and `Session.getEffectiveUser()` is never used to let
  anyone in.
- Runs as the visitor (`USER_ACCESSING`, the recovery admin): unchanged.
  `doPost` there still demands a valid token.

### 8.4 What the page does (for maintainers)

- `admin/index.html`, `admin/admin.css`, `admin/admin-app.js` are
  **generated** from `apps-script/Admin*.html` by `tools/build-admin.mjs`
  (`npm run build-admin`; `npm run sync` runs it too). `tests/refine-b.test.mjs`
  fails when they are stale. Hand-written: `restore.js` (the compact gate after a reload), `boot.js` (sign-in, the transport
  `window.AdminTransport`), `config.js`, `gate.css`, `preview-guard.js`.
- Security policy (meta tag): own files, `accounts.google.com/gsi/*` (script,
  button frame, style), `script.google.com` + `script.googleusercontent.com`
  (the API answers through a redirect to googleusercontent), the map frame
  for the preview. No inline code or styles, no `eval`. `noindex`,
  `no-referrer`; frame-busting in `boot.js` (Pages can't send headers).
- The token is kept in memory only (never sessionStorage/localStorage: the
  origin is shared with /your-voice-matters/), never past its expiry. A
  reload gets a fresh one from Google: silently with auto-select when it
  can, otherwise with the button. When it runs out, a «الدخول محتاج يتجدد» dialog opens over
  the panel; the call that needed it continues after signing in, so nothing
  being edited is lost.
- Signing in goes through stages, each with a watchdog: Google's script
  ("slower than usual" after ~6 s, a message with «جرّب تاني» after 20 s), the
  button (always shown at once; a silent sign-in that never answers changes
  nothing), the server ("slower than usual" after ~7 s: a cold start takes
  5–15 s; the request is aborted after 45 s → «جرّب تاني» and the recovery
  link), then drawing the panel. The sign-in screen goes away only once the
  panel is drawn; a retry is always safe. Once Google answers (a click, or
  silently for a returning admin), the sign-in screen itself shows «جاري
  التحقق...» with the account and closes Google's prompt; the panel replaces
  it only after it is drawn and measured on screen. A request the browser
  drops (a phone freezing the tab behind Google's sign-in) becomes «جرّب تاني»;
  a reload in the middle of signing in is never "another device" (a session
  that never drew its panel, on a look-alike device, is taken over quietly);
  Google's One Tap card is capped in `gate.css` so it can never cover the
  screen.
- One session per Google account (`apps-script/Presence.gs`): signing in
  asks the server for a session id (sent with every call; never enough
  without the token). If the account is live on another device or tab (a
  heartbeat in the last ~90 s) the page asks «الحساب ده شغال دلوقتي على جهاز
  تاني» → «إنهاء الجلسة الأخرى والدخول هنا» or «إلغاء». The tab that was taken
  over goes back to the sign-in screen («الجلسة اتقفلت لأنك دخلت من جهاز تاني»).
  Sign-out ends the session at once.
- A reload is almost invisible. This tab's sessionStorage (`athanasios-admin.*`,
  gone when the tab closes) keeps only the opaque session id with the page
  load's id, where the admin was (area, sub-tab, scroll) and an open item
  editor's unsaved values (plain form values, capped; never a file) — never
  the token or anything from Google. Leaving the page parks the session (a
  `sendBeacon`): no longer live for other devices, its locks and presence
  kept ~45 s. The next page load shows only «جاري استعادة الجلسة...»
  (`admin/restore.js` sets that before anything is drawn), gets a token from
  Google (Google's button right there if it wants a click) and calls
  `apiSessionResume`: the SAME session, locks and presence, with the panel's
  state in the same answer — never the takeover question for its own tab. A
  duplicated tab or another device is still asked. Expired → the usual
  sign-in; taken over → «الجلسة اتقفلت…». The editor comes back with
  «رجعنا التعديلات اللي ماكانتش اتحفظت» / «تجاهلها» (read-only under the lock
  banner if someone else took the item meanwhile); nothing is saved to the
  server by itself. The browser's own "leave the page?" stays only for what
  can't come back (a photo still uploading, a settings card). Pull-to-refresh
  is switched off on the admin (`overscroll-behavior-y: contain`).
- Working together: a heartbeat every ~25 s while the page is visible (paused
  when hidden) shows the other admins online under the top bar (name, «متصل
  الآن», where, what they edit). Opening an existing item (meetings, news,
  games, notifications, activities, types, links, contacts, sections, images)
  or changing a settings card locks it; another admin sees it read-only with
  «فلان بيعدّل ده دلوقتي», and the server refuses their save of that item.
  Locks end on save, close, sign-out, ~45 s after leaving the page, or ~90 s after the
  holder's last heartbeat. The recovery admin (version 14) doesn't take part.
- Preview (معاينة): on github.io the preview frame shares the site's origin.
  `admin/preview-guard.js` runs first in it and gives the page its own
  in-memory storage, so drafts never land in the site's cache or bell.

### 8.5 Limits

- Apps Script quotas apply to the API (URL fetch for token checks: cached,
  one per token per hour; consumer accounts get 20,000 fetches a day).
- The heartbeat is one short request per ~25 s per admin with the page in
  front (~150 an hour, none while the tab is hidden), plus one when an editor
  opens or closes. Each request reads the Script Properties twice (the client
  ID and the allowlist; consumer quota 50,000 reads a day) and uses
  CacheService and the script lock (no daily quota). Sessions and locks live
  in CacheService: no new Script Properties.
- A bad request costs one quick refusal; nothing runs before the token and
  the allowlist are checked.
- Signing out on the page signs out of the admin only (not of Google).
