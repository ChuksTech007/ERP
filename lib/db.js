/* The database.
 *
 * One SQLite file on the shop's machine. That is the whole of it — no server
 * to install, no service to start, nothing that can fail to come up on a
 * Monday morning. Backing the shop up is copying a file; restoring is copying
 * it back; putting a copy on the owner's laptop is the same.
 *
 * Other tills reach this machine over the shop's own router and get the same
 * database, so there is one set of books rather than several that have to be
 * reconciled later.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

/** Where the file lives. Overridable so tests can run against memory. */
export function databasePath() {
  return process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'shop.db');
}

function configure(db) {
  /* Write-Ahead Logging. The reason is the second till: without WAL, one
   * person saving a sale blocks everyone else from so much as reading, and on
   * a busy Saturday the shop feels like it has frozen. With it, readers never
   * block and only writers queue. */
  db.pragma('journal_mode = WAL');

  /* Foreign keys are OFF by default in SQLite — a footgun worth knowing
   * about. Without this, a payment can reference a sale that does not exist
   * and nothing complains until the books will not balance. */
  db.pragma('foreign_keys = ON');

  /* Two tills will occasionally try to write at the same moment. Rather than
   * failing instantly with "database is locked" in a cashier's face, wait —
   * the other write takes milliseconds. */
  db.pragma('busy_timeout = 5000');

  /* Safe in WAL mode: a crash can lose the last transaction or two but cannot
   * corrupt the file. FULL would fsync on every commit, which on the kind of
   * disk a shop PC has makes each sale noticeably slow. */
  db.pragma('synchronous = NORMAL');

  return db;
}

/**
 * Open the database.
 *
 * Held on `globalThis` because Next reloads modules on every edit in
 * development, and a fresh connection per reload leaks handles onto the same
 * file until the WAL will not checkpoint.
 */
export function getDb() {
  if (globalThis.__shopDb) return globalThis.__shopDb;

  const file = databasePath();
  const dir = path.dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  globalThis.__shopDb = configure(new Database(file));
  return globalThis.__shopDb;
}

/** A throwaway database in memory, for tests. */
export function openMemoryDb() {
  return configure(new Database(':memory:'));
}

/**
 * Run a block as one all-or-nothing unit.
 *
 * This is the guarantee the whole system is built on. Recording a sale means
 * writing the sale, its lines, the payment, the stock movements and the
 * journal entries — five tables that must agree. Wrapped in this, either all
 * of it lands or none of it does, and there is no state where the shop has
 * taken money that the ledger has never heard of.
 */
export function transaction(fn, db = getDb()) {
  return db.transaction(fn)();
}

/** ISO timestamp, the single format every date column in this schema holds. */
export function now() {
  return new Date().toISOString();
}

/** Primary keys are UUIDs, generated here rather than by the database.
 *
 * Autoincrementing integers would be smaller and faster, and would also mean
 * that the day a second branch or an offline till appears, every id collides.
 * A UUID is decided before the row is written, by whoever is writing it, so
 * merging two databases is possible without renumbering anything. */
export function newId() {
  return crypto.randomUUID();
}
