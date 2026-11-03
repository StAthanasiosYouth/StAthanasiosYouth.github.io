/*
 * The panel's settings and tools, off Apps Script (docs/PHASE6-PLAN.md Step 5): the same answers the panel already
 * reads, so its screens don't change. Each replaces one Apps Script call:
 *
 *   POST /v1/admin/tools/github       apiCheckGithub     the repository, the branch's head, can the token write
 *   POST /v1/admin/tools/media        apiCheckMedia      the library's own path now: R2 write/read/delete, D1, the mirror
 *   POST /v1/admin/tools/maps         apiResolveMapsUrl  a Google Maps link → { lat, lng }, following Google's redirects only
 *   POST /v1/admin/tools/fetch-media  apiFetchMediaUrl   a picture or video by its https link → { mime, base64, name, bytes }
 *   POST /v1/admin/tools/live-stage   apiSetLiveStage    the meeting's stage now → live.json on the site (and the panel's copy)
 *   POST /v1/admin/tools/migration    apiPlanMigration   the Sheets' upgrade: finished, the data lives in D1
 *   POST /v1/admin/tools/migrate      apiMigrate         refused, nothing left to upgrade
 */

import { ApiError } from '../lib/http.js';
import { retry } from '../lib/db.js';
import { activityStmt } from '../lib/activity.js';
import { githubConfig, checkAccess, commitFiles } from '../lib/github.js';
import { limit } from '../lib/ratelimit.js';

const refuse = (message, hint = '', code = 'invalid') => new ApiError(code, 'tools', { message, hint });

/* ---------- GitHub ---------- */

export async function adminToolGithub(ctx) {
  const cfg = githubConfig(ctx.env);
  if (cfg.error) throw refuse('النشر على GitHub مش متظبط على الـWorker.', cfg.error, 'disabled');
  let access;
  try {
    access = await checkAccess(cfg, ctx.fetch);
  } catch (err) {
    throw refuse('GitHub رفض الطلب.', 'التوكن يمكن خلص أو صلاحياته اتغيرت. ' + String(err && err.message).slice(0, 120), 'error');
  }
  const res = await ctx.fetch('https://api.github.com/repos/' + cfg.repo, { headers: { authorization: 'Bearer ' + cfg.token, accept: 'application/vnd.github+json', 'user-agent': 'athanasios-api' } });
  const repo = res.ok ? await res.json() : {};
  // checkAccess already wrote a tree, so the token can push
  return { repo: repo.full_name || cfg.repo, branch: cfg.branch, head: String(access.head).slice(0, 7), canPush: true, pages: repo.has_pages === true, expires: access.expires || '' };
}

/* ---------- the media library ---------- */

export async function adminToolMedia(ctx) {
  const env = ctx.env;
  const steps = [];
  const step = async (label, action) => {
    if (steps.length && !steps[steps.length - 1].ok) return;
    try {
      steps.push({ label, ok: true, detail: (await action()) || '' });
    } catch (err) {
      steps.push({ label, ok: false, detail: String(err && err.message).slice(0, 200) });
    }
  };
  const key = 'checks/media-check-' + Date.now().toString(36) + '.txt';
  await step('مخزن الصور (R2) متوصل', async () => {
    if (!env.MEDIA) throw new Error('MEDIA binding missing');
  });
  await step('كتابة ملف تجربة', async () => { await env.MEDIA.put(key, new TextEncoder().encode('check')); });
  await step('قراية الملف', async () => {
    const obj = await env.MEDIA.get(key);
    if (!obj || (await new Response(obj.body).text()) !== 'check') throw new Error('read back differs');
  });
  await step('مسح الملف', async () => { await env.MEDIA.delete(key); });
  await step('مكتبة الصور في قاعدة البيانات', async () => {
    const n = await retry(() => env.DB.prepare('SELECT COUNT(*) AS n FROM media_files').first('n'));
    return n + ' ملف';
  });
  await step('نسخ الصور على الموقع (GitHub)', async () => {
    const cfg = githubConfig(env);
    if (cfg.error) throw new Error(cfg.error);
    await checkAccess(cfg, ctx.fetch);
  });
  return { ok: steps.every(s => s.ok), steps };
}

