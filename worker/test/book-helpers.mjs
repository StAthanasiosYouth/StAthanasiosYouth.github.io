// Booking test helpers: an event.json fixture, a harness with the module on,
// an admin token, and small call wrappers.
import { harness, fakeGoogle, jpegBytes } from './helpers.mjs';
import { rowFromJson, saveRow } from '../src/book/event.js';
import { forgetModule } from '../src/book/public.js';
import { forgetPayDest } from '../src/book/pay.js';
import { msStamp } from '../src/book/model.js';

const DAY = 24 * 3600 * 1000;

export function eventJson(over = {}, bookingOver = {}) {
  const now = Date.now();
  return {
    schema: 1, v: 'rev1', id: 'evt-alex01', slug: 'alex-trip', kind: 'trip', title: 'رحلة الإسكندرية',
    startAt: msStamp(now + 10 * DAY), endAt: msStamp(now + 11 * DAY),
    booking: {
      online: true, opensAt: msStamp(now - DAY), closesAt: msStamp(now + 9 * DAY),
      capacity: 10, showLeft: true, showLeftBelow: 5, perBookingMax: 6, collectNames: false,
      pricing: { mode: 'group', categories: [
        { key: 'applicant', label: 'الحاجز', group: 'adult', price: 1500, seat: true, min: 1, max: 1, note: '' },
        { key: 'adult', label: 'فرد إضافي', group: 'adult', price: 1500, seat: true, min: 0, max: 5, note: '' },
        { key: 'child', label: 'طفل', group: 'child', price: 800, seat: true, min: 0, max: 5, note: '' },
        { key: 'infant', label: 'رضيع', group: 'child', price: 0, seat: false, min: 0, max: 3, note: '' }
      ] },
      payment: { mode: 'full', minFirst: 0, finalDueAt: '' },
      // cash: servant-assisted (no `online`: inferred offline, as in an event.json published before the flag);
      // `transfer`: an online method without a proof, so most tests can submit without uploading one
      methods: [{ key: 'cash', label: 'كاش', needsProof: false }, { key: 'instapay', label: 'إنستاباي', needsProof: true }, { key: 'transfer', label: 'تحويل', needsProof: false, online: true }],
      servants: [{ id: 'srv-aaaa1111', name: 'مينا عادل', methods: ['cash', 'instapay', 'transfer'] }, { id: 'srv-bbbb2222', name: 'مرقس فادي', methods: ['cash'] }],
      ...bookingOver
    },
    ...over
  };
}

export async function bookWorld({ event = eventJson(), moduleOn = true, env = {} } = {}) {
  forgetModule();
  forgetPayDest();
  const h = harness({ env: { BOOK_SECRET: 'b'.repeat(40), ENVIRONMENT: 'test', ...env } });
  if (moduleOn) await h.db.prepare("UPDATE settings SET value = '1' WHERE key = 'BOOKING_MODULE'").run();
  if (event) await saveRow(h.env, rowFromJson(event, 'fixture'));
  const g = await fakeGoogle();
  let n = 0;
  const auth = async (claims = {}) => ({ authorization: 'Bearer ' + await g.sign(g.claims(claims)) });
  const admin = async (method, path, body, headers = {}) => h.call(path, { method, body, headers: { ...(await auth()), ...headers }, fetch: g.fetch });
  const pub = (method, path, body, ip = '198.51.100.7') => h.call(path, { method, body, headers: { 'cf-connecting-ip': ip } });
  const key = p => (p || 'k') + '-' + String(++n).padStart(6, '0') + '-' + Math.random().toString(36).slice(2, 8);
  const submit = (over = {}, ip) => pub('POST', '/v1/book/submit', {
    slug: 'alex-trip', requestKey: key('rq'), name: 'مينا زكريا', phone: '01012345678', counts: { applicant: 1, adult: 1 },
    servantId: 'srv-aaaa1111', method: 'transfer', hp: '', revision: 'rev1', ...over
  }, ip);
  return { ...h, g, auth, admin, pub, key, submit, jpeg: jpegBytes };
}

export function pay(over = {}) {
  return { kind: 'payment', amount: 1000, servantId: 'srv-aaaa1111', method: 'cash', receivedAt: msStamp(Date.now() - 60000), idemKey: 'pay-' + Math.random().toString(36).slice(2, 12), ...over };
}

export async function setModule(h, on) {
  await h.db.prepare("UPDATE settings SET value = ? WHERE key = 'BOOKING_MODULE'").bind(on ? '1' : '0').run();
  forgetModule();
}
