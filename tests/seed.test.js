import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';

import { openMemoryDb } from '../lib/db.js';
import { migrate } from '../lib/migrate.js';
import { seed, nextNumber } from '../lib/seed.js';
import { CHART, ACCT } from '../lib/chart-of-accounts.js';

function freshDb() {
  const db = openMemoryDb();
  migrate({ db });
  return db;
}

const OWNER = { username: 'owner', password: 'a long enough password', name: 'Owner' };

test('seeds the chart of accounts', () => {
  const db = freshDb();
  const result = seed({ db, owner: OWNER });

  assert.equal(result.accounts, CHART.length);
  assert.equal(db.prepare('SELECT count(*) n FROM accounts').get().n, CHART.length);
});

test('seeding twice changes nothing', () => {
  const db = freshDb();
  seed({ db, owner: OWNER });
  const second = seed({ db, owner: OWNER });

  // Runs on every setup, on fresh machines and on shops that have traded for
  // a year. The second case must be a no-op.
  assert.equal(second.accounts, 0);
  assert.equal(second.counters, 0);
  assert.equal(second.settings, 0);
  assert.equal(second.owner, null);
  assert.equal(db.prepare('SELECT count(*) n FROM accounts').get().n, CHART.length);
  assert.equal(db.prepare('SELECT count(*) n FROM users').get().n, 1);
});

test('re-seeding does not overwrite settings the owner has changed', () => {
  const db = freshDb();
  seed({ db, owner: OWNER });

  db.prepare("UPDATE settings SET value = '0803 111 2222' WHERE key = 'shop.phone'").run();
  seed({ db, owner: OWNER });

  const phone = db.prepare("SELECT value FROM settings WHERE key = 'shop.phone'").get().value;
  assert.equal(phone, '0803 111 2222');
});

test('customer deposits are a liability, not income', () => {
  const db = freshDb();
  seed({ db, owner: OWNER });

  // Money taken for work not yet delivered is owed back if the job falls
  // through. Booking it as income overstates the month it arrives in.
  const deposits = db
    .prepare('SELECT type, normal FROM accounts WHERE code = ?')
    .get(ACCT.CUSTOMER_DEPOSITS);
  assert.equal(deposits.type, 'liability');
  assert.equal(deposits.normal, 'credit');
});

test('breakage is separated from the cost of materials used', () => {
  const db = freshDb();
  seed({ db, owner: OWNER });

  const breakage = db.prepare('SELECT type FROM accounts WHERE code = ?').get(ACCT.BREAKAGE);
  const materials = db.prepare('SELECT type FROM accounts WHERE code = ?').get(ACCT.COST_OF_MATERIALS);
  assert.equal(breakage.type, 'expense');
  assert.equal(materials.type, 'expense');
  assert.notEqual(ACCT.BREAKAGE, ACCT.COST_OF_MATERIALS);
});

test('seeds no prices, materials or customers', () => {
  const db = freshDb();
  seed({ db, owner: OWNER });

  // The shop enters its own. An invented price list is one staff cannot tell
  // apart from the real thing, so they stop trusting all of it.
  assert.equal(db.prepare('SELECT count(*) n FROM price_items').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM materials').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM customers').get().n, 0);
});

test('the owner password is hashed, never stored as typed', () => {
  const db = freshDb();
  seed({ db, owner: OWNER });

  const user = db.prepare('SELECT password_hash, role FROM users WHERE username = ?').get('owner');
  assert.notEqual(user.password_hash, OWNER.password);
  assert.ok(bcrypt.compareSync(OWNER.password, user.password_hash));
  assert.equal(user.role, 'owner');
});

test('an existing owner is never silently replaced', () => {
  const db = freshDb();
  seed({ db, owner: OWNER });
  seed({ db, owner: { username: 'attacker', password: 'let me in', name: 'x' } });

  // Otherwise re-running setup would be a password reset for anyone with
  // access to the machine.
  assert.equal(db.prepare('SELECT count(*) n FROM users').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) n FROM users WHERE username = ?').get('attacker').n, 0);
});

/* ------------------------------------------------------- numbering */

test('document numbers run in sequence and pad for sorting', () => {
  const db = freshDb();
  seed({ db, owner: OWNER });

  assert.equal(nextNumber(db, 'invoice'), 'INV-0001');
  assert.equal(nextNumber(db, 'invoice'), 'INV-0002');
  assert.equal(nextNumber(db, 'job'), 'J-0001');
  assert.equal(nextNumber(db, 'claim_ticket'), 'T-0001');
});

test('padded so that ten sorts after two', () => {
  const db = freshDb();
  seed({ db, owner: OWNER });

  const numbers = Array.from({ length: 12 }, () => nextNumber(db, 'invoice'));
  const sorted = [...numbers].sort();
  // "INV-2" and "INV-10" would come out backwards on every screen.
  assert.deepEqual(sorted, numbers);
});

test('a number is not burnt when the sale it was for fails to save', () => {
  const db = freshDb();
  seed({ db, owner: OWNER });

  assert.equal(nextNumber(db, 'invoice'), 'INV-0001');

  const attempt = db.transaction(() => {
    nextNumber(db, 'invoice'); // would have been INV-0002
    throw new Error('sale failed to save');
  });
  assert.throws(attempt, /sale failed to save/);

  // The counter rolled back with it, so no gap appears in the invoice book.
  assert.equal(nextNumber(db, 'invoice'), 'INV-0002');
});

test('asking for a counter that does not exist is an error, not a bad number', () => {
  const db = freshDb();
  seed({ db, owner: OWNER });
  assert.throws(() => nextNumber(db, 'delivery_note'), /no counter/);
});
