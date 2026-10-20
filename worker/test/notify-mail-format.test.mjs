// Email format and templates (deliverability pass): RFC 5322 / RFC 2047 /
// MIME structure of what the Worker hands Gmail, and what every template
// contains — and never contains.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mime, encodeWords, rfcDate, SENDER, SENDER_NAME } from '../src/notify/gmail.js';
import { alertEmail, summaryEmail, otpEmail, layout, SITE } from '../src/notify/templates.js';
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

test('templates: one link, to the panel, its address shown as text; no images, tracking, hidden text or scripts; why the reader gets it', () => {
  for (const e of [alertEmail(sample), alertEmail(sample, { level: 'critical' }), summaryEmail({ ...sample, lines: Array.from({ length: 3 }, (_, i) => ({ text: 'بند ' + i, cairo: '2026-10-20 1' + i + ':00' })) }, '2026-10-20')]) {
    const hrefs = [...e.html.matchAll(/href="([^"]+)"/g)].map(x => x[1]);
    assert.equal(hrefs.length, 1);
    assert.ok(hrefs[0].startsWith(SITE + '/admin/'), hrefs[0]);
    assert.ok(e.html.includes('>' + hrefs[0] + '<'), 'the address is shown, not only behind the button');
    assert.ok(e.text.includes(hrefs[0]));
    assert.doesNotMatch(e.html, /<img|<script|display:\s*none|visibility:\s*hidden|font-size:\s*0|utm_|[?&](token|sid|ref)=/i);
    assert.match(e.html, /وصلك الإيميل ده لأنك من خدام لوحة التحكم/);
    assert.match(e.text, /وصلك الإيميل ده لأنك من خدام لوحة التحكم/);
    assert.match(e.text, /أسرة البابا أثناسيوس الرسولي/);
    assert.doesNotMatch(e.subject, /!{2,}|عاجل|مجاني|اضغط هنا|[A-Z]{6,}/, 'no urgency or decoration in the subject');
    assert.ok(e.subject.length <= 90);
  }
  assert.match(alertEmail(sample, { level: 'critical' }).subject, /^تنبيه مهم: /);
  assert.match(summaryEmail({ ...sample, lines: [] }, '2026-10-20').subject, /^ملخص نشاط لوحة التحكم – 2026-10-20$/);
});

test('booking notice: the count and the event only (no visitor data), one panel link', () => {
  const m = { title: '٢ حجوزات جديدة – رحلة إسكندرية', body: 'مستنيين المراجعة', url: '/admin/#activity/act-1', lines: [{ text: 'حجز جديد B-AAAA1', cairo: '2026-10-20 10:00' }] };
  const e = alertEmail(m, { kind: 'booking.new' });
  assert.equal(e.subject, '٢ حجوزات جديدة – رحلة إسكندرية');
  assert.doesNotMatch(e.html + e.text, /B-AAAA1|01\d{9}|\+20/);
  assert.match(e.text, /مستنية المراجعة/);
});

test('OTP (Phase 5A, not wired yet): no link at all, the code in the body only, the expiry, what to do if unasked', () => {
  const e = otpEmail({ code: '482913', minutes: 10 });
  assert.equal(e.subject, 'كود التأكيد لحسابك في شباب أثناسيوس');
  assert.doesNotMatch(e.subject, /\d/, 'the code is never in the subject (lock-screen previews)');
  assert.doesNotMatch(e.html, /<a\s|href=/);
  assert.doesNotMatch(e.text, /https?:\/\//);
  assert.match(e.text, /482913/);
  assert.match(e.text, /10 دقايق/);
  assert.match(e.text, /لو مش انت، تجاهله/);
  assert.throws(() => otpEmail({ code: '12ab' }));
});

test('layout escapes everything it is given', () => {
  const e = layout({ heading: '<script>x</script>', intro: '"><img src=x>', items: [{ text: '<b>', meta: '&' }], link: { label: 'a', url: SITE + '/admin/?a="b"' } });
  assert.doesNotMatch(e.html, /<script>x|<img src=x|<b>/);
  assert.match(e.html, /&lt;script&gt;/);
});
