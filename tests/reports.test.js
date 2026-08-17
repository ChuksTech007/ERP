import test from 'node:test';
import assert from 'node:assert/strict';

import { openMemoryDb } from '../lib/db.js';
import { migrate } from '../lib/migrate.js';
import { seed } from '../lib/seed.js';
import { createMaterial, receiveStock } from '../lib/stock.js';
import { createPriceItem } from '../lib/price-items.js';
import { createQuote, getJob, acceptQuote, moveStage, collectJob } from '../lib/jobs.js';
import { recordExpense } from '../lib/expenses.js';
import { createSupplier, paySupplier } from '../lib/suppliers.js';
import { getSale, takePayment, refund, voidSale, listSales, unpaidSales } from '../lib/sales.js';
import { profitAndLoss, balanceSheet, cashPosition, takings } from '../lib/reports.js';
import { trialBalance, accountBalance } from '../lib/ledger.js';
import { ACCT } from '../lib/chart-of-accounts.js';
import { parseAmount } from '../lib/money.js';

function shop() {
  const db = openMemoryDb();
  migrate({ db });
  seed({ db, owner: { username: 'owner', password: 'a long password', name: 'Owner' } });

  const mat = createMaterial(
    { name: 'Oak 40mm', category: 'moulding', baseUnit: 'mm', packSize: 3000, packLabel: '3 m',
      costPerPackKobo: parseAmount('10,500'), mouldingWidthMm: 40 },
    { db }
  ).id;
  receiveStock({ materialId: mat, packs: 20, onCredit: true }, { db });

  const oak = createPriceItem(
    { name: 'Oak 40mm', category: 'moulding', mode: 'per_m', priceKobo: parseAmount('9,000'),
      mouldingWidthMm: 40, wastageMm: 150, materialId: mat },
    { db }
  ).id;

  return { db, oak, mat };
}

function soldJob(db, oak, { deposit = 0, pay = null } = {}) {
  const q = createQuote(
    {
      customer: { name: 'Mrs Adeyemi', phone: '0803 111 2222' },
      items: [{ description: 'Portrait', artworkWidthMm: 600, artworkHeightMm: 900,
                mountBorderMm: 50, mouldingPriceId: oak, labourKobo: parseAmount('2,500') }],
    },
    { db }
  );
  const total = getJob(q.id, { db }).total_kobo;
  acceptQuote({ jobId: q.id, depositKobo: deposit, method: 'cash' }, { db });
  moveStage({ jobId: q.id, stage: 'done' }, { db });
  const c = collectJob(
    { jobId: q.id, paymentKobo: pay === null ? total - deposit : pay, method: 'transfer', releasedTo: 'Mrs Adeyemi' },
    { db }
  );
  return { jobId: q.id, saleId: c.saleId, total };
}

/* --------------------------------------------------------- invoices */

test('a deposit taken before the invoice still counts against it', () => {
  const { db, oak } = shop();
  const { saleId, total } = soldJob(db, oak, { deposit: parseAmount('5,000'), pay: 0 });

  const sale = getSale(saleId, { db });
  /* The deposit was taken against the JOB and carries no sale_id. Missed, the
   * invoice would show its full value owing and the shop would go chasing a
   * customer who has already paid half. */
  assert.equal(sale.paidKobo, parseAmount('5,000'));
  assert.equal(sale.balanceKobo, total - parseAmount('5,000'));
  assert.equal(sale.status, 'part paid');
});

test('a further payment settles the invoice', () => {
  const { db, oak } = shop();
  const { saleId, total } = soldJob(db, oak, { deposit: parseAmount('5,000'), pay: 0 });

  takePayment({ saleId, amountKobo: total - parseAmount('5,000'), method: 'cash' }, { db });

  const sale = getSale(saleId, { db });
  assert.equal(sale.balanceKobo, 0);
  assert.equal(sale.status, 'paid');
  assert.equal(accountBalance(ACCT.RECEIVABLE, { db }), 0);
});

test('a refund puts money back out without hiding that it was taken', () => {
  const { db, oak } = shop();
  const { saleId } = soldJob(db, oak);
  const before = getSale(saleId, { db }).paidKobo;

  refund({ saleId, amountKobo: parseAmount('3,000'), method: 'cash', reason: 'Frame damaged' }, { db });

  const sale = getSale(saleId, { db });
  // Both the taking and the giving back stay visible.
  assert.equal(sale.paidKobo, before - parseAmount('3,000'));
  assert.equal(sale.payments.filter((p) => p.kind === 'refund').length, 1);
  assert.equal(trialBalance({ db }).balanced, true);
});

test('a refund with no reason, or more than was paid, is refused', () => {
  const { db, oak } = shop();
  const { saleId, total } = soldJob(db, oak);

  assert.equal(refund({ saleId, amountKobo: 1000, reason: '' }, { db }).ok, false);
  assert.equal(refund({ saleId, amountKobo: total + 1, reason: 'x' }, { db }).ok, false);
});

