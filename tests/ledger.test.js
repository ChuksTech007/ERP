import test from 'node:test';
import assert from 'node:assert/strict';

import { openMemoryDb, newId, now } from '../lib/db.js';
import { migrate } from '../lib/migrate.js';
import { seed } from '../lib/seed.js';
import { postEntry, reverseEntry, accountBalance, trialBalance, totalsByType, entriesFor } from '../lib/ledger.js';
import {
  postDeposit, postSale, postPayment, postRefund, postExpense,
  postStockPurchase, postStockConsumed, postBreakage,
} from '../lib/postings.js';
import { ACCT } from '../lib/chart-of-accounts.js';
import { parseAmount } from '../lib/money.js';

function freshDb() {
  const db = openMemoryDb();
  migrate({ db });
  seed({ db, owner: { username: 'owner', password: 'a long password', name: 'Owner' } });
  return db;
}

/* ------------------------------------------------------- the rules */

test('an entry that does not balance is refused', () => {
  const db = freshDb();
  assert.throws(
    () =>
      postEntry(
        {
          memo: 'Wrong',
          lines: [
            { accountCode: ACCT.CASH, amountKobo: 500000 },
            { accountCode: ACCT.FRAMING_SALES, amountKobo: -400000 },
          ],
        },
        { db }
      ),
    /out by 100000 kobo/
  );
  // Nothing may be left behind by a refused posting.
  assert.equal(db.prepare('SELECT count(*) n FROM journal_entries').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM journal_lines').get().n, 0);
});

test('a typo in an account code stops the posting', () => {
  const db = freshDb();
  const attempt = db.transaction(() =>
    postEntry(
      {
        memo: 'Typo',
        lines: [
          { accountCode: '9999', amountKobo: 500000 },
          { accountCode: ACCT.FRAMING_SALES, amountKobo: -500000 },
        ],
      },
      { db }
    )
  );

  // Money must never land somewhere merely plausible.
  assert.throws(attempt, /no account with code "9999"/);
  assert.equal(db.prepare('SELECT count(*) n FROM journal_entries').get().n, 0);
});

test('fractions of a kobo are refused', () => {
  const db = freshDb();
  assert.throws(
    () =>
      postEntry(
        {
          memo: 'Fraction',
          lines: [
            { accountCode: ACCT.CASH, amountKobo: 100.5 },
            { accountCode: ACCT.FRAMING_SALES, amountKobo: -100.5 },
          ],
        },
        { db }
      ),
    /whole kobo/
  );
});

test('a one-sided entry is refused', () => {
  const db = freshDb();
  assert.throws(
    () => postEntry({ memo: 'Half', lines: [{ accountCode: ACCT.CASH, amountKobo: 0 }] }, { db }),
    /at least two lines/
  );
});

test('a mistake is corrected by reversal, leaving both visible', () => {
  const db = freshDb();
  const entryId = postEntry(
    {
      memo: 'Sale INV-0001',
      sourceType: 'sale',
      sourceId: 'sale-1',
      lines: [
        { accountCode: ACCT.CASH, amountKobo: 500000 },
        { accountCode: ACCT.FRAMING_SALES, amountKobo: -500000 },
      ],
    },
    { db }
  );

  reverseEntry(entryId, { memo: 'Rang up twice' }, { db });

  // Both entries stand; the net effect is nil.
  assert.equal(db.prepare('SELECT count(*) n FROM journal_entries').get().n, 2);
  assert.equal(accountBalance(ACCT.CASH, { db }), 0);
  assert.equal(accountBalance(ACCT.FRAMING_SALES, { db }), 0);
});

/* --------------------------------------------- what the shop does */

test('a deposit is money held, not money earned', () => {
  const db = freshDb();
  postDeposit(
    { amountKobo: parseAmount('20,000'), method: 'cash', jobNumber: 'J-0001', paymentId: newId(), date: now() },
    { db }
  );

  assert.equal(accountBalance(ACCT.CASH, { db }), parseAmount('20,000'));
  // The shop owes either a frame or the money back.
  assert.equal(accountBalance(ACCT.CUSTOMER_DEPOSITS, { db }), parseAmount('20,000'));
  // Nothing has been earned yet. This is the mistake the trade makes most.
  assert.equal(accountBalance(ACCT.FRAMING_SALES, { db }), 0);
});

test('delivering the work is what earns the income', () => {
  const db = freshDb();
  const total = parseAmount('50,000');
  const deposit = parseAmount('20,000');

  postDeposit({ amountKobo: deposit, method: 'cash', jobNumber: 'J-0001', paymentId: newId(), date: now() }, { db });
  postSale(
    { saleId: 'sale-1', invoiceNumber: 'INV-0001', totalKobo: total, depositAppliedKobo: deposit, date: now() },
    { db }
  );

  // Income recognised in full, on delivery.
  assert.equal(accountBalance(ACCT.FRAMING_SALES, { db }), total);
  // The deposit is no longer owed.
  assert.equal(accountBalance(ACCT.CUSTOMER_DEPOSITS, { db }), 0);
  // The customer still owes the balance.
  assert.equal(accountBalance(ACCT.RECEIVABLE, { db }), total - deposit);
});

test('a job paid deposit then balance leaves nothing outstanding', () => {
  const db = freshDb();
  const total = parseAmount('50,000');
  const deposit = parseAmount('20,000');
  const balance = total - deposit;

  postDeposit({ amountKobo: deposit, method: 'cash', jobNumber: 'J-0001', paymentId: newId(), date: now() }, { db });
  postSale({ saleId: 's1', invoiceNumber: 'INV-0001', totalKobo: total, depositAppliedKobo: deposit, date: now() }, { db });
  postPayment({ amountKobo: balance, method: 'transfer', invoiceNumber: 'INV-0001', paymentId: newId(), date: now() }, { db });

  assert.equal(accountBalance(ACCT.RECEIVABLE, { db }), 0);
  assert.equal(accountBalance(ACCT.CUSTOMER_DEPOSITS, { db }), 0);
  assert.equal(accountBalance(ACCT.FRAMING_SALES, { db }), total);
  // Cash took the deposit, the bank took the transfer.
  assert.equal(accountBalance(ACCT.CASH, { db }), deposit);
  assert.equal(accountBalance(ACCT.BANK, { db }), balance);
});

test('cash and card takings do not get lumped together', () => {
  const db = freshDb();
  postPayment({ amountKobo: parseAmount('10,000'), method: 'cash', invoiceNumber: 'INV-1', paymentId: newId(), date: now() }, { db });
  postPayment({ amountKobo: parseAmount('15,000'), method: 'pos', invoiceNumber: 'INV-2', paymentId: newId(), date: now() }, { db });

  // Otherwise the drawer never agrees with the books at close of day.
  assert.equal(accountBalance(ACCT.CASH, { db }), parseAmount('10,000'));
  assert.equal(accountBalance(ACCT.BANK, { db }), parseAmount('15,000'));
});

test('a refund takes the money back out', () => {
  const db = freshDb();
  postPayment({ amountKobo: parseAmount('10,000'), method: 'cash', invoiceNumber: 'INV-1', paymentId: newId(), date: now() }, { db });
  postRefund({ amountKobo: parseAmount('4,000'), method: 'cash', invoiceNumber: 'INV-1', paymentId: newId(), date: now() }, { db });

  assert.equal(accountBalance(ACCT.CASH, { db }), parseAmount('6,000'));
});

test('buying stock is not an expense until it is used', () => {
  const db = freshDb();
  const value = parseAmount('100,000');

  postStockPurchase({ valueKobo: value, method: 'cash', description: 'Oak moulding x10', movementId: newId(), date: now() }, { db });

  // Cash became stock. Nothing has been spent in the sense of a cost.
  assert.equal(accountBalance(ACCT.INVENTORY, { db }), value);
  assert.equal(accountBalance(ACCT.COST_OF_MATERIALS, { db }), 0);
  assert.equal(accountBalance(ACCT.CASH, { db }), -value);

  // Using half of it on jobs is what turns it into a cost.
  postStockConsumed({ valueKobo: parseAmount('40,000'), description: 'Used on J-0001', movementId: newId(), date: now() }, { db });
  assert.equal(accountBalance(ACCT.COST_OF_MATERIALS, { db }), parseAmount('40,000'));
  assert.equal(accountBalance(ACCT.INVENTORY, { db }), parseAmount('60,000'));
});

test('breakage is kept apart from the cost of doing the work', () => {
  const db = freshDb();
  postStockPurchase({ valueKobo: parseAmount('100,000'), method: 'cash', description: 'Glass', movementId: newId(), date: now() }, { db });
  postBreakage({ valueKobo: parseAmount('5,000'), description: 'Sheet cracked on the bench', movementId: newId(), date: now() }, { db });

  // Money lost to handling and money spent on a job say different things.
  assert.equal(accountBalance(ACCT.BREAKAGE, { db }), parseAmount('5,000'));
  assert.equal(accountBalance(ACCT.COST_OF_MATERIALS, { db }), 0);
  assert.equal(accountBalance(ACCT.INVENTORY, { db }), parseAmount('95,000'));
});

test('an expense hits the account it was charged to', () => {
  const db = freshDb();
  postExpense(
    { amountKobo: parseAmount('30,000'), method: 'cash', accountCode: '6000', description: 'Shop rent', expenseId: newId(), date: now() },
    { db }
  );

  assert.equal(accountBalance('6000', { db }), parseAmount('30,000'));
  assert.equal(accountBalance(ACCT.CASH, { db }), parseAmount('-30,000'));
});

/* ------------------------------------------------------- reporting */

test('a full trading day leaves the books balanced', () => {
  const db = freshDb();

  postStockPurchase({ valueKobo: parseAmount('200,000'), method: 'transfer', description: 'Moulding delivery', movementId: newId(), date: now() }, { db });
  postDeposit({ amountKobo: parseAmount('25,000'), method: 'cash', jobNumber: 'J-0001', paymentId: newId(), date: now() }, { db });
  postSale({ saleId: 's1', invoiceNumber: 'INV-0001', totalKobo: parseAmount('60,000'), depositAppliedKobo: parseAmount('25,000'), date: now() }, { db });
  postPayment({ amountKobo: parseAmount('35,000'), method: 'pos', invoiceNumber: 'INV-0001', paymentId: newId(), date: now() }, { db });
  postStockConsumed({ valueKobo: parseAmount('22,000'), description: 'Used on J-0001', movementId: newId(), date: now() }, { db });
  postBreakage({ valueKobo: parseAmount('3,000'), description: 'Glass cracked', movementId: newId(), date: now() }, { db });
  postExpense({ amountKobo: parseAmount('30,000'), method: 'cash', accountCode: '6000', description: 'Rent', expenseId: newId(), date: now() }, { db });

  const { balanced, driftKobo } = trialBalance({ db });
  // The one boolean that says the books are sound.
  assert.equal(balanced, true, `books drifted by ${driftKobo} kobo`);

  const totals = totalsByType({ db });
  assert.equal(totals.income, parseAmount('60,000'));
  assert.equal(totals.expense, parseAmount('55,000')); // 22,000 materials + 3,000 breakage + 30,000 rent
});

test('any figure can be traced back to what caused it', () => {
  const db = freshDb();
  postSale({ saleId: 'sale-42', invoiceNumber: 'INV-0042', totalKobo: parseAmount('60,000'), date: now() }, { db });

  const entries = entriesFor('sale', 'sale-42', { db });
  assert.equal(entries.length, 2);
  assert.ok(entries.every((line) => line.memo.includes('INV-0042')));
});

test('a balance can be asked for as at a date', () => {
  const db = freshDb();
  postPayment({ amountKobo: parseAmount('10,000'), method: 'cash', invoiceNumber: 'INV-1', paymentId: newId(), date: '2026-01-10T10:00:00.000Z' }, { db });
  postPayment({ amountKobo: parseAmount('5,000'), method: 'cash', invoiceNumber: 'INV-2', paymentId: newId(), date: '2026-02-10T10:00:00.000Z' }, { db });

  assert.equal(accountBalance(ACCT.CASH, { db, upTo: '2026-01-31T23:59:59.999Z' }), parseAmount('10,000'));
  assert.equal(accountBalance(ACCT.CASH, { db }), parseAmount('15,000'));
});

test('the sale and its ledger entry live or die together', () => {
  const db = freshDb();

  const attempt = db.transaction(() => {
    db.prepare(
      `INSERT INTO sales (id, invoice_number, customer_name, sold_at, total_kobo, created_at, updated_at)
       VALUES ('s1', 'INV-0001', 'Walk-in', ?, 500000, ?, ?)`
    ).run(now(), now(), now());

    // Something goes wrong posting the books.
    postEntry(
      { memo: 'Sale', lines: [{ accountCode: ACCT.CASH, amountKobo: 500000 }, { accountCode: '9999', amountKobo: -500000 }] },
      { db }
    );
  });

  assert.throws(attempt);
  // No takings the books never heard of. This is why the shop moved to SQLite.
  assert.equal(db.prepare('SELECT count(*) n FROM sales').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM journal_entries').get().n, 0);
});
