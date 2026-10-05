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
| ≥ 1024px   | 12 columns: hero 5 + meeting 7, featured 7 + location 5, contact 7 + support 5 |

A widget whose partner is missing takes the full row (`data-wide`).
Safe-area insets are respected; there's no horizontal scroll at 360px.

## Motion

- Staggered widget entrance (65ms steps, expo-out), once.
- One-time heart beat and gold sheen on the featured card; again on hover.
- Map pin ripple (three times, then still). Live dot pulses only while the
  meeting is live.
- Background gold glow drifts very slowly.
- Press feedback: scale 0.97 on tap.
- `prefers-reduced-motion`: all of it off.
- No sounds.

## Components

| Component        | Notes                                                        |
| ---------------- | ------------------------------------------------------------ |
| Meeting widget   | Ruqaa headline, the day and time in a sentence, a 7-day strip from today to the meeting, add-to-calendar (Google, or `.ics` for iPhone/Outlook) |
| Announcement     | Three tones: info (gold), alert (carmine), celebrate (gold sparkle) |
| Featured service | Arch art, title, one line, gold CTA pill; the whole card is one tap target |
| Location         | Stylized map (hills, coast, Red Sea, pin), name and address, Maps / directions / an on-demand real map |
| Link section     | Tiles (app icons) and/or rows (icon, title, description, arrow) |
| Contact          | Arch initial, name, role, a full-width call button showing the number |
| Support          | Smaller, muted; WhatsApp button with a ready message         |
| Share            | Native share sheet or copy link; branded QR card (download as PNG) |
