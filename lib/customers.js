/* Customers.
 *
 * Looked up by phone far more often than by name. Somebody arrives holding a
 * claim ticket with a number on it, or rings up asking whether their frame is
 * ready, and the phone number is the one thing both sides reliably have.
 *
 * Nothing about a customer's standing is stored on the customer. What they
 * have been billed and what they have paid are SUMs over sales and payments,
 * worked out on read. A stored total is a second copy of a fact that can
 * disagree with the first, and when it does there is no way to tell which is
 * right.
 */

import { getDb, newId, now } from './db.js';

/**
 * Reduce a phone number to something comparable.
 *
 * Nigerian numbers arrive written every possible way: 08031112222,
 * +2348031112222, 234 803 111 2222, 0803-111-2222. All of those are one
 * person, and a shop that ends up with four customer records for them cannot
 * tell who owes what.
 *
 * The last ten digits are the stable part — everything before that is a
 * country code or a trunk zero.
 */
export function normalisePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

/**
 * Find customers.
 *
 * A search that looks like a phone number is matched against the digits of
 * stored numbers, so any of the ways of writing it finds the same person.
 * Anything else is matched against the name.
 */
export function searchCustomers(query, { db = getDb(), limit = 25 } = {}) {
  const text = String(query || '').trim();

  if (!text) {
    return db
      .prepare('SELECT * FROM customers WHERE deleted_at IS NULL ORDER BY name LIMIT ?')
      .all(limit);
  }

  const digits = text.replace(/\D/g, '');

  // Three or more digits is somebody reading a phone number off a ticket.
  if (digits.length >= 3) {
    const tail = normalisePhone(digits);
    return db
      .prepare(
        `SELECT * FROM customers
         WHERE deleted_at IS NULL
           AND REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone,''), ' ', ''), '-', ''), '+', ''), '(', '')
               LIKE '%' || ? || '%'
         ORDER BY name LIMIT ?`
      )
      .all(tail, limit);
  }

  return db
    .prepare(
      `SELECT * FROM customers
       WHERE deleted_at IS NULL AND name LIKE '%' || ? || '%'
       ORDER BY name LIMIT ?`
    )
    .all(text, limit);
}

export function getCustomer(id, { db = getDb() } = {}) {
  return db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
}

/**
 * Find an existing customer by phone, or add one.
 *
 * The path the counter actually takes: a walk-in gives a number, and it
 * either belongs to somebody already known or it does not. Making this one
 * call rather than a search followed by a create is what stops a second
 * record appearing for a regular on a busy afternoon.
 */
export function findOrCreateCustomer({ name, phone, email, address }, { db = getDb() } = {}) {
  const tail = normalisePhone(phone);

  if (tail.length >= 10) {
    const existing = db
      .prepare(
        `SELECT * FROM customers
         WHERE deleted_at IS NULL
           AND REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone,''), ' ', ''), '-', ''), '+', ''), '(', '')
               LIKE '%' || ? || '%'
         LIMIT 1`
      )
      .get(tail);
    if (existing) return { customer: existing, created: false };
  }

  const result = createCustomer({ name, phone, email, address }, { db });
  if (!result.ok) return { customer: null, created: false, errors: result.errors };

  return { customer: getCustomer(result.id, { db }), created: true };
}

