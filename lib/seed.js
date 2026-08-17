/* Setting up a fresh shop.
 *
 * Seeds the things that are structural — the chart of accounts, document
 * numbering, an owner login — and deliberately seeds NO prices, no materials
 * and no customers. Master's Technology enter their own on the price list
 * screen.
 *
 * That restraint is the point. A seeded price list is one nobody trusts:
 * staff cannot tell invented rows from real ones, so they half-edit it and
 * quote from memory instead, and the shop ends up with a system it works
 * around rather than from.
 *
 * Everything here is idempotent. It runs on a fresh database and it runs on a
 * shop that has been trading for a year, and in the second case it changes
 * nothing.
 */

import bcrypt from 'bcryptjs';
import { getDb, newId, now } from './db.js';
import { CHART, COUNTERS, DEFAULT_SETTINGS } from './chart-of-accounts.js';

function seedAccounts(db) {
  // INSERT ... ON CONFLICT DO NOTHING rather than a SELECT-then-INSERT: the
  // uniqueness of the code is enforced by the database, so there is no window
  // between the check and the write.
  const insert = db.prepare(`
    INSERT INTO accounts (id, code, name, type, normal, system, created_at, updated_at)
    VALUES (@id, @code, @name, @type, @normal, @system, @at, @at)
    ON CONFLICT (code) DO NOTHING
  `);

  let added = 0;
  for (const account of CHART) {
    added += insert.run({ ...account, id: newId(), at: now() }).changes;
  }
  return added;
}

function seedCounters(db) {
  const insert = db.prepare(`
    INSERT INTO counters (name, prefix, next_value, updated_at)
    VALUES (@name, @prefix, 1, @at)
    ON CONFLICT (name) DO NOTHING
  `);

  let added = 0;
  for (const counter of COUNTERS) {
    added += insert.run({ ...counter, at: now() }).changes;
  }
  return added;
}

function seedSettings(db) {
  /* DO NOTHING, not DO UPDATE. If the owner has changed the shop phone
   * number, a later run of this must not put the blank default back. */
  const insert = db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (@key, @value, @at)
    ON CONFLICT (key) DO NOTHING
  `);

  let added = 0;
  for (const setting of DEFAULT_SETTINGS) {
    added += insert.run({ ...setting, at: now() }).changes;
  }
  return added;
}

/**
 * The first login.
 *
 * Created only when the shop has no users at all — so this cannot be used to
 * reset a forgotten password, and cannot quietly reinstate an owner account
 * that was deliberately deactivated.
 */
function seedOwner(db, { username, password, name }) {
  const existing = db.prepare('SELECT count(*) n FROM users').get().n;
  if (existing > 0) return null;

  db.prepare(`
    INSERT INTO users (id, name, username, password_hash, role, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'owner', 1, ?, ?)
  `).run(newId(), name, username, bcrypt.hashSync(password, 10), now(), now());

  return username;
}

export function seed({ db = getDb(), owner } = {}) {
  return db.transaction(() => ({
    accounts: seedAccounts(db),
    counters: seedCounters(db),
    settings: seedSettings(db),
    owner: owner ? seedOwner(db, owner) : null,
  }))();
}

/**
 * Take the next document number and advance the counter.
 *
 * Must be called inside the same transaction as whatever it numbers. If the
 * sale fails to save after this has run, the rollback takes the counter back
 * with it, and the number is not burnt.
 *
 * Padded to four digits so that invoices sort correctly as text — INV-0002
 * before INV-0010, which "INV-2" and "INV-10" would get backwards on every
 * screen in the system.
 */
export function nextNumber(db, name) {
  const row = db.prepare('SELECT prefix, next_value FROM counters WHERE name = ?').get(name);
  if (!row) throw new Error(`There is no counter called "${name}".`);

  db.prepare('UPDATE counters SET next_value = next_value + 1, updated_at = ? WHERE name = ?').run(
    now(),
    name
  );

  return `${row.prefix}${String(row.next_value).padStart(4, '0')}`;
}
