// In-memory stand-ins for the Apps Script services the admin uses, plus a
// fake GitHub API with real commit/ref semantics. Lets the actual .gs files
// run in Node: tests/admin.test.mjs.

import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { ROOT } from '../../tools/lib/gs.mjs';


/* =========================================================
   SPREADSHEET
========================================================= */

class FakeRange {

  constructor(sheet, row, col, rows = 1, cols = 1) {
    Object.assign(this, { sheet, row, col, rows, cols });
  }

  getValues() {
    this.sheet.stats.cellsRead += this.rows * this.cols;
    const out = [];
    for (let r = 0; r < this.rows; r++) {
      const line = [];
      for (let c = 0; c < this.cols; c++) {
        const value = (this.sheet.data[this.row - 1 + r] || [])[this.col - 1 + c];
        line.push(value === undefined ? '' : value);
      }
      out.push(line);
    }
    return out;
  }

  getValue() {
    return this.getValues()[0][0];
  }

  setValues(values) {
    this.sheet.stats.writes++;
    values.forEach((line, r) => line.forEach((value, c) => this.sheet.set(this.row + r, this.col + c, value)));
    return this;
  }

  setValue(value) {
    this.sheet.stats.writes++;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) this.sheet.set(this.row + r, this.col + c, value);
    }
    return this;
  }

  // formatting: accepted and ignored
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
  setFontColor() { return this; }
  setBackground() { return this; }
  setNote() { return this; }

  // like Google Sheets: a checkbox stores FALSE in every empty cell it
  // covers, so getLastRow() / getDataRange() reach the end of the range
  setDataValidation(rule) {
    if (rule && rule.checkbox) {
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          const value = (this.sheet.data[this.row - 1 + r] || [])[this.col - 1 + c];
          if (value === undefined || value === '' || value === null) this.sheet.set(this.row + r, this.col + c, false);
        }
      }
    }
    return this;
  }

}


class FakeSheet {

  constructor(name, stats) {
    this.name = name;
    this.data = [];
    // a new tab in Google Sheets has 1000 rows
    this.maxRows = 1000;
    this.stats = stats || { cellsRead: 0, writes: 0, opens: 0 };
  }

  set(row, col, value) {
    if (row > this.maxRows) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
    while (this.data.length < row) this.data.push([]);
    const line = this.data[row - 1];
    while (line.length < col) line.push('');
    line[col - 1] = value;
  }

  getName() { return this.name; }

  getLastRow() {
    for (let r = this.data.length; r > 0; r--) {
      if (this.data[r - 1].some(v => v !== '' && v !== null && v !== undefined)) return r;
    }
    return 0;
  }

  getLastColumn() {
    return this.data.reduce((max, line) => Math.max(max, line.length), 0);
  }

  getMaxRows() { return this.maxRows; }

  getRange(row, col, rows, cols) {
    if (typeof row === 'string') return new FakeRange(this, 2, 1, 1, 1);
    if (row + (rows || 1) - 1 > this.maxRows) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
    return new FakeRange(this, row, col, rows || 1, cols || 1);
  }

  insertRowsAfter(row, count) {
    if (row < this.data.length) this.data.splice(row, 0, ...Array.from({ length: count }, () => []));
    this.maxRows += count;
  }

  getDataRange() {
    return new FakeRange(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1));
  }

  appendRow(values) {
    this.stats.writes++;
    const row = this.getLastRow() + 1;
    if (row > this.maxRows) this.maxRows = row;
    values.forEach((value, i) => this.set(row, i + 1, value));
  }

  deleteRow(row) { this.data.splice(row - 1, 1); this.maxRows--; }

  deleteRows(row, count) { this.data.splice(row - 1, count); this.maxRows -= count; }

  setFrozenRows() {}
  setRightToLeft() {}
  setColumnWidth() {}

  // a new tab in Google Sheets has 26 columns (A..Z)
  getMaxColumns() { return Math.max(this.maxColumns || 26, this.getLastColumn()); }
  insertColumnsAfter(column, count) { this.maxColumns = this.getMaxColumns() + count; }

  setName(name) {
    if (this.spreadsheet && this.spreadsheet.sheets.some(s => s !== this && s.name === name)) {
      throw new Error(`A sheet with the name "${name}" already exists.`);
    }
    this.name = name;
    return this;
  }

  hideSheet() { this.hidden = true; return this; }
  isSheetHidden() { return !!this.hidden; }

  copyTo(spreadsheet) {
    const copy = new FakeSheet(`Copy of ${this.name}`, this.stats);
    copy.spreadsheet = spreadsheet;
    copy.data = this.data.map(line => line.slice());
    copy.maxRows = this.maxRows;
    spreadsheet.sheets.push(copy);
    return copy;
  }

}


