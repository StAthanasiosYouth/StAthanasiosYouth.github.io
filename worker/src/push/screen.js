/*
 * «إشعارات الموبايل» on the Worker (docs/PHASE6-PLAN.md Step 4c; Push.gs apiPushState / apiSendPush, the same answers).
 * A push is a bell item already live on the site: the live content is the Worker's own (published_revisions), so no
 * fetch of the site. The panel uses these while boot.pushSend = 'worker' (settings.PUSH_SENDER).
 *
 *   POST /v1/admin/push/state                       → subscribers, candidates (bell items live now), recent sends
 *   POST /v1/admin/push/send { id, sendKey, edits } → one live bell item to every visitor's device
 */

import { ApiError } from '../lib/http.js';
import { retry } from '../lib/db.js';
import { accountProblem, PROBLEM_TEXT, model } from './fcm.js';
import { publicSend, SEND_COOLDOWN_MS, SENDS_PER_DAY } from './send.js';
import { wallNow, wallMs } from './schedule.js';

const TITLE_MAX = 60;
const BODY_MAX = 200;
const TTL_MIN = 3600;
const TTL_MAX = 4 * 86400;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])$/;
const OS = ['android', 'ios', 'desktop', 'other'];

const refuse = (message, hint) => new ApiError('invalid', 'push', { message, hint });

async function liveContent(db) {
  const row = await retry(() => db.prepare("SELECT body FROM published_revisions WHERE kind = 'content' AND key = 'site' AND live = 1").first());
  let content = null;
  try { content = row ? JSON.parse(row.body) : null; } catch { content = null; }
  return content && Array.isArray(content.notifications) ? content : null;
}

const windowLive = (from, until, now) => !(from && now < from) && !(until && now > until);

/* the page's own rules (bell.js): published, and its section is showing (Push.gs pushItemState_) */
export function itemState(content, item, now) {
  if (item.publishAt && now < item.publishAt) return 'scheduled';
  if (item.expireAt && now > item.expireAt) return 'ended';
  const layout = Array.isArray(content.layout) ? content.layout : null;
  const live = key => !layout || layout.some(s => s && s.key === key && windowLive(s.visibleFrom, s.visibleUntil, now));
  const bySection = { meeting: 'meeting', news: 'news', game: 'games', competition: 'competitions' }[item.type];
  const target = item.target || null;
  let section = null;
  if (target && target.kind === 'meeting') section = 'meeting';
  if (target && ['news', 'game', 'activity'].includes(target.kind)) {
    const list = { news: content.news, game: content.games, activity: content.activities }[target.kind] || [];
    const found = list.find(x => x && x.id === target.id);
    if (!found) return 'hidden';
    section = target.kind === 'news' ? 'news' : target.kind === 'game' ? 'games' : found.section;
  }
  if (target && target.kind === 'points' && !content.points) return 'hidden';
  if (target && target.kind === 'competition' && !(content.competitions || []).some(c => c && c.slug === target.slug)) return 'hidden';
  if ((bySection && !live(bySection)) || (section && !live(section))) return 'hidden';
  return 'live';
}

/* the deep link a tap opens (Push.gs pushUrl_) */
export function itemUrl(target) {
  if (!target) return '/#notifications';
  if (target.kind === 'meeting') return '/#meeting';
  if (['news', 'game', 'activity'].includes(target.kind) && /^[\w-]{1,60}$/.test(String(target.id || ''))) return '/#' + target.kind + '/' + target.id;
  if (target.kind === 'competition' && /^[a-z0-9-]{2,40}$/.test(String(target.slug || ''))) return '/competition/' + target.slug + '/';
  if ((target.kind === 'page' || target.kind === 'event') && SLUG.test(String(target.slug || ''))) return '/' + (target.kind === 'event' ? 'events/' : '') + target.slug + '/';
  if (target.kind === 'points') return '/points/';
  return '/#notifications';
}

const text = (value, max) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
const GROUPS = { meeting: 'meeting', news: 'news', game: 'games', competition: 'competitions', activity: 'events' };

/* the message every device gets (Push.gs pushMessage_), as the model (fcm.js) */
export function itemMessage(item, edits) {
  const e = edits && typeof edits === 'object' ? edits : {};
  const src = item.image && typeof item.image.src === 'string' && /^media\/[\w./-]{1,200}\.(?:webp|jpe?g|png)$/.test(item.image.src) ? '/' + item.image.src : '';
  const m = {
    kind: 'public', id: item.id,
    title: text(e.title, TITLE_MAX) || text(item.title, TITLE_MAX),
    body: typeof e.body === 'string' ? text(e.body, BODY_MAX) : text(item.message, BODY_MAX),
    url: itemUrl(item.target),
    tag: ('n-' + item.id).slice(0, 80),
    group: GROUPS[item.type] || (item.target && item.target.kind === 'points' ? 'points' : 'announcements')
  };
  if (src && e.image !== false) m.image = src;
  return m;
}

