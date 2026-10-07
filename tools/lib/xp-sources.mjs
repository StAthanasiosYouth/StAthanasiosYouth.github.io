// The scenes' real material: which original, which part (tools/build-xp-media.mjs,
// tools/xp-provenance.mjs). The originals live on the author's machine.

export const POSTERS_SRC = 'E:/اجتماع الشباب/';
export const GAMES_SRC = 'F:/Adobe/فيديوهات فقرات ألعاب الأجتماع/';

/* the weekly posters (newest first): date, file, topic, guest (as printed) */
export const POSTERS = [
  ['2026-10-04', '2026-10-4/بوستر.png', 'Why me?', ''],
  ['2026-09-27', '2026-9-27/بوستر.png', 'اتخاذ القرار', 'م/ أرمانيوس عزيز'],
  ['2026-09-20', '2026-9-20/بوستر.png', 'حياة التسليم', 'أبونا أنطوني عياد'],
  ['2026-09-13', '2026-9-13/بوستر.png', 'اللسان والإدانة', ''],
  ['2026-09-06', '2026-9-6/بوستر.png', 'الانطوائية', ''],
  ['2026-08-09', '2026-8-9/poster.png', 'القلق والخوف', ''],
  ['2026-08-02', '2026-8-2/بوستر.png', 'الثبات الروحي', ''],
  ['2026-07-26', '2026-7-26/بوستر.png', 'اكتشاف الذات', ''],
  ['2026-07-12', '2026-7-12/بوستر.png', 'الصداقة', 'أبونا أنجيلوس'],
  ['2026-07-05', '2026-7-5/بوستر.png', 'الصلاة', '']
];

/* game segments: [id, source, [[from, to]…], landscape?, poster at (s), caption]
   real moments of people playing, cut from the original camera/phone files
   (or the segment's own edited export), wide or medium-wide group shots */
export const CLIPS = [
  ['saboona', 'لعبة الصابونة و المصاصة/فيديو.mp4', [[86.1, 89.8]], true, 3.0, 'تحدي المصاصة والصابونة'],
  ['asela', 'أسئلة سريعة/٢٠٢٦٠٥٠٣_٢٢٣٢٥٢.mp4', [[57.6, 62.6]], false, 2.0, 'أسئلة سريعة'],
  ['timer', 'لعبة الTimer/فيديوهات/٢٠٢٦٠٨٠٢_٢١٣٩٥٩.mp4', [[434.0, 438.5]], true, 1.6, 'لعبة الـTimer'],
  ['khamen', 'خمن الورقة/٢٠٢٦٠٥١٠_٢٢٢٩٠٣.mp4', [[68.5, 73.5]], true, 3.0, 'خمن الورقة'],
  ['metgawzeen', 'لعبة المتجوزين/مجلد ١/٢٠٢٦٠٥٢٤_٢٢٢٦٣٨.mp4', [[27.6, 32.4]], true, 2.6, 'لعبة المتجوزين'],
  ['sot', 'فيديو تمثيل الصوت/٢٠٢٦١٠٠٤_٢١٥٠٠٠.mp4', [[76.5, 81.5]], false, 2.5, 'تمثيل الصوت']
];