class FakeSpreadsheet {

  constructor(owner) {
    this.owner = owner;
    // service-call counters, for the performance tests
    this.stats = { cellsRead: 0, writes: 0, opens: 0 };
    this.sheets = [new FakeSheet('Sheet1', this.stats)];
  }

  getId() { return 'sheet-id-123'; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/sheet-id-123/edit'; }
  getOwner() { return { getEmail: () => this.owner }; }
  setSpreadsheetTimeZone() {}
  getSheets() { return this.sheets.slice(); }
  getSheetByName(name) { return this.sheets.find(s => s.name === name) || null; }

  insertSheet(name) {
    const sheet = new FakeSheet(name, this.stats);
    sheet.spreadsheet = this;
    this.sheets.push(sheet);
    return sheet;
  }

  deleteSheet(sheet) { this.sheets = this.sheets.filter(s => s !== sheet); }

}


/* =========================================================
   GITHUB
========================================================= */

const sha = text => createHash('sha1').update(text).digest('hex');

export class FakeGitHub {

  constructor({ repo = 'StAthanasiosYouth/StAthanasiosYouth.github.io', token = 'test-token', files = {} } = {}) {
    this.repo = repo;
    this.token = token;
    this.trees = new Map();
    this.blobs = new Map();
    this.commits = new Map();
    this.requests = [];
    const tree = this.storeTree({ ...files });
    const commit = this.storeCommit({ message: 'initial', tree, parents: [] });
    this.head = commit;
    this.beforeRefUpdate = null;
  }

  storeTree(files) {
    const id = sha(JSON.stringify(Object.entries(files).sort()));
    this.trees.set(id, files);
    return id;
  }

  storeCommit(commit) {
    const id = sha(JSON.stringify(commit) + Math.random());
    this.commits.set(id, commit);
    return id;
  }

  files(commitSha = this.head) {
    return this.trees.get(this.commits.get(commitSha).tree);
  }

  /* simulate someone else pushing (e.g. a code change) */
  pushOther(path, content) {
    const files = { ...this.files(), [path]: content };
    this.head = this.storeCommit({ message: 'other', tree: this.storeTree(files), parents: [this.head] });
  }

  respond(code, body, headers = {}) {
    const text = body === undefined ? '' : JSON.stringify(body);
    return { getResponseCode: () => code, getContentText: () => text, getHeaders: () => headers };
  }

  fetch(url, options = {}) {

    const method = (options.method || 'get').toLowerCase();
    const prefix = `https://api.github.com/repos/${this.repo}`;

    this.requests.push({ method, url, headers: options.headers, payload: options.payload });

    if (!url.startsWith(prefix)) return this.respond(404, { message: 'Not Found' });
    if ((options.headers || {}).Authorization !== `Bearer ${this.token}`) return this.respond(401, { message: 'Bad credentials' });

    const path = url.slice(prefix.length);
    const body = options.payload ? JSON.parse(options.payload) : null;

    if (method === 'get' && path === '') {
      return this.respond(200, { full_name: this.repo, permissions: { push: true }, has_pages: true });
    }

    if (method === 'get' && path === '/git/ref/heads/main') {
      return this.respond(200, { object: { sha: this.head } });
    }

    let match;

    if (method === 'get' && (match = /^\/git\/commits\/(\w+)$/.exec(path))) {
      const commit = this.commits.get(match[1]);
      return commit ? this.respond(200, { sha: match[1], tree: { sha: commit.tree } }) : this.respond(404, { message: 'no commit' });
    }

    if (method === 'post' && path === '/git/blobs') {
      const sha = createHash('sha1').update(body.content).digest('hex');
      this.blobs.set(sha, Buffer.from(body.content, body.encoding === 'base64' ? 'base64' : 'utf8'));
      return this.respond(201, { sha });
    }

    if (method === 'post' && path === '/git/trees') {
      const files = { ...this.trees.get(body.base_tree) };
      for (const entry of body.tree) files[entry.path] = entry.sha ? this.blobs.get(entry.sha) : entry.content;
      return this.respond(201, { sha: this.storeTree(files) });
    }

    if (method === 'post' && path === '/git/commits') {
      return this.respond(201, { sha: this.storeCommit({ message: body.message, tree: body.tree, parents: body.parents }) });
    }

    if (method === 'patch' && path === '/git/refs/heads/main') {
      if (this.beforeRefUpdate) {
        const hook = this.beforeRefUpdate;
        this.beforeRefUpdate = null;
        hook();
      }
      const commit = this.commits.get(body.sha);
      if (!commit || commit.parents[0] !== this.head) {
        return this.respond(422, { message: 'Update is not a fast forward' });
      }
      this.head = body.sha;
      return this.respond(200, { object: { sha: body.sha } });
    }

    if (method === 'get' && (match = /^\/contents\/([\w.-]+)\?ref=main$/.exec(path))) {
      const content = this.files()[match[1]];
      return content === undefined
        ? this.respond(404, { message: 'Not Found' })
        : this.respond(200, { content: Buffer.from(content, 'utf8').toString('base64').replace(/(.{60})/g, '$1\n') });
    }

    return this.respond(404, { message: `unhandled ${method} ${path}` });

  }

}


/* =========================================================
   DRIVE (REST, drive.file)
========================================================= */

export class FakeDrive {

