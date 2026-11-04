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
