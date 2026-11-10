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
    default: return send(r, 404, { ok: false, code: 'not_found', message: '' });
  }
}).listen(port, '127.0.0.1', () => console.log('book mock on ' + port));
