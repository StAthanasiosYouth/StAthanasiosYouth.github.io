// Email format and templates (deliverability pass): RFC 5322 / RFC 2047 /
// MIME structure of what the Worker hands Gmail, and what every template
// contains — and never contains.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mime, encodeWords, rfcDate, SENDER, SENDER_NAME } from '../src/notify/gmail.js';
import { alertEmail, summaryEmail, otpEmail, securityEmail, bookingEmail, layout, fill, SITE, BRAND } from '../src/notify/templates.js';
import { messageOf, typeOf } from '../src/notify/catalog.js';
import { render } from '../src/notify/email.js';

/* raw (base64url) → { lines, headers (unfolded, decoded), boundary, parts: [{ type, body }] } */
function parse(raw) {
  const text = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  const [head, ...rest] = text.split('\r\n\r\n');
  const lines = head.split('\r\n');
  const unfolded = head.replace(/\r\n[ \t]/g, ' ');
  // RFC 2047 §6.2: whitespace between two encoded-words is dropped, elsewhere kept
  const decode = v => v.replace(/\?=\s+=\?/g, '?==?').replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_, b) => Buffer.from(b, 'base64').toString('utf8')).trim();
  const headers = {};
  for (const l of unfolded.split('\r\n')) { const i = l.indexOf(':'); headers[l.slice(0, i).toLowerCase()] = decode(l.slice(i + 1).trim()); }
  const boundary = /boundary="([^"]+)"/.exec(headers['content-type'])[1];
  const parts = rest.join('\r\n\r\n').split('--' + boundary).slice(1, -1).map(chunk => {
    const [ph, body] = chunk.replace(/^\r\n/, '').split('\r\n\r\n');
    return { type: /Content-Type: ([^;]+)/.exec(ph)[1], encoding: /Content-Transfer-Encoding: (\S+)/.exec(ph)[1], body: Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8') };
  });
  return { text, lines, headers, boundary, parts };
}

const sample = { title: 'مرقس نشر الموقع على الإنترنت بعد ما راجع كل التعديلات الجديدة في صفحة الاجتماعات والأخبار', body: 'اتغيّر: العنوان، الصورة', url: '/admin/#activity/act-0123456789ab', lines: [{ text: 'مرقس نشر الموقع', cairo: '2026-10-20 10:00' }] };

test('headers: every line ≤ 78 chars, every encoded-word ≤ 75 (RFC 5322 / 2047), decoding back to the exact text', () => {
  const m = render(sample);
  const { lines, headers } = parse(mime({ to: 'admin@example.com', ...m, now: Date.UTC(2026, 9, 20, 8, 16) }));
  for (const l of lines) assert.ok(l.length <= 78, 'too long: ' + l);
  for (const w of lines.join(' ').match(/=\?UTF-8\?B\?[^?]+\?=/g)) assert.ok(w.length <= 75, w);
  assert.equal(headers.subject, m.subject);
  assert.equal(headers.from, SENDER_NAME + ' <' + SENDER + '>');
  assert.equal(headers.to, 'admin@example.com');
  assert.equal(headers.date, 'Tue, 20 Oct 2026 08:16:00 +0000');
  assert.equal(headers['mime-version'], '1.0');
  assert.equal(headers['content-language'], 'ar');
  assert.equal(headers['auto-submitted'], 'auto-generated');
  assert.equal(headers['reply-to'], undefined, 'no Reply-To elsewhere');
  assert.equal(headers['message-id'], undefined, 'Gmail adds its own');
  assert.match(headers['content-type'], /^multipart\/alternative;/);
});

