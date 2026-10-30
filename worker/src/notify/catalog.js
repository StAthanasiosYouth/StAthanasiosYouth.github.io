/*
 * The notification catalog (docs/BOOKING-PHASE1-COMPLETION-PLAN.md §4.4):
 * every activity row → a type key, a level, the permission a recipient must
 * hold, and how rows are grouped; plus the message built from activity rows
 * at send time (the outbox stores no bodies). Never a visitor's name, phone,
 * a payment number or an amount in a message.
 *
 *   critical   email at once + push; can't be turned off for the Primary Admin
 *   important  email at once + push (on by default)
 *   routine    no email, no push by default (the daily summary if chosen)
 */

import { FAMILIES } from '../lib/activity.js';

export const LEVELS = ['critical', 'important', 'routine'];
const MIN = 60000;

/* special actions: their own type */
const SPECIAL = {
  'accounts.add': ['critical', 'accounts.manage'],
  'accounts.grants': ['critical', 'accounts.manage'],
  'accounts.remove': ['critical', 'accounts.manage'],
  'admin.add': ['critical', 'accounts.manage'],
  'admin.remove': ['critical', 'accounts.manage'],
  'notify.settings': ['critical', 'notifications.manage'],
  'pay.approve': ['critical', 'finance.manage'],
  'payment.void': ['critical', 'finance.manage'],
  'event.cancelAll': ['critical', 'bookings.manage'],
  'code.export': ['critical', 'participants.manage'],
  'export.pii': ['critical', 'exports.export_pii'],
  'export.bookings': ['routine', 'exports.export'],
  'migrate': ['critical', 'system.manage'],
  'job.failed': ['critical', 'system.manage'],
  'notify.failed': ['critical', 'system.manage', { email: false }],
  'gmail.token': ['critical', 'system.manage', { email: false }],
  'booking.new': ['important', 'bookings.approve', { group: 10 * MIN, by: 'event' }],
  'booking.create': ['important', 'bookings.approve', { group: 10 * MIN, by: 'event' }],
  'publish': ['important', 'publish.publish'],
  'push': ['important', 'push.view'],
  'import': ['important', 'content.view'],
  'finalize': ['important', 'competitions.view'],
  'points.adjust': ['important', 'points.view'],
  'redemption.status': ['routine', 'store.view'],
  'booking.confirm': ['routine', 'bookings.view'],
  'booking.reject': ['routine', 'bookings.view'],
  'booking.cancel': ['routine', 'bookings.view'],
  'booking.reopen': ['routine', 'bookings.view'],
  'booking.update': ['routine', 'bookings.view'],
  'booking.ageOverride': ['important', 'bookings.view'],
  'booking.withdraw': ['routine', 'bookings.view'],
  'booking.remind': ['routine', 'bookings.view'],
  'payment.add': ['routine', 'finance.view'],
  'payment.refund': ['routine', 'finance.view'],
  // a participant's request to pay what is left (§4.10): someone has to review it
  'payment.request': ['important', 'finance.manage'],
  'payment.requestReject': ['routine', 'finance.view'],
  'payment.requestWithdraw': ['routine', 'finance.view'],
  'handover.add': ['routine', 'finance.view'],
  'handover.void': ['routine', 'finance.view'],
  'modules.book': ['important', 'bookings.manage'],
  'member.mail.dead': ['routine', 'notifications.view'],
  'participant.email': ['critical', 'participants.view'],
  'participant.phoneFix': ['critical', 'participants.view'],
  'participant.dob': ['critical', 'participants.view'],
  'participant.reset': ['critical', 'participants.view'],
  'participant.block': ['critical', 'participants.view'],
  'account.recovery.first': ['critical', 'participants.view'],
  'participant.settings': ['important', 'participants.manage'],
  'account.discover.high': ['important', 'participants.view'],
  'admin.rename': ['routine', 'accounts.view'],
  'session.takeover': ['routine', 'accounts.view']
};

