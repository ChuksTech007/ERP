/* The owner's reports.
 *
 * Every figure here comes out of the ledger and nowhere else. Nothing is
 * counted twice, nothing is a separately-maintained total that can drift, and
 * anything on a report can be traced back to the entry that produced it.
 */

import { getDb } from './db.js';
import { trialBalance, totalsByType, accountBalance } from './ledger.js';
import { ACCT } from './chart-of-accounts.js';

/** First and last moment of a month, as ISO strings. */
export function monthRange(date = new Date()) {
  const from = new Date(date.getFullYear(), date.getMonth(), 1);
  const to = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
  return { from: from.toISOString(), to: to.toISOString(), label: from.toLocaleDateString('en-NG', { month: 'long', year: 'numeric' }) };
}

/**
 * What the shop earned and what it spent, over a period.
 *
 * Income appears when work is HANDED OVER, not when a deposit arrives, so a
 * month full of deposits on unfinished work shows no income — which is
 * correct, and is why a good month for cash can be a quiet month for profit.
 */
export function profitAndLoss({ db = getDb(), from = null, to = null } = {}) {
  const clauses = [];
  const args = [];
  if (from) { clauses.push('e.entry_date >= ?'); args.push(from); }
  if (to) { clauses.push('e.entry_date <= ?'); args.push(to); }
  const where = clauses.length ? `AND ${clauses.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `SELECT a.code, a.name, a.type, a.normal,
              COALESCE(SUM(l.amount_kobo), 0) signed_total
       FROM accounts a
       JOIN journal_lines l ON l.account_id = a.id
       JOIN journal_entries e ON e.id = l.entry_id
       WHERE a.type IN ('income', 'expense') ${where}
       GROUP BY a.id
       HAVING signed_total != 0
       ORDER BY a.code`
    )
    .all(...args);

  const lines = rows.map((row) => ({
    code: row.code,
    name: row.name,
    type: row.type,
    amountKobo: row.normal === 'debit' ? row.signed_total : -row.signed_total,
  }));

  const income = lines.filter((l) => l.type === 'income');
  const expenses = lines.filter((l) => l.type === 'expense');

  const incomeKobo = income.reduce((sum, l) => sum + l.amountKobo, 0);
  const expenseKobo = expenses.reduce((sum, l) => sum + l.amountKobo, 0);

  return {
    income,
    expenses,
    incomeKobo,
    expenseKobo,
    profitKobo: incomeKobo - expenseKobo,
    marginBp: incomeKobo > 0 ? Math.round(((incomeKobo - expenseKobo) * 10000) / incomeKobo) : 0,
  };
}

/**
 * What the shop owns, owes and is worth, as at a date.
 *
 * The profit earned so far is folded into equity, because it belongs to the
 * owner but has not been drawn out. Without it the sheet cannot balance, and a
 * balance sheet that does not balance is not a balance sheet.
 */
export function balanceSheet({ db = getDb(), upTo = null } = {}) {
  const { accounts } = trialBalance({ db, upTo });

  const pick = (type) => accounts.filter((a) => a.type === type && a.balanceKobo !== 0);

  const assets = pick('asset');
  const liabilities = pick('liability');
  const equity = pick('equity');

  const assetsKobo = assets.reduce((sum, a) => sum + a.balanceKobo, 0);
  const liabilitiesKobo = liabilities.reduce((sum, a) => sum + a.balanceKobo, 0);
  const equityKobo = equity.reduce((sum, a) => sum + a.balanceKobo, 0);

  const totals = totalsByType({ db, to: upTo });
  const retainedKobo = totals.income - totals.expense;

  return {
    assets,
    liabilities,
    equity,
    assetsKobo,
    liabilitiesKobo,
    equityKobo,
    retainedKobo,
    // Assets = liabilities + equity + profit not yet drawn.
    balanced: assetsKobo === liabilitiesKobo + equityKobo + retainedKobo,
    differenceKobo: assetsKobo - (liabilitiesKobo + equityKobo + retainedKobo),
  };
}

/** Money in and out over a period, by where it landed. */
export function cashPosition({ db = getDb() } = {}) {
  return {
    cashKobo: accountBalance(ACCT.CASH, { db }),
    bankKobo: accountBalance(ACCT.BANK, { db }),
    owedToShopKobo: accountBalance(ACCT.RECEIVABLE, { db }),
    owedBySopKobo: accountBalance(ACCT.PAYABLE, { db }),
    depositsHeldKobo: accountBalance(ACCT.CUSTOMER_DEPOSITS, { db }),
    stockKobo: accountBalance(ACCT.INVENTORY, { db }),
  };
}

/**
 * Takings for a single day, split by how they were paid.
 *
 * What the owner counts the drawer against at close. Cash and card are kept
 * apart because the drawer only ever contains the cash half.
 */
export function takings({ db = getDb(), date = new Date() } = {}) {
  const from = new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
  const to = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999).toISOString();

  const rows = db
    .prepare(
      `SELECT method, kind, COALESCE(SUM(amount_kobo), 0) total, count(*) n
       FROM payments WHERE received_at >= ? AND received_at <= ?
       GROUP BY method, kind`
    )
    .all(from, to);

  const byMethod = {};
  for (const row of rows) {
    byMethod[row.method] = (byMethod[row.method] || 0) + row.total;
  }

  return {
    byMethod,
    cashKobo: byMethod.cash || 0,
    otherKobo: Object.entries(byMethod).filter(([m]) => m !== 'cash').reduce((s, [, v]) => s + v, 0),
    totalKobo: rows.reduce((sum, r) => sum + r.total, 0),
    count: rows.reduce((sum, r) => sum + r.n, 0),
  };
}
