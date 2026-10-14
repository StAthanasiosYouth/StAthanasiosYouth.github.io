/**
 * THE CLIP SHEET (docs/EVENTS.md §8.3, §17.9): a service page's video card,
 * opened from its cover, in the site's own social-sheet language — the
 * home page's mini-experiences («صوتك يهمنا», the TikTok / Instagram
 * sheets): the same sheet (sheet.js: springs up, drags down, its sounds),
 * the same speaker in its corner, the same living stage (xp/kit.js: hearts
 * and reactions rising beside the clip, a few words passing at its edges,
 * behind the sheet on a wide screen), the same copy and button under it.
 * The clip itself is the real video, at its own shape, in a clean rounded
 * frame — no app's frame around it.
 *
 *  - it starts as the sheet opens (the visitor's tap on the cover), and
 *    loops between its start and end; a tap on it pauses / plays it
 *  - its sound (clip-audio.js): the card's «صوت المقطع» — the clip's own,
 *    a soundtrack of its own (the clip muted), or none — faded in and out,
 *    across between clips; the site's one sound setting (the speaker here,
 *    the top bar's button) silences everything; a hidden tab pauses it all
 *  - «شاهد المسرحية كاملة» (the card's full link, new tab) at the bottom
 *  - prev / next: the buttons, the arrow keys, a sideways swipe (RTL: the
 *    next one comes from the left, so ← / a swipe to the right goes forward)
 *  - Escape, the close button, a tap beside the panel, a drag down and the
 *    phone's back button close it: opening pushes #v/<id>, back pops it
 *  - #v/<id> on load opens that clip (a shared link: muted until a tap)
 * In the admin preview (history: false) the address never changes.
 */

import { h } from '../dom.js';
import { arabicDigits } from '../words.js';
import { iconNode } from '../icons.js';
import { openSheet, closeSheet, sheetOpen } from '../sheet.js';
import { soundEnabled, setSoundEnabled, play as uiSound } from '../sound.js';
import { createClipAudio, modeOf } from './clip-audio.js';
import { icon } from './view.js';

const HASH = /^#v\/([\w-]{1,60})$/;

/* the living stage: loaded with the first sheet (or ahead of it, prepare()) */
let kitLoad = null;
let stylesLoad = null;

function stylesheet(file) {
  return new Promise(resolve => {
    const href = new URL(`../../css/${file}`, import.meta.url).href;
    if (document.querySelector(`link[href="${href}"]`)) return resolve();
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = resolve;
    link.onerror = resolve;    // never block the clip: it plays unstyled extras-less
    document.head.append(link);
  });
}

export function prepare() {
  if (!kitLoad) kitLoad = import('../xp/kit.js').catch(() => null);
  if (!stylesLoad) stylesLoad = Promise.all([stylesheet('xp.css'), stylesheet('xp-clip.css')]);
  return Promise.all([kitLoad, stylesLoad]).then(([kit]) => kit);
}

/* what the people watching say (short, warm, the service's own words) */
const WORDS = [
  ['م.', 'تحفة بجد 👏'],
  ['ك.', 'عايزين جزء تاني'],
  ['ج.', 'ربنا يبارك تعبكم 🙏'],
  ['ن.', 'المشهد ده لمسني ❤️'],
  ['أ.', 'الإضاءة تجنن ✨'],
  ['ر.', 'منتظرين العرض الجاي'],
  ['م.', 'فكرة ورسالة حلوة'],
  ['س.', 'برافو يا فريق 👏']
];
const HEARTS = ['❤️', '👏', '✨', '💛', '🔥', '😍', '🙏'];

const weak = () => (navigator.hardwareConcurrency || 8) <= 4 && (navigator.deviceMemory || 8) <= 4 || (navigator.deviceMemory || 8) <= 2;
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;


