/*
 * Proof images: the type is decided by the file's first bytes, never by the
 * client's Content-Type, and the pixel size is read from the header
 * (EVENTS.md §6: image/webp or image/jpeg, ≤ 900 KB, ≤ 2400 px).
 */

export const PROOF_MAX_BYTES = 900 * 1024;
export const PROOF_MAX_SIDE = 2400;

const u16be = (b, i) => (b[i] << 8) | b[i + 1];
const u16le = (b, i) => b[i] | (b[i + 1] << 8);
const u24le = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);

function jpegSize(b) {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
    const len = u16be(b, i + 2);
    // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: u16be(b, i + 5), width: u16be(b, i + 7) };
    }
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

function webpSize(b) {
  const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (chunk === 'VP8 ' && b.length >= 30) return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  if (chunk === 'VP8L' && b.length >= 25 && b[20] === 0x2f) {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X' && b.length >= 30) return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  return null;
}

/* { mime, width, height } or null when it is not an accepted, readable image. */
export function sniffImage(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 32) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    const size = jpegSize(b);
    return size ? { mime: 'image/jpeg', ...size } : null;
  }
  const riff = String.fromCharCode(b[0], b[1], b[2], b[3]);
  const webp = String.fromCharCode(b[8], b[9], b[10], b[11]);
  if (riff === 'RIFF' && webp === 'WEBP') {
    const size = webpSize(b);
    return size ? { mime: 'image/webp', ...size } : null;
  }
  return null;
}