/* ---------- Google Maps links (Code.gs apiResolveMapsUrl) ---------- */

export function isGoogleMapsUrl(url) {
  const m = /^https:\/\/([^/?#:]+)(?::\d+)?(\/[^?#]*)?/i.exec(url || '');
  if (!m) return false;
  const host = m[1].toLowerCase();
  const path = m[2] || '/';
  if (host === 'maps.app.goo.gl') return true;
  if (host === 'goo.gl') return path.startsWith('/maps');
  if (/^maps\.google\.(com|com\.eg)$/.test(host)) return true;
  return /^(www\.)?google\.(com|com\.eg)$/.test(host) && path.startsWith('/maps');
}

export function coordsFromMapsUrl(url) {
  const place = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(url);
  const at = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(url);
  const query = /[?&](?:q|query|destination)=(-?\d+(?:\.\d+)?)(?:,|%2C)(-?\d+(?:\.\d+)?)/i.exec(url);
  const m = place || query || at;
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

export async function adminToolMaps(ctx) {
  await limit(ctx, 'tools.maps', ctx.actor.email, 30, 60);
  let current = String((ctx.body || {}).url || '').trim();
  if (!isGoogleMapsUrl(current)) throw refuse('ده مش لينك جوجل ماب');
  for (let hop = 0; hop < 5; hop++) {
    const coords = coordsFromMapsUrl(current);
    if (coords) return coords;
    const res = await ctx.fetch(current, { redirect: 'manual' });
    const next = res.headers.get('location') || '';
    // only ever follow redirects that stay on Google Maps
    if (!isGoogleMapsUrl(next)) break;
    current = next;
  }
  throw refuse('مقدرناش نطلع الإحداثيات من اللينك. اكتبها بإيدك.');
}

/* ---------- a picture or a video by its link (Media.gs apiFetchMediaUrl) ---------- */

const PAGE_HOSTS = /(^|\.)(youtube\.com|youtu\.be|tiktok\.com|facebook\.com|fb\.watch|instagram\.com|x\.com|twitter\.com|threads\.net|drive\.google\.com|photos\.google\.com|photos\.app\.goo\.gl)$/i;
const URL_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
const URL_IMAGE_BYTES = 15 * 1024 * 1024;
const URL_VIDEO_BYTES = 8 * 1024 * 1024;
const pageLink = () => refuse('الرابط ده صفحة، مش ملف صورة أو فيديو.',
  'لينكات تيك توك ويوتيوب وفيسبوك وإنستجرام بتفتح صفحة. نزّل الفيديو على جهازك الأول وارفعه من «ارفع صورة أو فيديو»، أو استخدم رابط مباشر للملف نفسه (بيخلص بـ .mp4 أو .jpg مثلاً).');

export function sniffMedia(bytes) {
  const ascii = (from, to) => String.fromCharCode(...bytes.subarray(from, Math.min(to, bytes.length)));
  if (!bytes || bytes.length < 12) return '';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (ascii(0, 4) === 'GIF8') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    if (/^(avif|avis)$/.test(brand)) return 'image/avif';
    if (/^(heic|heix|hevc|hevx|heim|heis|hevm|hevs|mif1|msf1)$/.test(brand)) return 'image/heic';
    return 'video/mp4';
  }
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'video/webm';
  return '';
}

function base64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/* the body, or null once it passes `max` bytes (the rest is not read) */
export async function readCapped(res, max) {
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

export async function adminToolFetchMedia(ctx) {
  await limit(ctx, 'tools.fetch', ctx.actor.email, 20, 60);
  const href = String((ctx.body || {}).url == null ? '' : ctx.body.url).trim();
  const parts = /^https:\/\/([^/?#]+)([^?#]*)/i.exec(href);
  if (!parts || href.length > 2000 || /\s/.test(href)) throw refuse('الرابط لازم يكون كامل ويبدأ بـ https://', 'انسخ رابط الملف نفسه والزقه هنا.');
  const host = parts[1].toLowerCase();
  // no user:password@, no bare addresses or local names
  if (host.includes('@') || !/^[a-z0-9.-]+(:\d{1,5})?$/.test(host) || !host.includes('.') || /^[\d.]+(:\d+)?$/.test(host) || /(^|\.)(localhost|local|internal)(:\d+)?$/.test(host)) {
    throw refuse('الرابط ده مش مقبول.', 'استخدم رابط https عادي لملف صورة أو فيديو.');
  }
  if (PAGE_HOSTS.test(host.replace(/:\d+$/, ''))) throw pageLink();
  let res;
  try {
    res = await ctx.fetch(href, { redirect: 'follow' });
  } catch {
    throw refuse('مقدرناش نوصل للرابط ده.', 'اتأكد إن الرابط شغال وبيفتح الملف نفسه في المتصفح.');
  }
  if (res.status !== 200) throw refuse('الرابط رجّع خطأ (' + res.status + ').', 'اتأكد إن الملف مش خاص أو محتاج تسجيل دخول.');
  const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (/^text\/|html|xml|json/.test(type)) throw pageLink();
  if (type && !/^(image|video)\//.test(type) && !/^(application|binary)\/octet-stream$/.test(type)) {
    throw refuse('الرابط ده مش لصورة أو فيديو.', 'استخدم رابط مباشر لملف صورة (JPG / PNG / WebP) أو فيديو (MP4 / WebM).');
  }
  const declared = Number(res.headers.get('content-length')) || 0;
  if (declared > URL_IMAGE_BYTES) throw refuse('الملف أكبر من 15 MB.', 'نزّله على جهازك وارفعه من هناك.');
  // read up to the largest allowed size, never more: a host that sends no length can't fill the Worker's memory
  const bytes = await readCapped(res, URL_IMAGE_BYTES);
  if (!bytes) throw refuse('الملف أكبر من 15 MB.', 'نزّله على جهازك وارفعه من هناك.');
  const mime = sniffMedia(bytes);
  if (mime.startsWith('video/')) {
    if (bytes.length > URL_VIDEO_BYTES) throw refuse('الفيديو أكبر من 8 MB.', 'قصّ الجزء اللي عايزه بس وارفعه من جهازك.');
  } else if (URL_IMAGE_MIMES.includes(mime)) {
    if (bytes.length > URL_IMAGE_BYTES) throw refuse('الصورة أكبر من 15 MB.', 'نزّلها على جهازك وارفعها من هناك.');
  } else {
    throw refuse(type.startsWith('video/') ? 'نوع الفيديو ده مش مدعوم.' : 'الملف ده مش صورة أو فيديو نقدر نستخدمه.', 'الصور: JPG أو PNG أو WebP. الفيديو: MP4 أو WebM.');
  }
  let file = parts[2].split('/').pop() || '';
  try { file = decodeURIComponent(file); } catch { /* as it is */ }
  const name = file.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[\u0000-\u001f]/g, '').slice(0, 80);
  return { mime, base64: base64(bytes), name, bytes: bytes.length };
}

/* ---------- the meeting's live stage (Publish.gs apiSetLiveStage) ---------- */

const PROGRAM_STAGES = 20;   // Hub.gs PROGRAM_LIMITS.stages
export const LIVE_FILE = 'live.json';

export async function adminToolLiveStage(ctx) {
  const db = ctx.env.DB;
  const body = ctx.body || {};
  const day = String(body.date || '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day + 'T00:00:00Z'))) throw refuse('تاريخ الاجتماع مش صحيح.', 'اعمل Refresh للصفحة.');
  const stage = body.stage === null || body.stage === undefined || body.stage === '' ? null : Number(body.stage);
  if (stage !== null && !(Number.isInteger(stage) && stage >= 0 && stage < PROGRAM_STAGES)) throw refuse('الفقرة دي مش موجودة في برنامج الاجتماع.', 'اعمل Refresh للصفحة.');
  if (stage !== null) {
    const rows = (await retry(() => db.prepare("SELECT data FROM draft_rows WHERE kind = 'sessions' AND deleted_ms IS NULL AND substr(json_extract(data, '$.date'), 1, 10) = ?").bind(day).all())).results;
    let stages = 0;
    for (const r of rows) {
      let program = [];
      try { const d = JSON.parse(r.data); program = typeof d.program === 'string' ? JSON.parse(d.program || '[]') : d.program || []; } catch { program = []; }
      stages = Math.max(stages, Array.isArray(program) ? Math.min(program.length, PROGRAM_STAGES) : 0);
    }
    if (!rows.length || stage >= stages) throw refuse('الفقرة دي مش موجودة في برنامج الاجتماع.', 'افتح الاجتماع وراجع برنامجه، وانشر لو لسه ما اتنشرش.');
  }
  const cfg = githubConfig(ctx.env);
  if (cfg.error) throw refuse('النشر على GitHub مش متظبط على الـWorker.', cfg.error, 'disabled');
  const live = { schema: 1, date: day, stage, updatedAt: new Date().toISOString() };
  // only this one file changes; two quick taps land in order and the last one wins (commitFiles retries a moved ref)
  const commit = await commitFiles(cfg, { [LIVE_FILE]: JSON.stringify(live, null, 2) + '\n' }, 'Live stage ' + day + ': ' + (stage === null ? 'automatic' : 'stage ' + (stage + 1)), ctx.fetch);
  const now = Date.now();
  await retry(() => db.batch([
    db.prepare("INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('LIVE_STATE', ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by").bind(JSON.stringify(live), now, ctx.actor.email),
    activityStmt(db, { at: now, actor: ctx.actor.email, actorName: ctx.actor.name, action: 'live.stage', entityType: 'sessions', entityId: day, entityTitle: day, ref: commit.sha.slice(0, 7), summary: 'الفقرة الحالية: ' + (stage === null ? 'تلقائي' : stage + 1) })
  ]));
  return { live, commit: commit.sha };
}

/* ---------- the Sheets' upgrade (Migrate.gs): the data lives in D1 now ---------- */

export async function adminToolMigration() {
  return { pending: false, backups: [], steps: [{ label: 'البيانات على قاعدة البيانات الجديدة', needed: false, detail: 'مفيش ترقية للشيتات تاني: المحتوى والمسابقات والحسابات اتنقلوا.' }] };
}

export async function adminToolMigrate() {
  throw refuse('مفيش ترقية مطلوبة.', 'البيانات اتنقلت لقاعدة البيانات الجديدة.', 'final');
}

/* ---------- the admins list (Auth.gs apiAdmins / adminList_): D1 owns the admins since Phase 1.5 ---------- */

export const MAX_ADMINS = 20;   // Auth.gs MAX_ADMINS

export async function adminToolAdmins(ctx) {
  const rows = (await retry(() => ctx.env.DB.prepare('SELECT email, name, role FROM admins WHERE active = 1 ORDER BY email').all())).results;
  const names = {};
  const stored = {};
  for (const a of rows) {
    names[a.email] = a.name || a.email.split('@')[0];
    if (a.name) stored[a.email] = a.name;
  }
  const primary = rows.find(a => a.role === 'primary');
  return { emails: rows.map(a => a.email), names, stored, primary: primary ? primary.email : '', me: ctx.actor.email, max: MAX_ADMINS };
}
