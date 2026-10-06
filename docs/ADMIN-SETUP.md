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

1. Share the **Sheet** (not the script) with their Google account as Editor.
2. Add their email to `ADMIN_EMAILS` (comma-separated).

They can then open the same admin URL. Nothing needs redeploying, and they
can't see the code or the token.

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
