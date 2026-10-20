// Phase 1.5 step 8: the combined report (/v1/admin/book/report) and the
// per-event export — server-side filters, money only with finance.view,
// phones only with exports.export_pii, audited downloads (a PII one is
// critical), rate limits. Real SQLite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookWorld, eventJson, pay } from './book-helpers.mjs';
import { rowFromJson, saveRow } from '../src/book/event.js';
import { maskPhone } from '../src/book/admin.js';

const A = 'admin@example.com';
const phone = () => '010' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');

async function world() {
  const w = await bookWorld();
  // a second event, so the report has more than one
  await saveRow(w.env, rowFromJson(eventJson({ id: 'evt-cairo01', slug: 'cairo-day', title: 'يوم القاهرة' }), 'fixture'));
  for (const slug of ['alex-trip', 'cairo-day']) {
    const r = await w.submit({ slug, phone: phone(), servantId: 'srv-aaaa1111', method: 'transfer' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  // a cash booking an admin registered and confirmed at once (servant B, 3000 received)
  const c = await w.admin('POST', '/v1/admin/book/bookings', {
    eventId: 'evt-alex01', requestKey: w.key('adm'), name: 'حجز كاش', phone: phone(), counts: { applicant: 1, adult: 1 }, servantId: 'srv-bbbb2222', method: 'cash',
    confirm: { payments: [pay({ amount: 3000, servantId: 'srv-bbbb2222' })] }
  });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  await w.db.prepare("INSERT INTO admins (email, name, role, active, created_at) VALUES (?, 'أدمن', 'admin', 1, 0) ON CONFLICT(email) DO NOTHING").bind(A).run();
  return w;
}
const enforce = w => w.db.prepare("UPDATE settings SET value = '1' WHERE key = 'PERMS_ENFORCE'").run();
const grant = (w, perm) => w.db.prepare("INSERT OR REPLACE INTO admin_grants (email, perm, scope, granted_by, granted_at) VALUES (?, ?, 'all', 't', 0)").bind(A, perm).run();
const audits = w => w.db.prepare("SELECT action, severity, changes FROM activity WHERE action LIKE 'export.%' ORDER BY at").all().then(r => r.results);

test('maskPhone: enough to tell people apart, not to call', () => {
  assert.equal(maskPhone('+201012345678'), '010•••••678');
  assert.equal(maskPhone('01012345678'), '010•••••678');
  assert.equal(maskPhone(''), '');
});

test('report: every event (or the chosen ones), server-side filters (status, servant, method, period)', async () => {
  const w = await world();
  const all = await w.admin('GET', '/v1/admin/book/report?events=all');
  assert.equal(all.status, 200, JSON.stringify(all.body));
  assert.deepEqual(all.body.events.map(e => e.event.id).sort(), ['evt-alex01', 'evt-cairo01']);
  assert.equal(all.body.events.reduce((n, e) => n + e.bookings.length, 0), 3);

  const one = await w.admin('GET', '/v1/admin/book/report?events=evt-cairo01');
  assert.deepEqual(one.body.events.map(e => e.event.id), ['evt-cairo01']);
  const confirmed = await w.admin('GET', '/v1/admin/book/report?events=all&status=confirmed');
  assert.deepEqual(confirmed.body.events.flatMap(e => e.bookings.map(b => b.status)), ['confirmed']);
  const bySrv = await w.admin('GET', '/v1/admin/book/report?events=all&servantId=srv-bbbb2222');
  assert.ok(bySrv.body.events.flatMap(e => e.bookings).every(b => b.servantId === 'srv-bbbb2222'));
  assert.ok(bySrv.body.events.flatMap(e => e.payments).every(p => p.servantId === 'srv-bbbb2222'));
  const byMethod = await w.admin('GET', '/v1/admin/book/report?events=all&method=transfer');
  assert.equal(byMethod.body.events.flatMap(e => e.bookings).length, 2);
  const future = await w.admin('GET', '/v1/admin/book/report?events=all&from=2099-01-01');
  assert.equal(future.body.events.flatMap(e => e.payments).length, 0, 'payments outside the period are left out');

  for (const bad of ['events=evt-x;drop', 'status=lost', 'servantId=x', 'method=a%20b']) {
    assert.equal((await w.admin('GET', '/v1/admin/book/report?' + bad)).status, 400, bad);
  }
});

test('grants: no finance.view → no money anywhere; no exports.export_pii → masked phones; with them → full', async () => {
  const w = await world();
  await enforce(w);
  assert.equal((await w.admin('GET', '/v1/admin/book/report?events=all')).body.perm, 'exports.export', 'exports.export is needed');
  await grant(w, 'exports.export');
  const plain = await w.admin('GET', '/v1/admin/book/report?events=all');
  assert.equal(plain.status, 200, JSON.stringify(plain.body));
  assert.deepEqual(plain.body.access, { money: false, pii: false });
  const bookings = plain.body.events.flatMap(e => e.bookings);
  assert.ok(bookings.every(b => /^010•+\d{3}$/.test(b.phone)), 'masked');
  assert.ok(bookings.every(b => !('amountDue' in b) && !('paid' in b) && !('balance' in b) && !('quotedTotal' in b)));
  assert.ok(plain.body.events.every(e => e.payments.length === 0 && e.handovers.length === 0 && !e.summary.overall.money));
  assert.doesNotMatch(JSON.stringify(plain.body), /3000|1500/, 'no amount anywhere');

  await grant(w, 'finance.view');
  const money = await w.admin('GET', '/v1/admin/book/report?events=all');
  assert.deepEqual(money.body.access, { money: true, pii: false });
  assert.ok(money.body.events.flatMap(e => e.payments).some(p => p.amount === 3000));
  await grant(w, 'exports.export_pii');
  const full = await w.admin('GET', '/v1/admin/book/report?events=all');
  assert.ok(full.body.events.flatMap(e => e.bookings).every(b => /^\+?\d{11,13}$/.test(b.phone)), 'full phones');

  // the per-event export follows the same rules
  await w.db.prepare("DELETE FROM admin_grants WHERE perm IN ('finance.view', 'exports.export_pii')").run();
  const ev = await w.admin('GET', '/v1/admin/book/export?eventId=evt-alex01');
  assert.ok(ev.body.bookings.every(b => b.phone.includes('•')) && ev.body.payments.length === 0);
});

test('audit: every download (report always, export with download=1); critical when phones went out; the screens are not logged', async () => {
  const w = await world();
  await w.admin('GET', '/v1/admin/book/export?eventId=evt-alex01');
  assert.equal((await audits(w)).length, 0, 'a screen read is not a download');
  await w.admin('GET', '/v1/admin/book/export?eventId=evt-alex01&download=1');
  await w.admin('GET', '/v1/admin/book/report?events=all&status=confirmed');
  let rows = await audits(w);
  assert.deepEqual(rows.map(r => [r.action, r.severity]), [['export.pii', 'critical'], ['export.pii', 'critical']], 'switch off: phones included → critical');
  const ch = JSON.parse(rows[1].changes);
  assert.deepEqual([ch.filters.status, ch.bookings, ch.phones, ch.money], ['confirmed', 1, true, true]);
  assert.doesNotMatch(rows.map(r => r.changes).join(''), /010\d|مينا زكريا/, 'the audit never holds the data itself');

  await enforce(w);
  await grant(w, 'exports.export');
  await w.admin('GET', '/v1/admin/book/report?events=all');
  rows = await audits(w);
  assert.deepEqual([rows.at(-1).action, rows.at(-1).severity], ['export.bookings', 'routine'], 'masked: routine');
});

test('downloads are rate-limited per admin (20 per 10 minutes)', async () => {
  const w = await world();
  for (let i = 0; i < 20; i++) assert.equal((await w.admin('GET', '/v1/admin/book/report?events=evt-cairo01')).status, 200);
  const r = await w.admin('GET', '/v1/admin/book/report?events=evt-cairo01');
  assert.equal(r.status, 429);
  assert.equal((await w.admin('GET', '/v1/admin/book/export?eventId=evt-alex01')).status, 200, 'the screens are not limited');
});
