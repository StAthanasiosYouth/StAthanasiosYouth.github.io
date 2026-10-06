/**
 * CHAT family: Telegram (a channel), Messenger (a conversation), Discord
 * (a server channel), and any future chat platform (a channel in its
 * registry accent). One renderer, three layouts, skinned by the registry
 * (accent, icon, label).
 *
 * Entrance: the app opens, (Telegram) a paper plane flies through, the
 * first messages land. Alive: someone types, new messages arrive (the
 * oldest scrolls away), views and reactions tick; reactions and bubbles
 * drift in from the edges. Message shapes only, no real chats; the one
 * readable message is the real meeting time from the page.
 * Our own interpretation, not the apps' interfaces.
 */

import { h } from '../dom.js';
import { iconNode } from '../icons.js';
import { timeline, edge, media, lines, rand, pick, digits, compact, meetingLine, LOGO, EASE, SPRING } from './kit.js';

const LAYOUT = { telegram: 'channel', messenger: 'dm', discord: 'server' };
const REACTIONS = ['❤️', '👍', '🙏', '🔥', '😂', '👏'];
const NAME = 'أسرة البابا أثناسيوس';

/* ---------- messages ---------- */

function reactions(list) {

  return h('span', { class: 'ch-reacts' }, list.map(([emoji, n]) => h('span', { class: 'ch-react' }, emoji, h('b', { 'data-n': n }, digits(n)))));

}

/* a channel post (Telegram-like): optional photo, text lines, views */
function post({ src, text, views, reacts, n = 2 }) {

  return h('div', { class: 'ch-msg ch-msg--post' },
    src ? h('span', { class: 'ch-msg__photo' }, h('img', { src, alt: '' })) : null,
    text ? h('span', { class: 'ch-msg__text' }, text) : lines(n),
    h('span', { class: 'ch-msg__meta' }, h('span', { class: 'ch-views' }, '👁 ', h('b', { 'data-n': views }, compact(views))), h('span', { class: 'ch-time' })),
    reacts ? reactions(reacts) : null
  );

}

/* a conversation bubble (Messenger-like) */
function bubble(out, n = 2) {

  return h('div', { class: `ch-msg ch-msg--${out ? 'out' : 'in'}` }, lines(n));

}

/* a server message (Discord-like): avatar, a name line, text lines */
function said(n = 2, tone = 0) {

  return h('div', { class: 'ch-msg ch-msg--said' },
    h('span', { class: `ch-avatar ch-avatar--${tone}` }),
    h('span', { class: 'ch-said' }, h('span', { class: 'ch-said__name' }, h('i')), lines(n))
  );

}

function typingDots(className = '') {

  return h('div', { class: `ch-msg ch-typing ${className}` }, h('i'), h('i'), h('i'));

}


