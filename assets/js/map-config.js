/**
 * MAP CONFIG (public, loaded only when the map or «الاتجاهات» is used)
 *
 * routeUrl: the Apps Script web app that answers routes for the map card
 * (apps-script/Route.gs, POST { fn: 'route', args: [{ profile, from }] }).
 * The openrouteservice key lives there, in the Script Property ORS_API_KEY,
 * never in this site. Empty = «الاتجاهات» opens Google Maps in a new tab.
 */

export const MAP_CONFIG = {
  routeUrl: 'https://script.google.com/macros/s/AKfycbxJjDyktRi6VlwRGSrF-H_KzN-vkw9QaFCiLD1TlqgrppKs4CHfmOBE4cKEd6AZ9Km1/exec'
};
