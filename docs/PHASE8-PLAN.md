# Phase 8 — execution plan

Started 2026-11-04 on the owner's order. Spec: `docs/BACKEND-MIGRATION.md` §22.1 (items 1–25). This file fixes the order,
the gates and the way back. Where it and §22.1 differ, §22.1 wins unless this file says why.

## 0. What the owner approved (2026-11-03 → 2026-11-04)

- **Admin:** the new design and the intro, as shown in the approved preview (`docs/phase8/admin-preview.src.html`,
  https://claude.ai/artifact/Xu1bEMP9r71EPJXwQvig4V, v3). It is built for real on the panel, slice by slice.
- **Public site:** the **current look stays**. The public redesign preview (`docs/phase8/site-preview.src.html`) was
  reviewed and **not** adopted. Only the navigation changes below are built.
- Both tracks: Staging first, then production after the checks pass.

The two tracks never share a slice, a commit or a deploy. The admin's new design tokens and components live in the admin's
files only (`apps-script/Admin*.html` → `admin/`). The public site keeps `DESIGN.md` and its own CSS. Nothing from the admin
redesign reaches a public page.

## 1. Track P — public site navigation (current design kept)

Scope, exactly (owner, 2026-11-04):

1. **Mobile bottom bar** (from the preview): الرئيسية · الفعاليات · المسابقات · حسابي. Phones only (narrow widths);
   desktop keeps today's navigation with no bottom bar.
2. **Fewer top icons on phones:** the account icon moves into the bar; the top keeps the bell and the sound toggle.
3. **«ارجع للموقع» becomes a Home icon** in every page's top bar (service pages, events, competitions, «نقاطي», account,
   404). Its accessible name stays meaningful («الرئيسية»).
4. **One navigation that feels like one app:** real page URLs stay (deep links, sharing, push taps), the browser's history
   and Back work as today, and moving between pages feels continuous.
5. **Nothing else changes:** look, identity, content and functions as they are.

How (study result):

- **Shared module, no builder change:** one small script and stylesheet (`assets/js/nav.js`, `assets/css/nav.css`) that every
  page's entry module already loaded imports, so the pages the publish writes (`black-theatre/`, `events/<slug>/`,
  `competition/<slug>/`) get it without regenerating their HTML. The Home icon is done in CSS on the existing
  `.pbar__home` / `.cbar__home` link, so the builders' shell markup and their tests stay valid. No-JS keeps today's text link.
- **Continuity across real pages:** cross-document View Transitions (`@view-transition { navigation: auto }`) with the top
  bar and the bottom bar named so they stay still while the content changes; skipped with reduced motion and where the
  browser lacks it (the page just loads, as today). Same-origin links are prefetched on intent (touch start / hover) so the
  next page is ready.
- **Back behaves:** the browser's Back is untouched (bfcache keeps the home page's scroll). The Home icon and the «الرئيسية»
  tab go back in history when the page before was the home page (same tab, same origin), so the visitor lands where they
  were; otherwise they navigate to `/`. A tab for the page you are on scrolls it to the top.
- **Targets:** «الفعاليات» opens the home page's activities section (`/#…` anchor of the section that exists today),
  «المسابقات» opens `/points/` (نقاطي والمسابقات), «حسابي» opens `/account/` (the account icon's behaviour, `link.js`
  `FROM_KEY` kept). The bar marks the current one.

Slices: **P1** nav module + bottom bar + top icons → **P2** Home icon on every bar → **P3** transitions, prefetch, back rules →
**P4** tests and checks.

**Owner's changes while building (2026-11-04), all built:**
- The bar is **three slots + «حسابي» + «المزيد»**. On the home page the three slots are the places **nearest to where you are**
  (the section you are in, lit, and its neighbours; «الرئيسية» is the top) and follow the scroll: going down, the far one
  leaves to the right and the next comes in from the left, out of the line beside «حسابي»; going up, the other way round.
  On any other page the slots are «الرئيسية · الفعاليات · المسابقات». «حسابي» and «المزيد» never move.
- **«المزيد»**: a sheet with every place: the home page's sections (in the page's order), the social pages, the site's pages
  («نقاطي والمسابقات», service pages). From another page a home section opens `/index.html#to-<key>` at that section.
