/*
 * «خبزنا اليومي» W7 part A — St-Takla.org as a content source (docs/daily-bread/progress/W7.md):
 * a topic's source page, the month's suggestions passed on to the admin, and the month's feasts by date.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, fakeGoogle } from './helpers.mjs';
import { checkTopic, topicFile, checkFeasts } from '../src/bread/model.js';
import { SUGGEST_URL } from '../src/bread/admin.js';
import { forgetAccessToken } from '../src/push/fcm.js';

const KEYS = { PW_PEPPER: 'pepper-test', PW_KEY: Buffer.alloc(32, 7).toString('base64'), OTP_PEPPER: 'otp-test', ACCOUNT_PAD_MS: '0' };
const P = 'p@example.com';
const PAGE = 'https://st-takla.org/Full-Free-Coptic-Books/His-Holiness-Pope-Shenouda-III-Books-Online/01-Words-of-Spiritual-Benefit_Pope-Shenouda/100-Mahabet-El-That_Self-Love.html';
const topic = (over = {}) => ({
  n: 1, title: 'محبة الذات', verseRef: 'رومية ١٢: ١٠', verse: 'وَادِّينَ بَعْضُكُمْ بَعْضًا', readingRef: 'رومية ١٢: ٩–١٢',
  reading: [{ book: 'رومية', chapter: 12, verses: [[9, 'نص ٩'], [10, 'نص ١٠']] }], meditation: 'المحبة الحقيقية للذات… [الله](https://st-takla.org/x.html)', ...over
});
const feast = (over = {}) => ({ date: '2026-12-04', name: 'الشهيد العظيم أبي سيفين', title: 'استشهاد القديس مرقوريوس', word: 'في مثل هذا اليوم…',
  url: 'https://st-takla.org/zJ/index.php/ar-readings-katamares?view=reading-arabic&iday=4&imonth=12&iyear=2026', img: 'https://st-takla.org/Gallery/var/resizes/a.jpg', ...over });

async function world() {
  forgetAccessToken();
  const g = await fakeGoogle();
  const h = harness({ env: { ENVIRONMENT: 'staging', ADMIN_EMAILS: '', ...KEYS } });
  await h.db.prepare(`INSERT INTO admins (email, name, role, active, created_at) VALUES ('${P}', 'P', 'primary', 1, 0)`).run();
  const admin = async (method, path, body) => h.call('/v1/admin/' + path, { method, body, headers: { authorization: 'Bearer ' + await g.sign(g.claims({ email: P, sub: 's-p' })) }, fetch: g.fetch });
  return { h, g, admin };
}

test('a topic keeps its St-Takla page (their terms, FAQ 043); any other host is refused; the file carries it', () => {
  const ok = checkTopic(topic({ sourceUrl: PAGE, sourceRefs: 'كتاب «كلمة منفعة»' }), 7);
  assert.equal(ok.ok, true);
  assert.equal(ok.topic.sourceUrl, PAGE);
  assert.deepEqual(JSON.parse(topicFile('brd-0123456789', ok.topic)).source, { url: PAGE, refs: 'كتاب «كلمة منفعة»' });
  const none = checkTopic(topic(), 7);
  assert.equal(none.ok, true);
  assert.equal(JSON.parse(topicFile('brd-0123456789', none.topic)).source, undefined, 'an Excel topic has no source');
  for (const bad of ['https://example.com/x.html', 'http://st-takla.org/x.html', 'https://st-takla.org.evil.com/x', 'javascript:alert(1)']) {
    const r = checkTopic(topic({ sourceUrl: bad }), 7);
    assert.equal(r.ok, false, bad);
    assert.equal(r.errors[0].field, 'sourceUrl');
  }
  assert.equal(checkTopic(topic({ meditation: 'x'.repeat(3900) }), 7).ok, true, 'links make the meditation longer: 4000');
});

test('checkFeasts: dates inside the month, https sources, St-Takla or our own saint pictures, praise with its source, one a day, sorted', () => {
  const c = checkFeasts({ month: '2026-12', feasts: [feast({ date: '2026-12-17', name: 'الشهيدة بربارة' }), feast()] });
  assert.equal(c.ok, true);
  assert.deepEqual(JSON.parse(c.file).feasts.map(f => f.date), ['2026-12-04', '2026-12-17']);
  assert.equal(checkFeasts({ month: '2026-12', feasts: [feast({ date: '2026-11-30' })] }).ok, false);
  assert.equal(checkFeasts({ month: '2026-12', feasts: [feast({ date: '2026-12-32' })] }).ok, false);
  assert.equal(checkFeasts({ month: '2026-12', feasts: [feast(), feast()] }).ok, false, 'twice the same day');
  assert.equal(checkFeasts({ month: '2026-12', feasts: [feast({ img: 'https://evil.example/x.jpg' })] }).ok, false);
  assert.equal(checkFeasts({ month: '2026-12', feasts: [feast({ url: 'http://example.com/' })] }).ok, false, 'a source must be https');
  assert.equal(checkFeasts({ month: '2026-12', feasts: [feast({ url: 'javascript:alert(1)' })] }).ok, false);
  assert.equal(checkFeasts({ month: '2026-12', feasts: [feast({ url: 'https://copticorthodox.church/en/past-bishops/bishop-theophilos/' })] }).ok, true, 'the registry cites the church site');
  assert.equal(checkFeasts({ month: '2026-12', feasts: [feast({ img: '/assets/img/saints/mercurius.webp' })] }).ok, true, 'our own copy of a saint picture');
  assert.equal(checkFeasts({ month: '2026-12', feasts: [feast({ img: '/assets/img/other/x.webp' })] }).ok, false);
  assert.equal(checkFeasts({ month: '2026-12', feasts: [feast({ img: '//evil.example/assets/img/saints/x.webp' })] }).ok, false);
  const p = checkFeasts({ month: '2026-12', feasts: [feast({ praise: 'https://st-takla.org/p.html', praiseTitle: 'تمجيد', praiseText: 'سطر ١\nسطر ٢' })] });
  assert.equal(p.ok, true);
  assert.equal(JSON.parse(p.file).feasts[0].praiseText, 'سطر ١\nسطر ٢');
  assert.equal(checkFeasts({ month: '2026-12', feasts: [feast({ praiseText: 'نص من غير مصدر' })] }).ok, false, 'a praise text needs its source');
  assert.equal(checkFeasts({ month: '2026-12', feasts: [feast({ praise: 'https://st-takla.org/p.html', praiseText: 'x'.repeat(1501) })] }).ok, false);
  assert.equal(checkFeasts({ month: '2026-13', feasts: [] }).ok, false);
  assert.equal(checkFeasts({ month: '2026-12', feasts: [] }).ok, true, 'an empty month is allowed');
});

test('admin: the feasts are published as daily-bread/data/feasts/YYYY-MM.json and served by date file (module on)', async () => {
  const w = await world();
  const r = await w.admin('POST', 'bread/feasts', { month: '2026-12', feasts: [feast()] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.feasts, 1);
  const rev = await w.h.db.prepare("SELECT key, live FROM published_revisions WHERE kind = 'bread' AND key = 'feasts/2026-12'").first();
  assert.deepEqual({ ...rev }, { key: 'feasts/2026-12', live: 1 });
  assert.ok(w.h.sent.some(j => j.type === 'publish.mirror'));
  assert.equal((await w.h.call('/v1/bread/file/feasts/2026-12')).body.code, 'disabled', 'module off: nothing served');
  await w.h.db.prepare("UPDATE settings SET value = '1' WHERE key = 'BREAD_MODULE'").run();
  const f = await w.h.call('/v1/bread/file/feasts/2026-12');
  assert.equal(f.status, 200);
  assert.equal(f.body.feasts[0].name, 'الشهيد العظيم أبي سيفين');
  assert.equal((await w.h.call('/v1/bread/file/feasts/2026-13')).status, 404);
  // again: the new one is live, the old one is not
  await w.admin('POST', 'bread/feasts', { month: '2026-12', feasts: [] });
  const live = (await w.h.db.prepare("SELECT body FROM published_revisions WHERE kind = 'bread' AND key = 'feasts/2026-12' AND live = 1").all()).results;
  assert.equal(live.length, 1);
  assert.deepEqual(JSON.parse(live[0].body).feasts, []);
  assert.equal((await w.admin('POST', 'bread/feasts', { month: '2026-12', feasts: [feast({ img: 'https://x.example/a.jpg' })] })).status, 400);
});

test('admin: the month\'s suggestions are passed on from the «bread-suggest» branch (missing → ready: false)', async () => {
  const w = await world();
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith(SUGGEST_URL)) {
      seen.push(String(url));
      if (String(url).endsWith('2027-01.json')) return new Response('nope', { status: 404 });
      return new Response(JSON.stringify({ schema: 2, month: '2026-12', made: 'x', days: [{ n: 1, pick: 0, options: [topic({ sourceUrl: PAGE })] }], feasts: [feast()] }), { status: 200 });
    }
    return real(url, init);
  };
  try {
    const r = await w.admin('GET', 'bread/suggest?month=2026-12');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.ready, r.body.days.length, r.body.feasts.length], [true, 1, 1]);
    assert.equal((await w.admin('GET', 'bread/suggest?month=2027-01')).body.ready, false);
    assert.equal((await w.admin('GET', 'bread/suggest?month=bad')).status, 400);
    assert.deepEqual(seen, [SUGGEST_URL + '2026-12.json', SUGGEST_URL + '2027-01.json']);
  } finally {
    globalThis.fetch = real;
  }
});

test('activate { mode: on, startsOn }: a month\'s program starts on its own day, never today, never inside the live one', async () => {
  const { cairoDay, dayAdd } = await import('../src/bread/model.js');
  const w = await world();
  const today = cairoDay();
  const make = async days => {
    const c = await w.admin('POST', 'bread/programs', { name: 'شهر', days });
    const id = c.body.program.id;
    const r = await w.admin('POST', `bread/programs/${id}/topics`, { topics: Array.from({ length: days }, (_, i) => topic({ n: i + 1 })) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return id;
  };
  const a = await make(3);
  for (const bad of [today, dayAdd(today, -1), '2026-02-30', 'x']) assert.equal((await w.admin('POST', `bread/programs/${a}/activate`, { mode: 'on', startsOn: bad })).status, 400, bad);
  const on = await w.admin('POST', `bread/programs/${a}/activate`, { mode: 'on', startsOn: dayAdd(today, 10) });
  assert.equal(on.status, 200, JSON.stringify(on.body));
  assert.deepEqual([on.body.program.startsOn, on.body.program.endsOn], [dayAdd(today, 10), dayAdd(today, 12)]);
  const list = await w.admin('GET', 'bread/programs');
  assert.deepEqual([list.body.current, list.body.next], [null, a], 'not live today: waiting for its day');
  const b = await make(2);
  assert.equal((await w.admin('POST', `bread/programs/${b}/activate`, { mode: 'on', startsOn: dayAdd(today, 20) })).status, 409, 'one waiting at a time');
});

test('delete a past program for good (owner 2026-11-19): only once it is over, with confirm; texts, numbers and the row go', async () => {
  const { cairoDay, dayAdd } = await import('../src/bread/model.js');
  const w = await world();
  const today = cairoDay();
  const c = await w.admin('POST', 'bread/programs', { name: 'قديم', days: 2 });
  const id = c.body.program.id;
  await w.admin('POST', `bread/programs/${id}/topics`, { topics: [topic({ n: 1 }), topic({ n: 2 })] });
  await w.admin('POST', `bread/programs/${id}/activate`, { mode: 'after' });
  assert.equal((await w.admin('POST', `bread/programs/${id}/delete`, { confirm: true })).status, 400, 'live: no');
  // two days later it is over
  await w.h.db.prepare('UPDATE bread_programs SET starts_on = ?, ends_on = ? WHERE id = ?').bind(dayAdd(today, -3), dayAdd(today, -2), id).run();
  await w.h.db.prepare("INSERT INTO bread_daily (program_id, day, opens, reads, sent, reflections) VALUES (?, ?, 5, 3, 0, 1)").bind(id, dayAdd(today, -2)).run();
  assert.equal((await w.admin('POST', `bread/programs/${id}/delete`, {})).body.needsConfirm, true);
  const r = await w.admin('POST', `bread/programs/${id}/delete`, { confirm: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  for (const t of ['bread_programs', 'bread_topics', 'bread_daily']) assert.equal(await w.h.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first('n'), 0, t);
  const live = (await w.h.db.prepare("SELECT body FROM published_revisions WHERE kind = 'bread' AND live = 1 AND key LIKE ?").bind(id + '/%').all()).results;
  assert.ok(live.length && live.every(x => JSON.parse(x.body).gone === true), 'the published days become a stub');
});

test('GET feasts: what is published for the month («اتنشرت» in the admin), or published: false', async () => {
  const w = await world();
  assert.deepEqual((await w.admin('GET', 'bread/feasts?month=2026-12')).body.published, false);
  await w.admin('POST', 'bread/feasts', { month: '2026-12', feasts: [feast()] });
  const g = await w.admin('GET', 'bread/feasts?month=2026-12');
  assert.deepEqual([g.body.published, g.body.feasts.length, g.body.feasts[0].date], [true, 1, '2026-12-04']);
  assert.equal((await w.admin('GET', 'bread/feasts?month=x')).status, 400);
});
