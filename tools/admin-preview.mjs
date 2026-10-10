// Local preview of the admin panel with the real .gs code running against an
// in-memory Sheet and a fake GitHub (tests/fakes/gas.mjs). Nothing here
// touches Google or GitHub.
//
// Usage: node tools/admin-preview.mjs [port]   → http://localhost:4322/

import { generateKeyPairSync } from 'node:crypto';
import { createWorld } from '../tests/fakes/gas.mjs';
import { createAdminServer } from './lib/admin-server.mjs';

const PORT = Number(process.argv[2] || 4322);
const ADMIN = 'menazakmena@gmail.com';

const world = createWorld();
world.as(ADMIN).gs.setup();
world.properties.set('GITHUB_TOKEN', 'test-token');
world.properties.set('GITHUB_REPO', 'StAthanasiosYouth/StAthanasiosYouth.github.io');
world.properties.set('SITE_URL', 'https://stathanasiosyouth.github.io/');

// sample content-center data, timed relative to now (Cairo)
{
  const gs = world.gs;
  const now = gs.cairoNow_().replace('T', ' ');
  const plusDays = days => gs.storedOf_(gs.wallAdd_(gs.cairoNow_(), days * 1440)).slice(0, 10);
  const sunday = (() => { for (let d = 0; d < 8; d++) { const date = plusDays(d); if (new Date(date + 'T12:00Z').getUTCDay() === 0 && d > 0) return date; } return plusDays(7); })();
  gs.apiSaveItem('sessions', { date: sunday, topic: 'حياة التسليم', speaker: 'أبونا أنطوني عياد', visibleFrom: now, notify: { topic: true } });
  gs.apiSaveItem('news', { title: 'رحلة الغردقة', summary: 'سجّل اسمك قبل الخميس', linkUrl: 'https://forms.gle/example', badge: 'جديد', featured: true, notify: { publish: true } });
  gs.apiSaveItem('games', { title: 'رحلة الاستكشاف في الكنيسة', url: 'https://example.org/explore', visibleFrom: sunday + ' 21:00', startAt: sunday + ' 22:00', endAt: sunday + ' 23:30', notify: { soon: true, start: true } });
  gs.apiSaveItem('notifications', { title: 'بوستر المؤتمر نزل', type: 'important', target: 'https://example.org/poster' });
}

// push (Push.gs): a throwaway service account for the fake FCM, and a few
// subscribed devices (one gone for good, to show the cleanup). The site
// "live" for the push list is the fake GitHub's content.json after «نشر».
{
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  world.properties.set('FCM_SERVICE_ACCOUNT', JSON.stringify({
    project_id: 'athanasios-links',
    client_email: 'push-sender@athanasios-links.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' })
  }));
  ['android', 'android', 'ios', 'desktop'].forEach((platform, i) => {
    const token = `demo${i}Xk2:APA91b${'Q'.repeat(140)}${i}`;
    world.fcm.devices.set(token, i === 3 ? 'unregistered' : 'ok');
    world.gs.publicPush_('pushSubscribe', { token, platform });
  });
}

createAdminServer({ world, admin: ADMIN }).listen(PORT, '127.0.0.1', () => console.log(`admin preview: http://localhost:${PORT}/`));
