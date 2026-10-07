# Design

**Direction:** a home-screen "widget hub" for structure, modern Coptic
material and geometry for identity, and a quiet Red Sea touch around the
location.

Scene: a teenager in Safaga scans a poster or taps a bio link, usually in
the evening, on a mid-range Android phone. That's why the page is dark
navy, low glare, and has gold for what matters.

## Color

Family colors shared with صوتك يهمنا. Strategy: **committed** (navy carries
the surface; gold is the identity accent).

| Token          | Value     | Use                                         |
| -------------- | --------- | ------------------------------------------- |
| `--ink`        | `#020914` | page base                                   |
| `--navy-900`   | `#061a31` | widget surface                              |
| `--navy-800/700` | `#0b2a4c` / `#12385f` | raised surfaces, app icons       |
| `--gold`       | `#d7aa50` | primary actions, the meeting day            |
| `--gold-hi`    | `#f2d28b` | display text (name, meeting headline)       |
| `--text` / `--text-2` / `--text-3` | `#f5f7fb` / `#b9c5d5` / `#8d9db3` | body, secondary, tertiary (all ≥ 4.5:1 on navy) |
| `--sea`        | `#4cc3cb` | **location only** (Red Sea)                 |
| `--carmine`    | `#c8433a` | from the robe in the icon: alerts, "live", «جديد» |

Brand colors (Facebook blue, Instagram gradient, TikTok black) appear only
inside their app icons.

## Type

- **Aref Ruqaa** (700): the official name, the meeting headline, contact
  initials. Ruqaa is the hand of Egyptian signage and of the logo's own
  lettering; it makes the page feel local and churchly without ornament.
- **Cairo** (400–800, variable): everything else. It's the family's UI
  face.
- Both self-hosted (woff2, Arabic and Latin subsets). Body line-height 1.75
  for Arabic.

## Shapes and material

- **Arches:** the logo stands in an iconostasis-style door (double gold
  hairline, small cross on top). The featured-service art and the contact
  avatars repeat the arch at smaller sizes.
- **Coptic cross lattice:** faint gold pattern behind the hero, fading out.
- **Widgets:** 24px radius, 1px gold hairline, subtle top highlight. No
  glassmorphism, no side stripes, no gradient text.
- **App icons:** 54px rounded squares, the home-screen idiom, for social
  links and other tile-style links.

## Layout

| Width      | Grid                                  |
| ---------- | ------------------------------------- |
| < 640px    | one column, in priority order         |
| 640–1023px | two columns; featured + location side by side, contact + support side by side |
| ≥ 1024px   | 12 columns. The opening is one composition: the identity (logo in the arch, Ruqaa name) and the meeting share a lit full-bleed stage. Then: featured 7 + location 5, contact 6 + support 6 (a matched pair); icon-only link groups and the share band sit open (no box); news is one row (a rail) |

A widget whose partner is missing takes the full row (`data-wide`). Section
order always comes from content.json `layout`.
Safe-area insets are respected; there's no horizontal scroll at 360px.

## Motion: "motion graphics implemented as UI"

Built on CSS and the Web Animations API (no library, about 2.5 KB gzipped).
Springs are real physics curves (k=170 c=20 and k=260 c=16) expressed with
CSS `linear()`, falling back to a cubic-bezier where unsupported.

| Layer / moment     | Motion                                                        |
| ------------------ | ------------------------------------------------------------- |
| Background         | Gold glow drifting very slowly; the cross lattice moves slower than the page on scroll (parallax, where scroll-driven animation is supported) |
| Intro (first visit in a session, ≤ 2.7 s) | Not an overlay: the real hero is staged. The logo comes out of the dark at the centre in a blooming light, the name writes in, then the identity glides into its exact place, the arch draws, the cross drops and the page assembles around it. Any tap/key/scroll fast-forwards; skipped on repeat visits, deep links, reduced motion, weak devices and in the admin preview (assets/js/intro.js) |
| Hero, on arrival (repeat visits) | The arch reveals upward, the logo springs in, the cross drops in, the name and tagline rise out of a soft blur; about 20 drifting gold dust particles |
| Hero, on scroll    | Recedes slightly (moves up, scales to 96%, fades) as you scroll past |
| Widgets            | Enter in priority order with depth (rise + scale from 95.5%), 70 ms apart, once |
| Taps               | Spring press (scale down fast, spring back); app icons tilt     |
| Featured card      | One gold sheen and heart beat on arrival; again on hover        |
| Meeting goes live  | A one-time glow; the live dot pulses while it's live            |
| Game opens         | The card "wakes up": a one-time ignition, then a slow rotating gold rim and rising embers while it's open |
| Countdowns         | Changed text rolls out and in instead of jumping                |
| Bell               | Swings once (damped) when something new arrives; the badge springs in. Never loops |
| Sheets (bell, news, game, meeting) | Slide up with a spring; drag down to dismiss; the list inside staggers in 40 ms apart |
| Top bar            | Follows the scroll continuously (scroll-driven where supported): a surface made of the page's own navy and light that feathers out below the bar (no slab, no hard edge), blur (full tier), a soft gold glow line, buttons settling; the compact name glides in as the hero name passes under it. Never changes height |
| Support chat       | Loops calmly while on screen (≈ 4.4 s): visitor → seen → typing → reply → reaction → pause → fade. Paused off-screen and in hidden tabs; once in the lite tier; still under reduced motion |
| Scrollbars (mouse/trackpad) | Slim navy/gold, the same tokens on the site, its sheets and the admin; touch keeps native scrollbars |

