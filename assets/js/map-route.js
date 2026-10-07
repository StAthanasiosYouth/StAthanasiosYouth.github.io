/**
 * ROUTE WORDS AND WIRE FORMAT (pure; map.js uses them, tests/final-m.test.mjs
 * checks them in Node)
 *
 * The page asks the Apps Script web app (map-config.js routeUrl, Route.gs)
 * for a route from the visitor's start to the church. Only the start travels,
 * rounded to 4 decimals (≈ 11 m); the church is the server's own.
 */

import { arabicDigits, countMinutes } from './words.js';

export const PROFILES = { car: 'driving-car', foot: 'foot-walking' };

export const ROUTE_TEXT = {
  config: 'الاتجاهات جوه الموقع مش متاحة دلوقتي. افتحها في خرائط جوجل.',
  busy: 'خدمة الاتجاهات عليها ضغط دلوقتي. جرّب كمان شوية، أو افتحها في خرائط جوجل.',
  invalid: 'مش لاقيين طريق من النقطة دي. اختار نقطة تانية قريبة من شارع.',
  upstream: 'خدمة الاتجاهات مش بترد دلوقتي. جرّب تاني بعد شوية، أو افتحها في خرائط جوجل.',
  offline: 'مفيش اتصال بالإنترنت دلوقتي. اتأكد من الاتصال وجرّب تاني، أو افتحها في خرائط جوجل.',
  denied: 'مش قادرين نوصل لموقعك. اختار نقطة البداية على الخريطة.',
  unavailable: 'موقعك مش واضح دلوقتي. اختار نقطة البداية على الخريطة.',
  locating: 'بنحدد موقعك…',
  routing: 'بنحسب الطريق…',
  slow: 'أبطأ من العادي شوية… لسه بنحسب الطريق.',
  pick: 'دوس على الخريطة في المكان اللي هتبدأ منه (أو حرّك الخريطة بالأسهم واضغط Enter).'
};

const round4 = n => Math.round(n * 1e4) / 1e4;


/* 850 → "٨٥٠ متر", 2430 → "٢٫٤ كم", 12600 → "١٣ كم" */
export function formatDistance(meters) {

  const m = Math.max(0, Number(meters) || 0);

  if (m < 950) {
    return `${arabicDigits(Math.max(10, Math.round(m / 10) * 10))} متر`;
  }

  const km = m / 1000;
  const text = km < 10 ? String(Math.round(km * 10) / 10) : String(Math.round(km));

  return `${arabicDigits(text.replace('.', '٫'))} كم`;

}


/* seconds → "١٢ دقيقة", "ساعة و١٠ دقايق" (at least a minute) */
export function formatDuration(seconds) {

  return countMinutes(Math.max(1, Math.round((Number(seconds) || 0) / 60)));

}


/* the POST body for routeUrl: { fn: 'route', args: [{ profile, from: [lng, lat] }] } */
export function routeBody(profile, start) {

  return JSON.stringify({ fn: 'route', args: [{ profile, from: [round4(start.lng), round4(start.lat)] }] });

}


/*
 * The web app's answer → { ok: true, distance, duration, line: [[lat, lng]…] }
 * or { ok: false, code }. Accepts the route itself or wrapped in { result }.
 */
export function readRoute(data) {

  const answer = data && typeof data === 'object' && data.result && typeof data.result === 'object' ? data.result : data;

  if (!answer || typeof answer !== 'object' || answer.ok !== true) {
    const code = answer && typeof answer.code === 'string' && ROUTE_TEXT[answer.code] && ['config', 'busy', 'invalid'].includes(answer.code) ? answer.code : 'upstream';
    return { ok: false, code };
  }

  const line = Array.isArray(answer.geometry)
    ? answer.geometry.filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).map(p => [p[1], p[0]])
    : [];

  if (line.length < 2 || !Number.isFinite(answer.distance) || !Number.isFinite(answer.duration)) {
    return { ok: false, code: 'upstream' };
  }

  return { ok: true, distance: answer.distance, duration: answer.duration, line };

}
