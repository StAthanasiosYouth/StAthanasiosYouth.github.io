/*
 * Sample emails: every template with realistic Arabic sample data (no real
 * people, no real bookings). Used by scripts/mail-preview.mjs and by the
 * STAGING ONLY route POST /v1/admin/diag/mail-sample, which sends ONE sample
 * to the single test address the owner set (settings MAIL_TEST_TO), and only
 * while NOTIFY_EMAIL is on.
 */
import { alertEmail, summaryEmail, otpEmail, securityEmail, bookingEmail, SITE } from './templates.js';
import { messageOf, typeOf } from './catalog.js';
import { sendMail } from './gmail.js';
import { countStmt, hourKey, quotaOf, budget, allowed } from './email.js';
import { ApiError } from '../lib/http.js';
import { retry } from '../lib/db.js';

const act = (action, over = {}) => ({ id: 'act-0123456789ab', at: 1, cairo: '2026-10-20 21:12', actor: 'treasurer@example.com', actor_name: 'مرقس فادي', action, entity_type: 'booking', entity_id: 'bkg-7qk2ma', entity_title: 'B-7QK2M', summary: '', changes: null, event_title: 'رحلة الإسكندرية الصيفية', ...over });
const msg = (action, rows) => messageOf(typeOf(rows[0]), rows, {});
const line = (text, time, action) => ({ text, cairo: '2026-10-20 ' + time, action });

/* name → [level, () => { subject, html, text }] */
export const SAMPLES = {
  'otp': ['otp', () => otpEmail({ code: '482913', minutes: 10 })],
  'booking-balance': ['important', () => bookingEmail({ status: 'balance', name: 'مارك', event: 'رحلة الإسكندرية الصيفية', when: 'الجمعة ١٤ نوفمبر ٢٠٢٦ · التجمع ٦:٠٠ ص قدام الكنيسة', ref: 'B-7QK2M', people: 3, total: 900, paid: 600, due: 'الأربعاء ١٢ نوفمبر', next: 'ادفع الباقي بإنستاباي من صفحة الحجز، أو كاش مع خادم الحجوزات قبل ميعاد الدفع.', url: SITE + '/#me/bookings/B-7QK2M' })],
  'alert-critical': ['critical', () => alertEmail(msg('pay.approve', [act('pay.approve', { entity_type: 'servant', entity_id: 'srv-aaaa1111', entity_title: 'مينا عادل', summary: 'اعتمد رقم إنستاباي الخادم «مينا عادل»', event_title: null })]), { level: 'critical' })],
  'alert-booking': ['important', () => alertEmail(msg('booking.new', [act('booking.new', { actor: 'visitor', actor_name: 'زائر', summary: 'رحلة الإسكندرية الصيفية · 3 أفراد' }), act('booking.new', { actor: 'visitor', actor_name: 'زائر', entity_title: 'B-4TR8N', cairo: '2026-10-20 21:20' })]))],
  'summary': ['important', () => summaryEmail({ lines: [
    line('بيشوي سمير أكّد حجز B-4TR8N', '14:10', 'booking.confirm'), line('٣ حجوزات جديدة · رحلة الإسكندرية', '15:45', 'booking.new'),
    line('مينا عادل سجّل حجز كاش B-9PX3A', '18:20', 'booking.create'), line('بيشوي سمير سجّل دفعة في حجز B-4TR8N', '14:12', 'payment.add'),
    line('مرقس فادي اعتمد دفعة إنستاباي في حجز B-7QK2M', '20:05', 'payment.add'), line('كيرلس عماد عدّل خبر «اجتماع الشباب»', '17:02', 'update')] }, '2026-10-20')],
  'security': ['important', () => securityEmail({ kind: 'new_signin', cairo: '2026-10-20 21:40', device: 'موبايل أندرويد · كروم' })]
};

/* STAGING ONLY: send ONE sample (body { name }) to MAIL_TEST_TO; refused unless NOTIFY_EMAIL is on; counted in the budget */
export async function diagMailSample(ctx) {
  if (ctx.env.ENVIRONMENT !== 'staging') throw new ApiError('notfound');
  const name = ctx.body && ctx.body.name;
  if (!SAMPLES[name]) throw new ApiError('bad', 'sample', { names: Object.keys(SAMPLES) });
  const db = ctx.env.DB;
  const s = Object.fromEntries((await retry(() => db.prepare("SELECT key, value FROM settings WHERE key IN ('NOTIFY_EMAIL', 'MAIL_TEST_TO', 'MAIL_DAILY_TARGET', 'MAIL_ADMIN_BUDGET', 'MAIL_RESERVE_CRITICAL', 'MAIL_RESERVE_OTP')").all())).results.map(r => [r.key, r.value]));
  if (s.NOTIFY_EMAIL !== '1') throw new ApiError('bad', 'email off');
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(s.MAIL_TEST_TO || '')) throw new ApiError('bad', 'no test address');
  const [level, make] = SAMPLES[name];
  const now = Date.now();
  if (!allowed(level, await quotaOf(db, now), budget(s))) throw new ApiError('bad', 'quota');
  const m = make();
  await sendMail(ctx.env, { to: s.MAIL_TEST_TO, ...m });
  await retry(() => countStmt(db, hourKey(now), level).run());
  return { sent: name, subject: m.subject, bytes: m.html.length };
}
