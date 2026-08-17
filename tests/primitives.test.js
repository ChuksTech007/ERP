import test from 'node:test';
import assert from 'node:assert/strict';

import { parseAmount, formatNaira, allocate, percentOf } from '../lib/money.js';
import { parseSize, mouldingLengthMm, glassSize, sheetsNeeded, inchesToMm } from '../lib/measure.js';
import { priceFramedPiece, margin } from '../lib/pricing.js';

/* ---------------------------------------------------------------- money */

test('reads the amounts staff actually type', () => {
  assert.equal(parseAmount('1500'), 150000);
  assert.equal(parseAmount('1,500'), 150000);
  assert.equal(parseAmount('₦1,500.50'), 150050);
  assert.equal(parseAmount(' 1500 '), 150000);
  assert.equal(parseAmount('0.05'), 5);
});

test('the amount that floats get wrong', () => {
  // Number("1500.55") * 100 === 150054.99999999999, which truncates a kobo
  // short. Splitting whole from fraction keeps both exact.
  assert.equal(parseAmount('1500.55'), 150055);
  assert.equal(parseAmount('0.29'), 29);
  assert.equal(parseAmount('19.99'), 1999);
});

test('refuses nonsense rather than reading it as zero', () => {
  assert.throws(() => parseAmount('abc'));
  assert.throws(() => parseAmount(''));
  assert.throws(() => parseAmount('12.3.4'));
});

test('a split always adds back up to what it started with', () => {
  // 100 kobo over three equal lines cannot divide evenly; the point is that
  // nothing is lost regardless.
  for (const total of [100, 101, 99999, 1, 7]) {
    const parts = allocate(total, [1, 1, 1]);
    assert.equal(parts.reduce((a, b) => a + b, 0), total, `lost a kobo splitting ${total}`);
  }

  const spread = allocate(10000, [5000, 3000, 2000]);
  assert.deepEqual(spread, [5000, 3000, 2000]);
  assert.equal(spread.reduce((a, b) => a + b, 0), 10000);
});

test('the spare kobo goes to the largest line', () => {
  assert.deepEqual(allocate(10, [7, 3]), [7, 3]);
  assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
});

test('formats for a receipt', () => {
  assert.equal(formatNaira(150050), '₦1,500.50');
  assert.equal(formatNaira(0), '₦0.00');
  assert.equal(formatNaira(5), '₦0.05');
  assert.equal(formatNaira(-150000), '-₦1,500.00');
});

test('percentages stay integer', () => {
  assert.equal(percentOf(100000, 750), 7500); // 7.5% of ₦1,000
});

/* ------------------------------------------------------------ measure */

test('reads sizes the way customers say them', () => {
  assert.deepEqual(parseSize('24 x 36 in'), { widthMm: 610, heightMm: 914 });
  assert.deepEqual(parseSize('600 x 900 mm'), { widthMm: 600, heightMm: 900 });
  assert.deepEqual(parseSize('60 x 90 cm'), { widthMm: 600, heightMm: 900 });
  assert.deepEqual(parseSize('24x36'), { widthMm: 610, heightMm: 914 });
});

test('a mount grows the glass on all four sides', () => {
  assert.deepEqual(glassSize(600, 900, 50), { widthMm: 700, heightMm: 1000 });
  assert.deepEqual(glassSize(600, 900, 0), { widthMm: 600, heightMm: 900 });
});

test('moulding costs more than the bare perimeter', () => {
  // 600×900 glass has a 3000mm perimeter, but a 40mm-wide moulding mitred at
  // four corners eats another 320mm. A shop ordering 3000mm comes up short on
  // every frame it makes.
  const bare = 2 * (600 + 900);
  const actual = mouldingLengthMm(600, 900, 40);
  assert.equal(bare, 3000);
  assert.equal(actual, 3320);
  assert.ok(actual > bare);

  // Chunkier moulding, bigger shortfall.
  assert.equal(mouldingLengthMm(600, 900, 75), 3600);
});

test('sheets round up, because you cannot buy two-thirds of one', () => {
  const sheet = [1220, 914];
  // A piece needing just over half a sheet still consumes a whole one.
  assert.equal(sheetsNeeded(600 * 900, ...sheet, { yieldPct: 100 }), 1);
  assert.equal(sheetsNeeded(1220 * 914 + 1, ...sheet, { yieldPct: 100 }), 2);
  // Realistic yield means more sheets for the same glass.
  assert.equal(sheetsNeeded(1220 * 914, ...sheet, { yieldPct: 70 }), 2);
});

/* ------------------------------------------------------------ pricing */

