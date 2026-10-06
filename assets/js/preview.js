/**
 * PREVIEW (the admin's «معاينة»). Loaded only on a page marked
 * <html data-preview>, which only the admin builds (in a frame of its own
 * origin, never this site's). Visitors never download this file.
 *
 * The admin hands the draft over by postMessage. Only that parent, on the
 * same origin, is listened to; the draft goes through the same sanitizer
 * as content.json. Nothing is fetched, cached or published from here.
 */

import { sanitizeContent } from './content.js';
import { cairoInstant, setClockOffset } from './schedule.js';

/** show(content): renders a draft on the page. */
export function listen(show) {

  const reply = message => window.parent.postMessage(message, self.origin);

  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== self.origin) return;
    const data = event.data;
    if (!data || data.type !== 'athanasios:preview') return;

    let content;
    try {
      content = sanitizeContent(data.content);
    }
    catch (error) {
      reply({ type: 'athanasios:preview-error', message: String(error.message) });
      return;
    }

    // images not on the site yet: the admin's own previews (blob: URLs of
    // this same origin only), swapped in after the sanitizer
    const images = data.images && typeof data.images === 'object' ? data.images : {};
    const prefix = `blob:${self.origin}/`;
    (function swap(node) {
      if (!node || typeof node !== 'object') return;
      for (const key of Object.keys(node)) {
        const value = node[key];
        if ((key === 'src' || key === 'thumb') && typeof value === 'string' && typeof images[value] === 'string' && images[value].startsWith(prefix)) node[key] = images[value];
        else if (typeof value === 'object') swap(value);
      }
    })(content);

    // time travel: the page as of that Cairo moment, then the clock runs on
    const at = typeof data.at === 'string' ? cairoInstant(data.at) : null;
    setClockOffset(at === null ? 0 : at - Date.now());

    show(content);
    reply({ type: 'athanasios:preview-shown', revision: content.revision || '' });
  });

  reply({ type: 'athanasios:preview-ready' });

}
