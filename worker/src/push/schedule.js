/*
 * The automatic pushes (docs/PHASE6-PLAN.md Step 4c, COMPETITIONS §18.5; CompSchedule.gs on the Worker).
 *
 * - One schedule, read from the Worker's own dates (gap 4): the store's (settings SHOP_*, SHOP_NOTIFY) and each
 *   season's end (seasons.notify_days). Saving either syncs it here.
 * - The owner's choice (2026-11-03): a push goes at its moment, whether or not a publish happened since. Its bell item
 *   joins the site at the next publish (bellItems, inside the build's hub: content/publishing.js), so the bell may
 *   not show one no publish carried. The browser's own review then defers to the Worker's (content/routes.js).
 * - The minute cron sends what is due (scheduleTick), only while PUSH_SENDER = 'worker': through publicSend, so the
 *   same once-per-item, cooldown and daily cap. A cooldown waits for the next minute; overdue by 6 h is skipped.
 */

import { ApiError } from '../lib/http.js';
import { retry, cairoText } from '../lib/db.js';
import { randomId } from '../lib/hash.js';
import { logLine } from '../lib/log.js';
import { activityStmt } from '../lib/activity.js';
import { publicSend, senderOn } from './send.js';
import { serviceAccount } from './fcm.js';

export const OVERDUE_MS = 6 * 3600000;
export const NOTIFY_KEYS = ['open1d', 'open1h', 'openAt', 'close24h', 'close1h'];
export const KINDS = {
  'shop-open-1d': { notify: 'open1d', base: 'opens', minutes: -1440 },
  'shop-open-1h': { notify: 'open1h', base: 'opens', minutes: -60 },
  'shop-open': { notify: 'openAt', base: 'opens', minutes: 0 },
  'shop-close-24h': { notify: 'close24h', base: 'closes', minutes: -1440 },
  'shop-close-1h': { notify: 'close1h', base: 'closes', minutes: -60 }
};
const TTL_MIN = 3600;
const TTL_MAX = 4 * 86400;
const ENTRY = /^psh-[0-9a-f]{10}$/;

/* ---------- Cairo wall time ('YYYY-MM-DDTHH:MM') ---------- */

export const wallNow = now => cairoText(now).replace(' ', 'T');
export const wallAdd = (wall, minutes) => new Date(Date.parse(wall + ':00Z') + minutes * 60000).toISOString().slice(0, 16);

/* → epoch ms (corrected twice: right across a DST change) */
export function wallMs(wall) {
  const target = Date.parse(wall + ':00Z');
  let guess = target - 2 * 3600000;
  for (let i = 0; i < 2; i++) guess += target - Date.parse(cairoText(guess).replace(' ', 'T') + ':00Z');
  return guess;
}

/* «الخميس ٢٢ أكتوبر الساعة ٧ بالليل» (CompSchedule.gs pushWhen_) */
export function when(wall) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(wall || ''));
  if (!m) return '';
  const days = ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'];
  const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const day = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
  const hour = +m[4];
  return days[day] + ' ' + Number(m[3]) + ' ' + months[+m[2] - 1] + ' الساعة ' + (hour % 12 || 12) + (m[5] !== '00' ? ':' + m[5] : '') + ' ' + (hour < 12 ? 'الصبح' : hour < 17 ? 'الضهر' : 'بالليل');
}

/* ---------- what should be scheduled ---------- */

export function shopNotify(text) {
  let raw = {};
  try { raw = text ? JSON.parse(text) || {} : {}; } catch { raw = {}; }
  return Object.fromEntries(NOTIFY_KEYS.map(k => [k, raw[k] === true]));
}

function shopEntry(kind, sendAt, opens, closes) {
  const texts = {
    'shop-open-1d': ['🛍️ المتجر هيفتح بكره', 'المتجر بيفتح ' + (opens ? when(opens) : '') + '. جهّز نقاطك واختار جايزتك.'],
    'shop-open-1h': ['⏰ المتجر هيفتح كمان ساعة', 'ادخل «نقاطي» وشوف الجوايز.'],
    'shop-open': ['🎁 المتجر فتح دلوقتي!', 'ادخل «نقاطي» واطلب جايزتك' + (closes ? ' قبل ' + when(closes) : '') + '.'],
    'shop-close-24h': ['⌛ المتجر هيقفل بكره', 'آخر فرصة تطلب جايزتك قبل ' + (closes ? when(closes) : '') + '.'],
    'shop-close-1h': ['⌛ فاضل ساعة ويقفل المتجر', 'لو لسه ما طلبتش جايزتك، دي آخر فرصة.']
  }[kind];
  const opening = kind.startsWith('shop-open');
  const until = opening ? (kind === 'shop-open' ? closes || wallAdd(sendAt, 3 * 1440) : opens) : closes;
  return { kind, refId: '', notifId: 'notif-' + kind + '-' + sendAt.replace(/\D/g, ''), sendAt, title: texts[0], body: texts[1], expireAt: until || wallAdd(sendAt, 1440) };
}

