/* Backups.
 *
 * The shop's entire books — every sale, every customer, every naira owed —
 * live in one file on one PC. There is no second machine and no cloud copy.
 * A dead disk, a stolen tower or a mistaken delete takes the lot, and there
 * is nothing anywhere to rebuild it from.
 *
 * So this is not a convenience feature. It is the difference between a bad
 * afternoon and the end of the business's financial history.
 *
 * Two things people get wrong about backing up SQLite:
 *
 *   1. Copying the file while the app is running can produce a corrupt copy.
 *      In WAL mode the .db file is not the whole story — recent writes live
 *      in a sidecar — so a plain copy can miss them or catch them halfway.
 *      `VACUUM INTO` asks SQLite itself for a consistent snapshot, which is
 *      safe to take mid-trading and comes out compacted.
 *
 *   2. A backup on the same disk as the original protects against nothing
 *      that actually happens. The disk that dies takes both. Copies belong on
 *      a flash drive or an external disk.
 */

import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { getDb, databasePath } from './db.js';

/** Where copies go. A drive that is not this one, ideally. */
export function backupDir() {
  return process.env.BACKUP_DIR || path.join(process.cwd(), 'backups');
}

/** 2026-08-17_1432 — sorts chronologically as text, readable to a person. */
function stamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `_${pad(date.getHours())}${pad(date.getMinutes())}`
  );
}

/**
 * Take a backup now.
 *
 * Safe while the shop is trading. Returns the file written and its size, so
 * the screen can show something concrete rather than "done" — a backup that
 * silently wrote nothing looks identical to one that worked.
 */
export function backupNow({ db = getDb(), dir = backupDir(), label = null } = {}) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const name = `shop_${stamp()}${label ? `_${label}` : ''}.db`;
  const target = path.join(dir, name);

  if (existsSync(target)) unlinkSync(target); // VACUUM INTO refuses to overwrite

  /* Parameter binding is not allowed for VACUUM INTO, so the path is quoted
   * by doubling single quotes — the SQL string-literal escape. The path comes
   * from configuration rather than from anything a user types. */
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);

  const { size } = statSync(target);
  return { ok: true, file: target, name, sizeBytes: size, at: new Date().toISOString() };
}

/* Only files this module itself wrote count as backups.
 *
 * Matching any .db file would be a data-loss path in the very code meant to
 * prevent data loss: point BACKUP_DIR at the folder holding the live database
 * — an easy thing to do — and the shop's working file is listed as a backup,
 * and pruning would eventually delete it. */
const BACKUP_NAME = /^shop_\d{4}-\d{2}-\d{2}_\d{4}(_.+)?\.db$/;

/** Every backup on hand, newest first. */
export function listBackups({ dir = backupDir() } = {}) {
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((name) => BACKUP_NAME.test(name))
    .map((name) => {
      const file = path.join(dir, name);
      const info = statSync(file);
      return { name, file, sizeBytes: info.size, at: info.mtime.toISOString() };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** When the last backup was taken, or null if there has never been one. */
export function lastBackupAt({ dir = backupDir() } = {}) {
  return listBackups({ dir })[0]?.at ?? null;
}

/**
 * How overdue a backup is.
 *
 * Drives a warning the owner cannot miss. A backup routine that depends on
 * somebody remembering a command does not survive a busy Saturday, so the app
 * has to be the one doing the remembering.
 */
export function backupStatus({ dir = backupDir(), warnAfterDays = 3 } = {}) {
  const at = lastBackupAt({ dir });
  if (!at) return { at: null, daysAgo: null, overdue: true, never: true };

  const daysAgo = Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000);
  return { at, daysAgo, overdue: daysAgo >= warnAfterDays, never: false };
}

/**
 * Throw away old copies, keeping the most recent few.
 *
 * Deliberately conservative. Running out of disk is a nuisance; deleting the
 * only good copy because a fault went unnoticed for a fortnight is not
 * recoverable, so the default keeps a month of daily backups.
 */
export function pruneBackups({ dir = backupDir(), keep = 30 } = {}) {
  const all = listBackups({ dir });
  const removed = [];

  for (const backup of all.slice(keep)) {
    unlinkSync(backup.file);
    removed.push(backup.name);
  }

  return removed;
}

/**
 * Check that a backup file is actually a working database.
 *
 * A file of the right size and name can still be unreadable. This opens it,
 * runs SQLite's own integrity check and counts what is inside, so "there is a
 * backup" can mean something more than "there is a file".
 */
export function verifyBackup(file) {
  if (!existsSync(file)) return { ok: false, errors: ['That backup file is not there.'] };

  let db;
  try {
    db = new Database(file, { readonly: true });

    const integrity = db.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') return { ok: false, errors: [`SQLite reports: ${integrity}`] };

    const counts = {};
    for (const table of ['jobs', 'sales', 'payments', 'customers', 'journal_entries', 'stock_movements']) {
      counts[table] = db.prepare(`SELECT count(*) n FROM ${table}`).get().n;
    }

    // A ledger that does not balance in the backup would not balance if
    // restored, and is worth knowing about before it is needed.
    const { drift } = db
      .prepare('SELECT COALESCE(SUM(amount_kobo), 0) drift FROM journal_lines')
      .get();

    return { ok: true, counts, balanced: drift === 0, driftKobo: drift };
  } catch (error) {
    return { ok: false, errors: [error.message] };
  } finally {
    db?.close();
  }
}

/**
 * Put a backup back.
 *
 * The app must be stopped: the live file cannot be replaced underneath open
 * connections, least of all on Windows.
 *
 * The current database is copied aside BEFORE anything is overwritten, so a
 * restore is itself undoable. Restoring the wrong copy is a thing that
 * happens, usually in a hurry, and without this it destroys the very data
 * somebody was trying to rescue.
 */
export function restoreFrom(file, { target = databasePath() } = {}) {
  const check = verifyBackup(file);
  if (!check.ok) return { ok: false, errors: check.errors };

  const rescued = [];

  if (existsSync(target)) {
    const aside = `${target}.replaced_${stamp()}`;
    copyFileSync(target, aside);
    rescued.push(aside);
  }

  /* The WAL and shared-memory sidecars belong to the file being replaced. Left
   * behind, SQLite would try to apply the old file's pending writes on top of
   * the restored one, which is how a restore corrupts what it just put back. */
  for (const suffix of ['-wal', '-shm']) {
    if (existsSync(target + suffix)) unlinkSync(target + suffix);
  }

  copyFileSync(file, target);

  return { ok: true, restored: file, target, keptAside: rescued, contents: check.counts };
}
