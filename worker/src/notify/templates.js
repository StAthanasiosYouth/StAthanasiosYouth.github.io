/*
 * Email templates (Phase 1.5 step 6; deliverability pass): one plain layout
 * for every automatic email of the service, Arabic RTL, HTML + an equivalent
 * plain text.
 *
 * What every email keeps to (Gmail sender guidelines; plain, honest mail):
 * - who sends it and why the reader gets it, in the footer;
 * - one link at most, to the service's own panel, its address shown as text
 *   too (the button's words never hide where it goes); an OTP has none;
 * - no images, no tracking pixels, no hidden text, no link shorteners;
 * - a descriptive subject (what happened), no urgency words or decoration;
 * - no visitor names, phones, payment numbers or amounts (the router's
 *   messages already leave them out).
 */

export const BRAND = 'شباب أثناسيوس';
export const SERVICE = 'أسرة البابا أثناسيوس الرسولي – كنيسة أبي سيفين بسفاجا';
export const SITE = 'https://stathanasiosyouth.github.io';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

const WHY_ADMIN = 'وصلك الإيميل ده لأنك من خدام لوحة التحكم في الخدمة. تقدر تختار اللي يوصلك من «تنبيهاتي» في لوحة التحكم.';

/* { heading, intro, items: [{ text, meta }], link: { label, url }, code, notes: [], why } → { html, text } */
export function layout({ heading, intro = '', items = [], link = null, code = '', notes = [], why = WHY_ADMIN }) {
  const text = [
    heading,
    intro,
    code ? '\n' + code + '\n' : '',
    ...items.map(i => '• ' + i.text + (i.meta ? ' (' + i.meta + ')' : '')),
    link ? '\n' + link.label + ': ' + link.url : '',
    ...notes,
    '',
    '—',
    BRAND + ' · ' + SERVICE,
    why
  ].filter((l, i, all) => l !== '' || (all[i - 1] !== '' && i > 0)).join('\n');

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
      '<p style="margin:0 0 14px;font-size:12px;color:#7d8391;direction:ltr;text-align:right">' + esc(link.url) + '</p>' : '') +
    notes.map(n => p(n, 'font-size:13px;color:#3d4452')).join('') +
    '<hr style="border:0;border-top:1px solid #e4dfd3;margin:16px 0">' +
    '<p style="margin:0 0 4px;font-size:12px;color:#7d8391">' + esc(BRAND) + ' · ' + esc(SERVICE) + '</p>' +
    '<p style="margin:0;font-size:12px;color:#7d8391">' + esc(why) + '</p>' +
    '</div></body></html>';
  return { html, text };
}

const panel = path => ({ label: 'افتح لوحة التحكم', url: SITE + (path || '/admin/') });

/* an admin alert or a booking notice: m = catalog messageOf() */
export function alertEmail(m, { level = 'important', kind = '' } = {}) {
  const booking = kind === 'booking.new' || kind === 'booking.create';
  const items = (booking ? [] : m.lines.slice(-5)).map(l => ({ text: l.text, meta: l.cairo }));
  const subject = clip((level === 'critical' ? 'تنبيه مهم: ' : '') + m.title, 90);
  return {
    subject,
    ...layout({
      heading: m.title,
      intro: booking ? 'فيه حجوزات مستنية المراجعة في «الحجوزات».' : (m.body && m.body !== 'لوحة تحكم الأسرة' ? m.body : ''),
      items,
      link: panel(m.url)
    })
  };
}

/* the day's summary for one admin */
export function summaryEmail(m, day) {
  return {
    subject: clip('ملخص نشاط لوحة التحكم' + (day ? ' – ' + day : ''), 90),
    ...layout({
      heading: 'ملخص نشاط لوحة التحكم',
      intro: 'اللي حصل' + (day ? ' يوم ' + day : '') + ' في الحاجات اللي اخترت يوصلك ملخصها:',
      items: m.lines.slice(0, 40).map(l => ({ text: l.text, meta: l.cairo })),
      notes: m.lines.length > 40 ? ['و' + (m.lines.length - 40) + ' كمان في «سجل النشاط».'] : [],
      link: panel('/admin/#activity')
    })
  };
}

/*
 * A one-time verification code (Phase 5A accounts; not sent by anything yet).
 * No link at all, the code only in the body, how long it lasts, and what to
 * do when the reader didn't ask for it.
 */
export function otpEmail({ code, minutes = 10 }) {
  if (!/^\d{6}$/.test(String(code))) throw new Error('otp code must be 6 digits');
  return {
    subject: 'كود التأكيد لحسابك في ' + BRAND,
    ...layout({
      heading: 'كود التأكيد',
      intro: 'اكتب الكود ده في صفحة التسجيل علشان تكمّل:',
      code: String(code),
      notes: ['الكود صالح لمدة ' + minutes + ' دقايق، ولمرة واحدة.', 'متشاركش الكود مع أي حد، ولا حتى الخدام.'],
      why: 'وصلك الإيميل ده لأن حد طلب كود تأكيد بالإيميل ده على موقع الخدمة. لو مش انت، تجاهله ومش هيحصل حاجة.'
    })
  };
}