/* until the item expires (1 h … 4 days) */
export const itemTtl = (item, now) => {
  const s = item.expireAt ? Math.round((wallMs(String(item.expireAt).slice(0, 16)) - now) / 1000) : TTL_MAX;
  return Math.max(TTL_MIN, Math.min(TTL_MAX, Number.isFinite(s) ? s : TTL_MAX));
};

const logOf = r => {
  let m = {};
  try { m = JSON.parse(r.message) || {}; } catch { m = {}; }
  return {
    sendKey: r.send_key || '', notifId: r.ref, status: r.status, by: r.by || 'auto', at: r.started_ms, finishedAt: r.finished_ms || 0,
    audience: r.targets, sent: r.sent, failed: r.failed, removed: r.removed, title: m.title || '', url: m.url || ''
  };
};

const cairoDayStart = now => wallMs(wallNow(now).slice(0, 10) + 'T00:00');

export async function adminPushState(ctx) {
  const db = ctx.env.DB;
  const now = Date.now();
  const [devices, log, today, last] = await retry(() => db.batch([
    db.prepare("SELECT os, COUNT(*) AS n FROM push_devices WHERE audience = 'public' GROUP BY os"),
    db.prepare("SELECT * FROM push_sends WHERE audience = 'public' ORDER BY started_ms DESC LIMIT 200"),
    db.prepare("SELECT COUNT(*) AS n FROM push_sends WHERE audience = 'public' AND started_ms >= ?").bind(cairoDayStart(now)),
    db.prepare("SELECT MAX(started_ms) AS at FROM push_sends WHERE audience = 'public'")
  ]));
  const platforms = { android: 0, ios: 0, desktop: 0, other: 0 };
  let subscribers = 0;
  for (const d of devices.results) { platforms[OS.includes(d.os) ? d.os : 'other'] += d.n; subscribers += d.n; }
  const sends = log.results.map(logOf);
  const latest = {};
  for (const s of [...sends].reverse()) latest[s.notifId] = s;
  const lastAt = last.results[0].at || 0;
  const problem = accountProblem(ctx.env);
  const state = {
    configured: !problem, configHint: problem ? PROBLEM_TEXT[problem] : '', subscribers, platforms, candidates: [], contentError: '', log: sends.slice(0, 15),
    limits: { perDay: SENDS_PER_DAY, sentToday: today.results[0].n, cooldownSeconds: SEND_COOLDOWN_MS / 1000, waitSeconds: Math.max(0, Math.ceil((lastAt + SEND_COOLDOWN_MS - now) / 1000)), titleMax: TITLE_MAX, bodyMax: BODY_MAX }
  };
  const content = await liveContent(db);
  if (!content) {
    state.contentError = 'مش قادرين نقرا الموقع دلوقتي.';
    return state;
  }
  const wall = wallNow(now);
  state.candidates = content.notifications
    .map(item => ({
      id: item.id, type: item.type, state: itemState(content, item, wall), publishAt: item.publishAt || '', expireAt: item.expireAt || '',
      image: (item.image && (item.image.thumb || item.image.src)) || '', message: itemMessage(item, {}), last: latest[item.id] || null
    }))
    .filter(c => c.state === 'live' || c.state === 'scheduled')
    .sort((a, b) => (a.state !== b.state ? (a.state === 'live' ? -1 : 1) : a.state === 'live' ? (b.publishAt < a.publishAt ? -1 : 1) : (a.publishAt < b.publishAt ? -1 : 1)));
  return state;
}

/* the answer apiSendPush gave: the log summary + replay / already */
const resultOf = (row, flags) => ({ ...logOf(row), replay: !!flags.replay, already: !!flags.already });

export async function adminPushSend(ctx) {
  const db = ctx.env.DB;
  const body = ctx.body || {};
  const id = String(body.id || '');
  const now = Date.now();
  const content = await liveContent(db);
  const item = content && content.notifications.find(n => n && n.id === id);
  if (!item) throw refuse('الإشعار ده مش على الموقع.', 'انشر الأول، واستنى لحد ما يظهر على الموقع.');
  const state = itemState(content, item, wallNow(now));
  if (state !== 'live') {
    throw refuse(state === 'scheduled' ? 'الإشعار ده لسه معاده مجاش.' : 'الإشعار ده مش ظاهر على الموقع دلوقتي.',
      state === 'scheduled' ? 'تقدر تبعته من ' + String(item.publishAt).replace('T', ' ') + '.' : 'اتأكد إنه مش منتهي وإن القسم بتاعه ظاهر.');
  }
  const message = itemMessage(item, body.edits);
  if (!model(message)) throw refuse('العنوان فاضي.', '');
  const r = await publicSend(ctx.env, { notifId: id, sendKey: String(body.sendKey || ''), by: ctx.actor.email, message, ttl: itemTtl(item, now), now, doFetch: ctx.fetch });
  if (r.replay || r.already) return resultOf(r.send, r);
  const row = await retry(() => db.prepare('SELECT * FROM push_sends WHERE id = ?').bind(r.id).first());
  return resultOf(row, {});
}
