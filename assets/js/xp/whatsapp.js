/**
 * WhatsApp group: the group talking in its own tone — someone is typing,
 * messages arrive, the announcement (the real meeting time from the page),
 * our message typed in the bar and sent (✓ → ✓✓ → read, blue), replies
 * and reactions. Senders are initials or «خادم الاجتماع»: no names, no
 * numbers, no real chats.
 * Alive: «م. بيكتب…», new messages (the oldest scroll away), now and then
 * the visitor types and sends, reactions land; message bubbles, reactions
 * and read ticks drift in around the phone (beside the sheet on wide
 * screens). Our own interpretation, not WhatsApp's interface.
 */

import { h } from '../dom.js';
import { iconNode } from '../icons.js';
import { deck, timeline, spray, side, playlist, cycle, mediaNode, words, fitWords, typeInto, bubble, chip, rand, pick, digits, meetingLine, LOGO, EASE, SPRING } from './kit.js';
import { GROUP, MINE, REPLIES, WHO, SERVANT, nextTopic } from './talk.js';

const nextGroup = deck(GROUP);

const REACTIONS = ['❤️', '👍', '🙏', '😂', '🔥', '❤️'];
const TONES = 6;

let clock = 20 * 60 + 2;
const stamp = () => {
  clock += Math.round(rand(1, 3));
  const hh = Math.floor(clock / 60) % 12 || 12;
  return `${digits(hh)}:${digits(String(clock % 60).padStart(2, '0'))} م`;
};

function message({ who = '', text, out = false, news = false, tone = 0 }) {

  const ticks = out ? h('span', { class: 'wa-ticks is-read' }, '✓✓') : null;
  return h('div', { class: `wa-msg wa-msg--${out ? 'out' : 'in'}${news ? ' wa-msg--news' : ''}` },
    who && !out ? h('b', { class: `wa-msg__who wa-who--${tone % TONES}` }, who) : null,
    h('span', { class: 'wa-text' }, text),
    h('span', { class: 'wa-meta' }, stamp(), ticks)
  );

}

/* the servant shares one of the admin's own pictures / clips, with its words */
function shared(item, tl, advance) {

  return h('div', { class: 'wa-msg wa-msg--in wa-msg--media', 'data-item': item.id },
    h('b', { class: 'wa-msg__who wa-who--3' }, SERVANT),
    mediaNode(item, tl, { className: 'wa-photo', ratio: [3 / 4, 16 / 9], advance }),
    item.text ? words(item.text, { className: 'wa-text', lines: 6, more: 'اقرأ المزيد' }) : null,
    h('span', { class: 'wa-meta' }, stamp())
  );

}

