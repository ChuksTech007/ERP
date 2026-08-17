/* Suppliers, and what the shop owes them.
 *
 * Stock received on credit puts a debt on the books. Paying it down is a
 * separate act from receiving the goods, and the two are often weeks apart —
 * which is exactly why the amount owed has to be tracked rather than assumed
 * settled at delivery.
 */

import { getDb, newId, now } from './db.js';
import { postSupplierPayment } from './postings.js';

export function listSuppliers({ db = getDb(), includeRetired = false } = {}) {
  return db
    .prepare(
      `SELECT * FROM suppliers ${includeRetired ? '' : 'WHERE deleted_at IS NULL'} ORDER BY name`
    )
    .all();
}

export function getSupplier(id, { db = getDb() } = {}) {
  return db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
}

export function createSupplier({ name, phone, email, address, notes }, { db = getDb() } = {}) {
  if (!String(name || '').trim()) return { ok: false, errors: ['Give the supplier a name.'] };

  const id = newId();
  db.prepare(
    `INSERT INTO suppliers (id, name, phone, email, address, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, String(name).trim(), phone || null, email || null, address || null, notes || null, now(), now());

  return { ok: true, id };
}

/**
 * Pay a supplier.
 *
 * Reduces what the shop owes and takes the money out of cash or the bank. It
 * does NOT touch stock: the goods arrived when they arrived, and paying for
 * them later changes only the debt.
 */
export function paySupplier(
  { supplierId, amountKobo, method = 'transfer', reference, note, userId },
  { db = getDb() } = {}
) {
  if (!(amountKobo > 0)) return { ok: false, errors: ['How much was paid?'] };

  return db.transaction(() => {
    const supplier = getSupplier(supplierId, { db });
    if (!supplier) return { ok: false, errors: ['There is no such supplier.'] };

    const at = now();
    const paymentId = newId();

    /* Recorded as an expense row against no expense account, because it is not
     * an expense — the cost was taken when the goods were received. This row
     * exists so the payment has something to point at and so the shop can see
     * a history of what it has paid out. */
    db.prepare(
      `INSERT INTO expenses (id, spent_at, category, description, amount_kobo, method, supplier_id,
                             reference, note, created_by, created_at, updated_at)
       VALUES (?, ?, 'supplier_payment', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(paymentId, at, `Paid ${supplier.name}`, amountKobo, method, supplierId,
          reference ?? null, note ?? null, userId ?? null, at, at);

    postSupplierPayment(
      { amountKobo, method, supplierName: supplier.name, paymentId, date: at, userId },
      { db }
    );

    return { ok: true, id: paymentId };
  })();
}

/** What has been paid to each supplier. */
export function supplierPayments({ db = getDb(), supplierId = null, limit = 100 } = {}) {
  return db
    .prepare(
      `SELECT e.*, s.name supplier_name
       FROM expenses e LEFT JOIN suppliers s ON s.id = e.supplier_id
       WHERE e.category = 'supplier_payment' AND e.deleted_at IS NULL
         ${supplierId ? 'AND e.supplier_id = ?' : ''}
       ORDER BY e.spent_at DESC LIMIT ?`
    )
    .all(...(supplierId ? [supplierId, limit] : [limit]));
}
