/**
 * SHARE + QR
 *
 * Native share sheet where available, copy-link fallback, and a branded QR
 * card (canvas) that can be shown to a friend or downloaded for printing.
 * The QR library is only loaded when the QR dialog is opened.
 */

import { h } from './dom.js';
import { iconNode } from './icons.js';

const QR_CARD = { width: 1200, height: 1500 };


/* The canonical page address, whatever host serves it. */
export function pageUrl() {

  return `${location.origin}${location.pathname}`.replace(/index\.html$/, '');

}


/* ---------- toast ---------- */

let toastTimer = 0;

export function toast(message) {

  const el = document.getElementById('toast');

  el.textContent = message;
  el.classList.add('is-visible');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2600);

}


/* ---------- copy / share ---------- */

async function copyText(text) {

  try {
    await navigator.clipboard.writeText(text);
    return true;
  }
  catch {
    // older in-app browsers
    const area = h('textarea', { readonly: true, class: 'visually-hidden' });
    area.value = text;
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    }
    catch {
      ok = false;
    }
    area.remove();
    return ok;
  }

}


export async function copyLink() {

  const url = pageUrl();

  toast(await copyText(url) ? 'اتنسخ اللينك ✓' : url);

}


export async function shareLink(site) {

  const url = pageUrl();

  if (navigator.share) {
    try {
      await navigator.share({ title: site.name, text: site.shareText || site.name, url });
      return;
    }
    catch (error) {
      if (error && error.name === 'AbortError') {
        return;
      }
    }
  }

  await copyLink();

}


/* ---------- QR card ---------- */

function loadImage(src) {

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

}


function roundRect(ctx, x, y, w, h, r) {

  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();

}


function isFinder(row, col, count) {

  const inBox = (r, c) => row >= r && row < r + 7 && col >= c && col < c + 7;

  return inBox(0, 0) || inBox(0, count - 7) || inBox(count - 7, 0);

}


