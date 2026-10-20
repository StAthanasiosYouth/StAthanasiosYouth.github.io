// Email previews (nothing is sent): every template with realistic sample data,
// written as .html (as Gmail receives it), .txt (the plain-text part) and .eml
// (the full MIME message, to open in Outlook / Apple Mail / Thunderbird), plus
// two fallback views: images off, and Outlook-like (no gradients, no rounded
// corners, no background images).
//
//   node scripts/mail-preview.mjs <out-dir> [--local]
//
// --local points the images at ../assets/email/ on disk (before they are live on the site).
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { alertEmail, summaryEmail, otpEmail, securityEmail, bookingEmail, SITE } from '../src/notify/templates.js';
import { messageOf, typeOf } from '../src/notify/catalog.js';
import { mime } from '../src/notify/gmail.js';

const out = resolve(process.argv[2] || 'mail-preview');
const local = process.argv.includes('--local');
mkdirSync(out, { recursive: true });
const assets = pathToFileURL(resolve(import.meta.dirname, '../../assets/email')).href + '/';

const act = (action, over = {}) => ({ id: 'act-0123456789ab', at: 1, cairo: '2026-10-20 21:12', actor: 'treasurer@example.com', actor_name: 'مرقس فادي', action, entity_type: 'booking', entity_id: 'bkg-7qk2ma', entity_title: 'B-7QK2M', summary: '', changes: null, event_title: 'رحلة الإسكندرية الصيفية', ...over });
const msg = (action, rows) => messageOf(typeOf(rows[0]), rows, {});
const line = (text, time, action) => ({ text, cairo: '2026-10-20 ' + time, action });

const mails = {
  'otp': otpEmail({ code: '482913', minutes: 10 }),
  'booking-balance': bookingEmail({ status: 'balance', name: 'مارك', event: 'رحلة الإسكندرية الصيفية', when: 'الجمعة ١٤ نوفمبر ٢٠٢٦ · التجمع ٦:٠٠ ص قدام الكنيسة', ref: 'B-7QK2M', people: 3, total: 900, paid: 600, due: 'الأربعاء ١٢ نوفمبر', next: 'ادفع الباقي بإنستاباي من صفحة الحجز، أو كاش مع خادم الحجوزات قبل ميعاد الدفع.', url: SITE + '/' }),
  'alert-critical': alertEmail(msg('pay.approve', [act('pay.approve', { entity_type: 'servant', entity_id: 'srv-aaaa1111', entity_title: 'مينا عادل', summary: 'اعتمد رقم إنستاباي الخادم «مينا عادل»', event_title: null })]), { level: 'critical' }),
  'alert-booking': alertEmail(msg('booking.new', [act('booking.new', { actor: 'visitor', actor_name: 'زائر', summary: 'رحلة الإسكندرية الصيفية · 3 أفراد' }), act('booking.new', { actor: 'visitor', actor_name: 'زائر', entity_title: 'B-4TR8N', cairo: '2026-10-20 21:20' })])),
  'summary': summaryEmail({ lines: [
    line('بيشوي سمير أكّد حجز B-4TR8N', '14:10', 'booking.confirm'), line('٣ حجوزات جديدة · رحلة الإسكندرية', '15:45', 'booking.new'),
    line('مينا عادل سجّل حجز كاش B-9PX3A', '18:20', 'booking.create'), line('بيشوي سمير سجّل دفعة في حجز B-4TR8N', '14:12', 'payment.add'),
    line('مرقس فادي اعتمد دفعة إنستاباي في حجز B-7QK2M', '20:05', 'payment.add'), line('كيرلس عماد عدّل خبر «اجتماع الشباب»', '17:02', 'update')] }, '2026-10-20'),
  'security': securityEmail({ kind: 'new_signin', cairo: '2026-10-20 21:40', device: 'موبايل أندرويد · كروم' })
};

const swap = html => (local ? html.split(SITE + '/assets/email/').join(assets) : html);
const imagesOff = html => html.replace(/<img [^>]*>/g, '').replace(/background-image:url\([^)]*\);?/g, '').replace(/ background="[^"]*"/g, '');
const outlookish = html => imagesOff(html).replace(/background-image:linear-gradient\([^;"]*\);?/g, '').replace(/border-radius:[^;"]*;?/g, '');

const index = [];
for (const [name, m] of Object.entries(mails)) {
  writeFileSync(`${out}/${name}.html`, swap(m.html));
  writeFileSync(`${out}/${name}.txt`, m.subject + '\n\n' + m.text);
  writeFileSync(`${out}/${name}.images-off.html`, imagesOff(m.html));
  writeFileSync(`${out}/${name}.outlook.html`, outlookish(m.html));
  const raw = mime({ to: 'preview@example.com', ...m, now: Date.UTC(2026, 9, 20, 19, 12) });
  writeFileSync(`${out}/${name}.eml`, Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
  index.push(`${name.padEnd(16)} ${String(Buffer.byteLength(m.html)).padStart(6)} B html · subject: ${m.subject}`);
}
console.log(index.join('\n'));
