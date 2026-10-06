# مثال: البيانات زي ما هي في الشيت

ملف متولّد من `tools/build-example.mjs` — ده نفس المحتوى اللي في
[content.example.json](content.example.json)، بس على هيئة صفوف في تبويبات الشيت.
الخانة اللي فيها ⏎ معناها سطر جديد جوه نفس الخانة.

## Settings (الإعدادات — المهم منها)

| key | value |
| --- | --- |
| site.name | أسرة البابا أثناسيوس لخدمة شعب كنيستها الحبيبة في سفاجا |
| site.tagline | كل اللي يخصّ اجتماعنا… في مكان واحد |
| site.shareText | كل حاجة تخص اجتماعنا في كنيسة أبي سيفين – سفاجا في لينك واحد |
| meeting.enabled | true |
| meeting.title | اجتماع الشباب |
| meeting.day | الأحد |
| meeting.time | 20:00 |
| meeting.durationMinutes | 120 |
| meeting.note |  |
| meeting.skipDates |  |
| location.name | كنيسة أبي سيفين – سفاجا |
| location.address | سفاجا، البحر الأحمر |
| location.note |  |
| location.mapsUrl | https://maps.app.goo.gl/eCUtm5AftfTzSXmV7 |
| location.lat | 26.7314392 |
| location.lng | 33.9379229 |

## Sessions (الاجتماعات)

| date | enabled | time | topic | speaker | description | image | status | note | visibleFrom |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-11 | true |  | حياة التسليم | أبونا أنطوني عياد | إزاي نسلّم حياتنا لربنا في كل تفصيلة، من غير خوف ولا قلق. | img-topic011 | normal |  | 2026-10-08 20:00 |
| 2026-10-18 | true |  |  |  |  |  | cancelled | علشان مؤتمر الشباب |  |

## News (الأخبار)

| id | enabled | featured | pinned | tone | title | summary | body | image | linkUrl | linkLabel | badge | publishAt | expireAt |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| news-trip2026 | true | true | false | info | رحلة الغردقة | يوم كامل على البحر — سجّل اسمك قبل الخميس | الرحلة يوم الجمعة ١٦ أكتوبر.⏎ التجمع ٧ الصبح عند الكنيسة.⏎ ⏎ الاشتراك ٢٠٠ جنيه شاملة الأكل والمواصلات. | img-trip2026 | https://forms.gle/your-form-id | سجّل هنا | جديد | 2026-10-08 20:00 | 2026-10-15 |
| news-nomeeting18 | true | false | true | alert | مفيش اجتماع الأحد ١٨ أكتوبر | علشان مؤتمر الشباب — نتقابل الأحد اللي بعده |  |  |  |  |  | 2026-10-12 10:00 | 2026-10-18 |

## Games (الألعاب)

| id | enabled | title | description | image | url | buttonLabel | visibleFrom | startAt | endAt | afterEnd |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| game-explore | true | رحلة الاستكشاف في الكنيسة | دوّر على الأماكن المخفية في الكنيسة وجاوب على الأسئلة قبل الوقت ما يخلص. | img-explore1 | https://example.com/church-explorer | ابدأ اللعب | 2026-10-11 21:00 | 2026-10-11 22:00 | 2026-10-11 23:30 | show |

## Notifications (الإشعارات)

| id | enabled | type | title | message | target | image | publishAt | expireAt |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| notif-session-2026-10-11 | true | meeting | موضوع الاجتماع الجاي | حياة التسليم — أبونا أنطوني عياد | meeting | img-topic011 | 2026-10-08 20:00 | 2026-10-11 23:59 |
| notif-news-trip2026 | true | news | رحلة الغردقة | يوم كامل على البحر — سجّل اسمك قبل الخميس | news:news-trip2026 | img-trip2026 | 2026-10-08 20:00 | 2026-10-15 |
| notif-game-explore-soon | true | game | استعدوا 👀 | تحدي «رحلة الاستكشاف في الكنيسة» هيبدأ بعد ١٥ دقيقة | game:game-explore |  | 2026-10-11 21:45 | 2026-10-11 23:30 |
| notif-game-explore-start | true | game | 🔥 اللعبة جاهزة! | «رحلة الاستكشاف في الكنيسة» — ادخل دلوقتي وابدأ التحدي | game:game-explore |  | 2026-10-11 22:00 | 2026-10-11 23:30 |

## Media (الصور)

| id | path | thumb | width | height | alt |
| --- | --- | --- | --- | --- | --- |
| img-topic011 | media/2026/img-topic011.webp | media/2026/img-topic011-480.webp | 1200 | 1500 | بوستر موضوع حياة التسليم |
| img-trip2026 | media/2026/img-trip2026.webp | media/2026/img-trip2026-480.webp | 1200 | 1500 | بوستر رحلة الغردقة |
| img-explore1 | media/2026/img-explore1.webp | media/2026/img-explore1-480.webp | 1600 | 900 | بوستر رحلة الاستكشاف في الكنيسة |
