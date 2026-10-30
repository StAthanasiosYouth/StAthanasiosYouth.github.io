/*
 * Email templates — the «Azure Crest» design: one branded layout for every
 * automatic email of the service, Arabic RTL, HTML + an equivalent plain text.
 * Two audiences:
 *
 *   admin    the panel's servants (active now): notifications, critical alerts,
 *            booking notices, the daily summary. One link, to the panel.
 *   member   youth accounts (Phase 5A, NOT sent by anything yet): verification
 *            codes, password recovery, security notices, booking notices.
 *            Never an admin link; a code email has no service link at all.
 *
 * What every email keeps to (Gmail sender guidelines; plain, honest mail):
 * - the sender's name (BRAND) in the From header, the header and the footer,
 *   and why the reader gets it;
 * - one action link at most (its address shown as text too), plus the fixed
 *   footer links: technical support (WhatsApp, email), the privacy policy, and
 *   the social accounts in member booking notices only; no tracking pixels,
 *   hidden text, scripts or shorteners;
 * - images only from the service site (assets/email/, tools/build-mail-assets.mjs),
 *   each with its size and alt text; every one is decoration: with images off
 *   (or Outlook) the email reads the same on solid colours;
 * - email-safe HTML: tables, inline styles, solid colours under every
 *   gradient, a VML header for Outlook, the <style> block only adds the
 *   phone layout;
 * - subjects made from the event itself (fill() refuses a missing value: no
 *   «{ref}» ever goes out), descriptive, without urgency words;
 * - admin emails: no visitor names, phones, payment numbers or amounts.
 */

export const BRAND = 'أسرة البابا أثناسيوس الرسولي لشباب سفاجا';
export const SERVICE = 'كنيسة أبي سيفين – سفاجا';
// technical support: the owner's own contacts (the service inbox is not read for support)
export const SUPPORT = 'الدعم الفني: مينا زكريا – 01276162016';
export const SUPPORT_NAME = SUPPORT.split(':')[1].split('–')[0].trim();
export const SUPPORT_PHONE = '01276162016';
export const SUPPORT_WHATSAPP = 'https://wa.me/201276162016';
export const SUPPORT_EMAIL = 'menazakmena@gmail.com';
export const SITE = 'https://stathanasiosyouth.github.io';
export const PRIVACY = SITE + '/privacy/';
const ACCOUNT = SITE + '/account/';
const PREFS_URL = ACCOUNT + '#me/notifications';
export const SOCIAL = Object.freeze([
  { name: 'فيسبوك', icon: 'facebook', url: 'https://www.facebook.com/Pope.Athanasius.The.Apostolic.Safaga' },
  { name: 'إنستجرام', icon: 'instagram', url: 'https://www.instagram.com/pope.athanasiustheapostolic/' },
  { name: 'تيك توك', icon: 'tiktok', url: 'https://www.tiktok.com/@stathanasios.safaga' },
  { name: 'موقع الخدمة', icon: 'website', url: SITE + '/' }
]);
const IMG = SITE + '/assets/email/';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const digits = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
const money = n => digits(Math.round(Number(n) || 0)) + ' ج.م';

/* Cairo wall-clock text ('2026-10-20 21:12') → «الثلاثاء ٢٠ أكتوبر · ٩:١٢ م»; anything else stays as it is */
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
function cairoParts(c) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(c || ''));
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  return { y, mo, d, dow: new Date(Date.UTC(y, mo - 1, d)).getUTCDay(), h: m[4] == null ? null : +m[4], mi: m[5] };
}
export function dayText(c, { year = false } = {}) {
  const p = cairoParts(c);
  return p ? DAYS[p.dow] + ' ' + digits(p.d) + ' ' + MONTHS[p.mo - 1] + (year ? ' ' + digits(p.y) : '') : String(c || '');
}
export function clockText(c) {
  const p = cairoParts(c);
  if (!p || p.h == null) return '';
  return digits((p.h % 12 || 12) + ':' + p.mi) + (p.h < 12 ? ' ص' : ' م');
}
export const whenText = c => { const t = clockText(c); return t ? dayText(c) + ' · ' + t : dayText(c); };

/*
 * '{name}' placeholders; '[ – {event}]' is an optional part, dropped when a
 * value inside it is missing. A missing value outside [] throws: a template
 * never leaves with a placeholder or an empty slot in it.
 */
export function fill(template, data) {
  const has = k => data[k] !== undefined && data[k] !== null && String(data[k]).trim() !== '';
  const out = template
    .replace(/\[([^\]]*)\]/g, (_, part) => ((part.match(/\{(\w+)\}/g) || []).every(m => has(m.slice(1, -1))) ? part : ''))
    .replace(/\{(\w+)\}/g, (_, k) => { if (!has(k)) throw new Error('template value missing: ' + k); return clip(data[k], 80); });
  return out.replace(/\s+/g, ' ').trim();
}

const WHY = {
  admin: 'وصلك الإيميل ده لأنك من خدام لوحة التحكم في الخدمة. تقدر تختار اللي يوصلك من «تنبيهاتي» في لوحة التحكم.',
  code: 'وصلك الإيميل ده لأن حد طلب كود بالإيميل ده على موقع الخدمة. لو مش انت، تجاهله ومش هيحصل حاجة.',
  security: 'وصلك الإيميل ده علشان تعرف بأي تغيير مهم في حسابك على موقع الخدمة.',
  booking: 'وصلك الإيميل ده لأنك عامل حجز على موقع الخدمة.'
};

/* ---------------- the HTML building blocks (email-safe: tables + inline styles) ---------------- */

const FONT = "'Cairo','Segoe UI',Tahoma,Arial,sans-serif";
const MONO = "'Segoe UI',Arial,sans-serif";
const C = { navy: '#0A2559', royal: '#1259C3', ink: '#0F2340', slate: '#4E6488', mist: '#F4F9FF', line: '#D9E8F7', page: '#E3EBF5', canvas: '#F1F7FE' };
const T = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';
const ltr = s => '<span dir="ltr">' + esc(s) + '</span>';
const img = (name, w, h, alt, style = '') => `<img src="${IMG + name}" width="${w}" height="${h}" alt="${esc(alt)}" style="display:block;border:0;outline:none;${style}">`;
const gut = inner => `<tr><td class="gut" bgcolor="${C.canvas}" style="background-color:${C.canvas};padding:0 14px">${inner}</td></tr>`;

