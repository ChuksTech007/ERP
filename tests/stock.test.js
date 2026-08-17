import test from 'node:test';
import assert from 'node:assert/strict';

import { openMemoryDb } from '../lib/db.js';
import { migrate } from '../lib/migrate.js';
import { seed } from '../lib/seed.js';
import {
  createMaterial, getMaterial, receiveStock, consumeStock, recordBreakage,
  adjustToCount, setOpeningStock, movementsFor, lowStock, rebuildQuantities,
  valueOf, formatQuantity, stockValue, stockValueAtCost,
} from '../lib/stock.js';
import { accountBalance, trialBalance } from '../lib/ledger.js';
import { ACCT } from '../lib/chart-of-accounts.js';
import { parseAmount } from '../lib/money.js';
import { mouldingLengthMm } from '../lib/measure.js';

function freshDb() {
  const db = openMemoryDb();
  migrate({ db });
  seed({ db, owner: { username: 'owner', password: 'a long password', name: 'Owner' } });
  return db;
}

const OAK = {
  name: 'Oak 40mm', category: 'moulding', baseUnit: 'mm',
  packSize: 3000, packLabel: '3 m length',
  costPerPackKobo: parseAmount('10,500'), mouldingWidthMm: 40, reorderBase: 6000,
};

const GLASS = {
  name: 'Clear glass 2mm', category: 'glass', baseUnit: 'mm2',
  packSize: 1220 * 914, packLabel: '1220 × 914 sheet',
  costPerPackKobo: parseAmount('8,000'), yieldPct: 70,
};

/* ------------------------------------------------- the sheet problem */

test('a sheet is valued from its pack price, not per square millimetre', () => {
  // 1,114,508 mm2 at N8,000 is 0.72 kobo per mm2. Rounded to a whole kobo
  // that becomes 1 — overstating every piece of glass by about forty per
  // cent. Valuing from the pack price is the only thing that survives this.
  const sheetMm2 = 1220 * 914;
  const packCost = parseAmount('8,000');

  assert.equal(valueOf(sheetMm2, packCost, sheetMm2), packCost);
  assert.equal(valueOf(Math.round(sheetMm2 / 2), packCost, sheetMm2), packCost / 2);

  const naive = Math.round(packCost / sheetMm2) * sheetMm2;
  assert.ok(naive > packCost * 1.3, 'the naive per-unit approach should be badly wrong');
});

test('moulding values exactly, which is why the bug hides', () => {
  // 3000mm at N10,500 is exactly 350 kobo per mm, so lengths look fine right
  // up until the first sheet arrives.
  assert.equal(valueOf(3000, parseAmount('10,500'), 3000), parseAmount('10,500'));
  assert.equal(valueOf(1500, parseAmount('10,500'), 3000), parseAmount('5,250'));
});

/* --------------------------------------------------------- receiving */

test('receiving stock turns cash into stock, not into an expense', () => {
  const db = freshDb();
  const { id } = createMaterial(OAK, { db });

  receiveStock({ materialId: id, packs: 10, packCostKobo: parseAmount('10,500'), method: 'cash' }, { db });

  assert.equal(getMaterial(id, { db }).quantity_base, 30000); // ten 3m lengths
  assert.equal(accountBalance(ACCT.INVENTORY, { db }), parseAmount('105,000'));
  assert.equal(accountBalance(ACCT.COST_OF_MATERIALS, { db }), 0);
  assert.equal(accountBalance(ACCT.CASH, { db }), parseAmount('-105,000'));
});

test('receiving on credit owes the supplier instead of paying cash', () => {
  const db = freshDb();
  const { id } = createMaterial(OAK, { db });

  receiveStock({ materialId: id, packs: 10, packCostKobo: parseAmount('10,500'), onCredit: true }, { db });

  assert.equal(accountBalance(ACCT.PAYABLE, { db }), parseAmount('105,000'));
  assert.equal(accountBalance(ACCT.CASH, { db }), 0);
});

test('a price rise on delivery becomes the price used from then on', () => {
  const db = freshDb();
  const { id } = createMaterial(OAK, { db });

  receiveStock({ materialId: id, packs: 5, packCostKobo: parseAmount('10,500') }, { db });
  receiveStock({ materialId: id, packs: 5, packCostKobo: parseAmount('12,000') }, { db });

  assert.equal(getMaterial(id, { db }).cost_per_pack_kobo, parseAmount('12,000'));
});

/* -------------------------------------------------------- consuming */

