import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { migrate } from '../lib/migrate.js';
import { seed } from '../lib/seed.js';
import { createMaterial, receiveStock } from '../lib/stock.js';
import { createPriceItem } from '../lib/price-items.js';
import { createQuote, acceptQuote, moveStage, collectJob } from '../lib/jobs.js';
import { backupNow, listBackups, verifyBackup, restoreFrom, pruneBackups, backupStatus } from '../lib/backup.js';
import { parseAmount } from '../lib/money.js';
import { trialBalance } from '../lib/ledger.js';

/** A shop with a real day's trading in it, on a real file. */
function tradingShop() {
  const dir = mkdtempSync(path.join(tmpdir(), 'mt-backup-'));
  const file = path.join(dir, 'shop.db');
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  migrate({ db });
  seed({ db, owner: { username: 'owner', password: 'a long password', name: 'Owner' } });

  const mat = createMaterial(
    { name: 'Oak 40mm', category: 'moulding', baseUnit: 'mm', packSize: 3000,
      packLabel: '3 m length', costPerPackKobo: parseAmount('10,500'), mouldingWidthMm: 40 },
    { db }
  ).id;
  receiveStock({ materialId: mat, packs: 20, onCredit: true }, { db });

  const oak = createPriceItem(
    { name: 'Oak 40mm', category: 'moulding', mode: 'per_m', priceKobo: parseAmount('3,500'),
      mouldingWidthMm: 40, wastageMm: 150, materialId: mat },
    { db }
  ).id;

  const quote = createQuote(
    {
      customer: { name: 'Mrs Adeyemi', phone: '0803 111 2222' },
      items: [{ description: 'Wedding portrait', artworkWidthMm: 600, artworkHeightMm: 900,
                mountBorderMm: 50, mouldingPriceId: oak, labourKobo: parseAmount('2,500') }],
    },
    { db }
  );
  acceptQuote({ jobId: quote.id, depositKobo: parseAmount('5,000'),
                custody: [{ description: 'Wedding portrait', conditionNote: 'Tear top-left' }] }, { db });
  moveStage({ jobId: quote.id, stage: 'done' }, { db });
  collectJob({ jobId: quote.id, paymentKobo: parseAmount('5,000'), releasedTo: 'Mrs Adeyemi' }, { db });

  return { db, file, dir };
}

