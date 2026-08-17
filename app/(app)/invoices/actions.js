'use server';

import { revalidatePath } from 'next/cache';
import { requireUser, canManage } from '@/lib/auth';
import { parseAmount } from '@/lib/money';
import { takePayment, refund, voidSale } from '@/lib/sales';

export async function pay(_previous, formData) {
  const user = await requireUser();
  const saleId = String(formData.get('saleId'));

  let amountKobo;
  try {
    amountKobo = parseAmount(formData.get('amount'));
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }

  const result = takePayment({
    saleId,
    amountKobo,
    method: String(formData.get('method') || 'cash'),
    reference: String(formData.get('reference') || '') || null,
    userId: user.id,
  });

  if (result.ok) {
    revalidatePath(`/invoices/${saleId}`);
    revalidatePath('/invoices');
    revalidatePath('/');
  }
  return result;
}

export async function giveRefund(_previous, formData) {
  const user = await requireUser();
  if (!canManage(user)) throw new Error('Only the owner or a manager can refund.');

  const saleId = String(formData.get('saleId'));

  let amountKobo;
  try {
    amountKobo = parseAmount(formData.get('amount'));
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }

  const result = refund({
    saleId,
    amountKobo,
    method: String(formData.get('method') || 'cash'),
    reason: String(formData.get('reason') || ''),
    userId: user.id,
  });

  if (result.ok) {
    revalidatePath(`/invoices/${saleId}`);
    revalidatePath('/');
  }
  return result;
}

export async function cancelInvoice(_previous, formData) {
  const user = await requireUser();
  if (!canManage(user)) throw new Error('Only the owner or a manager can cancel an invoice.');

  const saleId = String(formData.get('saleId'));
  const result = voidSale({ saleId, reason: String(formData.get('reason') || ''), userId: user.id });

  if (result.ok) {
    revalidatePath(`/invoices/${saleId}`);
    revalidatePath('/invoices');
    revalidatePath('/');
  }
  return result;
}
