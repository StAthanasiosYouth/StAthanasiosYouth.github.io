/**
 * YOUTH ACCOUNT: the first-time walkthrough (loaded only when it shows). Six short cards, each with a small drawing
 * made of the page's own parts, so it follows the design and its words are plain text to edit. Swipe, press or skip.
 */

import { h } from '../dom.js';
import { cue } from '../ui-sound.js';
import { arDigits } from './model.js';
import { arch, ic } from './parts.js';

const example = (...kids) => h('div', { class: 'ac-ob__m' }, h('span', { class: 'ac-ob__eg' }, 'مثال'), kids);
const line = (icon, title, sub, end) => h('div', { class: 'ac-ob__row' },
  icon ? h('span', { class: 'ac-row__ic' }, ic(icon)) : null,
  h('span', { class: 'ac-row__body' }, h('span', { class: 'ac-row__t' }, title), sub ? h('span', { class: 'ac-row__s' }, sub) : null),
  end || null);
const band = (...items) => h('div', { class: 'ac-ob__band' }, items.map(([n, label]) => h('span', {}, h('b', {}, n), label)));
const toggle = on => h('span', { class: 'ac-ob__sw' + (on ? ' is-on' : '') });

function cardsFor(person, guest) {
  return [
    {
      title: 'ده حسابك',
      text: 'كل اللي يخصك في مكان واحد. أول ما تفتحه هتعرف لو في حاجة مطلوبة منك، وتحتها كل أقسامك.',
      art: () => example(
        h('div', { class: 'ac-ob__now' }, ic('clock'), 'باقي ٣٠٠ جنيه على رحلة'),
        band(['١٨٠', 'نقطة'], ['١', 'حجز جاي'], ['٣', 'مسابقة']),
        h('div', { class: 'ac-ob__rows' }, line('ticket', 'حجوزاتي')))
    },
    {
      title: guest ? 'مسابقاتك' : 'نقطك ونتايجك',
      text: guest
        ? 'كل مسابقة بتشارك فيها نتيجتها بتوصلك هنا. حسابك خارج النطاق العمري للخدمة، فبتشارك كضيف بدون نقاط.'
        : 'كل مسابقة بتشارك فيها نتيجتها بتوصلك هنا، والنقط بتتجمع وتبدّلها بهدايا من المتجر.',
      art: () => example(
        h('div', { class: 'ac-ob__rows' }, line('trophy', 'مسابقة الكتاب المقدس', guest ? '٨ من ١٠' : '٨ من ١٠، كسبت ٨٠ نقطة')),
        guest ? null : band(['١٨٠', 'نقطة في رصيدك']))
    },
    {
      title: 'حجوزاتك',
      text: 'حالة كل حجز، ودفعت كام وباقي كام. ومن هنا تدفع الباقي من غير ما تدوّر على الرابط.',
      art: () => example(
        h('div', { class: 'ac-ob__ticket' },
          h('div', { class: 'ac-item__top' }, h('span', { class: 'ac-item__t' }, 'رحلة'), h('span', { class: 'ac-chip ac-chip--ok' }, 'مؤكد')),
          h('span', { class: 'ac-ob__pay' }, h('i', {})),
          h('span', { class: 'ac-item__s' }, 'دفعت ٦٠٠ من ٩٠٠ جنيه')),
        h('span', { class: 'ac-ob__cta' }, 'ادفع الباقي'))
    },
    {
      title: 'صورتك',
      text: 'اختيارية. دوس على الكاميرا عشان تضيفها أو تغيرها أو تمسحها. بتظهر ليك وللخدام المسؤولين عن حسابات الشباب.',
      art: () => h('div', { class: 'ac-ob__m ac-ob__photo' }, arch(person, { size: 'm' }), h('span', { class: 'ac-ob__cam' }, ic('camera')))
    },
    {
      title: 'الإشعارات والدعم',
      text: 'اختار الإيميلات اللي تحب توصلك. ولو في بيانات غلط أو مشكلة، الدعم الفني بيحلها معاك.',
      art: () => example(
        h('div', { class: 'ac-ob__rows' }, line('', 'النتايج والنقط', '', toggle(true)), line('', 'دخول من جهاز جديد', '', toggle(false))),
        h('div', { class: 'ac-ob__rows' }, line('whatsapp', 'الدعم الفني', 'واتساب أو مكالمة')))
    },
    {
      title: 'لما تخلص',
      text: '«خروج» لو الجهاز بتاعك. ولو الجهاز مش بتاعك، «خروج وانسَ الجهاز ده» من أمان الحساب.',
      art: () => h('div', { class: 'ac-ob__m' }, h('div', { class: 'ac-ob__rows' },
        line('logout', 'خروج', 'جهازك، وهيفتكر إيميلك'),
        line('shield', 'خروج وانسَ الجهاز ده', 'جهاز مش بتاعك')))
    }
  ];
}