function head(title) {
  return '<!doctype html>\n<html lang="ar" dir="rtl" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><head>' +
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light">' +
    '<meta name="supported-color-schemes" content="light"><meta name="x-apple-disable-message-reformatting"><title>' + esc(title) + '</title>' +
    '<style>body{margin:0;padding:0;-webkit-text-size-adjust:100%}a{text-decoration:none}' +
    '@media (max-width:480px){.wrap{padding:10px 4px!important}.gut{padding-left:8px!important;padding-right:8px!important}' +
    '.card{padding-left:18px!important;padding-right:18px!important}.tile{width:34px!important;font-size:25px!important}.h1{font-size:19px!important}}</style>' +
    '<!--[if mso]><style>body,table,td,a,span,div,p{font-family:Tahoma,Arial,sans-serif!important}</style><![endif]--></head>';
}

/* the header: the artwork (solid navy without images), the logo, the names, the kicker; then the card's top edge */
function header(kicker, cap) {
  const bg = IMG + 'header.jpg';
  return `<tr><td align="center" bgcolor="#0D3F98" background="${bg}" style="background-color:#0D3F98;background-image:url('${bg}');background-position:center bottom;background-size:600px auto;background-repeat:no-repeat;border-radius:20px 20px 0 0;padding:26px 0 0">` +
    `<!--[if gte mso 9]><v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:600px;mso-fit-shape-to-text:true"><v:fill type="frame" src="${bg}" color="#0D3F98"/><v:textbox inset="0,0,0,0"><![endif]-->` +
    `<table ${T} align="center"><tr><td align="center">${img('logo.png', 74, 74, 'شعار ' + BRAND, 'margin:0 auto')}</td></tr></table>` +
    `<div style="margin:8px 16px 0;color:#FFFFFF;font-family:${FONT};font-size:16px;font-weight:800;line-height:1.5">${esc(BRAND)}</div>` +
    `<div style="margin:0 16px;color:#C9E3F8;font-family:${FONT};font-size:13px;line-height:1.6">${esc(SERVICE)}</div>` +
    (kicker ? `<table ${T} align="center" style="margin-top:8px"><tr><td bgcolor="#2A5DB0" style="background-color:#2A5DB0;border:1px solid #4F7FCC;border-radius:999px;padding:1px 14px;color:#FFFFFF;font-family:${FONT};font-size:12px;font-weight:700;line-height:1.8">${esc(kicker)}</td></tr></table>` : '') +
    // room for the gold line, then the white card's rounded top edge over the artwork
    `<div style="height:62px;line-height:62px">&nbsp;</div>` +
    `<table ${T} width="100%"><tr><td class="gut" style="padding:0 14px"><table ${T} width="100%"><tr>` +
    `<td height="22" bgcolor="${cap}" style="background-color:${cap};height:22px;line-height:22px;border-radius:20px 20px 0 0">&nbsp;</td></tr></table></td></tr></table>` +
    `<!--[if gte mso 9]></v:textbox></v:rect><![endif]--></td></tr>`;
}

const RED = '#B42318';
const priorityBar = text => gut(`<table ${T} width="100%"><tr><td bgcolor="${RED}" style="background-color:${RED};background-image:linear-gradient(120deg,#8E1B12,#C8372B);padding:0 22px 11px;color:#FFFFFF;font-family:${FONT};font-size:13px;font-weight:700;line-height:1.6">● ${esc(text)}</td></tr></table>`);

const card = inner => gut(`<table ${T} width="100%"><tr><td class="card" bgcolor="#FFFFFF" style="background-color:#FFFFFF;border-radius:0 0 20px 20px;padding:4px 26px 28px;direction:rtl;text-align:right;color:${C.ink};font-family:${FONT};font-size:14px;line-height:1.75">${inner}</td></tr></table>`);

const button = link => `<table ${T} align="center" style="margin:22px auto 0"><tr><td align="center" bgcolor="${C.royal}" style="background-color:${C.royal};background-image:linear-gradient(120deg,#0A2F7A,#1259C3 55%,#1E8FD6);border-radius:999px">` +
  `<a href="${esc(link.url)}" style="display:inline-block;padding:13px 34px;color:#FFFFFF;font-family:${FONT};font-size:15px;font-weight:700;line-height:1.5;text-decoration:none;border-radius:999px">${esc(link.label)}</a></td></tr></table>` +
  `<p style="margin:8px 0 0;text-align:center;font-family:${MONO};font-size:11.5px;color:#7A8DAE;word-break:break-all" dir="ltr">${esc(link.url)}</p>`;

const chip = (bg, color, text) => `<span style="display:inline-block;background-color:${bg};color:${color};border-radius:999px;padding:1px 11px;font-family:${FONT};font-size:12px;font-weight:700;line-height:1.8">${text}</span>`;
const h1 = text => `<h1 class="h1" style="margin:12px 0 6px;color:${C.navy};font-family:${FONT};font-size:21px;font-weight:800;line-height:1.45">${esc(text)}</h1>`;
const para = (text, style = '') => `<p style="margin:0 0 14px;color:${C.slate};font-size:14px;${style}">${esc(text)}</p>`;
const panel = (inner, style = '') => `<table ${T} width="100%" style="margin-top:14px"><tr><td bgcolor="${C.mist}" style="background-color:${C.mist};border:1px solid ${C.line};border-radius:16px;padding:6px 16px;${style}">${inner}</td></tr></table>`;
const kv = (rows, big) => `<table ${T} width="100%">` + rows.map(([k, v], i) =>
  `<tr><td style="padding:8px 0;${i ? 'border-top:1px solid #E2EEF9;' : ''}color:${C.slate};font-size:13.5px">${esc(k)}</td>` +
  `<td align="left" style="padding:8px 0 8px 0;${i ? 'border-top:1px solid #E2EEF9;' : ''}color:${C.ink};font-size:${big === i ? 19 : 13.5}px;font-weight:700;text-align:left">${v}</td></tr>`).join('') + '</table>';
const timeline = rows => `<table ${T} width="100%">` + rows.map((r, i) =>
  `<tr><td style="padding:7px 0;${i ? 'border-top:1px solid #EEF5FC;' : ''}font-size:13.5px;color:${C.ink}">${esc(r.text)}</td>` +
  `<td align="left" width="76" style="padding:7px 0;${i ? 'border-top:1px solid #EEF5FC;' : ''}text-align:left;white-space:nowrap">${r.meta ? chip('#EAF4FE', C.royal, esc(r.meta)) : ''}</td></tr>`).join('') + '</table>';
