/**
 * WhatsApp group: someone is typing, messages arrive, an announcement
 * (the real meeting time from the page, nothing private), our message is
 * delivered and read (✓ → ✓✓ blue), a ❤️ reaction. No names, no real
 * chats: message shapes only.
 * Our own interpretation, not WhatsApp's interface.
 */

import { h } from '../dom.js';
import { iconNode } from '../icons.js';
import { DAY_NAMES, formatTime } from '../words.js';
import { timeline, LOGO, EASE, SPRING } from './kit.js';

function announcement(content) {

  const meeting = content && content.meeting;

  if (meeting && Number.isInteger(meeting.day) && /^\d{2}:\d{2}$/.test(meeting.time)) {
    const [hh, mm] = meeting.time.split(':').map(Number);
    return `📣 الاجتماع ${DAY_NAMES[meeting.day]} الساعة ${formatTime(hh * 60 + mm)} — مستنيينك!`;
  }

  return '📣 إعلان جديد في الجروب';

}

export function play(stage, { quick, reduced, content, sound }) {

  const tl = timeline({ quick, reduced });

  const typing = h('div', { class: 'wa-msg wa-msg--in wa-typing' }, h('i'), h('i'), h('i'));
  const first = h('div', { class: 'wa-msg wa-msg--in' }, h('span', { class: 'wa-lines' }, h('i'), h('i')));
  const reaction = h('span', { class: 'wa-reaction' }, '❤️');
  const news = h('div', { class: 'wa-msg wa-msg--in wa-msg--news' }, h('span', { class: 'wa-text' }, announcement(content)), reaction);
  const ticks = h('span', { class: 'wa-ticks is-read' }, '✓✓');
  const mine = h('div', { class: 'wa-msg wa-msg--out' }, h('span', { class: 'wa-lines' }, h('i')), ticks);

  const phone = h('div', { class: 'xp-phone wa' },
    h('div', { class: 'wa-top' },
      h('img', { class: 'wa-top__avatar', src: LOGO, alt: '' }),
      h('span', { class: 'wa-top__text' },
        h('span', { class: 'wa-top__name' }, 'جروب أسرة البابا أثناسيوس'),
        h('span', { class: 'wa-top__sub' }, 'الشباب · سفاجا')
      ),
      h('span', { class: 'wa-top__glyph' }, iconNode('whatsapp'))
    ),
    h('div', { class: 'wa-chat' }, typing, first, news, mine)
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

  return tl;

}
