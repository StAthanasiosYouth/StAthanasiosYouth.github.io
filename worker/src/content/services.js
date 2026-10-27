/*
 * The Apps Script services the bundled admin code (gs.gen.js) needs, for one
 * Worker request (Phase 4, docs/CONTENT-MIGRATION-PLAN.md §6).
 *
 * Spreadsheets are held in memory: built from D1's draft rows before the
 * call, read back after it (runtime.js), never stored as sheets. The
 * semantics are those of Google Sheets as the code relies on them (and as
 * tests/fakes/gas.mjs models them for the Sheets tests): 1-based ranges, the
 * last row = the last row with any value, appendRow after it.
 * Everything that would leave the spreadsheet (network, Drive, mail) throws.
 */

/* ---------- sheets ---------- */

class MemRange {
  constructor(sheet, row, col, rows = 1, cols = 1) { Object.assign(this, { sheet, row, col, rows, cols }); }
  getValues() {
    const out = [];
    for (let r = 0; r < this.rows; r++) {
      const line = [];
      for (let c = 0; c < this.cols; c++) {
        const v = (this.sheet.data[this.row - 1 + r] || [])[this.col - 1 + c];
        line.push(v === undefined ? '' : v);
      }
      out.push(line);
    }
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  setValues(values) {
    values.forEach((line, r) => line.forEach((v, c) => this.sheet.set(this.row + r, this.col + c, v)));
    return this;
  }
  setValue(value) {
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) this.sheet.set(this.row + r, this.col + c, value);
    return this;
  }
  // formatting / validation: nothing to keep in D1
  setNumberFormat() { return this; }
  setNumberFormats() { return this; }
  setFontWeight() { return this; }
  setFontColor() { return this; }
  setBackground() { return this; }
  setNote() { return this; }
  setNotes() { return this; }
  setWrap() { return this; }
  setHorizontalAlignment() { return this; }
  clearDataValidations() { return this; }
  setDataValidation(rule) {
    // like Sheets: a checkbox puts FALSE into its empty cells (getLastRow then reaches them)
    if (rule && rule.checkbox) {
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          const v = (this.sheet.data[this.row - 1 + r] || [])[this.col - 1 + c];
          if (v === undefined || v === '' || v === null) this.sheet.set(this.row + r, this.col + c, false);
        }
      }
    }
    return this;
  }
}

export class MemSheet {
  constructor(name, spreadsheet, data = []) {
    this.name = name;
    this.spreadsheet = spreadsheet;
    this.data = data;
    this.maxRows = Math.max(1000, data.length + 1);
    this.maxColumns = 26;
    this.dirty = false;
  }
  set(row, col, value) {
    if (row > this.maxRows) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
    this.dirty = true;
    while (this.data.length < row) this.data.push([]);
    const line = this.data[row - 1];
    while (line.length < col) line.push('');
    line[col - 1] = value;
  }
  getName() { return this.name; }
  getSheetId() { return this.name; }
  getLastRow() {
    for (let r = this.data.length; r > 0; r--) if (this.data[r - 1].some(v => v !== '' && v !== null && v !== undefined)) return r;
    return 0;
  }
  getLastColumn() { return this.data.reduce((max, line) => Math.max(max, line.length), 0); }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return Math.max(this.maxColumns, this.getLastColumn()); }
  getRange(row, col, rows, cols) {
    if (typeof row === 'string') throw new Error('A1 ranges are not supported here');
    if (row + (rows || 1) - 1 > this.maxRows) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
    return new MemRange(this, row, col, rows || 1, cols || 1);
  }
  getDataRange() { return new MemRange(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
  insertRowsAfter(row, count) {
    if (row < this.data.length) { this.data.splice(row, 0, ...Array.from({ length: count }, () => [])); this.dirty = true; }
    this.maxRows += count;
  }
  insertColumnsAfter(column, count) { this.maxColumns = this.getMaxColumns() + count; }
  appendRow(values) {
    const row = this.getLastRow() + 1;
    if (row > this.maxRows) this.maxRows = row;
    values.forEach((v, i) => this.set(row, i + 1, v));
    return this;
  }
  deleteRow(row) { this.data.splice(row - 1, 1); this.maxRows--; this.dirty = true; }
  deleteRows(row, count) { this.data.splice(row - 1, count); this.maxRows -= count; this.dirty = true; }
  setFrozenRows() {}
  setRightToLeft() {}
  setColumnWidth() {}
  setColumnWidths() {}
  hideSheet() { return this; }
  isSheetHidden() { return false; }
  protect() { return { setDescription() { return this; }, setWarningOnly() { return this; } }; }
  setName(name) { this.name = name; this.dirty = true; return this; }
}

export class MemSpreadsheet {
  constructor(id, name) {
    this.id = id;
    this.name = name;
    this.sheets = [];
  }
  addSheet(name, data) {
    const sheet = new MemSheet(name, this, data);
    this.sheets.push(sheet);
    return sheet;
  }
  getId() { return this.id; }
  getName() { return this.name; }
  getUrl() { return 'd1://' + this.id; }
  setSpreadsheetTimeZone() {}
  getSpreadsheetTimeZone() { return 'Africa/Cairo'; }
  getSheets() { return this.sheets.slice(); }
  getSheetByName(name) { return this.sheets.find(s => s.name === name) || null; }
  insertSheet(name) { const s = this.addSheet(name, []); s.dirty = true; s.created = true; return s; }
  deleteSheet(sheet) { this.sheets = this.sheets.filter(s => s !== sheet); sheet.dirty = true; }
}

/* ---------- Utilities ---------- */

export function formatDate(date, timeZone, pattern) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone === 'UTC' ? 'UTC' : timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).map(p => [p.type, p.value]));
  return pattern.split(/('[^']*')/).map(chunk => chunk.startsWith("'") ? chunk.slice(1, -1) : chunk
    .replace(/yyyy/g, parts.year).replace(/MM/g, parts.month).replace(/dd/g, parts.day)
    .replace(/HH/g, parts.hour).replace(/mm/g, parts.minute).replace(/ss/g, parts.second)).join('');
}

