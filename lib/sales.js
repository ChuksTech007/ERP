/* Invoices, and the money against them.
 *
 * Note what is NOT stored on a sale: how much has been paid, and whether it is
 * settled. Both are sums over `payments`, worked out on read. Storing them
 * would mean two places that can disagree, and when they do there is no way to
 * tell which is right — an invoice marked paid that the ledger says is not,
 * or the reverse, and no way to know which to believe.
 */

import { getDb, newId, now } from './db.js';
import { postPayment, postRefund, postSale } from './postings.js';
import { reverseEntry } from './ledger.js';
import { nextNumber } from './seed.js';
import { getPriceItem } from './price-items.js';
import { getMaterial, consumeStock } from './stock.js';
import { findOrCreateCustomer } from './customers.js';
import { ACCT } from './chart-of-accounts.js';

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

/** Which income account a price item's takings belong in. */
function incomeAccountFor(category) {
  return category === 'print' ? ACCT.PORTRAIT_SALES : ACCT.FRAMING_SALES;
}

/**
 * A sale over the counter, with no framing job behind it.
 *
 * Someone walks in, buys a ready-made frame or a packet of hooks, pays and
 * leaves. There is nothing to measure, nothing to cut, nobody's picture to
 * take into custody, and no reason to make the counter open a job, quote it,
 * accept it and collect it just to sell a frame off the shelf.
 *
 * Unlike a job, this earns and is paid in the same breath, so the invoice and
 * the payment are raised together. Everything still lands in one transaction:
 * a receipt with no stock movement behind it, or stock gone with no receipt,
 * are the two ways a counter quietly loses money.
 */
