/**
 * ROUTES FOR THE PUBLIC PAGE («الاتجاهات»)
 *
 * The page's map card asks for a route from the visitor's starting point to
 * the church. The openrouteservice.org (HeiGIT) key stays here, in the Script
 * Property ORS_API_KEY; it never reaches the browser or the repository.
 *
 *   publicRoute_({ profile: 'driving-car' | 'foot-walking', from: [lng, lat] })
 *     → { ok: true, profile, distance (m), duration (s), geometry: [[lng, lat], …] }
 *     → { ok: false, code: 'config' | 'busy' | 'invalid' | 'upstream', message }
 *
 * Rules:
 *  - the destination is never taken from the request: it is the church
 *    (location.lat / location.lng in Settings, else ROUTE_CHURCH);
 *  - `from` must be two finite numbers inside Egypt and within
 *    ROUTE_MAX_KM of the church; it is rounded to 4 decimals (≈ 11 m);
 *  - answers are cached for 6 h per profile + rounded start (CacheService);
 *  - at most ROUTE_PER_MINUTE upstream calls a minute and ROUTE_PER_DAY a
 *    day (the free plan allows 40 and 2,000); beyond that: 'busy' (the
 *    minute in CacheService, the UTC day in the Script Property
 *    ROUTE_DAY_COUNT = "YYYY-MM-DD:n");
 *  - the visitor's coordinates are never logged or stored anywhere else;
 *    replies carry only the fields above (never the key or upstream text).
 */

var ROUTE_PROFILES = ['driving-car', 'foot-walking'];
var ROUTE_ENDPOINT = 'https://api.openrouteservice.org/v2/directions/';
var ROUTE_CHURCH = { lat: 26.7314392, lng: 33.9379229 };
var ROUTE_EGYPT = { minLng: 24.7, maxLng: 37.0, minLat: 21.9, maxLat: 31.8 };
var ROUTE_MAX_KM = 400;
var ROUTE_MAX_POINTS = 400;
var ROUTE_CACHE_SECONDS = 21600;
var ROUTE_PER_MINUTE = 30;
var ROUTE_PER_DAY = 1500;

var ROUTE_MESSAGES = {
  config: 'الاتجاهات جوه الموقع مش متاحة دلوقتي. افتحها في خرائط جوجل.',
  busy: 'خدمة الاتجاهات عليها ضغط دلوقتي. جرّب كمان شوية، أو افتحها في خرائط جوجل.',
  invalid: 'مش لاقيين طريق من النقطة دي. جرّب نقطة تانية قريبة من شارع.',
  upstream: 'خدمة الاتجاهات مش بترد دلوقتي. جرّب تاني بعد شوية، أو افتحها في خرائط جوجل.'
};


function publicRoute_(request) {

  try {
    return routeFor_(request);
  }
  catch (ignored) {
    // nothing about the request (or the error) is logged
    return routeFailure_('upstream');
  }

}


function routeFor_(request) {

  var profile = request && typeof request === 'object' ? request.profile : null;
  var from = request && typeof request === 'object' ? request.from : null;

  if (ROUTE_PROFILES.indexOf(profile) === -1 || !Array.isArray(from) || from.length !== 2 ||
      typeof from[0] !== 'number' || typeof from[1] !== 'number' || !isFinite(from[0]) || !isFinite(from[1])) {
    return routeFailure_('invalid');
  }

  var lng = Math.round(from[0] * 1e4) / 1e4;
  var lat = Math.round(from[1] * 1e4) / 1e4;
  var church = routeChurch_();

  if (lng < ROUTE_EGYPT.minLng || lng > ROUTE_EGYPT.maxLng || lat < ROUTE_EGYPT.minLat || lat > ROUTE_EGYPT.maxLat ||
      routeKm_(lat, lng, church.lat, church.lng) > ROUTE_MAX_KM) {
    return routeFailure_('invalid');
  }

  var cache = CacheService.getScriptCache();
  var cacheKey = 'route:' + profile + ':' + lng.toFixed(4) + ',' + lat.toFixed(4) + ':' + church.lat + ',' + church.lng;
  var cached = cache.get(cacheKey);

  if (cached) {
    return JSON.parse(cached);
  }

  var key = PropertiesService.getScriptProperties().getProperty('ORS_API_KEY');

  if (!key) {
    return routeFailure_('config');
  }

  if (!routeTakeQuota_(cache)) {
    return routeFailure_('busy');
  }

  var response = UrlFetchApp.fetch(ROUTE_ENDPOINT + profile + '/geojson', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: key, Accept: 'application/json, application/geo+json' },
    payload: JSON.stringify({ coordinates: [[lng, lat], [church.lng, church.lat]], instructions: false, units: 'm' }),
    muteHttpExceptions: true
  });

  var status = response.getResponseCode();

  if (status === 401 || status === 403) {
    return routeFailure_('config');
  }

  if (status === 429) {
    return routeFailure_('busy');
  }

  var data = null;

  try {
    data = JSON.parse(response.getContentText());
  }
  catch (ignored) {
    data = null;
  }

  if (status !== 200) {
    // no routable road near the start, or too far for this profile: the start's fault
    var upstreamCode = data && data.error && typeof data.error === 'object' ? Number(data.error.code) : 0;
    if ((status === 404 || status === 400) && [2004, 2009, 2010].indexOf(upstreamCode) !== -1) {
      var unroutable = routeFailure_('invalid');
      cache.put(cacheKey, JSON.stringify(unroutable), ROUTE_CACHE_SECONDS);
      return unroutable;
    }
    return routeFailure_('upstream');
  }

  var feature = data && Array.isArray(data.features) ? data.features[0] : null;
  var line = feature && feature.geometry && Array.isArray(feature.geometry.coordinates) ? feature.geometry.coordinates : null;
  var summary = (feature && feature.properties && feature.properties.summary) || {};

  if (!line || line.length < 2) {
    return routeFailure_('upstream');
  }

  var points = line.filter(function (p) {
    return Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number' && isFinite(p[0]) && isFinite(p[1]);
  });

  if (points.length < 2) {
    return routeFailure_('upstream');
  }

  var result = {
    ok: true,
    profile: profile,
    distance: Math.max(0, Math.round(Number(summary.distance) || 0)),
    duration: Math.max(0, Math.round(Number(summary.duration) || 0)),
    geometry: routeSimplify_(points, ROUTE_MAX_POINTS).map(function (p) {
      return [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5];
    })
  };

  cache.put(cacheKey, JSON.stringify(result), ROUTE_CACHE_SECONDS);

  return result;

}


