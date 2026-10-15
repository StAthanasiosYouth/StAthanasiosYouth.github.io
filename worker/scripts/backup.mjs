// Encrypted D1 backups (age, X25519 — readable by the standard `age` CLI too).
//
//   node scripts/backup.mjs keygen <identity-file>        new key pair; prints the PUBLIC recipient
//   node scripts/backup.mjs encrypt <in.sql> <out.age>     uses env BACKUP_AGE_RECIPIENT (public)
//   node scripts/backup.mjs decrypt <in.age> <out.sql> <identity-file>
//
// The identity (private key) NEVER goes in the repo or in CI. Keep it in two
// admins' password managers. Without it the backups cannot be read.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { Encrypter, Decrypter, generateX25519Identity, identityToRecipient } from 'age-encryption';

const [cmd, a, b, c] = process.argv.slice(2);

if (cmd === 'keygen') {
  if (!a) throw new Error('usage: keygen <identity-file>');
  if (existsSync(a)) throw new Error('refusing to overwrite ' + a);
  const identity = await generateX25519Identity();
  writeFileSync(a, '# athanasios D1 backup identity — PRIVATE, keep offline\n' + identity + '\n', { mode: 0o600 });
  console.log(await identityToRecipient(identity));
} else if (cmd === 'encrypt') {
  const recipient = process.env.BACKUP_AGE_RECIPIENT;
  if (!recipient || !recipient.startsWith('age1')) throw new Error('BACKUP_AGE_RECIPIENT (age1…) not set');
  const e = new Encrypter();
  e.addRecipient(recipient);
  writeFileSync(b, await e.encrypt(readFileSync(a)));
  console.log('encrypted', a, '→', b);
} else if (cmd === 'decrypt') {
  const identity = readFileSync(c, 'utf8').split('\n').find(l => l.startsWith('AGE-SECRET-KEY-'));
  const d = new Decrypter();
  d.addIdentity(identity.trim());
  writeFileSync(b, await d.decrypt(readFileSync(a)));
  console.log('decrypted', a, '→', b);
} else {
  console.log('usage: keygen | encrypt | decrypt (see header)');
  process.exit(2);
}