Rules:

- Only transform, opacity and filter are animated.
- At most one continuous animation per visible card. Particles pause
  off-screen and in background tabs, and are skipped on very low-end devices.
- Not animated: reading text, phone/WhatsApp buttons, the QR card, the real map.
- `prefers-reduced-motion`: no movement at all (no particles, no rim, no
  intro, no parallax). States still change, just instantly.

## Sound

Optional UI sounds, synthesized with Web Audio (zero downloads). **Silent by
default**; the 🔇/🔊 button in the top bar turns them on, and the choice is
remembered on that device. No audio is created until the visitor turns it on.

| Sound     | When                         | Character                         |
| --------- | ---------------------------- | --------------------------------- |
| tap       | buttons and cards            | a 35 ms soft click                |
| open / close | sheets                     | a glassy whoosh up / down         |
| success   | link copied, sound turned on | two-note major third              |
| ready     | a game opens while you watch | warm four-note rising arpeggio with shimmer |
| important | an "important" notification arrives while you watch | one low bell with a quiet harmonic |

Sounds never play in a hidden tab. Sounds not caused by a tap ("ready",
"important") play only if audio was already unlocked by an earlier tap.

## Components

| Component        | Notes                                                        |
| ---------------- | ------------------------------------------------------------ |
| Meeting widget   | Ruqaa headline, the day and time in a sentence, a 7-day strip from today to the meeting, add-to-calendar (Google, or `.ics` for iPhone/Outlook) |
| Announcement     | Three tones: info (gold), alert (carmine), celebrate (gold sparkle) |
| Featured service | Arch art, title, one line, gold CTA pill; the whole card is one tap target |
| Location         | Stylized map (hills, coast, Red Sea, pin), name and address, Maps / directions / an on-demand real map |
| Link section     | Tiles (app icons) and/or rows (icon, title, description, arrow) |
| Contact          | Matched pair with Support: head (arch initial or photo, name, role), a stage of equal height, the action at the bottom. Service: a phone ringing softly (waves), the invitation line (intro), a full-width call button showing the number |
| Support          | A short WhatsApp-style chat (intro → typing → reply with the avatar → read ticks, a reaction), played once when scrolled into view, then resting; a quieter WhatsApp button with a ready message |
| Share            | Native share sheet or copy link; branded QR card (download as PNG) |
| Top bar          | Sticky, full-bleed surface, content at the page width: compact name after scrolling, sound toggle, bell with badge (Arabic digits, "+٩" cap) |
| Poster hero      | Top of every detail sheet: the poster's own ratio, height-capped, never cropped; the space around unusual shapes is the poster blurred (full tier) or a light in its colour; tap opens a full-resolution viewer |
| Section banner   | Any section can carry the admin's banner on top of its first widget (one place in render.js) |
| Meeting topic    | Inside the meeting widget: arch poster, «موضوع الاجتماع», the topic in Ruqaa, the speaker; opens the meeting sheet with upcoming meetings |
| Pinned banner    | A pinned news item in the announcement style (replaces the old single announcement) |
| «جديد الأسرة»     | A featured poster card, then a swipeable row of cards (a grid on desktop); each opens a sheet with the full poster, text, link and share |
| Games            | Cards with state: «قريبًا» (locked button + countdown), «اللعبة جاهزة دلوقتي 🔥» (moves up under the meeting as the live card), «انتهت» (muted) |
| Bell panel       | Grouped by النهارده / امبارح / الأسبوع ده / أقدم; type icons (important in carmine); unread dots; poster thumbnails |
| Meeting program  | While the meeting runs: «دلوقتي» (bold) and «بعدها» (with its time while it is still ahead) in two fixed rows under the countdown; one quiet «أول حاجة» line earlier that day; nothing after. A soft roll on a change in the full tier only. The meeting sheet lists the whole program, the stage on now in a gold-lit row |
| Surfaces («شكل الخلفية») | Per section, and per section on phones: glass (see-through, a soft hairline, frosted in the full tier only), dark (one solid deep navy), filled (the featured card's light), none (no box). Unset = the usual look |
| Location on phones | A narrow card (≤ 380px) lets its buttons flow: Google Maps full width, then directions + the one map toggle (both labels share one cell, so it never changes size); the real map is 5:4 and exactly as wide as the card |