  constructor() {
    this.files = new Map();
    this.requests = [];
    // set to { code, body } to make every Drive call fail like the real API
    this.failWith = null;
  }

  respond(code, body, bytes) {
    const text = body === undefined ? '' : JSON.stringify(body);
    return { getResponseCode: () => code, getContentText: () => text, getContent: () => bytes || [], getHeaders: () => ({}) };
  }

  fetch(url, options = {}) {
    const method = (options.method || 'get').toLowerCase();
    this.requests.push({ method, url, contentType: options.contentType });
    if ((options.headers || {}).Authorization !== 'Bearer fake-oauth-token') return this.respond(401, { error: 'auth' });
    if (this.failWith) return this.respond(this.failWith.code, this.failWith.body);

    const fileUrl = /^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/([\w-]+)(\?fields=[\w,]+)?$/.exec(url);
    if (fileUrl && method === 'delete') {
      return this.files.delete(fileUrl[1]) ? this.respond(204) : this.respond(404, { error: { code: 404, message: 'File not found', errors: [{ reason: 'notFound' }] } });
    }
    if (fileUrl && method === 'get') {
      const file = this.files.get(fileUrl[1]);
      return file ? this.respond(200, { id: fileUrl[1], trashed: false }) : this.respond(404, { error: { code: 404, message: 'File not found', errors: [{ reason: 'notFound' }] } });
    }

    if (method === 'post' && url.startsWith('https://www.googleapis.com/drive/v3/files?')) {
      const id = 'folder' + randomUUID().replace(/-/g, '');
      this.files.set(id, { meta: JSON.parse(options.payload), bytes: [] });
      return this.respond(200, { id });
    }

    if (method === 'post' && url.startsWith('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart')) {
      // multipart/related: JSON part, then the binary part
      const boundary = /boundary=(\S+)/.exec(options.contentType)[1];
      const raw = Buffer.from(options.payload.map(b => (b < 0 ? b + 256 : b)));
      const text = raw.toString('latin1');
      const parts = text.split('--' + boundary).slice(1, -1);
      const meta = JSON.parse(Buffer.from(parts[0].split('\r\n\r\n')[1].trim(), 'latin1').toString('utf8'));
      const body = parts[1].slice(parts[1].indexOf('\r\n\r\n') + 4, -2);
      if (meta.parents && !this.files.has(meta.parents[0])) {
        return this.respond(404, { error: { code: 404, message: 'File not found: ' + meta.parents[0], errors: [{ reason: 'notFound' }] } });
      }
      const id = 'file' + randomUUID().replace(/-/g, '');
      this.files.set(id, { meta, bytes: [...Buffer.from(body, 'latin1')].map(b => (b > 127 ? b - 256 : b)) });
      return this.respond(200, { id });
    }

    const match = /^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/([\w-]+)\?alt=media$/.exec(url);
    if (method === 'get' && match) {
      const file = this.files.get(match[1]);
      return file ? this.respond(200, undefined, file.bytes) : this.respond(404, { error: 'not found' });
    }

    return this.respond(404, { error: 'unhandled ' + url });
  }

}


/* =========================================================
   RUNTIME
========================================================= */

function formatDate(date, timeZone, pattern) {

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone === 'UTC' ? 'UTC' : timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(date).map(p => [p.type, p.value])
  );

  // split out 'quoted' literals, replace tokens in the rest
  return pattern.split(/('[^']*')/).map(chunk => {
    if (chunk.startsWith("'")) return chunk.slice(1, -1);
    return chunk
      .replace(/yyyy/g, parts.year)
      .replace(/MM/g, parts.month)
      .replace(/dd/g, parts.day)
      .replace(/HH/g, parts.hour)
      .replace(/mm/g, parts.minute)
      .replace(/ss/g, parts.second);
  }).join('');

}


