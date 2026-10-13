/**
 * «نقاطي / المتجر» — the main page's entry (content.json `points`,
 * docs/COMPETITIONS.md §18.4). Pure: no DOM, no network (tested in Node).
 *
 * The store's state is computed here from Cairo time, the same rule as the
 * server's shopState_ (§18.3; the server enforces, this only informs):
 *   mode open   → open        mode closed → closed
 *   mode auto   → before opensAt: scheduled; from closesAt on: closed; else open
 * Loaded by render.js only when content.json has `points` (no request otherwise).
 */

import { realMinutesBetween, dayNumberOf } from './schedule.js';
import { DAY_NAMES, formatTime, formatDate, untilText, leftText } from './words.js';

const SEASON_WARN_MINUTES = 7 * 1440;


/** the store's state now: 'open' | 'scheduled' | 'closed' | '' (no store) */
export function shopState(shop, nowStamp) {

  if (!shop || shop.on !== true) return '';
  if (shop.mode === 'open') return 'open';
  if (shop.mode === 'closed') return 'closed';
  if (shop.opensAt && nowStamp < shop.opensAt) return 'scheduled';
  if (shop.closesAt && nowStamp >= shop.closesAt) return 'closed';

  return 'open';

}


/* "النهارده الساعة ٨ بالليل", "بكره الساعة ٧ بالليل", "الخميس الساعة ٨ بالليل",
   "الخميس ٢٢ أكتوبر الساعة ٨ بالليل" (a week or more away) */
export function whenText(target, nowStamp) {

  const days = dayNumberOf(target) - dayNumberOf(nowStamp);
  const [h, m] = target.slice(11, 16).split(':').map(Number);
  const time = `الساعة ${formatTime(h * 60 + m)}`;

  if (days <= 0) return `النهارده ${time}`;
  if (days === 1) return `بكره ${time}`;

  const [y, mo, d] = target.slice(0, 10).split('-').map(Number);
  const weekday = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();

  return days <= 6 ? `${DAY_NAMES[weekday]} ${time}` : `${formatDate({ day: d, month: mo, weekday })} ${time}`;

}


/** «الموسم بيخلص بعد ٣ أيام» while 7 days or less are left; '' otherwise */
export function seasonLine(season, nowStamp) {

  if (!season || !season.endAt || nowStamp >= season.endAt) return '';

  const minutes = realMinutesBetween(nowStamp, season.endAt);

  if (minutes === null || minutes > SEASON_WARN_MINUTES) return '';

  return `الموسم بيخلص ${untilText(minutes)}`;

}


/**
 * What the widget says now:
 * { state: 'open'|'scheduled'|'closed'|'', title, headline, detail, season, key }
 * key changes whenever the wording changes (the page repaints on its tick).
 */
export function pointsWidgetState(points, nowStamp) {

  if (!points) return null;

  const state = shopState(points.shop, nowStamp);
  const shop = points.shop || {};
  let headline = 'نقاطك ومسابقاتك في مكان واحد';
  let detail = '';

  if (state === 'open') {
    const closing = shop.mode === 'auto' && shop.closesAt ? shop.closesAt : '';
    headline = closing ? `المتجر مفتوح لحد ${whenText(closing, nowStamp)}` : 'المتجر مفتوح دلوقتي';
    const left = closing ? realMinutesBetween(nowStamp, closing) : null;
    detail = left !== null && left < 1440 ? `بيقفل ${untilText(left)} — اطلب جايزتك بنقاطك` : 'اطلب جايزتك بنقاطك';
  }
  else if (state === 'scheduled') {
    headline = `المتجر بيفتح ${whenText(shop.opensAt, nowStamp)}`;
    detail = leftText(realMinutesBetween(nowStamp, shop.opensAt) ?? 1);
  }
  else if (state === 'closed') {
    headline = 'المتجر مقفول — نقاطك محفوظة';
    detail = 'شوف نقاطك وطلباتك';
  }

  const season = seasonLine(points.season, nowStamp);

  return {
    state,
    title: state ? 'نقاطي والمتجر' : 'نقاطي',
    headline,
    detail,
    season,
    key: [state, headline, detail, season].join('|')
  };

}
