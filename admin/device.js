/**
 * «خليك داخل» ON THE INSTALLED ADMIN APP: this phone's device credential
 * (apps-script/AdminDevice.gs). Loaded on demand by boot.js, only in the
 * installed admin app («لوحة تحكم الأسرة», opened from its own icon).
 *
 *  - The server's secret is turned at once into a NON-EXTRACTABLE WebCrypto
 *    HMAC key; only that key object is kept (IndexedDB
 *    'athanasios-admin-device'). Script can sign with it, nothing can read
 *    the secret back; the text itself is never stored.
 *  - A launch signs "<id>.<ms>.<nonce>" (random nonce) for deviceSignIn; the
 *    server checks it, the time, the nonce and the account, and answers a
 *    short-lived access token. No Google token, no email is kept here (the
 *    email shown is the server's answer).
 *  - forget(): «خروج», or the server said the device is no more.
 */

const DB = 'athanasios-admin-device';
const STORE = 'device';
const KEY = 'current';

const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');


function open() {

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

}

async function run(mode, fn) {

  const db = await open();

  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request && request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  finally {
    db.close();
  }

}


export function supported() {

  return !!(window.indexedDB && window.crypto && window.crypto.subtle);

}


/* { deviceId, key, until } while it is good, else null */
export async function load() {

  if (!supported()) return null;

  try {
    const record = await run('readonly', store => store.get(KEY));
    if (!record || !/^[0-9a-f]{24}$/.test(record.deviceId || '') || !(record.key instanceof CryptoKey) || !(Number(record.until) > Date.now())) {
      return null;
    }
    return record;
  }
  catch {
    return null;
  }

}


/* the server's answer to apiTrustDevice → a key that can't be read back */
export async function save(trusted) {

  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(trusted.secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

  await run('readwrite', store => store.put({ deviceId: trusted.deviceId, key, until: Number(trusted.until) }, KEY));

}


export async function forget() {

  try {
    await run('readwrite', store => store.delete(KEY));
  }
  catch {
    // nothing kept anyway
  }

}


/* the signed challenge for deviceSignIn */
export async function challenge(record) {

  const ts = Date.now();
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
  const sig = hex(await crypto.subtle.sign('HMAC', record.key, new TextEncoder().encode(`${record.deviceId}.${ts}.${nonce}`)));

  return { deviceId: record.deviceId, ts, nonce, sig };

}
