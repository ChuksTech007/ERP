/* Migrations.
 *
 * The schema is a numbered sequence of .sql files, applied in order, each one
 * recorded once it has run. Running the migrator twice is therefore harmless
 * — the second run finds nothing to do — which matters because it runs on
 * every start-up on a machine nobody administers.
 *
 * Each file is applied inside a transaction, so a migration that fails
 * halfway leaves the schema exactly as it was rather than in some half-built
 * state that only a developer can unpick. On a shop PC there is no developer.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './db.js';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

function ensureLog(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
}

function pending(db) {
  const done = new Set(db.prepare('SELECT name FROM _migrations').all().map((r) => r.name));
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort() // 001_, 002_ — zero-padded so string order is numeric order
    .filter((f) => !done.has(f));
}

/**
 * Bring the database up to date.
 *
 * Returns what it applied, so start-up can say "applied 2 migrations" rather
 * than being silent about having just changed the shop's schema.
 */
export function migrate({ db = getDb(), log = () => {} } = {}) {
  ensureLog(db);

  const applied = [];
  for (const name of pending(db)) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8');

    /* One transaction per migration. Note that `db.exec` is used rather than
     * prepared statements: migrations contain many statements, and SQLite's
     * DDL is transactional, so a failure rolls the whole file back. */
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(
        name,
        new Date().toISOString()
      );
    })();

    applied.push(name);
    log(`applied ${name}`);
  }

  return applied;
}
