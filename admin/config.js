/*
 * THE ADMIN PAGE'S SETTINGS — the one place to change them.
 * Everything here is public on purpose (it is a website file). No secret
 * ever goes here: who may edit is decided by the server (Google sign-in +
 * the allowlist), and the GitHub token stays in Script Properties.
 *
 * apiUrl      The Apps Script API deployment's Web app URL (…/exec):
 *             Execute as "Me", Who has access "Anyone".
 *             (docs/ADMIN-SETUP.md, "The official admin page", step 3)
 * clientId    The OAuth 2.0 Client ID (type "Web application") that Google
 *             Sign-In uses on this page: …apps.googleusercontent.com.
 *             The same value goes in the Script Property ADMIN_CLIENT_ID.
 *             (docs/ADMIN-SETUP.md, step 1)
 * fallbackUrl The recovery admin (the Apps Script admin, unchanged). Shown as
 *             a small link; never opened by itself.
 *
 * While apiUrl or clientId is empty, the page says it isn't set up yet and
 * offers the recovery admin. It never redirects.
 */

window.ADMIN_CONFIG = Object.freeze({
  apiUrl: 'https://script.google.com/macros/s/AKfycbxJjDyktRi6VlwRGSrF-H_KzN-vkw9QaFCiLD1TlqgrppKs4CHfmOBE4cKEd6AZ9Km1/exec',
  clientId: '246924773718-38p45gji0ouvi7an4jdjsip3obmk6ve4.apps.googleusercontent.com',
  fallbackUrl: 'https://script.google.com/macros/s/AKfycbwhHMp54vLJLK5UuwH_7zByzkPRkQErcUQdvZ1ad2_AxpasNWzShoh1CT3AIOrB8Rtbvw/exec'
});
