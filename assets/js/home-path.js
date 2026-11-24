/**
 * The home page's own path, relative to the site root.
 *
 * In a browser tab the home is the clean address "/" (owner 2026-11-24:
 * "/index.html" looks like a file opened from a computer, not the family's
 * site). The installed site app is scoped to /index.html (its manifest
 * scope), so inside it links keep saying "index.html" and stay in the app.
 */
export function homePath() {
  try {
    const app = navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    return app ? 'index.html' : '';
  } catch {
    return '';
  }
}
