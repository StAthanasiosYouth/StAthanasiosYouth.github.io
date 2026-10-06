// Loads Apps Script .gs files into a Node VM context so tools and tests run
// the exact code that runs in production. Only pure files belong here
// (no SpreadsheetApp etc.); pass mocks in `globals` for anything else.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export function loadGs(files = ['Content.gs', 'Hub.gs', 'Seed.gs'], globals = {}) {

  const context = vm.createContext({ ...globals });

  for (const file of files) {
    const code = readFileSync(`${ROOT}apps-script/${file}`, 'utf8');
    vm.runInContext(code, context, { filename: file });
  }

  return context;

}

export const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');

export { ROOT };