function routeFailure_(code) {

  return { ok: false, code: code, message: ROUTE_MESSAGES[code] };

}


/* the church: the Settings sheet's coordinates (cached 10 min), else the known ones */
function routeChurch_() {

  var cache = CacheService.getScriptCache();
  var cached = cache.get('route:church');

  if (cached) {
    return JSON.parse(cached);
  }

  var church = ROUTE_CHURCH;

  try {
    var values = {};
    readTable_('Settings').forEach(function (row) {
      if (row.key === 'location.lat' || row.key === 'location.lng') {
        values[row.key] = contentNumber_(row.value);
      }
    });
    var lat = values['location.lat'];
    var lng = values['location.lng'];
    if (typeof lat === 'number' && typeof lng === 'number' && isFinite(lat) && isFinite(lng) &&
        Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      church = { lat: lat, lng: lng };
    }
  }
  catch (ignored) {
    church = ROUTE_CHURCH;
  }

  cache.put('route:church', JSON.stringify(church), 600);

  return church;

}


/*
 * One upstream call against the minute and day budgets. The script lock makes the count exact; when it is busy (an
 * admin publishing) the count is taken anyway: the budgets sit well under
 * the plan's own limits, so a rare race costs nothing.
 */
function routeTakeQuota_(cache) {

  var now = Date.now();
  var minuteKey = 'route:minute:' + Math.floor(now / 60000);
  // the day's count outlives the cache's 6 h: a Script Property "YYYY-MM-DD:n" (UTC day)
  var today = new Date(now).toISOString().slice(0, 10);
  var properties = PropertiesService.getScriptProperties();
  var lock = LockService.getScriptLock();
  var locked = false;

  try {
    locked = lock.tryLock(2000);
  }
  catch (ignored) {
    locked = false;
  }

  try {
    var minute = Number(cache.get(minuteKey)) || 0;
    var stored = String(properties.getProperty('ROUTE_DAY_COUNT') || '').split(':');
    var day = stored[0] === today ? Number(stored[1]) || 0 : 0;
    if (minute >= ROUTE_PER_MINUTE || day >= ROUTE_PER_DAY) {
      return false;
    }
    cache.put(minuteKey, String(minute + 1), 120);
    properties.setProperty('ROUTE_DAY_COUNT', today + ':' + (day + 1));
    return true;
  }
  finally {
    if (locked) {
      lock.releaseLock();
    }
  }

}


/* great-circle distance in km */
function routeKm_(lat1, lng1, lat2, lng2) {

  var rad = Math.PI / 180;
  var dLat = (lat2 - lat1) * rad;
  var dLng = (lng2 - lng1) * rad;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

}


/*
 * Douglas–Peucker, the tolerance growing until the line has at most `max`
 * points (the ends always stay). Degrees are fine at this scale.
 */
function routeSimplify_(points, max) {

  if (points.length <= max) {
    return points;
  }

  var tolerance = 0.00002;
  var out = points;

  while (out.length > max) {
    out = routeDouglasPeucker_(points, tolerance);
    tolerance *= 2;
  }

  return out;

}


function routeDouglasPeucker_(points, tolerance) {

  var keep = new Array(points.length);
  var stack = [[0, points.length - 1]];

  keep[0] = true;
  keep[points.length - 1] = true;

  while (stack.length) {

    var span = stack.pop();
    var first = span[0];
    var last = span[1];
    var worst = -1;
    var index = -1;

    for (var i = first + 1; i < last; i++) {
      var d = routeOffset_(points[i], points[first], points[last]);
      if (d > worst) {
        worst = d;
        index = i;
      }
    }

    if (index !== -1 && worst > tolerance) {
      keep[index] = true;
      stack.push([first, index], [index, last]);
    }

  }

  return points.filter(function (p, i) { return keep[i]; });

}


/* distance from p to the segment a–b (in degrees) */
function routeOffset_(p, a, b) {

  var dx = b[0] - a[0];
  var dy = b[1] - a[1];
  var length = dx * dx + dy * dy;
  var t = length ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length)) : 0;
  var x = a[0] + t * dx - p[0];
  var y = a[1] + t * dy - p[1];

  return Math.sqrt(x * x + y * y);

}
