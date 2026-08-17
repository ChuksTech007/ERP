/* Stock vocabulary, with no database import.
 *
 * Client components need these labels, and anything they import travels to
 * the browser with them. `lib/stock.js` pulls in better-sqlite3, a compiled
 * binary that cannot be sent to a browser.
 */

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
  mm: 'Lengths, cut by the millimetre',
  mm2: 'Sheets, cut by area',
  piece: 'Whole pieces',
};

/** Which counting unit a category naturally uses, to prefill the form. */
export const CATEGORY_UNIT = {
  moulding: 'mm',
  glass: 'mm2',
  acrylic: 'mm2',
  mount_board: 'mm2',
  backing: 'mm2',
  hardware: 'piece',
  print_media: 'mm2',
  consumable: 'piece',
  other: 'piece',
};

export const MOVEMENT_LABELS = {
  opening: 'Opening stock',
  purchase: 'Received',
  consume: 'Used on a job',
  breakage: 'Breakage',
  offcut: 'Offcut written off',
  return: 'Returned to supplier',
  adjust: 'Count adjustment',
};

/** Base units expressed the way the shelf is counted. Pure, so both sides use it. */
export function formatQuantity(quantityBase, { base_unit, pack_size, pack_label }) {
  if (base_unit === 'piece') return `${quantityBase} ${quantityBase === 1 ? 'piece' : 'pieces'}`;

  const packs = quantityBase / pack_size;
  const measure =
    base_unit === 'mm'
      ? `${(quantityBase / 1000).toFixed(2)} m`
      : `${(quantityBase / 1_000_000).toFixed(2)} m²`;

  return `${measure} (${packs.toFixed(1)} × ${pack_label})`;
}
