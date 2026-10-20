/*
 * Email templates: one plain, branded layout for every automatic email of
 * the service, Arabic RTL, HTML + an equivalent plain text. Two audiences:
 *
 *   admin    the panel's servants (active now): notifications, critical alerts,
 *            booking notices, the daily summary. One link, to the panel.
 *   member   youth accounts (Phase 5A, NOT sent by anything yet): verification
 *            codes, password recovery, security notices. Never an admin link;
 *            a code email has no link at all.
 *
 * What every email keeps to (Gmail sender guidelines; plain, honest mail):
 * - the sender's name (BRAND) in the From header, the heading and the footer,
 *   and why the reader gets it;
 * - at most one link, its address shown as text too; no images, tracking
 *   pixels, hidden text, scripts or shorteners;
 * - subjects made from the event itself (fill() refuses a missing value: no
 *   «{ref}» ever goes out), descriptive, without urgency words;
 * - no visitor names, phones, payment numbers or amounts.
 */

export const BRAND = 'أسرة البابا أثناسيوس الرسولي لشباب-سفاجا';
export const SERVICE = 'كنيسة أبي سيفين';
// who to call when something looks wrong (every email, small, under the sender's name; plain text, no link)
export const SUPPORT = 'الدعم الفني: مينا زكريا – 01276162016';
export const SITE = 'https://stathanasiosyouth.github.io';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const digits = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);

/*
 * '{name}' placeholders; '[ – {event}]' is an optional part, dropped when a
 * value inside it is missing. A missing value outside [] throws: a template
 * never leaves with a placeholder or an empty slot in it.
 */
export function fill(template, data) {
  const has = k => data[k] !== undefined && data[k] !== null && String(data[k]).trim() !== '';
  const out = template
    .replace(/\[([^\]]*)\]/g, (_, part) => ((part.match(/\{(\w+)\}/g) || []).every(m => has(m.slice(1, -1))) ? part : ''))
    .replace(/\{(\w+)\}/g, (_, k) => { if (!has(k)) throw new Error('template value missing: ' + k); return clip(data[k], 80); });
  return out.replace(/\s+/g, ' ').trim();
}

const WHY = {
  admin: 'وصلك الإيميل ده لأنك من خدام لوحة التحكم في الخدمة. تقدر تختار اللي يوصلك من «تنبيهاتي» في لوحة التحكم.',
  code: 'وصلك الإيميل ده لأن حد طلب كود بالإيميل ده على موقع الخدمة. لو مش انت، تجاهله ومش هيحصل حاجة.',
  security: 'وصلك الإيميل ده علشان تعرف بأي تغيير مهم في حسابك على موقع الخدمة.'
};