/* the module of each Apps Script entity type: the permission to receive its rows */
const ENTITY = {
  sessions: 'content', news: 'content', games: 'content', activities: 'content', notifications: 'content', types: 'content',
  links: 'content', sections: 'content', contacts: 'content', settings: 'content', site: 'content', data: 'system',
  media: 'media', competition: 'competitions', participant: 'participants', points: 'points', shopitem: 'store', redemption: 'store',
  page: 'events', event: 'events', servant: 'events'
};
/* what people see: creating / deleting it is important */
const VISIBLE = ['sessions', 'news', 'games', 'activities', 'notifications', 'competition', 'page', 'event'];
const FAMILY_OF = {};
for (const f of ['add', 'edit', 'remove']) for (const a of FAMILIES[f]) FAMILY_OF[a] = FAMILY_OF[a] || f;

/* not notifications at all */
const TECHNICAL = new Set(['diag.echo', 'diag.queue', 'booknews.claim', 'booknews.ack', 'admins.sync', 'paydest.sync', 'booking.retention']);

/* activity row → { key, level, perm, group, by, email } | null */
export function typeOf(row) {
  if (TECHNICAL.has(row.action)) return null;
  const s = SPECIAL[row.action];
  if (s) return { key: row.action, level: s[0], perm: s[1], group: 0, by: '', email: true, ...(s[2] || {}) };
  const module = ENTITY[row.entity_type];
  const family = FAMILY_OF[row.action];
  if (!module || !family) return null;
  const level = (family === 'add' || family === 'remove') && VISIBLE.includes(row.entity_type) && (row.action === 'create' || row.action === 'delete') ? 'important' : 'routine';
  return { key: row.entity_type + '.' + family, level, perm: module + '.view', group: family === 'edit' ? 10 * MIN : 0, by: 'entity', email: true };
}

/* every type key the settings screen lists: { key, level, perm, module } */
export function allTypes() {
  const out = Object.entries(SPECIAL).map(([key, s]) => ({ key, level: s[0], perm: s[1] }));
  for (const [type, module] of Object.entries(ENTITY)) {
    for (const family of ['add', 'edit', 'remove']) {
      const level = family !== 'edit' && VISIBLE.includes(type) ? 'important' : 'routine';
      out.push({ key: type + '.' + family, level, perm: module + '.view' });
    }
  }
  return out.map(t => ({ ...t, module: t.perm.split('.')[0] }));
}

/* the defaults of a level: push on/off, email off | immediate | summary */
export function defaultsOf(level) {
  return level === 'routine' ? { push: false, email: 'off' } : { push: true, email: 'immediate' };
}

/* ---------- the message (rebuilt from activity rows at send time) ---------- */

const ACTION_TEXT = {
  'booking.create': 'سجّل حجز', 'booking.confirm': 'أكّد حجز', 'booking.reject': 'رفض حجز', 'booking.cancel': 'لغى حجز',
  'booking.reopen': 'رجّع حجز', 'booking.update': 'عدّل حجز', 'booking.ageOverride': 'تجاوز شرط السن في حجز', 'booking.withdraw': 'الزائر لغى طلب', 'booking.remind': 'فكّر بالدفع في حجز',
  'payment.add': 'سجّل دفعة في حجز', 'payment.refund': 'سجّل استرداد في حجز', 'payment.void': 'لغى دفعة في حجز', 'payment.request': 'طلب دفع الباقي في حجز', 'payment.requestReject': 'رفض طلب دفع في حجز', 'payment.requestWithdraw': 'سحب طلب دفع في حجز',
  'handover.add': 'سجّل تسليم فلوس', 'handover.void': 'لغى تسليم فلوس', 'event.cancelAll': 'لغى كل حجوزات فعالية',
  'modules.book': 'غيّر حالة الحجز', 'job.failed': 'مهمة في الخلفية فشلت', 'notify.failed': 'إشعار مقدرش يتبعت',
  'gmail.token': 'إرسال الإيميلات واقف: صلاحية جيميل محتاجة تتجدد'
};
const clip = (s, n) => (String(s || '').length > n ? String(s).slice(0, n - 1) + '…' : String(s || ''));
const arabicDigits = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);