/**
 * Creates a fresh Apps Script world with all project .gs files loaded.
 * world.as(email) switches the signed-in user.
 */
export function createWorld({ owner = 'menazakmena@gmail.com', github = new FakeGitHub(), drive = new FakeDrive(), mapsRedirects = {}, adminEmails = owner } = {}) {

  // standalone script project: no active spreadsheet; setup() creates one
  const properties = new Map(adminEmails ? [['ADMIN_EMAILS', adminEmails]] : []);
  let spreadsheet = null;
  let user = owner;

  const context = vm.createContext({

    console: { log() {}, warn() {}, error() {} },

    Session: {
      getActiveUser: () => ({ getEmail: () => user }),
      getEffectiveUser: () => ({ getEmail: () => user })
    },

    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: key => (properties.has(key) ? properties.get(key) : null),
        setProperty: (key, value) => { properties.set(key, String(value)); },
        setProperties: values => { for (const [k, v] of Object.entries(values)) properties.set(k, String(v)); },
        deleteProperty: key => { properties.delete(key); }
      })
    },

    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },

    SpreadsheetApp: {
      getActiveSpreadsheet: () => null,
      openById: id => {
        if (!spreadsheet || id !== spreadsheet.getId()) throw new Error('not found');
        spreadsheet.stats.opens++;
        return spreadsheet;
      },
      create: () => { spreadsheet = new FakeSpreadsheet(user); return spreadsheet; },
      getUi: () => { throw new Error('no UI in tests'); },
      newDataValidation: () => {
        let checkbox = false;
        const builder = {
          requireCheckbox: () => { checkbox = true; return builder; },
          requireValueInList: () => builder,
          requireValueInRange: () => builder,
          setAllowInvalid: () => builder,
          build: () => ({ checkbox })
        };
        return builder;
      }
    },

    Utilities: {
      formatDate,
      getUuid: () => randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (algorithm, text) => [...createHash(algorithm).update(text, 'utf8').digest()].map(b => (b > 127 ? b - 256 : b)),
      base64Decode: text => [...Buffer.from(text, 'base64')].map(b => (b > 127 ? b - 256 : b)),
      base64Encode: bytes => Buffer.from(bytes.map(b => (b < 0 ? b + 256 : b))).toString('base64'),
      newBlob: data => {
        const buffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data.map(b => (b < 0 ? b + 256 : b)));
        return {
          getDataAsString: () => buffer.toString('utf8'),
          getBytes: () => [...buffer].map(b => (b > 127 ? b - 256 : b))
        };
      }
    },

    UrlFetchApp: {
      fetch: (url, options) => {
        if (mapsRedirects[url]) {
          return { getResponseCode: () => 302, getContentText: () => '', getHeaders: () => ({ Location: mapsRedirects[url] }) };
        }
        if (url.startsWith('https://www.googleapis.com/')) return drive.fetch(url, options);
        if (url === 'https://oauth2.googleapis.com/tokeninfo') {
          const scope = drive.grantedScopes ?? 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file';
          return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ scope }), getHeaders: () => ({}) };
        }
        return github.fetch(url, options);
      }
    },

    HtmlService: {
      XFrameOptionsMode: { DEFAULT: 'DEFAULT', ALLOWALL: 'ALLOWALL' },
      createTemplateFromFile: name => {
        const template = {
          name,
          evaluate: () => {
            const output = {
              template: name,
              data: { ...template },
              xframe: null,
              setTitle: () => output,
              addMetaTag: () => output,
              setXFrameOptionsMode: mode => { output.xframe = mode; return output; }
            };
            return output;
          }
        };
        return template;
      },
      createHtmlOutputFromFile: name => ({ getContent: () => readFileSync(`${ROOT}apps-script/${name}.html`, 'utf8') })
    },

    ScriptApp: {
      getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/fake/exec' }),
      getOAuthToken: () => 'fake-oauth-token'
    }

  });

  for (const file of ['Content.gs', 'Hub.gs', 'Seed.gs', 'Auth.gs', 'Store.gs', 'Publish.gs', 'Code.gs', 'Media.gs', 'Items.gs', 'Migrate.gs']) {
    vm.runInContext(readFileSync(`${ROOT}apps-script/${file}`, 'utf8'), context, { filename: file });
  }

  return {
    gs: context,
    github,
    drive,
    get spreadsheet() { return spreadsheet; },
    properties,
    as(email) { user = email; return this; }
  };

}