/* { audience, heading, intro, items, link, code, notes, why } → { html, text } */
export function layout({ audience = 'admin', heading, intro = '', items = [], link = null, code = '', notes = [], why }) {
  if (link && audience !== 'admin' && /\/admin(\/|#|$)/.test(link.url)) throw new Error('an admin link in a member email');
  if (link && !link.url.startsWith(SITE + '/')) throw new Error('links stay on the service site');
  why = why || WHY.admin;
  const text = [
    BRAND,
    '',
    heading,
    intro,
    code ? '\n' + code + '\n' : '',
    ...items.map(i => '• ' + i.text + (i.meta ? ' (' + i.meta + ')' : '')),
    link ? '\n' + link.label + ': ' + link.url : '',
    ...notes,
    '',
    '—',
    BRAND + ' · ' + SERVICE,
    SUPPORT + ' (لو في أي مشكلة أو حاجة مش مفهومة)',
    why
  ].filter((l, i, all) => l !== '' || (i > 0 && all[i - 1] !== '')).join('\n');

  const p = (s, style) => '<p style="margin:0 0 12px;' + (style || '') + '">' + esc(s) + '</p>';
  const html = '<!doctype html>\n<html lang="ar" dir="rtl"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(heading) + '</title></head>' +
    '<body style="margin:0;padding:16px;background:#f5f3ee;color:#1f2430;font-family:Tahoma,Arial,sans-serif;font-size:15px;line-height:1.7;direction:rtl;text-align:right">' +
    '<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e4dfd3;border-radius:10px;padding:20px">' +
    '<p style="margin:0 0 4px;font-size:13px;color:#7a6326">' + esc(BRAND) + '</p>' +
    '<h1 style="margin:0 0 12px;font-size:19px;line-height:1.5;color:#1f2430">' + esc(heading) + '</h1>' +
    (intro ? p(intro, 'color:#3d4452') : '') +
    (code ? '<p style="margin:16px 0;font-size:28px;letter-spacing:6px;font-weight:bold;direction:ltr;text-align:center">' + esc(code) + '</p>' : '') +
    (items.length ? '<ul style="margin:0 0 14px;padding:0 20px 0 0">' + items.map(i => '<li style="margin:0 0 4px">' + esc(i.text) +
      (i.meta ? ' <span style="color:#7d8391">(<bdi dir="ltr">' + esc(i.meta) + '</bdi>)</span>' : '') + '</li>').join('') + '</ul>' : '') +
    (link ? '<p style="margin:0 0 6px"><a href="' + esc(link.url) + '" style="color:#7a5a12;font-weight:bold">' + esc(link.label) + '</a></p>' +
      '<p style="margin:0 0 14px;font-size:12px;color:#7d8391;direction:ltr;text-align:right;word-break:break-all">' + esc(link.url) + '</p>' : '') +
    notes.map(n => p(n, 'font-size:13px;color:#3d4452')).join('') +
    '<hr style="border:0;border-top:1px solid #e4dfd3;margin:16px 0">' +
    '<p style="margin:0 0 4px;font-size:12px;color:#7d8391">' + esc(BRAND) + ' · ' + esc(SERVICE) + '</p>' +
    '<p style="margin:0 0 4px;font-size:11px;color:#7d8391">' + esc(SUPPORT) + ' <span>(لو في أي مشكلة أو حاجة مش مفهومة)</span></p>' +
    '<p style="margin:0;font-size:12px;color:#7d8391">' + esc(why) + '</p>' +
    '</div></body></html>';
  return { html, text };
}

/* ---------------- admin (active) ---------------- */

const panel = path => ({ label: 'افتح لوحة التحكم', url: SITE + (path && path.startsWith('/admin/') ? path : '/admin/') });

/* the subject of each event type (the catalog's key); optional parts in [] */
const SUBJECTS = {
  'booking.new': '{countText}[ – {event}]',
  'booking.create': '{countText}[ – {event}]',
  'booking.confirm': 'تأكيد حجز {ref}[ – {event}]',
  'booking.reject': 'رفض حجز {ref}[ – {event}]',
  'booking.cancel': 'إلغاء حجز {ref}[ – {event}]',
  'booking.reopen': 'رجوع حجز {ref}[ – {event}]',
  'booking.update': 'تعديل حجز {ref}[ – {event}]',
  'booking.withdraw': 'الزائر لغى طلب الحجز {ref}[ – {event}]',
  'booking.remind': 'تذكير بالدفع في حجز {ref}[ – {event}]',
  'payment.add': 'دفعة جديدة في حجز {ref}[ – {event}]',
  'payment.refund': 'استرداد في حجز {ref}[ – {event}]',
  'payment.void': 'إلغاء دفعة في حجز {ref}[ – {event}]',
  'event.cancelAll': 'إلغاء كل الحجوزات[ – {event}]',
  'accounts.add': 'أدمن جديد في لوحة التحكم[: {target}]',
  'accounts.grants': 'تغيير صلاحيات[ {target}]',
  'accounts.remove': 'إزالة أدمن من لوحة التحكم[: {target}]',
  'notify.settings': 'تغيير إعدادات الإشعارات',
  'notify.failed': 'إشعار مقدرش يتبعت',
  'gmail.token': 'إرسال الإيميلات واقف',
  'job.failed': 'مهمة في الخلفية فشلت'
};

/* what the admin is asked to do, per type (no amounts, no visitor data) */
const INTROS = {
  'booking.new': 'فيه {countWord} في «{event}» مستني المراجعة في «الحجوزات».',
  'booking.create': 'اتسجّل {countWord} كاش في «{event}» مستني الاعتماد.',
  'payment.add': 'اتسجلت دفعة جديدة. المبلغ والتفاصيل في لوحة التحكم.',
  'payment.refund': 'اتسجل استرداد. المبلغ والتفاصيل في لوحة التحكم.',
  'payment.void': 'اتلغت دفعة. راجع الحجز في لوحة التحكم.',
  'event.cancelAll': 'كل حجوزات الفعالية اتلغت. راجع اللي محتاج يرجعله فلوس في «الحجوزات».'
};

/*
 * An admin notification or alert: m = catalog messageOf() (m.ctx carries the
 * event: key, ref, event, count, target). The subject and intro come from the
 * type; the lines say who did what and when.
 */
export function alertEmail(m, { level = 'important', kind = '' } = {}) {
  const ctx = m.ctx || {};
  const key = ctx.key || kind;
  const n = Number(ctx.count) || m.lines.length || 1;
  const cash = key === 'booking.create';
  const data = {
    ...ctx,
    countText: n === 1 ? (cash ? 'حجز كاش جديد' : 'حجز جديد') : digits(n) + (cash ? ' حجوزات كاش جديدة' : ' حجوزات جديدة'),
    countWord: n === 1 ? 'حجز جديد' : digits(n) + ' حجوزات جديدة'
  };
  let subject = m.title;
  let intro = m.body && m.body !== 'لوحة تحكم الأسرة' ? m.body : '';
  try { if (SUBJECTS[key]) subject = fill(SUBJECTS[key], data); } catch { subject = m.title; }
  try { if (INTROS[key]) intro = fill(INTROS[key], data); } catch { /* keep the router's text */ }
  const grouped = key === 'booking.new' || key === 'booking.create';
  return {
    subject: clip((level === 'critical' ? 'تنبيه مهم: ' : '') + subject, 90),
    ...layout({
      audience: 'admin',
      heading: subject,
      intro,
      items: (grouped ? m.lines.slice(-10) : m.lines.slice(-5)).map(l => ({ text: l.text, meta: l.cairo })),
      link: panel(m.url)
    })
  };
}

/* the day's summary for one admin */
export function summaryEmail(m, day) {
  return {
    subject: fill('ملخص نشاط لوحة التحكم[ – {day}]', { day }),
    ...layout({
      audience: 'admin',
      heading: 'ملخص نشاط لوحة التحكم',
      intro: fill('اللي حصل[ يوم {day}] في الحاجات اللي اخترت يوصلك ملخصها:', { day }),
      items: m.lines.slice(0, 40).map(l => ({ text: l.text, meta: l.cairo })),
      notes: m.lines.length > 40 ? ['و' + digits(m.lines.length - 40) + ' كمان في «سجل النشاط».'] : [],
      link: panel('/admin/#activity')
    })
  };
}

/* ---------------- member (Phase 5A; not sent by anything yet) ---------------- */

const CODE_PURPOSE = {
  verify: { subject: 'كود تأكيد الإيميل لحسابك', heading: 'كود تأكيد الإيميل', intro: 'اكتب الكود ده في صفحة التسجيل علشان تأكد إيميلك وتكمّل:' },
  recovery: { subject: 'كود استرجاع حسابك', heading: 'كود استرجاع الحساب', intro: 'اكتب الكود ده في صفحة «نسيت الباسورد» علشان تعمل باسورد جديد:' }
};

/* a one-time code: no link at all, the code only in the body (never the subject), the expiry, what to do if unasked */
export function otpEmail({ code, minutes = 10, purpose = 'verify' }) {
  if (!/^\d{6}$/.test(String(code))) throw new Error('otp code must be 6 digits');
  const t = CODE_PURPOSE[purpose];
  if (!t) throw new Error('unknown code purpose: ' + purpose);
  if (!(minutes >= 1 && minutes <= 60)) throw new Error('otp minutes out of range');
  return {
    subject: t.subject + ' – ' + BRAND,
    ...layout({
      audience: 'member',
      heading: t.heading,
      intro: t.intro,
      code: String(code),
      notes: [
        'الكود صالح لمدة ' + digits(minutes) + ' دقايق، ولمرة واحدة.',
        'متشاركش الكود مع أي حد، ولا حتى الخدام: محدش من الخدمة هيطلبه منك.'
      ],
      why: WHY.code
    })
  };
}

const SECURITY = {
  password_changed: { subject: 'الباسورد بتاع حسابك اتغير', text: 'الباسورد بتاع حسابك اتغير.' },
  email_changed: { subject: 'الإيميل بتاع حسابك اتغير', text: 'الإيميل المسجل في حسابك اتغير.' },
  recovery_used: { subject: 'حسابك اتسترجع بكود', text: 'حد استخدم كود استرجاع ودخل حسابك.' },
  new_signin: { subject: 'دخول جديد لحسابك', text: 'حسابك اتفتح من جهاز جديد.' }
};

/* a security notice to the account's owner: what changed, when, from where; help through the public site only */
export function securityEmail({ kind, cairo, device = '' }) {
  const t = SECURITY[kind];
  if (!t) throw new Error('unknown security notice: ' + kind);
  return {
    subject: t.subject + ' – ' + BRAND,
    ...layout({
      audience: 'member',
      heading: t.subject,
      intro: t.text,
      items: [{ text: 'امتى', meta: cairo }].concat(device ? [{ text: 'الجهاز', meta: clip(device, 60) }] : []).filter(i => i.meta),
      notes: ['لو ده انت، مش محتاج تعمل حاجة.', 'لو مش انت، كلّم الدعم الفني من أرقام التواصل اللي على موقع الخدمة على طول.'],
      link: { label: 'موقع الخدمة', url: SITE + '/' },
      why: WHY.security
    })
  };
}
