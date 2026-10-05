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

| I want to…                              | Where                                        |
| --------------------------------------- | -------------------------------------------- |
| add / edit / hide / reorder a link      | **الروابط**                                   |
| show a link only between two dates      | edit the link → *يبدأ يظهر من* / *آخر ظهور*  |
| mark a link «جديد»                       | edit the link → *شارة*                        |
| change the meeting day, time or duration | **الاجتماع والمكان**                          |
| cancel one week's meeting               | **الاجتماع والمكان** → *أيام مفيهاش اجتماع*   |
| change the location or map link         | **الاجتماع والمكان**                          |
| post an announcement with an end date   | **الإعلان**                                   |
| change phone numbers or contacts        | **التواصل**                                   |
| change the name / tagline / share text  | **الإعدادات**                                 |
| make it live                            | **راجع وانشر** → check the list → **نشر التغييرات** |

Changes appear on the site about a minute after publishing.

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
| `npm run e2e`                          | Headless Chrome: accessibility (axe), layout, CSP, QR decode, tampering |
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
