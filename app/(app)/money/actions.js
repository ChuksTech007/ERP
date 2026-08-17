'use server';

import { revalidatePath } from 'next/cache';
import { requireUser, canManage, canSeeCosts } from '@/lib/auth';
import { parseAmount } from '@/lib/money';
import { recordExpense } from '@/lib/expenses';
import { setSettings } from '@/lib/settings';
import { createSupplier, paySupplier } from '@/lib/suppliers';

export async function addExpense(_previous, formData) {
  const user = await requireUser();
  if (!canSeeCosts(user)) throw new Error('Only the owner can record expenses.');

  let amountKobo;
  try {
    amountKobo = parseAmount(formData.get('amount'));
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }

  const result = recordExpense({
    spentAt: String(formData.get('spentAt') || '') || null,
    accountCode: String(formData.get('accountCode') || ''),
    description: String(formData.get('description') || ''),
    amountKobo,
    method: String(formData.get('method') || 'cash'),
    reference: String(formData.get('reference') || '') || null,
    userId: user.id,
  });

  if (result.ok) {
    revalidatePath('/money');
    revalidatePath('/');
  }
  return result;
}

export async function saveSettings(_previous, formData) {
  const user = await requireUser();
  if (!canManage(user)) throw new Error('Only the owner or a manager can change settings.');

  const money = (n) => {
    const raw = formData.get(n);
    if (raw == null || String(raw).trim() === '') return 0;
    return parseAmount(raw);
  };

  try {
    setSettings({
      'shop.name': String(formData.get('shopName') || ''),
      'shop.phone': String(formData.get('shopPhone') || ''),
      'shop.address': String(formData.get('shopAddress') || ''),
      'quote.unit': String(formData.get('quoteUnit') || 'in'),
      'pricing.minCharge_kobo': money('minCharge'),
      'pricing.defaultLabour_kobo': money('defaultLabour'),
      'pricing.defaultMountBorder_mm': Math.round(Number(formData.get('mountBorder')) || 0),
      // Stored scaled by 100, so 50% is 5000 and stays an integer.
      'pricing.depositPercent_bp': Math.round((Number(formData.get('depositPercent')) || 0) * 100),
    });
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }

  revalidatePath('/money');
  revalidatePath('/jobs/new');
  return { ok: true };
}


export async function addSupplier(_previous, formData) {
  const user = await requireUser();
  if (!canManage(user)) throw new Error('Only the owner or a manager can add a supplier.');

  const result = createSupplier({
    name: String(formData.get('name') || ''),
    phone: String(formData.get('phone') || '') || null,
    email: String(formData.get('email') || '') || null,
  });

  if (result.ok) revalidatePath('/money');
  return result;
}

export async function paySupplierAction(_previous, formData) {
  const user = await requireUser();
  if (!canSeeCosts(user)) throw new Error('Only the owner can pay suppliers.');

  let amountKobo;
  try {
    amountKobo = parseAmount(formData.get('amount'));
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }

  const result = paySupplier({
    supplierId: String(formData.get('supplierId')),
    amountKobo,
    method: String(formData.get('method') || 'transfer'),
    reference: String(formData.get('reference') || '') || null,
    userId: user.id,
  });

  if (result.ok) { revalidatePath('/money'); revalidatePath('/reports'); }
  return result;
}