test('encoded-words: never split a character; ASCII stays plain; no header injection', () => {
  const words = encodeWords('ملخص 🙂 '.repeat(20));
  const back = words.map(w => Buffer.from(/\?B\?([^?]+)\?=/.exec(w)[1], 'base64')).map(b => b.toString('utf8'));
  assert.ok(back.every(s => !s.includes('�')), 'a split character would decode to U+FFFD');
  assert.equal(back.join(''), ('ملخص 🙂 '.repeat(20)).trim());
  assert.deepEqual(encodeWords('Plain subject'), ['Plain subject']);
  const { headers, lines } = parse(mime({ to: 'a@example.com\r\nBcc: x@example.com', subject: 'x\r\nBcc: y@example.com', text: 't', html: '<p>h</p>' }));
  assert.equal(headers.bcc, undefined);
  assert.ok(!lines.some(l => /^Bcc:/i.test(l)));
  assert.equal(rfcDate(0), 'Thu, 01 Jan 1970 00:00:00 +0000');
});

test('MIME: text/plain then text/html (both UTF-8, base64 lines ≤ 76), the same content in both', () => {
  const m = render(sample);
  const { parts, text } = parse(mime({ to: 'a@example.com', ...m }));
  assert.deepEqual(parts.map(p => p.type), ['text/plain', 'text/html']);
  assert.ok(parts.every(p => p.encoding === 'base64'));
  for (const l of text.split('\r\n')) assert.ok(l.length <= 78, l.slice(0, 40));
  assert.equal(parts[0].body, m.text);
  assert.equal(parts[1].body, m.html);
  assert.match(parts[0].body, /مرقس نشر الموقع/);
  assert.match(parts[1].body, /<html lang="ar" dir="rtl"[ >]/);
  assert.match(parts[1].body, /<meta charset="utf-8">/);
});

/* a router message from real activity rows (catalog.messageOf), as the sender builds it */
const act = (action, over = {}) => ({ id: 'act-' + Math.random().toString(16).slice(2, 14), at: 1, cairo: '2026-10-20 10:00', actor: 'm@example.com', actor_name: 'مرقس', action, entity_type: 'booking', entity_id: 'bkg-aaaaaa', entity_title: 'B-7QK2M', summary: '', changes: null, event_title: 'رحلة الإسكندرية', ...over });
const msg = (action, rows) => messageOf(typeOf(rows[0]), rows, { 'm@example.com': 'مرقس' });
const allLinks = e => [...e.html.matchAll(/href="([^"]+)"/g)].map(x => x[1]);

test('sender identity: the exact display name in From, heading and footer; the real address', () => {
  assert.equal(BRAND, 'أسرة البابا أثناسيوس الرسولي لشباب سفاجا');
  assert.equal(SENDER_NAME, BRAND);
  assert.equal(SENDER, 'athanasius.youth.safaga@gmail.com');
  const e = alertEmail(msg('booking.confirm', [act('booking.confirm')]));
  const { headers } = parse(mime({ to: 'a@example.com', ...e }));
  assert.equal(headers.from, 'أسرة البابا أثناسيوس الرسولي لشباب سفاجا <athanasius.youth.safaga@gmail.com>');
  assert.match(e.text, /الدعم الفني: مينا زكريا – 01276162016/);
  assert.match(e.html, /الدعم الفني: مينا زكريا/);
  assert.match(e.html, /href="https:\/\/wa\.me\/201276162016"/);
  assert.match(e.html, /href="mailto:menazakmena@gmail\.com"/);
  assert.match(otpEmail({ code: '123456' }).text, /الدعم الفني: مينا زكريا/, 'in member emails too');
  assert.ok(e.text.startsWith(BRAND));
  assert.equal((e.html.match(new RegExp(BRAND, 'g')) || []).length, 3, 'the logo alt, the header and the footer');
});

test('fill: values replaced and length-capped; optional parts dropped when empty; a missing required value throws', () => {
  assert.equal(fill('تأكيد حجز {ref}[ – {event}]', { ref: 'B-1', event: 'رحلة' }), 'تأكيد حجز B-1 – رحلة');
  assert.equal(fill('تأكيد حجز {ref}[ – {event}]', { ref: 'B-1' }), 'تأكيد حجز B-1');
  assert.equal(fill('تأكيد حجز {ref}[ – {event}]', { ref: 'B-1', event: '  ' }), 'تأكيد حجز B-1');
  assert.throws(() => fill('تأكيد حجز {ref}', {}), /ref/);
  assert.ok(fill('{x}', { x: 'ا'.repeat(200) }).length <= 80);
});

