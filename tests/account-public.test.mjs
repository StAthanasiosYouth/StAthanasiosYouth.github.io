// The youth account page's pure rules (assets/js/account/model.js, docs/PHASE5-PLAN.md P5-2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as M from '../assets/js/account/model.js';

function store() {
  const map = new Map();
  return { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k), map };
}

test('masking shows enough to recognise, not the address', () => {
  assert.equal(M.maskEmail('mina@gmail.com'), 'm•••a@gmail.com');
  assert.equal(M.maskEmail('ab@x.io'), 'a@x.io');
  assert.equal(M.maskEmail('nope'), '');
});

test('typo hints fix the domain only', () => {
  assert.equal(M.emailTypo('Mina@gmial.com'), 'Mina@gmail.com');
  assert.equal(M.emailTypo('mina@gmail.com'), '');
  assert.equal(M.emailTypo('nope'), '');
});

test('the one button: متابعة, then دخول once a password is there', () => {
  assert.equal(M.submitLabel({ password: '' }), 'متابعة');
  assert.equal(M.submitLabel({ password: 'x' }), 'دخول');
  assert.equal(M.submitLabel({ busy: true, password: 'x' }), 'لحظة…');
});

test('dates read in Arabic', () => {
  assert.equal(M.dateText('2003-03-12'), '١٢ مارس ٢٠٠٣');
  assert.equal(M.birthDateOf('2003', '3', '2'), '2003-03-02');
  assert.equal(M.birthDateOf('2003', '', '2'), '');
  assert.equal(M.birthYears(new Date(2026, 0, 1))[0], 2021);
  assert.equal(M.birthYears(new Date(2026, 0, 1)).length, 96);
});

test('hints: newest first, one per email, at most 3, never a password', () => {
  let list = [];
  for (const e of ['a', 'b', 'c', 'd']) list = M.addHint(list, { firstName: e, email: e + '@x.io', password: 'SECRET' }, 1);
  assert.deepEqual(list.map(h => h.email), ['d@x.io', 'c@x.io', 'b@x.io']);
  list = M.addHint(list, { firstName: 'b', email: 'B@x.io' }, 2);
  assert.deepEqual(list.map(h => h.email), ['B@x.io', 'd@x.io', 'c@x.io']);
  const s = store();
  M.writeHints(s, list);
  assert.ok(!s.map.get(M.HINTS_KEY).includes('SECRET'));
  assert.equal(M.readHints(s).length, 3);
  assert.deepEqual(M.removeHint(list, 'b@x.io').map(h => h.email), ['d@x.io', 'c@x.io']);
  s.setItem(M.HINTS_KEY, '{broken');
  assert.deepEqual(M.readHints(s), []);
});

test('a shared device keeps the session in this tab only', () => {
  const local = store();
  const tab = store();
  M.writeSession(local, tab, { token: 'as1.a', email: 'a@x.io' }, 'shared');
  assert.equal(local.map.size, 0);
  assert.equal(M.readSession(local, tab).token, 'as1.a');
  M.writeSession(local, tab, { token: 'as1.b', email: 'a@x.io' }, 'device');
  assert.equal(tab.map.size, 0);
  assert.equal(M.readSession(local, tab).token, 'as1.b');
  M.clearSession(local, tab);
  assert.equal(M.readSession(local, tab), null);
  local.setItem(M.SESSION_KEY, JSON.stringify({ token: 'other' }));
  assert.equal(M.readSession(local, tab), null, 'not one of ours');
});

test('a link\'s destination: own routes only, this tab, 30 minutes, once', () => {
  assert.equal(M.cleanRoute('#me/security'), '#me/security');
  assert.equal(M.cleanRoute('#me/notifications'), '#me/notifications');
  assert.equal(M.cleanRoute('#me/bookings/B-7QK2M'), '#me/bookings/B-7QK2M');
  assert.equal(M.cleanRoute('#me/bookings/B-7QK2M/payments'), '#me/bookings/B-7QK2M/payments');
  assert.equal(M.cleanRoute('#me/points'), '#me/points');
  assert.equal(M.cleanRoute('#me/results/bible-quiz'), '#me/results/bible-quiz');
  assert.equal(M.cleanRoute('#me/orders/r-0123456789'), '#me/orders/r-0123456789');
  assert.equal(M.cleanRoute('#me/later/x'), '#me', 'a later section: the first page for now');
  assert.equal(M.cleanReturn('/competition/bible-quiz/'), '/competition/bible-quiz/');
  assert.equal(M.cleanReturn('/points/'), '/points/');
  assert.equal(M.cleanReturn('/events/alex-trip/'), '/events/alex-trip/');
  assert.equal(M.cleanReturn('/'), '/');
  assert.equal(M.cleanReturn('/black-theatre/'), '/black-theatre/');
  assert.equal(M.cleanReturn('/pages/about/'), '/pages/about/');
  assert.equal(M.cleanReturn('/events/alex-trip/#b/bk1.abc-_.def'), '/events/alex-trip/#b/bk1.abc-_.def');
  for (const bad of ['//evil.example/', 'https://evil.example', '/admin/', 'javascript:alert(1)', '/account/', '/\\evil.example', '/#"><script>']) assert.equal(M.cleanReturn(bad), '', bad);
  for (const bad of ['#//evil.example', 'javascript:alert(1)', 'https://evil.example', '#me/<x>', '#mee', '']) assert.equal(M.cleanRoute(bad), '', bad);
  const tab = store();
  M.keepDest(tab, 'https://evil.example', 1000);
  assert.equal(M.takeDest(tab, 1000), '');
  M.keepDest(tab, '#me/security', 1000);
  assert.equal(M.takeDest(tab, 2000), '#me/security');
  assert.equal(M.takeDest(tab, 2000), '', 'once');
  M.keepDest(tab, '#me/security', 1000);
  assert.equal(M.takeDest(tab, 1000 + 31 * 60000), '', 'too old');
});

test('the form follows the password-manager rules (§13.1)', () => {
  const src = readFileSync(new URL('../assets/js/account/app.js', import.meta.url), 'utf8');
  assert.ok(src.includes("autocomplete: 'username'"));
  assert.ok(src.includes("autocomplete: 'current-password'"));
  assert.ok(src.includes("autocomplete: 'one-time-code'"));
  assert.ok(!src.includes('new-password'));
  assert.ok(!/autocomplete: 'off'.*password/.test(src));
  assert.ok(!/localStorage\.setItem|sessionStorage\.setItem/.test(src), 'storage only through the model');
});

test('the page shell: noindex, Turnstile and the Worker in its CSP', () => {
  const html = readFileSync(new URL('../account/index.html', import.meta.url), 'utf8');
  assert.match(html, /name="robots" content="noindex"/);
  assert.match(html, /script-src 'self' https:\/\/challenges\.cloudflare\.com/);
  assert.match(html, /athanasios-api\.menazak-lab\.workers\.dev/);
  assert.match(html, /assets\/js\/account\/page\.js/);
});

test('«account» can not become a service page', () => {
  for (const f of ['../sw.js', '../assets/js/not-found.js', '../assets/js/page/model.js', '../apps-script/Pages.gs']) {
    assert.match(readFileSync(new URL(f, import.meta.url), 'utf8'), /'card-athanasios', 'account'/, f);
  }
});
