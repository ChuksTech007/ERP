'use server';

import { redirect } from 'next/navigation';
import { authenticate } from '@/lib/users';
import { createSession, destroySession } from '@/lib/auth';

export async function signIn(_previous, formData) {
  const user = authenticate(formData.get('username'), formData.get('password'));

  if (!user) {
    /* One message for every kind of failure — wrong name, wrong password,
     * deactivated account. Naming which one was wrong tells someone guessing
     * when they have found a real username. */
    return { error: 'That username and password do not match.' };
  }

  await createSession(user);
  redirect('/');
}

export async function signOut() {
  await destroySession();
  redirect('/login');
}
