/**
 * YOUTH ACCOUNT: the link every page shares, small enough for the home page. The header's account icon, and the
 * one way to send someone to sign in and bring them back to the page they were on. No request here: the icon draws
 * from what this device remembers, and /account/ decides whether the session still holds.
 */

export const SESSION_KEY = 'athanasios.account.v1';
/* where a sign-in came from, and the page a signed-in member came to the account from: this tab only */
export const RETURN_KEY = 'athanasios.account.return.v1';
export const FROM_KEY = 'athanasios.account.from.v1';
/* the icon's first letter and photo: beside the session, and gone with it */
export const FACE_KEY = 'athanasios.account.face.v1';
export const MODE_KEY = 'athanasios.account.mode.v1';

const SVG = 'http://www.w3.org/2000/svg';
const USER_ICON = 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1-4.4 4-6 8-6s7 1.6 8 6';

/* this site's own pages only: never /admin/, another host or a script */
export const cleanReturn = path => (/^\/(?:index\.html|events\/[a-z0-9-]{1,60}\/|competition\/[a-z0-9-]{2,40}\/|pages\/[a-z0-9-]{1,60}\/|black-theatre\/|points\/)?(?:\?[\w=&-]{0,120})?(?:#[\w./~-]{0,600})?$/.test(String(path || '')) ? String(path) : '');

function storage(name) {
  try {
    return globalThis[name] || null;
  }
  catch {
    return null;
  }
}

function read(store, key) {
  try {
    return JSON.parse(store.getItem(key) || 'null');
  }
  catch {
    return null;
  }
}

/* { token, email } from this tab (shared device) first, then this device */
export function readSession(local, session) {
  for (const store of [session, local]) {
    const value = store ? read(store, SESSION_KEY) : null;
    if (value && typeof value.token === 'string' && /^as1\./.test(value.token)) return value;
  }
  return null;
}

export function clearSession(local, session) {
  for (const store of [session, local]) {
    try {
      if (store) {
        store.removeItem(SESSION_KEY);
        store.removeItem(FACE_KEY);
      }
    }
    catch { /* nothing to clear */ }
  }
}

export function writeSession(local, session, value, kind) {
  clearSession(local, session);
  try {
    (kind === 'shared' ? session : local).setItem(SESSION_KEY, JSON.stringify(value));
  }
  catch { /* the session lives for this page only */ }
}

/* { firstName, photo (a data: URL or ''), version } */
export function readFace(local, session) {
  for (const store of [session, local]) {
    const value = store ? read(store, FACE_KEY) : null;
    if (value && typeof value.firstName === 'string') return value;
  }
  return null;
}

/* kept where the session is, so a shared device's stays in the tab */
export function writeFace(local, session, face) {
  let store = local;
  try {
    if (session && session.getItem(SESSION_KEY)) store = session;
    if (!store.getItem(SESSION_KEY)) return;
    store.setItem(FACE_KEY, JSON.stringify(face));
  }
  catch { /* full or blocked: the icon just shows less */ }
}

const here = () => location.pathname + location.search + location.hash;

function keep(key, path) {
  const tab = storage('sessionStorage');
  try {
    if (!tab) return;
    if (cleanReturn(path)) tab.setItem(key, path);
    else tab.removeItem(key);
  }
  catch { /* the account page still opens */ }
}

/* off to /account/; it brings them back to this page after signing in */
export function goSignIn(rootUrl) {
  keep(RETURN_KEY, here());
  location.href = new URL('account/', rootUrl).href;
}

function paintFace(button) {
  const local = storage('localStorage');
  const tab = storage('sessionStorage');
  const signedIn = !!readSession(local, tab);
  const face = signedIn ? readFace(local, tab) : null;
  const inner = document.createElement('span');
  inner.className = 'acct-badge__face';
  if (face && face.photo && /^data:image\/(?:webp|jpeg);base64,/.test(face.photo)) {
    const img = document.createElement('img');
    img.src = face.photo;
    img.alt = '';
    img.width = 40;
    img.height = 44;
    inner.append(img);
  }
  else if (face && face.firstName) {
    inner.textContent = Array.from(face.firstName)[0];
  }
  else {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', USER_ICON);
    svg.append(path);
    inner.append(svg);
  }
  button.classList.toggle('is-in', signedIn);
  const label = signedIn ? (face && face.firstName ? 'حسابي: ' + face.firstName : 'حسابي') : 'سجّل دخولك';
  button.setAttribute('aria-label', label);
  button.title = label;
  button.replaceChildren(inner);
}

/*
 * The header's icon, added to `bar` once (before `before` when given). Not in a frame (the admin's preview), and not
 * while the account is known to be switched off. Pressing it means they want their account, signed in or not: after
 * signing in they land there, and its «ارجع للموقع» brings them back. Only a service that asked for the sign-in
 * (goSignIn) returns to the page.
 */
export function accountBadge(bar, rootUrl, { cls = '', before = null } = {}) {
  if (!bar || bar.querySelector('.acct-badge')) return null;
  try {
    if (window.top !== window.self) return null;
  }
  catch {
    return null;
  }
  const local = storage('localStorage');
  try {
    if (local && local.getItem(MODE_KEY) === 'off') return null;
  }
  catch { /* unknown: it shows, and /account/ says so if it is off */ }
  const link = document.createElement('a');
  link.className = 'acct-badge' + (cls ? ' ' + cls : '');
  link.href = new URL('account/', rootUrl).href;
  link.addEventListener('click', () => {
    keep(RETURN_KEY, '');
    keep(FROM_KEY, here());
  });
  paintFace(link);
  // back from another tab or page: what it shows may have changed
  addEventListener('storage', () => paintFace(link));
  addEventListener('pageshow', event => { if (event.persisted) paintFace(link); });
  if (before) before.before(link);
  else bar.append(link);
  return link;
}
