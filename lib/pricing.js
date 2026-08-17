/* What a framed piece costs.
 *
 * This is the centre of the whole system. In a print shop a price is looked
 * up; in a framing shop it is worked out, from the size of the thing in front
 * of you, every single time. Get this wrong and every quote, invoice, job
 * ticket and profit figure downstream is wrong with it.
 *
 * The rules encoded here are the ones a framer applies by hand:
 *
 *   - the mount grows the glass, and everything cut to the glass grows too;
 *   - moulding is bought by the metre but consumed by the perimeter PLUS the
 *     mitres, which depend on how wide the moulding is;
 *   - glazing, board and backing are priced by area;
 *   - labour is per piece, not per metre;
 *   - and below a certain size nobody works for what the formula says, so a
 *     minimum charge floors the lot.
 *
 * Two things this module refuses to do, on purpose:
 *
 *   1. It never reads the database. Prices come in as arguments, so this can
 *      be tested exhaustively without a schema, and so a quote can be priced
 *      against yesterday's price list as easily as today's.
 *
 *   2. It returns a full breakdown, not just a number. That breakdown is
 *      SNAPSHOTTED onto the job when it is accepted. A quote given in August
 *      must still explain itself in October, after the moulding price has
 *      risen — recomputing an old quote from today's prices silently rewrites
 *      history and turns an argument with a customer into one you lose.
 */

import { mouldingLengthMm, areaMm2, glassSize } from './measure.js';

/** How a price item's `priceKobo` should be read. */
export const PRICING_MODES = ['per_piece', 'per_m', 'per_sqm', 'per_aperture'];

const MM_PER_M = 1000;
const MM2_PER_M2 = 1_000_000;

/** Cost of `lengthMm` of something sold by the metre. */
function chargeByLength(priceKobo, lengthMm) {
  return Math.round((priceKobo * lengthMm) / MM_PER_M);
}

/** Cost of `mm2` of something sold by the square metre. */
function chargeByArea(priceKobo, mm2) {
  return Math.round((priceKobo * mm2) / MM2_PER_M2);
}

/**
 * Price one framed piece.
 *
 * `spec` describes the job; `parts` carries the chosen price items, each of
 * which is `{ id, name, priceKobo, mode }` straight off the price list.
 * Anything absent is simply not charged — a canvas needs no glass, a
 * ready-made frame needs no moulding.
 */
export function priceFramedPiece(spec, parts = {}) {
  const {
    artworkWidthMm,
    artworkHeightMm,
    mountBorderMm = 0,
    mountApertures = 1,
    quantity = 1,
    labourKobo = 0,
    extras = [],
    discountKobo = 0,
    minChargeKobo = 0,
  } = spec;

  if (!(artworkWidthMm > 0) || !(artworkHeightMm > 0)) {
    throw new Error('A framed piece needs a width and a height in millimetres.');
  }
  if (!(quantity >= 1)) throw new Error('Quantity must be at least 1.');

  // The mount pushes the glass out on all four sides. Everything cut to the
  // glass — glazing, backing, the mount board itself — is cut to THIS size,
  // not to the artwork's.
  const glass = glassSize(artworkWidthMm, artworkHeightMm, mountBorderMm);
  const glassArea = areaMm2(glass.widthMm, glass.heightMm);

  const lines = [];

  if (parts.moulding) {
    const { priceKobo, name, mouldingWidthMm = 0, wastageMm = 0 } = parts.moulding;
    const lengthMm = mouldingLengthMm(glass.widthMm, glass.heightMm, mouldingWidthMm, { wastageMm });
    lines.push({
      part: 'moulding',
      name,
      detail: `${(lengthMm / MM_PER_M).toFixed(2)} m incl. mitres`,
      quantityMm: lengthMm,
      amountKobo: chargeByLength(priceKobo, lengthMm),
    });
  }

  if (parts.glazing) {
    lines.push({
      part: 'glazing',
      name: parts.glazing.name,
      detail: `${glass.widthMm} × ${glass.heightMm} mm`,
      quantityMm2: glassArea,
      amountKobo: chargeByArea(parts.glazing.priceKobo, glassArea),
    });
  }

  if (parts.mountBoard && mountBorderMm > 0) {
    const board = chargeByArea(parts.mountBoard.priceKobo, glassArea);
    // Cutting the window is skilled work charged per opening — a triple
    // aperture mount is three times the cutting of a single, on one board.
    const cutting = (parts.mountBoard.cuttingKobo || 0) * mountApertures;
    lines.push({
      part: 'mount',
      name: parts.mountBoard.name,
      detail: `${mountBorderMm} mm border, ${mountApertures} aperture${mountApertures > 1 ? 's' : ''}`,
      quantityMm2: glassArea,
      amountKobo: board + cutting,
    });
  }

  if (parts.backing) {
    lines.push({
      part: 'backing',
      name: parts.backing.name,
      detail: `${glass.widthMm} × ${glass.heightMm} mm`,
      quantityMm2: glassArea,
      amountKobo: chargeByArea(parts.backing.priceKobo, glassArea),
    });
  }

  if (labourKobo > 0) {
    lines.push({ part: 'labour', name: 'Assembly', detail: null, amountKobo: labourKobo });
  }

  for (const extra of extras) {
    lines.push({
      part: 'extra',
      name: extra.name,
      detail: extra.detail || null,
      amountKobo: extra.amountKobo,
    });
  }

  const partsTotal = lines.reduce((sum, l) => sum + l.amountKobo, 0);

  // The floor applies to one piece, before quantity. A customer ordering ten
  // tiny frames is still ten pieces of work.
  const flooredKobo = Math.max(partsTotal, minChargeKobo);
  const minimumApplied = flooredKobo > partsTotal;

  const unitKobo = flooredKobo;
  const grossKobo = unitKobo * quantity;
  const totalKobo = Math.max(0, grossKobo - discountKobo);

  return {
    glassWidthMm: glass.widthMm,
    glassHeightMm: glass.heightMm,
    glassAreaMm2: glassArea,
    lines,
    partsKobo: partsTotal,
    minimumApplied,
    unitKobo,
    quantity,
    grossKobo,
    discountKobo,
    totalKobo,
  };
}

/**
 * What the shop spends to make it, as opposed to what it charges.
 *
 * Kept separate from the price and never shown to counter staff. Its only job
 * is the margin figure the owner looks at — and a margin worked out from
 * guessed costs is worse than no margin at all, so this uses the same
 * measured quantities the price used, against cost rather than sell rates.
 */
export function costFramedPiece(spec, parts = {}) {
  const costParts = {};
  for (const [key, part] of Object.entries(parts)) {
    if (!part) continue;
    costParts[key] = { ...part, priceKobo: part.costKobo ?? 0, cuttingKobo: 0 };
  }

  const priced = priceFramedPiece(
    { ...spec, labourKobo: spec.labourCostKobo ?? 0, extras: [], discountKobo: 0, minChargeKobo: 0 },
    costParts
  );

  return { costKobo: priced.unitKobo * (spec.quantity ?? 1), lines: priced.lines };
}

/** Margin on a line, in kobo and as basis points (750 = 7.5%). */
export function margin(revenueKobo, costKobo) {
  const profitKobo = revenueKobo - costKobo;
  const marginBp = revenueKobo > 0 ? Math.round((profitKobo * 10000) / revenueKobo) : 0;
  return { profitKobo, marginBp };
}
