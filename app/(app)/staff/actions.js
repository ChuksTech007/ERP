'use server';

import { revalidatePath } from 'next/cache';
import { requireUser, requireOwner } from '@/lib/auth';
import { createUser, setPassword, retireUser } from '@/lib/users';

export async function addStaff(_previous, formData) {
  await requireOwner();

  const result = createUser({
    name: String(formData.get('name') || ''),
    username: String(formData.get('username') || ''),
    password: String(formData.get('password') || ''),
    role: String(formData.get('role') || ''),
  });

  if (!result.ok) return result;
  revalidatePath('/staff');
  return { ok: true, message: 'Added. Have them sign in and change the password.' };
}

export async function changePassword(_previous, formData) {
  const user = await requireUser();
  const id = String(formData.get('id') || '');

  /* Anyone may change their own password; only the owner may change someone
   * else's. Without the second half, a staff login could lock the owner out
   * of the shop's own books. */
  if (id !== user.id) await requireOwner();

  const result = setPassword(id, String(formData.get('password') || ''));
  if (!result.ok) return result.errors ? result : { ok: false, errors: ['That account no longer exists.'] };

  revalidatePath('/staff');
  return { ok: true, message: 'Password changed.' };
}

export async function removeStaff(_previous, formData) {
  const user = await requireOwner();
  const id = String(formData.get('id') || '');

  if (id === user.id) {
    return { ok: false, errors: ['You cannot take away your own login while you are using it.'] };
  }

  const result = retireUser(id);
  if (!result.ok) return result;
  revalidatePath('/staff');
  return { ok: true, message: 'Taken off the tills. Their name stays on everything they rang up.' };
}