function parse(text) {
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

/*
 * An admin account in a panel link: never its email (docs/EMAIL-DEEP-LINKS.md §2),
 * a short key of it. Two 32-bit FNV-1a hashes of the lower-case address; the
 * panel computes the same key (AdminPage.html accountKey) to find the row.
 */
export function accountKey(email) {
  const s = String(email || '').trim().toLowerCase();
  const fnv = seed => { let h = seed >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16).padStart(8, '0'); };
  return 'acc-' + fnv(0x811c9dc5) + fnv(0x01000193);
}

/*
 * Where an admin notification opens (docs/EMAIL-DEEP-LINKS.md §1): the exact
 * record — the booking, its payments, the event's queue for new bookings, the
 * admin account — else the activity entry.
 */
function linkOf(key, rows) {
  const last = rows[rows.length - 1];
  const booking = last.entity_type === 'booking' && /^bkg-[a-z0-9]{4,40}$/.test(String(last.entity_id || '')) ? last.entity_id : '';
  const event = /^evt-[a-z0-9]{4,40}$/.test(String(last.event_id || '')) ? last.event_id : '';
  if ((key === 'booking.new' || key === 'booking.create') && rows.length > 1 && event) return '/admin/#open/bookings/' + event;
  if (booking && /^(payment|pay)\./.test(String(last.action))) return '/admin/#open/payments/' + booking;
  if (booking) return '/admin/#open/booking/' + booking;
  if (/^(accounts|admin)\./.test(String(last.action)) && last.entity_type === 'admin' && last.entity_id) return '/admin/#open/account/' + accountKey(last.entity_id);
  return '/admin/#activity/' + last.id;
}

/* rows (newest last) → { title, body, url, tag, lines } — names only, no PII */
export function messageOf(type, rows, names = {}) {
  const last = rows[rows.length - 1];
  const who = r => (r.actor === 'visitor' ? 'زائر' : r.actor === 'system' ? 'النظام' : names[r.actor] || r.actor_name || String(r.actor).split('@')[0]);
  const lineOf = r => {
    if (r.action === 'booking.new') return 'حجز جديد ' + (r.entity_title || '');
    if (ACTION_TEXT[r.action]) return (r.actor === 'system' ? '' : who(r) + ' ') + ACTION_TEXT[r.action] + (r.entity_title && /^(booking|payment)./.test(r.action) ? ' ' + r.entity_title : '');
    return who(r) + ' ' + (r.summary || r.action);
  };
  let title;
  let body = '';
  const event = last.event_title || (last.action === 'booking.new' ? String(last.summary || '').split(' · ')[0] : '') || '';
  if (type.key === 'booking.new' || type.key === 'booking.create') {
    const n = rows.length;
    const cash = type.key === 'booking.create';
    title = (n === 1 ? (cash ? 'حجز كاش جديد' : 'حجز جديد') : arabicDigits(n) + (cash ? ' حجوزات كاش جديدة' : ' حجوزات جديدة')) + (event ? ' – ' + event : '');
    body = cash ? 'مستني الاعتماد' : 'مستنيين المراجعة';
  } else {
    title = lineOf(last);
    const changes = parse(last.changes) || {};
    if (rows.length > 1) body = 'و' + arabicDigits(rows.length - 1) + ' كمان';
    else if (Array.isArray(changes.fields) && changes.fields.length) body = 'اتغيّر: ' + changes.fields.slice(0, 4).join('، ');
  }
  return {
    title: clip(title, 80),
    body: clip(body || 'لوحة تحكم الأسرة', 160),
    url: linkOf(type.key, rows),
    tag: ('adm-' + type.key + '-' + (last.entity_id || last.id)).replace(/[^\w-]/g, '').slice(0, 80),
    lines: rows.map(r => ({ text: clip(lineOf(r), 200), cairo: r.cairo, id: r.id, action: r.action, who: who(r) })),
    // for the email templates: the event itself (names and references only)
    ctx: {
      key: type.key, count: rows.length, event: event || undefined,
      ref: String(last.action || '').startsWith('booking') || String(last.action || '').startsWith('payment') ? last.entity_title || undefined : undefined,
      target: String(last.action || '').startsWith('accounts.') ? last.entity_id || undefined : undefined
    }
  };
}