const sectionTitle = t => `<table ${T}><tr><td width="4" bgcolor="${C.royal}" style="background-color:${C.royal};border-radius:2px;font-size:12px;line-height:16px">&nbsp;</td>` +
  `<td style="padding-right:8px;color:${C.navy};font-size:14.5px;font-weight:800">${esc(t)}</td></tr></table>`;

function kpiRow(kpis) {
  const cells = kpis.map(([n, label], i) => {
    const first = i === 0;
    return `<td width="${Math.floor(100 / kpis.length)}%" align="center" bgcolor="${first ? '#0D3F98' : C.mist}" style="background-color:${first ? '#0D3F98' : C.mist};${first ? 'background-image:linear-gradient(135deg,#061A44,#0D3F98 55%,#1A7FD0);' : 'border:1px solid ' + C.line + ';'}border-radius:16px;padding:10px 4px">` +
      `<div style="font-size:26px;font-weight:800;line-height:1.2;color:${first ? '#FFFFFF' : C.royal}">${esc(digits(n))}</div>` +
      `<div style="font-size:11.5px;color:${first ? '#D6E6FA' : C.slate}">${esc(label)}</div></td>`;
  });
  return `<table ${T} width="100%" style="margin-top:12px"><tr>${cells.join('<td width="8" style="font-size:8px">&nbsp;</td>')}</tr></table>`;
}

function codeBlock(code) {
  const tile = d => `<td class="tile" width="40" align="center" bgcolor="#2453A8" style="background-color:#2453A8;border:1px solid #4A74C0;border-radius:11px;color:#FFFFFF;font-family:${MONO};font-size:30px;font-weight:800;line-height:52px">${d}</td>`;
  const gap = w => `<td width="${w}" style="font-size:8px">&nbsp;</td>`;
  const ds = String(code).split('');
  return `<table ${T} width="100%" style="margin:6px 0 14px"><tr><td align="center" bgcolor="#0D3F98" style="background-color:#0D3F98;background-image:linear-gradient(135deg,#061A44,#0D3F98 50%,#1A7FD0);border-radius:18px;padding:14px 8px">` +
    `<table ${T} align="center" dir="ltr"><tr>` + ds.map((d, i) => tile(d) + (i === ds.length - 1 ? '' : gap(i === 2 ? 14 : 6))).join('') + '</tr></table></td></tr></table>';
}

function footer({ social, mini, why, prefs, support }) {
  const contact = supportOf(support);
  const chipLink = (href, icon, label) => `<a href="${esc(href)}" style="display:inline-block;margin:8px 3px 0;padding:5px 14px;border-radius:999px;background-color:#1B3E7C;border:1px solid #34558F;color:#EAF2FC;font-family:${FONT};font-size:13px;line-height:1.7;text-decoration:none">` +
    `<img src="${IMG + icon}" width="16" height="16" alt="" style="border:0;vertical-align:middle;margin-left:6px">${label}</a>`;
  const socials = social ? `<table ${T} align="center" style="margin-top:16px"><tr>` + SOCIAL.map(s =>
    `<td style="padding:0 5px"><a href="${esc(s.url)}">${img('s-' + s.icon + '.png', 36, 36, s.name)}</a></td>`).join('') + '</tr></table>' : '';
  return `<tr><td height="18" bgcolor="${C.canvas}" style="background-color:${C.canvas};height:18px;line-height:18px">&nbsp;</td></tr>` +
    `<tr><td align="center" bgcolor="${C.navy}" style="background-color:${C.navy};background-image:linear-gradient(180deg,#0B2A66,#061A44);border-radius:0 0 20px 20px;padding:24px 22px 22px;text-align:center;color:#A9BEDF;font-family:${FONT};font-size:12.5px;line-height:1.8">` +
    `<table ${T} width="100%"><tr><td align="center" bgcolor="#15356F" style="background-color:#15356F;border:1px solid #2A4A85;border-radius:16px;padding:12px 10px">` +
    `<div style="color:#FFFFFF;font-size:14px;font-weight:800">محتاج مساعدة؟ <span style="color:#A9C6EC;font-size:12.5px;font-weight:400">تواصل مع الدعم الفني: ${esc(contact.name)}</span></div>` +
    chipLink(contact.whatsapp, 'i-whatsapp.png', 'واتساب ' + ltr(contact.phone)) + chipLink('mailto:' + SUPPORT_EMAIL, 'i-mail.png', ltr(SUPPORT_EMAIL)) +
    `</td></tr></table>${socials}` +
    `<div style="margin-top:16px;padding-top:12px;border-top:1px solid #1E3C74;color:#C7D6EE;font-size:12px"><b style="color:#FFFFFF">${esc(BRAND)}</b><br>${esc(SERVICE)}</div>` +
    `<div style="margin-top:4px">${mini ? '' : `<a href="${SITE}/" style="color:#E2C27A;font-weight:700;text-decoration:none">موقع الخدمة</a> · `}<a href="${PRIVACY}" style="color:#E2C27A;font-weight:700;text-decoration:none">سياسة الخصوصية</a>${prefs ? ` · <a href="${PREFS_URL}" style="color:#E2C27A;font-weight:700;text-decoration:none">إعدادات الإشعارات</a>` : ''}</div>` +
    `<div style="margin-top:8px;color:#8296BE;font-size:11.5px">${esc(why)}</div></td></tr>`;
}

/* the configured Technical Support contact (settings support_contact, YOUTH-ACCOUNTS-PLAN §11), else the default */
function supportOf(s) {
  return s && s.name && s.phone && s.whatsapp ? s : { name: SUPPORT_NAME, phone: SUPPORT_PHONE, whatsapp: SUPPORT_WHATSAPP };
}

