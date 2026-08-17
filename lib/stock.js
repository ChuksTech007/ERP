/* Stock.
 *
 * A framing shop buys in packs and consumes in fractions of them. Moulding
 * arrives in three-metre lengths and is cut in millimetres; glass arrives as
 * sheets and is cut by area. So stock is COUNTED in a base unit — millimetres,
 * square millimetres, or pieces — and packs are a purchasing convenience laid
 * over the top.
 *
 * The running quantity on `materials` is a cache. The movement log is the
 * truth, it is never edited, and the cache can be rebuilt from it at any time.
 * That is what makes a disputed stock figure answerable instead of a
 * disagreement.
 */

import { getDb, newId, now } from './db.js';
import { postStockPurchase, postStockConsumed, postBreakage } from './postings.js';
import { ACCT } from './chart-of-accounts.js';
import { postEntry } from './ledger.js';

export const CATEGORIES = {
  moulding: 'Moulding',
  glass: 'Glass',
  acrylic: 'Acrylic',
  mount_board: 'Mount board',
  backing: 'Backing',
  hardware: 'Hardware',
  print_media: 'Print media',
  consumable: 'Consumables',
  other: 'Other',
};

export const BASE_UNITS = {
  mm: 'millimetres (lengths)',
  mm2: 'square millimetres (sheets)',
  piece: 'pieces',
};

/**
 * What a quantity of stock is worth.
 *
 * Always derived from the PACK price, never from a stored cost-per-base-unit.
 * One square millimetre of glass costs a fraction of a kobo; rounding that to
 * a whole kobo and multiplying overstates every sheet the shop cuts.
 */
export function valueOf(quantityBase, packCostKobo, packSize) {
  if (!packSize || packSize <= 0) return 0;
  return Math.round((packCostKobo * quantityBase) / packSize);
}

/** Base units expressed the way the shelf is counted. */
export function formatQuantity(quantityBase, { base_unit, pack_size, pack_label }) {
  if (base_unit === 'piece') return `${quantityBase} ${quantityBase === 1 ? 'piece' : 'pieces'}`;

  const packs = quantityBase / pack_size;
  const unit = base_unit === 'mm' ? `${(quantityBase / 1000).toFixed(2)} m` : `${(quantityBase / 1_000_000).toFixed(2)} m²`;

  return `${unit} (${packs.toFixed(1)} × ${pack_label})`;
}

export function listMaterials({ db = getDb(), includeRetired = false } = {}) {
  return db
    .prepare(
      `SELECT * FROM materials ${includeRetired ? '' : 'WHERE deleted_at IS NULL'} ORDER BY category, name`
    )
    .all();
}

export function getMaterial(id, { db = getDb() } = {}) {
  return db.prepare('SELECT * FROM materials WHERE id = ?').get(id);
}

export function createMaterial(input, { db = getDb() } = {}) {
  const errors = [];
  if (!String(input.name || '').trim()) errors.push('Give the material a name.');
  if (!CATEGORIES[input.category]) errors.push('Pick a category.');
  if (!BASE_UNITS[input.baseUnit]) errors.push('Pick how it is counted.');
  if (!(input.packSize > 0)) errors.push('A pack must contain more than nothing.');
  if (!String(input.packLabel || '').trim()) errors.push('Say what a pack is — "3 m length", "1220 × 914 sheet".');

  if (input.category === 'moulding' && !(input.mouldingWidthMm > 0)) {
    errors.push('Moulding needs a face width — it decides the mitre allowance when quoting.');
  }
  if (input.yieldPct != null && (input.yieldPct < 1 || input.yieldPct > 100)) {
    errors.push('Usable yield must be between 1 and 100 per cent.');
  }

  if (errors.length) return { ok: false, errors };

  const id = newId();
  db.prepare(
    `INSERT INTO materials
       (id, name, category, base_unit, pack_size, pack_label, quantity_base, reorder_base,
        cost_per_pack_kobo, moulding_width_mm, yield_pct, supplier_id, shelf, active, created_at, updated_at)
     VALUES (@id, @name, @category, @baseUnit, @packSize, @packLabel, 0, @reorderBase,
             @costPerPackKobo, @mouldingWidthMm, @yieldPct, @supplierId, @shelf, 1, @at, @at)`
  ).run({
    id,
    name: String(input.name).trim(),
    category: input.category,
    baseUnit: input.baseUnit,
    packSize: input.packSize,
    packLabel: String(input.packLabel).trim(),
    reorderBase: input.reorderBase ?? 0,
    costPerPackKobo: input.costPerPackKobo ?? 0,
    mouldingWidthMm: input.mouldingWidthMm ?? 0,
    yieldPct: input.yieldPct ?? 100,
    supplierId: input.supplierId ?? null,
    shelf: input.shelf ?? null,
    at: now(),
  });

  return { ok: true, id };
}

