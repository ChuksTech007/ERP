'use server';

import { revalidatePath } from 'next/cache';
import { parseAmount } from '@/lib/money';
import {
  createPriceItem,
  updatePriceItem,
  retirePriceItem,
  restorePriceItem,
} from '@/lib/price-items';

/**
 * Read the form.
 *
 * Amounts arrive as whatever was typed — "3,500", "₦3500", "3500.50" — and
 * become integer kobo here, at the edge. Nothing past this point ever sees a
 * decimal.
 */
function readForm(formData) {
  const money = (field) => {
    const raw = formData.get(field);
    if (raw === null || String(raw).trim() === '') return 0;
    return parseAmount(raw);
  };
  const int = (field) => {
    const raw = Number(formData.get(field));
    return Number.isFinite(raw) ? Math.round(raw) : 0;
  };

  return {
    name: String(formData.get('name') || ''),
    category: String(formData.get('category') || ''),
    mode: String(formData.get('mode') || ''),
    priceKobo: money('price'),
    costKobo: money('cost'),
    cuttingKobo: money('cutting'),
    mouldingWidthMm: int('mouldingWidthMm'),
    wastageMm: int('wastageMm'),
  };
}

export async function savePriceItem(_previous, formData) {
  const id = formData.get('id');

  let input;
  try {
    input = readForm(formData);
  } catch (error) {
    // parseAmount refuses to guess at nonsense rather than reading it as zero,
    // which would silently price the item at nothing.
    return { ok: false, errors: [error.message] };
  }

  const result = id ? updatePriceItem(String(id), input) : createPriceItem(input);

  if (result.ok) revalidatePath('/pricelist');
  return result;
}

export async function retire(formData) {
  retirePriceItem(String(formData.get('id')));
  revalidatePath('/pricelist');
}

export async function restore(formData) {
  restorePriceItem(String(formData.get('id')));
  revalidatePath('/pricelist');
}
