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
    values.forEach((line, r) => line.forEach((value, c) => this.sheet.set(this.row + r, this.col + c, value)));
    return this;
  }

  setValue(value) {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) this.sheet.set(this.row + r, this.col + c, value);
    }
    return this;
  }

  // formatting / validation: accepted and ignored
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
  setFontColor() { return this; }
  setBackground() { return this; }
  setNote() { return this; }
  setDataValidation() { return this; }

}


class FakeSheet {

  constructor(name) {
    this.name = name;
    this.data = [];
  }

  set(row, col, value) {
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

  getMaxRows() { return Math.max(1000, this.data.length); }

  getRange(row, col, rows, cols) {
    if (typeof row === 'string') return new FakeRange(this, 2, 1, 1, 1);
    return new FakeRange(this, row, col, rows || 1, cols || 1);
  }

  getDataRange() {
    return new FakeRange(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1));
  }

  appendRow(values) {
    const row = this.getLastRow() + 1;
    values.forEach((value, i) => this.set(row, i + 1, value));
  }

  deleteRow(row) { this.data.splice(row - 1, 1); }

  deleteRows(row, count) { this.data.splice(row - 1, count); }

  setFrozenRows() {}
  setRightToLeft() {}
  setColumnWidth() {}

}


class FakeSpreadsheet {

  constructor(owner) {
    this.owner = owner;
    this.sheets = [new FakeSheet('Sheet1')];
  }

  getId() { return 'sheet-id-123'; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/sheet-id-123/edit'; }
  getOwner() { return { getEmail: () => this.owner }; }
  setSpreadsheetTimeZone() {}
  getSheets() { return this.sheets.slice(); }
  getSheetByName(name) { return this.sheets.find(s => s.name === name) || null; }

  insertSheet(name) {
    const sheet = new FakeSheet(name);
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

  constructor({ repo = 'StAthanasiosYouth/athanasios-links', token = 'test-token', files = {} } = {}) {
    this.repo = repo;
    this.token = token;
    this.trees = new Map();
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

    if (method === 'post' && path === '/git/trees') {
      const files = { ...this.trees.get(body.base_tree) };
      for (const entry of body.tree) files[entry.path] = entry.content;
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
export function createWorld({ owner = 'menazakmena@gmail.com', github = new FakeGitHub(), mapsRedirects = {}, adminEmails = owner } = {}) {

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
        return spreadsheet;
      },
      create: () => { spreadsheet = new FakeSpreadsheet(user); return spreadsheet; },
      getUi: () => { throw new Error('no UI in tests'); },
      newDataValidation: () => {
        const builder = {
          requireCheckbox: () => builder,
          requireValueInList: () => builder,
          requireValueInRange: () => builder,
          setAllowInvalid: () => builder,
          build: () => ({})
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
      base64Decode: text => [...Buffer.from(text, 'base64')],
      newBlob: bytes => ({ getDataAsString: () => Buffer.from(bytes.map(b => (b < 0 ? b + 256 : b))).toString('utf8') })
    },

    UrlFetchApp: {
      fetch: (url, options) => {
        if (mapsRedirects[url]) {
          return { getResponseCode: () => 302, getContentText: () => '', getHeaders: () => ({ Location: mapsRedirects[url] }) };
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

    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/fake/exec' }) }

  });

  for (const file of ['Content.gs', 'Seed.gs', 'Auth.gs', 'Store.gs', 'Publish.gs', 'Code.gs']) {
    vm.runInContext(readFileSync(`${ROOT}apps-script/${file}`, 'utf8'), context, { filename: file });
  }

  return {
    gs: context,
    github,
    get spreadsheet() { return spreadsheet; },
    properties,
    as(email) { user = email; return this; }
  };

}