test('cancelling an invoice reverses it rather than erasing it', () => {
  const { db, oak } = shop();
  const { saleId } = soldJob(db, oak, { deposit: 0, pay: 0 });

  assert.ok(accountBalance(ACCT.FRAMING_SALES, { db }) > 0);

  const result = voidSale({ saleId, reason: 'Raised against the wrong customer' }, { db });
  assert.equal(result.ok, true);

  /* Income undone, but the invoice number stays in the book. A missing number
   * looks exactly like a sale somebody pocketed. */
  assert.equal(accountBalance(ACCT.FRAMING_SALES, { db }), 0);
  assert.equal(listSales({ db }).length, 1);
  assert.equal(getSale(saleId, { db }).status, 'voided');
  assert.equal(trialBalance({ db }).balanced, true);
});

test('cancelling flags money already taken rather than sweeping it away', () => {
  const { db, oak } = shop();
  const { saleId } = soldJob(db, oak, { deposit: parseAmount('5,000'), pay: 0 });

  const result = voidSale({ saleId, reason: 'Wrong customer' }, { db });
  // Somebody has to decide what happens to it. The software must not decide.
  assert.equal(result.paymentsStillHeldKobo, parseAmount('5,000'));
});

test('an unpaid invoice shows up on the chase list', () => {
  const { db, oak } = shop();
  soldJob(db, oak, { deposit: 0, pay: 0 });
  soldJob(db, oak);

  assert.equal(unpaidSales({ db }).length, 1);
});

/* -------------------------------------------------------- suppliers */

test('paying a supplier reduces the debt without touching stock', () => {
  const { db } = shop();
  const supplier = createSupplier({ name: 'Lagos Mouldings' }, { db }).id;

  const owedBefore = accountBalance(ACCT.PAYABLE, { db });
  const stockBefore = accountBalance(ACCT.INVENTORY, { db });
  assert.ok(owedBefore > 0);

  paySupplier({ supplierId: supplier, amountKobo: parseAmount('100,000'), method: 'transfer' }, { db });

  assert.equal(accountBalance(ACCT.PAYABLE, { db }), owedBefore - parseAmount('100,000'));
  // The goods arrived when they arrived; paying later changes only the debt.
  assert.equal(accountBalance(ACCT.INVENTORY, { db }), stockBefore);
  assert.equal(accountBalance(ACCT.BANK, { db }), parseAmount('-100,000'));
  assert.equal(trialBalance({ db }).balanced, true);
});

/* ---------------------------------------------------------- reports */

test('income counts when work is handed over, not when a deposit lands', () => {
  const { db, oak } = shop();

  const q = createQuote(
    {
      customer: { name: 'Mrs A' },
      items: [{ description: 'P', artworkWidthMm: 600, artworkHeightMm: 900, mouldingPriceId: oak }],
    },
    { db }
  );
  acceptQuote({ jobId: q.id, depositKobo: parseAmount('10,000'), method: 'cash' }, { db });

  // A month full of deposits on unfinished work shows no income, which is
  // correct, and is why a good month for cash can be a quiet one for profit.
  assert.equal(profitAndLoss({ db }).incomeKobo, 0);

  moveStage({ jobId: q.id, stage: 'done' }, { db });
  collectJob({ jobId: q.id, paymentKobo: 0, releasedTo: 'Mrs A' }, { db });

  const pl = profitAndLoss({ db });
  assert.ok(pl.incomeKobo > 0);
  assert.ok(pl.expenseKobo > 0); // materials charged out on collection
  assert.equal(pl.profitKobo, pl.incomeKobo - pl.expenseKobo);
});

test('rent appears as an expense on the profit and loss', () => {
  const { db, oak } = shop();
  soldJob(db, oak);
  recordExpense({ accountCode: '6000', description: 'Rent', amountKobo: parseAmount('30,000') }, { db });

  const pl = profitAndLoss({ db });
  assert.ok(pl.expenses.some((line) => line.name === 'Rent' && line.amountKobo === parseAmount('30,000')));
});

test('the balance sheet balances after a real day', () => {
  const { db, oak } = shop();
  soldJob(db, oak, { deposit: parseAmount('5,000') });
  recordExpense({ accountCode: '6000', description: 'Rent', amountKobo: parseAmount('30,000') }, { db });

  const sheet = balanceSheet({ db });
  // Assets = liabilities + equity + profit not yet drawn. A balance sheet
  // that does not balance is not a balance sheet.
  assert.equal(sheet.balanced, true, `out by ${sheet.differenceKobo}`);
});

test('the balance sheet holds with money owed in both directions', () => {
  const { db, oak } = shop();
  soldJob(db, oak, { deposit: 0, pay: 0 });
  const supplier = createSupplier({ name: 'Lagos Mouldings' }, { db }).id;
  paySupplier({ supplierId: supplier, amountKobo: parseAmount('50,000') }, { db });

  assert.equal(balanceSheet({ db }).balanced, true);
});

test('cash and card takings are reported apart', () => {
  const { db, oak } = shop();
  soldJob(db, oak, { deposit: parseAmount('5,000') });

  const day = takings({ db });
  // The drawer only ever holds the cash half.
  assert.equal(day.cashKobo, parseAmount('5,000'));
  assert.ok(day.otherKobo > 0);
  assert.equal(day.totalKobo, day.cashKobo + day.otherKobo);
});

test('the cash position shows what is owed both ways and what is held', () => {
  const { db, oak } = shop();
  soldJob(db, oak, { deposit: 0, pay: 0 });

  const position = cashPosition({ db });
  assert.ok(position.owedToShopKobo > 0);
  assert.ok(position.owedBySopKobo > 0); // stock was taken on credit
  assert.ok(position.stockKobo > 0);
});
