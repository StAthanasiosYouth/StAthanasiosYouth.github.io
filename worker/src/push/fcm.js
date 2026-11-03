/*
 * FCM HTTP v1 (docs/PHASE6-PLAN.md Step 4b, BACKEND-MIGRATION §22.2.4): the key, the access token, one message model.
 * Push.gs did the same with Utilities; here it is WebCrypto.
 *
 * - FCM_SERVICE_ACCOUNT (a Worker secret): the whole service-account JSON. Read here only; never logged, never
 *   returned, never sent anywhere but Google's token endpoint, and then as a signature, not the key.
 * - The access token lives in this isolate's memory (≈ 50 min), never in D1.
 * - One message model for every device: data for the web (sw.js and admin/sw.js show it), plus the `android` and
 *   `apns` blocks a native app needs (Phase 9). Links are paths ('/events/x/'): each app adds its own origin.
 */

export const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
export const OAUTH_URL = 'https://oauth2.googleapis.com/token';
export const FCM_URL = 'https://fcm.googleapis.com/v1/projects/';
const CHECK_TOKEN = 'push-config-check';
const TITLE_MAX = 80;
const BODY_MAX = 200;
const PATH = /^\/(?!\/)[\w\-./#?=&%~]{0,300}$/;
const IMAGE = /^\/media\/[\w./-]{1,200}\.(?:webp|jpe?g|png)$/;

const cache = new Map();

/* the parsed account, or null (the same checks as Push.gs pushServiceAccount_) */
export function serviceAccount(env) {
  let a = null;
  try { a = env.FCM_SERVICE_ACCOUNT ? JSON.parse(env.FCM_SERVICE_ACCOUNT) : null; } catch { a = null; }
  if (!a || typeof a !== 'object'
    || !/^[a-z][a-z0-9-]{4,40}$/.test(String(a.project_id || ''))
    || !/^[^@\s]+@[\w.-]+\.iam\.gserviceaccount\.com$/.test(String(a.client_email || ''))
    || !String(a.private_key || '').includes('PRIVATE KEY')) return null;
  return { projectId: a.project_id, email: a.client_email, key: a.private_key };
}

export const forgetAccessToken = account => (account ? cache.delete(account.email) : cache.clear());

const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64json = value => b64url(new TextEncoder().encode(JSON.stringify(value)));

async function signingKey(pem) {
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), c => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

/* a short-lived access token (a signed JWT exchanged at Google). Throws { code: 'auth' } when Google refuses */
export async function accessToken(account, doFetch, { fresh = false, now = Date.now() } = {}) {
  const hit = cache.get(account.email);
  if (!fresh && hit && hit.until > now) return hit.token;
  const iat = Math.floor(now / 1000);
  const unsigned = b64json({ alg: 'RS256', typ: 'JWT' }) + '.' + b64json({ iss: account.email, scope: FCM_SCOPE, aud: OAUTH_URL, iat, exp: iat + 3600 });
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await signingKey(account.key), new TextEncoder().encode(unsigned));
  const res = await doFetch(OAUTH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + unsigned + '.' + b64url(signature)
  });
  const body = await res.json().catch(() => null);
  if (res.status !== 200 || !body || typeof body.access_token !== 'string') throw Object.assign(new Error('google refused the push key'), { code: 'auth' });
  cache.set(account.email, { token: body.access_token, until: now + Math.max(60, Math.min(3000, (Number(body.expires_in) || 3600) - 300)) * 1000 });
  return body.access_token;
}

const text = (value, max) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);

/*
 * The one message model → a clean copy (or null without a title).
 *   { kind: 'public' | 'admin', id, title, body, url: '/path', tag, image?: '/media/…', badge?: n, group?: 'events' }
 */
export function model(m) {
  const title = text(m && m.title, TITLE_MAX);
  if (!title) return null;
  const out = {
    kind: m.kind === 'admin' ? 'admin' : 'public',
    id: text(m.id, 80),
    title,
    body: text(m.body, BODY_MAX),
    url: PATH.test(String(m.url || '')) ? m.url : (m.kind === 'admin' ? '/admin/' : '/#notifications'),
    tag: /^[\w-]{1,80}$/.test(String(m.tag || '')) ? m.tag : 'athanasios'
  };
  if (IMAGE.test(String(m.image || ''))) out.image = m.image;
  if (Number.isInteger(m.badge) && m.badge >= 0 && m.badge <= 999) out.badge = m.badge;
  if (/^[\w-]{1,40}$/.test(String(m.group || ''))) out.group = m.group;
  return out;
}

/* one device ({ token, platform }) + the model → FCM's `message` */
export function fcmMessage(device, m, ttl, now = Date.now()) {
  const data = {};
  for (const [k, v] of Object.entries(m)) data[k] = String(v);
  const message = { token: device.token, data };
  if (device.platform === 'android') {
    message.android = {
      priority: 'HIGH', ttl: ttl + 's', collapse_key: m.tag,
      notification: { title: m.title, body: m.body, tag: m.tag, ...(m.group ? { channel_id: m.group } : {}), ...(m.badge != null ? { notification_count: m.badge } : {}), ...(m.image ? { image: m.image } : {}) }
    };
  } else if (device.platform === 'ios') {
    message.apns = {
      headers: { 'apns-priority': '10', 'apns-expiration': String(Math.floor(now / 1000) + ttl), 'apns-collapse-id': m.tag.slice(0, 64) },
      payload: { aps: { alert: { title: m.title, body: m.body }, sound: 'default', 'mutable-content': 1, ...(m.group ? { 'thread-id': m.group } : {}), ...(m.badge != null ? { badge: m.badge } : {}) } }
    };
  } else {
    // the page's service worker shows it (data only, as before)
    message.webpush = { headers: { Urgency: 'high', TTL: String(ttl) } };
  }
  return message;
}

/* 'ok' | 'dead' (the token is gone for good) | 'auth' | 'retry' (Push.gs pushClassify_) */
export function classify(status, body) {
  if (status === 200) return 'ok';
  if (status === 401) return 'auth';
  const error = body && body.error;
  let code = '';
  for (const d of (error && error.details) || []) if (d && d.errorCode) code = d.errorCode;
  if (status === 404 || code === 'UNREGISTERED' || code === 'SENDER_ID_MISMATCH') return 'dead';
  // only the token's own fault: a bad message would fail every device the same way
  if (status === 400 && /registration token/i.test(String(error && error.message))) return 'dead';
  if (status === 403) return 'auth';
  return 'retry';
}

/* one device, one request → its class */
export async function sendOne(account, token, message, doFetch) {
  try {
    const res = await doFetch(FCM_URL + account.projectId + '/messages:send', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ message })
    });
    return classify(res.status, res.status === 200 ? null : await res.json().catch(() => null));
  } catch {
    return 'retry';
  }
}

/* is the key good? validate_only to a token that can't exist: no device gets anything (Push.gs apiPushCheck) */
export async function checkKey(env, doFetch) {
  const account = serviceAccount(env);
  if (!account) return { ok: false, code: 'missing' };
  try {
    const token = await accessToken(account, doFetch, { fresh: true });
    const res = await doFetch(FCM_URL + account.projectId + '/messages:send', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ validate_only: true, message: { token: CHECK_TOKEN, data: { title: 'check' } } })
    });
    if (res.status === 200 || res.status === 400 || res.status === 404) return { ok: true };
    return { ok: false, code: res.status === 403 ? 'permission' : 'http', status: res.status };
  } catch (err) {
    return { ok: false, code: err && err.code === 'auth' ? 'auth' : 'network' };
  }
}
