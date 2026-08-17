/* Take a backup now.
 *
 *   npm run backup
 *   npm run backup -- --dir E:\MastersTechBackups
 *
 * Safe while the shop is open. Point --dir at a flash drive or external disk:
 * a copy on the same disk as the original protects against nothing that
 * actually happens, because the disk that dies takes both.
 */

import { getDb, databasePath } from '../lib/db.js';
import { backupNow, pruneBackups, verifyBackup, backupDir } from '../lib/backup.js';

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(`--${flag}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const dir = arg('dir', backupDir());
const keep = Number(arg('keep', 30));

const result = backupNow({ db: getDb(), dir });
const check = verifyBackup(result.file);

console.log(`Backed up ${databasePath()}`);
console.log(`        → ${result.file}`);
console.log(`  ${(result.sizeBytes / 1024).toFixed(0)} KB`);

if (!check.ok) {
  console.error('\nWARNING: the copy could not be read back:', check.errors.join(' '));
  process.exit(1);
}

console.log(
  `  contains ${check.counts.jobs} jobs, ${check.counts.sales} invoices, ` +
    `${check.counts.customers} customers` + (check.balanced ? ', books balanced' : ', BOOKS DO NOT BALANCE')
);

const removed = pruneBackups({ dir, keep });
if (removed.length) console.log(`  removed ${removed.length} older copies, keeping the newest ${keep}`);