/* SHA-256 without a Promise (Apps Script's computeDigest is synchronous) */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);

export function sha256Sync(bytes) {
  const len = bytes.length;
  const total = ((len + 9 + 63) >> 6) << 6;
  const m = new Uint8Array(total);
  m.set(bytes);
  m[len] = 0x80;
  const bits = len * 8;
  const dv = new DataView(m.buffer);
  dv.setUint32(total - 8, Math.floor(bits / 0x100000000));
  dv.setUint32(total - 4, bits >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i]);
  return out;
}

const enc = new TextEncoder();
const signed = bytes => Array.from(bytes, b => (b > 127 ? b - 256 : b));
const unsigned = arr => Uint8Array.from(arr, b => (b < 0 ? b + 256 : b));
const toBytes = data => (Array.isArray(data) ? unsigned(data) : enc.encode(String(data)));

function hmacSync(key, value) {
  let k = toBytes(key);
  if (k.length > 64) k = sha256Sync(k);
  const pad = n => { const p = new Uint8Array(64 + 0); p.set(k); return p.map(b => b ^ n); };
  const v = toBytes(value);
  const inner = new Uint8Array(64 + v.length); inner.set(pad(0x36)); inner.set(v, 64);
  const ih = sha256Sync(inner);
  const outer = new Uint8Array(96); outer.set(pad(0x5c)); outer.set(ih, 64);
  return sha256Sync(outer);
}

function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export const Utilities = {
  formatDate,
  getUuid: () => crypto.randomUUID(),
  DigestAlgorithm: { SHA_256: 'sha256' },
  Charset: { UTF_8: 'utf8' },
  computeDigest(algorithm, data) {
    if (algorithm !== 'sha256') throw new Error('digest ' + algorithm + ' is not available here');
    return signed(sha256Sync(toBytes(data)));
  },
  computeHmacSha256Signature: (value, key) => signed(hmacSync(key, value)),
  base64Encode: bytes => b64(typeof bytes === 'string' ? enc.encode(bytes) : unsigned(bytes)),
  base64Decode: text => signed(Uint8Array.from(atob(text), c => c.charCodeAt(0))),
  base64EncodeWebSafe: bytes => b64(typeof bytes === 'string' ? enc.encode(bytes) : unsigned(bytes)).replace(/\+/g, '-').replace(/\//g, '_'),
  sleep: () => {},
  newBlob(data) {
    const bytes = typeof data === 'string' ? enc.encode(data) : unsigned(data);
    return { getDataAsString: () => new TextDecoder().decode(bytes), getBytes: () => signed(bytes), getContentType: () => '' };
  }
};

/* ---------- the rest ---------- */

export function memCache(seed = {}) {
  const map = new Map(Object.entries(seed));
  const cache = {
    get: key => (map.has(key) ? map.get(key) : null),
    getAll: keys => Object.fromEntries(keys.filter(k => map.has(k)).map(k => [k, map.get(k)])),
    put: (key, value) => { map.set(key, String(value)); },
    putAll: values => { for (const [k, v] of Object.entries(values)) map.set(k, String(v)); },
    remove: key => { map.delete(key); },
    removeAll: keys => { for (const k of keys) map.delete(k); }
  };
  return { getScriptCache: () => cache, getUserCache: () => cache, getDocumentCache: () => cache };
}

export function memProperties(seed = {}) {
  const map = new Map(Object.entries(seed));
  const store = {
    getProperty: key => (map.has(key) ? map.get(key) : null),
    getProperties: () => Object.fromEntries(map),
    getKeys: () => [...map.keys()],
    // writes stay in this request: Script Properties are Apps Script's
    setProperty: (key, value) => { map.set(key, String(value)); return store; },
    setProperties: values => { for (const [k, v] of Object.entries(values)) map.set(k, String(v)); return store; },
    deleteProperty: key => { map.delete(key); return store; }
  };
  return { getScriptProperties: () => store, getUserProperties: () => store, getDocumentProperties: () => store };
}

const lock = { waitLock() {}, tryLock: () => true, releaseLock() {}, hasLock: () => true };
export const LockService = { getScriptLock: () => lock, getUserLock: () => lock, getDocumentLock: () => lock };

const away = name => new Proxy({}, { get: (_, key) => () => { throw new Error(name + '.' + String(key) + ' is not available in the Worker'); } });
export const offline = {
  UrlFetchApp: away('UrlFetchApp'), DriveApp: away('DriveApp'), ScriptApp: away('ScriptApp'),
  HtmlService: away('HtmlService'), ContentService: away('ContentService')
};
