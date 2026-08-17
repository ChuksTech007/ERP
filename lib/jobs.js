/* A job, from the counter to the customer taking it home.
 *
 * The shape of the trade, and the order the money moves in:
 *
 *   quote        somebody asks what a frame would cost. Nothing is owed and
 *                nothing is committed. Most quotes never become jobs.
 *   accepted     they say yes and pay a deposit. The deposit is money HELD,
 *                not earned — the shop now owes either a frame or the money
 *                back. Their picture is taken into custody at this point.
 *   in_progress  the workshop cuts, joins, mounts and fits.
 *   ready        finished, wrapped, waiting on the shelf.
 *   collected    handed over. THIS is when the income is earned, the invoice
 *                is raised, the balance is taken and the picture goes home.
 *
 * The single most important rule: a quote's prices are frozen the moment it
 * is given. Everything the customer was told is snapshotted onto the job, so
 * a quote from August still explains itself in October after the moulding
 * price has risen.
 */

import { getDb, newId, now } from './db.js';
import { nextNumber } from './seed.js';
import { priceFramedPiece, costFramedPiece } from './pricing.js';
import { asPricingPart, getPriceItem } from './price-items.js';
import { postDeposit, postSale, postPayment } from './postings.js';
import { consumeStock } from './stock.js';
import { findOrCreateCustomer } from './customers.js';

/* Re-exported for server callers. Client components must take these from
 * './job-catalog.js' directly — importing them from here would drag
 * better-sqlite3 into the browser bundle. */
export { STAGES, STATUSES } from './job-catalog.js';
import { STAGES } from './job-catalog.js';

/**
 * What a price item actually costs the shop, per the unit it is sold in.
 *
 * Taken from the linked material's pack price whenever there is one, and only
 * falling back to the figure typed on the price list when there is not.
 *
 * The reason is that there were otherwise two costs for the same thing: a
 * number typed on the price list, and the real one implied by what the
 * supplier charges per pack. Nothing kept them in step, so the margin shown
 * against a job could be pure invention while the ledger — which values stock
 * from the pack price — charged something else entirely. An owner deciding
 * what to charge from a made-up margin is worse off than one with no margin
 * at all.
 */
function costRateFor(priceItem, { db = getDb() } = {}) {
  if (!priceItem.material_id) return priceItem.cost_kobo;

  const material = db
    .prepare('SELECT cost_per_pack_kobo, pack_size FROM materials WHERE id = ?')
    .get(priceItem.material_id);
  if (!material?.pack_size) return priceItem.cost_kobo;

  // Scale the pack price up to the unit the item is SOLD by, so cost and
  // price are quoted in the same terms and can be compared.
  const perBase = material.cost_per_pack_kobo / material.pack_size;
  if (priceItem.mode === 'per_m') return Math.round(perBase * 1000);
  if (priceItem.mode === 'per_sqm') return Math.round(perBase * 1_000_000);
  return Math.round(perBase);
}

/**
 * Price one line against the CURRENT price list.
 *
 * Used while a quote is being built. Once the quote is saved the result is
 * frozen onto the job and this is never consulted for that line again.
 */
export function priceLine(spec, { db = getDb() } = {}) {
  const parts = {};
  for (const [slot, field] of [
    ['moulding', 'mouldingPriceId'],
    ['glazing', 'glazingPriceId'],
    ['mountBoard', 'mountPriceId'],
    ['backing', 'backingPriceId'],
  ]) {
    const id = spec[field];
    if (!id) continue;

    const row = getPriceItem(id, { db });
    /* A part that was asked for but cannot be found stops the quote.
     *
     * Skipping it quietly is far worse than failing: the quote still comes out
     * with a number on it, just missing the moulding or the glass, and nobody
     * notices until a frame has been sold for the price of its labour. */
    if (!row) throw new Error(`The ${slot} chosen for this piece is no longer on the price list.`);

    parts[slot] = { ...asPricingPart(row), costKobo: costRateFor(row, { db }) };
  }

  const priced = priceFramedPiece(spec, parts);
  const { costKobo } = costFramedPiece(spec, parts);

  return { priced, costKobo, parts };
}

