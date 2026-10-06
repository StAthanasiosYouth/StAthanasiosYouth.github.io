/**
 * PLATFORMS: the one list of link "experiences" (the short scene a link
 * opens before the real page). Single source of truth for:
 *   - the site (xp.js picks the scene renderer),
 *   - the publisher (apps-script/Platforms.gs, generated from this file by
 *     tools/sync-admin.mjs: never edit that copy by hand),
 *   - the admin (the «التجربة قبل اللينك» choices).
 *
 * Each entry:
 *   scene   the renderer: assets/js/xp/<scene>.js. Several platforms share a
 *           scene family (chat, feed, player…) with their own skin; a
 *           bespoke renderer can replace a family later without any change
 *           to stored content.
 *   icon    the link icon that implies this platform («تلقائي»)
 *   hosts   URL hosts (no "www.") that imply it; "host/path" matches a path
 *           prefix
 *   accent  the brand colour (generic skins, the CTA)
 *   label   Arabic name; cta: button text; line/sub: the scene's words
 *
 * Adding a platform = one entry here (+ its icon). Unknown keys still work:
 * the site shows the generic branded scene (scene "browser").
 *
 * Keep resolveExperience / experienceKey free of modern syntax: their source
 * is copied into Apps Script.
 */

export const SCENES = ['voice', 'facebook', 'instagram', 'tiktok', 'whatsapp', 'feed', 'stories', 'vertical', 'chat', 'player', 'music', 'map', 'call', 'mail', 'browser'];

export const PLATFORMS = {
  voice: {
    scene: 'voice', icon: 'voice', hosts: ['stathanasiosyouth.github.io/your-voice-matters'], accent: '#d7aa50',
    label: 'صوتك يهمنا', cta: 'ابعت صوتك',
    line: 'صوتك مسموع، ومهم', sub: 'قول رأيك، اطلب حد يكلمك، أو اطلب صلاة… إحنا سامعينك.'
  },
  facebook: {
    scene: 'facebook', icon: 'facebook', hosts: ['facebook.com', 'fb.com', 'fb.me', 'fb.watch'], accent: '#1877f2',
    label: 'فيسبوك', cta: 'افتح صفحتنا على فيسبوك',
    line: 'هنا هتتابع أخبارنا وإعلاناتنا', sub: 'البوسترات والمواعيد وصور كل اجتماع، أول بأول.'
  },
  instagram: {
    scene: 'instagram', icon: 'instagram', hosts: ['instagram.com', 'instagr.am'], accent: '#e1306c',
    label: 'إنستجرام', cta: 'افتح إنستجرام',
    line: 'صور وستوريز من كل اجتماع', sub: 'لحظاتنا الحلوة، أول بأول.'
  },
  tiktok: {
    scene: 'tiktok', icon: 'tiktok', hosts: ['tiktok.com'], accent: '#fe2c55',
    label: 'تيك توك', cta: 'افتح تيك توك',
    line: 'فيديوهات قصيرة ولحظات من الخدمة', sub: 'فيديوهات قصيرة'
  },
  whatsapp: {
    scene: 'whatsapp', icon: 'whatsapp', hosts: ['chat.whatsapp.com', 'wa.me', 'whatsapp.com'], accent: '#25d366',
    label: 'واتساب', cta: 'انضم لجروب الواتساب',
    line: 'أخبارنا توصلك على موبايلك', sub: 'المواعيد والتنبيهات أول بأول.'
  },
  telegram: {
    scene: 'chat', icon: 'telegram', hosts: ['t.me', 'telegram.me', 'telegram.org'], accent: '#229ed9',
    label: 'تيليجرام', cta: 'افتح تيليجرام',
    line: 'رسايلنا توصلك أول بأول', sub: 'القناة فيها كل الجديد.'
  },
  messenger: {
    scene: 'chat', icon: 'messenger', hosts: ['m.me', 'messenger.com'], accent: '#0084ff',
    label: 'ماسنجر', cta: 'افتح ماسنجر',
    line: 'كلمنا على ماسنجر', sub: 'هنرد عليك في أقرب وقت.'
  },
  discord: {
    scene: 'chat', icon: 'discord', hosts: ['discord.gg', 'discord.com'], accent: '#5865f2',
    label: 'ديسكورد', cta: 'ادخل السيرفر',
    line: 'مكان نتكلم فيه كلنا', sub: 'قنوات للأسئلة والأنشطة.'
  },
  youtube: {
    scene: 'player', icon: 'youtube', hosts: ['youtube.com', 'youtu.be'], accent: '#ff0033',
    label: 'يوتيوب', cta: 'افتح يوتيوب',
    line: 'العظات والترانيم والفيديوهات', sub: 'اتفرج في أي وقت.'
  },
  spotify: {
    scene: 'music', icon: 'spotify', hosts: ['open.spotify.com', 'spotify.com', 'spotify.link'], accent: '#1db954',
    label: 'سبوتيفاي', cta: 'اسمع على سبوتيفاي',
    line: 'ترانيم وبودكاست', sub: 'اسمع في أي وقت.'
  },
  x: {
    scene: 'feed', icon: 'x', hosts: ['x.com', 'twitter.com'], accent: '#e7e9ea',
    label: 'إكس', cta: 'افتح إكس',
    line: 'تحديثات سريعة', sub: 'كل الجديد في سطور.'
  },
  threads: {
    scene: 'feed', icon: 'threads', hosts: ['threads.net', 'threads.com'], accent: '#f5f5f5',
    label: 'ثريدز', cta: 'افتح ثريدز',
    line: 'كلام وتحديثات', sub: 'تابعنا على ثريدز.'
  },
  snapchat: {
    scene: 'vertical', icon: 'snapchat', hosts: ['snapchat.com'], accent: '#fffc00',
    label: 'سناب شات', cta: 'افتح سناب شات',
    line: 'لحظات سريعة', sub: 'تابعنا على سناب.'
  },
  maps: {
    scene: 'map', icon: 'map', hosts: ['maps.app.goo.gl', 'google.com/maps', 'maps.google.com', 'goo.gl/maps'], accent: '#34a853',
    label: 'الخريطة', cta: 'افتح الخريطة',
    line: 'الطريق لحد عندنا', sub: 'افتح الخريطة وامشي ورا السهم.'
  },
  phone: {
    scene: 'call', icon: 'phone', hosts: [], accent: '#5ad7a0',
    label: 'اتصال', cta: 'افتح',
    line: 'إحنا على بعد مكالمة', sub: 'كلمنا في أي وقت.'
  },
  email: {
    scene: 'mail', icon: 'mail', hosts: [], accent: '#f2d28b',
    label: 'إيميل', cta: 'افتح',
    line: 'ابعتلنا رسالة', sub: 'هنرد عليك في أقرب وقت.'
  },
  web: {
    scene: 'browser', icon: '', hosts: [], accent: '#d7aa50',
    label: 'موقع', cta: 'افتح الموقع',
    line: '', sub: ''
  }
};

