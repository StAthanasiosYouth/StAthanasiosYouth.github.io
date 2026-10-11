/**
 * COMPETITIONS: SECRETS, TOKENS, ENCRYPTION. docs/COMPETITIONS.md §5.3, §7.2.
 *
 * Secrets (Script Properties, 32 random bytes as base64, created on first
 * use, never returned, logged or put in an error):
 *   COMP_SECRET   signs the stateless tokens
 *   CODE_PEPPER   codeHash = HMAC(normalized code, pepper)   (Phase 2)
 *   CODE_KEY      codeEnc (below)                            (Phase 2)
 *
 * Tokens: "<kind>.<b64url JSON>.<b64url HMAC-SHA256>", kinds
 *   at1  attempt      { s: submission id, c: comp id, v: version, d: deadlineMs, e: expiry ms }
 *   rc1  receipt      { s, c }
 *   pt1  participant  { p: participant id, cv: codeVersion, e: expiry ms }   (Phase 2)
 * Signatures are compared in constant time.
 *
 * Encryption (codeEnc, generic): "v1:" + b64url(nonce16 ‖ ct ‖ tag16)
 *   encKey = HMAC(key, "enc"), macKey = HMAC(key, "mac")
 *   stream = HMAC(encKey, nonce) ‖ HMAC(encKey, nonce ‖ 1) ‖ …   (the first block covers ≤ 32 bytes)
 *   ct = plaintext XOR stream; tag = HMAC(macKey, "v1" ‖ nonce ‖ ct)[0..16]
 * Decrypt checks the tag first (constant time) and gives null on any mismatch.
 */

var COMP_SECRET_NAMES = ['COMP_SECRET', 'CODE_PEPPER', 'CODE_KEY'];
var COMP_TOKEN_KINDS = ['at1', 'rc1', 'pt1'];
var COMP_TOKEN_MAX = 1500;


/* =========================================================
   BYTES
========================================================= */

/* Apps Script bytes are signed (-128..127) */
function compByte_(value) {

  var b = value & 255;

  return b > 127 ? b - 256 : b;

}

function compUtf8_(text) {

  return Utilities.newBlob(String(text)).getBytes();

}

function compFromUtf8_(bytes) {

  return Utilities.newBlob(bytes).getDataAsString('UTF-8');

}

/* n bytes from SHA-256 over fresh UUIDs (Utilities.getUuid is random) */
function compRandomBytes_(n) {

  var out = [];

  while (out.length < n) {
    out = out.concat(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
      Utilities.getUuid() + ':' + Utilities.getUuid() + ':' + Date.now() + ':' + out.length + ':' + Math.random()));
  }

  return out.slice(0, n);

}

/* lower-case hex of n random bytes */
function compRandomHex_(n) {

  return compRandomBytes_(n).map(function (b) {
    var h = (b & 255).toString(16);
    return h.length === 1 ? '0' + h : h;
  }).join('');

}

function compB64url_(bytes) {

  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');

}

/* null when not base64url */
function compB64urlBytes_(text) {

  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text)) return null;

  var padded = text + '===='.slice(0, (4 - text.length % 4) % 4);

  try {
    return Utilities.base64DecodeWebSafe(padded);
  }
  catch (ignored) {
    return null;
  }

}

/* constant time for equal lengths; different lengths are never equal */
function compSafeEqual_(a, b) {

  a = String(a);
  b = String(b);

  var diff = a.length ^ b.length;
  var length = Math.max(a.length, b.length);

  for (var i = 0; i < length; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }

  return diff === 0;

}

function compSafeEqualBytes_(a, b) {

  var diff = a.length ^ b.length;
  var length = Math.max(a.length, b.length);

  for (var i = 0; i < length; i++) {
    diff |= ((a[i] || 0) & 255) ^ ((b[i] || 0) & 255);
  }

  return diff === 0;

}


/* =========================================================
   SECRETS
========================================================= */

/* the secret's base64 text (created once; a concurrent first use re-reads under the lock) */
function compSecret_(name) {

  if (COMP_SECRET_NAMES.indexOf(name) === -1) {
    throw new Error('secret');
  }

  var props = PropertiesService.getScriptProperties();
  var value = props.getProperty(name);

  if (value && value.length >= 40) {
    return value;
  }

  var lock = LockService.getScriptLock();
  var locked = false;

  try {
    locked = lock.tryLock(10000);
  }
  catch (ignored) {
    locked = false;
  }

  try {
    value = props.getProperty(name);
    if (!value || value.length < 40) {
      value = Utilities.base64Encode(compRandomBytes_(32));
      props.setProperty(name, value);
    }
    return value;
  }
  finally {
    if (locked) lock.releaseLock();
  }

}