test('a backup can be taken while the shop is trading', () => {
  const { db, dir } = tradingShop();

  // WAL means recent writes are in a sidecar, so a plain file copy can miss
  // them. VACUUM INTO asks SQLite for a consistent snapshot instead.
  const result = backupNow({ db, dir });

  assert.equal(result.ok, true);
  assert.ok(existsSync(result.file));
  assert.ok(result.sizeBytes > 0);

  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test('a backup contains the day that was traded', () => {
  const { db, dir } = tradingShop();
  const { file } = backupNow({ db, dir });

  const check = verifyBackup(file);
  assert.equal(check.ok, true);
  assert.equal(check.counts.jobs, 1);
  assert.equal(check.counts.sales, 1);
  assert.equal(check.counts.customers, 1);
  assert.ok(check.counts.journal_entries > 0);
  // A backup whose books do not balance would not balance if restored.
  assert.equal(check.balanced, true);

  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test('a damaged backup is refused rather than trusted', () => {
  const { db, dir } = tradingShop();
  const broken = path.join(dir, 'broken.db');
  writeFileSync(broken, 'this is not a database');

  // "There is a file" and "there is a backup" are different claims.
  assert.equal(verifyBackup(broken).ok, false);

  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test('a missing backup file is refused', () => {
  assert.equal(verifyBackup('/nowhere/at/all.db').ok, false);
});

/* ------------------------------------------------- the real test */

test('a wiped shop comes back from its backup, whole', () => {
  const { db, file, dir } = tradingShop();

  const before = {
    jobs: db.prepare('SELECT count(*) n FROM jobs').get().n,
    sales: db.prepare('SELECT count(*) n FROM sales').get().n,
    invoice: db.prepare('SELECT invoice_number FROM sales').get().invoice_number,
    customer: db.prepare('SELECT name, phone FROM customers').get(),
    tag: db.prepare('SELECT tag_number, released_to FROM custody_items').get(),
    stock: db.prepare('SELECT quantity_base FROM materials').get().quantity_base,
    balanced: trialBalance({ db }).balanced,
  };

  const backup = backupNow({ db, dir });

  // The disaster: the shop's data is gone. Foreign keys are switched off
  // because a real catastrophe is not tidy about the order it destroys
  // things in.
  db.pragma('foreign_keys = OFF');
  db.prepare('DELETE FROM payments').run();
  db.prepare('DELETE FROM sale_items').run();
  db.prepare('DELETE FROM sales').run();
  db.prepare('DELETE FROM custody_items').run();
  db.prepare('DELETE FROM job_stage_events').run();
  db.prepare('DELETE FROM job_items').run();
  db.prepare('DELETE FROM jobs').run();
  db.prepare('DELETE FROM customers').run();
  assert.equal(db.prepare('SELECT count(*) n FROM jobs').get().n, 0);
  db.close();

  const restore = restoreFrom(backup.file, { target: file });
  assert.equal(restore.ok, true);
  // A restore is itself undoable — the wiped file is kept aside first,
  // because restoring the wrong copy happens, usually in a hurry.
  assert.equal(restore.keptAside.length, 1);
  assert.ok(existsSync(restore.keptAside[0]));

  // A backup nobody has ever restored is a file you hope is a backup.
  const back = new Database(file);
  assert.equal(back.prepare('SELECT count(*) n FROM jobs').get().n, before.jobs);
  assert.equal(back.prepare('SELECT count(*) n FROM sales').get().n, before.sales);
  assert.equal(back.prepare('SELECT invoice_number FROM sales').get().invoice_number, before.invoice);
  assert.deepEqual(back.prepare('SELECT name, phone FROM customers').get(), before.customer);
  assert.deepEqual(back.prepare('SELECT tag_number, released_to FROM custody_items').get(), before.tag);
  assert.equal(back.prepare('SELECT quantity_base FROM materials').get().quantity_base, before.stock);
  assert.equal(trialBalance({ db: back }).balanced, before.balanced);

  back.close();
  rmSync(dir, { recursive: true, force: true });
});

test('the restored shop can keep trading', () => {
  const { db, file, dir } = tradingShop();
  const backup = backupNow({ db, dir });
  db.close();

  restoreFrom(backup.file, { target: file });

  // Not just readable — writable, with its counters and schema intact.
  const back = new Database(file);
  back.pragma('foreign_keys = ON');

  const oak = back.prepare("SELECT id FROM price_items LIMIT 1").get().id;
  const quote = createQuote(
    {
      customer: { name: 'Second customer', phone: '0803 999 8888' },
      items: [{ description: 'Certificate', artworkWidthMm: 300, artworkHeightMm: 400, mouldingPriceId: oak }],
    },
    { db: back }
  );

  assert.equal(quote.ok, true);
  // Numbering carried on from where it left off rather than reissuing.
  assert.equal(quote.jobNumber, 'Q-0002');

  back.close();
  rmSync(dir, { recursive: true, force: true });
});

/* ---------------------------------------------------- housekeeping */

test('the live database is never mistaken for a backup', () => {
  const { db, dir } = tradingShop();
  // The database itself lives in this folder. Point BACKUP_DIR at the working
  // folder — an easy mistake — and matching any .db file would list the
  // shop's live books as a backup, and prune would eventually delete them.
  backupNow({ db, dir });

  const found = listBackups({ dir });
  assert.equal(found.length, 1);
  assert.ok(!found.some((b) => b.name === 'shop.db'));

  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test('old copies are pruned but recent ones are kept', () => {
  const { db, dir } = tradingShop();

  for (let n = 0; n < 5; n++) backupNow({ db, dir, label: `n${n}` });
  assert.equal(listBackups({ dir }).length, 5);

  const removed = pruneBackups({ dir, keep: 3 });
  assert.equal(removed.length, 2);
  assert.equal(listBackups({ dir }).length, 3);

  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test('a shop that has never backed up is told so', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mt-empty-'));

  const status = backupStatus({ dir });
  assert.equal(status.never, true);
  assert.equal(status.overdue, true);

  rmSync(dir, { recursive: true, force: true });
});

test('a fresh backup is not overdue', () => {
  const { db, dir } = tradingShop();
  backupNow({ db, dir });

  const status = backupStatus({ dir });
  assert.equal(status.never, false);
  assert.equal(status.daysAgo, 0);
  assert.equal(status.overdue, false);

  db.close();
  rmSync(dir, { recursive: true, force: true });
});
