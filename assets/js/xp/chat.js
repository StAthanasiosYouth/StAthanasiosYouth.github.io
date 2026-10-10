/**
 * CHAT family: Telegram (a channel), Messenger (a conversation), Discord
 * (a server channel), and any future chat platform (a channel in its
 * registry accent). One renderer, three layouts, skinned by the registry.
 *
 * Entrance: the app opens, (Telegram) a paper plane flies through, the
 * first messages land — real words: the meeting time from the page, the
 * topic, the game segment of the week, the Pope Athanasius quote.
 * The link's playlist (kit.js: the admin's own pictures and clips, in its
 * order, each with its own words): one message per item, all of them in
 * turn (a clip plays its segment first), then from the first again — a
 * channel post (Telegram), the page sending it (Messenger), our message in
 * the channel (Discord). No gallery: the channel shows the weekly posters;
 * the conversations stay words only.
 * Alive: new posts / messages (the oldest scroll away), views and
 * reactions tick, (Messenger, Discord) the visitor types and sends;
 * around the phone: paper planes and channel posts (Telegram), message
 * bubbles and reactions (the others).
 * Our own interpretation, not the apps' interfaces.
 */

import { h } from '../dom.js';
import { iconNode } from '../icons.js';
import { deck, timeline, spray, side, playlist, cycle, mediaNode, words as say, fitWords, FEED, typeInto, bubble, chip, rand, pick, digits, compact, LOGO, EASE, SPRING } from './kit.js';
import { GROUP, MINE, WHO, channelPosts } from './talk.js';

const nextGroup = deck(GROUP);

const LAYOUT = { telegram: 'channel', messenger: 'dm', discord: 'server' };
const REACTIONS = ['❤️', '👍', '🙏', '🔥', '😂', '👏'];
const NAME = 'أسرة البابا أثناسيوس';

/* an own picture or clip the admin left without words */
const GENERIC = 'من اجتماعنا 🤍 كل أحد الساعة ٨ مساءً';

/* a picture / clip in a message (its own shape, between 4:5 and 16:9) */
const photo = (item, tl, advance) => mediaNode(item, tl, { className: 'ch-msg__photo', ratio: FEED, advance });
const text = (words, lines = 8) => say(words, { className: 'ch-msg__text', lines, more: 'اقرأ المزيد' });

/* Messenger: the conversation (the page answering, the visitor asking) */
const DM = [
  [false, 'أهلاً بيك 👋 تحب تسأل عن حاجة؟'],
  [true, 'هو الاجتماع كل أحد؟'],
  [false, 'أيوه، كل أحد الساعة ٨ مساءً في كنيسة أبي سيفين ✨'],
  [true, 'تمام هاجي 🙌'],
  [false, 'هنستناك 🤍 ولو حابب هات صاحبك معاك'],
  [true, 'هو فيه ألعاب بعد الكلمة؟ 😂'],
  [false, 'أكيد 😂 الأسبوع ده «خمن الورقة» 🔥']
];

/* ---------- messages ---------- */

function reactions(list) {

  return h('span', { class: 'ch-reacts' }, list.map(([emoji, n]) => h('span', { class: 'ch-react' }, emoji, h('b', { 'data-n': n }, digits(n)))));

}

/* a channel post (Telegram-like): optional photo, words, views, time */
function post({ item = null, text: words, views, reacts, time = '٨:٠٢ م' }, tl = null, advance = false) {

  return h('div', { class: 'ch-msg ch-msg--post', 'data-item': item ? item.id : null },
    item ? photo(item, tl, advance) : null,
    text(words),
    h('span', { class: 'ch-msg__meta' }, h('span', { class: 'ch-views' }, '👁 ', h('b', { 'data-n': views }, compact(views))), h('span', { class: 'ch-time' }, time)),
    reacts ? reactions(reacts) : null
  );

}

/* a conversation bubble (Messenger-like) */
function said(out, words, item = null, tl = null, advance = false) {

  return h('div', { class: `ch-msg ch-msg--${out ? 'out' : 'in'}${item ? ' ch-msg--media' : ''}`, 'data-item': item ? item.id : null },
    item ? photo(item, tl, advance) : null,
    words ? text(words, 6) : null
  );

}

/* a server message (Discord-like): avatar, a name, words */
function line(who, words, tone = 0, us = false, item = null, tl = null, advance = false) {

  return h('div', { class: `ch-msg ch-msg--said${item ? ' ch-msg--media' : ''}`, 'data-item': item ? item.id : null },
    us ? h('img', { class: 'ch-avatar', src: LOGO, alt: '' }) : h('span', { class: `ch-avatar ch-avatar--${tone % 3}` }, who.replace('.', '')),
    h('span', { class: 'ch-said' },
      h('span', { class: `ch-said__name${us ? ' ch-said__name--us' : ''}` }, us ? NAME : who, h('i', {}, ' النهارده ٨:٠٥ م')),
      words ? text(words, 6) : null,
      item ? photo(item, tl, advance) : null
    )
  );

}