/**
 * Save a quote.
 *
 * Nothing is owed and no stock is committed. The customer is created or
 * matched by phone in the same breath, because at the counter those are one
 * action rather than two.
 */
export function createQuote(
  { customer, customerId, items, notes, promisedAt, userId },
  { db = getDb() } = {}
) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, errors: ['A quote needs at least one piece.'] };
  }

  return db.transaction(() => {
    let resolvedCustomer = null;
    if (customerId) {
      resolvedCustomer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
    } else if (customer?.name) {
      const found = findOrCreateCustomer(customer, { db });
      if (!found.customer) return { ok: false, errors: found.errors || ['Could not save the customer.'] };
      resolvedCustomer = found.customer;
    }
    if (!resolvedCustomer) return { ok: false, errors: ['Who is this quote for?'] };

    const jobId = newId();
    const jobNumber = nextNumber(db, 'quote');
    const at = now();

    /* The job row goes in before its items, because job_items.job_id points
     * at it and the foreign key is enforced. Totals start at zero and are
     * written once the lines have been priced. */
    db.prepare(
      `INSERT INTO jobs
         (id, job_number, customer_id, customer_name, customer_phone, status, stage,
          promised_at, notes, subtotal_kobo, discount_kobo, total_kobo, deposit_kobo,
          cost_kobo, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'quote', 'not_started', ?, ?, 0, 0, 0, 0, 0, ?, ?, ?)`
    ).run(
      jobId, jobNumber, resolvedCustomer.id, resolvedCustomer.name, resolvedCustomer.phone,
      promisedAt ?? null, notes ?? null, userId ?? null, at, at
    );

    let subtotal = 0;
    let cost = 0;
    let lineNo = 0;

    const insertItem = db.prepare(
      `INSERT INTO job_items
         (id, job_id, line_no, description, artwork_width_mm, artwork_height_mm,
          mount_border_mm, mount_apertures, glass_width_mm, glass_height_mm, quantity,
          moulding_price_id, glazing_price_id, mount_price_id, backing_price_id,
          labour_kobo, unit_kobo, discount_kobo, total_kobo, cost_kobo, breakdown_json,
          created_at, updated_at)
       VALUES (@id, @jobId, @lineNo, @description, @artworkWidthMm, @artworkHeightMm,
               @mountBorderMm, @mountApertures, @glassWidthMm, @glassHeightMm, @quantity,
               @mouldingPriceId, @glazingPriceId, @mountPriceId, @backingPriceId,
               @labourKobo, @unitKobo, @discountKobo, @totalKobo, @costKobo, @breakdownJson,
               @at, @at)`
    );

    for (const spec of items) {
      let priced, costKobo;
      try {
        ({ priced, costKobo } = priceLine(spec, { db }));
      } catch (error) {
        return { ok: false, errors: [error.message] };
      }

      insertItem.run({
        id: newId(),
        jobId,
        lineNo: ++lineNo,
        description: spec.description || 'Framed piece',
        artworkWidthMm: spec.artworkWidthMm,
        artworkHeightMm: spec.artworkHeightMm,
        mountBorderMm: spec.mountBorderMm ?? 0,
        mountApertures: spec.mountApertures ?? 1,
        glassWidthMm: priced.glassWidthMm,
        glassHeightMm: priced.glassHeightMm,
        quantity: spec.quantity ?? 1,
        mouldingPriceId: spec.mouldingPriceId ?? null,
        glazingPriceId: spec.glazingPriceId ?? null,
        mountPriceId: spec.mountPriceId ?? null,
        backingPriceId: spec.backingPriceId ?? null,
        labourKobo: spec.labourKobo ?? 0,
        unitKobo: priced.unitKobo,
        discountKobo: priced.discountKobo,
        totalKobo: priced.totalKobo,
        costKobo,
        /* The frozen record of what the customer was told, and why. Without
         * this, editing a price next month would silently rewrite every quote
         * ever given with that item. */
        breakdownJson: JSON.stringify(priced),
        at,
      });

      subtotal += priced.totalKobo;
      cost += costKobo;
    }

    db.prepare(
      'UPDATE jobs SET subtotal_kobo = ?, total_kobo = ?, cost_kobo = ?, updated_at = ? WHERE id = ?'
    ).run(subtotal, subtotal, cost, at, jobId);

    return { ok: true, id: jobId, jobNumber, totalKobo: subtotal };
  })();
}

