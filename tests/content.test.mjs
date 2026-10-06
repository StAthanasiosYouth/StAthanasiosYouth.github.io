// Tests for apps-script/Content.gs (the publish-time content model).
// Run: cd tools && npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGs, sha256 } from '../tools/lib/gs.mjs';

const gs = loadGs();

const NOW = '2026-10-05T19:00';

function build(mutate = d => d, now = NOW) {
  const draft = JSON.parse(JSON.stringify(gs.seedDraft()));
  mutate(draft);
  return gs.buildPublicContent(draft, { now, hash: sha256 });
}

const plain = value => JSON.parse(JSON.stringify(value));


test('seed builds without errors or warnings', () => {
  const { errors, warnings, content } = build();
  assert.deepEqual(plain(errors), []);
  assert.deepEqual(plain(warnings), []);
  assert.equal(content.site.name, 'أسرة البابا أثناسيوس لخدمة شعب كنيستها الحبيبة في سفاجا');
  assert.equal(content.featured[0].id, 'your-voice-matters');
  assert.deepEqual(plain(content.sections[0].links.map(l => l.id)), ['facebook', 'instagram', 'tiktok']);
});

test('seed does not contain the servants-only topics portal', () => {
  const json = JSON.stringify(build().content);
  assert.ok(!json.includes('مواضيع'));
});

test('public content carries no internal fields', () => {
  const json = JSON.stringify(build().content);
  for (const key of ['enabled', 'order', '__index', '__order', '"phone"', 'message', '"method"']) {
    assert.ok(!json.includes(key), `leaked ${key}`);
  }
});

test('safeHttpsUrl allowlist', () => {
  const ok = [
    'https://www.facebook.com/x',
    'https://wa.me/201276162016?text=hi',
    'https://example.com:8443/a?b=c#d'
  ];
  const bad = [
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'http://example.com',
    'data:text/html,<b>x</b>',
    'https://user:pass@evil.com',
    'https://evil.com@good.com',
    'https://exa mple.com',
    'https://example.com/"onmouseover="x',
    'https://localhost/',
    '//example.com',
    'https://'
  ];
  for (const u of ok) assert.equal(gs.safeHttpsUrl(u), u, u);
  for (const u of bad) assert.equal(gs.safeHttpsUrl(u), '', u);
});

test('phone normalization', () => {
  assert.deepEqual(plain(gs.normalizePhone('+20 12 20129458')), { e164: '201220129458', display: '0122 012 9458' });
  assert.deepEqual(plain(gs.normalizePhone('01276162016')), { e164: '201276162016', display: '0127 616 2016' });
  assert.deepEqual(plain(gs.normalizePhone('٠١٢٧٦١٦٢٠١٦')), { e164: '201276162016', display: '0127 616 2016' });
  assert.deepEqual(plain(gs.normalizePhone('0020 1276162016')), { e164: '201276162016', display: '0127 616 2016' });
  assert.equal(gs.normalizePhone('12345'), null);
  assert.equal(gs.normalizePhone('01x'), null);
  assert.equal(gs.normalizePhone('12+3456789012'), null);
});

test('contact actions: Fady call only, Mena WhatsApp only', () => {
  const [fady, mena] = build().content.contacts;
  assert.deepEqual(plain(fady.action), { type: 'call', href: 'tel:+201220129458', label: 'اتصال' });
  assert.equal(mena.action.type, 'whatsapp');
  assert.ok(mena.action.href.startsWith('https://wa.me/201276162016?text='));
  assert.equal(mena.kind, 'support');
});

test('time and day parsing', () => {
  assert.equal(gs.contentTime_('20:00'), '20:00');
  assert.equal(gs.contentTime_('8 pm'), '20:00');
  assert.equal(gs.contentTime_('٨:٣٠ م'), '20:30');
  assert.equal(gs.contentTime_('12 am'), '00:00');
  assert.equal(gs.contentTime_('25:00'), null);
  assert.equal(gs.contentDay_('الأحد'), 0);
  assert.equal(gs.contentDay_('Friday'), 5);
  assert.equal(gs.contentDay_('3'), 3);
  assert.equal(gs.contentDay_('someday'), null);
});

test('dates: date-only start/end expand to start/end of day; invalid dates rejected', () => {
  assert.equal(gs.contentDateTime_('2026-10-12', false), '2026-10-12T00:00');
  assert.equal(gs.contentDateTime_('2026-10-12', true), '2026-10-12T23:59');
  assert.equal(gs.contentDateTime_('2026-10-12 18:30', true), '2026-10-12T18:30');
  assert.equal(gs.contentDateTime_('2026-02-30', false), null);
  assert.equal(gs.contentDateTime_('', false), '');
});

test('meeting duration: empty means unknown, invalid is an error', () => {
  assert.equal(build().content.meeting.durationMinutes, null);
  assert.equal(build(d => { d.settings['meeting.durationMinutes'] = '120'; }).content.meeting.durationMinutes, 120);
  const { errors } = build(d => { d.settings['meeting.durationMinutes'] = 'ساعتين'; });
  assert.equal(errors.length, 1);
});

test('skip dates: past ones dropped, future ones kept sorted', () => {
  const { content } = build(d => { d.settings['meeting.skipDates'] = '2026-10-19، 2026-10-12, 2026-09-01'; });
  assert.deepEqual(plain(content.meeting.skipDates), ['2026-10-12', '2026-10-19']);
});

