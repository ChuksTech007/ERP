import test from 'node:test';
import assert from 'node:assert/strict';

import { openMemoryDb } from '../lib/db.js';
import { migrate } from '../lib/migrate.js';
import { seed } from '../lib/seed.js';
import { authenticate, createUser, setPassword, retireUser, listUsers } from '../lib/users.js';

const OWNER = { username: 'owner', password: 'a long enough password', name: 'Owner' };

function freshDb() {
  const db = openMemoryDb();
  migrate({ db });
  seed({ db, owner: OWNER });
  return db;
}

test('the owner can sign in', () => {
  const db = freshDb();
  const user = authenticate('owner', OWNER.password, { db });

  assert.ok(user);
  assert.equal(user.role, 'owner');
  // The hash must never travel with the user object.
  assert.equal(user.password_hash, undefined);
});

test('a wrong password is refused', () => {
  const db = freshDb();
  assert.equal(authenticate('owner', 'not the password', { db }), null);
});

test('a username that does not exist is refused the same way', () => {
  const db = freshDb();
  // Same null, no distinguishing detail — otherwise the form becomes a way of
  // discovering who works here.
  assert.equal(authenticate('nobody', 'anything', { db }), null);
});

test('usernames are matched case-insensitively', () => {
  const db = freshDb();
  // Staff type at a counter, not carefully.
  assert.ok(authenticate('OWNER', OWNER.password, { db }));
  assert.ok(authenticate('  Owner  ', OWNER.password, { db }));
});

test('a retired member of staff cannot sign in', () => {
  const db = freshDb();
  createUser({ name: 'Ade', username: 'ade', password: 'staffpassword', role: 'staff' }, { db });
  assert.ok(authenticate('ade', 'staffpassword', { db }));

  retireUser(listUsers({ db }).find((u) => u.username === 'ade').id, { db });

  // Someone who has left the shop must be off the tills immediately.
  assert.equal(authenticate('ade', 'staffpassword', { db }), null);
});

test('short passwords are refused', () => {
  const db = freshDb();
  const result = createUser({ name: 'Ade', username: 'ade', password: 'short', role: 'staff' }, { db });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /at least 8/);
});

test('a username cannot be taken twice', () => {
  const db = freshDb();
  createUser({ name: 'Ade', username: 'ade', password: 'staffpassword', role: 'staff' }, { db });
  const second = createUser({ name: 'Other', username: 'ade', password: 'anotherpass', role: 'staff' }, { db });

  assert.equal(second.ok, false);
  assert.match(second.errors[0], /already taken/);
});

test('the last owner cannot be locked out of the shop', () => {
  const db = freshDb();
  const owner = listUsers({ db }).find((u) => u.role === 'owner');

  const result = retireUser(owner.id, { db });

  // Not recoverable from inside the app if it were allowed.
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /only owner/i);
  assert.ok(authenticate('owner', OWNER.password, { db }));
});

test('an owner can be retired once another owner exists', () => {
  const db = freshDb();
  createUser({ name: 'Second', username: 'second', password: 'ownerpassword', role: 'owner' }, { db });
  const first = listUsers({ db }).find((u) => u.username === 'owner');

  assert.equal(retireUser(first.id, { db }).ok, true);
});

test('a retired user keeps their row, because sales point at it', () => {
  const db = freshDb();
  createUser({ name: 'Ade', username: 'ade', password: 'staffpassword', role: 'staff' }, { db });
  const ade = listUsers({ db }).find((u) => u.username === 'ade');

  retireUser(ade.id, { db });

  assert.equal(listUsers({ db }).length, 1);
  assert.equal(listUsers({ db, includeRetired: true }).length, 2);
});

test('changing a password takes effect and revokes the old one', () => {
  const db = freshDb();
  createUser({ name: 'Ade', username: 'ade', password: 'staffpassword', role: 'staff' }, { db });
  const ade = listUsers({ db }).find((u) => u.username === 'ade');

  setPassword(ade.id, 'a different password', { db });

  assert.equal(authenticate('ade', 'staffpassword', { db }), null);
  assert.ok(authenticate('ade', 'a different password', { db }));
});

test('a blank password never authenticates', () => {
  const db = freshDb();
  assert.equal(authenticate('owner', '', { db }), null);
  assert.equal(authenticate('owner', null, { db }), null);
  assert.equal(authenticate('owner', undefined, { db }), null);
});
