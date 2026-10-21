/**
 * ONLINE BOOKING — transport (worker/BOOKING-API.md «Public»)
 *
 *   state(slug)               GET  /v1/book/state?slug=
 *   proof(slug, blob)         POST /v1/book/proof?slug=   (the raw picture) → { proofId, claim }
 *   submit(body)              POST /v1/book/submit
 *   status(token)             POST /v1/book/status
 *   withdraw(token, key)      POST /v1/book/withdraw
 *   pay(slug, servant, method, counts)  POST /v1/book/pay → { number, name, amount, mode, minFirst }
 *
 * Every answer is the envelope: { ok: true, … } or { ok: false, code, message, … }.
 * A network failure, a 5xx or `busy` is tried again (the writes carry
 * their key, so a repeat never writes twice); after that it answers
 * { ok: false, code: 'network' }. No cookies, no referrer (the status
 * token lives in the address fragment only, and no name or phone ever
 * goes into an address).
 */

const DELAYS = [700, 1800];

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createBookApi({ base, fetchImpl = (...args) => fetch(...args), sleep = wait, delays = DELAYS } = {}) {

  const root = String(base || '').replace(/\/+$/, '');

  async function call(path, { method = 'POST', json = null, body = null, type = '', extra = null } = {}) {

    for (let attempt = 0; ; attempt++) {
      const last = attempt >= delays.length;
      let reply = null;
      let status = 0;
      try {
        const headers = {};
        if (extra) Object.assign(headers, extra);
        if (json) headers['Content-Type'] = 'application/json';
        else if (type) headers['Content-Type'] = type;
        const response = await fetchImpl(`${root}${path}`, {
          method,
          headers,
          body: json ? JSON.stringify(json) : body,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          mode: 'cors'
        });
        status = response.status;
        try {
          reply = await response.json();
        }
        catch {
          reply = null;
        }
      }
      catch {
        status = 0;
      }

      const envelope = reply && typeof reply === 'object' && !Array.isArray(reply) ? reply : null;
      const again = !status || status >= 500 || (envelope && envelope.code === 'busy');
      if (again && !last) {
        await sleep(delays[attempt]);
        continue;
      }
      if (envelope && envelope.ok === false) return { ...envelope, code: String(envelope.code || 'error'), httpStatus: status };
      if (again) return { ok: false, code: 'network', httpStatus: status };
      if (!envelope || status < 200 || status >= 300) return { ok: false, code: 'bad', httpStatus: status };
      // (httpStatus: a reply's own 'status' is the booking's)
      return { ...envelope, ok: true, httpStatus: status };
    }

  }

  return {
    base: root,
    state: slug => call(`/v1/book/state?slug=${encodeURIComponent(slug)}`, { method: 'GET' }),
    // token: a confirmed participant paying what is left (§4.10) — a header, never in the address
    proof: (slug, blob, token = '') => call(`/v1/book/proof?slug=${encodeURIComponent(slug)}`, { body: blob, type: blob.type || 'image/jpeg', extra: token ? { 'X-Status-Token': token } : null }),
    submit: body => call('/v1/book/submit', { json: body }),
    status: token => call('/v1/book/status', { json: { token } }),
    withdraw: (token, requestKey) => call('/v1/book/withdraw', { json: { token, requestKey } }),
    // the payment card's approved InstaPay / wallet number (never in event.json)
    pay: (slug, servantId, method, counts, token = '') => call('/v1/book/pay', { json: token ? { slug, servantId, method, token } : { slug, servantId, method, counts } }),
    payRequest: body => call('/v1/book/pay-request', { json: body }),
    payRequestWithdraw: token => call('/v1/book/pay-request/withdraw', { json: { token } })
  };

}
