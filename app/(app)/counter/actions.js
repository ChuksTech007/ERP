'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { parseAmount } from '@/lib/money';
import { counterSale } from '@/lib/sales';

export async function sellOverCounter(_previous, formData) {
  const user = await requireUser();

  let lines;
  try {
    lines = JSON.parse(String(formData.get('lines') || '[]'));
  } catch {
    return { ok: false, errors: ['The sale could not be read.'] };
  }

  const money = (field) => {
    const raw = formData.get(field);
    if (raw == null || String(raw).trim() === '') return 0;
    try {
      return parseAmount(raw);
    } catch {
      return null;
    }
  };

  const discountKobo = money('discount');
  if (discountKobo === null) return { ok: false, errors: ['That discount is not an amount.'] };

  /* Blank means paid in full, which is what happens at a counter almost every
   * time. Typing the full amount on every sale is friction that gets skipped,
   * and a skipped payment looks like an unpaid invoice for ever after. */
  const rawPaid = formData.get('paid');
  const paymentKobo = rawPaid == null || String(rawPaid).trim() === '' ? null : money('paid');
  if (paymentKobo === null && rawPaid && String(rawPaid).trim() !== '') {
    return { ok: false, errors: ['That payment is not an amount.'] };
  }

  const result = counterSale(
    {
      lines,
      customerId: String(formData.get('customerId') || '') || null,
      customer: {
        name: String(formData.get('customerName') || ''),
        phone: String(formData.get('customerPhone') || ''),
      },
      discountKobo,
      paymentKobo,
      method: String(formData.get('method') || 'cash'),
      userId: user.id,
    },
    {}
  );

  if (!result.ok) return result;

  revalidatePath('/invoices');
  revalidatePath('/stock');
  revalidatePath('/');
  redirect(`/invoices/${result.id}`);
}
