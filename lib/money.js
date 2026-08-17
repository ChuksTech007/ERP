/* Money.
 *
 * Every amount in this system is an INTEGER number of kobo. Never a float,
 * never a decimal string, never naira.
 *
 * The reason is not theoretical. 0.1 + 0.2 is 0.30000000000000004 in
 * JavaScript, and a shop that takes three part-payments against an invoice
 * ends up with a balance of 0.0000000000001 outstanding — an invoice that can
 * never be marked paid, on a screen that shows it as ₦0.00. The staff cannot
 * see the problem and cannot clear it. Integers make that impossible rather
 * than unlikely.
 *
 * Kobo rather than naira because kobo is the smallest unit that exists: there
 * is nothing to round off, so nothing can be lost.
 */

/** Kobo in one naira. */
export const KOBO = 100;

/**
 * Read an amount typed by a human into kobo.
 *
 * Accepts what people actually type: "1500", "1,500", "₦1,500.50", " 1500 ".
 * Rejects everything else rather than guessing — a price that silently reads
 * as 0 because of a stray character is worse than a visible error.
 */
export function parseAmount(input) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error('Amount is not a number.');
    return Math.round(input * KOBO);
  }

  const cleaned = String(input ?? '')
    .replace(/[₦\s,]/g, '')
    .trim();

  if (cleaned === '') throw new Error('Amount is empty.');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
    throw new Error(`"${input}" is not an amount.`);
  }

  // Split rather than multiply the whole thing: Number("1500.55") * 100 is
  // 150054.99999999999, which truncates to a kobo short. The halves are each
  // exact as integers.
  const negative = cleaned.startsWith('-');
  const [whole, fraction = ''] = cleaned.replace('-', '').split('.');
  const kobo = Number(whole) * KOBO + Number((fraction + '00').slice(0, 2));

  return negative ? -kobo : kobo;
}

/** Kobo to naira, for display only. Never feed this back into a calculation. */
export function toNaira(kobo) {
  return kobo / KOBO;
}

/** "₦1,500.50" — what appears on screens and receipts. */
export function formatNaira(kobo, { symbol = true } = {}) {
  const negative = kobo < 0;
  const abs = Math.abs(Math.round(kobo));
  const whole = Math.floor(abs / KOBO).toLocaleString('en-NG');
  const part = String(abs % KOBO).padStart(2, '0');
  return `${negative ? '-' : ''}${symbol ? '₦' : ''}${whole}.${part}`;
}

/**
 * Split an amount across several parts without losing or inventing a kobo.
 *
 * Used wherever one figure has to be spread over many lines — a whole-invoice
 * discount pushed down onto each item, a payment settled against several
 * invoices. The naive way is to multiply each line by a ratio and round, and
 * the rounded parts then do not add back up to what you started with. On a
 * double-entry ledger that is an unbalanced journal and a day spent hunting
 * one kobo.
 *
 * Here the remainder is handed out a kobo at a time to the largest parts, so
 * the total is exact by construction.
 */
export function allocate(kobo, weights) {
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) throw new Error('Cannot split an amount across nothing.');

  const parts = weights.map((w) => Math.floor((kobo * w) / total));
  let remainder = kobo - parts.reduce((sum, p) => sum + p, 0);

  // Largest weights take the spare kobo first, so the split is deterministic
  // and the biggest line absorbs the rounding rather than a ₦50 one.
  const order = weights
    .map((w, i) => ({ w, i }))
    .sort((a, b) => b.w - a.w || a.i - b.i);

  for (let n = 0; remainder > 0; n++, remainder--) {
    parts[order[n % order.length].i] += 1;
  }

  return parts;
}

/**
 * A percentage of an amount, rounded to the kobo.
 *
 * `percent` is itself scaled by 100 (a "basis point" style) so that 7.5% is
 * passed as 750 and stays an integer. Percentages stored as 7.5 are floats,
 * and floats are how a VAT line drifts.
 */
export function percentOf(kobo, percentBasisPoints) {
  return Math.round((kobo * percentBasisPoints) / 10000);
}