const PRICE_LIST = {
  moulding: { name: 'Oak 40mm', priceKobo: 350000, costKobo: 180000, mouldingWidthMm: 40, wastageMm: 150 },
  glazing: { name: 'Clear glass 2mm', priceKobo: 800000, costKobo: 450000 },
  mountBoard: { name: 'Cream mount', priceKobo: 500000, costKobo: 250000, cuttingKobo: 50000 },
  backing: { name: 'MDF backing', priceKobo: 200000, costKobo: 90000 },
};

test('prices a real framed portrait', () => {
  const quote = priceFramedPiece(
    { artworkWidthMm: 600, artworkHeightMm: 900, mountBorderMm: 50, labourKobo: 250000 },
    PRICE_LIST
  );

  // Mount pushes 600×900 artwork out to 700×1000 glass.
  assert.equal(quote.glassWidthMm, 700);
  assert.equal(quote.glassHeightMm, 1000);
  assert.equal(quote.glassAreaMm2, 700000);

  // Every part is charged off the GLASS size, not the artwork size.
  const byPart = Object.fromEntries(quote.lines.map((l) => [l.part, l.amountKobo]));
  assert.equal(byPart.moulding, chargeLength(350000, mouldingLengthMm(700, 1000, 40, { wastageMm: 150 })));
  assert.equal(byPart.glazing, Math.round((800000 * 700000) / 1_000_000));
  assert.equal(byPart.backing, Math.round((200000 * 700000) / 1_000_000));
  assert.equal(byPart.labour, 250000);

  // Everything is a whole number of kobo — no float has touched this.
  for (const line of quote.lines) assert.ok(Number.isInteger(line.amountKobo), `${line.part} is not integer`);
  assert.ok(Number.isInteger(quote.totalKobo));
});

function chargeLength(priceKobo, lengthMm) {
  return Math.round((priceKobo * lengthMm) / 1000);
}

test('the breakdown explains itself line by line', () => {
  const quote = priceFramedPiece(
    { artworkWidthMm: 600, artworkHeightMm: 900, mountBorderMm: 50, labourKobo: 250000 },
    PRICE_LIST
  );

  // The parts must add up to the quoted figure — this is what lets a customer
  // be shown why a frame costs what it costs.
  const summed = quote.lines.reduce((sum, l) => sum + l.amountKobo, 0);
  assert.equal(summed, quote.partsKobo);
  assert.equal(quote.unitKobo, quote.partsKobo);
  assert.deepEqual(
    quote.lines.map((l) => l.part),
    ['moulding', 'glazing', 'mount', 'backing', 'labour']
  );
});

test('no mount means no mount charge and no growth', () => {
  const quote = priceFramedPiece({ artworkWidthMm: 600, artworkHeightMm: 900 }, PRICE_LIST);
  assert.equal(quote.glassWidthMm, 600);
  assert.ok(!quote.lines.some((l) => l.part === 'mount'));
});

test('a canvas needs no glass and is not charged for any', () => {
  const quote = priceFramedPiece(
    { artworkWidthMm: 600, artworkHeightMm: 900 },
    { moulding: PRICE_LIST.moulding }
  );
  assert.deepEqual(quote.lines.map((l) => l.part), ['moulding']);
});

test('the minimum charge floors tiny work', () => {
  const tiny = priceFramedPiece(
    { artworkWidthMm: 50, artworkHeightMm: 70, minChargeKobo: 500000 },
    { backing: PRICE_LIST.backing }
  );
  assert.equal(tiny.unitKobo, 500000);
  assert.equal(tiny.minimumApplied, true);
});

test('the minimum applies per piece, not per order', () => {
  const ten = priceFramedPiece(
    { artworkWidthMm: 50, artworkHeightMm: 70, quantity: 10, minChargeKobo: 500000 },
    { backing: PRICE_LIST.backing }
  );
  // Ten tiny frames is ten pieces of work, not one.
  assert.equal(ten.grossKobo, 5000000);
});

test('multiple apertures multiply the cutting, not the board', () => {
  const single = priceFramedPiece(
    { artworkWidthMm: 600, artworkHeightMm: 900, mountBorderMm: 50, mountApertures: 1 },
    { mountBoard: PRICE_LIST.mountBoard }
  );
  const triple = priceFramedPiece(
    { artworkWidthMm: 600, artworkHeightMm: 900, mountBorderMm: 50, mountApertures: 3 },
    { mountBoard: PRICE_LIST.mountBoard }
  );
  assert.equal(triple.unitKobo - single.unitKobo, 2 * 50000);
});

test('a discount cannot make a job cost less than nothing', () => {
  const quote = priceFramedPiece(
    { artworkWidthMm: 600, artworkHeightMm: 900, discountKobo: 99_999_999 },
    PRICE_LIST
  );
  assert.equal(quote.totalKobo, 0);
});

test('margin reports profit against measured cost', () => {
  const { profitKobo, marginBp } = margin(1000000, 400000);
  assert.equal(profitKobo, 600000);
  assert.equal(marginBp, 6000); // 60%
});
