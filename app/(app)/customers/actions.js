'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser, canManage } from '@/lib/auth';
import { createCustomer, updateCustomer, retireCustomer } from '@/lib/customers';

function readForm(formData) {
  return {
    name: String(formData.get('name') || ''),
    phone: String(formData.get('phone') || ''),
    email: String(formData.get('email') || ''),
    address: String(formData.get('address') || ''),
    notes: String(formData.get('notes') || ''),
  };
}

export async function saveCustomer(_previous, formData) {
  // Every action guards itself; the layout does not cover these.
  await requireUser();

  const id = formData.get('id');
  const result = id ? updateCustomer(String(id), readForm(formData)) : createCustomer(readForm(formData));

  if (!result.ok) return result;

  revalidatePath('/customers');
  if (id) {
    revalidatePath(`/customers/${id}`);
    return result;
  }
  redirect(`/customers/${result.id}`);
}

export async function retire(formData) {
  const user = await requireUser();
  if (!canManage(user)) throw new Error('Only the owner or a manager can remove a customer.');

  const result = retireCustomer(String(formData.get('id')));
  if (!result.ok) throw new Error(result.errors[0]);

  revalidatePath('/customers');
  redirect('/customers');
}
