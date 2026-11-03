/*
 * THE ADMIN PAGE'S SETTINGS — the one place to change them.
 * Everything here is public on purpose (it is a website file). No secret
 * ever goes here: who may edit is decided by the server (Google sign-in +
 * the allowlist), and the GitHub token stays in Script Properties.
 *
 * apiUrl      (removed in Phase 7, docs/PHASE7-PLAN.md) The Apps Script API
 *             deployment's /exec URL. Apps Script is retired: the Worker is the
 *             panel's only server. Adding it back is part of a rollback only.
 * clientId    The OAuth 2.0 Client ID (type "Web application") that Google
 *             Sign-In uses on this page: …apps.googleusercontent.com.
 *             The same value goes in the Script Property ADMIN_CLIENT_ID.
 *             (docs/ADMIN-SETUP.md, step 1)
 * fallbackUrl (optional) The recovery admin (the Apps Script admin). Removed
 *             2026-11-03: Apps Script is being retired, so the page offers no
 *             link to it. Adding it back shows the small link again.
 *
 * workerUrl   The new backend (Cloudflare Worker, worker/README.md). Today the
 *             page checks the same Google sign-in against it, quietly
 *             (boot.js checkWorker), and «الحجوزات» talks to it (boot.js
 *             AdminWorker, apps-script/AdminBook.html) — shown only while
 *             the Worker says the booking module is on. '' = off.
 *
 * platform    'worker' (Phase 3, docs/ADMIN-PLATFORM-PLAN.md): the panel's session,
 *             presence, edit locks and trusted device are the Worker's; Apps
 *             Script takes the Worker's panel token. Absent = the Apps Script
 *             sessions (the rollback: remove this line).
 * content     'worker' (Phase 6 Step 5): the first guess of who keeps the content
 *             until the Worker's own answer says (it is remembered after that).
 *             With 'worker' the page asks Apps Script nothing at all: no
 *             warm-up, no early state. A rollback needs no edit here: the
 *             first answer that says 'sheets' brings both back.
 *
 * While clientId is empty, or neither apiUrl nor workerUrl + platform is set,
 * the page says it isn't set up yet. It never redirects.
 */

window.ADMIN_CONFIG = Object.freeze({
  clientId: '246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com',
  workerUrl: 'https://athanasios-api.menazak-lab.workers.dev',
  platform: 'worker',
  content: 'worker'
});
