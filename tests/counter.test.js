/* Selling over the counter: no job, no measuring, no custody.
 *
 * The shop sells ready-made frames, hooks and reprints to people who walk in
 * and walk out. None of that goes through the framing bench, and none of it
 * should have to pretend to.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { openMemoryDb } from '../lib/db.js';
import { migrate } from '../lib/migrate.js';
import { seed } from '../lib/seed.js';
import { createMaterial, receiveStock, getMaterial } from '../lib/stock.js';
import { createPriceItem } from '../lib/price-items.js';
import { counterSale, getSale, voidSale } from '../lib/sales.js';
import { trialBalance, accountBalance } from '../lib/ledger.js';
import { profitAndLoss, takings } from '../lib/reports.js';
import { ACCT } from '../lib/chart-of-accounts.js';
import { parseAmount } from '../lib/money.js';

function shop() {
  const db = openMemoryDb();
  migrate({ db });
  seed({ db, owner: { username: 'owner', password: 'a long password', name: 'Owner' } });

  // A ready-made frame: bought in boxes of 10, sold one at a time.
  const stockId = createMaterial(
    { name: 'A4 ready-made frame', category: 'other', baseUnit: 'piece', packSize: 10,
      packLabel: 'box of 10', costPerPackKobo: parseAmount('25,000') },
    { db }
  ).id;
  // On credit, so the drawer starts at zero and the counter's own takings show.
  receiveStock({ materialId: stockId, packs: 5, onCredit: true }, { db });

  const frame = createPriceItem(
    { name: 'A4 ready-made frame', category: 'ready_made', mode: 'per_piece',
      priceKobo: parseAmount('4,500'), materialId: stockId },
    { db }
  ).id;

  const reprint = createPriceItem(
    { name: '8x10 reprint', category: 'print', mode: 'per_piece', priceKobo: parseAmount('1,200') },
    { db }
  ).id;

  const moulding = createPriceItem(
    { name: 'Oak 40mm', category: 'moulding', mode: 'per_m', priceKobo: parseAmount('9,000'),
      mouldingWidthMm: 40 },
    { db }
  ).id;

  return { db, stockId, frame, reprint, moulding };
}

test('a walk-in buys a frame off the shelf and the books agree', () => {
  const { db, frame, stockId } = shop();

  const sale = counterSale({ lines: [{ priceItemId: frame, quantity: 2 }], method: 'cash' }, { db });
  assert.equal(sale.ok, true);
  assert.equal(sale.totalKobo, parseAmount('9,000'));
  assert.equal(sale.balanceKobo, 0); // paid at the counter, in full, by default

  // Two frames left the shelf, at what they cost, not what they sold for.
  assert.equal(getMaterial(stockId, { db }).quantity_base, 48);
  assert.equal(sale.costKobo, parseAmount('5,000'));

  assert.equal(accountBalance(ACCT.CASH, { db }), parseAmount('9,000'));
  assert.equal(accountBalance(ACCT.RECEIVABLE, { db }), 0);
  assert.equal(trialBalance({ db }).balanced, true);
});

test('a counter sale needs no customer', () => {
  const { db, frame } = shop();

  const sale = counterSale({ lines: [{ priceItemId: frame, quantity: 1 }] }, { db });
  assert.equal(sale.ok, true);
  /* Forcing a name on every walk-in produces a customer list full of
   * "Customer" and "Walk in", which is worse than no list. */
  assert.equal(getSale(sale.id, { db }).customer_id, null);
});

test('a named walk-in is remembered for next time', () => {
  const { db, frame } = shop();

  const sale = counterSale(
    { lines: [{ priceItemId: frame, quantity: 1 }], customer: { name: 'Mr Bello', phone: '0803 999 0000' } },
    { db }
  );

  const saved = getSale(sale.id, { db });
  assert.equal(saved.customer_name, 'Mr Bello');
  assert.ok(saved.customer_id);
});

test('takings from the counter show up in the day', () => {
  const { db, frame } = shop();
  counterSale({ lines: [{ priceItemId: frame, quantity: 1 }], method: 'cash' }, { db });
  counterSale({ lines: [{ priceItemId: frame, quantity: 1 }], method: 'transfer' }, { db });

  const day = takings({ db });
  assert.equal(day.cashKobo, parseAmount('4,500'));
  assert.equal(day.otherKobo, parseAmount('4,500'));
});

test('an item sold by the metre cannot be sold over the counter', () => {
  const { db, moulding } = shop();

  /* Oak has no price until somebody says how long. Guessing one here would
   * put a wrong figure on a receipt the customer walks out with. */
  const sale = counterSale({ lines: [{ priceItemId: moulding, quantity: 1 }] }, { db });
  assert.equal(sale.ok, false);
  assert.match(sale.errors[0], /metre/);
});

test('framing and portrait takings land in their own accounts', () => {
  const { db, frame, reprint } = shop();

  counterSale(
    { lines: [{ priceItemId: frame, quantity: 1 }, { priceItemId: reprint, quantity: 3 }] },
    { db }
  );

  assert.equal(accountBalance(ACCT.FRAMING_SALES, { db }), parseAmount('4,500'));
  assert.equal(accountBalance(ACCT.PORTRAIT_SALES, { db }), parseAmount('3,600'));
});

