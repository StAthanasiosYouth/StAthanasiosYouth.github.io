/**
 * SHEET: the app-like panel used for the bell, news, games and the meeting.
 *
 * Built on <dialog> (focus handling, Esc, top layer). Opens with a spring,
 * can be dragged down to dismiss, and closes on backdrop tap.
 */

import { h } from './dom.js';
import { iconNode } from './icons.js';
import { animate, SPRING } from './motion.js';
import { play } from './sound.js';

let current = null;
let counter = 0;
let styles = null;
let stylesReady = false;


/*
 * The sheets' own stylesheet (assets/css/sheets.css) is not part of the
 * first visit: it loads on the first touch / key press (main.js), or at
 * the latest when a sheet opens (a deep link), which then waits for it.
 */
export function sheetStyles() {

  if (!styles) {
    styles = new Promise(resolve => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = new URL('../css/sheets.css', import.meta.url).href;
      const done = () => { stylesReady = true; resolve(); };
      link.onload = done;
      link.onerror = done;   // never block a sheet; it still works unstyled
      document.head.append(link);
    });
  }

  return styles;

}


export function openSheet({ title, content, variant = 'detail', onClose }) {

  closeSheet({ silent: true });

  const titleId = `sheet-title-${++counter}`;
  const panel = h('div', { class: 'sheet__panel' });
  const dialog = h('dialog', { class: `sheet sheet--${variant}`, 'aria-labelledby': titleId }, panel);

  const close = h('button', { class: 'sheet__close', type: 'button', 'aria-label': 'قفل', onclick: () => closeSheet() }, iconNode('close'));
  const grip = h('div', { class: 'sheet__grip', 'aria-hidden': 'true' });
  const head = h('div', { class: 'sheet__head' }, h('h2', { class: 'sheet__title', id: titleId, tabindex: '-1' }, title), close);

  panel.append(grip, head, h('div', { class: 'sheet__body' }, content));

  document.body.append(dialog);
  document.documentElement.classList.add('has-sheet');

  current = { dialog, panel, onClose };

  const show = () => {
    // closed or replaced while its styles were still on the way
    if (!current || current.dialog !== dialog) return;

    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    }
    else {
      dialog.setAttribute('open', '');
    }

    // start on the title: no focus ring on the close button, screen readers
    // hear what opened; Tab goes on to the close button and the content
    head.firstChild.focus({ preventScroll: true });

    animate(panel, [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], { duration: 620, easing: SPRING });
    play('open');
  };

  if (stylesReady) show();
  else sheetStyles().then(show);

  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    closeSheet();
  });

  dialog.addEventListener('click', event => {
    if (event.target === dialog) closeSheet();
  });

  enableDrag(grip, panel);
  enableDrag(head, panel);

  return dialog;

}


/* silent: replaced by another sheet (no sound, no onClose navigation) */
export function closeSheet({ silent = false, fromRoute = false } = {}) {

  if (!current) {
    return;
  }

  const { dialog, panel, onClose } = current;
  current = null;

  // a poster viewer opened from this sheet goes with it
  closeViewer();

  let done = false;

  const finish = () => {
    if (done) return;
    done = true;
    if (dialog.open) dialog.close();
    dialog.remove();
    if (!current) document.documentElement.classList.remove('has-sheet');
  };

  if (silent) {
    finish();
    return;
  }

  play('close');

  const out = animate(panel, [{ transform: getComputedStyle(panel).transform === 'none' ? 'translateY(0)' : getComputedStyle(panel).transform }, { transform: 'translateY(100%)' }], { duration: 220, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' });

  // never depend on the animation finishing (paused in background tabs)
  if (out) {
    out.onfinish = finish;
    setTimeout(finish, 320);
  }
  else {
    finish();
  }

  if (onClose) onClose({ fromRoute });

}


/*
 * VIEWER: a poster at full resolution, over everything (a second modal
 * dialog above the sheet). The picture fits the screen first; a tap (or
 * Enter) shows it at its real size; it scrolls, and phones can pinch-zoom
 * the page as usual. Esc, the close button or a tap beside it closes it.
 */
export function openViewer(image) {

  closeViewer();

  const img = h('img', {
    class: 'viewer__img',
    src: image.src,
    width: image.w,
    height: image.h,
    alt: image.alt || '',
    decoding: 'async'
  });
  if (image.color) img.style.backgroundColor = image.color;

  const toggle = () => {
    const zoomed = !scroller.classList.contains('is-zoomed');
    // keep the point under the finger roughly where it was
    const fx = scroller.scrollWidth ? (scroller.scrollLeft + scroller.clientWidth / 2) / scroller.scrollWidth : 0.5;
    const fy = scroller.scrollHeight ? (scroller.scrollTop + scroller.clientHeight / 2) / scroller.scrollHeight : 0.5;
    scroller.classList.toggle('is-zoomed', zoomed);
    scroller.setAttribute('aria-pressed', String(zoomed));
    scroller.scrollLeft = fx * scroller.scrollWidth - scroller.clientWidth / 2;
    scroller.scrollTop = fy * scroller.scrollHeight - scroller.clientHeight / 2;
  };

  const scroller = h('div', {
    class: 'viewer__scroll',
    role: 'button',
    tabindex: '0',
    'aria-pressed': 'false',
    'aria-label': 'تكبير وتصغير الصورة',
    onclick: event => { if (event.target === img) toggle(); else closeViewer(); },
    onkeydown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); } }
  }, img);

  const close = h('button', { class: 'viewer__close', type: 'button', 'aria-label': 'قفل الصورة', onclick: () => closeViewer() }, iconNode('close'));

  // a very tall poster starts at the screen's width (scroll down to read it)
  const dialog = h('dialog', { class: `viewer${image.w / image.h < 0.5 ? ' viewer--tall' : ''}`, 'aria-label': image.alt || 'الصورة' }, scroller, close);

  document.body.append(dialog);
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    closeViewer();
  });

  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');

  close.focus({ preventScroll: true });
  animate(dialog, [{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.22, 1, .36, 1)' });
  play('open');

  return dialog;

}


export function closeViewer() {

  const dialog = document.querySelector('dialog.viewer');

  if (!dialog) return;
  if (dialog.open) dialog.close();
  dialog.remove();

}


export function sheetOpen() {

  return !!current;

}


/* drag the panel down; let go far or fast enough and it closes */
function enableDrag(handle, panel) {

  let startY = 0;
  let lastY = 0;
  let lastTime = 0;
  let velocity = 0;
  let dragging = false;

  handle.addEventListener('pointerdown', event => {
    if (event.target.closest('button')) return;
    dragging = true;
    startY = lastY = event.clientY;
    lastTime = event.timeStamp;
    velocity = 0;
    handle.setPointerCapture(event.pointerId);
    panel.style.transition = 'none';
  });

  handle.addEventListener('pointermove', event => {
    if (!dragging) return;
    const dy = Math.max(0, event.clientY - startY);
    velocity = (event.clientY - lastY) / Math.max(1, event.timeStamp - lastTime);
    lastY = event.clientY;
    lastTime = event.timeStamp;
    panel.style.transform = `translateY(${dy}px)`;
  });

  const end = () => {
    if (!dragging) return;
    dragging = false;
    const dy = Math.max(0, lastY - startY);
    if (dy > 110 || velocity > 0.6) {
      closeSheet();
      return;
    }
    const from = panel.style.transform || 'translateY(0)';
    panel.style.transform = '';
    animate(panel, [{ transform: from }, { transform: 'translateY(0)' }], { duration: 420, easing: SPRING });
  };

  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);

}
