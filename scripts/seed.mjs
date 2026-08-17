/* Set up a fresh shop database.
 *
 * Usage:  npm run seed -- --user owner --password "something long"
 *
 * Safe to run more than once. The owner login is created only if the shop has
 * no users at all.
 */

import { getDb, databasePath } from '../lib/db.js';
import { migrate } from '../lib/migrate.js';
import { seed } from '../lib/seed.js';

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

console.log(`\nDatabase: ${databasePath()}`);
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
