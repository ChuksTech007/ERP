/* Staff accounts. */

import bcrypt from 'bcryptjs';
import { getDb, newId, now } from './db.js';

export const ROLES = {
  owner: 'Owner — sees costs, margins and the books',
  manager: 'Manager — runs the shop, no cost prices',
  staff: 'Staff — quotes and sells',
};

/**
 * Check a username and password.
 *
 * Returns the user or null, and deliberately says nothing about WHICH half
 * was wrong. "No such user" tells someone guessing that they should keep
 * trying other names; "wrong password" tells them they have found a real one.
 */
export function authenticate(username, password, { db = getDb() } = {}) {
  const user = db
    .prepare('SELECT * FROM users WHERE username = ? AND deleted_at IS NULL')
    .get(String(username || '').trim().toLowerCase());

  /* Hash even when there is no such user. Without this, a missing username
   * returns immediately while a real one takes ~100ms to hash, and the
   * difference is measurable from outside — which turns the login form into a
   * way of listing who works here. */
  const hash = user?.password_hash || '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
  const ok = bcrypt.compareSync(String(password || ''), hash);

  if (!user || !ok || !user.active) return null;

  return { id: user.id, name: user.name, username: user.username, role: user.role };
}

export function listUsers({ db = getDb(), includeRetired = false } = {}) {
  return db
    .prepare(
      `SELECT id, name, username, role, active, created_at FROM users
       ${includeRetired ? '' : 'WHERE deleted_at IS NULL'}
       ORDER BY name`
    )
    .all();
}

export function createUser({ name, username, password, role }, { db = getDb() } = {}) {
  const errors = [];
  const clean = String(username || '').trim().toLowerCase();

  if (!String(name || '').trim()) errors.push('Give the person a name.');
  if (!clean) errors.push('Give them a username.');
  if (!/^[a-z0-9._-]+$/.test(clean)) errors.push('Usernames can only use letters, numbers, dot, dash and underscore.');
  if (String(password || '').length < 8) errors.push('The password must be at least 8 characters.');
  if (!ROLES[role]) errors.push('Pick a role.');

  const taken = db.prepare('SELECT 1 FROM users WHERE username = ?').get(clean);
  if (taken) errors.push('That username is already taken.');

  if (errors.length) return { ok: false, errors };

  const id = newId();
  db.prepare(
    `INSERT INTO users (id, name, username, password_hash, role, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(id, String(name).trim(), clean, bcrypt.hashSync(password, 10), role, now(), now());

  return { ok: true, id };
}

export function setPassword(id, password, { db = getDb() } = {}) {
  if (String(password || '').length < 8) {
    return { ok: false, errors: ['The password must be at least 8 characters.'] };
  }
  const result = db
    .prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
    .run(bcrypt.hashSync(password, 10), now(), id);
  return { ok: result.changes > 0 };
}

/**
 * Take someone off the tills.
 *
 * Retired rather than deleted: their name is on every sale they ever rang up,
 * and those records have to keep pointing somewhere real.
 */
export function retireUser(id, { db = getDb() } = {}) {
  const owners = db
    .prepare("SELECT count(*) n FROM users WHERE role = 'owner' AND active = 1 AND deleted_at IS NULL")
    .get().n;
  const target = db.prepare('SELECT role FROM users WHERE id = ?').get(id);

  // Locking the last owner out of the shop's own books is not recoverable
  // from inside the app.
  if (target?.role === 'owner' && owners <= 1) {
    return { ok: false, errors: ['This is the only owner. Make someone else an owner first.'] };
  }

  const result = db
    .prepare('UPDATE users SET active = 0, deleted_at = ?, updated_at = ? WHERE id = ?')
    .run(now(), now(), id);
  return { ok: result.changes > 0 };
}
