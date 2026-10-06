# أسرة البابا أثناسيوس لخدمة شعب كنيستها الحبيبة في سفاجا

The official link for the youth meeting at the Church of St. Abu Sefein,
Safaga. One address for QR codes, social bios, posters and videos. It shows
the next meeting, the location, صوتك يهمنا, our social pages, and who to
contact.

- **Public site:** static page on GitHub Pages. Arabic, right-to-left, built
  for phones, no framework, no trackers.
- **Admin:** a Google Apps Script web app backed by a private Google Sheet.
  Edits are drafts until **نشر التغييرات** commits `content.json` to this
  repository.

| Read this                                        | For                                          |
| ------------------------------------------------ | -------------------------------------------- |
| [docs/ADMIN-SETUP.md](docs/ADMIN-SETUP.md)       | First-time setup and deployment (step by step) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)     | How it works, data model, security           |
| [PRODUCT.md](PRODUCT.md), [DESIGN.md](DESIGN.md) | Who it's for, visual system                  |

## Everyday use

Everything is done from the admin panel (the Apps Script web app URL), on
a phone or a computer:

| I want to…                                   | Where                                              |
| -------------------------------------------- | -------------------------------------------------- |
| see everything coming up, by day             | **الجدول**                                          |
| set next Sunday's topic, speaker, poster     | **المحتوى → الاجتماعات** → *+ اجتماع*               |
| cancel one week / move it to another time    | same meeting → *ملغي الأسبوع ده* / *الساعة*        |
| change the weekly day, time or duration      | **المحتوى → الاجتماعات** → *الميعاد الأسبوعي*        |
| post news or a poster, now or scheduled      | **المحتوى → الأخبار**                               |
| pin an important banner (e.g. "مفيش اجتماع") | a news item → *مثبت كشريط فوق*                      |
| prepare a game that opens at a set time      | **المحتوى → الألعاب** (with "15 min before" / "at start" alerts) |
| add something to the bell 🔔                  | **الإشعارات**, or the checkbox in any meeting, news or game |
| add / edit / hide / reorder a link           | **الصفحة → الروابط**                                |
| change the location or map link              | **الصفحة → المكان**                                 |
| change phone numbers or contacts             | **الصفحة → التواصل**                                |
| change the name / tagline / share text       | **الإعدادات**                                        |
| make it live                                 | **راجع وانشر** → check the list → **نشر التغييرات** |

Changes appear on the site about a minute after publishing. Anything with a
future time (news, topics, games, bell items) can be published early: the site
shows it, opens it or hides it on time by itself, in Egypt time.

## Repository layout

```
index.html             page shell (CSP, Open Graph, static hero)
content.json           published content   ← written by the admin
meeting.ics            weekly meeting for calendars ← written by the admin
assets/css, js, fonts, img, vendor
apps-script/           admin (copy into the Apps Script project)
tools/                 dev tooling (not deployed)
tests/                 unit, admin end-to-end, browser end-to-end
docs/                  setup + architecture
```

## Development

Requires Node 18+ and Chrome or Edge (for the asset render and browser
tests).

```bash
cd tools
npm install
```

| Command                                | Does                                                   |
| -------------------------------------- | ------------------------------------------------------ |
| `npm run serve`                        | Public site at <http://localhost:4321/>                |
| `node admin-preview.mjs`               | Admin panel at <http://localhost:4322/>, real `.gs` code on a fake Sheet and fake GitHub |
| `npm test`                             | Content model, schedule, admin/auth/publishing tests   |
| `npm run e2e`                          | Headless Chrome: accessibility (axe), layout, CSP, QR decode, tampering, bell, deep links, wrong device clock, sound, reduced motion |
| `npm run demo`, then `node serve.mjs 4321 --demo` | The site with demo meetings, news (posters), games in every state and notifications, built through the real admin code |
| `npm run assets`                       | Rebuild logo sizes, icons, Open Graph image            |
| `npm run seed`                         | Regenerate `content.json` + `meeting.ics` from `apps-script/Seed.gs` |
| `npm run sync`                         | Regenerate the admin's icon file after changing icons  |
| `npm run set-url -- https://…/`        | Change the permanent public URL in the page tags       |

After changing anything in `apps-script/`, paste it into the Apps Script
project and deploy a new version (see the setup guide).

## Credits

- Logo: the service's own (from `your-voice-matters`).
- Fonts: [Cairo](https://fonts.google.com/specimen/Cairo) and
  [Aref Ruqaa](https://fonts.google.com/specimen/Aref+Ruqaa) (SIL Open Font
  License), self-hosted.
- Brand icons: [Simple Icons](https://simpleicons.org) (CC0).
- QR encoder: [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)
  by Kazuhiko Arase (MIT).