test('using stock on a job is what turns it into a cost', () => {
  const db = freshDb();
  const { id } = createMaterial(OAK, { db });
  receiveStock({ materialId: id, packs: 10, packCostKobo: parseAmount('10,500') }, { db });

  // One 600x900 frame in 40mm oak: perimeter plus mitres.
  const used = mouldingLengthMm(600, 900, 40);
  assert.equal(used, 3320);

  consumeStock({ materialId: id, quantityBase: used, jobId: 'job-1' }, { db });

  assert.equal(getMaterial(id, { db }).quantity_base, 30000 - 3320);
  const expected = valueOf(3320, parseAmount('10,500'), 3000);
  assert.equal(accountBalance(ACCT.COST_OF_MATERIALS, { db }), expected);
  assert.equal(accountBalance(ACCT.INVENTORY, { db }), parseAmount('105,000') - expected);
});

test('stock is allowed to go negative rather than block real work', () => {
  const db = freshDb();
  const { id } = createMaterial(OAK, { db });
  receiveStock({ materialId: id, packs: 1 }, { db });

  // The frame was demonstrably made. Refusing to record it because the shelf
  // count was wrong teaches staff to stop recording.
  const result = consumeStock({ materialId: id, quantityBase: 5000 }, { db });

  assert.equal(result.ok, true);
  assert.equal(result.wentNegative, true);
  assert.equal(getMaterial(id, { db }).quantity_base, -2000);
});

/* -------------------------------------------------------- breakage */

test('breakage is charged apart from the cost of doing the work', () => {
  const db = freshDb();
  const { id } = createMaterial(GLASS, { db });
  receiveStock({ materialId: id, packs: 4, packCostKobo: parseAmount('8,000') }, { db });

  recordBreakage({ materialId: id, quantityBase: 1220 * 914, reason: 'Sheet cracked lifting it off the rack' }, { db });

  assert.equal(accountBalance(ACCT.BREAKAGE, { db }), parseAmount('8,000'));
  assert.equal(accountBalance(ACCT.COST_OF_MATERIALS, { db }), 0);
});

test('breakage without a reason is refused', () => {
  const db = freshDb();
  const { id } = createMaterial(GLASS, { db });
  receiveStock({ materialId: id, packs: 1 }, { db });

  // An unexplained write-off is indistinguishable from theft.
  const result = recordBreakage({ materialId: id, quantityBase: 1000, reason: '  ' }, { db });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /Say what happened/);
});

/* ------------------------------------------------------ stock count */

test('a shortfall found at a count is charged to materials', () => {
  const db = freshDb();
  const { id } = createMaterial(OAK, { db });
  receiveStock({ materialId: id, packs: 10, packCostKobo: parseAmount('10,500') }, { db });

  adjustToCount({ materialId: id, countedBase: 27000, reason: 'Counted the rack' }, { db });

  assert.equal(getMaterial(id, { db }).quantity_base, 27000);
  assert.equal(accountBalance(ACCT.COST_OF_MATERIALS, { db }), parseAmount('10,500'));
});

test('a surplus found at a count puts value back', () => {
  const db = freshDb();
  const { id } = createMaterial(OAK, { db });
  receiveStock({ materialId: id, packs: 10, packCostKobo: parseAmount('10,500') }, { db });
  consumeStock({ materialId: id, quantityBase: 6000 }, { db });

  adjustToCount({ materialId: id, countedBase: 27000, reason: 'Found an offcut bundle' }, { db });

  assert.equal(getMaterial(id, { db }).quantity_base, 27000);
  // 21,000 was charged out; 3,000mm of it came back.
  assert.equal(accountBalance(ACCT.COST_OF_MATERIALS, { db }), parseAmount('10,500'));
});

test('a count that matches changes nothing', () => {
  const db = freshDb();
  const { id } = createMaterial(OAK, { db });
  receiveStock({ materialId: id, packs: 10 }, { db });

  const result = adjustToCount({ materialId: id, countedBase: 30000, reason: 'Counted' }, { db });
  assert.equal(result.unchanged, true);
  assert.equal(movementsFor(id, { db }).length, 1);
});

/* -------------------------------------------------------- opening */

test('opening stock goes in against the owner capital', () => {
  const db = freshDb();
  const { id } = createMaterial(OAK, { db });

  setOpeningStock({ materialId: id, quantityBase: 30000 }, { db });

  assert.equal(accountBalance(ACCT.INVENTORY, { db }), parseAmount('105,000'));
  assert.equal(accountBalance(ACCT.CAPITAL, { db }), parseAmount('105,000'));
});

test('opening stock cannot be set twice', () => {
  const db = freshDb();
  const { id } = createMaterial(OAK, { db });
  setOpeningStock({ materialId: id, quantityBase: 30000 }, { db });

  const second = setOpeningStock({ materialId: id, quantityBase: 99000 }, { db });
  assert.equal(second.ok, false);
});

/* ------------------------------------------------------ validation */