async function drawQrCard(canvas, site, url) {

  const { default: qrcode } = await import('../vendor/qrcode.mjs');

  const qr = qrcode(0, 'H');
  qr.addData(url);
  qr.make();

  await Promise.all([
    document.fonts.load('700 60px "Aref Ruqaa"'),
    document.fonts.load('800 44px "Cairo"')
  ]).catch(() => {});

  const logo = await loadImage('assets/img/logo-256.webp').catch(() => null);

  const { width: W, height: H } = QR_CARD;

  canvas.width = W;
  canvas.height = H;

  const ctx = canvas.getContext('2d');

  // background
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0e3560');
  bg.addColorStop(.55, '#061a31');
  bg.addColorStop(1, '#020914');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // double gold frame
  ctx.strokeStyle = 'rgba(242, 210, 139, .45)';
  ctx.lineWidth = 3;
  roundRect(ctx, 36, 36, W - 72, H - 72, 56);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(242, 210, 139, .18)';
  ctx.lineWidth = 2;
  roundRect(ctx, 52, 52, W - 104, H - 104, 44);
  ctx.stroke();

  // logo
  if (logo) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, .5)';
    ctx.shadowBlur = 30;
    ctx.drawImage(logo, W / 2 - 95, 96, 190, 190);
    ctx.restore();
  }

  // name
  const words = site.name.split(/\s+/);
  const lead = words.length > 5 ? words.slice(0, 3).join(' ') : site.name;
  const rest = words.length > 5 ? words.slice(3).join(' ') : '';

  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f2d28b';
  ctx.font = '700 66px "Aref Ruqaa", "Cairo", serif';
  ctx.fillText(lead, W / 2, 378, W - 160);

  if (rest) {
    ctx.fillStyle = '#e7cf9c';
    ctx.font = '700 40px "Aref Ruqaa", "Cairo", serif';
    ctx.fillText(rest, W / 2, 442, W - 160);
  }

  // QR on white
  const box = 680;
  const boxX = (W - box) / 2;
  const boxY = 500;

  ctx.fillStyle = '#ffffff';
  roundRect(ctx, boxX, boxY, box, box, 40);
  ctx.fill();

  const count = qr.getModuleCount();
  const quiet = 4;
  const cell = box / (count + quiet * 2);
  const origin = { x: boxX + quiet * cell, y: boxY + quiet * cell };

  ctx.fillStyle = '#061a31';

  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (!qr.isDark(row, col) || isFinder(row, col, count)) {
        continue;
      }
      // solid modules (slightly overlapping, no hairline gaps) scan reliably on print
      ctx.fillRect(origin.x + col * cell - .25, origin.y + row * cell - .25, cell + .5, cell + .5);
    }
  }

  // rounded finder patterns
  for (const [r, c] of [[0, 0], [0, count - 7], [count - 7, 0]]) {
    const x = origin.x + c * cell;
    const y = origin.y + r * cell;
    ctx.fillStyle = '#061a31';
    roundRect(ctx, x, y, cell * 7, cell * 7, cell * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, x + cell, y + cell, cell * 5, cell * 5, cell * 1.4);
    ctx.fill();
    ctx.fillStyle = '#061a31';
    roundRect(ctx, x + cell * 2, y + cell * 2, cell * 3, cell * 3, cell);
    ctx.fill();
  }

  // logo in the middle (error correction H keeps it scannable)
  if (logo) {
    const size = box * .17;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(W / 2, boxY + box / 2, size / 2 + cell * .9, 0, Math.PI * 2);
    ctx.fill();
    ctx.drawImage(logo, W / 2 - size / 2, boxY + box / 2 - size / 2, size, size);
  }

  // caption
  ctx.fillStyle = '#f5f7fb';
  ctx.font = '800 50px "Cairo", sans-serif';
  ctx.fillText('امسح الكود', W / 2, 1290);

  ctx.direction = 'ltr';
  ctx.fillStyle = '#b9c5d5';
  ctx.font = '600 32px "Cairo", sans-serif';
  ctx.fillText(url.replace(/^https?:\/\//, '').replace(/\/$/, ''), W / 2, 1350, W - 160);

}


let dialog = null;

export async function openQr(site) {

  const url = pageUrl();

  if (!dialog) {

    const canvas = h('canvas', { class: 'qr-canvas', role: 'img', 'aria-label': 'كود QR لرابط الصفحة' });

    const close = () => dialog.close();

    dialog = h('dialog', { class: 'qr-dialog', 'aria-labelledby': 'qr-title' },
      h('div', { class: 'qr-dialog__inner' },
        h('div', { class: 'qr-dialog__head' },
          h('h2', { class: 'qr-dialog__title', id: 'qr-title' }, 'كود الصفحة'),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'قفل', onclick: close }, iconNode('close'))
        ),
        canvas,
        h('p', { class: 'qr-dialog__url ltr' }, url),
        h('div', { class: 'qr-dialog__actions' },
          h('button', {
            class: 'btn btn--primary',
            type: 'button',
            onclick: () => canvas.toBlob(blob => {
              if (!blob) {
                toast('مقدرناش نجهز الصورة');
                return;
              }
              const href = URL.createObjectURL(blob);
              const a = h('a', { href, download: 'athanasios-safaga-qr.png' });
              document.body.append(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(href), 4000);
            }, 'image/png')
          }, iconNode('download'), 'حمّل الصورة'),
          h('button', { class: 'btn', type: 'button', onclick: copyLink }, iconNode('copy'), 'انسخ اللينك'),
          h('button', { class: 'btn', type: 'button', onclick: () => shareLink(site) }, iconNode('share'), 'شارك')
        )
      )
    );

    // tap outside the card closes
    dialog.addEventListener('click', event => {
      if (event.target === dialog) {
        close();
      }
    });

    document.body.append(dialog);

    try {
      await drawQrCard(canvas, site, url);
    }
    catch (error) {
      console.error(error);
      toast('مقدرناش نعمل الكود دلوقتي');
      dialog.remove();
      dialog = null;
      return;
    }

  }

  if (typeof dialog.showModal === 'function') {
    dialog.showModal();
  }
  else {
    dialog.setAttribute('open', '');
  }

}
