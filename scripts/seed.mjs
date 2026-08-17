/* Set up a fresh shop database.
 *
 * Usage:  npm run seed -- --user owner --password "something long"
 *
 * Safe to run more than once. The owner login is created only if the shop has
 * no users at all.
 */

import { existsSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { getDb, databasePath } from '../lib/db.js';
import { migrate } from '../lib/migrate.js';
import { seed } from '../lib/seed.js';

/**
 * Make sure there is a signing key for login sessions.
 *
 * Generated here rather than asked for, because the shop machine has nobody
 * to ask. A key left to a human to invent is either never set — so nobody can
 * log in — or set to something short and guessable.
 */
function ensureAuthSecret() {
  const file = '.env.local';
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (/^AUTH_SECRET=.+/m.test(existing)) return false;

  const secret = randomBytes(48).toString('base64url');
  const line = `AUTH_SECRET=${secret}\n`;

  if (existing && !existing.endsWith('\n')) appendFileSync(file, '\n');
  existsSync(file) ? appendFileSync(file, line) : writeFileSync(file, line);
  return true;
}

function arg(flag, fallback) {
  const i = process.argv.indexOf(`--${flag}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const db = getDb();
migrate({ db, log: (line) => console.log(' ', line) });

const username = arg('user', 'owner');
const password = arg('password', null);
const name = arg('name', 'Owner');

if (!password) {
  console.error(
    'Refusing to create an owner login without a password.\n' +
      '  npm run seed -- --user owner --password "your password here"\n\n' +
      'A default password on the machine that holds the shop\'s books is a door\n' +
      'left open, and one that nobody remembers to close later.'
  );
  process.exit(1);
}

const result = seed({ db, owner: { username, password, name } });
const secretCreated = ensureAuthSecret();

console.log(`\nDatabase: ${databasePath()}`);
if (secretCreated) console.log('  session signing key written to .env.local');
console.log(`  accounts added: ${result.accounts}`);
console.log(`  counters added: ${result.counters}`);
console.log(`  settings added: ${result.settings}`);
console.log(
  result.owner
    ? `  owner login created: ${result.owner}`
    : '  owner login: already exists, left alone'
);
console.log(
  '\nNo prices, materials or customers were created — those are entered on the\n' +
    'price list screen by the shop.'
);
