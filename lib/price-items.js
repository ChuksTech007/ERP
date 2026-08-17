/* The price list.
 *
 * Everything Master's Technology charges for, and — crucially — how each rate
 * is to be read. A moulding at 350000 is ₦3,500 per METRE; a glass at the
 * same number is ₦3,500 per SQUARE METRE. The number alone is meaningless,
 * which is why `mode` is required rather than defaulted quietly.
 */

import { getDb, newId, now } from './db.js';
import { MODE_LABELS, CATEGORY_MODES, CATEGORY_LABELS } from './price-catalog.js';

/* Re-exported so server-side callers have one import. Client components must
 * take these from './price-catalog.js' directly — importing them from here
 * would drag better-sqlite3 into the browser bundle. */
export { MODE_LABELS, CATEGORY_MODES, CATEGORY_LABELS };

export function listPriceItems({ db = getDb(), includeRetired = false } = {}) {
  return db
    .prepare(
      `SELECT * FROM price_items
       ${includeRetired ? '' : 'WHERE deleted_at IS NULL'}
       ORDER BY category, name`
    )
    .all();
}

export function getPriceItem(id, { db = getDb() } = {}) {
  return db.prepare('SELECT * FROM price_items WHERE id = ?').get(id);
}

function validate(input) {
  const errors = [];

  if (!input.name?.trim()) errors.push('Give it a name.');
  if (!CATEGORY_MODES[input.category]) errors.push('Pick what kind of item this is.');
  else if (!CATEGORY_MODES[input.category].includes(input.mode)) {
    errors.push(`A ${CATEGORY_LABELS[input.category].toLowerCase()} cannot be priced ${MODE_LABELS[input.mode]}.`);
  }

  /* Absent is zero, not invalid. Cost is genuinely optional — the owner may
   * not know it yet, or it may come from the linked material — and treating
   * an empty field as a negative number refused the item with the
   * bewildering message "the cost cannot be negative". */
  if (input.priceKobo != null && input.priceKobo < 0) errors.push('The price cannot be negative.');
  if (input.costKobo != null && input.costKobo < 0) errors.push('The cost cannot be negative.');

  /* A warning rather than an error. Selling below cost is usually a typo, but
   * it is occasionally deliberate — clearing old stock, or a loss-leader — and
   * refusing outright would mean the shop cannot record what it actually did. */
  const warnings = [];
  if (input.costKobo > 0 && input.priceKobo > 0 && input.costKobo > input.priceKobo) {
    warnings.push('The cost is higher than the price, so this item loses money on every job.');
  }

  if (input.category === 'moulding' && !(input.mouldingWidthMm > 0)) {
    // Without it the mitre allowance is zero and every frame is quoted short.
    errors.push('Moulding needs a face width in millimetres — it decides the mitre allowance.');
  }

  return { errors, warnings };
}

export function createPriceItem(input, { db = getDb() } = {}) {
  const { errors, warnings } = validate(input);
  if (errors.length) return { ok: false, errors, warnings };

  const id = newId();
  db.prepare(
    `INSERT INTO price_items
       (id, name, category, mode, price_kobo, cost_kobo, cutting_kobo,
        moulding_width_mm, wastage_mm, material_id, active, created_at, updated_at)
     VALUES (@id, @name, @category, @mode, @priceKobo, @costKobo, @cuttingKobo,
             @mouldingWidthMm, @wastageMm, @materialId, 1, @at, @at)`
  ).run({
    id,
    name: input.name.trim(),
    category: input.category,
    mode: input.mode,
    priceKobo: input.priceKobo ?? 0,
    costKobo: input.costKobo ?? 0,
    cuttingKobo: input.cuttingKobo ?? 0,
    mouldingWidthMm: input.mouldingWidthMm ?? 0,
    wastageMm: input.wastageMm ?? 0,
    materialId: input.materialId ?? null,
    at: now(),
  });

  return { ok: true, id, warnings };
}

export function updatePriceItem(id, input, { db = getDb() } = {}) {
  const { errors, warnings } = validate(input);
  if (errors.length) return { ok: false, errors, warnings };

  /* Prices are edited in place rather than versioned, and that is safe only
   * because every quote snapshots its own breakdown at the time it is given.
   * Without that snapshot this update would silently rewrite the price of
   * every job ever quoted with this item. */
  const result = db
    .prepare(
      `UPDATE price_items SET
         name = @name, category = @category, mode = @mode,
         price_kobo = @priceKobo, cost_kobo = @costKobo, cutting_kobo = @cuttingKobo,
         moulding_width_mm = @mouldingWidthMm, wastage_mm = @wastageMm,
         material_id = @materialId, updated_at = @at
       WHERE id = @id AND deleted_at IS NULL`
    )
    .run({
      id,
      name: input.name.trim(),
      category: input.category,
      mode: input.mode,
      priceKobo: input.priceKobo ?? 0,
      costKobo: input.costKobo ?? 0,
      cuttingKobo: input.cuttingKobo ?? 0,
      mouldingWidthMm: input.mouldingWidthMm ?? 0,
      wastageMm: input.wastageMm ?? 0,
      materialId: input.materialId ?? null,
      at: now(),
    });

  if (result.changes === 0) return { ok: false, errors: ['That price item no longer exists.'] };
  return { ok: true, id, warnings };
}

/**
 * Take an item off the list without erasing it.
 *
 * Old jobs still point at it, and a report that has to explain a job from
 * March needs the row to still be there. Retiring only stops it appearing in
 * the pickers when quoting new work.
 */
export function retirePriceItem(id, { db = getDb() } = {}) {
  const result = db
    .prepare('UPDATE price_items SET deleted_at = @at, active = 0, updated_at = @at WHERE id = @id')
    .run({ id, at: now() });
  return { ok: result.changes > 0 };
}

export function restorePriceItem(id, { db = getDb() } = {}) {
  const result = db
    .prepare('UPDATE price_items SET deleted_at = NULL, active = 1, updated_at = @at WHERE id = @id')
    .run({ id, at: now() });
  return { ok: result.changes > 0 };
}

/** Shaped the way the pricing engine expects its `parts` argument. */
export function asPricingPart(row) {
  return {
    id: row.id,
    name: row.name,
    priceKobo: row.price_kobo,
    costKobo: row.cost_kobo,
    cuttingKobo: row.cutting_kobo,
    mouldingWidthMm: row.moulding_width_mm,
    wastageMm: row.wastage_mm,
  };
}
