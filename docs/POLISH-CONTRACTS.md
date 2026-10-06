# Final Polish — frozen contracts (Phase 0)

Both agents build on branch `polish/base`. These interfaces are **frozen**:
changing one needs the coordinator. Recovery point: tag
`pre-polish-2026-10-06` / branch `backup/pre-polish` (= live `396f6c3`,
Apps Script deployment @11).

## 1. Data (schema 4, additive, already implemented in Phase 0)

| Sheet | New column | Published as | Notes |
|---|---|---|---|
| Contacts | `image` (media id) | `contacts[].image` = image object `{src, thumb, w, h, alt, color?}` | only for published people |
| Contacts | `intro` | `contacts[].intro` (≤ 80) | service: invitation line («عندك سؤال أو محتاج تتكلم؟»); support: the visitor's bubble («معايا مشكلة») |
| Contacts | `reply` | `contacts[].reply` (≤ 200) | support: the reply bubble |
| Links | `gallery` (comma separated media ids, ≤ 6) | `links[].gallery` = image objects | only when the link has an experience and is published |

Empty fields are **left out** of content.json (no key). The site must have
sensible defaults when they are missing (older content, live today).
`apiSaveContact` / `apiSaveLink` only write these fields when the input
contains them (`!== undefined`), so an editor that doesn't send them never
wipes them. `DATA_SCHEMA_VERSION = 4`; on the live Sheet (schema 3) the plan is
exactly: `columns: Links: gallery — Contacts: image, intro, reply`
(tests/migrate.test.mjs, `schema3World`).

## 2. Experience registry (`assets/js/platforms.js`)

- `PLATFORMS[key] = { scene, icon, hosts, accent, label, cta, line, sub }`
- `SCENES`: `voice facebook instagram tiktok whatsapp feed stories vertical chat player music map call mail browser`
- `resolveExperience({ experience, icon, url })`: explicit key (`none` = off,
  `auto`/'' = infer) → icon → URL host/path → `''` (plain websites open
  directly; `web` = the generic scene, only when chosen).
- `experienceKey(value)`: `^[a-z][a-z0-9-]{0,23}$`. Unknown-but-valid keys
  are kept: the site shows the generic branded scene.
- `apps-script/Platforms.gs` is **generated** (`cd tools && npm run sync`);
  tests fail if it is stale. Server functions: `experienceKey_`,
  `resolveExperience_`, `linkExperiences_()` (the admin choices).
- The registry is **not** in the first page load (content.js has its own
  one-line key check). Load it with the scenes (dynamic import).

## 3. Site interfaces

- `xp.js` exports `hasScene(key)`. render.js / main.js only route a link to a
  scene when it is true; otherwise the link opens directly. **Agent B** makes
  it true for every valid key (registry scenes + generic fallback).
- `openExperience(link, context, onClose)`, `prepareExperience(key)`: unchanged
  signatures (main.js calls them).
- Scene module contract (`assets/js/xp/<scene>.js`):
  `play(stage, { quick, reduced, lite, content, sound, link, platform })`
  → `{ stop() }`. `platform` = the registry entry (accent, label, words);
  `link` = the published link (title, subtitle, url, icon, gallery).
- The featured card («صوتك يهمنا») must route through the same `linkAttrs`
  as tiles (**Agent A**, render.js), so `experience: 'voice'` opens the voice
  scene (**Agent B**, `xp/voice.js`).
- Motion tiers: `document.documentElement.dataset.motion` = `full | lite | reduced`
  (feel.js). Scenes and contact animations must honour all three.

## 4. File ownership (do not edit the other agent's files)

| Agent A — public page | Agent B — experiences, data, admin |
|---|---|
| `index.html` | `assets/js/xp.js`, `assets/js/xp/*` (new), `assets/css/xp.css` |
| `assets/css/main.css` (all of it) | `assets/js/platforms.js` (+ regenerate Platforms.gs) |
| `assets/js/render.js`, `hub.js`, `items.js`, `sheet.js`, `feel.js` | `assets/js/icons.js` (+ `npm run sync`), `assets/js/content.js` |
| `assets/js/main.js` (top bar part only) | `apps-script/*.gs`, `apps-script/Admin*.html` |
| fonts / page weight | `admin/` (the gateway, own CSS/JS) |
| new tests: `tests/polish-a.*` | new tests: `tests/polish-b.*`, `tests/platforms.test.mjs` |

Shared and frozen: `tools/demo.mjs`, `tests/fakes/*`, `docs/POLISH-CONTRACTS.md`.
Need a change there? Ask the coordinator. Existing test files: only touch the
assertions your own change makes obsolete, and say so in the commit.

## 5. Demo and checks

- `cd tools && node demo.mjs` (add `--banners` for a banner on every section),
  then `node serve.mjs <port> --demo`.
- The demo has: a support avatar + intro + reply, a service intro, Telegram /
  YouTube / Spotify links (auto), a chosen generic scene (`web`), Instagram
  scene photos, posters wide / square / very tall / portrait / none.
- Page weight: the budget (230 KB compressed, code + fonts + site images; the
  admin's posters are reported separately) is **0.9 KB over** after Phase 0.
  Agent A brings it under (the Latin Cairo subset, 33 KB, loads on every
  visit because its range includes the space). Agent B adds nothing to the
  first load (scenes, registry, xp.css stay lazy). The budget is not raised.
- Before handing back: `cd tools && npm test` and the e2e files you touched;
  commit on your branch; **no push, no clasp, no deploy, no live Sheet.**

## 6. Change 8 reference («صوتك يهمنا»)

- Video: `D:\private_projects\your-voice-matters-main\videos\your-voice-matters-9x16-v3.mp4` (16x9 next to it)
- Source of that video (HTML/CSS, same motion): `D:\private_projects\your-voice-matters-main\video\scene.html`, `timeline.json`
- Assets: `D:\private_projects\your-voice-matters-main\res\` (logo, banner). That repo is **read-only**.
- CTA: «ابعت صوتك» → the link's own URL (`/your-voice-matters/`).
