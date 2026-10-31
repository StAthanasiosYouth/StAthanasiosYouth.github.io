/**
 * YOUTH ACCOUNT: the photo sheet (loaded on first use). Choose, drag and zoom inside the arch, save.
 * Drawn again on a canvas at 256 × 256, so what leaves the phone is small and carries no location or
 * camera data. The server checks it all again (worker/src/account/avatar.js).
 */

import { h } from '../dom.js';
import { cue } from '../ui-sound.js';
import { arDigits } from './model.js';
import { arch, ic, note, toast } from './parts.js';
import { bloom } from './motion.js';

const OUT = 256;
const STAGE = 560;
const MAX_INPUT = 15 * 1024 * 1024;
const MAX_UPLOAD = 60 * 1024;
const ACCEPT = /^image\/(jpeg|png|webp|heic|heif)$/;

const blobOf = (canvas, type, quality) => new Promise(resolve => {
  try {
    canvas.toBlob(resolve, type, quality);
  }
  catch {
    resolve(null);
  }
});

/* WebP where the browser can make one (older Safari gives PNG back: then JPEG); smaller until it fits */
export async function encode(canvas) {
  for (const quality of [0.82, 0.7, 0.55]) {
    let blob = await blobOf(canvas, 'image/webp', quality);
    if (!blob || blob.type !== 'image/webp') blob = await blobOf(canvas, 'image/jpeg', quality);
    if (blob && blob.size <= MAX_UPLOAD) return blob;
  }
  return null;
}

