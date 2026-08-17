'use client';

import { useActionState, useState } from 'react';
import { addSupplier, paySupplierAction } from './actions';
import { formatNaira } from '@/lib/money';

const field = 'w-full rounded border border-stone-300 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none';
const label = 'block text-xs font-medium uppercase tracking-wide text-stone-500';

function Feedback({ state, done }) {
  if (!state) return null;
  if (state.errors?.length) {
    return (
      <ul className="space-y-1 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
        {state.errors.map((e) => <li key={e}>{e}</li>)}
      </ul>
    );
  }
  if (state.ok) return <p className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{done}</p>;
  return null;
}

export default function SupplierPanel({ suppliers, owedKobo, payments }) {
  const [payState, payAction, paying] = useActionState(paySupplierAction, null);
  const [addState, addAction, adding] = useActionState(addSupplier, null);
  const [showAdd, setShowAdd] = useState(false);

  return (
    <section className="space-y-4 rounded-lg border border-stone-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Suppliers</h2>
        <span className="text-sm">
          Owed to suppliers <span className="font-semibold tabular-nums">{formatNaira(owedKobo)}</span>
        </span>
      </div>

      {suppliers.length === 0 ? (
        <p className="text-sm text-stone-600">
          No suppliers yet. Add one to record what the shop owes and what it pays.
        </p>
      ) : (
        <form action={payAction} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-4">
            <div>
              <label className={label}>Supplier</label>
              <select name="supplierId" className={field} required>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Amount paid</label>
              <input name="amount" className={field} inputMode="decimal" required />
            </div>
            <div>
              <label className={label}>Paid by</label>
              <select name="method" className={field}>
                <option value="transfer">Transfer</option>
                <option value="cash">Cash</option>
                <option value="pos">POS</option>
              </select>
            </div>
            <div>
              <label className={label}>Reference</label>
              <input name="reference" className={field} />
            </div>
          </div>

          <p className="text-xs text-stone-500">
            This reduces the debt only. The materials became a cost when they were received, so
            paying for them later does not change stock or profit.
          </p>

          <Feedback state={payState} done="Payment recorded." />
          <button className="rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={paying}>
            {paying ? 'Saving...' : 'Record supplier payment'}
          </button>
        </form>
      )}

      {showAdd ? (
        <form action={addAction} className="space-y-3 border-t border-stone-200 pt-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className={label}>Name</label>
              <input name="name" className={field} required />
            </div>
            <div>
              <label className={label}>Phone</label>
              <input name="phone" className={field} />
            </div>
            <div>
              <label className={label}>Email</label>
              <input name="email" type="email" className={field} />
            </div>
          </div>
          <Feedback state={addState} done="Supplier added." />
          <div className="flex gap-2">
            <button className="rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={adding}>
              {adding ? 'Saving...' : 'Add supplier'}
            </button>
            <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-stone-600">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button onClick={() => setShowAdd(true)} className="text-sm text-stone-500 hover:text-stone-900">
          Add a supplier
        </button>
      )}

      {payments.length > 0 && (
        <div className="border-t border-stone-200 pt-3">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">
            Recent supplier payments
          </h3>
          {payments.map((payment) => (
            <div key={payment.id} className="flex justify-between py-0.5 text-sm">
              <span>{payment.supplier_name || payment.description}</span>
              <span className="text-stone-400">{new Date(payment.spent_at).toLocaleDateString()}</span>
              <span className="tabular-nums">{formatNaira(payment.amount_kobo)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
