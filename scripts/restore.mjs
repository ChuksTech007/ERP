/* Put a backup back.
 *
 *   npm run restore -- --file backups/shop_2026-08-17_1432.db
 *   npm run restore -- --list
 *
 * STOP THE APP FIRST. The live file cannot be replaced underneath open
 * connections, least of all on Windows.
 *
 * The current database is copied aside before anything is overwritten, so if
 * the wrong copy is restored — which happens, usually in a hurry — nothing is
 * actually lost.
 */

import { databasePath } from '../lib/db.js';
import { listBackups, restoreFrom, verifyBackup, backupDir } from '../lib/backup.js';

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(`--${flag}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const dir = arg('dir', backupDir());
const backups = listBackups({ dir });

if (process.argv.includes('--list') || !arg('file', null)) {
  console.log(`Backups in ${dir}:\n`);
  if (backups.length === 0) {
    console.log('  none. Run `npm run backup` first.');
  } else {
    for (const backup of backups) {
      const check = verifyBackup(backup.file);
      console.log(
        `  ${backup.name}  ${(backup.sizeBytes / 1024).toFixed(0)} KB  ` +
          (check.ok
            ? `${check.counts.jobs} jobs, ${check.counts.sales} invoices${check.balanced ? '' : '  BOOKS DO NOT BALANCE'}`
            : `UNREADABLE — ${check.errors.join(' ')}`)
      );
    }
    console.log('\nRestore one with:  npm run restore -- --file <path>');
  }
  process.exit(0);
}

const file = arg('file');
const result = restoreFrom(file);

if (!result.ok) {
  console.error('Refused to restore:', result.errors.join(' '));
  process.exit(1);
}

console.log(`Restored ${result.restored}`);
console.log(`      → ${result.target}`);
console.log(`  ${result.contents.jobs} jobs, ${result.contents.sales} invoices, ${result.contents.customers} customers`);
if (result.keptAside.length) {
  console.log(`\nThe database that was replaced is kept at:\n  ${result.keptAside[0]}`);
  console.log('Delete it once you are sure the restore is the one you wanted.');
}