/* person: { firstName, photo }. save(blob) and remove() answer { ok, message } */
export function openPhotoSheet(person, { save, remove, after }) {

  const dialog = h('dialog', { class: 'ac-sheet', 'aria-label': 'صورتك', 'data-photo-sheet': '' });
  const close = () => {
    cue('close');
    if (dialog.open) dialog.close();
  };
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (after) after();
  });
  dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
  document.body.append(dialog);

  const input = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/heic', hidden: true, id: 'ac-photo-file' });
  input.addEventListener('change', () => { if (input.files[0]) pick(input.files[0]); });

  const fill = (...kids) => dialog.replaceChildren(h('div', { class: 'ac-sheet__in' }, h('span', { class: 'ac-sheet__grab' }), kids));

  function choose(error) {
    input.value = '';
    fill(
      h('div', { class: 'ac-sheet__head' },
        arch(person, { size: 'm' }),
        h('h2', { class: 'ac-sheet__t' }, person.photo ? 'صورتك' : 'حط صورتك'),
        h('p', { class: 'ac-lead' }, 'اختيارية. بتظهر ليك إنت، وللخدام المسؤولين عن حسابات الشباب.')),
      error ? note(error, { alert: true }) : null,
      h('div', { class: 'ac-btns' },
        input,
        h('button', { type: 'button', class: 'btn btn--primary', 'data-photo-pick': '', onclick: () => input.click() }, ic('image'), person.photo ? 'اختار صورة تانية' : 'اختار صورة'),
        person.photo ? h('button', { type: 'button', class: 'btn ac-btn--danger', 'data-photo-delete': '', onclick: confirmDelete }, ic('trash'), 'امسح الصورة') : null,
        h('button', { type: 'button', class: 'btn', onclick: close }, 'رجوع')),
      h('p', { class: 'ac-sheet__foot' }, 'JPG أو PNG أو WebP. هنصغّرها على جهازك قبل ما تترفع.'));
  }

  function confirmDelete() {
    const yes = h('button', { type: 'button', class: 'btn ac-btn--danger', 'data-photo-delete-yes': '' }, 'أيوه، امسحها');
    yes.addEventListener('click', async () => {
      yes.disabled = true;
      const reply = await remove();
      if (!reply.ok) {
        cue('nope');
        choose(reply.message || 'مقدرناش نمسحها. جرّب تاني.');
        return;
      }
      person.photo = '';
      dialog.close();
      toast('اتمسحت صورتك.');
      cue('success');
    });
    fill(
      h('div', { class: 'ac-sheet__head' }, h('h2', { class: 'ac-sheet__t' }, 'تمسح صورتك؟'), h('p', { class: 'ac-lead' }, 'هترجع الصورة الافتراضية، وتقدر تحط صورة تانية في أي وقت.')),
      h('div', { class: 'ac-btns ac-btns--2' }, yes, h('button', { type: 'button', class: 'btn', onclick: () => choose() }, 'لأ')));
  }

  async function pick(file) {
    if (file.type && !ACCEPT.test(file.type)) return choose('الملف ده مش صورة مدعومة. اختار JPG أو PNG أو WebP.');
    if (file.size > MAX_INPUT) return choose('الصورة أكبر من ١٥ ميجا. اختار صورة أصغر.');
    let bitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    }
    catch {
      try {
        bitmap = await createImageBitmap(file);
      }
      catch {
        return choose('مقدرناش نفتح الصورة دي. جرّب صورة تانية.');
      }
    }
    if (!bitmap.width || !bitmap.height) return choose('مقدرناش نفتح الصورة دي. جرّب صورة تانية.');
    crop(bitmap, file.size);
  }

  function crop(bitmap, bytes) {
    const canvas = h('canvas', { width: STAGE, height: STAGE, role: 'img', 'aria-label': 'صورتك جوه العقد. اسحبها عشان تظبطها.' });
    const cover = STAGE / Math.min(bitmap.width, bitmap.height);
    let zoom = 1;
    let x = (STAGE - bitmap.width * cover) / 2;
    let y = (STAGE - bitmap.height * cover) / 2;

    const clamp = () => {
      x = Math.min(0, Math.max(STAGE - bitmap.width * cover * zoom, x));
      y = Math.min(0, Math.max(STAGE - bitmap.height * cover * zoom, y));
    };
    const paint = (ctx, size, mask) => {
      const k = size / STAGE;
      ctx.clearRect(0, 0, size, size);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, x * k, y * k, bitmap.width * cover * zoom * k, bitmap.height * cover * zoom * k);
      if (!mask) return;
      const r = size * 0.14;
      ctx.fillStyle = 'rgba(2, 9, 20, .62)';
      ctx.beginPath();
      ctx.rect(0, 0, size, size);
      ctx.moveTo(0, size / 2);
      ctx.arc(size / 2, size / 2, size / 2, Math.PI, 0);
      ctx.lineTo(size, size - r);
      ctx.quadraticCurveTo(size, size, size - r, size);
      ctx.lineTo(r, size);
      ctx.quadraticCurveTo(0, size, 0, size - r);
      ctx.closePath();
      ctx.fill('evenodd');
    };
    const draw = () => {
      clamp();
      paint(canvas.getContext('2d'), STAGE, true);
    };

    const zoomer = h('input', { type: 'range', min: '1', max: '3', step: '.01', value: '1', 'aria-label': 'تكبير الصورة' });
    zoomer.addEventListener('input', () => {
      const next = Number(zoomer.value);
      x = STAGE / 2 - (STAGE / 2 - x) * next / zoom;
      y = STAGE / 2 - (STAGE / 2 - y) * next / zoom;
      zoom = next;
      draw();
    });

    const stage = h('div', { class: 'ac-crop', tabindex: '0', 'data-photo-crop': '' }, canvas);
    stage.addEventListener('keydown', event => {
      const move = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] }[event.key];
      if (!move) return;
      event.preventDefault();
      x += move[0];
      y += move[1];
      draw();
    });
    let drag = null;
    stage.addEventListener('pointerdown', event => {
      drag = [event.clientX, event.clientY];
      stage.setPointerCapture(event.pointerId);
    });
    stage.addEventListener('pointermove', event => {
      if (!drag) return;
      const k = STAGE / stage.clientWidth;
      x += (event.clientX - drag[0]) * k;
      y += (event.clientY - drag[1]) * k;
      drag = [event.clientX, event.clientY];
      draw();
    });
    stage.addEventListener('pointerup', () => { drag = null; });
    stage.addEventListener('pointercancel', () => { drag = null; });

    const saveBtn = h('button', { type: 'button', class: 'btn btn--primary', 'data-photo-save': '' }, 'احفظ الصورة');
    const error = h('p', { class: 'field__error', role: 'alert', hidden: true });
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      saveBtn.replaceChildren(h('span', { class: 'ac-spin', 'aria-hidden': 'true' }), 'بنحفظ…');
      error.hidden = true;
      const out = h('canvas', { width: OUT, height: OUT });
      paint(out.getContext('2d'), OUT, false);
      const blob = await encode(out);
      const reply = blob ? await save(blob) : { ok: false, message: 'مقدرناش نجهّز الصورة. جرّب صورة تانية.' };
      if (!reply.ok) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'جرّب تاني';
        error.textContent = reply.message || 'مقدرناش نحفظها. صورتك ما اتغيرتش.';
        error.hidden = false;
        cue('nope');
        return;
      }
      if (bitmap.close) bitmap.close();
      person.photo = reply.photo;
      dialog.close();
      const kb = Math.max(1, Math.round(blob.size / 1024));
      toast('اتحفظت صورتك، ' + arDigits(kb) + ' ك.ب بدل ' + arDigits(Math.round(bytes / 1024)) + ' ك.ب');
      cue('success');
      bloom(document.querySelector('.ac-hero .ac-arch, .ac-rail .ac-arch'));
    });

    fill(
      h('h2', { class: 'ac-sheet__t' }, 'ظبّط صورتك'),
      stage,
      h('label', { class: 'ac-zoom' }, ic('image'), zoomer),
      error,
      h('div', { class: 'ac-btns ac-btns--2' }, saveBtn, h('button', { type: 'button', class: 'btn', onclick: () => choose() }, 'رجوع')));
    draw();
  }

  choose();
  dialog.showModal();
  cue('open');

}