export function play(stage, { quick, reduced, lite, content, sound, link, platform }) {

  const tl = timeline({ quick, reduced, lite });
  const layout = LAYOUT[platform.key] || 'channel';
  const glyph = platform.icon || (link.icon !== 'link' ? link.icon : 'users');
  const pics = media(link, content, 2);

  const feed = h('div', { class: 'ch-feed' });
  const typing = typingDots(layout === 'server' ? 'ch-typing--server' : '');
  let messages;

  if (layout === 'channel') {
    messages = [
      post({ src: pics[0], views: 1180, n: 2 }),
      post({ text: meetingLine(content), views: 964, reacts: [['❤️', 42], ['🙏', 17]] }),
      post({ views: 312, n: 1 })
    ];
  }
  else if (layout === 'dm') {
    messages = [bubble(false, 2), bubble(true, 1), bubble(false, 1), h('div', { class: 'ch-msg ch-msg--in ch-msg--text' }, meetingLine(content, 'أهلاً بيك 👋'))];
  }
  else {
    messages = [said(2, 1), said(1, 2), h('div', { class: 'ch-msg ch-msg--said' }, h('img', { class: 'ch-avatar', src: LOGO, alt: '' }), h('span', { class: 'ch-said' }, h('span', { class: 'ch-said__name ch-said__name--us' }, NAME), h('span', { class: 'ch-msg__text' }, meetingLine(content)), reactions([['🔥', 9], ['🙏', 6]])))];
  }

  feed.append(...messages);

  const head = h('div', { class: 'ch-top' },
    layout === 'server' ? h('span', { class: 'ch-top__hash' }, '#') : h('img', { class: 'ch-top__avatar', src: LOGO, alt: '' }),
    h('span', { class: 'ch-top__text' },
      h('span', { class: 'ch-top__name' }, layout === 'server' ? 'العامة' : NAME),
      h('span', { class: 'ch-top__sub' }, layout === 'dm' ? h('span', { class: 'ch-online' }, 'نشط دلوقتي') : layout === 'server' ? 'أسئلة وأنشطة وكلام' : `قناة · ${compact(1240)} مشترك`)
    ),
    h('span', { class: 'ch-top__glyph' }, iconNode(glyph))
  );

  const rail = layout === 'server'
    ? h('div', { class: 'ch-rail' }, h('img', { src: LOGO, alt: '' }), h('span', { class: 'ch-rail__dot' }, '#'), h('span', { class: 'ch-rail__dot' }, '🎵'), h('span', { class: 'ch-rail__dot' }, '+'))
    : null;

  const bar = h('div', { class: 'ch-bar' },
    h('span', { class: 'ch-bar__field' }, layout === 'channel' ? 'كتم الصوت' : 'اكتب رسالة…'),
    h('span', { class: 'ch-bar__send' }, iconNode(layout === 'channel' ? 'bell' : glyph))
  );

  const phone = h('div', { class: `xp-phone ch ch--${layout} ch--${platform.key}` },
    rail,
    h('div', { class: 'ch-main' }, head, h('div', { class: 'ch-scroll' }, feed, typing), bar)
  );

  stage.append(phone);

  /* ---------- entrance ---------- */

  tl.from(phone, [{ transform: 'translateY(26px) scale(.96)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 620, easing: SPRING });

  if (layout === 'channel') {
    // the paper plane flies through
    const plane = h('span', { class: 'ch-plane' }, iconNode(glyph));
    phone.append(plane);
    plane.classList.add('is-done');
    tl.from(plane, [
      { transform: 'translate(-120px, 150px) rotate(-10deg) scale(.6)', opacity: 0 },
      { transform: 'translate(-20px, 30px) rotate(-4deg) scale(1)', opacity: 1, offset: 0.4 },
      { transform: 'translate(80px, -60px) rotate(6deg) scale(.9)', opacity: 1, offset: 0.75 },
      { transform: 'translate(160px, -160px) rotate(12deg) scale(.6)', opacity: 0 }
    ], { duration: 1300, delay: 250, easing: 'cubic-bezier(.4, 0, .3, 1)' });
    tl.at(500, () => sound('open', { passive: true }));
  }

  typing.classList.add('is-done');
  tl.from(typing, [{ opacity: 1 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }], { duration: 900, delay: 300 });

  messages.forEach((message, i) => {
    const out = message.classList.contains('ch-msg--out');
    const at = 700 + i * (quick ? 260 : 520);
    tl.from(message, [{ opacity: 0, transform: `translate(${out ? 16 : -16}px, 10px) scale(.94)` }, { opacity: 1, transform: 'none' }], { duration: 440, delay: at, easing: SPRING });
    tl.at(at, () => sound(out ? 'tap' : 'pop', { passive: true }));
  });

  messages.forEach(message => message.querySelectorAll('.ch-react').forEach((r, i) => {
    tl.from(r, [{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1.25)', opacity: 1, offset: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 480, delay: 2300 + i * 180, easing: EASE });
  }));

  /* ---------- alive ---------- */

  const settled = 3200;

  // new messages; the feed keeps the newest few
  tl.ambient(feed, {
    every: 3800, max: 4, recycle: true, delay: settled, name: 'ch-msg',
    make: () => h('div', { class: 'ch-msg' }),
    spawn: (node, n) => {
      let next;
      if (layout === 'channel') next = post({ src: n % 3 === 1 ? pics[1] : null, views: Math.round(rand(80, 400)), n: n % 2 ? 1 : 2 });
      else if (layout === 'dm') next = bubble(n % 3 === 0, n % 2 ? 1 : 2);
      else next = said(n % 2 ? 1 : 2, n % 3);
      node.className = `${next.className} xp-amb`;
      node.replaceChildren(...next.childNodes);
      feed.append(node);
      const shown = [...feed.children];
      shown.slice(0, Math.max(0, shown.length - 5)).forEach(old => { if (!old.classList.contains('xp-amb')) old.remove(); });

      const out = node.classList.contains('ch-msg--out');
      sound(out ? 'tap' : 'pop', { passive: true });
      if (!out && typing.animate) typing.animate([{ opacity: 1 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: 900 });
      return node.animate([{ opacity: 0, transform: `translate(${out ? 16 : -16}px, 12px) scale(.94)` }, { opacity: 1, transform: 'none' }], { duration: 460, delay: out ? 0 : 700, fill: 'backwards', easing: SPRING });
    }
  });

  // views and reactions tick on the newest messages
  tl.every(1700, () => {
    const views = [...feed.querySelectorAll('.ch-views b')].slice(-3);
    if (views.length) {
      const view = pick(views);
      const value = Number(view.dataset.n || 300) + Math.round(rand(1, 6));
      view.dataset.n = String(value);
      view.textContent = compact(value);
    }
    const reacts = [...feed.querySelectorAll('.ch-react b')];
    if (reacts.length && Math.random() < 0.6) {
      const r = pick(reacts);
      const value = Number(r.dataset.n || 10) + 1;
      r.dataset.n = String(value);
      r.textContent = digits(value);
      if (r.parentNode.animate) r.parentNode.animate([{ transform: 'scale(1.25)' }, { transform: 'none' }], { duration: 320, easing: EASE });
    }
  }, { delay: settled + 600 });

  // (B) from the edges
  edge(tl, stage, {
    every: 1400, max: 5,
    items: () => (Math.random() < 0.4
      ? { node: h('span', { class: `xp-bubble xp-bubble--chat` }, lines(Math.random() < 0.5 ? 1 : 2)) }
      : pick(REACTIONS))
  });

  return tl;

}