test('moulding without a face width is refused', () => {
  const db = freshDb();
  const result = createMaterial({ ...OAK, mouldingWidthMm: 0 }, { db });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /mitre allowance/);
});

test('a pack must contain something', () => {
  const db = freshDb();
  assert.equal(createMaterial({ ...OAK, packSize: 0 }, { db }).ok, false);
});

/* ------------------------------------------------------- the cache */

test('the running quantity is a cache the log can rebuild', () => {
  const db = freshDb();
  const { id } = createMaterial(OAK, { db });
  receiveStock({ materialId: id, packs: 10 }, { db });
  consumeStock({ materialId: id, quantityBase: 3320 }, { db });

  // Something writes a quantity directly, as a bad script might.
  db.prepare('UPDATE materials SET quantity_base = 999 WHERE id = ?').run(id);

  const corrections = rebuildQuantities({ db });
  assert.equal(corrections.length, 1);
  assert.equal(getMaterial(id, { db }).quantity_base, 30000 - 3320);
});

test('rebuilding changes nothing when the books are sound', () => {
  const db = freshDb();
  const { id } = createMaterial(OAK, { db });
  receiveStock({ materialId: id, packs: 10 }, { db });
  consumeStock({ materialId: id, quantityBase: 3320 }, { db });

  assert.deepEqual(rebuildQuantities({ db }), []);
});

test('low stock is listed worst first', () => {
  const db = freshDb();
  const oak = createMaterial(OAK, { db }).id;
  const ash = createMaterial({ ...OAK, name: 'Ash 40mm', reorderBase: 6000 }, { db }).id;

  receiveStock({ materialId: oak, packs: 1 }, { db }); // 3000, half of reorder
  receiveStock({ materialId: ash, packs: 2 }, { db }); // 6000, exactly at reorder

  const low = lowStock({ db });
  assert.equal(low.length, 2);
  assert.equal(low[0].name, 'Oak 40mm');
});

/* --------------------------------------------------------- display */

test('quantities read the way the shelf is counted', () => {
  const oak = { base_unit: 'mm', pack_size: 3000, pack_label: '3 m length' };
  assert.equal(formatQuantity(30000, oak), '30.00 m (10.0 × 3 m length)');

  const pieces = { base_unit: 'piece', pack_size: 1, pack_label: 'piece' };
  assert.equal(formatQuantity(1, pieces), '1 piece');
  assert.equal(formatQuantity(7, pieces), '7 pieces');
});

/* ------------------------------------------------- the books agree */

test('a week of stock movement leaves the books balanced', () => {
  const db = freshDb();
  const oak = createMaterial(OAK, { db }).id;
  const glass = createMaterial(GLASS, { db }).id;

  receiveStock({ materialId: oak, packs: 20, packCostKobo: parseAmount('10,500'), method: 'transfer' }, { db });
  receiveStock({ materialId: glass, packs: 6, packCostKobo: parseAmount('8,000'), onCredit: true }, { db });
  consumeStock({ materialId: oak, quantityBase: mouldingLengthMm(700, 1000, 40), jobId: 'j1' }, { db });
  consumeStock({ materialId: glass, quantityBase: 700 * 1000, jobId: 'j1' }, { db });
  recordBreakage({ materialId: glass, quantityBase: 400 * 500, reason: 'Chipped trimming it' }, { db });
  adjustToCount({ materialId: oak, countedBase: 55000, reason: 'Monthly count' }, { db });

  const { balanced, driftKobo } = trialBalance({ db });
  assert.equal(balanced, true, `books drifted by ${driftKobo} kobo`);

  // The inventory account and the movements it was built from must agree to
  // the kobo. If they ever do not, stock moved without the books being told.
  assert.equal(accountBalance(ACCT.INVENTORY, { db }), stockValueAtCost({ db }));
});

test('replacement value and book value are close but need not match', () => {
  const db = freshDb();
  const oak = createMaterial(OAK, { db }).id;
  receiveStock({ materialId: oak, packs: 20, packCostKobo: parseAmount('10,500') }, { db });
  consumeStock({ materialId: oak, quantityBase: 3320, jobId: 'j1' }, { db });

  // Each movement rounds to the kobo as it happens, so a sum of rounded
  // figures is not the rounding of a sum. A kobo or two apart is correct.
  const book = accountBalance(ACCT.INVENTORY, { db });
  const replacement = stockValue({ db });
  assert.ok(Math.abs(book - replacement) <= 2, `${book} vs ${replacement}`);

  // A price rise makes them genuinely diverge, and that gap is information:
  // stock bought cheaper than it can now be replaced.
  receiveStock({ materialId: oak, packs: 1, packCostKobo: parseAmount('21,000') }, { db });
  assert.ok(stockValue({ db }) > accountBalance(ACCT.INVENTORY, { db }));
});
