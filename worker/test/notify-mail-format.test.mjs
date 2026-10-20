// Email format and templates (deliverability pass): RFC 5322 / RFC 2047 /
// MIME structure of what the Worker hands Gmail, and what every template
// contains — and never contains.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mime, encodeWords, rfcDate, SENDER, SENDER_NAME } from '../src/notify/gmail.js';
import { alertEmail, summaryEmail, otpEmail, securityEmail, layout, fill, SITE, BRAND } from '../src/notify/templates.js';
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
  assert.match(parts[1].body, /<html lang="ar" dir="rtl">/);
  assert.match(parts[1].body, /<meta charset="utf-8">/);
});

/* a router message from real activity rows (catalog.messageOf), as the sender builds it */
const act = (action, over = {}) => ({ id: 'act-' + Math.random().toString(16).slice(2, 14), at: 1, cairo: '2026-10-20 10:00', actor: 'm@example.com', actor_name: 'مرقس', action, entity_type: 'booking', entity_id: 'bkg-aaaaaa', entity_title: 'B-7QK2M', summary: '', changes: null, event_title: 'رحلة الإسكندرية', ...over });
const msg = (action, rows) => messageOf(typeOf(rows[0]), rows, { 'm@example.com': 'مرقس' });
const allLinks = e => [...e.html.matchAll(/href="([^"]+)"/g)].map(x => x[1]);

test('sender identity: the exact display name in From, heading and footer; the real address', () => {
  assert.equal(BRAND, 'أسرة البابا أثناسيوس الرسولي لشباب-سفاجا');
  assert.equal(SENDER_NAME, BRAND);
  assert.equal(SENDER, 'athanasius.youth.safaga@gmail.com');
  const e = alertEmail(msg('booking.confirm', [act('booking.confirm')]));
  const { headers } = parse(mime({ to: 'a@example.com', ...e }));
  assert.equal(headers.from, 'أسرة البابا أثناسيوس الرسولي لشباب-سفاجا <athanasius.youth.safaga@gmail.com>');
  for (const x of [e.text, e.html]) assert.match(x, /الدعم الفني: مينا زكريا – 01276162016/);
  assert.match(otpEmail({ code: '123456' }).text, /الدعم الفني: مينا زكريا/, 'in member emails too');
  assert.ok(e.text.startsWith(BRAND));
  assert.equal((e.html.match(new RegExp(BRAND, 'g')) || []).length, 2, 'the heading line and the footer');
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

test('admin emails: one panel link (address shown), no images / tracking / hidden text, why they get it; never visitor data or amounts', () => {
  const rows = [act('payment.add', { summary: '1500 جنيه كاش من سارة 01012345678', changes: JSON.stringify({ amount: 1500, phone: '01012345678' }) })];
  for (const e of [alertEmail(msg('payment.add', rows)), alertEmail(msg('booking.confirm', [act('booking.confirm')]), { level: 'critical' }), summaryEmail({ lines: [{ text: 'مرقس أكّد حجز B-7QK2M', cairo: '2026-10-20 10:00' }] }, '2026-10-20')]) {
    const hrefs = allLinks(e);
    assert.equal(hrefs.length, 1);
    assert.ok(hrefs[0].startsWith(SITE + '/admin/'), hrefs[0]);
    assert.ok(e.html.includes('>' + hrefs[0] + '<'), 'the address is shown, not only behind the button');
    assert.ok(e.text.includes(hrefs[0]));
    assert.doesNotMatch(e.html, /<img|<script|display:\s*none|visibility:\s*hidden|font-size:\s*0|utm_|[?&](token|sid)=/i);
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
    assert.equal(allLinks(e).length, 0);
    assert.doesNotMatch(e.text, /https?:\/\//);
    assert.match(e.text, /482913/);
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
  assert.match(e.text, /2026-10-20 10:00/);
  assert.match(e.text, /موبايل أندرويد/);
  assert.deepEqual(allLinks(e), [SITE + '/']);
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
