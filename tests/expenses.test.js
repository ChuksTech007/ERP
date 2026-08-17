import test from 'node:test';
import assert from 'node:assert/strict';

import { openMemoryDb } from '../lib/db.js';
import { migrate } from '../lib/migrate.js';
import { seed } from '../lib/seed.js';
import { recordExpense, listExpenses, expensesByAccount, expenseAccounts } from '../lib/expenses.js';
import { getSetting, getNumber, setSettings } from '../lib/settings.js';
import { accountBalance, trialBalance } from '../lib/ledger.js';
import { ACCT } from '../lib/chart-of-accounts.js';
import { parseAmount } from '../lib/money.js';

function freshDb() {
  const db = openMemoryDb();
  migrate({ db });
  seed({ db, owner: { username: 'owner', password: 'a long password', name: 'Owner' } });
  return db;
}

test('an expense reaches the account it was charged to', () => {
  const db = freshDb();
  const result = recordExpense(
    { accountCode: '6000', description: 'August rent', amountKobo: parseAmount('30,000'), method: 'cash' },
    { db }
  );

  assert.equal(result.ok, true);
  assert.equal(accountBalance('6000', { db }), parseAmount('30,000'));
  assert.equal(accountBalance(ACCT.CASH, { db }), parseAmount('-30,000'));
  assert.equal(trialBalance({ db }).balanced, true);
});

test('an expense with no amount or description is refused', () => {
  const db = freshDb();
  assert.equal(recordExpense({ accountCode: '6000', description: '', amountKobo: 5000 }, { db }).ok, false);
  assert.equal(recordExpense({ accountCode: '6000', description: 'x', amountKobo: 0 }, { db }).ok, false);
});

test('an expense charged to a made-up account is refused', () => {
  const db = freshDb();
  // Money must never land somewhere merely plausible.
  const result = recordExpense({ accountCode: '9999', description: 'x', amountKobo: 5000 }, { db });
  assert.equal(result.ok, false);
});

test('a transfer leaves the bank, not the drawer', () => {
  const db = freshDb();
  recordExpense(
    { accountCode: '6010', description: 'Salaries', amountKobo: parseAmount('80,000'), method: 'transfer' },
    { db }
  );

  assert.equal(accountBalance(ACCT.BANK, { db }), parseAmount('-80,000'));
  assert.equal(accountBalance(ACCT.CASH, { db }), 0);
});

test('spending is grouped for the owner', () => {
  const db = freshDb();
  recordExpense({ accountCode: '6000', description: 'Rent', amountKobo: parseAmount('30,000') }, { db });
  recordExpense({ accountCode: '6020', description: 'Fuel', amountKobo: parseAmount('5,000') }, { db });
  recordExpense({ accountCode: '6020', description: 'More fuel', amountKobo: parseAmount('3,000') }, { db });

  const grouped = expensesByAccount({ db });
  // Biggest first, so the owner sees what actually matters.
  assert.equal(grouped[0].total_kobo, parseAmount('30,000'));
  assert.equal(grouped[1].total_kobo, parseAmount('8,000'));
  assert.equal(grouped[1].n, 2);
  assert.equal(listExpenses({ db }).length, 3);
});

test('only expense accounts can be charged', () => {
  const db = freshDb();
  const codes = expenseAccounts({ db }).map((a) => a.code);
  // Cash and sales are not places an expense can be booked.
  assert.ok(!codes.includes(ACCT.CASH));
  assert.ok(!codes.includes(ACCT.FRAMING_SALES));
  assert.ok(codes.includes('6000'));
});

/* -------------------------------------------------------- settings */

test('settings can be changed and read back', () => {
  const db = freshDb();
  setSettings({ 'pricing.minCharge_kobo': parseAmount('5,000'), 'shop.phone': '0803 111 2222' }, { db });

  assert.equal(getNumber('pricing.minCharge_kobo', 0, { db }), parseAmount('5,000'));
  assert.equal(getSetting('shop.phone', null, { db }), '0803 111 2222');
});

test('a missing setting falls back rather than reading as zero', () => {
  const db = freshDb();
  assert.equal(getSetting('no.such.key', 'fallback', { db }), 'fallback');
  assert.equal(getNumber('no.such.key', 42, { db }), 42);
});

test('changing a setting twice keeps the last value', () => {
  const db = freshDb();
  setSettings({ 'shop.name': 'First' }, { db });
  setSettings({ 'shop.name': "Master's Technology" }, { db });
  assert.equal(getSetting('shop.name', null, { db }), "Master's Technology");
});
