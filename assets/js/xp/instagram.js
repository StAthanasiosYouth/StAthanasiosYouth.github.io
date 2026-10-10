/**
 * Instagram: our stories — the link's playlist (kit.js: the admin's own
 * pictures as posts and clips as reel moments, in its order, with its
 * words), else the real weekly posters and a reel of a game segment — the
 * ring that turns, the bars that fill, the frames that swipe one by one
 * through ALL the items (then from the first), a double-tap heart, a reply
 * typed and sent. "صور وستوريز من كل اجتماع".
 * Alive: the stories keep playing (a bar fills, a clip plays its segment,
 * the next frame slides in), hearts burst out over the phone's edges;
 * likes, comments and gradient sparkles drift around (and beside the
 * sheet on wide screens). Our own interpretation, not Instagram's.
 */

import { h } from '../dom.js';
import { iconNode } from '../icons.js';
import { deck, timeline, float, floats, spray, side, playlist, cycle, mediaNode, words, fitWords, typeInto, bubble, chip, pick, digits, LOGO, EASE, SPRING } from './kit.js';
import { PAGE, COMMENTS, WHO } from './talk.js';

const nextComment = deck(COMMENTS);

/* a picture stays this long (ms) */
const STORY = 3600;

export function play(stage, { quick, reduced, lite, sound, link }) {

  const tl = timeline({ quick, reduced, lite });
  // the link's own items, else a poster, a reel, a poster
  const items = playlist(link, { posters: 2, clips: 1, portrait: true });
  const count = items.length;

  const bars = items.map(() => h('span', { class: 'ig-bar' }, h('i')));
  const frames = items.map((item, i) => {
    const text = item.own ? item.text : item.kind === 'video' ? `${item.caption} 😂🔥` : `«${item.topic}» ✨`;
    return h('div', { class: `ig-frame ig-frame--${i % 3}${item.kind === 'video' ? ' ig-frame--reel' : ''}`, 'data-item': item.id },
      mediaNode(item, tl, { className: 'ig-frame__media', main: item.kind === 'video' ? 'ig-frame__video' : 'ig-frame__img', advance: count > 1 }),
      item.kind === 'video' ? h('span', { class: 'ig-frame__tag' }, '▶ ريلز') : null,
      text ? words(text, { className: 'ig-frame__caption', lines: 3 }) : null
    );
  });
  const track = h('div', { class: 'ig-track' }, frames);
  track.style.setProperty('--count', String(count));
  const heart = h('span', { class: 'ig-heart' }, '♥');
  const glow = h('span', { class: 'ig-ring__glow' });
  const ring = h('span', { class: 'ig-ring' }, glow, h('img', { src: LOGO, alt: '' }));
  const field = h('span', { class: 'ig-reply__field' }, 'ابعت رسالة…');
  const sent = h('span', { class: 'ig-sent' }, 'تم الإرسال ✓');

  const phone = h('div', { class: 'xp-phone ig' },
    h('div', { class: 'ig-viewport' }, track),
    h('div', { class: 'ig-bars' }, bars),
    h('div', { class: 'ig-top' },
      ring,
      h('span', { class: 'ig-top__name' }, h('b', {}, PAGE.instagram), h('i', {}, '٢ س')),
      h('span', { class: 'ig-top__glyph' }, iconNode('instagram'))
    ),
    heart,
    sent,
    h('div', { class: 'ig-reply' }, field, h('span', { class: 'ig-reply__heart' }, '♡'), h('span', {}, '➤'))
  );

  stage.append(phone);
  fitWords(track);

  // a frame on screen: the bars before it full, its own filling
  const fill = (index, time) => {
    track.style.transform = `translateX(${-100 * index / count}%)`;
    frames.forEach((frame, i) => frame.classList.toggle('is-current', i === index));
    bars.forEach((bar, i) => {
      bar.firstChild.getAnimations().forEach(a => a.cancel());
      bar.firstChild.style.transform = i < index ? 'scaleX(1)' : 'scaleX(0)';
    });
    if (!reduced && bars[index].firstChild.animate) bars[index].firstChild.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: time, easing: 'linear', fill: 'forwards' });
  };
  // a clip's bar: its segment's length when the admin set one
  const length = item => (item.kind === 'video' && item.end > item.start ? (item.end - item.start) * 1000 : STORY) * (lite ? 1.5 : 1);

  // the final frame: the first item, its bar full
  fill(0, length(items[0]));
  if (reduced) bars[0].firstChild.style.transform = 'scaleX(1)';

  tl.from(phone, [{ transform: 'scale(.92)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 600, easing: SPRING });
  tl.from(ring, [{ transform: 'rotate(-120deg) scale(.7)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 900, delay: 150, easing: SPRING });
  tl.at(300, () => sound('swipe'));

  // double tap: a heart, bursting out over the phone's edges
  const tapAt = quick ? 700 : 1300;
  tl.from(heart, [
    { transform: 'scale(0)', opacity: 0 },
    { transform: 'scale(0)', opacity: 0, offset: 0.0001 },
    { transform: 'scale(1.25)', opacity: 1, offset: 0.35 },
    { transform: 'scale(1)', opacity: 1, offset: 0.55 },
    { transform: 'scale(1.1)', opacity: 0 }
  ], { duration: 1100, delay: tapAt, easing: EASE });
  heart.classList.add('is-done');
  tl.at(tapAt, () => {
    sound('like');
    for (let i = 0; i < 8; i++) float(phone, '♥', { x: 50, y: 50, drift: (i - 3.5) * 34, rise: 120 + (i % 3) * 40, size: 0.9 + (i % 2) * 0.5, className: 'xp-float--ig' });
  });

  /* ---------- alive ---------- */

  const settled = tapAt + 1300;

  // the ring's gradient turns slowly (the logo stays still)
  tl.loop(glow, [{ transform: 'rotate(0)' }, { transform: 'rotate(360deg)' }], { duration: 6000, easing: 'linear' });

  // the stories keep playing, in order: a bar fills (a clip: its segment), the next frame slides in
  let current = 0;
  cycle(tl, count, index => {
    const from = current;
    current = index;
    track.animate([{ transform: `translateX(${-100 * from / count}%)` }, { transform: `translateX(${-100 * index / count}%)` }], { duration: 520, easing: EASE });
    fill(index, length(items[index]));
    sound('swipe');
    return frames[index].firstChild;
  }, { first: frames[0].firstChild, image: STORY, delay: 300 });

  // a reply typed under the story, then sent
  const reply = () => typeInto(tl, field, pick(['تحفة 😍', 'مستنيين الأحد 🔥', 'أحلى اجتماع ❤️', 'جاي إن شاء الله']), {
    sound,
    done: () => {
      sound('send');
      field.textContent = 'ابعت رسالة…';
      sent.animate([{ opacity: 0, transform: 'translate(-50%, 8px)' }, { opacity: 1, transform: 'translate(-50%, 0)', offset: 0.2 }, { opacity: 1, transform: 'translate(-50%, 0)', offset: 0.8 }, { opacity: 0, transform: 'translate(-50%, -6px)' }], { duration: 1800, easing: EASE });
      tl.later(11000, reply);
    }
  });
  tl.later(settled + 2200, reply);

  // hearts rise from the bottom corner, out over the edge
  floats(tl, phone, { glyphs: ['♥', '♥', '❤️'], x: [78, 96], y: [84, 92], rise: [130, 200], drift: 40, size: [0.9, 1.4], every: 850, max: 5, delay: settled, className: 'xp-float--ig', name: 'ig-heart', sound, cue: 'like' });

  // (B) around the phone
  let likes = 157;
  spray(tl, stage, {
    every: 1100, max: 7, sound, paths: ['out', 'rise', 'in', 'orbit'],
    items: () => {
      const roll = Math.random();
      if (roll < 0.22) return { node: bubble(nextComment(), { tone: 'ig', who: pick(WHO) }), path: 'in' };
      if (roll < 0.34) { likes += 3; return { node: chip(`♥ ${digits(likes)}`, 'ig'), path: 'rise' }; }
      if (roll < 0.5) return { text: pick(['✦', '✧', '✦']), className: 'xp-edge__item--spark', path: 'orbit' };
      return { text: pick(['♥', '♥', '😍', '🔥']), className: 'xp-edge__item--ig', path: 'out', sound: 'like' };
    }
  });

  side(tl, stage, {
    items: () => (Math.random() < 0.55 ? { node: bubble(nextComment(), { tone: 'ig', who: pick(WHO) }) } : { text: pick(['♥', '😍', '✨']), className: 'xp-edge__item--ig' })
  });

  return tl;

}
