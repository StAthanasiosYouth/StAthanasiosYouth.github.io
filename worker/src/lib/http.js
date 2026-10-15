/*
 * HTTP policy for every response: one JSON envelope, CORS for the site's
 * origins only, security headers, body limits.
 *
 *   success  { ok: true, ...data }
 *   failure  { ok: false, code, message, hint?, requestId }
 *
 * `message` / `hint` are Arabic, in the same voice as the Apps Script API
 * (Api.gs apiError_), so the admin can show them unchanged.
 */

export const MAX_JSON_BYTES = 64 * 1024;

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'x-frame-options': 'DENY',
  'permissions-policy': 'interest-cohort=()'
};

const MESSAGES = {
  auth: ['لازم تدخل بحساب جوجل تاني.', 'الدخول انتهى أو مش صحيح. ادخل تاني وكمّل من مكانك.'],
  denied: ['مش مسموح لك تستخدم لوحة التحكم.', 'الحساب ده مش في قايمة الصلاحيات.'],
  bad: ['الطلب مش مفهوم. حدّث الصفحة وجرّب تاني.', ''],
  toolarge: ['الطلب أكبر من المسموح.', ''],
  rate: ['طلبات كتير ورا بعض. استنى شوية وجرّب تاني.', ''],
  conflict: ['الطلب ده اتبعت قبل كده بمحتوى مختلف.', 'حدّث الصفحة وجرّب تاني.'],
  busy: ['في طلب زي ده شغال دلوقتي. جرّب كمان ثانية.', ''],
  disabled: ['الجزء ده مش متاح دلوقتي.', ''],
  notfound: ['الطلب ده مش معروف.', ''],
  method: ['الطلب ده مش معروف.', ''],
  origin: ['الطلب ده مش مسموح من المكان ده.', ''],
  error: ['حصلت مشكلة عندنا. جرّب تاني بعد شوية.', '']
};

const STATUS = { auth: 401, denied: 403, origin: 403, bad: 400, toolarge: 413, rate: 429, conflict: 409, busy: 409, disabled: 403, notfound: 404, method: 405, error: 500 };

export class ApiError extends Error {
  constructor(code, detail, extra) {
    super(detail || code);
    this.code = code;
    this.status = STATUS[code] || 400;
    this.extra = extra || null;
  }
}

export function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
}

export function corsHeaders(request, env) {
  const origin = request.headers.get('origin');
  if (!origin || !allowedOrigins(env).includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'false',
    'access-control-expose-headers': 'x-request-id, idempotency-replayed, etag',
    vary: 'Origin'
  };
}

export function preflight(request, env) {
  const cors = corsHeaders(request, env);
  if (!cors['access-control-allow-origin']) return new Response(null, { status: 403, headers: SECURITY_HEADERS });
  return new Response(null, {
    status: 204,
    headers: {
      ...SECURITY_HEADERS,
      ...cors,
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type, idempotency-key, x-request-id',
      'access-control-max-age': '7200'
    }
  });
}

export function json(ctx, data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': init.cache || 'no-store',
      'x-request-id': ctx.rid,
      ...SECURITY_HEADERS,
      ...corsHeaders(ctx.request, ctx.env),
      ...(init.headers || {})
    }
  });
}

export function errorResponse(ctx, err) {
  const code = err instanceof ApiError ? err.code : 'error';
  const status = err instanceof ApiError ? err.status : 500;
  const [message, hint] = MESSAGES[code] || MESSAGES.error;
  const body = { ok: false, code, message, requestId: ctx.rid };
  if (hint) body.hint = hint;
  if (err instanceof ApiError && err.extra) Object.assign(body, err.extra);
  const headers = {};
  if (code === 'rate' && err.extra && err.extra.retryAfter) headers['retry-after'] = String(err.extra.retryAfter);
  return json(ctx, body, { status, headers });
}

/* JSON body with a hard size cap (Content-Length can be absent or wrong). */
export async function readJson(request, limit = MAX_JSON_BYTES) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > limit) throw new ApiError('toolarge');
  const buf = await request.arrayBuffer();
  if (buf.byteLength > limit) throw new ApiError('toolarge');
  if (!buf.byteLength) return {};
  const type = (request.headers.get('content-type') || '').toLowerCase();
  if (type && !type.startsWith('application/json') && !type.startsWith('text/plain')) throw new ApiError('bad', 'content-type');
  try {
    const value = JSON.parse(new TextDecoder().decode(buf));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('shape');
    return value;
  } catch {
    throw new ApiError('bad', 'json');
  }
}
