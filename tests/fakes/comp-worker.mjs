// The Worker as these pages see it, answered in the browser by a test's mock API: the same calls by the
// names the mock already knows. The session is seeded the way /account/ leaves it (assets/js/account/link.js).

export const SESSION = { token: 'as1.test.session', email: 'test@example.com' };
const NAMES = { '/v1/comp/start': 'compStart', '/v1/comp/submit': 'compSubmit', '/v1/comp/me': 'portalMe', '/v1/shop/redeem': 'shopRedeem', '/v1/shop/cancel': 'shopCancel' };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };

export const seedSession = page => page.evaluateOnNewDocument(value => {
  try {
    if (location.protocol === 'http:' && !sessionStorage.getItem('test:seeded')) {
      sessionStorage.setItem('test:seeded', '1');
      localStorage.setItem('athanasios.account.v1', value);
    }
  }
  catch { /* a frame without storage */ }
}, JSON.stringify(SESSION));

/* true when the request was the Worker's */
export function workerRoute(request, mock, account = { firstName: 'مارك', eligible: true }) {
  const url = request.url();
  const path = /^https?:\/\/(?!localhost|127\.0\.0\.1)[^/]+(\/v1\/[^?]*)/.exec(url);
  if (!path) return false;
  const json = body => request.respond({ status: 200, contentType: 'application/json; charset=utf-8', headers: CORS, body: JSON.stringify(body) });
  if (mock.offline) { request.abort('internetdisconnected'); return true; }
  if (request.method() === 'OPTIONS') { request.respond({ status: 204, headers: CORS, body: '' }); return true; }
  if (path[1] === '/v1/account/me') { json({ ok: true, account: mock.account || account }); return true; }
  if (path[1] === '/v1/account/config') { json({ ok: true, mode: 'on' }); return true; }
  const arg = JSON.parse(request.postData() || '{}');
  const fn = path[1] === '/v1/comp/result' ? (arg.submissionId ? 'portalReview' : 'compResult') : NAMES[path[1]];
  if (!fn) { json({ ok: false, code: 'bad', message: '' }); return true; }
  // the mocks speak the old contract: the account stands where the participant token stood
  const token = fn === 'compSubmit' || fn === 'compResult' ? {} : { ptoken: 'pt1.good.sig' };
  json(mock.post(JSON.stringify({ fn, args: [{ ...arg, ...token }] })));
  return true;
}
