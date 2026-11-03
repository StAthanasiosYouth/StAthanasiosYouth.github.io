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
