/**
 * The new FCM web API (docs/BACKEND-MIGRATION.md §10 watch item, PHASE6-PLAN Step 4d), shared by
 * assets/js/push.js and admin/push.js. register() makes this browser's Firebase Installation ID (FID)
 * known to FCM and hands it to onRegistered; the FID is what the Worker stores and sends to.
 *
 * Only while the Worker keeps the devices: Apps Script's sender knows the old registration token only.
 * A failure (an old browser, a Firebase API not enabled) falls back to that token, which the Worker takes too.
 */

export const FID = /^[\w-]{22}$/;

/* → this device's FID (register() resolves after onRegistered ran) */
export async function installationId(sdk, messaging, reg, vapidKey) {

  let fid = '';
  const stop = sdk.onRegistered(messaging, value => { fid = String(value || ''); });

  try {
    await sdk.register(messaging, { vapidKey, serviceWorkerRegistration: reg });
  }
  finally {
    stop();
  }

  if (!FID.test(fid)) throw new Error('no installation id');

  return fid;

}

/* the device's id for the server: the FID on the Worker, else (or when that fails) the old token */
export async function deviceId(sdk, messaging, reg, vapidKey, onWorker) {

  if (onWorker) {
    try {
      return await installationId(sdk, messaging, reg, vapidKey);
    }
    catch (error) {
      console.warn(error);
    }
  }

  return sdk.getToken(messaging, { vapidKey, serviceWorkerRegistration: reg });

}

/* off on this device: an FID is unregistered, an old token deleted (getToken first ties it to our worker) */
export async function forget(sdk, messaging, reg, vapidKey, id) {

  if (FID.test(String(id || ''))) {
    await sdk.unregister(messaging);
    return;
  }

  await sdk.getToken(messaging, { vapidKey, serviceWorkerRegistration: reg });
  await sdk.deleteToken(messaging);

}
