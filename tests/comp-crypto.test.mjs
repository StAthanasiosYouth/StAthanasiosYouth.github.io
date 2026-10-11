// Competitions secrets, tokens and encryption (apps-script/CompCrypto.gs)
// on the fake Apps Script Utilities: sign / verify / tamper / expiry,
// constant-time compare, encrypt / decrypt / tamper / wrong key.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createWorld } from './fakes/gas.mjs';

const fresh = () => createWorld();

test('secrets: created once (32 random bytes, base64), stable, never the same twice across worlds', () => {
  const a = fresh();
  const secret = a.gs.compSecret_('COMP_SECRET');
  assert.equal(Buffer.from(secret, 'base64').length, 32);
  assert.equal(a.gs.compSecret_('COMP_SECRET'), secret, 'stable');
  assert.equal(a.properties.get('COMP_SECRET'), secret);
  assert.notEqual(fresh().gs.compSecret_('COMP_SECRET'), secret);
  assert.notEqual(a.gs.compSecret_('CODE_KEY'), secret, 'each secret its own');
  assert.throws(() => a.gs.compSecret_('GITHUB_TOKEN'), /secret/, 'only the competition secrets');
});

test('random: right length, hex, not repeating', () => {
  const w = fresh();
  assert.equal(w.gs.compRandomBytes_(48).length, 48);
  const seen = new Set(Array.from({ length: 200 }, () => w.gs.compRandomHex_(6)));
  assert.equal(seen.size, 200);
  assert.ok([...seen].every(h => /^[0-9a-f]{12}$/.test(h)));
});

test('tokens: sign → verify; the signature is HMAC-SHA256 over "<kind>.<body>" with COMP_SECRET', () => {
  const w = fresh();
  const token = w.gs.compSignToken_('at1', { s: 's-0123456789ab', c: 'cmp-01234567', v: 'abc', d: 0, e: Date.now() + 60000 });
  const [kind, body, sig] = token.split('.');
  assert.equal(kind, 'at1');
  assert.deepEqual(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')).s, 's-0123456789ab');
  const expected = createHmac('sha256', Buffer.from(w.properties.get('COMP_SECRET'), 'utf8')).update(`at1.${body}`).digest('base64url');
  assert.equal(sig, expected);
  const read = w.gs.compReadToken_('at1', token);
  assert.equal(read.ok, true);
  assert.equal(read.payload.c, 'cmp-01234567');
});

test('tokens: tampered body / signature, another kind, another secret, junk → bad; past e → expired', () => {
  const w = fresh();
  const payload = { s: 's-0123456789ab', c: 'cmp-01234567', e: Date.now() + 60000 };
  const token = w.gs.compSignToken_('rc1', payload);
  const [kind, body, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ ...payload, s: 's-ffffffffffff' })).toString('base64url');
  const flip = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A');
  for (const bad of [`${kind}.${forged}.${sig}`, `${kind}.${body}.${flip}`, `at1.${body}.${sig}`, token + 'x', '', null, 42, 'rc1..', 'a'.repeat(2000)]) {
    const read = w.gs.compReadToken_('rc1', bad);
    assert.equal(read.ok, false, String(bad).slice(0, 30));
    assert.equal(read.reason, 'bad');
  }
  assert.equal(fresh().gs.compReadToken_('rc1', token).ok, false, 'another deployment\'s secret');
  const old = w.gs.compSignToken_('pt1', { p: 'p-01234567', cv: 1, e: Date.now() - 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(w.gs.compReadToken_('pt1', old))).reason, 'expired');
  // expiry follows the world's clock
  const soon = w.gs.compSignToken_('pt1', { p: 'p-01234567', cv: 1, e: Date.now() + 5000 });
  assert.equal(w.gs.compReadToken_('pt1', soon).ok, true);
  w.advance(6000);
  assert.equal(w.gs.compReadToken_('pt1', soon).reason, 'expired');
  // a non-number expiry is not "no expiry"
  assert.equal(w.gs.compReadToken_('pt1', w.gs.compSignToken_('pt1', { p: 'x', e: '9999999999999' })).ok, false);
  assert.throws(() => w.gs.compSignToken_('xx1', {}), /token kind/);
});

