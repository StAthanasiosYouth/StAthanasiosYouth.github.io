/*
 * «خبزنا اليومي» — helpers for the Van Dyck text (assets/bible/vd/<BOOK>.json).
 * Nothing on the site loads this yet (W5 uses it for the «من غير تشكيل» toggle and the Agpeya psalm number).
 */

// Arabic harakat (fathatan … sukun), the dagger alef and the Quranic marks above/below; the letters stay.
const MARKS = /[ً-ٰٟۖ-ۭ]/g;

/* «من غير تشكيل» (decision 4): drops the marks, and the wasla alef «ٱ» becomes a plain «ا» so the word still reads right. */
export function stripTashkeel(s) {
  return String(s ?? '').replace(MARKS, '').replace(/ٱ/g, 'ا');
}

/*
 * Psalm number in the Agpeya / Katameros (Septuagint numbering) for a Van Dyck (Hebrew numbering) psalm (decision 6).
 *   1–8 same · 9 and 10 → 9 · 11–113 → n−1 · 114 and 115 → 113 · 116: 1–9 → 114, 10–19 → 115
 *   117–146 → n−1 · 147: 1–11 → 146, 12–20 → 147 · 148–150 same
 * Without a verse, a split psalm gives the number of its first part.
 */
export function agpeyaPsalm(psalm, verse = 1) {
  const n = Number(psalm);
  if (!Number.isInteger(n) || n < 1 || n > 150) return null;
  if (n <= 8) return n;
  if (n <= 10) return 9;
  if (n <= 113) return n - 1;
  if (n <= 115) return 113;
  if (n === 116) return verse >= 10 ? 115 : 114;
  if (n <= 146) return n - 1;
  if (n === 147) return verse >= 12 ? 147 : 146;
  return n;
}
