/*
 * «خبزنا اليومي» — the saints and church people registry, for the tools. The rules themselves (schema 2, checks,
 * feastsOfMonth, occasionsOfMonth, the published file) live in ONE place shared with the Worker and the admin:
 * worker/src/bread/saints.js. This file adds what needs the disk: reading the files and checking pictures exist.
 *
 * Where the registry is (P3, 2026-11-24):
 *   - daily-bread/saints/registry.json — P2's file: the one-time seed of D1 (worker/migrations/0036), kept as history.
 *   - daily-bread/data/saints.json     — what the admin publishes (D1 → published file → mirror to main). Once it
 *     exists, the monthly suggestion reads it (loadForFeasts), so a day completed and published in the admin
 *     reaches the automatic feasts with no code change and no import.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../../worker/src/bread/saints.js';

export { CLASSES, MISSABLE, MILESTONE_STATUS, OWNER, ALBUM_TYPES, IMG_DIR, missingOf, withStatus, scheduled, isOn, feastsOfMonth, occasionsOfMonth, publicFile, pictureFor, labelOf, checkPerson, checkOccasion } from '../../worker/src/bread/saints.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REGISTRY = path.join(ROOT, 'daily-bread', 'saints', 'registry.json');
export const PUBLISHED = path.join(ROOT, 'daily-bread', 'data', 'saints.json');

export function load(file = REGISTRY) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/* the registry the monthly suggestion uses: the admin's published file if there is one, P2's file otherwise */
export function loadForFeasts({ published = PUBLISHED, seed = REGISTRY } = {}) {
  return fs.existsSync(published) ? load(published) : load(seed);
}

/* the owner's picture folder, if it is on this machine: in the checkout, or in the main checkout of a worktree */
export function picturesDir(reg, root = ROOT) {
  if (!reg || !reg.picturesRoot) return null;
  const tries = [path.join(root, reg.picturesRoot)];
  const m = /^(.*)[\\/]\.claude[\\/]worktrees[\\/][^\\/]+$/.exec(root);
  if (m) tries.push(path.join(m[1], reg.picturesRoot));
  return tries.find(d => fs.existsSync(d)) || null;
}

/* every problem in the registry (empty = fine). With `pictures` (a folder), album files must exist there. */
export function check(reg, { root = ROOT, pictures = null } = {}) {
  return S.check(reg, {
    imageExists: file => fs.existsSync(path.join(root, file)),
    pictureExists: pictures ? src => fs.existsSync(path.join(pictures, src)) : null
  });
}