function typingDots(className = '') {

  return h('div', { class: `ch-msg ch-typing ${className}` }, h('i'), h('i'), h('i'));

}


export function play(stage, { quick, reduced, lite, content, sound, link, platform }) {

  const tl = timeline({ quick, reduced, lite });
  const layout = LAYOUT[platform.key] || 'channel';
  const glyph = platform.icon || (link.icon !== 'link' ? link.icon : 'users');
  const words = channelPosts(content);
  const all = playlist(link, { posters: 3 });
  const own = all.length > 0 && all[0].own;
  // the items this layout shows: a channel always (the posters when there is no gallery), the others only the admin's own
  const items = layout === 'channel' || own ? all : [];
  const multi = items.length > 1;
  const textOf = item => (item.own ? item.text || GENERIC : item.topic ? `📌 «${item.topic}» — كان أحد حلو، شكرًا لكل اللي جه 🤍` : item.text);
  // one message for an item, the layout's way
  const share = (item, views = 1180, time = '٧:٤٠ م') => (layout === 'channel'
    ? post({ item, text: textOf(item), views, time }, tl, multi)
    : layout === 'dm' ? said(false, item.text, item, tl, multi) : line('', item.text, 0, true, item, tl, multi));

  const feed = h('div', { class: 'ch-feed' });
  const typing = typingDots(layout === 'server' ? 'ch-typing--server' : '');
  let messages;

  if (layout === 'channel') {
    messages = [
      items[0] ? share(items[0]) : post({ text: words[2], views: 1180, time: '٧:٤٠ م' }),
      post({ text: words[0], views: 964, reacts: [['❤️', 42], ['🙏', 17]], time: '٧:٥٥ م' }),
      post({ text: words[3], views: 312, time: '٨:٠١ م' })
    ];
  }
  else if (layout === 'dm') {
    messages = DM.slice(0, own ? 3 : 4).map(([out, words]) => said(out, words));
    if (items[0]) messages.push(share(items[0]));
  }
  else {
    messages = [line('م.', GROUP[0], 1), line('ر.', GROUP[4], 2), line('', words[0], 0, true)];
    messages[2].querySelector('.ch-said').append(reactions([['🔥', 9], ['🙏', 6]]));
    if (items[0]) messages.push(share(items[0]));
  }

  feed.append(...messages);
  const firstShared = items[0] ? messages.find(m => m.dataset.item === items[0].id) : null;
  if (firstShared) firstShared.classList.add('is-current');

  const head = h('div', { class: 'ch-top' },
    layout === 'server' ? h('span', { class: 'ch-top__hash' }, '#') : h('img', { class: 'ch-top__avatar', src: LOGO, alt: '' }),
    h('span', { class: 'ch-top__text' },
      h('span', { class: 'ch-top__name' }, layout === 'server' ? 'العامة' : NAME),
      h('span', { class: 'ch-top__sub' }, layout === 'dm' ? h('span', { class: 'ch-online' }, 'نشط دلوقتي') : layout === 'server' ? 'أسئلة وأنشطة وكلام' : `قناة · ${compact(1240)} مشترك`)
    ),
    h('span', { class: 'ch-top__glyph' }, iconNode(glyph))
  );

  const rail = layout === 'server'
    ? h('div', { class: 'ch-rail' }, h('img', { src: LOGO, alt: '' }), h('span', { class: 'ch-rail__dot' }, '#'), h('span', { class: 'ch-rail__dot' }, '🎮'), h('span', { class: 'ch-rail__dot' }, '🎵'), h('span', { class: 'ch-rail__dot' }, '+'))
    : null;

  const field = h('span', { class: 'ch-bar__field' }, layout === 'channel' ? 'كتم الصوت' : 'اكتب رسالة…');
  const bar = h('div', { class: 'ch-bar' }, field, h('span', { class: 'ch-bar__send' }, iconNode(layout === 'channel' ? 'bell' : glyph)));

  const phone = h('div', { class: `xp-phone ch ch--${layout} ch--${platform.key}` },
    rail,
    h('div', { class: 'ch-main' }, head, h('div', { class: 'ch-scroll' }, feed, typing), bar)
  );

  stage.append(phone);
  fitWords(feed);

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
    tl.at(450, () => sound('whoosh'));
  }

  typing.classList.add('is-done');
  tl.from(typing, [{ opacity: 1 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }], { duration: 900, delay: 300 });

  messages.forEach((message, i) => {
    const out = message.classList.contains('ch-msg--out');
    const at = 700 + i * (quick ? 260 : 520);
    tl.from(message, [{ opacity: 0, transform: `translate(${out ? 16 : -16}px, 10px) scale(.94)` }, { opacity: 1, transform: 'none' }], { duration: 440, delay: at, easing: SPRING });
    tl.at(at, () => sound(out ? 'send' : layout === 'channel' ? 'notify' : 'pop'));
  });

  messages.forEach(message => message.querySelectorAll('.ch-react').forEach((r, i) => {
    tl.from(r, [{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1.25)', opacity: 1, offset: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 480, delay: 2300 + i * 180, easing: EASE });
  }));

  /* ---------- alive ---------- */

  const settled = 3200;
  let n = 0;

  // (never the item on screen)
  const add = (node, out) => {
    feed.append(node);
    fitWords(node);
    [...feed.children].slice(0, -5).filter(old => !old.classList.contains('is-current')).forEach(old => old.remove());
    node.animate([{ opacity: 0, transform: `translate(${out ? 16 : -16}px, 12px) scale(.94)` }, { opacity: 1, transform: 'none' }], { duration: 460, easing: SPRING });
  };

  const incoming = () => {
    n += 1;
    let next;
    if (layout === 'channel') next = post({ text: words[(n + 3) % words.length], views: Math.round(rand(80, 400)), reacts: n % 2 ? [[pick(REACTIONS), Math.round(rand(3, 20))]] : null, time: '٨:١٠ م' });
    else if (layout === 'dm') next = said(false, DM[script % DM.length][1]);
    else next = line(WHO[n % WHO.length], GROUP[(n * 3) % GROUP.length], n);
    const delay = layout === 'channel' ? 0 : rand(800, 1300);
    if (delay) {
      typing.classList.remove('is-done');
      typing.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
    }
    tl.later(delay, () => {
      typing.classList.add('is-done');
      add(next, false);
      sound(layout === 'channel' ? 'notify' : 'pop');
    });
  };

  // the visitor writes (not in a channel)
  const outgoing = () => {
    typeInto(tl, field, layout === 'dm' ? DM[script % DM.length][1] : MINE[n % MINE.length], {
      sound,
      done: () => {
        const text = field.textContent;
        field.textContent = 'اكتب رسالة…';
        add(layout === 'dm' ? said(true, text) : line('أنا', text, 1), true);
        sound('send');
      }
    });
  };

  // the next item (all of them, in order, then again)
  cycle(tl, items.length, index => {
    const node = share(items[index], Math.round(rand(300, 900)), '٨:١٠ م');
    feed.querySelectorAll('.is-current').forEach(old => old.classList.remove('is-current'));
    node.classList.add('is-current');
    add(node, false);
    sound(layout === 'channel' ? 'notify' : 'pop');
    return node.querySelector('.ch-msg__photo');
  }, { first: firstShared && firstShared.querySelector('.ch-msg__photo'), image: 5000, delay: settled });

  // Messenger follows its script (the visitor asks, the page answers); the others: 2 in, 1 out
  let beat = 0;
  let script = own ? 3 : 4;
  tl.every(layout === 'channel' ? (items.length ? 7400 : 4200) : items.length ? 5200 : 3800, () => {
    beat += 1;
    if (layout === 'dm') {
      if (DM[script % DM.length][0]) outgoing();
      else incoming();
      script += 1;
    }
    else if (layout !== 'channel' && beat % 3 === 0) outgoing();
    else incoming();
  }, { jitter: 0.15, delay: settled });

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
      sound('react');
    }
  }, { delay: settled + 600 });

  // (B) around the phone
  const plane = () => h('span', { class: 'xp-plane' }, iconNode(glyph));
  spray(tl, stage, {
    every: 1200, max: 7, sound,
    paths: layout === 'channel' ? ['cross', 'in', 'out'] : ['in', 'out', 'rise'],
    items: () => {
      const roll = Math.random();
      if (layout === 'channel' && roll < 0.3) return { node: plane(), path: 'cross', sound: 'whoosh' };
      if (roll < 0.62) return { node: bubble(layout === 'channel' ? pick(words) : nextGroup(), { tone: 'chat', who: layout === 'channel' ? '' : pick(WHO) }), path: 'in' };
      if (roll < 0.72) return { node: chip(layout === 'channel' ? `👁 ${compact(Math.round(rand(300, 1300)))}` : pick(['@الكل', '✓ اتشافت', '+١']), 'chat'), path: 'rise' };
      return { text: pick(REACTIONS), path: 'out', sound: 'react' };
    }
  });

  side(tl, stage, {
    items: () => (Math.random() < 0.6 ? { node: bubble(layout === 'channel' ? pick(words) : nextGroup(), { tone: 'chat' }) } : layout === 'channel' ? { node: plane() } : { text: pick(REACTIONS) })
  });

  return tl;

}
