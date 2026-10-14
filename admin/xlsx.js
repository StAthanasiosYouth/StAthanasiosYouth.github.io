/*
 * A SMALL XLSX READER / WRITER for the admin's imports and exports
 * (questions, participants, results, codes). No dependency: an .xlsx file is
 * a zip of XML, and the browser can inflate (DecompressionStream) natively.
 *
 *   readXlsx(bytes)  → Promise<{ sheets: [{ name, rows: string[][] }] }>
 *   writeXlsx(book)  → Uint8Array   (book = { sheets: [Sheet] })
 *   rowsToTsv(rows)  → text the server's import parser reads (Import.gs style)
 *
 * Sheet = { name, rows: (string|number)[][], rtl?, widths?: number[],
 *           textColumns?: number[] (0-based; cells stay text, so a phone keeps
 *           its leading 0), lists?: [{ column, values: string[] | range, strict? }]
 *           (dropdowns), header?: true (first row bold + frozen), filter?: true
 *           (the header's filter buttons), hidden?: number[] (columns kept out of sight) }
 *
 * Reading keeps every cell as text exactly as shown: shared / inline strings,
 * numbers as written in the file, booleans as TRUE/FALSE. Formulas give their
 * cached value. Only the parts of the format these files use are handled;
 * anything else (zip64, encryption, xlsb) is refused with a clear error.
 */

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder('utf-8');


/* ---------- zip ---------- */

function u16(view, at) { return view.getUint16(at, true); }
function u32(view, at) { return view.getUint32(at, true); }

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('المتصفح ده مش بيقدر يفتح ملفات Excel. جرب Chrome أو احفظ الملف CSV.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** { name: Uint8Array } for every file in the zip. */
export async function unzip(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 65535); at--) {
    if (u32(view, at) === 0x06054b50) { end = at; break; }
  }
  if (end < 0) throw new Error('الملف ده مش ملف Excel (xlsx).');
  const count = u16(view, end + 10);
  let at = u32(view, end + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    if (u32(view, at) !== 0x02014b50) throw new Error('ملف Excel بايظ.');
    const method = u16(view, at + 10);
    const size = u32(view, at + 20);
    const nameLength = u16(view, at + 28);
    const extraLength = u16(view, at + 30);
    const commentLength = u16(view, at + 32);
    const local = u32(view, at + 42);
    const name = DECODER.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (size === 0xffffffff || local === 0xffffffff) throw new Error('الملف كبير قوي. قسمه على كذا ملف.');
    if (u32(view, local) !== 0x04034b50) throw new Error('ملف Excel بايظ.');
    const start = local + 30 + u16(view, local + 26) + u16(view, local + 28);
    const data = bytes.subarray(start, start + size);
    if (method === 0) files[name] = data;
    else if (method === 8) files[name] = await inflateRaw(data);
    else throw new Error('الملف محفوظ بطريقة مش مدعومة. احفظه تاني من Excel أو Google Sheets.');
    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A stored (uncompressed) zip: [{ name, data: Uint8Array }]. */
export function zip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = ENCODER.encode(entry.name);
    const data = entry.data;
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);          // UTF-8 names
    lv.setUint16(8, 0, true);               // stored
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0x21, true);           // 1980-01-01
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const head = new Uint8Array(46 + name.length);
    const cv = new DataView(head.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    head.set(name, 46);
    parts.push(local, data);
    central.push(head);
    offset += local.length + data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const tail = new Uint8Array(22);
  const tv = new DataView(tail.buffer);
  tv.setUint32(0, 0x06054b50, true);
  tv.setUint16(8, entries.length, true);
  tv.setUint16(10, entries.length, true);
  tv.setUint32(12, centralSize, true);
  tv.setUint32(16, offset, true);
  const all = [...parts, ...central, tail];
  const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of all) { out.set(part, at); at += part.length; }
  return out;
}


/* ---------- xml ---------- */

function unescapeXml(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, code) => {
    const lower = code.toLowerCase();
    if (lower === 'amp') return '&';
    if (lower === 'lt') return '<';
    if (lower === 'gt') return '>';
    if (lower === 'quot') return '"';
    if (lower === 'apos') return "'";
    const point = lower[1] === 'x' ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
    return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
  });
}

