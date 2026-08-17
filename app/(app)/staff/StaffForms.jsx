'use client';

import { useActionState } from 'react';
import { addStaff, changePassword, removeStaff } from './actions';
import { ROLES } from '@/lib/roles';

const field = 'w-full rounded border border-stone-300 px-2 py-1.5 text-sm focus:border-stone-500 focus:outline-none';
const label = 'block text-xs font-medium uppercase tracking-wide text-stone-500';
const button = 'rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40';

function Result({ state }) {
  if (!state) return null;
  if (state.errors?.length) {
    return (
      <ul className="mt-3 space-y-1 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
        {state.errors.map((e) => <li key={e}>{e}</li>)}
      </ul>
    );
  }
  if (state.ok && state.message) {
    return <p className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{state.message}</p>;
  }
  return null;
}

export function AddStaffForm() {
  const [state, action, pending] = useActionState(addStaff, null);

  return (
    <form action={action} className="rounded-lg border border-stone-200 bg-white p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">Add someone</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="name">Name</label>
          <input id="name" name="name" className={field} required />
        </div>
        <div>
          <label className={label} htmlFor="username">Username</label>
          <input id="username" name="username" className={field} autoCapitalize="off" autoCorrect="off" required />
        </div>
        <div>
          <label className={label} htmlFor="password">First password</label>
          <input id="password" name="password" className={field} type="password" required minLength={8} />
          <p className="mt-1 text-xs text-stone-500">At least 8 characters. They should change it when they sign in.</p>
        </div>
        <div>
          <label className={label} htmlFor="role">What they can do</label>
          <select id="role" name="role" className={field} defaultValue="staff">
            {Object.entries(ROLES).map(([value, text]) => (
              <option key={value} value={value}>{text}</option>
            ))}
          </select>
        </div>
      </div>

      <button className={`${button} mt-4`} disabled={pending}>{pending ? 'Adding...' : 'Add'}</button>
      <Result state={state} />
    </form>
  );
}

export function PasswordForm({ user, self }) {
  const [state, action, pending] = useActionState(changePassword, null);

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={user.id} />
      <div className="w-48">
        <label className={label} htmlFor={`pw-${user.id}`}>
          {self ? 'Change your password' : 'New password'}
        </label>
        <input id={`pw-${user.id}`} name="password" type="password" className={field} minLength={8} required />
      </div>
      <button className="rounded border border-stone-300 px-3 py-1.5 text-sm" disabled={pending}>
        {pending ? 'Saving...' : 'Set'}
      </button>
      <div className="w-full"><Result state={state} /></div>
    </form>
  );
}

export function RemoveStaffForm({ user }) {
  const [state, action, pending] = useActionState(removeStaff, null);

  return (
    <form action={action}>
      <input type="hidden" name="id" value={user.id} />
      <button className="text-sm text-stone-500 hover:text-red-700" disabled={pending}>
        {pending ? 'Removing...' : 'Take off the tills'}
      </button>
      <Result state={state} />
    </form>
  );
}
