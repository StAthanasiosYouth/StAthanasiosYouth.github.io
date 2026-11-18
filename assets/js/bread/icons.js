/* «خبزنا اليومي» — the section's own icons, drawn in the site's icon language (assets/js/icons.js: 24 px grid,
   1.6 line, round caps, a soft "duo" fill layer). From the approved W1 set (docs/daily-bread/w1/icons-bread.js), unchanged.
   Each value is the inner markup of <svg class="icon icon--line" viewBox="0 0 24 24">. */
export const BREAD_ICONS = {
  // the section: an open book with the sun rising behind it
  bread: '<path class="duo" d="M12 7.6C10 6.2 6.9 5.8 4 6.4v11.2c2.9-.6 6-.2 8 1.2 2-1.4 5.1-1.8 8-1.2V6.4c-2.9-.6-6-.2-8 1.2Z"/><path d="M12 7.6C10 6.2 6.9 5.8 4 6.4v11.2c2.9-.6 6-.2 8 1.2 2-1.4 5.1-1.8 8-1.2V6.4c-2.9-.6-6-.2-8 1.2Zm0 0v11.2"/><path d="M9.5 3.6a3 3 0 0 1 5 0M12 1.6v.9M8.2 2.6l.5.6M15.8 2.6l-.5.6"/>',
  reading: '<path class="duo" d="M4 5.5A1.5 1.5 0 0 1 5.5 4H18v14H5.5A1.5 1.5 0 0 0 4 19.5Z"/><path d="M4 19.5v-14A1.5 1.5 0 0 1 5.5 4H18v14H5.5A1.5 1.5 0 0 0 4 19.5 1.5 1.5 0 0 0 5.5 21H18v-3"/><path d="M8 8h6M8 11h4"/>',
  lantern: '<path class="duo" d="M7.5 8h9l-.8 9.5a1.5 1.5 0 0 1-1.5 1.4H9.8a1.5 1.5 0 0 1-1.5-1.4Z"/><path d="M7.5 8h9l-.8 9.5a1.5 1.5 0 0 1-1.5 1.4H9.8a1.5 1.5 0 0 1-1.5-1.4ZM9 8V6.5A3 3 0 0 1 15 6.5V8M10 21h4M12 11v4.5M10 13.2h4"/>',
  question: '<path class="duo" d="M12 3a8.5 8.5 0 0 0-7.4 12.7L3.5 20.5l4.8-1.1A8.5 8.5 0 1 0 12 3Z"/><path d="M12 3a8.5 8.5 0 0 0-7.4 12.7L3.5 20.5l4.8-1.1A8.5 8.5 0 1 0 12 3Z"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.4M12 16.4v.1"/>',
  pen: '<path class="duo" d="M15.5 4.5 19.5 8.5 9 19l-5 1 1-5Z"/><path d="M15.5 4.5 19.5 8.5 9 19l-5 1 1-5ZM13.5 6.5l4 4"/>',
  lock: '<rect class="duo" x="5" y="10.5" width="14" height="10" rx="2.5"/><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5M12 14.5v2"/>',
  shield: '<path class="duo" d="M12 3 5 5.8v5.5c0 4.4 3 8 7 9.7 4-1.7 7-5.3 7-9.7V5.8Z"/><path d="M12 3 5 5.8v5.5c0 4.4 3 8 7 9.7 4-1.7 7-5.3 7-9.7V5.8Z"/><path d="m9 12 2 2 4-4"/>',
  trash: '<path class="duo" d="M6.5 7h11l-.8 12a2 2 0 0 1-2 1.9H9.3a2 2 0 0 1-2-1.9Z"/><path d="M4.5 7h15M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2M6.5 7l.8 12a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9l.8-12M10 11v6M14 11v6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  home: '<path class="duo" d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-4v-6h-5v6h-4A1.5 1.5 0 0 1 4 19Z"/><path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-4v-6h-5v6h-4A1.5 1.5 0 0 1 4 19Z"/>',
  back: '<path d="m9 6 6 6-6 6"/>',
  sun: '<circle class="duo" cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  moon: '<path class="duo" d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>',
  tashkeel: '<path d="M5 17.5c2.5 1.5 5 1.5 7 0s4.5-1.5 7 0"/><path d="M12 4.5v8"/><path d="m8.5 8 7-2"/><circle cx="17.5" cy="11.5" r="1.2" class="duo"/>',
  remind: '<path class="duo" d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15Z"/><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15ZM10 20.5a2 2 0 0 0 4 0M12 8.5V11l1.6 1.2"/>',
  phone: '<rect class="duo" x="7" y="3" width="10" height="18" rx="2.5"/><rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 18h2"/>',
  upload: '<path class="duo" d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3Z"/><path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3M12 15V4m-4 4 4-4 4 4"/>',
  sheet: '<rect class="duo" x="4" y="3.5" width="16" height="17" rx="2.5"/><rect x="4" y="3.5" width="16" height="17" rx="2.5"/><path d="M4 9h16M4 14.5h16M10 3.5v17"/>',
  chart: '<path class="duo" d="M5 20V12h3v8Zm5.5 0V7h3v13Zm5.5 0v-5h3v5Z"/><path d="M4 20h16M5 20V12h3v8M10.5 20V7h3v13M16 20v-5h3v5"/>',
  heartchat: '<path class="duo" d="M5.5 4h13A2.5 2.5 0 0 1 21 6.5v8a2.5 2.5 0 0 1-2.5 2.5H12l-4.5 3.6V17h-2A2.5 2.5 0 0 1 3 14.5v-8A2.5 2.5 0 0 1 5.5 4Z"/><path d="M5.5 4h13A2.5 2.5 0 0 1 21 6.5v8a2.5 2.5 0 0 1-2.5 2.5H12l-4.5 3.6V17h-2A2.5 2.5 0 0 1 3 14.5v-8A2.5 2.5 0 0 1 5.5 4Z"/><path d="M12 13.5s-2.8-1.7-2.8-3.6a1.4 1.4 0 0 1 2.8-.6 1.4 1.4 0 0 1 2.8.6c0 1.9-2.8 3.6-2.8 3.6Z"/>',
  pause: '<rect class="duo" x="6" y="5" width="4" height="14" rx="1.2"/><rect class="duo" x="14" y="5" width="4" height="14" rx="1.2"/><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/>',
  swap: '<path d="M7 7h12l-3-3M17 17H5l3 3"/>',
  mute: '<path class="duo" d="M6 16.5V11a6 6 0 0 1 9.8-4.6M18 11v5.5l1.5 2h-12"/><path d="M6 16.5V11a6 6 0 0 1 9.8-4.6M18 11v5.5l1.5 2H8M10 20.5a2 2 0 0 0 4 0M4 4l16 16"/>',
  play: '<path class="duo" d="M8 5.5v13l10.5-6.5Z"/><path d="M8 5.5v13l10.5-6.5Z"/>',
  sound: '<path class="duo" d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5Z"/><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5ZM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  // the site's mute (ui-sound.js 'off'), in this set's duo style: the speaker with a cross
  soundOff: '<path class="duo" d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5Z"/><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5ZM16 9.5l5 5M21 9.5l-5 5"/>',
  dots:'<circle cx="5.5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18.5" cy="12" r="1.4"/>'
};
export function bi(name, cls = '') {
  return `<svg class="icon icon--line${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${BREAD_ICONS[name] || ''}</svg>`;
}