export function getJob(id, { db = getDb() } = {}) {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  if (!job) return null;

  const items = db
    .prepare('SELECT * FROM job_items WHERE job_id = ? ORDER BY line_no')
    .all(id)
    .map((item) => ({ ...item, breakdown: JSON.parse(item.breakdown_json || '{}') }));

  const custody = db
    .prepare('SELECT * FROM custody_items WHERE job_id = ? ORDER BY received_at')
    .all(id);

  const payments = db
    .prepare('SELECT * FROM payments WHERE job_id = ? ORDER BY received_at')
    .all(id);

  const events = db
    .prepare('SELECT * FROM job_stage_events WHERE job_id = ? ORDER BY created_at')
    .all(id);

  const paidKobo = payments.reduce((sum, p) => sum + p.amount_kobo, 0);

  return { ...job, items, custody, payments, events, paidKobo, balanceKobo: job.total_kobo - paidKobo };
}

export function listJobs({ db = getDb(), status = null, limit = 100 } = {}) {
  return db
    .prepare(
      `SELECT * FROM jobs
       WHERE deleted_at IS NULL ${status ? 'AND status = ?' : ''}
       ORDER BY
         CASE status WHEN 'ready' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'accepted' THEN 2
                     WHEN 'quote' THEN 3 ELSE 4 END,
         COALESCE(promised_at, created_at)
       LIMIT ?`
    )
    .all(...(status ? [status, limit] : [limit]));
}

/**
 * The customer says yes and pays a deposit.
 *
 * The quote number is kept — renumbering it as a job would break the piece of
 * paper the customer is holding.
 */