export function counterSale(
  { lines = [], customerId = null, customer = null, discountKobo = 0, paymentKobo = null, method = 'cash', note, userId },
  { db = getDb() } = {}
) {
  const errors = [];
  if (!Array.isArray(lines) || lines.length === 0) errors.push('Nothing has been added to the sale.');
  if (!(discountKobo >= 0)) errors.push('A discount cannot be negative.');

  const priced = [];
  lines.forEach((line, index) => {
    const at = `Line ${index + 1}`;
    const quantity = Number(line.quantity) || 0;
    if (quantity <= 0) { errors.push(`${at}: how many?`); return; }

    let description = String(line.description || '').trim();
    let unitKobo = line.unitKobo;
    let priceItem = null;

    if (line.priceItemId) {
      priceItem = getPriceItem(line.priceItemId, { db });
      if (!priceItem) { errors.push(`${at}: that price list item no longer exists.`); return; }

      /* Only fixed-price items can be sold this way. A moulding priced per
       * metre has no price until somebody says how long — that is a quote,
       * not a counter sale, and guessing a length here would put a wrong
       * figure on a receipt the customer walks out with. */
      if (priceItem.mode !== 'per_piece') {
        errors.push(`${at}: ${priceItem.name} is charged ${priceItem.mode === 'per_m' ? 'by the metre' : 'by area'}. Raise a quote for it instead.`);
        return;
      }

      if (!description) description = priceItem.name;
      if (unitKobo == null) unitKobo = priceItem.price_kobo;
    }

    if (!description) { errors.push(`${at}: what was sold?`); return; }
    if (!(unitKobo >= 0)) { errors.push(`${at}: what does it cost?`); return; }

    priced.push({
      description,
      quantity,
      unitKobo,
      totalKobo: unitKobo * quantity,
      priceItem,
    });
  });

  if (errors.length > 0) return { ok: false, errors };

  const subtotalKobo = priced.reduce((sum, l) => sum + l.totalKobo, 0);
  if (discountKobo > subtotalKobo) {
    return { ok: false, errors: ['The discount is more than the sale itself.'] };
  }
  const totalKobo = subtotalKobo - discountKobo;
  const takenKobo = paymentKobo == null ? totalKobo : paymentKobo;
  if (takenKobo < 0) return { ok: false, errors: ['A payment cannot be negative.'] };
  if (takenKobo > totalKobo) {
    // Change is given from the drawer; only what the sale is worth is recorded.
    return { ok: false, errors: ['That is more than the sale comes to.'] };
  }

  return db.transaction(() => {
    const at = now();

    /* A counter sale need not have a name attached — most do not, and forcing
     * one produces a customer list full of "Walk in" and "Customer". */
    let resolvedId = customerId || null;
    let resolvedName = 'Walk-in';
    let resolvedPhone = null;

    if (!resolvedId && customer && String(customer.name || '').trim()) {
      const found = findOrCreateCustomer(customer, { db });
      /* A name that will not save must not silently become a nameless sale —
       * the counter typed it for a reason. */
      if (!found.customer) return { ok: false, errors: found.errors ?? ['That customer could not be saved.'] };
      resolvedId = found.customer.id;
    }
    if (resolvedId) {
      const row = db.prepare('SELECT name, phone FROM customers WHERE id = ?').get(resolvedId);
      resolvedName = row?.name ?? 'Walk-in';
      resolvedPhone = row?.phone ?? null;
    }

    const saleId = newId();
    const invoiceNumber = nextNumber(db, 'invoice');

    db.prepare(
      `INSERT INTO sales
         (id, invoice_number, job_id, customer_id, customer_name, customer_phone, sold_at,
          subtotal_kobo, discount_kobo, total_kobo, cost_kobo, created_by, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
    ).run(
      saleId, invoiceNumber, resolvedId, resolvedName, resolvedPhone, at,
      subtotalKobo, discountKobo, totalKobo, userId ?? null, at, at
    );

    const insertLine = db.prepare(
      `INSERT INTO sale_items (id, sale_id, job_item_id, line_no, description, quantity, unit_kobo, total_kobo, cost_kobo, created_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`
    );

    // --- goods off the shelf
    const consumed = [];
    let costKobo = 0;

    priced.forEach((line, index) => {
      let lineCostKobo = 0;
      const materialId = line.priceItem?.material_id;

      if (materialId) {
        const material = getMaterial(materialId, { db });
        /* Only whole-piece stock can be taken down by a counter sale. A price
         * item sold each but backed by material measured in millimetres gives
         * no way to know how much came off the roll, and a guess here is worse
         * than the honest gap: the sale is still recorded, the stock simply
         * is not touched. */
        if (material?.base_unit === 'piece') {
          const result = consumeStock(
            {
              materialId,
              quantityBase: line.quantity,
              reason: `Sold on ${invoiceNumber}`,
              userId,
            },
            { db }
          );
          if (result.ok) {
            lineCostKobo = result.valueKobo;
            costKobo += result.valueKobo;
            consumed.push({ materialId, quantityBase: line.quantity, valueKobo: result.valueKobo });
          }
        }
      }

      insertLine.run(
        newId(), saleId, index + 1, line.description,
        line.quantity, line.unitKobo, line.totalKobo, lineCostKobo, at
      );
    });

    db.prepare('UPDATE sales SET cost_kobo = ?, updated_at = ? WHERE id = ?').run(costKobo, at, saleId);

    /* Income split by what was actually sold, after spreading the discount
     * across the lines in proportion. A discount charged wholly against one
     * account would misstate which side of the shop earned. */
    const split = new Map();
    priced.forEach((line) => {
      const account = incomeAccountFor(line.priceItem?.category);
      const share = subtotalKobo === 0 ? 0 : Math.round((line.totalKobo * discountKobo) / subtotalKobo);
      split.set(account, (split.get(account) || 0) + line.totalKobo - share);
    });

    /* Rounding the shares individually can leave the split a kobo or two off
     * the total. The drift goes on the largest account, where it is smallest
     * in relative terms — and it has to go somewhere, or the entry will not
     * balance and postEntry will refuse it. */
    const entries = [...split.entries()].filter(([, amount]) => amount !== 0);
    const drift = totalKobo - entries.reduce((sum, [, amount]) => sum + amount, 0);
    if (drift !== 0 && entries.length > 0) {
      entries.sort((a, b) => b[1] - a[1]);
      entries[0][1] += drift;
    }

    postSale(
      {
        saleId,
        invoiceNumber,
        totalKobo,
        incomeSplit: entries.map(([accountCode, amountKobo]) => ({ accountCode, amountKobo })),
        date: at,
        userId,
      },
      { db }
    );

    // --- the money
    if (takenKobo > 0) {
      const paymentId = newId();
      db.prepare(
        `INSERT INTO payments (id, sale_id, job_id, customer_id, kind, method, amount_kobo, note,
                               received_at, created_by, created_at, updated_at)
         VALUES (?, ?, NULL, ?, 'payment', ?, ?, ?, ?, ?, ?, ?)`
      ).run(paymentId, saleId, resolvedId, method, takenKobo, note ?? null, at, userId ?? null, at, at);

      postPayment({ amountKobo: takenKobo, method, invoiceNumber, paymentId, date: at, userId }, { db });
    }

    return {
      ok: true,
      id: saleId,
      saleId,
      invoiceNumber,
      totalKobo,
      paidKobo: takenKobo,
      balanceKobo: totalKobo - takenKobo,
      costKobo,
      consumed,
    };
  })();
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