/* [{ kind, refId, notifId, sendAt, expireAt, title, body }]: wanted now, future moments only */
export async function wanted(db, now = Date.now()) {
  const [settings, seasons] = await retry(() => db.batch([
    db.prepare("SELECT key, value FROM settings WHERE key IN ('SHOP_MODE', 'SHOP_OPENS_AT', 'SHOP_CLOSES_AT', 'SHOP_NOTIFY')"),
    db.prepare("SELECT id, name, end_at, notify_days FROM seasons WHERE status <> 'closed' AND notify_days IS NOT NULL AND end_at IS NOT NULL AND end_at <> ''")
  ]));
  const s = Object.fromEntries(settings.results.map(r => [r.key, r.value]));
  const nowWall = wallNow(now);
  const out = [];
  // only the automatic mode has moments; «مفتوح» / «مقفول» by hand has none
  if ((s.SHOP_MODE || 'auto') === 'auto') {
    const notify = shopNotify(s.SHOP_NOTIFY);
    const opens = s.SHOP_OPENS_AT || '';
    const closes = s.SHOP_CLOSES_AT || '';
    for (const [kind, spec] of Object.entries(KINDS)) {
      const base = spec.base === 'opens' ? opens : closes;
      if (!notify[spec.notify] || !base) continue;
      const sendAt = wallAdd(base, spec.minutes);
      if (sendAt > nowWall) out.push(shopEntry(kind, sendAt, opens, closes));
    }
  }
  for (const season of seasons.results) {
    const end = season.end_at.length === 10 ? season.end_at + 'T23:59' : season.end_at.slice(0, 16);
    const days = Math.max(1, Math.min(30, Number(season.notify_days) || 1));
    const sendAt = wallAdd(end, -days * 1440);
    if (sendAt <= nowWall) continue;
    out.push({
      kind: 'season-end', refId: season.id, notifId: 'notif-season-end-' + season.id.replace(/^sea-/, '') + '-' + sendAt.replace(/\D/g, ''),
      sendAt, expireAt: end,
      title: '🏁 ' + season.name + ' بيخلص بعد ' + days + (days <= 2 ? ' يوم' : ' أيام'),
      body: 'النقاط بتتقفل ' + when(end) + '. لو عايز تطلب جايزة، اطلبها قبلها.'
    });
  }
  return out;
}

/*
 * The entries match what is wanted now: new moments are added, pending ones no longer wanted are cancelled.
 * Sent, skipped and failed ones stay as history. scope: 'shop-' | 'season-' (what a save changed).
 */
export async function syncSchedule(db, scope, now = Date.now()) {
  const want = (await wanted(db, now)).filter(w => w.kind.startsWith(scope));
  const have = (await retry(() => db.prepare("SELECT id, notif_id, status FROM push_schedule WHERE kind LIKE ?").bind(scope + '%').all())).results;
  const byNotif = new Set(want.map(w => w.notifId));
  const known = new Set(have.map(h => h.notif_id));
  const stmts = [];
  for (const h of have) {
    if (h.status === 'pending' && !byNotif.has(h.notif_id)) {
      stmts.push(db.prepare("UPDATE push_schedule SET status = 'cancelled', result = 'اتلغى (الميعاد اتغير أو اتشال)', updated_ms = ? WHERE id = ? AND status = 'pending'").bind(now, h.id));
    }
  }
  for (const w of want) {
    if (known.has(w.notifId)) {
      // the same moment: its words may have changed (a season's new name)
      stmts.push(db.prepare("UPDATE push_schedule SET title = ?, body = ?, expire_wall = ?, updated_ms = ? WHERE notif_id = ? AND status = 'pending'").bind(w.title, w.body, w.expireAt, now, w.notifId));
      continue;
    }
    stmts.push(db.prepare(`INSERT INTO push_schedule (id, notif_id, kind, ref_id, send_wall, send_ms, expire_wall, title, body, send_key, updated_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(notif_id) DO NOTHING`)
      .bind(randomId('psh-', 5), w.notifId, w.kind, w.refId, w.sendAt, wallMs(w.sendAt), w.expireAt, w.title, w.body, 'auto-' + randomId('', 8), now));
  }
  if (stmts.length) await retry(() => db.batch(stmts));
  return { wanted: want.length, changed: stmts.length };
}

/* the bell items the build adds (target «نقاطي»), shown by the site at their own moment */
export async function bellItems(db, now = Date.now()) {
  const rows = (await retry(() => db.prepare("SELECT notif_id, title, body, send_wall, expire_wall FROM push_schedule WHERE status IN ('pending', 'sent') AND expire_wall > ? ORDER BY send_wall").bind(wallNow(now)).all())).results;
  return rows.map(r => ({ id: r.notif_id, type: 'general', title: r.title, message: r.body, target: { kind: 'points' }, image: null, publishAt: r.send_wall, expireAt: r.expire_wall }));
}