export function createCustomer({ name, phone, email, address, notes }, { db = getDb() } = {}) {
  const errors = [];
  if (!String(name || '').trim()) errors.push('Give the customer a name.');

  const digits = normalisePhone(phone);
  if (phone && digits.length > 0 && digits.length < 7) {
    errors.push('That phone number looks too short.');
  }
  if (errors.length) return { ok: false, errors };

  const id = newId();
  db.prepare(
    `INSERT INTO customers (id, name, phone, email, address, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    String(name).trim(),
    String(phone || '').trim() || null,
    String(email || '').trim() || null,
    String(address || '').trim() || null,
    String(notes || '').trim() || null,
    now(),
    now()
  );

  return { ok: true, id };
}

export function updateCustomer(id, { name, phone, email, address, notes }, { db = getDb() } = {}) {
  if (!String(name || '').trim()) return { ok: false, errors: ['Give the customer a name.'] };

  const result = db
    .prepare(
      `UPDATE customers SET name = ?, phone = ?, email = ?, address = ?, notes = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`
    )
    .run(
      String(name).trim(),
      String(phone || '').trim() || null,
      String(email || '').trim() || null,
      String(address || '').trim() || null,
      String(notes || '').trim() || null,
      now(),
      id
    );

  return result.changes > 0 ? { ok: true, id } : { ok: false, errors: ['That customer no longer exists.'] };
}

/**
 * What a customer has been billed, has paid, and still owes.
 *
 * Worked out from the records every time rather than stored. Note that a
 * NEGATIVE outstanding is not an error — it means the shop is holding a
 * deposit for work not yet invoiced, which is the normal state of a framing
 * customer halfway through a job.
 */
export function customerAccount(id, { db = getDb() } = {}) {
  const billed = db
    .prepare('SELECT COALESCE(SUM(total_kobo), 0) total FROM sales WHERE customer_id = ? AND voided = 0')
    .get(id).total;

  // Payments are signed, so refunds subtract themselves.
  const paid = db
    .prepare('SELECT COALESCE(SUM(amount_kobo), 0) total FROM payments WHERE customer_id = ?')
    .get(id).total;

  return { billedKobo: billed, paidKobo: paid, outstandingKobo: billed - paid };
}

/** Everything this customer has going on, for the screen that answers "where is my frame?". */
export function customerHistory(id, { db = getDb() } = {}) {
  const jobs = db
    .prepare(
      `SELECT id, job_number, status, stage, total_kobo, promised_at, created_at
       FROM jobs WHERE customer_id = ? AND deleted_at IS NULL
       ORDER BY created_at DESC LIMIT 50`
    )
    .all(id);

  const sales = db
    .prepare(
      `SELECT id, invoice_number, sold_at, total_kobo, voided
       FROM sales WHERE customer_id = ?
       ORDER BY sold_at DESC LIMIT 50`
    )
    .all(id);

  const payments = db
    .prepare(
      `SELECT id, kind, method, amount_kobo, received_at, reference
       FROM payments WHERE customer_id = ?
       ORDER BY received_at DESC LIMIT 50`
    )
    .all(id);

  /* Anything of theirs the shop is physically holding. The first question at
   * the counter is rarely about money — it is "have you still got my
   * picture?", and this is the answer. */
  const holding = db
    .prepare(
      `SELECT id, tag_number, description, condition_note, received_at
       FROM custody_items WHERE customer_id = ? AND released_at IS NULL
       ORDER BY received_at`
    )
    .all(id);

  return { jobs, sales, payments, holding };
}

/** Customers who owe money, worst first. */
export function customersOwing({ db = getDb(), limit = 100 } = {}) {
  return db
    .prepare(
      `SELECT c.id, c.name, c.phone,
              COALESCE(s.billed, 0) - COALESCE(p.paid, 0) AS outstanding_kobo
       FROM customers c
       LEFT JOIN (SELECT customer_id, SUM(total_kobo) billed FROM sales WHERE voided = 0 GROUP BY customer_id) s
              ON s.customer_id = c.id
       LEFT JOIN (SELECT customer_id, SUM(amount_kobo) paid FROM payments GROUP BY customer_id) p
              ON p.customer_id = c.id
       WHERE c.deleted_at IS NULL
         AND COALESCE(s.billed, 0) - COALESCE(p.paid, 0) > 0
       ORDER BY outstanding_kobo DESC
       LIMIT ?`
    )
    .all(limit);
}

/** Retire a customer. Their invoices still point at the row, so it stays. */
export function retireCustomer(id, { db = getDb() } = {}) {
  const { outstandingKobo } = customerAccount(id, { db });
  if (outstandingKobo > 0) {
    // Hiding a debtor does not collect the debt, and makes it invisible.
    return { ok: false, errors: ['This customer still owes money. Settle the balance first.'] };
  }

  const result = db
    .prepare('UPDATE customers SET deleted_at = ?, updated_at = ? WHERE id = ?')
    .run(now(), now(), id);
  return { ok: result.changes > 0 };
}
