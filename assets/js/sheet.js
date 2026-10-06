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

  if (typeof dialog.showModal === 'function') {
    dialog.showModal();
  }
  else {
    dialog.setAttribute('open', '');
  }

  // start on the title: no focus ring on the close button, screen readers
  // hear what opened; Tab goes on to the close button and the content
  head.firstChild.focus({ preventScroll: true });

  current = { dialog, panel, onClose };

  animate(panel, [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], { duration: 620, easing: SPRING });
  play('open');

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
