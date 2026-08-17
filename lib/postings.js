/* What each thing that happens in the shop does to the books.
 *
 * One function per event, so that the accounting for a deposit lives in
 * exactly one place and every deposit is treated the same way. Scattering
 * these across the screens that trigger them is how two tills end up posting
 * the same event differently.
 *
 * Every one of these MUST be called inside the same transaction as the record
 * it accounts for.
 */

import { ACCT } from './chart-of-accounts.js';
import { postEntry } from './ledger.js';
import { getDb } from './db.js';

/**
 * Where money physically lands.
 *
 * Cash goes in the drawer; transfers, POS and cheques land in the bank. The
 * distinction is not pedantry — at the end of the day the drawer is counted
 * against the cash account, and lumping card takings in with it means the
 * count never agrees and the staff stop bothering.
 */
function moneyAccount(method) {
  return method === 'cash' ? ACCT.CASH : ACCT.BANK;
}

/**
 * A deposit, taken before the work exists.
 *
 * Cash goes up, but nothing has been EARNED — the shop now owes either a
 * frame or the money back. So the other side is a liability, not income.
 * Booking deposits as income is the commonest accounting mistake in this
 * trade: it flatters the month the money arrives and leaves nothing to
 * recognise in the month the work is actually delivered.
 */
export function postDeposit({ amountKobo, method, jobNumber, paymentId, date, userId }, { db = getDb() } = {}) {
  return postEntry(
    {
      date,
      memo: `Deposit on ${jobNumber}`,
      sourceType: 'payment',
      sourceId: paymentId,
      userId,
      lines: [
        { accountCode: moneyAccount(method), amountKobo, memo: 'Deposit received' },
        { accountCode: ACCT.CUSTOMER_DEPOSITS, amountKobo: -amountKobo, memo: `Held against ${jobNumber}` },
      ],
    },
    { db }
  );
}

/**
 * The work is delivered and an invoice is raised.
 *
 * This is the moment income is earned, whenever the money arrived. Any
 * deposit already held is released from the liability here and set against
 * what the customer now owes.
 */
export function postSale(
  { saleId, invoiceNumber, totalKobo, depositAppliedKobo = 0, isFraming = true, date, userId },
  { db = getDb() } = {}
) {
  const incomeAccount = isFraming ? ACCT.FRAMING_SALES : ACCT.PORTRAIT_SALES;

  const lines = [
    { accountCode: ACCT.RECEIVABLE, amountKobo: totalKobo, memo: `Invoice ${invoiceNumber}` },
    { accountCode: incomeAccount, amountKobo: -totalKobo, memo: `Invoice ${invoiceNumber}` },
  ];

  if (depositAppliedKobo > 0) {
    // The deposit stops being something owed and starts paying the invoice.
    lines.push(
      { accountCode: ACCT.CUSTOMER_DEPOSITS, amountKobo: depositAppliedKobo, memo: 'Deposit applied' },
      { accountCode: ACCT.RECEIVABLE, amountKobo: -depositAppliedKobo, memo: 'Deposit applied' }
    );
  }

  return postEntry(
    { date, memo: `Sale ${invoiceNumber}`, sourceType: 'sale', sourceId: saleId, userId, lines },
    { db }
  );
}

/** Money received against an invoice already raised. */
export function postPayment(
  { amountKobo, method, invoiceNumber, paymentId, date, userId },
  { db = getDb() } = {}
) {
  return postEntry(
    {
      date,
      memo: `Payment on ${invoiceNumber}`,
      sourceType: 'payment',
      sourceId: paymentId,
      userId,
      lines: [
        { accountCode: moneyAccount(method), amountKobo, memo: 'Payment received' },
        { accountCode: ACCT.RECEIVABLE, amountKobo: -amountKobo, memo: `Against ${invoiceNumber}` },
      ],
    },
    { db }
  );
}

