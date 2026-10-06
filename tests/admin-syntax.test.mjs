// Every <script> in the admin .html files parses. A broken admin script
// would only show up in the browser otherwise.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { ROOT } from '../tools/lib/gs.mjs';

test('admin scripts parse', () => {
  const files = readdirSync(`${ROOT}apps-script`).filter(f => f.endsWith('.html'));
  let checked = 0;
  for (const file of files) {
    const html = readFileSync(`${ROOT}apps-script/${file}`, 'utf8');
    for (const [, code] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      // Apps Script template tags are not JavaScript
      const js = code.replace(/<\?!?=[\s\S]*?\?>/g, 'null');
      assert.doesNotThrow(() => new Function(js), `${file}`);
      checked++;
    }
  }
  assert.ok(checked >= 5, `${checked} scripts`);
});