/* the key a stored value may hold (also keeps unknown future keys safe) */
export function experienceKey(value) {

  var key = String(value == null ? '' : value).trim().toLowerCase();
  return /^[a-z][a-z0-9-]{0,23}$/.test(key) ? key : '';

}

/**
 * Which experience a link opens, in this order:
 *   1. the admin's explicit choice («none» = straight to the link)
 *   2. the link's icon
 *   3. the URL's host
 *   4. nothing: a plain website opens directly (the generic scene "web" is
 *      only used when chosen)
 * Returns a key ('' = no scene). An explicit key this list doesn't know yet
 * is kept: the site falls back to the generic branded scene.
 */
export function resolveExperience(link, platforms) {

  platforms = platforms || PLATFORMS;
  link = link || {};

  var chosen = experienceKey(link.experience);

  if (chosen === 'none') return '';
  if (chosen === 'auto') chosen = '';
  if (chosen) return chosen;

  var keys = Object.keys(platforms);
  var icon = String(link.icon || '').toLowerCase();
  var i;

  if (icon && icon !== 'link') {
    for (i = 0; i < keys.length; i++) {
      if (platforms[keys[i]].icon === icon) return keys[i];
    }
  }

  var match = /^https:\/\/([^/?#]+)([^?#]*)/i.exec(String(link.url || ''));

  if (!match) return '';

  var host = match[1].toLowerCase().replace(/^www\./, '').replace(/:\d+$/, '');
  var where = host + match[2].toLowerCase();

  for (i = 0; i < keys.length; i++) {
    var hosts = platforms[keys[i]].hosts || [];
    for (var j = 0; j < hosts.length; j++) {
      var pattern = hosts[j].toLowerCase();
      if (pattern.indexOf('/') !== -1
        ? where === pattern || where.indexOf(pattern + '/') === 0
        : host === pattern || host.slice(-(pattern.length + 1)) === '.' + pattern) {
        return keys[i];
      }
    }
  }

  return '';

}

/* the platform entry for a key; unknown keys get a generic one */
export function platformOf(key) {

  return PLATFORMS[key] || { ...PLATFORMS.web, label: '', scene: 'browser' };

}