test('admin subjects follow the event: new bookings (grouped), cash, confirm, cancel, payments, accounts, critical', () => {
  const two = [act('booking.new', { actor: 'visitor', actor_name: 'زائر', summary: 'رحلة الإسكندرية · 2 أفراد' }), act('booking.new', { actor: 'visitor', summary: 'رحلة الإسكندرية · 1 أفراد', event_title: undefined })];
  const cases = [
    [alertEmail(msg('booking.new', two.slice(0, 1))), 'حجز جديد – رحلة الإسكندرية'],
    [alertEmail(msg('booking.new', two)), '٢ حجوزات جديدة – رحلة الإسكندرية'],
    [alertEmail(msg('booking.create', [act('booking.create')])), 'حجز كاش جديد – رحلة الإسكندرية'],
    [alertEmail(msg('booking.confirm', [act('booking.confirm')])), 'تأكيد حجز B-7QK2M – رحلة الإسكندرية'],
    [alertEmail(msg('booking.cancel', [act('booking.cancel', { event_title: null })])), 'إلغاء حجز B-7QK2M'],
    [alertEmail(msg('payment.add', [act('payment.add')])), 'دفعة جديدة في حجز B-7QK2M – رحلة الإسكندرية'],
    [alertEmail(msg('payment.void', [act('payment.void')]), { level: 'critical' }), 'تنبيه مهم: إلغاء دفعة في حجز B-7QK2M – رحلة الإسكندرية'],
    [alertEmail(msg('accounts.add', [act('accounts.add', { entity_type: 'admin', entity_id: 'new@example.com', entity_title: 'new@example.com', summary: 'ضاف «new@example.com» للوحة التحكم' })]), { level: 'critical' }), 'تنبيه مهم: أدمن جديد في لوحة التحكم: new@example.com'],
    [alertEmail(msg('publish', [act('publish', { entity_type: 'site', entity_title: '', summary: 'نشر الموقع' })])), 'مرقس نشر الموقع']
  ];
  for (const [e, subject] of cases) {
    assert.equal(e.subject, subject);
    assert.doesNotMatch(e.subject + e.text + e.html, /\{\w+\}|undefined|null|NaN/, subject);
    assert.match(e.text, /مرقس|زائر|حجز/, 'the lines say who did what');
  }
  assert.match(cases[0][0].text, /مستني المراجعة/);
  assert.match(cases[5][0].text, /المبلغ والتفاصيل في لوحة التحكم/);
});

/* the fixed footer links every email may carry */
const FOOTER = new Set(['https://wa.me/201276162016', 'mailto:menazakmena@gmail.com', SITE + '/privacy/']);
const SOCIALS = ['https://www.facebook.com/Pope.Athanasius.The.Apostolic.Safaga', 'https://www.instagram.com/pope.athanasiustheapostolic/', 'https://www.tiktok.com/@stathanasios.safaga'];
const ownLinks = e => allLinks(e).filter(h => !FOOTER.has(h));