export function createVideoSheet({ mediaUrl, announce = () => {}, history: useHistory = true }) {

  let cards = [];          // the page's clip cards, in page order
  let index = 0;
  let opener = null;
  let pushed = false;      // our #v/ entry is on top of the history
  let clip = null;
  let sheetTitle = '';
  let dialog = null;       // the open sheet's <dialog>
  let scene = null;        // the living stage's timeline
  let held = false;        // the visitor paused it (a tap on the clip)
  let swapping = 0;

  /* ---------- the content (built once: one <video> for the sheet's whole life) ---------- */

  const video = h('video', { class: 'xp-clip__video', playsinline: true, preload: 'metadata', disablepictureinpicture: true });
  video.setAttribute('webkit-playsinline', '');
  const sound = createClipAudio(video, { mediaUrl });

  const toggle = h('button', { class: 'xp-clip__toggle', type: 'button' }, h('span', { class: 'xp-clip__state', 'aria-hidden': 'true' }));
  const progress = h('i', { class: 'xp-clip__bar' });
  const tune = h('span', { class: 'xp-clip__tune', 'aria-hidden': 'true' }, '♪');
  const box = h('div', { class: 'xp-clip' }, video, toggle, h('span', { class: 'xp-clip__track', 'aria-hidden': 'true' }, progress), tune, sound.element);
  const stage = h('div', { class: 'xp-stage xp-stage--clip' }, box);

  const speaker = h('button', { class: 'xp-sound', type: 'button', 'aria-label': 'صوت المقطع', title: 'صوت المقطع' });
  const paintSpeaker = () => {
    const on = soundEnabled();
    speaker.replaceChildren(iconNode(on ? 'sound-on' : 'sound-off'));
    speaker.setAttribute('aria-pressed', String(on));
  };
  speaker.addEventListener('click', () => {
    setSoundEnabled(!soundEnabled());
    paintSpeaker();
    sound.setting();
    document.dispatchEvent(new CustomEvent('athanasios:sound', { detail: { on: soundEnabled(), from: 'clip' } }));
  });
  // the top bar's button changed it
  document.addEventListener('athanasios:sound', event => {
    if (event.detail && event.detail.from === 'clip') return;
    paintSpeaker();
    sound.setting();
  });

  const line = h('p', { class: 'xp__line' });
  const sub = h('p', { class: 'xp__sub' });
  const cta = h('a', { class: 'btn btn--primary btn--block xp__cta xp__cta--clip', target: '_blank', rel: 'noopener', 'data-quiet': '' });
  cta.addEventListener('click', () => uiSound('success'));
  const actions = h('div', { class: 'xp__actions' }, cta);

  const count = h('p', { class: 'xp-clip-nav__count', 'aria-hidden': 'true' });
  const prev = h('button', { class: 'xp-clip-nav__btn', type: 'button', 'aria-label': 'الفيديو اللي قبله' }, icon('arrow', 'is-prev'), h('span', {}, 'اللي قبله'));
  const next = h('button', { class: 'xp-clip-nav__btn', type: 'button', 'aria-label': 'الفيديو اللي بعده' }, h('span', {}, 'اللي بعده'), icon('arrow'));
  const nav = h('div', { class: 'xp-clip-nav' }, prev, count, next);

  const content = h('div', { class: 'xp xp--clip' },
    speaker,
    stage,
    h('div', { class: 'xp__copy' }, line, sub),
    actions,
    nav
  );

  prev.addEventListener('click', () => go(-1));
  next.addEventListener('click', () => go(+1));

  // a tap on the clip: pause / play (the sound with it)
  toggle.addEventListener('click', () => {
    if (video.paused) {
      held = false;
      playClip();
    }
    else {
      held = true;
      video.pause();
      sound.pause();
    }
  });

  const paintToggle = () => {
    const paused = video.paused;
    box.classList.toggle('is-paused', paused);
    toggle.setAttribute('aria-label', paused ? 'شغّل المقطع' : 'وقّف المقطع');
  };
  video.addEventListener('play', paintToggle);
  video.addEventListener('pause', paintToggle);

  // a sideways swipe on the panel
  let touch = null;
  content.addEventListener('touchstart', event => {
    const t = event.touches[0];
    touch = event.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null;
  }, { passive: true });
  content.addEventListener('touchend', event => {
    if (!touch) return;
    const t = event.changedTouches[0];
    const dx = t.clientX - touch.x;
    const dy = t.clientY - touch.y;
    touch = null;
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx > 0 ? +1 : -1);
  }, { passive: true });

  // start / end of the clip: it loops between them
  video.addEventListener('loadedmetadata', () => {
    if (clip && clip.start && video.currentTime < clip.start) video.currentTime = clip.start;
  });
  video.addEventListener('timeupdate', () => {
    if (!clip) return;
    const end = clip.end || video.duration || 0;
    if (clip.end && video.currentTime >= clip.end) video.currentTime = clip.start;
    const length = Math.max(0.1, end - clip.start);
    progress.style.setProperty('--p', Math.max(0, Math.min(1, (video.currentTime - clip.start) / length)).toFixed(3));
  });
  video.addEventListener('ended', () => {
    if (!clip || !dialog) return;
    video.currentTime = clip.start;
    video.play().catch(() => {});
  });

  // another tab, a locked phone: everything stops; back: it goes on (unless the visitor paused it)
  document.addEventListener('visibilitychange', () => {
    if (!dialog) return;
    if (document.hidden) {
      video.pause();
      sound.pause();
    }
    else if (!held) {
      playClip();
    }
  });

  /*
   * Play now: the tap that opened the sheet lets it start with sound; a
   * browser that still refuses (no tap: a #v/ link, a strict policy) gets it
   * muted, which is always allowed. A newer clip meanwhile wins (AbortError).
   */
  function playClip() {
    const wanted = clip;
    const attempt = video.play();
    const started = () => { if (dialog && clip === wanted && !video.paused) sound.start(); };
    if (!attempt || typeof attempt.then !== 'function') { started(); return; }
    attempt.then(started, error => {
      if (!dialog || clip !== wanted || (error && error.name === 'AbortError')) return;
      video.muted = true;
      video.play().then(started, () => {});
    });
  }


  /* ---------- showing a card ---------- */

  function load(i) {

    index = (i + cards.length) % cards.length;
    const card = cards[index];
    clip = card.clip;

    video.pause();
    video.preload = 'auto';
    // the start only: an end in the fragment would make the browser stop there (it loops instead)
    const fragment = clip.start ? `#t=${clip.start}` : '';
    video.poster = mediaUrl(card.cover ? card.cover.src : clip.poster);
    sound.set(card);
    video.src = `${mediaUrl(clip.src)}${fragment}`;
    video.setAttribute('aria-label', card.title);
    video.width = clip.w;
    video.height = clip.h;
    // CSSOM (the CSP blocks style=""): the clip's own shape
    box.style.setProperty('--ar', `${clip.w} / ${clip.h}`);
    box.style.setProperty('--arn', String(Math.round((clip.w / clip.h) * 10000) / 10000));
    box.classList.toggle('is-portrait', clip.h > clip.w);
    box.classList.toggle('has-tune', modeOf(card) === 'custom');
    progress.style.setProperty('--p', '0');
    content.dataset.audio = modeOf(card);

    line.textContent = card.title;
    sub.textContent = card.text;
    sub.hidden = !card.text;
    actions.hidden = !card.fullUrl;
    if (card.fullUrl) {
      cta.href = card.fullUrl;
      cta.replaceChildren(icon('play'), h('span', {}, card.ctaLabel), h('span', { class: 'visually-hidden' }, ' (بيفتح في صفحة جديدة)'), icon('external'));
    }
    else cta.removeAttribute('href');

    nav.hidden = cards.length < 2;
    count.textContent = `${arabicDigits(index + 1)} من ${arabicDigits(cards.length)}`;
    if (dialog) dialog.dataset.id = card.id;
    paintToggle();

  }

  /* to the next / previous clip: the sound fades across */
  function go(delta) {
    if (!dialog || cards.length < 2) return;
    const turn = ++swapping;
    held = false;
    const target = index + delta;
    sound.fadeOut(0.3).then(() => {
      if (turn !== swapping || !dialog) return;
      load(target);
      playClip();
      if (scene && scene.burst) scene.burst();
    });
    // the address and the words change at once (the sound follows)
    const nextIndex = (target + cards.length) % cards.length;
    if (useHistory) history.replaceState(history.state, '', `#v/${cards[nextIndex].id}`);
    announce(`${arabicDigits(nextIndex + 1)} من ${arabicDigits(cards.length)}: ${cards[nextIndex].title}`);
    if (dialog) dialog.dataset.id = cards[nextIndex].id;
  }


  // ← → between clips (RTL)
  function onKey(event) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); go(+1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); go(-1); }
  }


  /* ---------- the living stage ---------- */

  function startScene() {
    const opened = dialog;
    const reduced = reducedMotion();
    const lite = !reduced && weak();
    prepare().then(kit => {
      if (!kit || dialog !== opened || !opened || reduced) return;
      const tl = kit.timeline({ reduced, lite });
      tl.root = stage;
      const say = () => {
        const [who, text] = kit.pick(WORDS);
        return { node: kit.bubble(text, { who, tone: 'clip' }), alt: kit.pick(['❤️', '👏', '✨']) };
      };
      const hearts = kit.floats(tl, box, { glyphs: HEARTS, x: [76, 96], y: [72, 94], rise: [120, 200], drift: 18, size: [1.05, 1.55], every: 820, max: 8, duration: 2400, name: 'clip-hearts', delay: 500 });
      kit.spray(tl, stage, { items: say, every: 2900, max: 3, delay: 1400, paths: ['in', 'rise'], name: 'clip-words' });
      kit.side(tl, stage, { items: () => (Math.random() < 0.6 ? say() : { text: kit.pick(HEARTS) }), every: 2100, max: 6, delay: 1800, name: 'clip-side' });
      scene = {
        stop: () => tl.stop(),
        burst: () => { if (hearts && hearts.burst) hearts.burst(3); }
      };
      // a first handful of hearts as it opens
      tl.at(350, () => { if (hearts && hearts.burst) hearts.burst(3); });
    });
  }

  function stopScene() {
    if (scene) scene.stop();
    scene = null;
  }


  /* ---------- open / close ---------- */

  /** list: the page's media cards (clips are picked from it); from: the button tapped */
  function open(list, at, from = null, { fromHash = false } = {}) {

    const clips = list.filter(card => card.source === 'clip' && card.clip);
    const card = list[at];
    const i = clips.indexOf(card);
    if (i < 0) return false;

    cards = clips;
    opener = from;
    held = false;
    swapping += 1;

    if (useHistory && !fromHash) {
      history.pushState({ vsheet: card.id }, '', `#v/${card.id}`);
      pushed = true;
    }

    paintSpeaker();
    stopScene();

    dialog = openSheet({
      title: sheetTitle || card.title,
      content,
      variant: 'xp',
      onClose: ({ fromRoute } = {}) => closed({ fromHistory: fromRoute })
    });
    dialog.classList.add('sheet--clip');
    dialog.dataset.id = card.id;
    dialog.addEventListener('keydown', onKey);
    document.documentElement.classList.add('has-vsheet');

    load(i);
    playClip();
    startScene();
    return true;

  }

  /* the sheet went (any way): silence, unload, the address and the focus back */
  function closed({ fromHistory = false } = {}) {

    if (!dialog) return;
    dialog = null;
    swapping += 1;
    stopScene();

    const unload = () => {
      if (dialog) return;      // opened again meanwhile
      video.pause();
      video.removeAttribute('src');
      video.load();     // stop the download
      clip = null;
    };
    // the clip's own sound fades with the panel; a soundtrack a little longer
    sound.stop(0.24);
    setTimeout(unload, 260);
    document.documentElement.classList.remove('has-vsheet');

    if (useHistory && !fromHistory) {
      if (pushed) history.back();
      else if (HASH.test(location.hash)) history.replaceState(history.state, '', `${location.pathname}${location.search}`);
    }
    pushed = false;

    const back = opener && opener.isConnected ? opener : document.querySelector(`[data-media="${cards[index] ? cards[index].id : ''}"]`);
    if (back) back.focus({ preventScroll: false });
    opener = null;

  }

  /* fromHistory: the back button already removed our entry */
  function hide({ fromHistory = false } = {}) {
    if (!dialog) return;
    if (sheetOpen()) closeSheet({ fromRoute: fromHistory });
    else closed({ fromHistory });
  }

  /** the clip named by #v/<id>, if it is one of the page's (on load, or forward / back) */
  function fromHash(list) {
    const m = HASH.exec(location.hash);
    if (!m) return false;
    const at = list.findIndex(card => card.id === m[1] && card.source === 'clip');
    return at >= 0 && open(list, at, null, { fromHash: true });
  }

  let current = [];

  if (useHistory) {
    window.addEventListener('popstate', () => {
      const m = HASH.exec(location.hash);
      if (dialog && (!m || m[1] !== dialog.dataset.id)) {
        pushed = false;
        hide({ fromHistory: true });
      }
      if (!dialog && m) fromHash(current);
    });
  }

  return {
    open,
    hide,
    prepare,
    /** the page's cards (for #v/ and the forward button); opens #v/<id> if it names one */
    attach(list, { title = '' } = {}) {
      current = list;
      sheetTitle = title;
      return fromHash(list);
    },
    get isOpen() { return !!dialog; },
    /** tests and the admin preview: what is playing */
    get audioState() { return sound.state; }
  };

}