/**
 * Write one movement and move the running quantity with it.
 *
 * Private, because every caller should be going through one of the named
 * operations below. A bare "adjust the number" with no reason is how stock
 * figures become fiction.
 */
function record({ db, materialId, kind, deltaBase, valueKobo, reason, jobId, userId }) {
  const material = getMaterial(materialId, { db });
  if (!material) throw new Error('There is no such material.');

  const balanceAfter = material.quantity_base + deltaBase;

  const id = newId();
  db.prepare(
    `INSERT INTO stock_movements
       (id, material_id, material_name, kind, delta_base, balance_after, value_kobo, pack_cost_kobo,
        job_id, reason, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, materialId, material.name, kind, deltaBase, balanceAfter, valueKobo,
    material.cost_per_pack_kobo, jobId ?? null, reason ?? null, userId ?? null, now(), now()
  );

  db.prepare('UPDATE materials SET quantity_base = ?, updated_at = ? WHERE id = ?').run(
    balanceAfter, now(), materialId
  );

  return { id, balanceAfter, material };
}

/**
 * Stock arriving from a supplier, counted in packs.
 *
 * Buying materials is not an expense — it is cash turning into stock on the
 * shelf. It becomes a cost when it is used.
 */
export function receiveStock(
  { materialId, packs, packCostKobo, method = 'cash', onCredit = false, reason, userId },
  { db = getDb() } = {}
) {
  if (!(packs > 0)) return { ok: false, errors: ['How many packs arrived?'] };

  return db.transaction(() => {
    const material = getMaterial(materialId, { db });
    if (!material) return { ok: false, errors: ['There is no such material.'] };

    const cost = packCostKobo ?? material.cost_per_pack_kobo;
    const deltaBase = Math.round(packs * material.pack_size);
    const valueKobo = Math.round(cost * packs);

    // The latest price paid becomes the price used for valuing what is used.
    if (packCostKobo != null && packCostKobo !== material.cost_per_pack_kobo) {
      db.prepare('UPDATE materials SET cost_per_pack_kobo = ?, updated_at = ? WHERE id = ?').run(
        packCostKobo, now(), materialId
      );
    }

    const movement = record({
      db, materialId, kind: 'purchase', deltaBase, valueKobo,
      reason: reason || `Received ${packs} × ${material.pack_label}`, userId,
    });

    postStockPurchase(
      {
        valueKobo, method, onCredit,
        description: `${material.name} — ${packs} × ${material.pack_label}`,
        movementId: movement.id, date: now(), userId,
      },
      { db }
    );

    return { ok: true, id: movement.id, balanceAfter: movement.balanceAfter, valueKobo };
  })();
}

/** Stock used on a job — the moment it becomes a cost. */
export function consumeStock({ materialId, quantityBase, jobId, reason, userId }, { db = getDb() } = {}) {
  if (!(quantityBase > 0)) return { ok: false, errors: ['How much was used?'] };

  return db.transaction(() => {
    const material = getMaterial(materialId, { db });
    if (!material) return { ok: false, errors: ['There is no such material.'] };

    const valueKobo = valueOf(quantityBase, material.cost_per_pack_kobo, material.pack_size);

    /* Stock is allowed to go negative, deliberately. The alternative is
     * refusing to record work that has demonstrably been done because the
     * shelf count was wrong — which teaches staff to stop recording. A
     * negative balance is a visible prompt to count, not a thing to prevent. */
    const movement = record({
      db, materialId, kind: 'consume', deltaBase: -quantityBase, valueKobo, jobId,
      reason: reason || 'Used on a job', userId,
    });

    postStockConsumed(
      { valueKobo, description: `${material.name} used`, movementId: movement.id, date: now(), userId },
      { db }
    );

    return { ok: true, id: movement.id, balanceAfter: movement.balanceAfter, valueKobo, wentNegative: movement.balanceAfter < 0 };
  })();
}

/** Glass broken, or stock written off. Charged apart from the cost of jobs. */
export function recordBreakage({ materialId, quantityBase, reason, userId }, { db = getDb() } = {}) {
  if (!(quantityBase > 0)) return { ok: false, errors: ['How much was lost?'] };
  if (!String(reason || '').trim()) {
    // Unexplained write-offs are indistinguishable from theft.
    return { ok: false, errors: ['Say what happened. Breakage without a reason cannot be looked into later.'] };
  }

  return db.transaction(() => {
    const material = getMaterial(materialId, { db });
    if (!material) return { ok: false, errors: ['There is no such material.'] };

    const valueKobo = valueOf(quantityBase, material.cost_per_pack_kobo, material.pack_size);
    const movement = record({
      db, materialId, kind: 'breakage', deltaBase: -quantityBase, valueKobo, reason, userId,
    });

    postBreakage(
      { valueKobo, description: `${material.name} — ${reason}`, movementId: movement.id, date: now(), userId },
      { db }
    );

    return { ok: true, id: movement.id, balanceAfter: movement.balanceAfter, valueKobo };
  })();
}

/**
 * A stock count: what is actually on the shelf.
 *
 * The difference is posted, not the count itself, so the log still explains
 * how the figure got where it is. A surplus reduces the cost of materials
 * already charged; a shortfall adds to it.
 */
export function adjustToCount({ materialId, countedBase, reason, userId }, { db = getDb() } = {}) {
  if (countedBase == null || countedBase < 0) return { ok: false, errors: ['What was counted?'] };
  if (!String(reason || '').trim()) return { ok: false, errors: ['Say why the count differs.'] };

  return db.transaction(() => {
    const material = getMaterial(materialId, { db });
    if (!material) return { ok: false, errors: ['There is no such material.'] };

    const deltaBase = countedBase - material.quantity_base;
    if (deltaBase === 0) return { ok: true, unchanged: true };

    const valueKobo = valueOf(Math.abs(deltaBase), material.cost_per_pack_kobo, material.pack_size);
    const movement = record({ db, materialId, kind: 'adjust', deltaBase, valueKobo, reason, userId });

    // A shortfall is stock gone; a surplus is stock that was never really used.
    const short = deltaBase < 0;
    postEntry(
      {
        date: now(),
        memo: `Stock count — ${material.name}: ${reason}`,
        sourceType: 'stock',
        sourceId: movement.id,
        userId,
        lines: short
          ? [
              { accountCode: ACCT.COST_OF_MATERIALS, amountKobo: valueKobo },
              { accountCode: ACCT.INVENTORY, amountKobo: -valueKobo },
            ]
          : [
              { accountCode: ACCT.INVENTORY, amountKobo: valueKobo },
              { accountCode: ACCT.COST_OF_MATERIALS, amountKobo: -valueKobo },
            ],
      },
      { db }
    );

    return { ok: true, id: movement.id, deltaBase, balanceAfter: movement.balanceAfter };
  })();
}

/** Opening stock, when the shop first starts using the system. */
export function setOpeningStock({ materialId, quantityBase, userId }, { db = getDb() } = {}) {
  return db.transaction(() => {
    const material = getMaterial(materialId, { db });
    if (!material) return { ok: false, errors: ['There is no such material.'] };

    const already = db
      .prepare("SELECT count(*) n FROM stock_movements WHERE material_id = ? AND kind = 'opening'")
      .get(materialId).n;
    if (already > 0) return { ok: false, errors: ['Opening stock has already been set for this material.'] };

    const valueKobo = valueOf(quantityBase, material.cost_per_pack_kobo, material.pack_size);
    const movement = record({
      db, materialId, kind: 'opening', deltaBase: quantityBase, valueKobo,
      reason: 'Opening stock', userId,
    });

    // Stock the shop already owned, put in against the owner's capital.
    postEntry(
      {
        date: now(),
        memo: `Opening stock — ${material.name}`,
        sourceType: 'opening',
        sourceId: movement.id,
        userId,
        lines: [
          { accountCode: ACCT.INVENTORY, amountKobo: valueKobo },
          { accountCode: ACCT.CAPITAL, amountKobo: -valueKobo },
        ],
      },
      { db }
    );

    return { ok: true, id: movement.id, balanceAfter: movement.balanceAfter };
  })();
}

/** Everything that has happened to one material. */
export function movementsFor(materialId, { db = getDb(), limit = 100 } = {}) {
  return db
    .prepare(
      `SELECT * FROM stock_movements WHERE material_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`
    )
    .all(materialId, limit);
}

/** Materials at or below their reorder level. */
export function lowStock({ db = getDb() } = {}) {
  return db
    .prepare(
      `SELECT * FROM materials
       WHERE deleted_at IS NULL AND active = 1 AND reorder_base > 0 AND quantity_base <= reorder_base
       ORDER BY (quantity_base * 1.0 / reorder_base), name`
    )
    .all();
}

/**
 * Rebuild every running quantity from the movement log.
 *
 * The log is the truth; this makes the cache agree with it again. Needed
 * after any direct database work, and useful as a check in its own right —
 * if it changes anything, something wrote a quantity without a movement.
 */
export function rebuildQuantities({ db = getDb() } = {}) {
  return db.transaction(() => {
    const corrections = [];
    for (const material of listMaterials({ db, includeRetired: true })) {
      const { total } = db
        .prepare('SELECT COALESCE(SUM(delta_base), 0) total FROM stock_movements WHERE material_id = ?')
        .get(material.id);

      if (total !== material.quantity_base) {
        corrections.push({ id: material.id, name: material.name, was: material.quantity_base, now: total });
        db.prepare('UPDATE materials SET quantity_base = ?, updated_at = ? WHERE id = ?').run(total, now(), material.id);
      }
    }
    return corrections;
  })();
}

/**
 * What it would cost to replace the stock on the shelf today.
 *
 * Deliberately NOT the same figure as the inventory account, and it should
 * not be expected to match it. This values what is on hand at today's prices;
 * the ledger holds what was actually paid, movement by movement. After any
 * price rise the two diverge, and that gap is real information — it is the
 * shop holding stock bought cheaper than it can now be replaced.
 *
 * Even with no price change they differ by rounding, because each movement is
 * rounded to the kobo as it happens and a sum of rounded figures is not the
 * rounding of a sum. For reconciling against the books, use
 * `stockValueAtCost`.
 */
export function stockValue({ db = getDb() } = {}) {
  const materials = listMaterials({ db, includeRetired: true });
  return materials.reduce(
    (sum, m) => sum + valueOf(Math.max(0, m.quantity_base), m.cost_per_pack_kobo, m.pack_size),
    0
  );
}

/**
 * What the stock cost, added up from the movements themselves.
 *
 * This is the figure that must agree with the inventory account exactly, to
 * the kobo, because both are the same sum of the same rounded movements. If
 * these two ever disagree, stock has moved without the books being told.
 */
export function stockValueAtCost({ db = getDb() } = {}) {
  return db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN delta_base >= 0 THEN value_kobo ELSE -value_kobo END), 0) total
       FROM stock_movements`
    )
    .get().total;
}
