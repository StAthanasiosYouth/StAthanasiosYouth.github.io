/**
 * MAP CONFIG (public, loaded only when the map or «الاتجاهات» is used)
 *
 * routeUrl: the Worker that answers routes for the map card (worker/src/route.js,
 * POST { fn: 'route', args: [{ profile, from }] }, the contract Route.gs had; since
 * Phase 6 Step 5). The openrouteservice key is the Worker secret ORS_API_KEY,
 * never in this site. Back: Apps Script's /exec. Empty = «الاتجاهات» opens Google
 * Maps in a new tab.
 */

export const MAP_CONFIG = {
  routeUrl: 'https://athanasios-api.menazak-lab.workers.dev/v1/public/route'
};