- **Look:** a floating glass capsule (iOS 18 in spirit) in the site's navy and gold: blur, a light edge, crisp hairlines.
  One glass **lens** glides to the lit place with a soft spring (never a jump). Going down the page the bar draws in to icons
  only; going up it opens again.
- **Tasks keep the screen:** while a booking is filled in, or while typing, the bar slides away (as an app hides its tab
  bar). The competition's sticky actions stop above the bar; `scroll-padding-bottom` keeps anything brought into view clear.
- The cross-page transition is typed (`site-page`), so a page's own transitions (the account's sign-in) stay as they were;
  moves into and out of the account page are plain; an aborted transition is never a page error.
- The account page's link keeps returning to the page you came from (ACCOUNTS-IMPROVEMENTS); its icon is the Home icon and
  its name says where it goes.

**Closing round (owner, 2026-11-04), built:**
- **The bottom bar is the home page's only.** Every other page (account, «نقاطي», service pages, events, competitions, 404)
  keeps its own top bar with the Home icon and the account icon, as before Phase 8 (this also ends a broken-icon look in
  «المزيد» on those pages, which do not carry the home page's icon styles).
- **The Home icon from the first frame:** what the first paint needs is in each page's own stylesheet (the Home icon
  in `page.css` and `account.css`; on home phones the account icon's place and the bar's room in `main.css`; `page.css`
  stays self-contained, no `@import`), so there is no «ارجع للموقع» text for a moment and no jump. `nav.css` (the bar,
  «المزيد», the games intro) is loaded by `nav.js` on home and by `game-intro.js` before it plays on a competition page.
  The bar itself rises in once, softly.
- **The B.U.G. ident (and any partner ident, `collab.js`) is part of the page:** under the page's own top bar (and the
  phones' bottom bar on home), on the page's navy with a gold room, no letterbox, no «تخطي» button; the same logos, motion
  and sound; at the end the stage opens from the centre onto the page once the page is ready (it waits, never long), and
  the page settles in. It plays every time the visitor comes into the page (owner: every entry, not once per visit).
  A tap ends it; a tap on the page's own bars goes to them. The service page's design is unchanged.
- **A games intro** (`assets/js/game-intro.js`): when a game's sheet opens on the home page, and when a competition page
  opens (under its bar): the family's seal, the «تحديات وألعاب» mark, light bursts, sparks, «يلا نلعب!» / «جاهز للتحدي؟»,
  then the content rises. With a partner (`content.partners`), both marks with a gold ×. Every time a game is opened.
  Phase 10's live games are designed in as the kind 'live' and not enabled (no Phase 10 code).
- **«نقاطي»:** a light arrival each time (the account page keeps its own arrival, DESIGN.md «العتبة»).
- Reduced motion: none of them; data saver / hidden tab / frame: none; weak phones: the light versions.

**Audit after the owner's live review (2026-11-04): every track P requirement against the code, not the closing report.**

| # | Requirement | In the code before this round | Status |
|---|---|---|---|
| 1 | Bottom bar on phones (home only, owner) | `nav.js` builds it only on home | done |
| 2 | Fewer top icons (account icon into the bar on home) | `main.css` phone rule | done |
| 3 | Home icon in every inner page's top bar | service pages, `/events/`, `/pages/`, 404, account: yes. **«نقاطي» (`points/`) and every competition page (`competition/<slug>/`): no Home link at all** (`.cbar` has only the logo) | **missing** |
| 4 | The Home icon never signs anyone out | «نقاطي» has no Home icon and its only button in the first card is «خروج», where a way back is expected | **missing** |
| 5 | Smooth moves between home, account, points, services, games | cross-page transitions everywhere **except into and out of the account page** (skipped to protect its sign-in transition) | **missing (account)** |
| 6 | A light intro for account and points | «نقاطي»'s arrival rules live in `nav.css`, which inner pages no longer load since the bar became home-only: **it never shows**. The account page's «العتبة» plays only on sign-in | **missing** |
| 7 | «نقاطي» reorganized professionally (owner, live review) | one long column of cards (balance, season, prizes full width, requests, competitions, ledger) | **missing** |
| 8 | Logout red and clear on the account page (owner, live review) | `.ac-signout` is grey text | **missing** |
| 9 | «نقاطي والمتجر» off the home page, the top star icon kept (owner, live review) | `render.js` still places the widget in the home flow | **missing** |
| 10 | In-page B.U.G. ident, every entry | `collab.js` | done |
| 11 | Games intro (games, competitions; Phase 10 off) | `game-intro.js` | done |
| 12 | Home icon from the first frame | `page.css`, `account.css` | done for those pages; comp pages need it (row 3) |
| 13 | Deep links, Back, history kept | tests and `nav-check.mjs` | done |