test('constant-time compare: equal only when equal, any length', () => {
  const w = fresh();
  assert.equal(w.gs.compSafeEqual_('abc', 'abc'), true);
  assert.equal(w.gs.compSafeEqual_('abc', 'abd'), false);
  assert.equal(w.gs.compSafeEqual_('abc', 'abcd'), false);
  assert.equal(w.gs.compSafeEqual_('', ''), true);
  assert.equal(w.gs.compSafeEqualBytes_([1, -2, 3], [1, 254, 3]), true, 'signed and unsigned bytes alike');
  assert.equal(w.gs.compSafeEqualBytes_([1, 2], [1, 2, 3]), false);
});

test('encryption: round trip (short, long, Arabic), fresh nonce each time, tamper / wrong key → null', () => {
  const w = fresh();
  const key = w.gs.compSecretBytes_('CODE_KEY');
  for (const plain of ['ATH-23AB-CD45', 'ك', '', 'x'.repeat(100), 'كود طويل '.repeat(10)]) {
    const enc = w.gs.compEncrypt_(plain, key);
    assert.match(enc, /^v1:[A-Za-z0-9_-]+$/);
    assert.equal(w.gs.compDecrypt_(enc, key), plain);
  }
  const a = w.gs.compEncrypt_('ATH-23AB-CD45', key);
  const b = w.gs.compEncrypt_('ATH-23AB-CD45', key);
  assert.notEqual(a, b, 'a new nonce every time');
  assert.ok(!a.includes('ATH'), 'not readable');
  const raw = Buffer.from(a.slice(3), 'base64url');
  assert.equal(raw.length, 16 + 13 + 16, 'nonce16 ‖ ct ‖ tag16');
  for (let i of [0, 16, raw.length - 1]) {
    const bad = Buffer.from(raw);
    bad[i] ^= 1;
    assert.equal(w.gs.compDecrypt_('v1:' + bad.toString('base64url'), key), null, `byte ${i} flipped`);
  }
  assert.equal(w.gs.compDecrypt_(a, w.gs.compSecretBytes_('CODE_PEPPER')), null, 'another key');
  for (const junk of ['', 'v2:' + a.slice(3), 'v1:', 'v1:@@@', 'v1:' + Buffer.alloc(10).toString('base64url'), null]) {
    assert.equal(w.gs.compDecrypt_(junk, key), null, String(junk));
  }
});

test('encryption follows the contract: encKey/macKey = HMAC(key, "enc"/"mac"), stream = HMAC(encKey, nonce), tag = HMAC(macKey, "v1"‖nonce‖ct)[0..16]', () => {
  const w = fresh();
  const keyBytes = w.gs.compSecretBytes_('CODE_KEY');
  const key = Buffer.from(keyBytes.map(b => (b < 0 ? b + 256 : b)));
  const enc = w.gs.compEncrypt_('ATH-23AB-CD45', keyBytes);
  const raw = Buffer.from(enc.slice(3), 'base64url');
  const nonce = raw.subarray(0, 16);
  const ct = raw.subarray(16, raw.length - 16);
  const tag = raw.subarray(raw.length - 16);
  const hmac = (k, data) => createHmac('sha256', k).update(data).digest();
  const encKey = hmac(key, 'enc');
  const macKey = hmac(key, 'mac');
  const stream = hmac(encKey, nonce);
  assert.equal(Buffer.from(ct.map((b, i) => b ^ stream[i])).toString('utf8'), 'ATH-23AB-CD45');
  assert.ok(hmac(macKey, Buffer.concat([Buffer.from('v1'), nonce, ct])).subarray(0, 16).equals(tag));
});
