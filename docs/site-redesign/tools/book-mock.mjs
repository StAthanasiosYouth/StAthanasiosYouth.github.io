// S6: a stand-in for the booking API (worker/BOOKING-API.md, public part only) so the LIVE booking engine runs every step
// on the review server, with the sample event docs/site-redesign/s6/event.json. Nothing is stored; nothing leaves this machine.
//   node docs/site-redesign/tools/book-mock.mjs [port=4331]
// The page uses it with ?api=http://127.0.0.1:4331 (book-config.js accepts an http override on localhost only).
import { createServer } from 'node:http';
const port = Number(process.argv[2] || 4331);
const SLUG = 's6-sample';
const send = (r, code, body) => { r.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'cache-control': 'no-store' }); r.end(JSON.stringify(body)); };
const read = q => new Promise(res => { const c = []; q.on('data', d => c.push(d)); q.on('end', () => res(Buffer.concat(c))); });
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
const rid = n => Array.from({ length: n }, () => B32[Math.floor(Math.random() * 32)]).join('');
const PRICE = { adult: 150, child: 75 };
let last = null;
const ACCOUNT = { id: 'acc-sample01', firstName: 'مينا', name: 'مينا زكريا (مثال)', email: 'example@example.com', phone: '01000000000', birthDate: '2005-03-14', avatar: null, eligibility: { state: 'eligible' }, onboarded: true };
const BOOKINGS = [
  { ref: 'B-7K2QX', event: 'يوم ترفيهي على البحر', slug: 's6-sample', startAt: '2026-11-14T09:00', status: 'confirmed', total: 225, paid: 75, left: 150, dueAt: '2026-11-13T22:00', statusToken: 'bk1.eyJiIjoiQi03SzJRWCJ9.' + 'a'.repeat(24) },
  { ref: 'B-3MP8D', event: 'رحلة دير الأنبا أنطونيوس', slug: 's6-sample', startAt: '2026-10-09T06:00', status: 'confirmed', total: 300, paid: 300, left: 0, dueAt: '', statusToken: '' }];
const HISTORY = [
  { submissionId: 'sub-1', compId: 'c1', title: 'مسابقة سفر أعمال الرسل', slug: 'safar-alamal', submittedAt: '2026-11-10T20:14', status: 'graded', score: 35, maxScore: 40, pointsAwarded: 35, canReview: true },
  { submissionId: 'sub-2', compId: 'c2', title: 'مسابقة قصة القديس أبي سيفين', slug: 'abu-sefein', submittedAt: '2026-11-01T19:00', status: 'graded', score: 28, maxScore: 30, pointsAwarded: 28, canReview: false }];