/* the plain-text twin: the same content, in reading order */
function plain(o) {
  const out = [BRAND, SERVICE, '', o.heading];
  if (o.priority) out.push('[' + o.priority + ']');
  if (o.hero) out.push(o.hero.title + (o.hero.sub ? ' – ' + o.hero.sub : ''));
  if (o.intro) out.push(o.intro);
  if (o.code) out.push('', o.code, '');
  if (o.minutes) out.push('الكود صالح لمدة ' + digits(o.minutes) + ' دقايق، ولمرة واحدة.');
  if (o.ticket) {
    const t = o.ticket;
    out.push('', t.event + (t.when ? ' – ' + t.when : ''), 'رقم الحجز: ' + t.ref + ' (' + t.pills.map(p => p.text).join('، ') + ')',
      'عدد الأفراد: ' + digits(t.people), 'إجمالي الحجز: ' + money(t.total), 'المدفوع: ' + money(t.paid));
    if (t.total > t.paid && !t.closed) out.push('الباقي: ' + money(t.total - t.paid));
    if (t.due) out.push('آخر ميعاد للدفع: ' + t.due);
  }
  for (const [k, v] of o.facts || []) out.push(k + ': ' + v);
  for (const [n, label] of o.kpis || []) out.push(label + ': ' + digits(n));
  for (const s of o.sections || []) { out.push('', s.title + ':'); for (const r of s.rows) out.push('• ' + r.text + (r.meta ? ' (' + r.meta + ')' : '')); }
  for (const i of o.items || []) out.push('• ' + i.text + (i.meta ? ' (' + i.meta + ')' : ''));
  if (o.next) out.push('', o.next.title + ': ' + o.next.text);
  if (o.warn) out.push('', o.warn.title + ' ' + o.warn.text);
  for (const n of o.notes || []) out.push(n);
  if (o.link) out.push('', o.link.label + ': ' + o.link.url);
  const contact = supportOf(o.support);
  out.push('', '—', 'محتاج مساعدة؟ الدعم الفني: ' + contact.name + ' – ' + contact.phone + ' (لو في أي مشكلة أو حاجة مش مفهومة)',
    o.code ? 'واتساب: ' + contact.phone + ' · إيميل: ' + SUPPORT_EMAIL : 'واتساب: ' + contact.whatsapp + ' · إيميل: ' + SUPPORT_EMAIL);
  if (o.social) out.push(SOCIAL.map(s => s.name + ': ' + s.url).join('\n'));
  if (!o.code) out.push('سياسة الخصوصية: ' + PRIVACY);
  if (o.prefs) out.push('إعدادات الإشعارات: ' + PREFS_URL);
  out.push(BRAND + ' · ' + SERVICE, o.why);
  return out.filter(l => l != null).filter((l, i, all) => l !== '' || (i > 0 && all[i - 1] !== '')).join('\n');
}

/*
 * layout(o) → { html, text }. o: { audience, heading, kicker, priority, label, date, intro, hero, code, minutes,
 *   facts [[k, v]], kpis [[n, label]], sections [{ title, rows }], items [{ text, meta }], ticket, next, warn,
 *   notes, link, social, why }. Values are escaped here; facts' values may carry { ltr } parts.
 */