test('disabled meeting is null', () => {
  assert.equal(build(d => { d.settings['meeting.enabled'] = false; }).content.meeting, null);
});

test('link validation errors block publishing', () => {
  const { errors } = build(d => {
    d.links.push({ id: 'bad', enabled: true, order: 1, section: 'links', style: 'card', title: 'x', url: 'javascript:alert(1)' });
    d.links.push({ id: 'bad2', enabled: true, order: 2, section: 'nope', style: 'card', title: 'y', url: 'https://a.com' });
    d.links.push({ id: 'bad', enabled: true, order: 3, section: 'links', style: 'card', title: 'dup', url: 'https://a.com' });
  });
  const messages = errors.map(e => e.message).join('\n');
  assert.match(messages, /https/);
  assert.match(messages, /nope/);
  assert.match(messages, /متكرر/);
});

test('disabled links are excluded; expired links excluded with a warning; future links kept with dates', () => {
  const { content, warnings } = build(d => {
    d.links.find(l => l.id === 'tiktok').enabled = false;
    d.links.push({ id: 'old', enabled: true, order: 1, section: 'links', style: 'card', title: 'old', url: 'https://a.com', endAt: '2026-10-01' });
    d.links.push({ id: 'soon', enabled: true, order: 2, section: 'links', style: 'card', title: 'soon', url: 'https://a.com', startAt: '2026-10-10', endAt: '2026-10-20' });
  });
  const ids = content.sections.flatMap(s => s.links.map(l => l.id));
  assert.ok(!ids.includes('tiktok'));
  assert.ok(!ids.includes('old'));
  const soon = content.sections.find(s => s.key === 'links').links[0];
  assert.equal(soon.startAt, '2026-10-10T00:00');
  assert.equal(soon.endAt, '2026-10-20T23:59');
  assert.equal(warnings.length, 1);
});

test('empty and disabled sections are not published', () => {
  const { content } = build(d => { d.sections[0].enabled = false; });
  assert.deepEqual(plain(content.sections), []);
  assert.equal(build().content.sections.length, 1, 'empty "links" section omitted');
});

test('unknown icon falls back to link with a warning', () => {
  const { content, warnings } = build(d => { d.links[1].icon = 'rocket'; });
  assert.equal(content.sections[0].links[0].icon, 'link');
  assert.equal(warnings.length, 1);
});

test('announcement: enabled, expiry, link validation', () => {
  const on = d => {
    d.settings['announcement.enabled'] = true;
    d.settings['announcement.text'] = 'مفيش اجتماع الأحد ده';
    d.settings['announcement.tone'] = 'alert';
  };
  assert.equal(build(on).content.announcement.text, 'مفيش اجتماع الأحد ده');
  assert.equal(build(on).content.announcement.link, null);
  assert.equal(build(d => { on(d); d.settings['announcement.expiresAt'] = '2026-10-01'; }).content.announcement, null);
  assert.equal(build(d => { on(d); d.settings['announcement.linkUrl'] = 'http://x.com'; }).errors.length, 1);
  assert.equal(build(d => { on(d); d.settings['announcement.text'] = ''; }).errors.length, 1);
});

test('revision is stable and changes with visible content', () => {
  const a = build().content.revision;
  assert.equal(build().content.revision, a);
  assert.notEqual(build(d => { d.links[1].title = 'Facebook'; }).content.revision, a);
  assert.match(a, /^[0-9a-f]{12}$/);
});

test('ICS: weekly rule, first occurrence, 75-octet folding, exdates, duration', () => {
  const { content } = build(d => {
    d.settings['meeting.durationMinutes'] = 120;
    d.settings['meeting.skipDates'] = '2026-10-18';
  });
  const ics = gs.buildMeetingIcs(content, '2026-10-05', '20261005T160000Z', 'https://example.org/');
  assert.match(ics, /DTSTART;TZID=Africa\/Cairo:20261011T200000/);
  assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=SU/);
  assert.match(ics, /DURATION:PT120M/);
  assert.match(ics, /EXDATE;TZID=Africa\/Cairo:20261018T200000/);
  for (const line of ics.split('\r\n')) {
    assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `line too long: ${line}`);
  }
  // unfolding restores the summary
  const unfolded = ics.replace(/\r\n /g, '');
  assert.ok(unfolded.includes('SUMMARY:اجتماع الشباب — أسرة البابا أثناسيوس لخدمة شعب كنيستها الحبيبة في سفاجا'));
  // same-day meeting starts today
  assert.match(gs.buildMeetingIcs(content, '2026-10-11', 'x', ''), /DTSTART;TZID=Africa\/Cairo:20261011T200000/);
});

test('change summary', () => {
  const before = build().content;
  assert.deepEqual(plain(gs.summarizeChanges(before, before)), []);
  assert.deepEqual(plain(gs.summarizeChanges(null, before)), ['أول نشر للموقع']);
  const after = build(d => {
    d.settings['meeting.time'] = '19:00';
    d.links.find(l => l.id === 'tiktok').enabled = false;
    d.links.push({ id: 'trip', enabled: true, order: 1, section: 'links', style: 'card', title: 'رحلة', url: 'https://a.com' });
  }).content;
  const lines = gs.summarizeChanges(before, after);
  assert.ok(lines.includes('معاد الاجتماع بقى: كل الأحد، ٧:٠٠ م'), lines.join(' | '));
  assert.ok(lines.includes('رابط جديد: رحلة'));
  assert.ok(lines.includes('إخفاء/حذف رابط: تيك توك'));
});
