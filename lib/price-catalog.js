/* The vocabulary of the price list: categories, how each can be charged, and
 * what to call them on screen.
 *
 * Deliberately in its own file with NO database import. The quoting screens
 * are client components and need these labels; anything they import travels
 * to the browser with them, and `lib/price-items.js` pulls in better-sqlite3
 * — a compiled binary that cannot be sent to a browser and fails the build
 * with an error pointing at the wrong file entirely.
 *
 * Pure data on one side of the line, database access on the other.
 */

/** What each pricing mode means, in the words used at the counter. */
export const MODE_LABELS = {
  per_piece: 'each',
  per_m: 'per metre',
  per_sqm: 'per square metre',
  per_aperture: 'per opening',
};

/**
 * Which modes are legal for which kind of item.
 *
 * Narrowing this is what stops a glass being priced per metre by accident —
 * ₦8,000 per metre and ₦8,000 per square metre are wildly different quotes
 * off the same typed figure, and nothing downstream can tell they were meant
 * to be different.
 */
export const CATEGORY_MODES = {
  moulding: ['per_m'],
  glazing: ['per_sqm'],
  mount_board: ['per_sqm'],
  backing: ['per_sqm'],
  service: ['per_piece', 'per_aperture'],
  print: ['per_piece', 'per_sqm'],
  ready_made: ['per_piece'],
  other: ['per_piece', 'per_m', 'per_sqm', 'per_aperture'],
};

export const CATEGORY_LABELS = {
  moulding: 'Moulding (frame)',
  glazing: 'Glass / acrylic',
  mount_board: 'Mount board',
  backing: 'Backing',
  service: 'Labour and services',
  print: 'Printing and portraits',
  ready_made: 'Ready-made frames',
  other: 'Other',
};