export function escapeXml(text) {
  return String(text)
    // characters XML 1.0 can't hold at all
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function attr(tag, name) {
  const match = new RegExp('\\s' + name + '="([^"]*)"').exec(tag) || new RegExp('\\s' + name + "='([^']*)'").exec(tag);
  return match ? unescapeXml(match[1]) : null;
}

/** All the text of the <t> elements in a fragment (rich text runs joined; phonetic hints skipped). */
function texts(fragment) {
  const clean = fragment.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  const re = /<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g;
  let match;
  while ((match = re.exec(clean))) out += match[1] ? unescapeXml(match[1]) : '';
  return out;
}

function columnIndex(ref) {
  const letters = /^[A-Z]+/i.exec(ref || '');
  if (!letters) return -1;
  let n = 0;
  for (const ch of letters[0].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function columnName(index) {
  let name = '';
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}


/* ---------- read ---------- */

function resolveTarget(target) {
  const clean = target.replace(/^\//, '');
  return clean.startsWith('xl/') ? clean : 'xl/' + clean;
}

function sheetRows(xml, shared) {
  const rows = [];
  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  let row;
  let nextRow = 0;
  while ((row = rowRe.exec(xml))) {
    const declared = attr('<row' + row[1] + '>', 'r');
    const index = declared ? parseInt(declared, 10) - 1 : nextRow;
    nextRow = index + 1;
    const cells = [];
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cell;
    let nextCol = 0;
    while ((cell = cellRe.exec(row[2] || ''))) {
      const tag = '<c' + cell[1] + '>';
      const ref = attr(tag, 'r');
      const col = ref ? columnIndex(ref) : nextCol;
      nextCol = col + 1;
      const type = attr(tag, 't') || 'n';
      const body = cell[2] || '';
      const valueMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
      const raw = valueMatch ? unescapeXml(valueMatch[1]) : '';
      let value;
      if (type === 's') value = shared[parseInt(raw, 10)] ?? '';
      else if (type === 'inlineStr') value = texts(body);
      else if (type === 'b') value = raw === '1' ? 'TRUE' : raw === '0' ? 'FALSE' : raw;
      else value = raw;                       // n, str (formula text), e
      if (col >= 0) cells[col] = value;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
    rows[index] = cells;
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

export async function readXlsx(input) {
  const files = await unzip(input);
  const text = (name) => (files[name] ? DECODER.decode(files[name]) : '');
  const workbook = text('xl/workbook.xml');
  if (!workbook) throw new Error('الملف ده مش ملف Excel (xlsx).');
  const rels = {};
  const relsXml = text('xl/_rels/workbook.xml.rels');
  for (const match of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(match[0], 'Id');
    const target = attr(match[0], 'Target');
    if (id && target) rels[id] = resolveTarget(target);
  }
  const shared = [];
  for (const match of text('xl/sharedStrings.xml').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)) {
    shared.push(match[1] ? texts(match[1]) : '');
  }
  const sheets = [];
  for (const match of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(match[0], 'name') || '';
    const rid = attr(match[0], 'r:id') || attr(match[0], 'id');
    const path = rels[rid] || '';
    sheets.push({ name, rows: path && files[path] ? sheetRows(text(path), shared) : [] });
  }
  return { sheets };
}


/* ---------- write ---------- */

function cellXml(value, ref, style) {
  if (value === null || value === undefined || value === '') return '';
  const s = style ? ' s="' + style + '"' : '';
  if (typeof value === 'number' && Number.isFinite(value)) return '<c r="' + ref + '"' + s + '><v>' + value + '</v></c>';
  const text = String(value);
  const space = /^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : '';
  return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t' + space + '>' + escapeXml(text) + '</t></is></c>';
}

function sheetXml(sheet) {
  const text = new Set(sheet.textColumns || []);
  const hidden = new Set(sheet.hidden || []);
  const header = sheet.header !== false;
  const widths = sheet.widths || [];
  const count = Math.max(widths.length, ...sheet.rows.map((row) => row.length), 1);
  let cols = '';
  for (let i = 0; i < count; i++) {
    const width = widths[i] || 16;
    cols += '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + width + '" customWidth="1"' + (text.has(i) ? ' style="2"' : '') + (hidden.has(i) ? ' hidden="1"' : '') + '/>';
  }
  let body = '';
  sheet.rows.forEach((row, r) => {
    let cells = '';
    row.forEach((value, c) => {
      const style = header && r === 0 ? 1 : text.has(c) ? 2 : 3;
      cells += cellXml(typeof value === 'number' && text.has(c) ? String(value) : value, columnName(c) + (r + 1), style);
    });
    body += '<row r="' + (r + 1) + '">' + cells + '</row>';
  });
  // a list: values (inline) or range (another sheet's cells, e.g. "'القوائم'!$A$2:$A$80"); strict: false lets new words in
  const lists = (sheet.lists || []).filter((list) => (list.values && list.values.length) || list.range);
  let validations = '';
  if (lists.length) {
    validations = '<dataValidations count="' + lists.length + '">' + lists.map((list) => {
      const col = columnName(list.column);
      const formula = list.range || '"' + list.values.map((v) => String(v).replace(/"/g, '""')).join(',') + '"';
      return '<dataValidation type="list" allowBlank="1" showErrorMessage="' + (list.strict === false ? '0' : '1') + '" sqref="' + col + '2:' + col + Math.max(1000, sheet.rows.length + 500) + '">'
        + '<formula1>' + escapeXml(formula) + '</formula1></dataValidation>';
    }).join('') + '</dataValidations>';
  }
  const pane = header ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : '';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<sheetViews><sheetView workbookViewId="0"' + (sheet.rtl === false ? '' : ' rightToLeft="1"') + '>' + pane + '</sheetView></sheetViews>'
    + '<cols>' + cols + '</cols><sheetData>' + body + '</sheetData>'
    // the header's filter buttons (Excel / Google Sheets / LibreOffice)
    + (sheet.filter && header ? '<autoFilter ref="A1:' + columnName(count - 1) + Math.max(sheet.rows.length, 2) + '"/>' : '')
    + validations
    + '</worksheet>';
}

const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts>'
  + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFF2D28B"/><bgColor indexed="64"/></patternFill></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="4">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"><alignment wrapText="1" vertical="center"/></xf>'
  + '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment wrapText="1" vertical="top"/></xf>'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment wrapText="1" vertical="top"/></xf>'
  + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
  + '</styleSheet>';

/* the hidden names Excel keeps for each sheet's filter range */
function filterNames(sheets) {
  const names = sheets.map((sheet, i) => {
    if (!sheet.filter || sheet.header === false) return '';
    const count = Math.max((sheet.widths || []).length, ...sheet.rows.map((row) => row.length), 1);
    const ref = "'" + sheet.name.replace(/'/g, "''") + "'!$A$1:$" + columnName(count - 1) + '$' + Math.max(sheet.rows.length, 2);
    return '<definedName name="_xlnm._FilterDatabase" localSheetId="' + i + '" hidden="1">' + escapeXml(ref) + '</definedName>';
  }).join('');
  return names ? '<definedNames>' + names + '</definedNames>' : '';
}

export function writeXlsx(book) {
  const sheets = book.sheets.map((sheet, i) => ({
    ...sheet,
    // Excel: ≤ 31 characters, none of []:*?/\ ; unique
    name: (String(sheet.name || 'Sheet' + (i + 1)).replace(/[[\]:*?/\\]/g, ' ').slice(0, 31).trim() || 'Sheet' + (i + 1))
  }));
  const files = [];
  const add = (name, text) => files.push({ name, data: ENCODER.encode(text) });
  add('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + sheets.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')
    + '</Types>');
  add('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '</Relationships>');
  add('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<bookViews><workbookView' + (sheets[0] && sheets[0].rtl === false ? '' : ' rightToLeft="1"') + '/></bookViews><sheets>'
    + sheets.map((sheet, i) => '<sheet name="' + escapeXml(sheet.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('')
    + '</sheets>'
    + filterNames(sheets)
    + '</workbook>');
  add('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + sheets.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('')
    + '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    + '</Relationships>');
  add('xl/styles.xml', STYLES);
  sheets.forEach((sheet, i) => add('xl/worksheets/sheet' + (i + 1) + '.xml', sheetXml(sheet)));
  return zip(files);
}


/* ---------- helpers ---------- */

/** Rows → tab-separated text for the server's import parser (tabs/newlines inside cells become spaces). */
export function rowsToTsv(rows) {
  let last = rows.length;
  while (last > 0 && !(rows[last - 1] || []).some((cell) => String(cell ?? '').trim() !== '')) last--;
  return rows.slice(0, last)
    .map((row) => (row || []).map((cell) => String(cell ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t'))
    .join('\n');
}

/** The first sheet that has any non-empty cell (templates keep help sheets after the data sheet). */
export function firstDataSheet(book, preferredName) {
  const named = preferredName && book.sheets.find((sheet) => sheet.name === preferredName);
  if (named) return named;
  return book.sheets.find((sheet) => sheet.rows.some((row) => row.some((cell) => String(cell).trim() !== ''))) || book.sheets[0];
}

/** Save bytes as a download (browser only); type defaults to xlsx (a .zip passes application/zip). */
export function download(bytes, filename, type) {
  const blob = new Blob([bytes], { type: type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
