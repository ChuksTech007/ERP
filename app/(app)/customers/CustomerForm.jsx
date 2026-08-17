'use client';

import { useActionState } from 'react';
import { saveCustomer } from './actions';

const field = 'w-full rounded border border-stone-300 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none';
const label = 'block text-xs font-medium uppercase tracking-wide text-stone-500';

export default function CustomerForm({ customer = null }) {
  const [state, action, pending] = useActionState(saveCustomer, null);

  return (
    <form action={action} className="space-y-4 rounded-lg border border-stone-200 bg-white p-5">
      {customer && <input type="hidden" name="id" value={customer.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="name">Name</label>
          <input id="name" name="name" className={field} defaultValue={customer?.name || ''} required />
        </div>

        <div>
          <label className={label} htmlFor="phone">Phone</label>
          <input
            id="phone"
            name="phone"
            className={field}
            defaultValue={customer?.phone || ''}
            placeholder="0803 111 2222"
            inputMode="tel"
          />
          <p className="mt-1 text-xs text-stone-500">
            However it is written — the shop finds them by it either way.
          </p>
        </div>

        <div>
          <label className={label} htmlFor="email">Email</label>
          <input id="email" name="email" type="email" className={field} defaultValue={customer?.email || ''} />
        </div>

        <div>
          <label className={label} htmlFor="address">Address</label>
          <input id="address" name="address" className={field} defaultValue={customer?.address || ''} />
        </div>

        <div className="sm:col-span-2">
          <label className={label} htmlFor="notes">Notes</label>
          <textarea id="notes" name="notes" rows={2} className={field} defaultValue={customer?.notes || ''} />
        </div>
      </div>

      {state?.errors?.length > 0 && (
        <ul className="space-y-1 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {state.errors.map((error) => <li key={error}>{error}</li>)}
        </ul>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? 'Saving...' : customer ? 'Save changes' : 'Add customer'}
      </button>
    </form>
  );
}