test('a discount is spread across the lines, not dumped on one', () => {
  const { db, frame, reprint } = shop();

  const sale = counterSale(
    {
      lines: [{ priceItemId: frame, quantity: 1 }, { priceItemId: reprint, quantity: 3 }],
      discountKobo: parseAmount('810'), // 10% of 8,100
    },
    { db }
  );

  assert.equal(sale.totalKobo, parseAmount('7,290'));
  assert.equal(accountBalance(ACCT.FRAMING_SALES, { db }), parseAmount('4,050'));
  assert.equal(accountBalance(ACCT.PORTRAIT_SALES, { db }), parseAmount('3,240'));
  assert.equal(trialBalance({ db }).balanced, true);
});

test('a discount that will not divide evenly still balances to the kobo', () => {
  const { db, frame, reprint } = shop();

  /* Three lines and an odd discount leave a kobo of rounding that has to go
   * somewhere. Nowhere is not an option — the entry would not balance and the
   * ledger would refuse it, in the middle of serving a customer. */
  const sale = counterSale(
    {
      lines: [
        { priceItemId: frame, quantity: 1 },
        { priceItemId: reprint, quantity: 1 },
        { description: 'Picture hooks', quantity: 1, unitKobo: 33 },
      ],
      discountKobo: 777,
    },
    { db }
  );

  assert.equal(sale.ok, true);
  assert.equal(trialBalance({ db }).balanced, true);

  const income = accountBalance(ACCT.FRAMING_SALES, { db }) + accountBalance(ACCT.PORTRAIT_SALES, { db });
  assert.equal(income, sale.totalKobo);
});

test('an off-list item can be sold by typing what it is and what it costs', () => {
  const { db } = shop();

  const sale = counterSale(
    { lines: [{ description: 'Picture hooks, pack of 4', quantity: 2, unitKobo: parseAmount('500') }] },
    { db }
  );

  assert.equal(sale.ok, true);
  assert.equal(sale.totalKobo, parseAmount('1,000'));
  // Nothing came off the shelf, because nothing on the shelf was pointed at.
  assert.equal(sale.costKobo, 0);
  assert.equal(trialBalance({ db }).balanced, true);
});

test('a counter sale can be left part paid', () => {
  const { db, frame } = shop();

  const sale = counterSale(
    { lines: [{ priceItemId: frame, quantity: 2 }], paymentKobo: parseAmount('4,000') },
    { db }
  );

  assert.equal(sale.balanceKobo, parseAmount('5,000'));
  assert.equal(getSale(sale.id, { db }).status, 'part paid');
  assert.equal(accountBalance(ACCT.RECEIVABLE, { db }), parseAmount('5,000'));
});

test('more money than the sale is worth is refused', () => {
  const { db, frame } = shop();

  const sale = counterSale(
    { lines: [{ priceItemId: frame, quantity: 1 }], paymentKobo: parseAmount('10,000') },
    { db }
  );
  // Change comes out of the drawer. Only what the sale is worth is recorded.
  assert.equal(sale.ok, false);
});

test('a sale of nothing is refused', () => {
  const { db } = shop();
  assert.equal(counterSale({ lines: [] }, { db }).ok, false);
});

test('a discount bigger than the sale is refused', () => {
  const { db, frame } = shop();
  const sale = counterSale(
    { lines: [{ priceItemId: frame, quantity: 1 }], discountKobo: parseAmount('9,000') },
    { db }
  );
  assert.equal(sale.ok, false);
});

test('nothing is recorded at all when a line is bad', () => {
  const { db, frame, stockId } = shop();
  const before = getMaterial(stockId, { db }).quantity_base;

  const sale = counterSale(
    { lines: [{ priceItemId: frame, quantity: 1 }, { description: '', quantity: 0 }] },
    { db }
  );

  assert.equal(sale.ok, false);
  /* The whole sale is refused before anything is written. A half-recorded
   * counter sale — stock gone, no receipt — is how a drawer quietly loses. */
  assert.equal(getMaterial(stockId, { db }).quantity_base, before);
  assert.equal(accountBalance(ACCT.CASH, { db }), 0);
});

test('a counter sale earns income the moment it happens', () => {
  const { db, frame } = shop();
  counterSale({ lines: [{ priceItemId: frame, quantity: 1 }] }, { db });

  const pl = profitAndLoss({ db });
  // No bench, no waiting: sold and delivered in the same moment.
  assert.equal(pl.incomeKobo, parseAmount('4,500'));
  assert.equal(pl.expenseKobo, parseAmount('2,500'));
  assert.equal(pl.profitKobo, parseAmount('2,000'));
});

test('cancelling a counter sale reverses it and keeps the number', () => {
  const { db, frame } = shop();
  const sale = counterSale({ lines: [{ priceItemId: frame, quantity: 1 }] }, { db });

  assert.equal(voidSale({ saleId: sale.id, reason: 'Rang it up twice' }, { db }).ok, true);
  assert.equal(accountBalance(ACCT.FRAMING_SALES, { db }), 0);
  assert.equal(getSale(sale.id, { db }).invoice_number, sale.invoiceNumber);
  assert.equal(trialBalance({ db }).balanced, true);
});
