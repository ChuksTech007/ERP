/* Invoices, and the money against them.
 *
 * Note what is NOT stored on a sale: how much has been paid, and whether it is
 * settled. Both are sums over `payments`, worked out on read. Storing them
 * would mean two places that can disagree, and when they do there is no way to
 * tell which is right — an invoice marked paid that the ledger says is not,
 * or the reverse, and no way to know which to believe.
 */

import { getDb, newId, now } from './db.js';
import { postPayment, postRefund } from './postings.js';
import { reverseEntry } from './ledger.js';

export function getSale(id, { db = getDb() } = {}) {
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
  if (!sale) return null;

  const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY line_no').all(id);
  const payments = db
    .prepare('SELECT * FROM payments WHERE sale_id = ? ORDER BY received_at')
    .all(id);

  /* A deposit is taken against the JOB before an invoice exists, so it never
   * carries a sale_id. Left out, every job that took a deposit would show its
   * full value still owing on the invoice — the commonest thing to get wrong
   * here, and it makes the shop chase customers who have already paid. */
  const jobPayments = sale.job_id
    ? db
        .prepare('SELECT * FROM payments WHERE job_id = ? AND (sale_id IS NULL OR sale_id != ?) ORDER BY received_at')
        .all(sale.job_id, id)
    : [];

  const all = [...jobPayments, ...payments];
  const paidKobo = all.reduce((sum, p) => sum + p.amount_kobo, 0);

  return {
    ...sale,
    items,
    payments: all,
    paidKobo,
    balanceKobo: sale.voided ? 0 : sale.total_kobo - paidKobo,
    status: sale.voided ? 'voided' : paidKobo >= sale.total_kobo ? 'paid' : paidKobo > 0 ? 'part paid' : 'unpaid',
  };
}

export function listSales({ db = getDb(), limit = 100, unpaidOnly = false } = {}) {
  const rows = db
    .prepare(
      `SELECT s.*,
              COALESCE((SELECT SUM(p.amount_kobo) FROM payments p
                        WHERE p.sale_id = s.id OR (s.job_id IS NOT NULL AND p.job_id = s.job_id)), 0) paid_kobo
       FROM sales s
       ORDER BY s.sold_at DESC
       LIMIT ?`
    )
    .all(limit);

  const withBalance = rows.map((row) => ({
    ...row,
    balance_kobo: row.voided ? 0 : row.total_kobo - row.paid_kobo,
  }));

  return unpaidOnly ? withBalance.filter((row) => row.balance_kobo > 0) : withBalance;
}

/** Money received against an invoice already raised. */
export function takePayment(
  { saleId, amountKobo, method = 'cash', reference, note, userId },
  { db = getDb() } = {}
) {
  if (!(amountKobo > 0)) return { ok: false, errors: ['How much was received?'] };

  return db.transaction(() => {
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
    if (!sale) return { ok: false, errors: ['There is no such invoice.'] };
    if (sale.voided) return { ok: false, errors: ['That invoice was cancelled.'] };

    const at = now();
    const paymentId = newId();

    db.prepare(
      `INSERT INTO payments (id, sale_id, job_id, customer_id, kind, method, amount_kobo, reference, note,
                             received_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'payment', ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(paymentId, saleId, sale.job_id, sale.customer_id, method, amountKobo,
          reference ?? null, note ?? null, at, userId ?? null, at, at);

    postPayment(
      { amountKobo, method, invoiceNumber: sale.invoice_number, paymentId, date: at, userId },
      { db }
    );

    return { ok: true, id: paymentId, balanceKobo: getSale(saleId, { db }).balanceKobo };
  })();
}

/**
 * Money handed back.
 *
 * Recorded as a negative payment rather than by editing the original, so both
 * the taking and the giving back stay visible. A refund that quietly reduces
 * an earlier figure leaves the day's takings looking as though the money was
 * never received.
 */
export function refund(
  { saleId, amountKobo, method = 'cash', reason, userId },
  { db = getDb() } = {}
) {
  if (!(amountKobo > 0)) return { ok: false, errors: ['How much is being refunded?'] };
  if (!String(reason || '').trim()) {
    return { ok: false, errors: ['Say why. Money leaving the drawer without a reason cannot be explained later.'] };
  }

  return db.transaction(() => {
    const sale = getSale(saleId, { db });
    if (!sale) return { ok: false, errors: ['There is no such invoice.'] };

    if (amountKobo > sale.paidKobo) {
      // Refusing to hand back more than was ever received.
      return { ok: false, errors: [`Only ${sale.paidKobo / 100} naira has been paid on this invoice.`] };
    }

    const at = now();
    const paymentId = newId();

    db.prepare(
      `INSERT INTO payments (id, sale_id, job_id, customer_id, kind, method, amount_kobo, note,
                             received_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'refund', ?, ?, ?, ?, ?, ?, ?)`
    ).run(paymentId, saleId, sale.job_id, sale.customer_id, method, -amountKobo,
          String(reason).trim(), at, userId ?? null, at, at);

    postRefund(
      { amountKobo, method, invoiceNumber: sale.invoice_number, paymentId, date: at, userId },
      { db }
    );

    return { ok: true, id: paymentId };
  })();
}

/**
 * Cancel an invoice raised in error.
 *
 * The invoice stays, marked void, and its ledger entry is REVERSED rather
 * than deleted. Deleting it would leave a gap in the invoice book that looks
 * exactly like a sale someone pocketed, which is the one thing a set of books
 * must never be ambiguous about.
 *
 * Payments already taken are left alone: money that genuinely changed hands
 * is refunded deliberately, not made to disappear by voiding the paperwork.
 */
export function voidSale({ saleId, reason, userId }, { db = getDb() } = {}) {
  if (!String(reason || '').trim()) return { ok: false, errors: ['Say why it is being cancelled.'] };

  return db.transaction(() => {
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
    if (!sale) return { ok: false, errors: ['There is no such invoice.'] };
    if (sale.voided) return { ok: false, errors: ['That invoice is already cancelled.'] };

    const at = now();

    const entries = db
      .prepare("SELECT id FROM journal_entries WHERE source_type = 'sale' AND source_id = ?")
      .all(saleId);
    for (const entry of entries) {
      reverseEntry(entry.id, { memo: `Cancelled invoice ${sale.invoice_number}: ${reason}`, userId }, { db });
    }

    db.prepare(
      `UPDATE sales SET voided = 1, void_reason = ?, voided_at = ?, voided_by = ?, updated_at = ?
       WHERE id = ?`
    ).run(String(reason).trim(), at, userId ?? null, at, saleId);

    const paid = getSale(saleId, { db }).paidKobo;

    return {
      ok: true,
      // Flagged rather than swept away, so somebody decides what to do about it.
      paymentsStillHeldKobo: paid,
    };
  })();
}

/** Invoices with money still outstanding, oldest first. */
export function unpaidSales({ db = getDb(), limit = 100 } = {}) {
  return listSales({ db, limit, unpaidOnly: true }).sort((a, b) => a.sold_at.localeCompare(b.sold_at));
}