const REDEMPTIONS = [{ id: 'rdm-1', itemName: 'ميدالية الأسرة', cost: 60, status: 'ready', requestedAt: '2026-11-04T18:00', canCancel: false }];
createServer(async (q, r) => {
  if (q.method === 'OPTIONS') return send(r, 204, {});
  const u = new URL(q.url, 'http://x');
  const body = await read(q);
  let json = {}; try { json = JSON.parse(body.toString() || '{}'); } catch {}
  const state = u.searchParams.get('state') || 'open';
  switch (u.pathname) {
    case '/v1/book/state':
      if (u.searchParams.get('slug') !== SLUG) return send(r, 404, { ok: false, code: 'not_found', message: 'مفيش فعالية بالاسم ده.' });
      return send(r, 200, { ok: true, open: true, opensAt: '', closesAt: '2026-11-13T22:00', left: 12, revision: 's6sample01', turnstile: null });
    case '/v1/book/proof':
      return send(r, 200, { ok: true, proofId: 'prf-' + rid(8), claim: 'c-' + rid(16) });
    case '/v1/book/pay': {
      const counts = json.counts || {};
      const amount = Object.keys(counts).reduce((s, k) => s + (PRICE[k] || 0) * (counts[k] || 0), 0) || null;
      return send(r, 200, { ok: true, method: json.method, number: '01000000000', name: json.servantId === 'srv-s6bbbbbb' ? 'اسم الخادمة (مثال)' : 'اسم الخادم (مثال)', amount, mode: 'installments', minFirst: 75, finalDueAt: '2026-11-13T22:00' });
    }
    case '/v1/book/submit': {
      const counts = json.counts || {};
      const total = Object.keys(counts).reduce((s, k) => s + (PRICE[k] || 0) * (counts[k] || 0), 0);
      last = { ref: 'B-7K2QX', name: json.name || '', counts, total };
      return send(r, 200, { ok: true, ref: 'B-7K2QX', status: 'pending', token: 'bk1.' + 'eyJiIjoiQi03SzJRWCJ9' + '.' + rid(24), quotedTotal: total });
    }
    case '/v1/book/status': {
      const c = (last && last.counts) || { adult: 1, child: 1 };
      const adult = c.adult || 0, child = c.child || 0;
      const st = u.searchParams.get('status') || 'pending';
      return send(r, 200, { ok: true, ref: 'B-7K2QX', event: { slug: SLUG, title: 'يوم ترفيهي على البحر', startAt: '2026-11-14T09:00' }, status: st, firstName: ((last && last.name) || 'مينا').split(' ')[0], people: { adult, child, companion: 0, total: adult + child }, quotedTotal: (last && last.total) || 225, amountDue: (last && last.total) || 225, paid: st === 'confirmed' ? 75 : 0, balance: st === 'confirmed' ? 150 : 225, paymentStatus: st === 'confirmed' ? 'partial' : null, overdue: false, finalDueAt: '2026-11-13T22:00', createdAt: '2026-11-10T20:30' });
    }
    case '/v1/book/withdraw': return send(r, 200, { ok: true, status: 'withdrawn' });

    /* ---------- S7: a signed-in member (account/, points/), sample data only ---------- */
    case '/v1/account/config': return send(r, 200, { ok: true, mode: 'on', turnstile: null, support: null });
    case '/v1/account/signin': return send(r, 200, { ok: true, token: 'as1.' + rid(30), account: ACCOUNT });
    case '/v1/account/me': return send(r, 200, { ok: true, account: ACCOUNT });
    case '/v1/account/summary': return send(r, 200, { ok: true, account: ACCOUNT,
      points: { balance: 120, frozen: false, season: 'موسم الخريف ٢٠٢٦' },
      bookings: { total: 2, coming: [BOOKINGS[0]], rejected: [] },
      results: { count: 2, latest: HISTORY.slice(0, 1).map(x => ({ ...x })), fresh: HISTORY.slice(0, 1) },
      orders: { count: 1, ready: REDEMPTIONS.filter(x => x.status === 'ready'), latest: REDEMPTIONS } });
    case '/v1/account/bookings': return send(r, 200, { ok: true, bookings: BOOKINGS });
    case '/v1/account/points': return send(r, 200, { ok: true, balance: 120, frozen: false, season: { name: 'موسم الخريف ٢٠٢٦' }, store: { state: 'open' },
      ledger: [
        { kind: 'comp', title: 'مسابقة سفر أعمال الرسل', note: '', amount: 35, at: Date.parse('2026-11-10T18:14:00Z') },
        { kind: 'redeem', title: 'ميدالية أسرة البابا أثناسيوس', note: '', amount: -60, at: Date.parse('2026-11-04T16:00:00Z') },
        { kind: 'comp', title: 'مسابقة قصة القديس أبي سيفين', note: '', amount: 28, at: Date.parse('2026-11-01T17:00:00Z') },
        { kind: 'manual', title: 'حضور اجتماع الشباب ٤ أسابيع', note: '', amount: 117, at: Date.parse('2026-10-26T18:00:00Z') }],
      seasons: [{ name: 'موسم الصيف ٢٠٢٦', final: 240 }] });
    case '/v1/account/prefs': return send(r, 200, { ok: true, prefs: { results: true, bookings: true, news: false } });
    case '/v1/comp/me': return send(r, 200, { ok: true, participant: { name: 'مينا زكريا', group: '' }, features: { wallet: true, shop: true },
      store: { state: 'open', allowCancel: true }, season: { id: 'ssn-fall26', name: 'موسم الخريف ٢٠٢٦', startAt: '2026-10-01T00:00', endAt: '2026-12-31T23:59', earned: 180, maxTheoretical: 400 },
      seasons: [{ id: 'ssn-sum26', name: 'موسم الصيف ٢٠٢٦', startAt: '2026-06-01T00:00', endAt: '2026-09-30T23:59', final: 240, earned: 300, spent: 60 }],
      balance: 120,
      ledger: [{ amount: 35, kind: 'comp', compTitle: 'مسابقة سفر أعمال الرسل', createdAt: '2026-11-10T20:14' }, { amount: -60, kind: 'redeem', note: 'ميدالية أسرة البابا أثناسيوس', createdAt: '2026-11-04T18:00' }, { amount: 28, kind: 'comp', compTitle: 'مسابقة قصة القديس أبي سيفين', createdAt: '2026-11-01T19:00' }],
      history: HISTORY, redemptions: REDEMPTIONS,
      shop: [
        { id: 'itm-medal', name: 'ميدالية الأسرة', description: 'ميدالية معدن عليها لوجو الأسرة.', cost: 60, category: 'هدايا', available: 12 },
        { id: 'itm-bible', name: 'كتاب مقدس جيب', description: 'طبعة صغيرة بغلاف جلد.', cost: 150, category: 'كتب', available: 5 },
        { id: 'itm-tshirt', name: 'تيشيرت B.U.G', description: 'تيشيرت الفريق، كل المقاسات.', cost: 200, category: 'لبس', available: null },
        { id: 'itm-trip', name: 'خصم ٥٠ جنيه على رحلة', description: 'على أي رحلة الموسم ده.', cost: 100, category: 'خصومات', available: null, perPersonLeft: 1 }] });
    case '/v1/shop/redeem': return send(r, 200, { ok: true, redemption: { id: 'rdm-' + rid(8), itemName: 'ميدالية الأسرة', cost: 60, status: 'pending', requestedAt: '2026-11-10T21:00', canCancel: true }, balance: 60 });
    default: return send(r, 404, { ok: false, code: 'not_found', message: '' });
  }
}).listen(port, '127.0.0.1', () => console.log('book mock on ' + port));
