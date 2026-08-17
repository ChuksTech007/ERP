/* Measurements.
 *
 * Every length in this system is an INTEGER number of millimetres, and every
 * area an INTEGER number of square millimetres.
 *
 * A framing shop prices by size, so a dimension is not a description — it is
 * an input to money. The same argument that keeps naira out of the money
 * layer keeps metres and inches out of this one: they are display units, and
 * they carry fractions.
 *
 * A millimetre is finer than anyone can cut glass, so nothing real is lost by
 * rounding to it.
 */

/** Customers and mouldings both speak inches; the workshop cuts in mm. */
const MM_PER_INCH = 25.4;
const MM_PER_CM = 10;
const MM_PER_M = 1000;
const MM2_PER_M2 = 1_000_000;

export function inchesToMm(inches) {
  return Math.round(inches * MM_PER_INCH);
}

export function cmToMm(cm) {
  return Math.round(cm * MM_PER_CM);
}

export function mmToInches(mm) {
  return mm / MM_PER_INCH;
}

/**
 * Read a size a person typed.
 *
 * Staff write sizes the way customers say them: "24x36", "24 x 36 in",
 * "600x900mm", "60 x 90 cm". Guessing the unit from the magnitude would be
 * clever and wrong — "24x36" is inches in a framing shop but 24x36mm is a
 * real, if unusual, size. So the unit is explicit, defaulting to what this
 * shop quotes in.
 */
export function parseSize(input, { defaultUnit = 'in' } = {}) {
  const text = String(input ?? '').trim().toLowerCase();
  const match = text.match(/^(\d+(?:\.\d+)?)\s*[x×by\s]+\s*(\d+(?:\.\d+)?)\s*(mm|cm|m|in|")?$/);
  if (!match) throw new Error(`"${input}" is not a size. Try "24 x 36 in" or "600 x 900 mm".`);

  const [, a, b, unit = defaultUnit] = match;
  const convert = { mm: (n) => Math.round(n), cm: cmToMm, m: (n) => Math.round(n * MM_PER_M), in: inchesToMm, '"': inchesToMm }[unit];

  return { widthMm: convert(Number(a)), heightMm: convert(Number(b)) };
}

/** "600 × 900 mm" / "24 × 36 in" — for screens and job tickets. */
export function formatSize(widthMm, heightMm, unit = 'mm') {
  if (unit === 'in') {
    const round = (mm) => Math.round(mmToInches(mm) * 8) / 8; // to the nearest 1/8"
    return `${round(widthMm)} × ${round(heightMm)} in`;
  }
  return `${widthMm} × ${heightMm} mm`;
}

/**
 * Length of moulding a frame consumes.
 *
 * Not simply the perimeter. Moulding is mitred at 45°, so each of the four
 * corners eats an extra length equal to the width of the moulding itself —
 * the outside edge of the frame is longer than the glass it holds. A shop
 * that orders by bare perimeter comes up short on every single frame, and the
 * shortfall grows with the chunkiness of the moulding.
 *
 * The allowance on top is the offcut: the last piece of a length is rarely
 * usable on the next job.
 */
export function mouldingLengthMm(widthMm, heightMm, mouldingWidthMm, { wastageMm = 0 } = {}) {
  const perimeter = 2 * (widthMm + heightMm);
  const mitres = 8 * mouldingWidthMm; // 2 × moulding width at each of 4 corners
  return perimeter + mitres + wastageMm;
}

/** Area of a piece of glass, acrylic, board or backing. */
export function areaMm2(widthMm, heightMm) {
  return widthMm * heightMm;
}

/**
 * Outside size of the glass once a mount is added.
 *
 * The mount border sits between the artwork and the frame, so it grows the
 * glass on all four sides. Everything cut to the glass size — glazing,
 * backing, the mount board itself — grows with it, which is why a 50mm mount
 * on a small picture can cost more than the picture's own glass.
 */
export function glassSize(artworkWidthMm, artworkHeightMm, mountBorderMm = 0) {
  return {
    widthMm: artworkWidthMm + 2 * mountBorderMm,
    heightMm: artworkHeightMm + 2 * mountBorderMm,
  };
}

/**
 * Sheets of stock a given area consumes.
 *
 * Deliberately NOT area ÷ sheet area. Glass and board are cut from rectangles
 * and the offcuts are mostly unusable, so a piece needing 55% of a sheet
 * consumes a whole sheet in practice. `yieldPct` is how much of a sheet the
 * shop genuinely gets to use across a run — measured, not assumed — and the
 * result is rounded up to whole sheets because you cannot buy two-thirds of
 * one.
 */
export function sheetsNeeded(requiredMm2, sheetWidthMm, sheetHeightMm, { yieldPct = 100 } = {}) {
  const usable = Math.floor((sheetWidthMm * sheetHeightMm * yieldPct) / 100);
  if (usable <= 0) throw new Error('Sheet size or yield is not usable.');
  return Math.ceil(requiredMm2 / usable);
}

/** Square millimetres to square metres. Display and per-sqm pricing only. */
export function mm2ToM2(mm2) {
  return mm2 / MM2_PER_M2;
}

export { MM_PER_M, MM2_PER_M2 };
