/**
 * Instagram: our stories — the real weekly posters (or the link's own
 * «صور المشهد») and a reel of a game segment — the ring that fills, the
 * frames that swipe, a double-tap heart, a reply typed and sent.
 * "صور وستوريز من كل اجتماع".
 * Alive: the stories keep playing (bars fill, frames swipe, the reel
 * plays), the ring's gradient turns, hearts burst out over the phone's
 * edges; likes, comments and gradient sparkles drift around (and beside
 * the sheet on wide screens). Our own interpretation, not Instagram's.
 */

import { h } from '../dom.js';
import { iconNode } from '../icons.js';
import { deck, timeline, float, floats, spray, side, pictures, sceneClips, clipNode, typeInto, bubble, chip, pick, digits, LOGO, EASE, SPRING } from './kit.js';
import { PAGE, COMMENTS, WHO } from './talk.js';

const nextComment = deck(COMMENTS);

export function play(stage, { quick, reduced, lite, sound, link }) {

  const tl = timeline({ quick, reduced, lite });
  const pics = pictures(link, 2, { wide: false });
  // the reel: the link's own video first, else a game segment
  const reel = sceneClips(link, 1)[0];

  const bars = [0, 1, 2].map(() => h('span', { class: 'ig-bar' }, h('i')));
  const still = (pic, i) => h('div', { class: `ig-frame ig-frame--${i}` },
    pic ? h('img', { class: 'ig-frame__bg', src: pic.src, alt: '' }) : null,
    pic ? h('img', { class: 'ig-frame__img', src: pic.src, alt: '', decoding: 'async' }) : null,
    pic && pic.topic ? h('span', { class: 'ig-frame__caption' }, `«${pic.topic}» ✨`) : null
  );
  const video = clipNode(reel, tl, 'ig-frame__video');
  const frames = [
    still(pics[0], 0),
    h('div', { class: 'ig-frame ig-frame--1 ig-frame--reel' }, video, h('span', { class: 'ig-frame__tag' }, '▶ ريلز'), reel.caption ? h('span', { class: 'ig-frame__caption' }, `${reel.caption} 😂🔥`) : null),
    still(pics[1], 2)
  ];
  const track = h('div', { class: 'ig-track' }, frames);
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

  const step = quick ? 520 : 1000;

  tl.from(phone, [{ transform: 'scale(.92)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 600, easing: SPRING });
  tl.from(ring, [{ transform: 'rotate(-120deg) scale(.7)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 900, delay: 150, easing: SPRING });

  // the bars fill one after the other; the frames swipe with them
  bars.forEach((bar, i) => {
    tl.from(bar.firstChild, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: step, delay: 300 + i * step, easing: 'linear' });
  });

  // the final frame is the third: the track shows it; it travels there
  tl.from(track, [
    { transform: 'translateX(0)' },
    { transform: 'translateX(0)', offset: 0.3 },
    { transform: 'translateX(-33.333%)', offset: 0.42 },
    { transform: 'translateX(-33.333%)', offset: 0.72 },
    { transform: 'translateX(-66.666%)' }
  ], { duration: 300 + 3 * step, easing: EASE });
  tl.at(300 + step * 1.1, () => { sound('swipe'); if (video.play) tl.video(video); });
  tl.at(300 + step * 2.1, () => sound('swipe'));

  // double tap: a heart, bursting out over the phone's edges
  const tapAt = 300 + step * 1.55;
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

  const settled = 300 + 3 * step + 200;

  // the ring's gradient turns slowly (the logo stays still)
  tl.loop(glow, [{ transform: 'rotate(0)' }, { transform: 'rotate(360deg)' }], { duration: 6000, easing: 'linear' });

  // the stories keep playing: a bar fills, the next frame slides in
  let current = 2;
  const story = 3600;
  const show = index => {
    track.style.transform = `translateX(${-33.333 * index}%)`;
    bars.forEach((bar, i) => {
      bar.firstChild.getAnimations().forEach(a => a.cancel());
      bar.firstChild.style.transform = i < index ? 'scaleX(1)' : 'scaleX(0)';
    });
    bars[index].firstChild.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: story * (lite ? 1.8 : 1), easing: 'linear', fill: 'forwards' });
  };

  tl.every(story, () => {
    const from = current;
    current = (current + 1) % 3;
    track.animate([{ transform: `translateX(${-33.333 * from}%)` }, { transform: `translateX(${-33.333 * current}%)` }], { duration: 520, easing: EASE });
    show(current);
    sound('swipe');
  }, { jitter: 0, delay: settled + 800 });

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