test('admin emails: one panel link (address shown) plus the support / privacy footer, no tracking / hidden text, why they get it; never visitor data or amounts', () => {
  const rows = [act('payment.add', { summary: '1500 جنيه كاش من سارة 01012345678', changes: JSON.stringify({ amount: 1500, phone: '01012345678' }) })];
  for (const e of [alertEmail(msg('payment.add', rows)), alertEmail(msg('booking.confirm', [act('booking.confirm')]), { level: 'critical' }), summaryEmail({ lines: [{ text: 'مرقس أكّد حجز B-7QK2M', cairo: '2026-10-20 10:00' }] }, '2026-10-20')]) {
    const hrefs = ownLinks(e);
    assert.equal(hrefs.length, 1);
    assert.ok(hrefs[0].startsWith(SITE + '/admin/'), hrefs[0]);
    assert.deepEqual(allLinks(e).filter(h => FOOTER.has(h)), [...FOOTER], 'support (WhatsApp, email) and the privacy policy');
    assert.ok(!SOCIALS.some(s => e.html.includes(s)), 'no social links in admin emails');
    assert.ok(e.html.includes('>' + hrefs[0] + '<'), 'the address is shown, not only behind the button');
    assert.ok(e.text.includes(hrefs[0]));
    assert.doesNotMatch(e.html, /<script|display:\s*none|visibility:\s*hidden|font-size:\s*0|utm_|[?&](token|sid)=/i);
    assert.doesNotMatch(e.html + e.text + e.subject, /1500|01012345678|سارة/, 'no amounts, phones or visitor names');
    assert.match(e.text, /وصلك الإيميل ده لأنك من خدام لوحة التحكم/);
    assert.doesNotMatch(e.subject, /!{2,}|عاجل|مجاني|اضغط هنا|[A-Z]{6,}/);
    assert.ok(e.subject.length <= 90);
  }
  assert.equal(summaryEmail({ lines: [] }, '2026-10-20').subject, 'ملخص نشاط لوحة التحكم – 2026-10-20');
  assert.equal(summaryEmail({ lines: [] }, '').subject, 'ملخص نشاط لوحة التحكم');
});

