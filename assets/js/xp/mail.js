/**
 * MAIL family: email and any "write to us" platform. An envelope arrives,
 * opens, the letter rises with our logo and a real line; the inbox below
 * fills with believable subjects (the meeting, the topic, the photos).
 *
 * Alive: new mail arrives now and then (unread dot, the oldest leaves),
 * the letter floats gently; little envelopes fly in toward the phone and
 * «وصلت رسالة» pills rise beside it.
 */

import { h } from '../dom.js';
import { iconNode } from '../icons.js';
import { timeline, spray, side, chip, pick, LOGO, EASE, SPRING } from './kit.js';
import { POSTERS } from './library.js';
import { PAGE } from './talk.js';

const SUBJECTS = [
  ['ميعاد اجتماع الأحد ✨', 'الساعة ٨ مساءً — مستنيينك'],
  [`صور اجتماع «${POSTERS[1].topic}»`, 'الصور كلها نزلت على الصفحة 📸'],
  ['اقتراحك وصلنا 💛', 'شكرًا إنك قلتلنا… هنرد عليك قريب'],
  ['فقرة الألعاب الأحد 🎮', 'جهّز نفسك لتحدي جديد 😂'],
  [`موضوعنا: «${POSTERS[0].topic}»`, 'تعالى ومعاك صحابك'],
  ['شكرًا على الأحد اللي فات 🙏', 'كان يوم حلو بوجودكم']
];

function row([subject, preview], unread = false, time = '٨:١٠ م') {

  return h('div', { class: `ml-row${unread ? ' is-unread' : ''}` },
    h('img', { src: LOGO, alt: '' }),
    h('span', { class: 'ml-row__text' }, h('b', {}, subject), h('span', {}, preview)),
    h('i', { class: 'ml-row__time' }, time),
    h('i', { class: 'ml-dot' })
  );

}

export function play(stage, { quick, reduced, lite, sound, platform }) {

  const tl = timeline({ quick, reduced, lite });
  const flap = h('span', { class: 'ml-flap' });
  const letter = h('span', { class: 'ml-letter' }, h('img', { src: LOGO, alt: '' }), h('span', { class: 'ml-letter__text' }, 'أهلاً بيك 💛', h('i', {}, PAGE.short)));
  const envelope = h('span', { class: 'ml-envelope' }, h('span', { class: 'ml-back' }), letter, h('span', { class: 'ml-front' }), flap);
  const rows = [row(SUBJECTS[0], true, 'دلوقتي'), row(SUBJECTS[1], false, '٧:٤٠ م'), row(SUBJECTS[2], false, 'امبارح')];
  const inbox = h('div', { class: 'ml-inbox' }, rows);

  const phone = h('div', { class: `xp-phone ml ml--${platform.key}` },
    h('div', { class: 'ml-top' }, h('span', { class: 'ml-top__glyph' }, iconNode(platform.icon || 'mail')), h('span', {}, 'الوارد'), h('b', { class: 'ml-badge' }, '١')),
    h('div', { class: 'ml-stage' }, envelope),
    inbox
  );

  stage.append(phone);

  tl.from(phone, [{ transform: 'translateY(26px) scale(.96)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 620, easing: SPRING });
  tl.from(envelope, [{ transform: 'translate(-120px, -40px) rotate(-14deg) scale(.7)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 760, delay: 250, easing: SPRING });
  tl.at(250, () => sound('whoosh'));
  tl.from(flap, [{ transform: 'rotateX(0)' }, { transform: 'rotateX(0)', offset: 0.3 }, { transform: 'rotateX(180deg)' }], { duration: 700, delay: 900, easing: EASE });
  tl.from(letter, [{ transform: 'translateY(46%)' }, { transform: 'translateY(46%)', offset: 0.4 }, { transform: 'none' }], { duration: 1100, delay: 1000, easing: EASE });
  tl.at(1400, () => sound('notify'));
  rows.forEach((r, i) => tl.from(r, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 400, delay: 1500 + i * 160, easing: EASE }));

  const settled = 2600;

  tl.at(settled, () => tl.loop(letter, [{ transform: 'none' }, { transform: 'translateY(-5px)' }, { transform: 'none' }], { duration: 3200 }));

  // new mail arrives at the top; the oldest leaves
  let n = 2;
  tl.every(4200, () => {
    n += 1;
    const node = row(SUBJECTS[n % SUBJECTS.length], true, 'دلوقتي');
    inbox.prepend(node);
    [...inbox.children].slice(3).forEach(old => old.remove());
    [...inbox.children].slice(1).forEach(old => old.classList.remove('is-unread'));
    node.animate([{ opacity: 0, transform: 'translateY(-14px)' }, { opacity: 1, transform: 'none' }], { duration: 460, easing: EASE });
    sound('notify');
  }, { delay: settled + 600 });

  spray(tl, stage, {
    every: 1500, max: 5, sound, paths: ['cross', 'in', 'rise'],
    items: () => {
      const roll = Math.random();
      if (roll < 0.25) return { node: chip(pick(['✉️ وصلت رسالة', '💌 رد جديد', '📎 صور الأحد']), 'ml'), path: 'rise' };
      return { text: pick(['✉️', '💌', '✨']), className: 'xp-edge__item--ml', path: pick(['cross', 'in']), sound: Math.random() < 0.3 ? 'whoosh' : '' };
    }
  });

  side(tl, stage, { items: () => (Math.random() < 0.5 ? { node: chip(`✉️ ${pick(SUBJECTS)[0]}`, 'ml') } : { text: pick(['✉️', '💌']) }) });

  return tl;

}
