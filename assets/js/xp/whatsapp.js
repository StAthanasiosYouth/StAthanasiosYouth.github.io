/**
 * WhatsApp group: someone is typing, messages arrive, an announcement
 * (the real meeting time from the page, nothing private), our message is
 * delivered and read (✓ → ✓✓ blue), a ❤️ reaction.
 * Then the group stays alive: someone types, a new message arrives (the
 * oldest scrolls away), reactions land on messages; little bubbles and
 * hearts drift in from the edges. No names, no real chats: message
 * shapes only.
 * Our own interpretation, not WhatsApp's interface.
 */

import { h } from '../dom.js';
import { iconNode } from '../icons.js';
import { timeline, edge, lines, rand, pick, meetingLine, LOGO, EASE, SPRING } from './kit.js';

const REACTIONS = ['❤️', '👍', '🙏', '😂', '🔥'];

export function play(stage, { quick, reduced, lite, content, sound }) {

  const tl = timeline({ quick, reduced, lite });

  const typing = h('div', { class: 'wa-msg wa-msg--in wa-typing' }, h('i'), h('i'), h('i'));
  const first = h('div', { class: 'wa-msg wa-msg--in' }, h('span', { class: 'wa-lines' }, h('i'), h('i')));
  const reaction = h('span', { class: 'wa-reaction' }, '❤️');
  const news = h('div', { class: 'wa-msg wa-msg--in wa-msg--news' }, h('span', { class: 'wa-text' }, meetingLine(content, '📣 إعلان جديد في الجروب')), reaction);
  const ticks = h('span', { class: 'wa-ticks is-read' }, '✓✓');
  const mine = h('div', { class: 'wa-msg wa-msg--out' }, h('span', { class: 'wa-lines' }, h('i')), ticks);
  const chat = h('div', { class: 'wa-chat' }, typing, first, news, mine);

  const phone = h('div', { class: 'xp-phone wa' },
    h('div', { class: 'wa-top' },
      h('img', { class: 'wa-top__avatar', src: LOGO, alt: '' }),
      h('span', { class: 'wa-top__text' },
        h('span', { class: 'wa-top__name' }, 'جروب أسرة البابا أثناسيوس'),
        h('span', { class: 'wa-top__sub' }, 'الشباب · سفاجا')
      ),
      h('span', { class: 'wa-top__glyph' }, iconNode('whatsapp'))
    ),
    chat
  );

  stage.append(phone);

  const s = quick ? 0.45 : 1;

  tl.from(phone, [{ transform: 'translateY(24px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 600, easing: SPRING });

  // someone is typing… then the messages
  typing.classList.add('is-done');
  tl.from(typing, [{ opacity: 1, transform: 'none' }, { opacity: 1, transform: 'none', offset: 0.85 }, { opacity: 0, transform: 'scale(.8)' }], { duration: 900 * s, delay: 200 });

  const arrive = (el, at, out = false) => {
    tl.from(el, [{ opacity: 0, transform: `translateX(${out ? 18 : -18}px) scale(.9)` }, { opacity: 1, transform: 'none' }], { duration: 420, delay: at, easing: SPRING });
    tl.at(at, () => sound(out ? 'tap' : 'pop', { passive: true }));
  };

  arrive(first, 1100 * s);
  arrive(news, 1700 * s);
  arrive(mine, 2300 * s, true);

  // sent ✓ → delivered ✓✓ → read (blue)
  tl.from(ticks, [
    { color: 'rgba(255, 255, 255, .55)', clipPath: 'inset(0 50% 0 0)' },
    { color: 'rgba(255, 255, 255, .55)', clipPath: 'inset(0 50% 0 0)', offset: 0.35 },
    { color: 'rgba(255, 255, 255, .55)', clipPath: 'inset(0 0 0 0)', offset: 0.4 },
    { color: 'rgba(255, 255, 255, .55)', clipPath: 'inset(0 0 0 0)', offset: 0.75 },
    { color: '#53bdeb', clipPath: 'inset(0 0 0 0)' }
  ], { duration: 1300 * s, delay: 2400 * s, easing: 'linear' });

  // a ❤️ on the announcement
  tl.from(reaction, [{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1.3)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }], { duration: 520, delay: 3000 * s, easing: EASE });
  tl.at(3000 * s, () => sound('success', { passive: true }));

  /* ---------- alive ---------- */

  const settled = 3800;

  // someone types, then a new message arrives; the chat keeps at most a few
  tl.ambient(chat, {
    every: 3600, max: 4, recycle: true, delay: settled, name: 'wa-msg',
    make: () => h('div', { class: 'wa-msg' }, lines(2, 'wa-lines'), h('span', { class: 'wa-ticks' }, '✓✓')),
    spawn: (node, n) => {
      const out = n % 3 === 0;
      node.className = `wa-msg xp-amb wa-msg--${out ? 'out' : 'in'}${out ? '' : ' is-typing'}`;
      node.firstChild.lastChild.style.width = `${Math.round(rand(35, 80))}%`;
      node.lastChild.className = 'wa-ticks';
      node.lastChild.hidden = !out;
      node.querySelector('.wa-reaction')?.remove();
      chat.append(node);
      // the chat shows the newest ones; older ones scroll away
      const all = [...chat.children].filter(m => !m.classList.contains('wa-typing'));
      all.slice(0, Math.max(0, all.length - 5)).forEach(m => { if (!m.classList.contains('xp-amb')) m.remove(); });

      const animations = [];
      if (out) {
        animations.push(node.animate([{ opacity: 0, transform: 'translateX(18px) scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: SPRING }));
        // delivered, then read (blue) a moment later
        tl.at(1100, () => node.lastChild.classList.add('is-read'));
        sound('tap', { passive: true });
      }
      else {
        // typing dots first, then the words
        animations.push(node.animate([{ opacity: 0, transform: 'translateX(-14px) scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: SPRING }));
        tl.at(900, () => {
          node.classList.remove('is-typing');
          sound('pop', { passive: true });
        });
      }
      return animations;
    }
  });

  // reactions land on messages
  tl.every(2600, () => {
    const targets = [...chat.querySelectorAll('.wa-msg:not(.wa-typing):not(.is-typing)')].filter(m => !m.querySelector('.wa-reaction'));
    if (!targets.length) return;
    const target = pick(targets.slice(-3));
    const badge = h('span', { class: 'wa-reaction' }, pick(REACTIONS));
    target.append(badge);
    badge.animate([{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1.3)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }], { duration: 520, easing: EASE });
  }, { delay: settled + 1800 });

  // (B) from the edges
  edge(tl, stage, {
    every: 1400, max: 5,
    items: () => (Math.random() < 0.45 ? { node: h('span', { class: 'xp-bubble xp-bubble--wa' }, lines(Math.random() < 0.5 ? 1 : 2)) } : pick(REACTIONS))
  });

  return tl;

}