**Closing round 2 (owner, 2026-11-04), built:** rows 3–9.
- **Home icon everywhere:** «نقاطي» has it in its markup; the competition pages get it from `nav.js` `homeLink()` (their
  shells come from the page builder, unchanged), at the bar's end like every other page, styled in `comp.css`. The logo goes
  home the same way. Going home never touches the session.
- **«نقاطي» reorganized** (`comp/portal.js`, `comp.css`; same look and tokens): one summary card (name, balance, the season
  with its bar, three numbers that open their tab: competitions, requests waiting, prizes you can order now), then tabs that
  stay under the top bar: الجوايز · طلباتي · مسابقاتي · الحركة (only those with something to say). Each tab has its own
  address (`#prizes`, `#orders`, `#comps`, `#points`) that opens it; switching uses `replaceState`, so Back still leaves the
  page. Prizes are compact cards, two to a row on a phone, three on a desktop. The past seasons fold under «الحركة».
  «خروج من الحساب» is red, at the end of the page (no longer next to the name).
- **Account way in and out:** the arch's arrival plays on every entry (was once a visit), not again between the account's own
  screens; the page rises in once drawn. Leaving for the site (Home icon or logo), the account and «نقاطي» draw back for
  190 ms and the page they lead to rises in (`nav.js`, `sessionStorage` key `athanasios.nav.arrive.v1`). Reduced motion: none.
- **«خروج» on the account page** is a red pill (`account.css` `.ac-signout`), in the rail on a desktop and at the end on a phone.
- **The home page has no «نقاطي والمتجر» card** (`render.js`); the top star (`#points-link`) and «المزيد» keep the way in.
  `points.js` stays (its words are unit-tested; nothing on home loads it now).
- **«نقاطي»'s arrival works again:** its rules moved into `comp.css` (they were in `nav.css`, which inner pages stopped
  loading when the bar became home-only); the arrival now waits for the page to be drawn.