/** Money handed back. Signed the other way; nothing else differs. */
export function postRefund(
  { amountKobo, method, invoiceNumber, paymentId, date, userId },
  { db = getDb() } = {}
) {
  const amount = Math.abs(amountKobo);
  return postEntry(
    {
      date,
      memo: `Refund on ${invoiceNumber}`,
      sourceType: 'payment',
      sourceId: paymentId,
      userId,
      lines: [
        { accountCode: ACCT.RECEIVABLE, amountKobo: amount, memo: `Refunded on ${invoiceNumber}` },
        { accountCode: moneyAccount(method), amountKobo: -amount, memo: 'Refund paid out' },
      ],
    },
    { db }
  );
}

/** Something the shop spent money on. */
export function postExpense(
  { amountKobo, method, accountCode, description, expenseId, date, userId },
  { db = getDb() } = {}
) {
  return postEntry(
    {
      date,
      memo: description,
      sourceType: 'expense',
      sourceId: expenseId,
      userId,
      lines: [
        { accountCode, amountKobo, memo: description },
        { accountCode: moneyAccount(method), amountKobo: -amountKobo, memo: description },
      ],
    },
    { db }
  );
}

/**
 * Stock arriving.
 *
 * Buying materials is not an expense — it is one asset turning into another,
 * cash into stock on the shelf. It only becomes a cost when it is used on a
 * job. Treating a delivery as an expense makes the month it arrives look
 * terrible and the month it is used look better than it was.
 */
export function postStockPurchase(
  { valueKobo, method, onCredit = false, description, movementId, date, userId },
  { db = getDb() } = {}
) {
  return postEntry(
    {
      date,
      memo: description,
      sourceType: 'stock',
      sourceId: movementId,
      userId,
      lines: [
        { accountCode: ACCT.INVENTORY, amountKobo: valueKobo, memo: description },
        {
          accountCode: onCredit ? ACCT.PAYABLE : moneyAccount(method),
          amountKobo: -valueKobo,
          memo: onCredit ? 'On account' : description,
        },
      ],
    },
    { db }
  );
}

/** Stock used on a job — the point at which it becomes a cost. */
export function postStockConsumed(
  { valueKobo, description, movementId, date, userId },
  { db = getDb() } = {}
) {
  return postEntry(
    {
      date,
      memo: description,
      sourceType: 'stock',
      sourceId: movementId,
      userId,
      lines: [
        { accountCode: ACCT.COST_OF_MATERIALS, amountKobo: valueKobo, memo: description },
        { accountCode: ACCT.INVENTORY, amountKobo: -valueKobo, memo: description },
      ],
    },
    { db }
  );
}

/**
 * Glass broken, or stock written off.
 *
 * Charged to breakage rather than to the cost of materials, so the owner can
 * see the two apart. Money lost to handling and money spent on a customer's
 * job tell you completely different things, and merged together they tell you
 * nothing.
 */
export function postBreakage(
  { valueKobo, description, movementId, date, userId },
  { db = getDb() } = {}
) {
  return postEntry(
    {
      date,
      memo: description,
      sourceType: 'stock',
      sourceId: movementId,
      userId,
      lines: [
        { accountCode: ACCT.BREAKAGE, amountKobo: valueKobo, memo: description },
        { accountCode: ACCT.INVENTORY, amountKobo: -valueKobo, memo: description },
      ],
    },
    { db }
  );
}

/** Paying a supplier what the shop owes them. */
export function postSupplierPayment(
  { amountKobo, method, supplierName, paymentId, date, userId },
  { db = getDb() } = {}
) {
  return postEntry(
    {
      date,
      memo: `Paid ${supplierName}`,
      sourceType: 'supplier_payment',
      sourceId: paymentId,
      userId,
      lines: [
        { accountCode: ACCT.PAYABLE, amountKobo, memo: `Paid ${supplierName}` },
        { accountCode: moneyAccount(method), amountKobo: -amountKobo, memo: `Paid ${supplierName}` },
      ],
    },
    { db }
  );
}
