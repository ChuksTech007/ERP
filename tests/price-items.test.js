import test from 'node:test';
import assert from 'node:assert/strict';

import { openMemoryDb } from '../lib/db.js';
import { migrate } from '../lib/migrate.js';
import { seed } from '../lib/seed.js';
import {
  createPriceItem,
  updatePriceItem,
  retirePriceItem,
  restorePriceItem,
  listPriceItems,
  asPricingPart,
} from '../lib/price-items.js';
import { priceFramedPiece } from '../lib/pricing.js';
import { parseAmount } from '../lib/money.js';

function freshDb() {
  const db = openMemoryDb();
  migrate({ db });
  seed({ db, owner: { username: 'owner', password: 'a long password', name: 'Owner' } });
  return db;
}

const OAK = {
  name: 'Oak 40mm',
  category: 'moulding',
  mode: 'per_m',
  priceKobo: 350000,
  costKobo: 180000,
  mouldingWidthMm: 40,
  wastageMm: 150,
};

test('the shop can add its own price item', () => {
  const db = freshDb();
  const result = createPriceItem(OAK, { db });

  assert.equal(result.ok, true);
  assert.equal(listPriceItems({ db }).length, 1);
});

test('a glass cannot be priced per metre by accident', () => {
  const db = freshDb();
  const result = createPriceItem(
    { name: 'Clear glass 2mm', category: 'glazing', mode: 'per_m', priceKobo: 800000, costKobo: 0 },
    { db }
  );

  // The number alone is meaningless: ₦8,000 per metre and ₦8,000 per square
  // metre are wildly different quotes off the same figure.
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /cannot be priced per metre/);
});

test('moulding without a face width is refused', () => {
  const db = freshDb();
  const result = createPriceItem({ ...OAK, mouldingWidthMm: 0 }, { db });

  // A zero face width means a zero mitre allowance, which quotes every single
  // frame short by eight times the moulding width.
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /mitre allowance/);
});

test('selling below cost warns but is still recordable', () => {
  const db = freshDb();
  const result = createPriceItem({ ...OAK, priceKobo: 100000, costKobo: 180000 }, { db });

  // Usually a typo, occasionally deliberate. Refusing would mean the shop
  // cannot record what it actually did.
  assert.equal(result.ok, true);
  assert.match(result.warnings[0], /loses money/);
});

test('a negative price is refused outright', () => {
  const db = freshDb();
  assert.equal(createPriceItem({ ...OAK, priceKobo: -1 }, { db }).ok, false);
});

test('an unnamed item is refused', () => {
  const db = freshDb();
  assert.equal(createPriceItem({ ...OAK, name: '   ' }, { db }).ok, false);
});

test('a retired item leaves the pickers but not the database', () => {
  const db = freshDb();
  const { id } = createPriceItem(OAK, { db });

  retirePriceItem(id, { db });

  // Gone from the list staff quote from...
  assert.equal(listPriceItems({ db }).length, 0);
  // ...but still there, because jobs from March still point at it.
  assert.equal(listPriceItems({ db, includeRetired: true }).length, 1);

  restorePriceItem(id, { db });
  assert.equal(listPriceItems({ db }).length, 1);
});

test('editing a price does not rewrite quotes already given', () => {
  const db = freshDb();
  const { id } = createPriceItem(OAK, { db });
  const item = listPriceItems({ db })[0];

  // A quote given today, snapshotted as the job would store it.
  const quoted = priceFramedPiece(
    { artworkWidthMm: 600, artworkHeightMm: 900 },
    { moulding: asPricingPart(item) }
  );
  const snapshot = JSON.stringify(quoted);

  // The supplier raises the moulding price next month.
  updatePriceItem(id, { ...OAK, priceKobo: 700000 }, { db });

  // The August quote must still say what it said in August. This is what
  // makes editing prices in place safe.
  assert.deepEqual(JSON.parse(snapshot), quoted);

  const now = priceFramedPiece(
    { artworkWidthMm: 600, artworkHeightMm: 900 },
    { moulding: asPricingPart(listPriceItems({ db })[0]) }
  );
  assert.ok(now.totalKobo > quoted.totalKobo);
});

test('what the shop types becomes what the engine charges', () => {
  const db = freshDb();

  // The rates as somebody at the counter would type them.
  createPriceItem({ ...OAK, priceKobo: parseAmount('3,500') }, { db });
  createPriceItem(
    {
      name: 'Clear glass 2mm',
      category: 'glazing',
      mode: 'per_sqm',
      priceKobo: parseAmount('8,000'),
      costKobo: parseAmount('4,500'),
    },
    { db }
  );

  const items = Object.fromEntries(listPriceItems({ db }).map((r) => [r.category, asPricingPart(r)]));
  const quote = priceFramedPiece(
    { artworkWidthMm: 600, artworkHeightMm: 900, mountBorderMm: 50 },
    { moulding: items.moulding, glazing: items.glazing }
  );

  // 700 x 1000 glass = 0.7 m2 at ₦8,000 = ₦5,600
  const glazing = quote.lines.find((l) => l.part === 'glazing');
  assert.equal(glazing.amountKobo, parseAmount('5,600'));

  // Moulding: 3400mm perimeter + 320mm mitres + 150mm wastage = 3870mm
  const moulding = quote.lines.find((l) => l.part === 'moulding');
  assert.equal(moulding.quantityMm, 3870);
  assert.equal(moulding.amountKobo, Math.round((350000 * 3870) / 1000));
});

test('retiring something that is not there fails quietly', () => {
  const db = freshDb();
  assert.equal(retirePriceItem('no-such-id', { db }).ok, false);
});
