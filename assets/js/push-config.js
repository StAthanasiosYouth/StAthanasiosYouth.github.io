/**
 * PUSH CONFIG (public; loaded only with assets/js/push.js)
 *
 * Every value here is public by design: Firebase's web config identifies the
 * project, and the VAPID key is the PUBLIC half of the Web Push key pair (the
 * private half never leaves Firebase). Sending needs the service-account key,
 * which lives only in the Apps Script Script Property FCM_SERVICE_ACCOUNT.
 *
 * apiUrl: the Apps Script API deployment (the same /exec as admin/config.js
 * apiUrl and map-config.js routeUrl); the page only calls its two narrow
 * public actions, pushSubscribe and pushUnsubscribe (apps-script/Push.gs).
 */

export const PUSH_CONFIG = {
  apiUrl: 'https://script.google.com/macros/s/AKfycbxJjDyktRi6VlwRGSrF-H_KzN-vkw9QaFCiLD1TlqgrppKs4CHfmOBE4cKEd6AZ9Km1/exec',
  vapidKey: 'BG1xbtyFFTedzotjPEgX4HEpiuMQ05R1KRCezOGMtjcXsgtdWEemVgamRZnegbztyomvpmVL-D74niZLoKduS5Q',
  firebase: {
    apiKey: 'AIzaSyDFT6GqY1RHMn9V9xBStPTQ3fwfHSTdE4Q',
    authDomain: 'athanasios-links.firebaseapp.com',
    projectId: 'athanasios-links',
    storageBucket: 'athanasios-links.firebasestorage.app',
    messagingSenderId: '824621770400',
    appId: '1:824621770400:web:6a10f5219c5796c59a4bc5'
  }
};