/* person: { firstName, photo }. onDone runs once, however it closes */
export function openTour(person, { guest = false, onDone = null } = {}) {

  const cards = cardsFor(person, guest);
  const dialog = h('dialog', { class: 'ac-ob', 'aria-label': 'إزاي تستخدم حسابك', 'data-tour': '' });
  let at = 0;
  let done = false;

  const finish = sound => {
    if (done) return;
    done = true;
    cue(sound);
    if (dialog.open) dialog.close();
    dialog.remove();
    if (onDone) onDone();
  };

  const count = h('span', { class: 'ac-ob__n' });
  const skip = h('button', { type: 'button', class: 'ac-ob__skip', 'data-tour-skip': '', 'data-quiet': '', onclick: () => finish('close') }, 'تخطّي');
  const art = h('div', { class: 'ac-ob__art' });
  const text = h('div', { class: 'ac-ob__text', 'aria-live': 'polite' });
  const dots = h('div', { class: 'ac-ob__dots', 'aria-hidden': 'true' }, cards.map(() => h('i', {})));
  const back = h('button', { type: 'button', class: 'btn', 'data-tour-back': '', 'data-quiet': '', onclick: () => move(-1) }, 'السابق');
  const next = h('button', { type: 'button', class: 'btn btn--primary', 'data-tour-next': '', 'data-quiet': '', onclick: () => (at === cards.length - 1 ? finish('success') : move(1)) });
  const actions = h('div', { class: 'ac-ob__btns' }, back, next);

  function paint() {
    const card = cards[at];
    const last = at === cards.length - 1;
    count.textContent = arDigits(at + 1) + ' من ' + arDigits(cards.length);
    skip.hidden = last;
    art.replaceChildren(card.art());
    text.replaceChildren(h('h2', { class: 'ac-ob__t' }, card.title), h('p', { class: 'ac-ob__p' }, card.text));
    [...dots.children].forEach((dot, i) => dot.classList.toggle('is-on', i === at));
    back.hidden = at === 0;
    actions.classList.toggle('is-first', at === 0);
    next.textContent = last ? 'يلا نبدأ' : 'التالي';
  }

  function move(step) {
    const to = at + step;
    if (to < 0 || to >= cards.length) return;
    at = to;
    cue('page');
    paint();
    next.focus({ preventScroll: true });
  }

  // right to left: the next card comes from the left, so a swipe to the right goes forward
  let startX = null;
  dialog.addEventListener('pointerdown', event => { startX = event.clientX; });
  dialog.addEventListener('pointerup', event => {
    if (startX === null) return;
    const moved = event.clientX - startX;
    startX = null;
    if (moved > 45) move(1);
    else if (moved < -45) move(-1);
  });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft') move(1);
    else if (event.key === 'ArrowRight') move(-1);
  });
  // Esc
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    finish('close');
  });

  dialog.append(h('div', { class: 'ac-ob__in' },
    h('div', { class: 'ac-ob__top' }, count, skip),
    art,
    text,
    h('div', { class: 'ac-ob__foot' }, dots, actions)));
  document.body.append(dialog);
  paint();
  dialog.showModal();
  next.focus({ preventScroll: true });
  cue('open', { passive: true });

}
