/* Bring the shop's database up to date.
 *
 * Run by hand, and on every start-up. Safe either way: it applies only what
 * has not been applied, and says nothing when there is nothing to do.
 */

import { migrate } from '../lib/migrate.js';
import { getDb, databasePath } from '../lib/db.js';

const applied = migrate({ db: getDb(), log: (line) => console.log(' ', line) });

console.log(
  applied.length
    ? `Database at ${databasePath()} is up to date (${applied.length} applied).`
    : `Database at ${databasePath()} was already up to date.`
);
