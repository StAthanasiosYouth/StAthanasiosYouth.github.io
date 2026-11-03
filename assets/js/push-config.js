/**
 * PUSH CONFIG (public; loaded only with assets/js/push.js)
 *
 * Every value here is public by design: Firebase's web config identifies the
 * project, and the VAPID key is the PUBLIC half of the Web Push key pair (the
 * private half never leaves Firebase). Sending needs the service-account key,
 * which lives only in the Worker secret FCM_SERVICE_ACCOUNT.
 *
 * workerUrl: the device registers here (POST /v1/push/subscribe and
 * /unsubscribe, worker/src/push/devices.js), since the push cutover
 * (docs/PHASE6-PLAN.md Step 4, 2026-11-03). The Apps Script fallback went with
 * its retirement (docs/PHASE7-PLAN.md); '' = no registration.
 */

export const PUSH_CONFIG = {
  workerUrl: 'https://athanasios-api.menazak-lab.workers.dev',
  vapidKey: 'BG1xbtyFFTedzotjPEgX4HEpiuMQ05R1KRCezOGMtjcXsgtdWEemVgamRZnegbztyomypmVL-D74niZLoKduS5Q',
  firebase: {
    apiKey: 'AIzaSyDFT6GqY1RHMn9V9xBStPTQ3fwfHSTdE4Q',
    authDomain: 'athanasios-links.firebaseapp.com',
    projectId: 'athanasios-links',
    storageBucket: 'athanasios-links.firebasestorage.app',
    messagingSenderId: '824621770400',
    appId: '1:824621770400:web:6a10f5219c5796c59a4bc5'
  }
};
