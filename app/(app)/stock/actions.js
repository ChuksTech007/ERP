'use server';

import { revalidatePath } from 'next/cache';
import { requireUser, canManage } from '@/lib/auth';
import { parseAmount } from '@/lib/money';
import { createMaterial, receiveStock, recordBreakage, adjustToCount, setOpeningStock } from '@/lib/stock';

async function guard() {
  const user = await requireUser();
  if (!canManage(user)) throw new Error('Only the owner or a manager can change stock.');
  return user;
}

const int = (formData, field) => {
  const value = Number(formData.get(field));
  return Number.isFinite(value) ? Math.round(value) : 0;
};

const money = (formData, field) => {
  const raw = formData.get(field);
  if (raw == null || String(raw).trim() === '') return 0;
  return parseAmount(raw);
};

export async function addMaterial(_previous, formData) {
  await guard();
  try {
    const result = createMaterial({
      name: String(formData.get('name') || ''),
      category: String(formData.get('category') || ''),
      baseUnit: String(formData.get('baseUnit') || ''),
      packSize: int(formData, 'packSize'),
      packLabel: String(formData.get('packLabel') || ''),
      costPerPackKobo: money(formData, 'costPerPack'),
      reorderBase: int(formData, 'reorderBase'),
      mouldingWidthMm: int(formData, 'mouldingWidthMm'),
      yieldPct: int(formData, 'yieldPct') || 100,
      shelf: String(formData.get('shelf') || '') || null,
    });
    if (result.ok) revalidatePath('/stock');
    return result;
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }
}

export async function receive(_previous, formData) {
  const user = await guard();
  try {
    const result = receiveStock({
      materialId: String(formData.get('materialId')),
      packs: Number(formData.get('packs')),
      packCostKobo: money(formData, 'packCost') || null,
      method: String(formData.get('method') || 'cash'),
      onCredit: formData.get('onCredit') === 'on',
      userId: user.id,
    });
    if (result.ok) revalidatePath('/stock');
    return result;
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }
}

export async function breakage(_previous, formData) {
  const user = await guard();
  try {
    const result = recordBreakage({
      materialId: String(formData.get('materialId')),
      quantityBase: int(formData, 'quantityBase'),
      reason: String(formData.get('reason') || ''),
      userId: user.id,
    });
    if (result.ok) revalidatePath('/stock');
    return result;
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }
}

export async function count(_previous, formData) {
  const user = await guard();
  try {
    const result = adjustToCount({
      materialId: String(formData.get('materialId')),
      countedBase: int(formData, 'countedBase'),
      reason: String(formData.get('reason') || ''),
      userId: user.id,
    });
    if (result.ok) revalidatePath('/stock');
    return result;
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }
}

export async function opening(_previous, formData) {
  const user = await guard();
  try {
    const result = setOpeningStock({
      materialId: String(formData.get('materialId')),
      quantityBase: int(formData, 'quantityBase'),
      userId: user.id,
    });
    if (result.ok) revalidatePath('/stock');
    return result;
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }
}