export function acceptQuote(
  { jobId, depositKobo = 0, method = 'cash', custody = [], userId },
  { db = getDb() } = {}
) {
  return db.transaction(() => {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    if (!job) return { ok: false, errors: ['There is no such job.'] };
    if (job.status !== 'quote') return { ok: false, errors: ['That quote has already been accepted.'] };
    if (depositKobo < 0) return { ok: false, errors: ['A deposit cannot be negative.'] };
    if (depositKobo > job.total_kobo) {
      return { ok: false, errors: ['The deposit is more than the job is worth.'] };
    }

    const at = now();

    db.prepare(
      `UPDATE jobs SET status = 'accepted', deposit_kobo = ?, updated_at = ? WHERE id = ?`
    ).run(depositKobo, at, jobId);

    if (depositKobo > 0) {
      const paymentId = newId();
      db.prepare(
        `INSERT INTO payments (id, job_id, customer_id, kind, method, amount_kobo, received_at, created_by, created_at, updated_at)
         VALUES (?, ?, ?, 'deposit', ?, ?, ?, ?, ?, ?)`
      ).run(paymentId, jobId, job.customer_id, method, depositKobo, at, userId ?? null, at, at);

      postDeposit(
        { amountKobo: depositKobo, method, jobNumber: job.job_number, paymentId, date: at, userId },
        { db }
      );
    }

    /* Their picture goes into custody here, at the moment it changes hands.
     * A tag number is issued because that is what the customer walks out
     * holding and what they read down the phone later. */
    const tags = [];
    for (const item of custody) {
      const tag = nextNumber(db, 'claim_ticket');
      db.prepare(
        `INSERT INTO custody_items
           (id, job_id, customer_id, tag_number, description, condition_note, photo_path,
            received_at, received_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        newId(), jobId, job.customer_id, tag,
        item.description, item.conditionNote ?? null, item.photoPath ?? null,
        at, userId ?? null, at, at
      );
      tags.push(tag);
    }

    return { ok: true, tags, depositKobo };
  })();
}

/** Move the work along, and remember who moved it. */
export function moveStage({ jobId, stage, note, userId }, { db = getDb() } = {}) {
  if (!STAGES[stage]) return { ok: false, errors: ['That is not a stage of the work.'] };

  return db.transaction(() => {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    if (!job) return { ok: false, errors: ['There is no such job.'] };
    if (job.status === 'quote') return { ok: false, errors: ['This is still a quote. Accept it first.'] };
    if (job.status === 'collected') return { ok: false, errors: ['This job has already gone home.'] };
    if (job.status === 'cancelled') return { ok: false, errors: ['This job was cancelled.'] };

    const at = now();

    // Finishing the last stage is what makes a job ready to collect.
    const status = stage === 'done' ? 'ready' : 'in_progress';

    db.prepare('UPDATE jobs SET stage = ?, status = ?, updated_at = ? WHERE id = ?').run(stage, status, at, jobId);
    db.prepare(
      `INSERT INTO job_stage_events (id, job_id, from_stage, to_stage, note, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(newId(), jobId, job.stage, stage, note ?? null, userId ?? null, at);

    return { ok: true, stage, status };
  })();
}

/**
 * The customer collects.
 *
 * Everything happens here, in one transaction: the invoice is raised, the
 * deposit is released from being a liability, the balance is taken, materials
 * are charged out of stock, and their picture is signed back to them.
 *
 * Either all of that lands or none of it does. A shop that has handed over a
 * frame but has no invoice for it, or an invoice with no record of who took
 * the picture, is a shop having an argument it cannot win.
 */
export function collectJob(
  { jobId, paymentKobo = 0, method = 'cash', releasedTo, releaseNote, userId },
  { db = getDb() } = {}
) {
  return db.transaction(() => {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    if (!job) return { ok: false, errors: ['There is no such job.'] };
    if (job.status === 'collected') return { ok: false, errors: ['This job has already been collected.'] };
    if (job.status === 'quote') return { ok: false, errors: ['This is still a quote.'] };
    if (job.status === 'cancelled') return { ok: false, errors: ['This job was cancelled.'] };

    const held = db
      .prepare('SELECT * FROM custody_items WHERE job_id = ? AND released_at IS NULL')
      .all(jobId);

    if (held.length > 0 && !String(releasedTo || '').trim()) {
      /* Naming who took it is not paperwork. When a family argues about who
       * collected their mother's portrait, this line is the only answer the
       * shop has. */
      return { ok: false, errors: ['Write down who is collecting. Their picture cannot be released to nobody.'] };
    }

    const at = now();
    const items = db.prepare('SELECT * FROM job_items WHERE job_id = ? ORDER BY line_no').all(jobId);

    // --- the invoice
    const saleId = newId();
    const invoiceNumber = nextNumber(db, 'invoice');

    db.prepare(
      `INSERT INTO sales
         (id, invoice_number, job_id, customer_id, customer_name, customer_phone, sold_at,
          subtotal_kobo, discount_kobo, total_kobo, cost_kobo, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      saleId, invoiceNumber, jobId, job.customer_id, job.customer_name, job.customer_phone, at,
      job.subtotal_kobo, job.discount_kobo, job.total_kobo, job.cost_kobo, userId ?? null, at, at
    );

    const insertLine = db.prepare(
      `INSERT INTO sale_items (id, sale_id, job_item_id, line_no, description, quantity, unit_kobo, total_kobo, cost_kobo, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const item of items) {
      insertLine.run(
        newId(), saleId, item.id, item.line_no, item.description,
        item.quantity, item.unit_kobo, item.total_kobo, item.cost_kobo, at
      );
    }

    postSale(
      {
        saleId, invoiceNumber, totalKobo: job.total_kobo,
        depositAppliedKobo: job.deposit_kobo, isFraming: true, date: at, userId,
      },
      { db }
    );

    // --- the balance
    if (paymentKobo > 0) {
      const paymentId = newId();
      db.prepare(
        `INSERT INTO payments (id, sale_id, job_id, customer_id, kind, method, amount_kobo, received_at, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'payment', ?, ?, ?, ?, ?, ?)`
      ).run(paymentId, saleId, jobId, job.customer_id, method, paymentKobo, at, userId ?? null, at, at);

      postPayment({ amountKobo: paymentKobo, method, invoiceNumber, paymentId, date: at, userId }, { db });
    }

    // --- materials off the shelf
    const consumed = consumeForJob({ jobId, items, userId }, { db });

    // --- their picture goes home
    for (const item of held) {
      db.prepare(
        `UPDATE custody_items SET released_at = ?, released_to = ?, released_by = ?, release_note = ?, updated_at = ?
         WHERE id = ?`
      ).run(at, String(releasedTo).trim(), userId ?? null, releaseNote ?? null, at, item.id);
    }

    db.prepare(
      `UPDATE jobs SET status = 'collected', stage = 'done', updated_at = ? WHERE id = ?`
    ).run(at, jobId);

    const paid = db
      .prepare('SELECT COALESCE(SUM(amount_kobo), 0) total FROM payments WHERE job_id = ?')
      .get(jobId).total;

    return {
      ok: true,
      saleId,
      invoiceNumber,
      totalKobo: job.total_kobo,
      paidKobo: paid,
      balanceKobo: job.total_kobo - paid,
      released: held.length,
      consumed,
    };
  })();
}

/**
 * Charge the materials a job used out of stock.
 *
 * The quantities come from the frozen breakdown, not from a recalculation, so
 * what is taken off the shelf matches what the customer was charged for.
 */
function consumeForJob({ jobId, items, userId }, { db = getDb() } = {}) {
  const slots = [
    ['moulding', 'moulding_price_id'],
    ['glazing', 'glazing_price_id'],
    ['mount', 'mount_price_id'],
    ['backing', 'backing_price_id'],
  ];

  const consumed = [];

  for (const item of items) {
    const breakdown = JSON.parse(item.breakdown_json || '{}');
    if (!Array.isArray(breakdown.lines)) continue;

    for (const [part, column] of slots) {
      const priceId = item[column];
      if (!priceId) continue;

      const priceItem = getPriceItem(priceId, { db });
      // Only stock that is actually tracked comes off the shelf. A labour
      // line or a bought-in service has no material behind it.
      if (!priceItem?.material_id) continue;

      const line = breakdown.lines.find((l) => l.part === part);
      if (!line) continue;

      const perPiece = line.quantityMm ?? line.quantityMm2 ?? 0;
      const quantityBase = Math.round(perPiece * (item.quantity || 1));
      if (quantityBase <= 0) continue;

      const result = consumeStock(
        {
          materialId: priceItem.material_id,
          quantityBase,
          jobId,
          reason: `Used on ${item.description}`,
          userId,
        },
        { db }
      );

      if (result.ok) consumed.push({ part, materialId: priceItem.material_id, quantityBase, valueKobo: result.valueKobo });
    }
  }

  return consumed;
}

/**
 * Cancel a job.
 *
 * Any deposit held stays held rather than vanishing — whether it is refunded
 * or kept against the wasted material is a conversation with the customer,
 * not something the software should decide.
 */
export function cancelJob({ jobId, reason, userId }, { db = getDb() } = {}) {
  if (!String(reason || '').trim()) return { ok: false, errors: ['Say why it was cancelled.'] };

  return db.transaction(() => {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    if (!job) return { ok: false, errors: ['There is no such job.'] };
    if (job.status === 'collected') return { ok: false, errors: ['This job has already been collected.'] };

    const at = now();
    db.prepare(
      `UPDATE jobs SET status = 'cancelled', cancelled_reason = ?, updated_at = ? WHERE id = ?`
    ).run(String(reason).trim(), at, jobId);

    const stillHeld = db
      .prepare('SELECT count(*) n FROM custody_items WHERE job_id = ? AND released_at IS NULL')
      .get(jobId).n;

    return { ok: true, depositHeldKobo: job.deposit_kobo, custodyStillHeld: stillHeld };
  })();
}

/** Work that is finished and waiting, oldest first. */
export function awaitingCollection({ db = getDb() } = {}) {
  return db
    .prepare(
      `SELECT j.*, (SELECT count(*) FROM custody_items c WHERE c.job_id = j.id AND c.released_at IS NULL) held
       FROM jobs j
       WHERE j.status = 'ready' AND j.deleted_at IS NULL
       ORDER BY j.updated_at`
    )
    .all();
}

/** Everything of a customer's the shop is currently holding. */
export function inCustody({ db = getDb() } = {}) {
  return db
    .prepare(
      `SELECT c.*, j.job_number, j.status
       FROM custody_items c
       LEFT JOIN jobs j ON j.id = c.job_id
       WHERE c.released_at IS NULL
       ORDER BY c.received_at`
    )
    .all();
}
