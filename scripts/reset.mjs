/* Wipe the trading data and start clean.
 *
 *   npm run reset -- --yes
 *
 * Clears jobs, invoices, payments, customers, stock, prices, expenses and the
 * whole ledger, and puts the document numbering back to 1. Keeps the login,
 * the chart of accounts and the shop settings.
 *
 * For clearing out practice data before the shop starts using this for real.
 * It takes a backup first regardless, because "I only wanted to clear the
 * test data" is a sentence people say after clearing the real data.
 */

import { getDb, databasePath } from '../lib/db.js';
import { backupNow } from '../lib/backup.js';

const db = getDb();

const counts = () => ({
  jobs: db.prepare('SELECT count(*) n FROM jobs').get().n,
  invoices: db.prepare('SELECT count(*) n FROM sales').get().n,
  customers: db.prepare('SELECT count(*) n FROM customers').get().n,
  materials: db.prepare('SELECT count(*) n FROM materials').get().n,
  prices: db.prepare('SELECT count(*) n FROM price_items').get().n,
});

const before = counts();
console.log(`Database: ${databasePath()}`);
console.log(`  ${before.jobs} jobs, ${before.invoices} invoices, ${before.customers} customers, ` +
            `${before.materials} materials, ${before.prices} price items`);

if (!process.argv.includes('--yes')) {
  console.log('\nThis will delete all of it. Nothing is kept except the login,');
  console.log('the chart of accounts and the shop settings.');
  console.log('\nRun again with --yes if that is what you want:');
  console.log('  npm run reset -- --yes');
  process.exit(0);
}

const backup = backupNow({ db, label: 'before-reset' });
console.log(`\nBacked up first → ${backup.name}`);

/* Foreign keys off for the duration: the tables reference each other in a
 * cycle and there is no order that satisfies every constraint. */
db.pragma('foreign_keys = OFF');
db.transaction(() => {
  for (const table of [
    'job_stage_events', 'job_items', 'custody_items', 'sale_items', 'payments',
    'sales', 'jobs', 'stock_movements', 'materials', 'price_items', 'expenses',
    'suppliers', 'customers', 'journal_lines', 'journal_entries',
  ]) {
    db.prepare(`DELETE FROM ${table}`).run();
  }
  db.prepare('UPDATE counters SET next_value = 1').run();
})();
db.pragma('foreign_keys = ON');

console.log('Cleared. The shop is ready for real data.');
console.log(`  login kept, ${db.prepare('SELECT count(*) n FROM accounts').get().n} accounts kept, numbering back to 1`);
