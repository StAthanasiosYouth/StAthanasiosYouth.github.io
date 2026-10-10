/**
 * VERTICAL family: Snapchat and any full-screen vertical platform (stories,
 * snaps, reels). The link's playlist full-screen (kit.js: the admin's own
 * pictures and clips, in its order, with its words, whole on a blurred
 * copy of themselves), else the real weekly posters with their topics —
 * the platform's accent ring and glyph, story progress, a reply typed and
 * sent.
 *
 * Entrance: the first snap opens from the ring. Alive: snaps advance one
 * by one through ALL the items (a clip: once its segment has played; then
 * from the first), reactions burst out over the edge; emoji, streaks and
 * replies drift around.
 * Our own interpretation, not the apps' interfaces.
 *
 * The "stories" scene uses this same renderer (stories.js).
 */

import { h } from '../dom.js';
import { iconNode } from '../icons.js';
import { deck, timeline, spray, side, floats, playlist, cycle, mediaNode, words, fitWords, typeInto, bubble, chip, pick, digits, LOGO, EASE, SPRING } from './kit.js';
import { COMMENTS, WHO } from './talk.js';

const nextComment = deck(COMMENTS);

/* a picture stays this long (ms) */
const SNAP = 3400;

export function play(stage, { quick, reduced, lite, sound, link, platform }, variant = 'snap') {

  const tl = timeline({ quick, reduced, lite });
  const items = playlist(link, { posters: 4, portrait: true });
  const count = items.length;
  const glyph = platform.icon || (link.icon !== 'link' ? link.icon : 'photos');
  const snap = platform.key === 'snapchat';

  const bars = items.map(() => h('span', { class: 'vt-bar' }, h('i')));
  const frames = items.map((item, i) => {
    const text = item.own ? item.text : `«${item.topic}» ${snap ? '👻' : '✨'}`;
    return h('div', { class: `vt-frame vt-frame--${i % 3}`, 'data-item': item.id },
      mediaNode(item, tl, { className: 'vt-frame__media', main: 'vt-frame__img', advance: count > 1 }),
      text ? words(text, { className: 'vt-frame__caption', lines: 3 }) : null
    );
  });
  const track = h('div', { class: 'vt-track' }, frames);
  track.style.setProperty('--count', String(count));

  const ring = h('span', { class: 'vt-ring' }, h('img', { src: LOGO, alt: '' }));
  const field = h('span', { class: 'vt-reply__field' }, 'ابعت رد…');

  const phone = h('div', { class: `xp-phone vt vt--${variant} vt--${platform.key}` },
    h('div', { class: 'vt-viewport' }, track),
    h('div', { class: 'vt-bars' }, bars),
    h('div', { class: 'vt-top' },
      ring,
      h('span', { class: 'vt-top__name' }, 'أسرة البابا أثناسيوس', h('i', {}, ' · ٣ س')),
      h('span', { class: 'vt-top__glyph' }, iconNode(glyph))
    ),
    h('div', { class: 'vt-reply' }, field, h('span', { class: 'vt-reply__heart' }, '♥'))
  );

  stage.append(phone);
  fitWords(track);

  let current = 0;

  const show = index => {
    track.style.transform = `translateX(${-100 * index / count}%)`;
    frames.forEach((frame, i) => frame.classList.toggle('is-current', i === index));
    bars.forEach((bar, i) => {
      bar.firstChild.getAnimations().forEach(a => a.cancel());
      bar.firstChild.style.transform = i < index ? 'scaleX(1)' : 'scaleX(0)';
    });
  };
  // a clip's bar: its segment's length when the admin set one
  const length = item => (item.kind === 'video' && item.end > item.start ? (item.end - item.start) * 1000 : SNAP) * (lite ? 1.5 : 1);

  // final frame: the first snap, its bar full
  show(0);
  bars[0].firstChild.style.transform = 'scaleX(1)';

  /* ---------- entrance ---------- */

  tl.from(phone, [{ transform: 'scale(.9)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 700, easing: SPRING });
  tl.from(ring, [{ transform: 'scale(.4)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 700, delay: 200, easing: SPRING });
  tl.from(bars[0].firstChild, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: quick ? 900 : 2200, delay: 400, easing: 'linear' });
  tl.at(400, () => sound('swipe'));

  /* ---------- alive ---------- */

  const settled = quick ? 1300 : 2600;

  cycle(tl, count, index => {
    const from = current;
    current = index;
    track.animate([{ transform: `translateX(${-100 * from / count}%)` }, { transform: `translateX(${-100 * index / count}%)` }], { duration: 560, easing: EASE });
    show(index);
    bars[index].firstChild.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: length(items[index]), easing: 'linear', fill: 'forwards' });
    sound('swipe');
    return frames[index].firstChild;
  }, { first: frames[0].firstChild, image: SNAP, delay: quick ? 0 : 900 });

  const reply = () => typeInto(tl, field, pick(['🔥🔥', 'جامد ❤️', 'مستنيين الأحد', 'تحفة 😍']), {
    sound,
    done: () => { sound('send'); field.textContent = 'ابعت رد…'; tl.later(10000, reply); }
  });
  tl.later(settled + 3000, reply);

  floats(tl, phone, { glyphs: ['♥', '😍', '🔥', '👏'].concat(snap ? ['👻'] : []), x: [80, 96], y: [86, 92], rise: [120, 190], drift: 40, size: [1, 1.4], every: 1000, max: 5, delay: settled, name: 'vt-react', sound, cue: 'react' });

  // (B) around the phone
  let streak = 11;
  const emoji = ['♥', '😍', '🔥', '✨'].concat(snap ? ['👻', '⚡'] : []);
  spray(tl, stage, {
    every: 1300, max: 6, sound, paths: ['out', 'rise', 'in'],
    items: () => {
      const roll = Math.random();
      if (roll < 0.25) return { node: bubble(nextComment(), { tone: 'vt', who: pick(WHO) }), path: 'in' };
      if (roll < 0.35) { streak += 1; return { node: chip(snap ? `🔥 ${digits(streak)}` : '👁 شافها ٢٤', 'vt'), path: 'rise' }; }
      return { text: pick(emoji), className: 'xp-edge__item--vt', path: 'out', sound: 'react' };
    }
  });

  side(tl, stage, { items: () => (Math.random() < 0.5 ? { node: bubble(nextComment(), { tone: 'vt' }) } : { text: pick(emoji) }) });

  return tl;

}
