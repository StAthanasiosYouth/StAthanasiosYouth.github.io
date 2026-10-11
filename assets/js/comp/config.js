/**
 * COMPETITION CONFIG (public)
 *
 * The Apps Script API deployment has ONE source of truth in the site:
 * push-config.js apiUrl (also admin/config.js apiUrl and map-config.js
 * routeUrl point at the same /exec).
 * The competition engine calls only the public comp* actions there (§5).
 */

import { PUSH_CONFIG } from '../push-config.js';

export const COMP_CONFIG = Object.freeze({
  apiUrl: PUSH_CONFIG.apiUrl,
  storagePrefix: 'athanasios.comp.v1:'
});