Done when:
- Unit and browser tests pass (existing ones updated only where the change is the point: the Home link's look).
- On the local site against the Staging Worker: every page type shows the bar on a phone width and not on desktop; every tab
  lands on the right page; Back from each inner page returns to the home page at the same scroll; deep links to an inner page
  work cold; the account flows in `tools/account-badge-staging.mjs` still pass; no console errors; CSP unchanged.
- Production: pushed to `main` (GitHub Pages) after the Staging checks; the production check (`tools/account-badge-prod-check.mjs`
  plus a nav check) passes on the live site.

Way back: revert the slice's commit on `main` (static files, minutes).

## 2. Track A — admin redesign (approved preview)

Order from §22.1 with the approved preview as the reference. Each slice: built in `apps-script/Admin*.html` (the admin's
source), `npm run build-admin`, tests, the panel on `localhost` against the Staging Worker, owner sign-off on Staging for the
slices the owner sees, then production. Worker changes go to `worker/` (Staging deploy first; production by CI on `main`).

| Slice | What | Notes |
|---|---|---|
| A0 | Baselines and parity inventory | Screenshots of every screen at 375 / 768 / 1440 (`admin/layout-check.js`, extended), every action per screen listed (`docs/PHASE8-INVENTORY.md`) |
| A1 | Design tokens and themes | Dark + light token sets, accents, density, motion tiers, the motion and sound module; preferences per admin on the Worker (additive migration, next free number), a local copy applied before first paint |
| A2 | Shell | Rail (groups, sliding indicator, collapse), top bar (search palette, presence, bell, «راجع وانشر», account menu), phone dock + «المزيد», sign-out (rail, account menu, «المزيد») with the gate, the intro as the in-shell welcome state |
| A3 | Actions and feedback | Button hierarchy and states (loading / success / error), in-app confirm everywhere (typed confirm for irreversible), toasts with undo, ripple |
| A4 | Permissions for real | `PERMS_ENFORCE = 1` on Staging, a grants review with the owner, then production (way back: the switch to 0); role-adaptive home; the «مش متاح لحسابك» view; the palette shows allowed areas only |
| A5 | Shared form layer and controls | §22.1 item 12; drawers / full-page editors / dialogs by task |
| A6 | Modules | Home widgets → youth accounts (cards, password card) → competitions → bookings → content / pages / events → media → activity (+ «إدارة السجل», new Worker routes and the `activity.manage` grant) → settings (appearance, admins, test data with Worker-side protection) |
| A7 | Games corner | The «الألعاب» entry as a locked «قريبًا» area behind `GAMES_MODULE`; no Phase 10 code |
| A8 | Accessibility and real devices | axe in both themes, keyboard paths, Android Chrome app, iOS home-screen app, desktop |

Done when: §22.1 acceptance criteria, and every item of the parity inventory works as before.

Way back: revert the slice's commit (static admin files, minutes); a Worker change by `wrangler rollback`; a switch by its old value.

## 3. Rules for both tracks

- Staging first; production only after the slice's checks pass (owner order, 2026-11-04). Production migrations are additive.
- Existing functions are kept: any change in behaviour that is not the point of the slice is a bug.
- No day estimates: progress is slices done (project rule).
- The video guides (§22.1 item 25) are not started in Phase 8.

## 4. Progress

- 2026-11-04: plan written. Track P runs in its own session; Track A starts with A0 here.
- 2026-11-04: **A0 done.** `tools/phase8-baseline.mjs` (run: `cd tools && node --experimental-sqlite phase8-baseline.mjs`) signs in to the official panel against the real Worker code on SQLite and captures 20 screens × 375 / 768 / 1440 (60 screenshots in `tools/.cache/phase8-baseline/`, not committed), and writes `docs/PHASE8-INVENTORY.md` (510 controls, plus the switch-gated screens listed from the source). Next: A1.
- 2026-11-04: **Track P built, checked and LIVE** (branch `phase8-public-nav` → `main` 4c83055 + 00dc43f, done in the main session on the owner's choice; production checks `tools/nav-check.mjs https://stathanasiosyouth.github.io` and `tools/account-badge-prod-check.mjs` all pass).
  `assets/js/nav.js` + `assets/css/nav.css`, imported by every entry module; the cross-page opt-in in each page's CSS.
  Checks: `tools/nav-check.mjs` all ok (every page type at 390 and 1280, tabs, «المزيد», the slots following the scroll,
  Back to the same scroll by the Home icon / the tab / the browser, cold links, the 404 page). Unit tests 765 of 766 (the one
  failure is the old one from Phase 6). Public browser tests: no new failures against `main` (the 11 that fail fail on
  `main` too); tests changed only where the icon's place is the point (`account-badge.e2e`, `polish-a.e2e`).
  `tools/serve.mjs --404` answers missing pages like GitHub Pages (off by default, so other tests are unchanged).
  Way back: revert the track's commit on `main`.
- 2026-11-04: **Track P live** (main `4c83055` + `00dc43f`); production checks passed.
- 2026-11-04: **Track P closing round live, track P closed** (main `0073a73`): the bar on home only, the Home icon from the
  first frame, the in-page B.U.G. ident on every entry, the games intro (game sheets, competition pages), the «نقاطي»
  arrival. Local and live: `tools/nav-check.mjs` all ok, `tools/account-badge-prod-check.mjs` all passed; unit 765/766 (old
  #12); public browser tests: the same failures as `main` (hub, layout, browser, not-found, final-r, prog-a, refine-b,
  account-badge #8), none new. Way back: revert `0073a73` on `main`. Next: Track A slice A1, only on the owner's word.
- 2026-11-04: **Track P round 2 live** (main 9d17056), after the owner's live review and the audit table in section 1: the Home icon on «نقاطي» and every competition page, «نقاطي» reorganized (summary card, tabs with their own addresses, compact prizes, red logout at the end), the account's arch on every entry with a gentle way out to the site, the account's red «خروج», no «نقاطي والمتجر» card on home (the star stays). Live: tools/nav-check.mjs all ok, tools/account-badge-prod-check.mjs all passed; unit 765/766 (old #12); browser tests: the same failures as main, none new (final-m #4 is intermittent on both). Way back: revert 9d17056 on main. Track A (A1) waits for the owner's word that track P is done.
- 2026-11-04: **The owner confirmed track P is done** («Yes, start A1»). Track A resumes.
- 2026-11-04: **A1 built** (branch `claude/phase-8-admin-dashboard-redesign-54b4da`, not on production yet):
  - Tokens: every colour of `apps-script/AdminStyles.html` goes through a token (white light → `--tint`, gold →
    `--acc-rgb` / `--acc-hi-rgb`, the status colours, the navy family `--nv-*`, shadows `--shade` × `--shade-k`). The dark theme's
    values are exactly the old ones: the A0 screenshots and the new ones match on every screen (pixel diff 0–0.05 %; only
    «الإعدادات» differs, by the new card).
  - Themes: dark (the family's identity), light (designed for daylight: its own surfaces, text and status colours, softer
    shadows), «زي الجهاز». Six accents (ذهبي · بحري · عنابي · سماوي · زمردي · بنفسجي), each with its dark and light values; the
    primary button keeps its exact gold on dark.
  - Density (مريح / مضغوط), motion tiers (كاملة / مخففة / مقفولة; the device's «reduce motion» always wins:
    `A.reducedMotion()` reads it), and the sound module (`A.sound`, synthesized, very quiet, off until turned on; toasts and
    the editor sheet use it).
  - Per admin on the Worker: migration `0029_admin_prefs.sql` (additive: a new table), `GET /v1/admin/me` returns `prefs`,
    `POST /v1/admin/me/prefs` keeps known values only (`worker/src/admin/prefs.js`; any admin, own row, no audit row).
  - Before the first paint: `admin/look.js` (not deferred, after `restore.js`) puts the device's copy on `<html>`;
    after sign-in the server's copy wins unless this device has a change it could not send yet.
  - «المظهر» card at the top of «الإعدادات»: every choice shows at once and is kept; nothing to save.
  - Tests: Worker (`admin-platform.test.mjs`: defaults, saved per admin, known values only), unit (look.js reads only its
    entry and sets only the look's attributes), browser (`content-worker.e2e.mjs`: shows at once, on the server, first paint,
    another device, reduced motion). `tools/phase8-baseline.mjs` takes `PHASE8_PREFS`, `PHASE8_WIDTHS`, `PHASE8_ONLY`.
  - Next: the owner's look on Staging, then production (Worker by CI on `main` with the migration; static admin files).
- 2026-11-04: **Owner's order for the rest of track A:** A1 is not published on its own. The slices go in four batches,
  built and tested one after the other without stopping between them: **A1 + A2**, **A3 + A5**, **A4 + A6**, **A7 + A8**
  (a better technical order may be used). **Production once**, after all of Phase 8 is done and the owner's final approval.
  Until then everything stays on the branch `claude/phase-8-admin-dashboard-redesign-54b4da` (pushing it to `main` would
  deploy the Worker and run its migrations through CI). A4's `PERMS_ENFORCE` switch on Staging or production is a step
  that waits for that final approval too.
- 2026-11-04: **A2 built** (same branch; batch A1 + A2 done, not on production):
  - The rail in groups (الشغل · الموقع · الفريق), one light that glides to the current area (spring), «الإعدادات», «افتح
    الموقع», «صغّر القائمة» (icons only, kept per device and set before the first paint by `admin/look.js`), the admin and
    a red «خروج» at its foot.
  - The top bar: the search palette (button and Ctrl K; areas, tabs and commands; Arabic letters folded, so «الاخبار» finds
    «الأخبار»), «اللي مستنيك» (the menu's own numbers and unpublished changes, each a way there), the account menu (name,
    email, «المظهر», the mode, «افتح الموقع», «تسجيل الخروج» in red). Menus are popovers (Esc and a tap outside close them).
  - Phones: the dock is four areas + «المزيد» (a sheet with the other areas, the settings, the admin and sign-out); «المزيد»
    is lit when the area is inside it.
  - The welcome inside the shell right after signing in (not after a reload, not with reduced motion): the family's logo,
    «لوحة التحكم», «أهلاً يا …», then it steps aside by itself (≈1 s); it never stands in the way of a tap.
  - The presence strip stays as it was (its own place under the top bar); the publish flow is unchanged.
  - Tests: `content-worker.e2e.mjs` (the welcome, the rail's order and light, collapse, the palette, the menus, «المزيد» on a
    phone, sign-out in each place); the dock tests now expect four areas + «المزيد» (admin-app, comp-admin, pages-admin).
    Browser suites: the same failures as `main`, none new.
- 2026-11-04: **Batch A3 + A5 built** (same branch, not on production):
  - Already there from Phases 1–7 and kept: no native `confirm()` left (the in-app `A.confirm` / `A.modal`), toasts with an
    action, field errors under their field with the first one scrolled into view and focused.
  - New: a ripple on every press (not under reduced or lite motion); a busy button ends on itself (a check when saved, a
    short shake when it failed; `A.withBusy`); `A.confirm({ typed: 'امسح' })` for what cannot come back (the button turns
    on only with the word; used by A6's deletes); `A.undoToast(message, undo)`; Ctrl+S presses the open editor's save.
  - The form layer: a field to fix inside a folded part opens it; with two or more, the save bar says «٢ حقول محتاجة تتصلح»
    (a live region) with «اللي قبله» / «اللي بعده»; fields keep clear of the top bar, the dock and the keyboard
    (`scroll-margin`).
  - Controls: checkboxes read as toggle rows (words, then the switch); dropdowns in the panel's own look where the browser
    has `appearance: base-select` (Chrome), the styled native one elsewhere; date and time fields follow the theme.
  - Tests: `content-worker.e2e.mjs` (typed confirmation, saved / failed, the save bar's count and way between fields,
    toggle rows, Ctrl+S). Browser suites: the same failures as `main`, none new.
- 2026-11-04: **Batch A4 + A6 built** (same branch, not on production):
  - A4, the panel side of permissions: the panel reads `GET /v1/admin/me` (`perms`, the same rule every route checks). An
    area without a grant is not drawn (rail, dock, «المزيد», the palette, «اللي مستنيك»); opened anyway (a kept place, a
    link) it shows «مش متاح لحسابك» with who to ask and the way to the admin's own home; home is the first area the admin
    may open (competitions only → «المسابقات», first in the dock too). The Worker refuses the calls anyway. **With
    `PERMS_ENFORCE` off (today) nothing is hidden**: every admin keeps today's access. Turning it on (Staging, a grants review
    with the owner, then production) waits for the owner's final approval with the rest of Phase 8.
  - A6, presence (§22.1 item 18): the other admins as avatars in the top bar (online · idle · editing, gold ring when
    editing, «+N»), a tap lists who and what; on phones they stand for the strip.
  - A6, youth accounts (item 20): cards — the photo (fetched over the session only when on screen) or the first letter in
    Ruqaa, the full name, phone and email never cut (LTR, a tap copies), the chips; the whole card opens the account;
    one column on a phone, a grid on wider screens.
  - A6, «إدارة السجل» (item 22): new grant `activity.manage` (a Primary default: never held by others until granted);
    Worker routes `GET /v1/admin/activity/manage`, `POST …/preview`, `POST …/archive` (a private R2 CSV with a BOM, listed and
    downloadable), `GET …/archive/:id`, `POST …/delete` (only rows older than 90 days, never the security and permission
    rows of the last year, the word «امسح» required, logged as one `activity.trim` row). The nightly trim that already
    existed (365 days, 5250 rows) stays. The sheet in «سجل النشاط» shows only with the grant.
  - A2 leftover done here: the family's logo replaces the decorative cross mark (§22.1 item 4).
  - `apps-script/Grants.gs` (retired, kept in step for its tests) lists `activity.manage` among the Primary defaults;
    `worker/src/content/gs.gen.js` regenerated. No `clasp push`.
  - Tests: Worker `activity-manage.test.mjs` (grant, preview, safe delete, protected rows, archive); `perms.test.mjs` seed
    test knows the permission added after 0009; browser: A4 (enforce on and off), presence avatars (admin-rel), youth
    cards at 375 (youth-admin), «إدارة السجل» end to end (content-worker). Suites: the same failures as `main`, none new.
  - **Open, needs the owner (not built):** the «بيانات تجريبية» bulk delete (item 21) — its rule for what counts as test
    data has to be agreed per table with the owner ("never a guess"); the per-item «إدارة» menu and the remaining module
    restyles (media library grid and lightbox, payment-method cards, finance tables, the image-or-icon picker that also
    changes the public site, items 7–9 and 11).
- 2026-11-04: **Batch A7 + A8 built** (same branch, not on production):
  - A7, the games corner: a locked «الألعاب · قريبًا» area, only while the new switch `GAMES_MODULE = '1'` (D1 settings;
    absent = off, so nothing shows today); `GET /v1/admin/me` reports it (`modules.games`). It lists the six approved games
    and what the corner will hold; nothing runs a game, keeps a session or reads a table (Phase 10, §22.3). The external
    game links in «المحتوى» ← «الألعاب» stay as they are.
  - A8: axe (WCAG 2.0–2.2 A/AA, serious and critical) on «الرئيسية», «الأخبار», «المسابقات», «الفعاليات», «الصور»,
    «سجل النشاط», «الإعدادات» and the games corner, in the dark and the light theme, at 1440 and 390: clean (one finding
    fixed: the log's day headings were list items with `role="presentation"`). Keyboard: the palette (Ctrl K, arrows, Enter,
    Esc), the menus (Esc, focus to the first item), Ctrl+S in editors, the typed confirmation (Enter only when the word is
    right). Real devices (the Android app, the iPhone home-screen app, desktop Chrome/Edge) are the owner's pass after
    deploy.
  - Tests: `content-worker.e2e.mjs` (A7 on and off, the axe matrix).
- **Phase 8 track A on the branch, ready for the owner's final review** (A1–A8 in four batches: `2ac8887` A1+A2,
  `8632bed` A3+A5, `a4413b8` A4+A6, and A7+A8). Production is one deploy after the owner's approval: push the branch to
  `main` (CI runs the Worker's migrations — `0029_admin_prefs` — and deploys Staging then production; the static admin
  files go with GitHub Pages). Way back: revert on `main` and `wrangler rollback`; the migration only adds a table.
- 2026-11-04: **Owner's review: "not the approved preview yet"** — the panel must take the preview's look, not only new colours
  and buttons. Built on the same branch (`0f63e53`, `083fca0`), not on production:
  - The preview's visual system on the real panel (the last layer of `AdminStyles.html`): flat solid surfaces with fine
    lines (no gradient cards, no gold edge), the preview's buttons, chips, fields, underline sub-tabs, rail (46px rows, the
    light, groups, Ruqaa brand), top bar, dock, sheets, menus and toasts; the content area uses the width (up to 1320px).
  - The home in the preview's layout, with real data only: the greeting (Cairo date, صباح/مساء الخير يا …, what waits, quick
    adds), the tiles of what waits, the numbers (news shown, the next two weeks, the bell, games — from the draft; no made-up
    figures), the site's publish state, the next meeting (day tile, topic in Ruqaa) beside the quick actions, the bell,
    «جاي قريب»; on the side who is here now and the latest activity.
  - The preview's map: «الشباب» and «الحجوزات والفلوس» are areas of their own (rail, dock, palette); their screens stay
    where the modules put them and every old link lands on the new area (`A.go('pages', 'bookings')`, `A.onTab`); the
    preview's area names (الفعاليات والصفحات · الصور والملفات · سجل النشاط).
  - Media library: the preview's tiles, the image at full size (lightbox), «اختيار» to move several to «المحذوفة» at once
    (used ones are skipped; restorable; «تراجع» right after).
  - Payment numbers as cards with a mark per method (a generic wallet; InstaPay as an instant-transfer mark in the panel's
    colours — the brand's own logo is not drawn without its official asset); money in tabular digits.
  - Fixed on the way: toasts readable on the new surfaces; past timeline rows readable (axe AA: no faded blocks).
  - Tests: the suites follow the new map (bookings and youth as areas, the dock's order, a solid editor sheet); every admin
    suite: the same failures as `main`, none new; axe clean in both themes.
  - **Next, needs the owner's word (it changes the public site and the content data):** §22.1 item 11, «صورة أو أيقونة» in
    every content image field (about 20 editors) with the icon tile on the public pages. Also waiting: `PERMS_ENFORCE`,
    `GAMES_MODULE`, the test-data rule (item 21).
