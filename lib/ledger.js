/* The ledger.
 *
 * Every movement of money in this shop passes through here and nowhere else.
 * That is the whole design: if a figure can only be changed by writing a
 * balanced journal entry, then the books cannot quietly drift out of
 * agreement with themselves, and any number on any report can be traced back
 * to the sale or expense that produced it.
 *
 * Two rules, enforced rather than documented:
 *
 *   1. An entry must balance. Debits are positive, credits negative, and the
 *      lines must sum to exactly zero. An unbalanced entry is refused — not
 *      logged and allowed through, refused — because a ledger that accepts
 *      one is no longer a ledger.
 *
 *   2. An entry is never edited and never deleted. A mistake is corrected by
 *      posting its reverse, which leaves both the error and the correction
 *      visible. Books that can be silently edited are books nobody can trust,
 *      including the owner.
 */

import { getDb, newId, now } from './db.js';

/**
 * Post a balanced journal entry.
 *
 * MUST be called inside a transaction alongside whatever it records. Posting
 * the ledger separately from the sale means a crash between the two leaves
 * takings the books never heard of — which is the exact failure this system
 * was rebuilt on SQLite to make impossible.
 */
export function postEntry(
  { date, memo, sourceType = 'manual', sourceId = null, lines, userId = null },
  { db = getDb() } = {}
) {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new Error('A journal entry needs at least two lines — something given and something received.');
  }

  const total = lines.reduce((sum, line) => sum + line.amountKobo, 0);
  if (total !== 0) {
    /* Naming the amount matters. "Entry does not balance" sends somebody
     * hunting; "out by ₦-500" usually identifies the line on sight. */
    throw new Error(
      `This entry does not balance — it is out by ${total} kobo. ` +
        'Debits are positive, credits negative, and the two must cancel exactly.'
    );
  }

  if (lines.some((line) => !Number.isInteger(line.amountKobo))) {
    throw new Error('Journal amounts must be whole kobo. A fraction of a kobo cannot be paid or received.');
  }

  // Zero-amount lines are noise on a report and usually a bug upstream.
  const posted = lines.filter((line) => line.amountKobo !== 0);
  if (posted.length < 2) throw new Error('An entry of nothing is not an entry.');

  const lookup = db.prepare('SELECT id FROM accounts WHERE code = ? AND deleted_at IS NULL');
  const entryId = newId();
  const at = now();

  db.prepare(
    `INSERT INTO journal_entries (id, entry_date, memo, source_type, source_id, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(entryId, date || at, memo, sourceType, sourceId, userId, at, at);

  const insertLine = db.prepare(
    `INSERT INTO journal_lines (id, entry_id, account_id, amount_kobo, memo, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  for (const line of posted) {
    const account = lookup.get(line.accountCode);
    if (!account) {
      // A typo in an account code must stop the posting, never silently land
      // the money somewhere plausible.
      throw new Error(`There is no account with code "${line.accountCode}".`);
    }
    insertLine.run(newId(), entryId, account.id, line.amountKobo, line.memo || null, at);
  }

  return entryId;
}

/**
 * Undo an entry by posting its mirror image.
 *
 * The original stays exactly where it was. Anyone reading the books later
 * sees both what was recorded and what corrected it, which is what makes a
 * mistake explainable rather than suspicious.
 */
export function reverseEntry(entryId, { memo, userId = null } = {}, { db = getDb() } = {}) {
  const original = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(entryId);
  if (!original) throw new Error('There is no such journal entry to reverse.');

  const lines = db
    .prepare(
      `SELECT a.code, l.amount_kobo, l.memo
       FROM journal_lines l JOIN accounts a ON a.id = l.account_id
       WHERE l.entry_id = ?`
    )
    .all(entryId);

  return postEntry(
    {
      date: now(),
      memo: memo || `Reversal of: ${original.memo}`,
      sourceType: original.source_type,
      sourceId: original.source_id,
      userId,
      lines: lines.map((line) => ({
        accountCode: line.code,
        amountKobo: -line.amount_kobo,
        memo: line.memo,
      })),
    },
    { db }
  );
}

/**
 * What one account holds.
 *
 * Returned in the account's own natural direction, so a cash balance and an
 * income figure both read as positive when things are normal. Handing a
 * shopkeeper a negative number for a healthy sales account is how a report
 * stops being read.
 */
export function accountBalance(code, { db = getDb(), upTo = null } = {}) {
  const account = db.prepare('SELECT * FROM accounts WHERE code = ?').get(code);
  if (!account) throw new Error(`There is no account with code "${code}".`);

  const row = db
    .prepare(
      `SELECT COALESCE(SUM(l.amount_kobo), 0) total
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       WHERE l.account_id = ? ${upTo ? 'AND e.entry_date <= ?' : ''}`
    )
    .get(...(upTo ? [account.id, upTo] : [account.id]));

  // Stored signed as debit-positive; credit-normal accounts read inverted.
  return normalise(account.normal === 'debit' ? row.total : -row.total);
}

/* Negating zero in JavaScript gives -0, which is equal to 0 but not identical
 * to it. An empty credit account would otherwise report a balance that fails
 * a strict comparison and can print as "-₦0.00". */
function normalise(kobo) {
  return kobo === 0 ? 0 : kobo;
}

/**
 * Every account and what it holds.
 *
 * The `balanced` flag is the shop's health check in one boolean: the signed
 * total of every line ever posted must be zero. If it is not, something has
 * bypassed postEntry and the books need looking at before anything else.
 */
export function trialBalance({ db = getDb(), upTo = null } = {}) {
  const rows = db
    .prepare(
      `SELECT a.code, a.name, a.type, a.normal,
              COALESCE(SUM(l.amount_kobo), 0) signed_total
       FROM accounts a
       LEFT JOIN journal_lines l ON l.account_id = a.id
       LEFT JOIN journal_entries e ON e.id = l.entry_id ${upTo ? 'AND e.entry_date <= ?' : ''}
       WHERE a.deleted_at IS NULL
       GROUP BY a.id
       ORDER BY a.code`
    )
    .all(...(upTo ? [upTo] : []));

  const accounts = rows.map((row) => ({
    code: row.code,
    name: row.name,
    type: row.type,
    balanceKobo: normalise(row.normal === 'debit' ? row.signed_total : -row.signed_total),
    signedKobo: row.signed_total,
  }));

  const drift = accounts.reduce((sum, account) => sum + account.signedKobo, 0);

  return { accounts, balanced: drift === 0, driftKobo: drift };
}

/** Totals by account type — the shape a profit and loss is built from. */
export function totalsByType({ db = getDb(), from = null, to = null } = {}) {
  const clauses = [];
  const args = [];
  if (from) { clauses.push('e.entry_date >= ?'); args.push(from); }
  if (to) { clauses.push('e.entry_date <= ?'); args.push(to); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `SELECT a.type, a.normal, COALESCE(SUM(l.amount_kobo), 0) signed_total
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       JOIN accounts a ON a.id = l.account_id
       ${where}
       GROUP BY a.type`
    )
    .all(...args);

  const totals = { asset: 0, liability: 0, equity: 0, income: 0, expense: 0 };
  for (const row of rows) {
    totals[row.type] = normalise(row.normal === 'debit' ? row.signed_total : -row.signed_total);
  }
  return totals;
}

/** Everything posted against one sale, expense or payment. */
export function entriesFor(sourceType, sourceId, { db = getDb() } = {}) {
  return db
    .prepare(
      `SELECT e.id, e.entry_date, e.memo, a.code, a.name, l.amount_kobo
       FROM journal_entries e
       JOIN journal_lines l ON l.entry_id = e.id
       JOIN accounts a ON a.id = l.account_id
       WHERE e.source_type = ? AND e.source_id = ?
       ORDER BY e.entry_date, a.code`
    )
    .all(sourceType, sourceId);
}