export function layout(o) {
  const { audience = 'admin', link = null } = o;
  if (link && audience !== 'admin' && /\/admin(\/|#|$)/.test(link.url)) throw new Error('an admin link in a member email');
  if (link && !link.url.startsWith(SITE + '/')) throw new Error('links stay on the service site');
  if (o.social && audience === 'admin') throw new Error('social links are for member booking emails only');
  const why = o.why || WHY.admin;
  const factText = v => (v && typeof v === 'object' ? v.text : v);
  const factHtml = v => (v && typeof v === 'object' ? (v.ltr ? ltr(v.text) : esc(v.text)) : esc(v));

  let body = '';
  if (o.hero) {
    body += `<table ${T} width="100%" style="border-bottom:1px solid #E6F0FA"><tr>` +
      (o.hero.icon ? `<td width="56" valign="middle" style="padding:6px 0 14px">${img(o.hero.icon, 46, 46, '')}</td>` : '') +
      `<td valign="middle" style="padding:6px ${o.hero.icon ? '12px' : '0'} 14px 0"><div style="color:${C.navy};font-size:19px;font-weight:800;line-height:1.35">${esc(o.hero.title)}</div>` +
      (o.hero.sub ? `<div style="color:${C.slate};font-size:13px">${esc(o.hero.sub)}</div>` : '') + '</td></tr></table>';
  }
  if (o.icon) body += `<table ${T} align="center" style="margin:16px auto 0"><tr><td>${img(o.icon, 54, 54, '')}</td></tr></table>`;
  if (o.label || o.date) body += `<div style="margin-top:16px">${o.label ? chip('#EAF4FE', C.royal, esc(o.label)) : ''}${o.date ? chip('#FFF6E2', '#7A5614', esc(o.date)) : ''}</div>`;
  if (!o.hero) body += h1(o.heading);
  if (o.intro) body += para(o.intro, o.code ? 'text-align:center' : '');
  if (o.code) body += codeBlock(o.code);
  if (o.minutes) body += `<table ${T} align="center"><tr><td bgcolor="#FFF7E6" style="background-color:#FFF7E6;border:1px solid #F0DFB4;border-radius:999px;padding:3px 14px;color:${C.navy};font-size:13.5px">` +
    `<img src="${IMG}i-clock.png" width="16" height="16" alt="" style="border:0;vertical-align:middle;margin-left:6px">صالح لمدة <b>${digits(o.minutes)} دقايق</b> · لمرة واحدة بس</td></tr></table>`;
  if (o.ticket) body += ticketHtml(o.ticket);
  if (o.facts && o.facts.length) body += panel(kv(o.facts.map(([k, v]) => [k, factHtml(v)])));
  if (o.kpis && o.kpis.length) body += kpiRow(o.kpis);
  for (const s of o.sections || []) body += panel(sectionTitle(s.title) + timeline(s.rows), 'padding:10px 16px;background-color:#FFFFFF');
  if (o.items && o.items.length) body += panel(timeline(o.items), 'padding:4px 16px');
  if (o.next) body += panel(`<div style="color:${C.navy};font-weight:800">${esc(o.next.title)}</div><div style="color:#2E4466;font-size:13.5px">${esc(o.next.text)}</div>`, 'padding:12px 16px;background-color:#EEF6FE');
  if (o.warn) body += panel(`<table ${T} width="100%"><tr><td width="26" valign="top" style="padding-top:4px">${img('i-shield.png', 18, 18, '')}</td>` +
    `<td style="color:#2E4466;font-size:13px"><b style="color:${C.navy}">${esc(o.warn.title)}</b><br>${esc(o.warn.text)}</td></tr></table>`, 'padding:12px 14px');
  for (const n of o.notes || []) body += `<p style="margin:14px 0 0;color:#5A6F92;font-size:12.5px">${esc(n)}</p>`;
  if (link) body += button(link);

  const html = head(o.heading) + `<body style="margin:0;padding:0;background-color:${C.page}" dir="rtl">` +
    `<table ${T} width="100%" bgcolor="${C.page}" style="background-color:${C.page}"><tr><td class="wrap" align="center" style="padding:24px 12px">` +
    `<!--[if mso]><table ${T} width="600" align="center"><tr><td><![endif]-->` +
    `<table ${T} width="100%" dir="rtl" style="max-width:600px;margin:0 auto">` +
    header(o.kicker, o.priority ? RED : '#FFFFFF') + (o.priority ? priorityBar(o.priority) : '') + card(body) +
    footer({ social: !!o.social, mini: audience === 'admin' || !!o.code, why, prefs: !!o.prefs, support: o.support }) +
    '</table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>';
  return { html, text: plain({ ...o, why, facts: (o.facts || []).map(([k, v]) => [k, factText(v)]) }) };
}

/* the booking ticket (member booking notices): event, reference and status, money, the due date */
function ticketHtml(t) {
  const pct = t.total > 0 ? Math.max(0, Math.min(100, Math.round((t.paid / t.total) * 100))) : 0;
  const bar = `<table ${T} width="100%" style="margin:6px 0"><tr>` +
    (pct > 0 ? `<td width="${pct}%" height="8" bgcolor="${C.royal}" style="background-color:${C.royal};background-image:linear-gradient(270deg,#0A2F7A,#1E8FD6);border-radius:9px;font-size:6px;line-height:8px">&nbsp;</td>` : '') +
    (pct < 100 ? `<td height="8" bgcolor="#DCEBF8" style="background-color:#DCEBF8;border-radius:9px;font-size:6px;line-height:8px">&nbsp;</td>` : '') + '</tr></table>';
  const pills = t.pills.map(p => chip(p.bg, p.color, esc(p.text))).join(' ');
  const rows = [['عدد الأفراد', esc(digits(t.people)) + ' ' + (t.people === 1 ? 'فرد' : 'أفراد')], ['إجمالي الحجز', esc(money(t.total))],
    ['المدفوع', `<span style="color:#0F6B45">${esc(money(t.paid))}</span>`]];
  return `<table ${T} width="100%" style="margin-top:16px"><tr><td bgcolor="${C.mist}" style="background-color:${C.mist};border:1px solid ${C.line};border-radius:18px">` +
    `<table ${T} width="100%"><tr><td style="padding:14px 16px;border-bottom:2px dashed #CFE3F6">` +
    `<div style="color:${C.navy};font-size:17px;font-weight:800">${esc(t.event)}</div>` +
    (t.when ? `<div style="color:${C.slate};font-size:13px">${esc(t.when)}</div>` : '') +
    `<div style="margin-top:8px;color:${C.slate};font-size:12.5px">رقم الحجز <span dir="ltr" style="display:inline-block;margin:0 4px;background-color:#FFFFFF;border:1px solid #CFE3F6;border-radius:8px;padding:0 9px;color:${C.navy};font-family:${MONO};font-size:14px;font-weight:700;letter-spacing:.6px">${esc(t.ref)}</span> ${pills}</div></td></tr>` +
    `<tr><td style="padding:10px 16px 14px">${kv(rows)}${bar}` +
    (t.total > t.paid && !t.closed ? kv([[t.remainingLabel || 'الباقي', `<span style="color:${C.royal}">${esc(money(t.total - t.paid))}</span>`]], 0) : '') +
    (t.due ? `<table ${T} width="100%" style="margin-top:8px"><tr><td bgcolor="#FFF8EA" style="background-color:#FFF8EA;border:1px solid #F0DFB4;border-radius:12px;padding:7px 12px;color:#6B4A0E;font-size:13px">` +
      `<img src="${IMG}i-clock.png" width="16" height="16" alt="" style="border:0;vertical-align:middle;margin-left:6px">آخر ميعاد للدفع: <b>${esc(t.due)}</b></td></tr></table>` : '') +
    '</td></tr></table></td></tr></table>';
}

/* ---------------- admin (active) ---------------- */

const panelLink = path => ({ label: 'افتح في لوحة التحكم', url: SITE + (path && path.startsWith('/admin/') ? path : '/admin/') });

/* the subject of each event type (the catalog's key); optional parts in [] */
const SUBJECTS = {
  'booking.new': '{countText}[ – {event}]',
  'booking.create': '{countText}[ – {event}]',
  'booking.confirm': 'تأكيد حجز {ref}[ – {event}]',
  'booking.reject': 'رفض حجز {ref}[ – {event}]',
  'booking.cancel': 'إلغاء حجز {ref}[ – {event}]',
  'booking.reopen': 'رجوع حجز {ref}[ – {event}]',
  'booking.update': 'تعديل حجز {ref}[ – {event}]',
  'booking.ageOverride': 'تجاوز شرط السن في حجز {ref}[ – {event}]',
  'booking.withdraw': 'الزائر لغى طلب الحجز {ref}[ – {event}]',
  'booking.remind': 'تذكير بالدفع في حجز {ref}[ – {event}]',
  'payment.add': 'دفعة جديدة في حجز {ref}[ – {event}]',
  'payment.refund': 'استرداد في حجز {ref}[ – {event}]',
  'payment.void': 'إلغاء دفعة في حجز {ref}[ – {event}]',
  'payment.request': 'طلب دفع الباقي في حجز {ref}[ – {event}]',
  'event.cancelAll': 'إلغاء كل الحجوزات[ – {event}]',
  'accounts.add': 'أدمن جديد في لوحة التحكم[: {target}]',
  'accounts.grants': 'تغيير صلاحيات[ {target}]',
  'accounts.remove': 'إزالة أدمن من لوحة التحكم[: {target}]',
  'notify.settings': 'تغيير إعدادات الإشعارات',
  'notify.failed': 'إشعار مقدرش يتبعت',
  'gmail.token': 'إرسال الإيميلات واقف',
  'member.mail.dead': 'إيميل لعضو مقدرش يتبعت',
  'participant.email': 'تغيير إيميل حساب',
  'participant.phoneFix': 'تغيير موبايل حساب',
  'participant.dob': 'تصحيح تاريخ ميلاد حساب',
  'participant.reset': 'باسورد جديد لحساب',
  'participant.block': 'حساب اتوقف',
  'account.recovery.first': 'أول استرجاع بإيميل دخّله أدمن',
  'account.discover.high': 'محاولات كتير على نموذج الدخول',
  'job.failed': 'مهمة في الخلفية فشلت'
};

/* what the admin is asked to do, per type (no amounts, no visitor data) */
const INTROS = {
  'booking.new': 'فيه {countWord} في «{event}» مستني المراجعة في «الحجوزات».',
  'booking.create': 'اتسجّل {countWord} كاش في «{event}» مستني الاعتماد.',
  'payment.add': 'اتسجلت دفعة جديدة. المبلغ والتفاصيل في لوحة التحكم.',
  'payment.refund': 'اتسجل استرداد. المبلغ والتفاصيل في لوحة التحكم.',
  'payment.void': 'اتلغت دفعة. راجع الحجز في لوحة التحكم.',
  'payment.request': 'مشترك بعت صورة تحويل للمبلغ الباقي. راجعها واقبلها أو ارفضها من الحجز.',
  'event.cancelAll': 'كل حجوزات الفعالية اتلغت. راجع اللي محتاج يرجعله فلوس في «الحجوزات».'
};

/* the family of an action: the label of an alert and the sections of the summary (in this order) */
const FAMILIES = [
  ['bookings', 'الحجوزات', a => /^(booking|event)\./.test(a)],
  ['money', 'المدفوعات', a => /^(payment|pay|handover|finance)\./.test(a)],
  ['accounts', 'الحسابات والصلاحيات', a => /^(accounts|admin|session)\./.test(a)],
  ['content', 'المحتوى', a => /^(update|create|delete|publish|news|content|media|program|comp|points|store|redemption)\b/.test(a)],
  ['system', 'النظام', a => /^(notify|gmail|job|modules|export|code|member|account)\./.test(a)]
];
const familyOf = action => FAMILIES.find(f => f[2](String(action || ''))) || ['other', 'نشاط تاني'];

/*
 * An admin notification or alert: m = catalog messageOf() (m.ctx carries the
 * event: key, ref, event, count, target; m.lines who did what and when).
 */
export function alertEmail(m, { level = 'important', kind = '' } = {}) {
  const ctx = m.ctx || {};
  const key = ctx.key || kind;
  const n = Number(ctx.count) || m.lines.length || 1;
  const cash = key === 'booking.create';
  const data = {
    ...ctx,
    countText: n === 1 ? (cash ? 'حجز كاش جديد' : 'حجز جديد') : digits(n) + (cash ? ' حجوزات كاش جديدة' : ' حجوزات جديدة'),
    countWord: n === 1 ? 'حجز جديد' : digits(n) + ' حجوزات جديدة'
  };
  let subject = m.title;
  let intro = m.body && m.body !== 'لوحة تحكم الأسرة' ? m.body : '';
  try { if (SUBJECTS[key]) subject = fill(SUBJECTS[key], data); } catch { subject = m.title; }
  try { if (INTROS[key]) intro = fill(INTROS[key], data); } catch { /* keep the router's text */ }
  const grouped = key === 'booking.new' || key === 'booking.create';
  const last = m.lines[m.lines.length - 1] || {};
  const facts = [
    n > 1 ? ['العدد', digits(n)] : last.who ? ['بواسطة', last.who] : null,
    ctx.event ? ['الفعالية', ctx.event] : null,
    ctx.ref ? ['رقم الحجز', { text: ctx.ref, ltr: true }] : null,
    ctx.target ? ['الحساب', { text: ctx.target, ltr: true }] : null,
    last.cairo ? ['الوقت', whenText(last.cairo)] : null
  ].filter(Boolean);
  const critical = level === 'critical';
  return {
    subject: clip((critical ? 'تنبيه مهم: ' : '') + subject, 90),
    ...layout({
      audience: 'admin',
      kicker: 'لوحة التحكم · ' + (critical ? 'تنبيه' : 'إشعار'),
      priority: critical ? 'تنبيه مهم · محتاج مراجعة' : '',
      label: familyOf(key)[1],
      heading: subject,
      intro,
      facts,
      items: m.lines.length > 1 ? (grouped ? m.lines.slice(-10) : m.lines.slice(-5)).map(l => ({ text: l.text, meta: whenText(l.cairo) })) : [],
      link: panelLink(m.url)
    })
  };
}

/* the day's summary for one admin: counts first, then the activity by family, newest last */
export function summaryEmail(m, day) {
  const lines = m.lines.slice(0, 40);
  const groups = new Map();
  for (const l of lines) {
    const [id, title] = familyOf(l.action);
    if (!groups.has(id)) groups.set(id, { title, rows: [] });
    groups.get(id).rows.push({ text: l.text, meta: clockText(l.cairo) || l.cairo || '' });
  }
  const order = FAMILIES.map(f => f[0]).concat('other');
  const sections = [...groups.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([, g]) => g);
  return {
    subject: fill('ملخص نشاط لوحة التحكم[ – {day}]', { day }),
    ...layout({
      audience: 'admin',
      kicker: 'الملخص اليومي',
      date: day ? dayText(day, { year: true }) : '',
      heading: 'ملخص نشاط لوحة التحكم',
      intro: lines.length ? fill('اللي حصل[ يوم {day}] في الحاجات اللي اخترت يوصلك ملخصها:', { day: day ? dayText(day) : '' }) : 'مفيش نشاط جديد في الحاجات اللي اخترت يوصلك ملخصها.',
      kpis: sections.slice(0, 3).map(s => [s.rows.length, s.title]),
      sections,
      notes: m.lines.length > 40 ? ['و' + digits(m.lines.length - 40) + ' كمان في «سجل النشاط».'] : [],
      link: { label: 'افتح سجل النشاط', url: SITE + '/admin/#activity' }
    })
  };
}

/* ---------------- member (Phase 5A: account/mail.js, member.js) ---------------- */

const CODE_PURPOSE = {
  verify: { subject: 'كود تأكيد الإيميل لحسابك', kicker: 'تأكيد الحساب', heading: 'كود تأكيد الإيميل', intro: 'اكتب الكود ده في صفحة التسجيل علشان تأكد إيميلك وتكمّل:' },
  recovery: { subject: 'كود استرجاع حسابك', kicker: 'استرجاع الحساب', heading: 'كود استرجاع الحساب', intro: 'اكتب الكود ده في صفحة «نسيت الباسورد» علشان تعمل باسورد جديد:' }
};

/* a one-time code: no service link at all, the code only in the body (never the subject), the expiry, what to do if unasked */
export function otpEmail({ code, minutes = 10, purpose = 'verify', support = null }) {
  if (!/^\d{6}$/.test(String(code))) throw new Error('otp code must be 6 digits');
  const t = CODE_PURPOSE[purpose];
  if (!t) throw new Error('unknown code purpose: ' + purpose);
  if (!(minutes >= 1 && minutes <= 60)) throw new Error('otp minutes out of range');
  return {
    subject: t.subject + ' – ' + BRAND,
    ...layout({
      audience: 'member',
      kicker: t.kicker,
      icon: 'i-lock.png',
      heading: t.heading,
      intro: t.intro,
      code: String(code),
      minutes,
      warn: { title: 'متشاركش الكود مع أي حد.', text: 'محدش من الخدمة هيطلبه منك أبداً، ولا حتى الخدام.' },
      why: WHY.code,
      support
    })
  };
}

const SECURITY = {
  account_created: { subject: 'اتعمل حساب بالإيميل ده', text: 'اتعمل حساب على موقع الخدمة بالإيميل ده.', site: true },
  password_reset_support: { subject: 'الباسورد بتاع حسابك اتغير من الدعم الفني', text: 'الدعم الفني غيّر الباسورد بتاع حسابك.' },
  password_changed: { subject: 'الباسورد بتاع حسابك اتغير', text: 'الباسورد بتاع حسابك اتغير.' },
  email_changed: { subject: 'الإيميل بتاع حسابك اتغير', text: 'الإيميل المسجل في حسابك اتغير.' },
  recovery_used: { subject: 'حسابك اتسترجع بكود', text: 'حد استخدم كود استرجاع ودخل حسابك.' },
  new_signin: { subject: 'دخول جديد لحسابك', text: 'حسابك اتفتح من جهاز جديد.' }
};

/* a security notice to the account's owner: what changed, when, from where; help through the public site only */
export function securityEmail({ kind, cairo, device = '', prefs = false, support = null }) {
  const t = SECURITY[kind];
  if (!t) throw new Error('unknown security notice: ' + kind);
  return {
    subject: t.subject + ' – ' + BRAND,
    ...layout({
      audience: 'member',
      kicker: 'أمان الحساب',
      heading: t.subject,
      intro: t.text,
      facts: [cairo ? ['امتى', whenText(cairo)] : null, device ? ['الجهاز', clip(device, 60)] : null].filter(Boolean),
      notes: ['لو ده انت، مش محتاج تعمل حاجة.', 'لو مش انت، كلّم الدعم الفني على طول (واتساب أو إيميل تحت).'],
      // the account's security section (docs/EMAIL-DEEP-LINKS.md); a creation notice may reach a stranger: the site only
      link: t.site ? { label: 'موقع الخدمة', url: SITE + '/' } : { label: 'أمان حسابك', url: ACCOUNT + '#me/security' },
      prefs,
      support,
      why: WHY.security
    })
  };
}

/*
 * A booking notice to the member who booked (Phase 5A design; not wired):
 * b = { status, name, event, when, ref, people, total, paid, due, next, url }.
 * status: confirmed | pending | balance (a reminder of what is left) | cancelled.
 */
const BOOKING = {
  confirmed: { subject: 'حجزك اتأكد', title: 'حجزك اتأكد', sub: 'مكانك محجوز.', icon: 'i-check.png', pill: ['مؤكد', '#DDF5EA', '#0F6B45'] },
  pending: { subject: 'استلمنا طلب حجزك', title: 'استلمنا طلب حجزك', sub: 'الخدام هيراجعوه ويأكدوه قريب.', pill: ['قيد المراجعة', '#EAF4FE', '#1259C3'] },
  balance: { subject: 'تذكير بالمبلغ الباقي في حجزك', title: 'فاضل جزء من مبلغ الحجز', sub: 'حجزك مؤكد، والباقي مستني قبل الميعاد.', icon: 'i-check.png', pill: ['مؤكد', '#DDF5EA', '#0F6B45'] },
  cancelled: { subject: 'حجزك اتلغى', title: 'حجزك اتلغى', sub: 'لو ده مش متوقع، كلّم الدعم الفني.', pill: ['ملغي', '#FDECEA', '#9B1C1C'], closed: true },
  rejected: { subject: 'طلب حجزك اترفض', title: 'طلب حجزك اترفض', sub: 'لو دفعت حاجة، الخادم هيتواصل معاك.', pill: ['مرفوض', '#FDECEA', '#9B1C1C'], closed: true },
  event_cancelled: { subject: 'الفعالية اتلغت', title: 'الفعالية اتلغت', sub: 'لو دفعت حاجة، الخادم هيتواصل معاك.', pill: ['ملغي', '#FDECEA', '#9B1C1C'], closed: true },
  payment_recorded: { subject: 'اتسجلت دفعة في حجزك', title: 'اتسجلت دفعة في حجزك', sub: 'شكرًا، الدفعة وصلت الخدمة.', icon: 'i-check.png', pill: ['مؤكد', '#DDF5EA', '#0F6B45'], amountLabel: 'الدفعة' },
  payment_voided: { subject: 'حصل تصحيح في مدفوعات حجزك', title: 'حصل تصحيح في مدفوعات حجزك', sub: 'الأرقام تحت هي الصحيحة دلوقتي.', pill: ['تصحيح', '#EAF4FE', '#1259C3'] },
  due_changed: { subject: 'مبلغ حجزك اتغير', title: 'مبلغ حجزك اتغير', sub: 'الأرقام تحت هي الصحيحة دلوقتي.', pill: ['تعديل', '#EAF4FE', '#1259C3'] },
  request_received: { subject: 'استلمنا طلب دفعتك', title: 'استلمنا طلب دفعتك', sub: 'صورة التحويل مش تأكيد للدفع: الخدام هيراجعوها.', pill: ['قيد المراجعة', '#EAF4FE', '#1259C3'], amountLabel: 'المبلغ' },
  request_rejected: { subject: 'طلب دفعتك اترفض', title: 'طلب دفعتك اترفض', sub: 'الدفعة دي ما اتسجلتش.', pill: ['مرفوض', '#FDECEA', '#9B1C1C'] },
  event_change: { subject: 'تغيير في ميعاد أو مكان الفعالية', title: 'في تغيير في الفعالية', sub: 'راجع التفاصيل الجديدة.', pill: ['تغيير', '#FFF3D9', '#7A5614'] }
};
const CHANGE_LABELS = { date: 'التاريخ', time: 'الميعاد', place: 'المكان' };

const RESULT = {
  result: { subject: 'نتيجتك في', heading: 'نتيجتك ظهرت', intro: 'نتيجة مشاركتك في المسابقة ظهرت.' },
  done: { subject: 'خلص تصحيح إجاباتك في', heading: 'خلص تصحيح إجاباتك', intro: 'كل إجاباتك اتصححت.' },
  points: { subject: 'زادت نقطك من', heading: 'زادت نقطك', intro: 'اتصححت إجابات ليك وزادت نقطك.' },
  correction: { subject: 'تصحيح في نتيجتك في', heading: 'حصل تصحيح في نتيجتك', intro: 'الأرقام تحت هي الصحيحة دلوقتي.' }
};

/* a result (§4.3, COMPETITIONS §20.3): the score only when the policy shows it; never answers or anyone else's rank */
export function resultEmail({ kind, title, score = null, max = null, points = null, noPoints = false, wallet = false, balance = null, pending = 0, url, prefs = false, support = null }) {
  const t = RESULT[kind];
  if (!t) throw new Error('unknown result email: ' + kind);
  return {
    subject: t.subject + ' «' + clip(title, 60) + '» – ' + BRAND,
    ...layout({
      audience: 'member',
      kicker: 'نتيجتك',
      heading: t.heading,
      intro: t.intro,
      facts: [
        ['المسابقة', clip(title, 80)],
        ...(score !== null ? [['الدرجة', digits(score) + ' من ' + digits(max)]] : []),
        ...(noPoints ? [['النقط', 'بدون نقاط']] : points !== null ? [['النقط', digits(points) + ' نقطة']] : []),
        ...(wallet && balance !== null && !noPoints ? [['رصيدك (وقت الإرسال)', digits(balance) + ' نقطة']] : [])
      ],
      notes: pending > 0 ? ['لسه فيه أسئلة بتتصحح.'] : [],
      link: { label: 'شوف نتيجتك', url },
      prefs,
      support,
      why: WHY.security
    })
  };
}

const STORE = {
  requested: { subject: 'استلمنا طلبك من المتجر', intro: 'طلبك وصل، والخدام هيراجعوه.' },
  approved: { subject: 'طلبك من المتجر جاهز', intro: 'طلبك جاهز للاستلام من الخادم.' },
  cancelled: { subject: 'طلبك من المتجر اتلغى', intro: 'طلبك اتلغى والنقط رجعتلك.' }
};

/* a store request's state (§4.4): a receipt, so a stolen session that spends points is noticed */
export function storeEmail({ kind, item, cost, balance, note = '', url, prefs = false, support = null }) {
  const t = STORE[kind];
  if (!t) throw new Error('unknown store email: ' + kind);
  return {
    subject: t.subject + ' – ' + BRAND,
    ...layout({
      audience: 'member',
      kicker: 'المتجر',
      heading: t.subject,
      intro: t.intro,
      facts: [['الجايزة', clip(item, 60)], [kind === 'cancelled' ? 'النقط اللي رجعت' : 'النقط', digits(cost) + ' نقطة'], ['رصيدك (وقت الإرسال)', digits(balance) + ' نقطة']].concat(note ? [['السبب', clip(note, 200)]] : []),
      link: { label: 'شوف طلبك', url },
      prefs,
      support,
      why: WHY.security
    })
  };
}

/* about to leave the age range (§4.1): the date only, never an age */
export function ageOutEmail({ date, url, prefs = false, support = null }) {
  return {
    subject: 'استخدم نقطك قبل ' + dayText(date) + ' – ' + BRAND,
    ...layout({
      audience: 'member',
      kicker: 'نقطك',
      heading: 'نقطك هتتجمد قريب',
      intro: 'من يوم ' + dayText(date, { year: true }) + ' هتفضل تشارك في المسابقات كضيف، ونقطك هتفضل محفوظة بس مش هتقدر تستخدمها. استخدمها قبلها.',
      link: { label: 'شوف نقطك', url },
      prefs,
      support,
      why: WHY.security
    })
  };
}

/* a deduction from the member's wallet (§4.4): the note only when the admin marked it for them */
export function pointsEmail({ amount, balance, note = '', url, support = null }) {
  return {
    subject: 'اتخصم من نقطك – ' + BRAND,
    ...layout({
      audience: 'member',
      kicker: 'نقطك',
      heading: 'اتخصم من نقطك',
      intro: 'اتخصم من رصيد نقطك في الموسم الحالي.',
      facts: [['اتخصم', digits(amount) + ' نقطة'], ['رصيدك دلوقتي (وقت الإرسال)', digits(balance) + ' نقطة']].concat(note ? [['السبب', clip(note, 200)]] : []),
      link: { label: 'شوف نقطك', url },
      support,
      why: WHY.security
    })
  };
}
export function bookingEmail(b) {
  const s = BOOKING[b.status];
  if (!s) throw new Error('unknown booking status: ' + b.status);
  // the button opens that booking for its signed-in owner (docs/EMAIL-DEEP-LINKS.md), never a status-token link
  if (b.url && /#b\//.test(b.url)) throw new Error('a booking status-token link in an email');
  const total = Number(b.total) || 0;
  const paid = Number(b.paid) || 0;
  const owes = total > paid && !s.closed;
  const pills = [{ text: s.pill[0], bg: s.pill[1], color: s.pill[2] }].concat(owes ? [{ text: 'عليه باقي', bg: '#FFF3D9', color: '#7A5614' }] : []);
  return {
    subject: fill(s.subject + ' {ref}[ – {event}]', b),
    ...layout({
      audience: 'member',
      heading: s.title,
      hero: { title: s.title, sub: (b.name ? 'أهلاً يا ' + clip(b.name, 30) + '، ' : '') + s.sub, icon: s.icon },
      ticket: { event: b.event, when: b.when, ref: b.ref, people: Number(b.people) || 1, total, paid, due: owes ? b.due : '', pills, closed: !!s.closed },
      facts: [
        ...(s.amountLabel && b.amount ? [[b.refund ? 'مرتجع' : s.amountLabel, money(Number(b.amount))]] : []),
        ...(Array.isArray(b.changes) ? b.changes.map(c => [CHANGE_LABELS[c.field] || c.field, (c.from ? clip(c.from, 80) + ' ← ' : '') + clip(c.to, 80)]) : [])
      ],
      next: b.reason ? { title: 'السبب', text: clip(b.reason, 200) } : b.next ? { title: 'الخطوة الجاية', text: b.next } : null,
      link: { label: 'عرض تفاصيل الحجز', url: b.url && b.url.startsWith(SITE + '/') ? b.url : SITE + '/' },
      social: true,
      prefs: !!b.prefs,
      support: b.support || null,
      why: WHY.booking
    })
  };
}