export function play(stage, { quick, reduced, lite, content, sound, link }) {

  const tl = timeline({ quick, reduced, lite });
  clock = 20 * 60 + 2;

  // the admin's own pictures / clips (only those; none: the chat alone)
  const items = playlist(link, { posters: 0 }).filter(item => item.own);
  const multi = items.length > 1;

  const topic = nextTopic(content);
  const status = h('span', { class: 'wa-top__sub' }, 'الشباب · سفاجا');
  const typing = h('div', { class: 'wa-msg wa-msg--in wa-typing' }, h('i'), h('i'), h('i'));
  const first = message({ who: 'ك.', text: 'مين نازل الأحد؟ 🙋', tone: 1 });
  const reaction = h('span', { class: 'wa-reaction' }, '❤️');
  const news = message({ who: SERVANT, text: topic ? `${meetingLine(content, '📣 الاجتماع الأحد ٨ مساءً')}\n📌 الموضوع: «${topic}»` : meetingLine(content, '📣 الاجتماع الأحد الساعة ٨ مساءً — مستنيينكم!'), news: true, tone: 3 });
  news.append(reaction);
  const mine = message({ text: 'أنا جاي إن شاء الله 🙌', out: true });
  const ticks = mine.querySelector('.wa-ticks');
  const firstShared = items.length ? shared(items[0], tl, multi) : null;
  if (firstShared) firstShared.classList.add('is-current');
  const chat = h('div', { class: 'wa-chat' }, h('span', { class: 'wa-day' }, 'النهارده'), first, news, firstShared, mine, typing);
  const field = h('span', { class: 'wa-bar__field' }, 'رسالة');
  const action = h('span', { class: 'wa-bar__send' }, '🎤');

  const phone = h('div', { class: 'xp-phone wa' },
    h('div', { class: 'wa-top' },
      h('img', { class: 'wa-top__avatar', src: LOGO, alt: '' }),
      h('span', { class: 'wa-top__text' },
        h('span', { class: 'wa-top__name' }, 'جروب أسرة البابا أثناسيوس'),
        status
      ),
      h('span', { class: 'wa-top__glyph' }, iconNode('whatsapp'))
    ),
    chat,
    h('div', { class: 'wa-bar' }, h('span', { class: 'wa-bar__box' }, '🙂', field, '📎'), action)
  );

  stage.append(phone);
  fitWords(chat);

  const s = quick ? 0.45 : 1;

  tl.from(phone, [{ transform: 'translateY(24px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 600, easing: SPRING });

  // someone is typing… then the messages
  typing.classList.add('is-done');
  tl.from(typing, [{ opacity: 1, transform: 'none' }, { opacity: 1, transform: 'none', offset: 0.85 }, { opacity: 0, transform: 'scale(.8)' }], { duration: 900 * s, delay: 200 });

  const arrive = (el, at, out = false) => {
    tl.from(el, [{ opacity: 0, transform: `translateX(${out ? 18 : -18}px) scale(.9)` }, { opacity: 1, transform: 'none' }], { duration: 420, delay: at, easing: SPRING });
    tl.at(at, () => sound(out ? 'send' : 'pop'));
  };

  arrive(first, 1100 * s);
  arrive(news, 1700 * s);
  if (firstShared) arrive(firstShared, 2000 * s);
  arrive(mine, 2300 * s, true);

  // sent ✓ → delivered ✓✓ → read (blue)
  tl.from(ticks, [
    { color: 'rgba(255, 255, 255, .55)', clipPath: 'inset(0 50% 0 0)' },
    { color: 'rgba(255, 255, 255, .55)', clipPath: 'inset(0 50% 0 0)', offset: 0.35 },
    { color: 'rgba(255, 255, 255, .55)', clipPath: 'inset(0 0 0 0)', offset: 0.4 },
    { color: 'rgba(255, 255, 255, .55)', clipPath: 'inset(0 0 0 0)', offset: 0.75 },
    { color: '#53bdeb', clipPath: 'inset(0 0 0 0)' }
  ], { duration: 1300 * s, delay: 2400 * s, easing: 'linear' });
  tl.at(2400 * s + 1300 * s * 0.4, () => sound('tick'));

  // a ❤️ on the announcement
  tl.from(reaction, [{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1.3)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }], { duration: 520, delay: 3000 * s, easing: EASE });
  tl.at(3000 * s, () => sound('react'));

  /* ---------- alive ---------- */

  const settled = 3800;
  let n = 0;

  // the chat shows the newest few; older ones scroll away (never the shared item on screen)
  const add = node => {
    chat.insertBefore(node, typing);
    const all = [...chat.children].filter(m => m.classList.contains('wa-msg') && m !== typing);
    all.slice(0, Math.max(0, all.length - (items.length ? 4 : 5))).filter(m => !m.classList.contains('is-current')).forEach(m => m.remove());
    const day = chat.querySelector('.wa-day');
    if (day && all.length > 5) day.remove();
  };

  const incoming = () => {
    const tone = n % TONES;
    const who = n % 5 === 4 ? SERVANT : WHO[(n * 7) % WHO.length];
    const text = GROUP[(n * 5 + 3) % GROUP.length];
    n += 1;
    status.textContent = `${who} بيكتب…`;
    status.classList.add('is-typing');
    typing.classList.remove('is-done');
    typing.animate([{ opacity: 0, transform: 'scale(.7)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: SPRING });
    tl.later(rand(900, 1500), () => {
      typing.classList.add('is-done');
      status.textContent = 'الشباب · سفاجا';
      status.classList.remove('is-typing');
      const node = message({ who, text, tone });
      add(node);
      node.animate([{ opacity: 0, transform: 'translateX(-14px) scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: SPRING });
      sound('pop');
    });
  };

  const outgoing = () => {
    action.textContent = '➤';
    typeInto(tl, field, MINE[n % MINE.length], {
      sound,
      done: () => {
        const node = message({ text: field.textContent, out: true });
        const mark = node.querySelector('.wa-ticks');
        mark.className = 'wa-ticks is-sent';
        mark.textContent = '✓';
        field.textContent = 'رسالة';
        action.textContent = '🎤';
        add(node);
        node.animate([{ opacity: 0, transform: 'translateX(18px) scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 400, easing: SPRING });
        sound('send');
        tl.later(800, () => { mark.className = 'wa-ticks'; mark.textContent = '✓✓'; sound('tick'); });
        tl.later(1900, () => mark.classList.add('is-read'));
        // someone answers it
        tl.later(3200, () => {
          const reply = message({ who: pick(WHO), text: pick(REPLIES), tone: 2 });
          reply.prepend(h('span', { class: 'wa-quote' }, h('b', {}, 'إنت'), node.querySelector('.wa-text').textContent));
          add(reply);
          reply.animate([{ opacity: 0, transform: 'translateX(-14px) scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: SPRING });
          sound('pop');
        });
      }
    });
  };

  // the servant shares the next item (all of them, in order, then again)
  cycle(tl, items.length, index => {
    const node = shared(items[index], tl, multi);
    chat.querySelectorAll('.wa-msg--media.is-current').forEach(old => old.classList.remove('is-current'));
    node.classList.add('is-current');
    add(node);
    fitWords(node);
    node.animate([{ opacity: 0, transform: 'translateX(-14px) scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: SPRING });
    sound('pop');
    return node.querySelector('.wa-photo');
  }, { first: firstShared && firstShared.querySelector('.wa-photo'), image: 5200, delay: settled });

  let beat = 0;
  tl.every(items.length ? 5600 : 3900, () => {
    beat += 1;
    if (beat % 3 === 2) outgoing();
    else incoming();
  }, { jitter: 0.15, delay: settled });

  // reactions land on messages
  tl.every(2700, () => {
    const targets = [...chat.querySelectorAll('.wa-msg:not(.wa-typing)')].filter(m => !m.querySelector('.wa-reaction'));
    if (!targets.length) return;
    const target = pick(targets.slice(-3));
    const badge = h('span', { class: 'wa-reaction' }, pick(REACTIONS));
    target.append(badge);
    badge.animate([{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1.3)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }], { duration: 520, easing: EASE });
    sound('react');
  }, { delay: settled + 1800 });

  // (B) around the phone: messages sliding in, reactions out, ticks, typing
  spray(tl, stage, {
    every: 1150, max: 7, sound, paths: ['in', 'out', 'in', 'rise'],
    items: () => {
      const roll = Math.random();
      if (roll < 0.36) return { node: bubble(nextGroup(), { tone: Math.random() < 0.3 ? 'wa-out' : 'wa', who: pick(WHO), meta: Math.random() < 0.3 ? '✓✓' : '' }), path: 'in' };
      if (roll < 0.46) return { node: chip(pick(['✓✓', '… بيكتب', '✓✓ اتقرت', '↩︎ رد']), 'wa'), path: 'rise' };
      return { text: pick(REACTIONS), path: 'out', sound: 'react' };
    }
  });

  side(tl, stage, {
    items: () => (Math.random() < 0.65 ? { node: bubble(nextGroup(), { tone: 'wa', who: pick(WHO), meta: stamp() }) } : { text: pick(REACTIONS) })
  });

  return tl;

}