/* how long a push may wait for a phone that's off: until it expires (1 h … 4 days) */
export const ttlOf = (expireWall, now) => Math.max(TTL_MIN, Math.min(TTL_MAX, Math.round((wallMs(expireWall) - now) / 1000)));

/* the minute cron: what is due goes. → { sent, skipped, failed, waiting } | null */
export async function scheduleTick(env, now = Date.now(), doFetch) {
  const db = env.DB;
  if (!(await senderOn(db))) return null;
  const due = (await retry(() => db.prepare("SELECT * FROM push_schedule WHERE status = 'pending' AND send_ms <= ? ORDER BY send_ms LIMIT 5").bind(now).all())).results;
  if (!due.length) return null;
  const out = { sent: 0, skipped: 0, failed: 0, waiting: 0 };
  for (const row of due) {
    let status;
    let result;
    if (now - row.send_ms > OVERDUE_MS) {
      status = 'skipped';
      result = 'فات ميعاده';
    } else {
      try {
        const r = await publicSend(env, {
          notifId: row.notif_id, sendKey: row.send_key, by: '', now, doFetch, ttl: ttlOf(row.expire_wall, now),
          message: { title: row.title, body: row.body, url: '/points/', tag: ('n-' + row.notif_id).slice(0, 80), group: 'points' }
        });
        status = 'sent';
        result = r.already ? 'كان اتبعت قبل كده' : r.replay ? 'اتبعت' : 'بيتبعت لـ ' + r.targets + ' جهاز';
      } catch (err) {
        // another send a moment ago: the next minute
        if (err instanceof ApiError && (err.code === 'rate' || err.code === 'busy') && !/اليوم/.test(String(err.extra && err.extra.message))) {
          out.waiting++;
          continue;
        }
        status = err instanceof ApiError && err.code === 'invalid' ? 'skipped' : 'failed';
        result = String((err && err.extra && err.extra.message) || (err && err.message) || 'error').slice(0, 200);
      }
    }
    out[status]++;
    const stmts = [db.prepare('UPDATE push_schedule SET status = ?, result = ?, updated_ms = ? WHERE id = ? AND status = ?').bind(status, result, now, row.id, 'pending')];
    // the admins hear about what didn't go out
    if (status !== 'sent') stmts.push(activityStmt(db, { at: now, actor: 'system', action: 'push', entityType: 'notifications', entityId: row.notif_id, entityTitle: row.title, summary: 'إرسال تلقائي ما اتبعتش: ' + result, severity: 'important' }));
    await retry(() => db.batch(stmts));
  }
  logLine({ kind: 'cron', job: 'push.schedule', ...out });
  return out;
}

/* ---------- admin ---------- */

/* POST /v1/admin/push/auto: { authorized, daily, nextDue, pending } as apiPushAuto answers */
export async function adminPushAuto(ctx) {
  const db = ctx.env.DB;
  const [on, next] = await Promise.all([
    senderOn(db),
    retry(() => db.prepare("SELECT MIN(send_wall) AS next, COUNT(*) AS n FROM push_schedule WHERE status = 'pending'").first())
  ]);
  // the Worker's minute cron replaces the triggers: «authorized» once it sends and has the key
  const ready = on && !!serviceAccount(ctx.env);
  return { authorized: ready, daily: ready, nextDue: next.next || '', pending: next.n };
}

/* POST /v1/admin/push/schedule: { entries, auto } as apiPushSchedule answers (newest moment first) */
export async function adminPushSchedule(ctx) {
  const rows = (await retry(() => ctx.env.DB.prepare('SELECT * FROM push_schedule ORDER BY send_wall DESC LIMIT 100').all())).results;
  return {
    entries: rows.map(r => ({ id: r.id, notifId: r.notif_id, kind: r.kind, refId: r.ref_id, sendAt: r.send_wall.replace('T', ' '), status: r.status, result: r.result, title: r.title })),
    auto: await adminPushAuto(ctx)
  };
}

/* POST /v1/admin/push/schedule/cancel { id }: one pending send off */
export async function adminPushScheduleCancel(ctx) {
  const id = String((ctx.body || {}).id || '');
  if (!ENTRY.test(id)) throw new ApiError('invalid', 'id', { message: 'الطلب مش مفهوم.' });
  const now = Date.now();
  const r = await retry(() => ctx.env.DB.batch([
    ctx.env.DB.prepare('SELECT status FROM push_schedule WHERE id = ?').bind(id),
    ctx.env.DB.prepare("UPDATE push_schedule SET status = 'cancelled', result = 'اتلغى من لوحة التحكم', updated_ms = ? WHERE id = ? AND status = 'pending'").bind(now, id),
    activityStmt(ctx.env.DB, { at: now, actor: ctx.actor.email, actorName: ctx.actor.name, action: 'push', entityType: 'notifications', entityId: id, summary: 'لغى إرسال تلقائي' })
  ]));
  if (!r[0].results.length) throw new ApiError('not_found', 'entry', { message: 'الإرسال ده مش موجود.' });
  return adminPushSchedule(ctx);
}
