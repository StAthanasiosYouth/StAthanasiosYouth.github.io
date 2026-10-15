/**
 * A PAYMENT PROOF, READY TO SEND (docs/EVENTS.md §6 «Visitor-side image
 * preparation»; the admin's prepareImage in apps-script/AdminScript.html)
 *
 *  - decoded the way the phone shows it (EXIF orientation)
 *  - longest side ≤ 1600 px (halved step by step, then one smooth step:
 *    big phone photos come out sharp)
 *  - WebP at quality 0.82 (JPEG where the browser can't make WebP, e.g.
 *    Safari), stepped down until ≤ 600 KB; still too big → a smaller side
 *  - HEIC / PNG work when the browser can open them; otherwise the
 *    visitor reads «الصورة دي مش مدعومة، ابعت سكرين شوت»
 * The Worker's hard limit is 900 KB / 2400 px (it checks again).
 */

export const PROOF_IMAGE = {
  maxInputBytes: 40 * 1024 * 1024,
  side: 1600,
  target: 600 * 1024,
  hardLimit: 900 * 1024,
  qualities: [0.82, 0.74, 0.66, 0.58, 0.5]
};

export const UNSUPPORTED = 'الصورة دي مش مدعومة، ابعت سكرين شوت';

export class ProofImageError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function canvasBlob(canvas, type, quality) {
  return new Promise(resolve => {
    try {
      canvas.toBlob(resolve, type, quality);
    }
    catch {
      resolve(null);
    }
  });
}

async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    }
    catch {
      try {
        return await createImageBitmap(file);
      }
      catch {
        // an <img> below (some browsers open more types there)
      }
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    }).then(img => (img.decode ? img.decode().then(() => img, () => img) : img));
  }
  finally {
    // the picture is drawn right away; the address is no longer needed after that
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}

function scaled(source, maxSide) {
  const width = source.width || source.naturalWidth;
  const height = source.height || source.naturalHeight;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));
  let current = source;
  let currentW = width;
  let currentH = height;

  while (currentW / 2 >= targetW * 1.25) {
    const half = document.createElement('canvas');
    half.width = Math.round(currentW / 2);
    half.height = Math.round(currentH / 2);
    const ctx = half.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(current, 0, 0, half.width, half.height);
    current = half;
    currentW = half.width;
    currentH = half.height;
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  // a transparent PNG gets a white page behind it (WebP/JPEG of a screenshot)
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, targetW, targetH);
  ctx.drawImage(current, 0, 0, targetW, targetH);
  return canvas;
}

async function encode(canvas, target) {
  let blob = null;
  for (const quality of PROOF_IMAGE.qualities) {
    blob = await canvasBlob(canvas, 'image/webp', quality);
    // Safari can't make WebP and quietly hands back a PNG
    if (!blob || blob.type !== 'image/webp') blob = await canvasBlob(canvas, 'image/jpeg', quality);
    if (blob && blob.size <= target) break;
  }
  return blob;
}

/**
 * file → { blob (image/webp | image/jpeg), width, height, bytesIn }
 * Throws ProofImageError: code 'unsupported' (its message is the words to show).
 */
export async function prepareImage(file) {

  const heic = /\.(heic|heif)$/i.test(file.name || '') || /heic|heif/i.test(file.type || '');
  if (file.type && !/^image\//.test(file.type) && !heic) throw new ProofImageError(UNSUPPORTED, 'unsupported');
  if (file.size > PROOF_IMAGE.maxInputBytes) throw new ProofImageError('الصورة كبيرة قوي. ابعت سكرين شوت.', 'too_big');

  let bitmap;
  try {
    bitmap = await loadBitmap(file);
  }
  catch {
    throw new ProofImageError(UNSUPPORTED, 'unsupported');
  }
  if (!bitmap || !(bitmap.width || bitmap.naturalWidth)) throw new ProofImageError(UNSUPPORTED, 'unsupported');

  let side = PROOF_IMAGE.side;
  let canvas = null;
  let blob = null;
  for (let round = 0; round < 4; round++) {
    canvas = scaled(bitmap, side);
    blob = await encode(canvas, PROOF_IMAGE.target);
    if (blob && blob.size <= PROOF_IMAGE.target) break;
    side = Math.round(side * 0.75);
  }
  if (bitmap.close) bitmap.close();

  if (!blob || blob.size > PROOF_IMAGE.hardLimit || !/^image\/(webp|jpeg)$/.test(blob.type)) throw new ProofImageError(UNSUPPORTED, 'unsupported');

  return { blob, width: canvas.width, height: canvas.height, bytesIn: file.size };

}
