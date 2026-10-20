// One-time Gmail consent for the Worker's sender (Phase 1.5 step 6). The OWNER
// runs it on their own machine, signed in to Google as
// athanasius.youth.safaga@gmail.com. It asks Google for the gmail.send scope
// only, receives the code on 127.0.0.1, exchanges it for a refresh token and
// puts the three secrets straight into the Worker (`wrangler secret put`,
// through stdin). Nothing is written to disk or printed.
//
// Before: Google Cloud console → APIs & Services
//   1. enable the Gmail API;
//   2. OAuth consent screen: External, publishing status «In production»
//      (Testing-mode refresh tokens expire after 7 days), scope gmail.send;
//   3. Credentials → Create OAuth client ID → «Desktop app».
//
// Run (from worker/):
//   GMAIL_CLIENT_ID=… GMAIL_CLIENT_SECRET=… node scripts/gmail-consent.mjs staging
//   GMAIL_CLIENT_ID=… GMAIL_CLIENT_SECRET=… node scripts/gmail-consent.mjs production
// A password change on the account revokes the token: run it again.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const target = process.argv[2];
if (target !== 'staging' && target !== 'production') { console.error('usage: node scripts/gmail-consent.mjs staging|production'); process.exit(2); }
const id = process.env.GMAIL_CLIENT_ID;
const secret = process.env.GMAIL_CLIENT_SECRET;
if (!id || !secret) { console.error('set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET (the Desktop OAuth client)'); process.exit(2); }
const ACCOUNT = 'athanasius.youth.safaga@gmail.com';
const state = randomBytes(16).toString('hex');

function putSecret(name, value) {
  return new Promise((resolve, reject) => {
    const bin = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
    const args = [bin, 'secret', 'put', name, ...(target === 'staging' ? ['--env', 'staging'] : [])];
    const child = spawn(process.execPath, args, { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: ['pipe', 'ignore', 'inherit'] });
    child.stdin.end(value);
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(name + ': wrangler exited ' + code))));
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname !== '/') { res.writeHead(404).end(); return; }
  if (url.searchParams.get('state') !== state || !url.searchParams.get('code')) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('refused: ' + (url.searchParams.get('error') || 'bad state'));
    return;
  }
  try {
    const port = server.address().port;
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: url.searchParams.get('code'), client_id: id, client_secret: secret, redirect_uri: `http://127.0.0.1:${port}/`, grant_type: 'authorization_code' }).toString()
    });
    const body = await r.json();
    if (!body.refresh_token) throw new Error('no refresh token (' + (body.error || r.status) + ')');
    if (!/gmail\.send/.test(body.scope || '')) throw new Error('gmail.send was not granted');
    await putSecret('GMAIL_CLIENT_ID', id);
    await putSecret('GMAIL_CLIENT_SECRET', secret);
    await putSecret('GMAIL_REFRESH_TOKEN', body.refresh_token);
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('done: the Worker (' + target + ') can send as ' + ACCOUNT + '. You can close this tab.');
    console.log(`done: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN set on ${target}.`);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end('failed: ' + err.message);
    console.error('failed: ' + err.message);
    process.exitCode = 1;
  }
  server.close();
});

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const consent = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: id, redirect_uri: `http://127.0.0.1:${port}/`, response_type: 'code', scope: 'https://www.googleapis.com/auth/gmail.send',
    access_type: 'offline', prompt: 'consent', login_hint: ACCOUNT, state
  });
  console.log(`Open this in a browser signed in as ${ACCOUNT} and allow «Send email on your behalf»:\n\n${consent}\n`);
});
