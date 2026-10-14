/**
 * VIDEO SHEET (docs/EVENTS.md §8.3, §17.9)
 *
 * A <dialog> with a plain <video controls playsinline preload="metadata">
 * at the clip's own shape (full width, at most 80 dvh), then the title, the
 * text and «شاهد المسرحية كاملة» when the card has a full link (new tab).
 *  - playback starts only on the visitor's tap (no autoplay, sound is theirs)
 *  - start / end: it starts at start and pauses at end
 *  - prev / next: the buttons, the arrow keys, a swipe (RTL: the next one
 *    comes from the left, so ← / a swipe to the right goes forward)
 *  - Escape, the close button, a tap beside the panel and the phone's back
 *    button close it: opening pushes #v/<id>, so back just pops it
 *  - #v/<id> on load opens that clip (a shared link)
 * In the admin preview (history: false) the address never changes.
 */

import { h } from '../dom.js';
import { arabicDigits } from '../words.js';
import { icon } from './view.js';

const HASH = /^#v\/([\w-]{1,60})$/;

export function createVideoSheet({ mediaUrl, announce = () => {}, history: useHistory = true }) {

  let cards = [];          // the page's clip cards, in page order
  let index = 0;
  let opener = null;
  let pushed = false;      // our #v/ entry is on top of the history
  let clip = null;

  /* ---------- the dialog (built once) ---------- */

  const video = h('video', { class: 'vsheet__video', controls: true, playsinline: true, preload: 'metadata' });
  const stage = h('div', { class: 'vsheet__stage' }, video);
  const count = h('p', { class: 'vsheet__count', 'aria-hidden': 'true' });
  const close = h('button', { class: 'vsheet__close', type: 'button', 'aria-label': 'اقفل الفيديو' }, h('span', { 'aria-hidden': 'true' }, '×'));
  const title = h('h2', { class: 'vsheet__title', id: 'vsheet-title' });
  const text = h('p', { class: 'vsheet__text' });
  const cta = h('a', { class: 'btn btn--primary vsheet__cta', target: '_blank', rel: 'noopener' });
  const prev = h('button', { class: 'vsheet__nav', type: 'button', 'aria-label': 'الفيديو اللي قبله' }, icon('arrow', 'is-prev'), h('span', {}, 'اللي قبله'));
  const next = h('button', { class: 'vsheet__nav', type: 'button', 'aria-label': 'الفيديو اللي بعده' }, h('span', {}, 'اللي بعده'), icon('arrow'));
  const nav = h('div', { class: 'vsheet__navs' }, prev, count, next);

  const panel = h('div', { class: 'vsheet__panel' },
    h('div', { class: 'vsheet__bar' }, close),
    stage,
    h('div', { class: 'vsheet__info' }, title, text, cta, nav)
  );
  const dialog = h('dialog', { class: 'vsheet', 'aria-labelledby': 'vsheet-title' }, panel);

  close.addEventListener('click', () => hide());
  prev.addEventListener('click', () => go(-1));
  next.addEventListener('click', () => go(+1));

  // Escape: our own close (so the history entry goes too)
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    hide();
  });

  // a tap on the dim area beside the panel
  dialog.addEventListener('click', event => {
    if (event.target === dialog) hide();
  });

  // ← → between clips (RTL), except while the video itself has the keys (seeking)
  dialog.addEventListener('keydown', event => {
    if (event.target === video || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); go(+1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); go(-1); }
  });

  // a sideways swipe (not on the video's own controls at the bottom)
  let touch = null;
  panel.addEventListener('touchstart', event => {
    const t = event.touches[0];
    const box = video.getBoundingClientRect();
    const onControls = event.target === video && t.clientY > box.bottom - Math.max(56, box.height * 0.25);
    touch = event.touches.length === 1 && !onControls ? { x: t.clientX, y: t.clientY } : null;
  }, { passive: true });
  panel.addEventListener('touchend', event => {
    if (!touch) return;
    const t = event.changedTouches[0];
    const dx = t.clientX - touch.x;
    const dy = t.clientY - touch.y;
    touch = null;
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx > 0 ? +1 : -1);
  }, { passive: true });

  // start / end of the clip
  video.addEventListener('loadedmetadata', () => {
    if (clip && clip.start && video.currentTime < clip.start) video.currentTime = clip.start;
  });
  video.addEventListener('timeupdate', () => {
    if (clip && clip.end && video.currentTime >= clip.end && !video.paused) video.pause();
  });
  video.addEventListener('play', () => {
    if (!clip) return;
    if (video.currentTime < clip.start - 0.5 || (clip.end && video.currentTime >= clip.end - 0.05)) video.currentTime = clip.start;
  });


  /* ---------- showing a card ---------- */

  function load(i) {

    index = (i + cards.length) % cards.length;
    const card = cards[index];
    clip = card.clip;

    video.pause();
    const fragment = clip.start || clip.end ? `#t=${clip.start}${clip.end ? `,${clip.end}` : ''}` : '';
    video.poster = mediaUrl(card.cover ? card.cover.src : clip.poster);
    video.src = `${mediaUrl(clip.src)}${fragment}`;
    video.setAttribute('aria-label', card.title);
    video.width = clip.w;
    video.height = clip.h;
    // CSSOM (the CSP blocks style=""): the clip's own shape
    stage.style.setProperty('--ar', `${clip.w} / ${clip.h}`);
    stage.style.setProperty('--arn', String(Math.round((clip.w / clip.h) * 10000) / 10000));

    title.textContent = card.title;
    text.textContent = card.text;
    text.hidden = !card.text;
    cta.hidden = !card.fullUrl;
    if (card.fullUrl) {
      cta.href = card.fullUrl;
      cta.replaceChildren(card.ctaLabel, h('span', { class: 'visually-hidden' }, ' (بيفتح في صفحة جديدة)'));
    }
    else cta.removeAttribute('href');

    nav.hidden = cards.length < 2;
    count.textContent = `${arabicDigits(index + 1)} من ${arabicDigits(cards.length)}`;
    dialog.dataset.id = card.id;

  }

  function go(delta) {
    if (!dialog.open || cards.length < 2) return;
    load(index + delta);
    if (useHistory) history.replaceState(history.state, '', `#v/${cards[index].id}`);
    announce(`${arabicDigits(index + 1)} من ${arabicDigits(cards.length)}: ${cards[index].title}`);
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
    if (!dialog.isConnected) document.body.append(dialog);

    load(i);

    if (useHistory && !fromHash) {
      history.pushState({ vsheet: card.id }, '', `#v/${card.id}`);
      pushed = true;
    }

    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    document.documentElement.classList.add('has-vsheet');
    close.focus({ preventScroll: true });
    return true;

  }

  /* fromHistory: the back button already removed our entry */
  function hide({ fromHistory = false } = {}) {

    if (!dialog.open) return;

    video.pause();
    video.removeAttribute('src');
    video.load();     // stop the download
    clip = null;

    dialog.close();
    delete dialog.dataset.id;
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
      if (dialog.open && (!m || m[1] !== dialog.dataset.id)) {
        pushed = false;
        hide({ fromHistory: true });
      }
      if (!dialog.open && m) fromHash(current);
    });
  }

  return {
    open,
    hide,
    /** the page's cards (for #v/ and the forward button); opens #v/<id> if it names one */
    attach(list) {
      current = list;
      return fromHash(list);
    },
    get isOpen() { return dialog.open; }
  };

}
