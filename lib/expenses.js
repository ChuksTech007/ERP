/* What the shop spends.
 *
 * Rent, salaries, fuel, transport — everything that is not materials. Material
 * purchases go through stock, because buying moulding is cash turning into
 * stock on the shelf rather than money spent.
 */

import { getDb, newId, now } from './db.js';
import { postExpense } from './postings.js';

/** The accounts an expense can be charged to. */
export function expenseAccounts({ db = getDb() } = {}) {
  return db
    .prepare("SELECT id, code, name FROM accounts WHERE type = 'expense' AND deleted_at IS NULL ORDER BY code")
    .all();
}

export function recordExpense(
  { spentAt, accountCode, description, amountKobo, method = 'cash', reference, note, userId },
  { db = getDb() } = {}
) {
  const errors = [];
  if (!String(description || '').trim()) errors.push('Say what it was for.');
  if (!(amountKobo > 0)) errors.push('An expense needs an amount.');
  if (!accountCode) errors.push('Choose what kind of expense it is.');
  if (errors.length) return { ok: false, errors };

  return db.transaction(() => {
    const account = db.prepare('SELECT id FROM accounts WHERE code = ?').get(accountCode);
    if (!account) return { ok: false, errors: ['That expense account does not exist.'] };

    const id = newId();
    const at = spentAt || now();

    db.prepare(
      `INSERT INTO expenses
         (id, spent_at, category, description, amount_kobo, method, account_id, reference, note,
          created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, at, accountCode, String(description).trim(), amountKobo, method, account.id,
          reference ?? null, note ?? null, userId ?? null, now(), now());

    postExpense(
      { amountKobo, method, accountCode, description: String(description).trim(), expenseId: id, date: at, userId },
      { db }
    );

    return { ok: true, id };
  })();
}

export function listExpenses({ db = getDb(), limit = 100 } = {}) {
  return db
    .prepare(
      `SELECT e.*, a.name account_name
       FROM expenses e LEFT JOIN accounts a ON a.id = e.account_id
       WHERE e.deleted_at IS NULL
       ORDER BY e.spent_at DESC LIMIT ?`
    )
    .all(limit);
}

/** Spending this month, grouped, for the owner's eye. */
export function expensesByAccount({ db = getDb(), from = null, to = null } = {}) {
  const clauses = ['e.deleted_at IS NULL'];
  const args = [];
  if (from) { clauses.push('e.spent_at >= ?'); args.push(from); }
  if (to) { clauses.push('e.spent_at <= ?'); args.push(to); }

  return db
    .prepare(
      `SELECT a.name, a.code, SUM(e.amount_kobo) total_kobo, count(*) n
       FROM expenses e JOIN accounts a ON a.id = e.account_id
       WHERE ${clauses.join(' AND ')}
       GROUP BY a.id ORDER BY total_kobo DESC`
    )
    .all(...args);
}
