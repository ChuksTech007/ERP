'use server';

import { revalidatePath } from 'next/cache';
import { requireUser, canManage, canSeeCosts } from '@/lib/auth';
import { parseAmount } from '@/lib/money';
import {
  createPriceItem,
  updatePriceItem,
  retirePriceItem,
  restorePriceItem,
  getPriceItem,
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
    materialId: String(formData.get('materialId') || '') || null,
  };
}

/* Every action re-checks for itself. The layout guard covers the page, not
 * these — a server action is a POST endpoint anyone can call directly. */
async function guard() {
  const user = await requireUser();
  if (!canManage(user)) throw new Error('Only the owner or a manager can change prices.');
  return user;
}

export async function savePriceItem(_previous, formData) {
  const user = await guard();
  const id = formData.get('id');

  let input;
  try {
    input = readForm(formData);
  } catch (error) {
    // parseAmount refuses to guess at nonsense rather than reading it as zero,
    // which would silently price the item at nothing.
    return { ok: false, errors: [error.message] };
  }

  /* A manager never sees the cost field, so their form does not submit one
   * and it would arrive here as zero — silently wiping the owner's cost
   * figures, and with them every margin in the shop, the first time a manager
   * corrected a spelling. Carry the stored value through instead. */
  if (!canSeeCosts(user) && id) {
    input.costKobo = getPriceItem(String(id))?.cost_kobo ?? 0;
  }

  const result = id ? updatePriceItem(String(id), input) : createPriceItem(input);

  if (result.ok) revalidatePath('/pricelist');
  return result;
}

export async function retire(formData) {
  await guard();
  retirePriceItem(String(formData.get('id')));
  revalidatePath('/pricelist');
}

export async function restore(formData) {
  await guard();
  restorePriceItem(String(formData.get('id')));
  revalidatePath('/pricelist');
}