/* the secret as key bytes */
function compSecretBytes_(name) {

  return Utilities.base64Decode(compSecret_(name));

}


/* =========================================================
   TOKENS
========================================================= */

function compTokenSignature_(kind, body) {

  return compB64url_(Utilities.computeHmacSha256Signature(kind + '.' + body, compSecret_('COMP_SECRET')));

}

/* a signed token for payload (a small object) */
function compSignToken_(kind, payload) {

  if (COMP_TOKEN_KINDS.indexOf(kind) === -1) {
    throw new Error('token kind');
  }

  var body = compB64url_(compUtf8_(JSON.stringify(payload)));

  return kind + '.' + body + '.' + compTokenSignature_(kind, body);

}

/**
 * → { ok: true, payload } | { ok: false, reason: 'bad' | 'expired' }.
 * Expired = payload.e (ms) in the past by nowMs (default Date.now()).
 */
function compReadToken_(kind, token, nowMs) {

  if (typeof token !== 'string' || token.length > COMP_TOKEN_MAX || COMP_TOKEN_KINDS.indexOf(kind) === -1) {
    return { ok: false, reason: 'bad' };
  }

  var match = /^([a-z]{2}\d)\.([A-Za-z0-9_-]{2,1400})\.([A-Za-z0-9_-]{43})$/.exec(token);

  if (!match || match[1] !== kind) {
    return { ok: false, reason: 'bad' };
  }

  if (!compSafeEqual_(compTokenSignature_(kind, match[2]), match[3])) {
    return { ok: false, reason: 'bad' };
  }

  var payload = null;

  try {
    var bytes = compB64urlBytes_(match[2]);
    payload = bytes ? JSON.parse(compFromUtf8_(bytes)) : null;
  }
  catch (ignored) {
    payload = null;
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, reason: 'bad' };
  }

  var now = typeof nowMs === 'number' ? nowMs : Date.now();

  if (payload.e !== undefined && !(typeof payload.e === 'number' && payload.e > now)) {
    return { ok: false, reason: 'expired', payload: payload };
  }

  return { ok: true, payload: payload };

}


/* =========================================================
   ENCRYPTION (codeEnc; generic)
========================================================= */

function compKeys_(keyBytes) {

  return {
    enc: Utilities.computeHmacSha256Signature(compUtf8_('enc'), keyBytes),
    mac: Utilities.computeHmacSha256Signature(compUtf8_('mac'), keyBytes)
  };

}

function compStream_(encKey, nonce, length) {

  var stream = Utilities.computeHmacSha256Signature(nonce, encKey);

  for (var block = 1; stream.length < length; block++) {
    stream = stream.concat(Utilities.computeHmacSha256Signature(nonce.concat([compByte_(block)]), encKey));
  }

  return stream;

}

/* plaintext (text) → "v1:…". keyBytes: compSecretBytes_('CODE_KEY') */
function compEncrypt_(plain, keyBytes) {

  var keys = compKeys_(keyBytes);
  var data = compUtf8_(plain);
  var nonce = compRandomBytes_(16);
  var stream = compStream_(keys.enc, nonce, data.length);
  var ct = data.map(function (b, i) { return compByte_(b ^ stream[i]); });
  var tag = Utilities.computeHmacSha256Signature(compUtf8_('v1').concat(nonce, ct), keys.mac).slice(0, 16);

  return 'v1:' + compB64url_(nonce.concat(ct, tag));

}

/* "v1:…" → the text, or null (wrong key, tampered, malformed) */
function compDecrypt_(text, keyBytes) {

  if (typeof text !== 'string' || text.slice(0, 3) !== 'v1:') return null;

  var bytes = compB64urlBytes_(text.slice(3));

  if (!bytes || bytes.length < 32) return null;

  var keys = compKeys_(keyBytes);
  var nonce = bytes.slice(0, 16);
  var ct = bytes.slice(16, bytes.length - 16);
  var tag = bytes.slice(bytes.length - 16);
  var expected = Utilities.computeHmacSha256Signature(compUtf8_('v1').concat(nonce, ct), keys.mac).slice(0, 16);

  if (!compSafeEqualBytes_(expected, tag)) return null;

  var stream = compStream_(keys.enc, nonce, ct.length);

  try {
    return compFromUtf8_(ct.map(function (b, i) { return compByte_(b ^ stream[i]); }));
  }
  catch (ignored) {
    return null;
  }

}