test('member codes (Phase 5A, not wired): verify / recovery — the code and expiry in the body, never a link or the code in the subject', () => {
  for (const [purpose, subject] of [['verify', 'كود تأكيد الإيميل لحسابك – ' + BRAND], ['recovery', 'كود استرجاع حسابك – ' + BRAND]]) {
    const e = otpEmail({ code: '482913', minutes: 15, purpose });
    assert.equal(e.subject, subject);
    assert.doesNotMatch(e.subject, /\d/);
    assert.deepEqual(ownLinks(e), [], 'no service link: support and privacy only');
    assert.ok(!SOCIALS.some(s => e.html.includes(s)), 'no social links in a code email');
    assert.doesNotMatch(e.text, /https?:\/\//);
    assert.match(e.text, /482913/);
    assert.match(e.html, /dir="ltr"><tr>(<td class="tile"[^>]*>\d<\/td>(<td width="\d+"[^>]*>&nbsp;<\/td>)?){6}<\/tr>/, 'six digit tiles, left to right');
    assert.match(e.text, /١٥ دقايق/);
    assert.match(e.text, /محدش من الخدمة هيطلبه منك/);
    assert.match(e.text, /لو مش انت، تجاهله/);
  }
  assert.throws(() => otpEmail({ code: '12ab' }));
  assert.throws(() => otpEmail({ code: '123456', purpose: 'admin' }));
  assert.throws(() => otpEmail({ code: '123456', minutes: 600 }));
});

test('member security notices (Phase 5A, not wired): what changed and when; help on the public site only, never an admin link', () => {
  const e = securityEmail({ kind: 'password_changed', cairo: '2026-10-20 10:00', device: 'موبايل أندرويد' });
  assert.equal(e.subject, 'الباسورد بتاع حسابك اتغير – ' + BRAND);
  assert.match(e.text, /الثلاثاء ٢٠ أكتوبر · ١٠:٠٠ ص/);
  assert.match(e.text, /موبايل أندرويد/);
  assert.deepEqual(ownLinks(e), [SITE + '/', SITE + '/'], 'the site: the button and the footer');
  assert.doesNotMatch(e.html + e.text, /\/admin/);
  for (const kind of ['email_changed', 'recovery_used', 'new_signin']) assert.ok(securityEmail({ kind, cairo: '2026-10-20 10:00' }).subject.endsWith(BRAND));
  assert.throws(() => securityEmail({ kind: 'nope' }));
  assert.throws(() => layout({ audience: 'member', heading: 'x', link: { label: 'x', url: SITE + '/admin/#x' } }), /admin link/);
  assert.throws(() => layout({ heading: 'x', link: { label: 'x', url: 'https://evil.example/' } }), /service site/);
});

test('layout escapes everything it is given', () => {
  const e = layout({ heading: '<script>x</script>', intro: '"><img src=x>', items: [{ text: '<b>', meta: '&' }], link: { label: 'a', url: SITE + '/admin/?a="b"' } });
  assert.doesNotMatch(e.html, /<script>x|<img src=x|<b>/);
  assert.match(e.html, /&lt;script&gt;/);
});

/* ---------- the Azure Crest design: email-safe structure and fallbacks ---------- */

const booking = over => bookingEmail({ status: 'balance', name: 'مارك', event: 'رحلة الإسكندرية الصيفية', when: 'الجمعة ١٤ نوفمبر · التجمع ٦:٠٠ ص', ref: 'B-7QK2M', people: 3, total: 900, paid: 600, due: 'الأربعاء ١٢ نوفمبر', next: 'ادفع الباقي بإنستاباي أو كاش مع خادم الحجوزات قبل الميعاد.', url: SITE + '/', ...over });
const every = () => [
  alertEmail(msg('booking.new', [act('booking.new', { actor: 'visitor', actor_name: 'زائر' })])),
  alertEmail(msg('accounts.grants', [act('accounts.grants', { entity_type: 'admin', entity_id: 'a@example.com', entity_title: 'a@example.com' })]), { level: 'critical' }),
  summaryEmail({ lines: Array.from({ length: 60 }, (_, i) => ({ text: 'مرقس أكّد حجز B-7QK2M رقم ' + i, cairo: '2026-10-20 10:0' + (i % 10), action: i % 3 ? 'booking.confirm' : 'payment.add' })) }, '2026-10-20'),
  otpEmail({ code: '482913' }), securityEmail({ kind: 'new_signin', cairo: '2026-10-20 10:00' }), booking()
];

test('email-safe HTML: tables + inline styles, a solid colour under every gradient, VML header for Outlook, under Gmail\'s clipping size', () => {
  for (const e of every()) {
    assert.ok(Buffer.byteLength(e.html) < 60 * 1024, 'well under the ~102 KB Gmail clips at: ' + Buffer.byteLength(e.html));
    assert.doesNotMatch(e.html, /<script|<svg|<form|<iframe|<video|position:\s*(absolute|fixed)|display:\s*(flex|grid)|var\(--/i, 'no scripts, SVG, forms or layout CSS clients drop');
    for (const style of e.html.match(/style="[^"]*gradient[^"]*"/g) || []) assert.match(style, /background-color:#[0-9A-F]{6}/i, 'gradient without a solid fallback: ' + style.slice(0, 80));
    assert.match(e.html, /bgcolor="#0D3F98" background="https:\/\/stathanasiosyouth\.github\.io\/assets\/email\/header\.jpg"/, 'header: navy with images off');
    assert.match(e.html, /<!--\[if gte mso 9\]><v:rect[^>]*><v:fill type="frame" src="[^"]+header\.jpg" color="#0D3F98"\/>/, 'Outlook: VML background');
    assert.match(e.html, /role="presentation"/);
    assert.match(e.html, /<meta name="color-scheme" content="light">/);
  }
});

test('images: only the service site\'s email assets, each with size and alt; the logo carries the brand name', () => {
  for (const e of every()) {
    const imgs = [...e.html.matchAll(/<img [^>]*>/g)].map(x => x[0]);
    assert.ok(imgs.length >= 3);
    for (const i of imgs) {
      assert.match(i, /src="https:\/\/stathanasiosyouth\.github\.io\/assets\/email\/[a-z-]+\.(png|jpg)"/, i);
      assert.match(i, /width="\d+" height="\d+"/, i);
      assert.match(i, / alt="[^"]*"/, i);
    }
    assert.match(e.html, /logo\.png" width="74" height="74" alt="شعار أسرة البابا/);
  }
});

test('member booking notice (Phase 5A design, not wired): status, reference, paid, remaining, due date, next step, social footer', () => {
  const e = booking();
  assert.equal(e.subject, 'تذكير بالمبلغ الباقي في حجزك B-7QK2M – رحلة الإسكندرية الصيفية');
  for (const s of ['B-7QK2M', 'مؤكد', 'عليه باقي', '٩٠٠ ج.م', '٦٠٠ ج.م', '٣٠٠ ج.م', 'الأربعاء ١٢ نوفمبر', 'الخطوة الجاية', 'أهلاً يا مارك']) {
    assert.ok(e.html.includes(s), 'html: ' + s);
    assert.ok(e.text.includes(s), 'text: ' + s);
  }
  assert.match(e.html, /<td width="67%" height="8"/, 'paid share of the bar');
  for (const s of SOCIALS) { assert.ok(e.html.includes('href="' + s + '"'), s); assert.ok(e.text.includes(s), s); }
  assert.doesNotMatch(e.html + e.text, /\/admin/);
  const paid = booking({ status: 'confirmed', paid: 900, next: '' });
  assert.doesNotMatch(paid.html + paid.text, /عليه باقي|آخر ميعاد للدفع|الباقي/);
  assert.doesNotMatch(booking({ status: 'cancelled' }).html, /عليه باقي/);
  assert.throws(() => booking({ status: 'nope' }));
  assert.throws(() => booking({ ref: '' }), /ref/);
  assert.throws(() => layout({ heading: 'x', social: true }), /member booking/);
});

test('alerts and summaries: priority bar for critical only, facts with the event context, the summary grouped by family', () => {
  const crit = alertEmail(msg('payment.void', [act('payment.void')]), { level: 'critical' });
  const norm = alertEmail(msg('booking.confirm', [act('booking.confirm')]));
  assert.match(crit.html, /bgcolor="#B42318"/);
  assert.match(crit.text, /\[تنبيه مهم · محتاج مراجعة\]/);
  assert.doesNotMatch(norm.html, /#B42318/);
  for (const s of ['بواسطة: مرقس', 'الفعالية: رحلة الإسكندرية', 'رقم الحجز: B-7QK2M', 'الوقت: الثلاثاء ٢٠ أكتوبر · ١٠:٠٠ ص']) assert.ok(norm.text.includes(s), s);
  assert.match(norm.html, /<span dir="ltr">B-7QK2M<\/span>/, 'references stay left to right');
  const s = summaryEmail({ lines: [
    { text: 'مرقس أكّد حجز B-1', cairo: '2026-10-20 14:10', action: 'booking.confirm' },
    { text: 'مرقس سجّل دفعة في حجز B-1', cairo: '2026-10-20 14:12', action: 'payment.add' },
    { text: 'كيرلس عدّل خبر', cairo: '2026-10-20 17:02', action: 'update' }] }, '2026-10-20');
  assert.match(s.text, /الحجوزات:\n• مرقس أكّد حجز B-1 \(٢:١٠ م\)/);
  assert.match(s.text, /المدفوعات:\n• مرقس سجّل دفعة/);
  assert.match(s.text, /المحتوى:\n• كيرلس/);
  assert.match(s.html, /الثلاثاء ٢٠ أكتوبر ٢٠٢٦/);
  assert.match(summaryEmail({ lines: [] }, '2026-10-20').text, /مفيش نشاط جديد/);
});

test('mail samples: every sample renders; the send route is staging only', async () => {
  const { SAMPLES, diagMailSample } = await import('../src/notify/samples.js');
  for (const [name, [level, make]] of Object.entries(SAMPLES)) {
    const m = make();
    assert.ok(m.subject && m.html.length > 1000 && m.text.length > 100, name);
    assert.ok(['otp', 'critical', 'important'].includes(level));
  }
  await assert.rejects(diagMailSample({ env: { ENVIRONMENT: 'production' }, body: { name: 'otp' } }), e => e.code === 'notfound' || /notfound/.test(e.message + e.code));
});
